import { TestBed } from '@angular/core/testing';

import { flatConsumption } from '../../testing/engine-fixtures';
import { ControlledDataSource, flush } from '../../testing/worker-fixtures';
import type { CostAnalysis, CostSettings } from '../engine/cost-engine';
import type { ParsedConsumption } from '../engine/eredes-parser';
import {
  ENGINE_WORKER_FACTORY,
  EngineClient,
  EngineOutcome,
  EngineWorkerLike,
} from './engine-client';
import { createEngineHandler } from './engine-handler';
import type { AnalyseRequest, EngineResponse } from './engine-protocol';

class FakeWorker implements EngineWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: { message: AnalyseRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  failPost = false;

  postMessage(message: AnalyseRequest, transfer: Transferable[]): void {
    if (this.failPost) {
      throw new DOMException('could not clone', 'DataCloneError');
    }
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: response }));
  }

  crash(): void {
    this.onerror?.(new ErrorEvent('error'));
  }
}

const SETTINGS: CostSettings = {
  contractedKva: 6.9,
  largeFamily: false,
  current: { kind: 'offer', offerId: 'a' },
};
const RESULT_A = { currentId: 'a' } as CostAnalysis;
const RESULT_B = { currentId: 'b' } as CostAnalysis;

function success(id: number, result: CostAnalysis): EngineResponse {
  return { id, ok: true, result };
}

function setup(factory: () => EngineWorkerLike): EngineClient {
  TestBed.configureTestingModule({
    providers: [{ provide: ENGINE_WORKER_FACTORY, useValue: factory }],
  });
  return TestBed.inject(EngineClient);
}

function track(promise: Promise<EngineOutcome>): { outcome: EngineOutcome | null } {
  const state: { outcome: EngineOutcome | null } = { outcome: null };
  void promise.then((outcome) => (state.outcome = outcome));
  return state;
}

describe('EngineClient', () => {
  let workers: FakeWorker[];
  let client: EngineClient;

  beforeEach(() => {
    workers = [];
    client = setup(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
  });

  it('posts a request with an id and a transferred copy of the file, then resolves with the result', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const outcome = client.analyse(4, bytes, SETTINGS);
    expect(client.pending()).toBe(true);

    const { message, transfer } = workers[0].posted[0];
    expect(message).toMatchObject({ type: 'analyse', id: 1, fileId: 4, settings: SETTINGS });
    expect(transfer).toEqual([message.bytes]);
    expect(message.bytes).not.toBe(bytes);
    expect(bytes.byteLength).toBe(3);

    workers[0].respond(success(1, RESULT_A));
    expect(await outcome).toEqual({ status: 'success', requestId: 1, result: RESULT_A });
    expect(client.pending()).toBe(false);
  });

  it('discards the response of a superseded request that finishes after the newer one', async () => {
    const older = track(client.analyse(1, new ArrayBuffer(1), SETTINGS));
    const newer = track(
      client.analyse(1, new ArrayBuffer(1), { ...SETTINGS, contractedKva: 3.45 }),
    );
    await flush();
    expect(older.outcome).toEqual({ status: 'superseded', requestId: 1 });
    expect(client.pending()).toBe(true);

    workers[0].respond(success(2, RESULT_B));
    await flush();
    expect(newer.outcome).toEqual({ status: 'success', requestId: 2, result: RESULT_B });

    workers[0].respond(success(1, RESULT_A));
    workers[0].respond({ id: 1, ok: false, error: { kind: 'internal', code: 'INTERNAL' } });
    await flush();
    expect(newer.outcome).toEqual({ status: 'success', requestId: 2, result: RESULT_B });
    expect(client.pending()).toBe(false);
    expect(workers).toHaveLength(1);
  });

  it('keeps waiting for the newer request when the older one fails late', async () => {
    track(client.analyse(1, new ArrayBuffer(1), SETTINGS));
    const newer = track(client.analyse(1, new ArrayBuffer(1), SETTINGS));
    workers[0].respond({ id: 1, ok: false, error: { kind: 'data', code: 'DATA_UNAVAILABLE' } });
    await flush();
    expect(newer.outcome).toBeNull();
    expect(client.pending()).toBe(true);

    workers[0].respond({ id: 2, ok: false, error: { kind: 'engine', code: 'UNKNOWN_OFFER' } });
    await flush();
    expect(newer.outcome).toEqual({
      status: 'failure',
      requestId: 2,
      error: { kind: 'engine', code: 'UNKNOWN_OFFER' },
    });
    expect(client.pending()).toBe(false);
  });

  it('allows a retry after a failure', async () => {
    const first = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    workers[0].respond({
      id: 1,
      ok: false,
      error: { kind: 'parse', code: 'NOT_XLSX', details: {} },
    });
    expect((await first).status).toBe('failure');

    const retry = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    expect(client.pending()).toBe(true);
    workers[0].respond(success(2, RESULT_A));
    expect(await retry).toEqual({ status: 'success', requestId: 2, result: RESULT_A });
    expect(client.pending()).toBe(false);
  });

  it('fails the request in flight when the worker crashes and starts a new worker next time', async () => {
    const outcome = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    const crashed = workers[0];
    crashed.crash();
    expect(await outcome).toEqual({
      status: 'failure',
      requestId: 1,
      error: { kind: 'internal', code: 'WORKER_FAILED' },
    });
    expect(client.pending()).toBe(false);
    expect(crashed.terminated).toBe(true);

    const next = track(client.analyse(1, new ArrayBuffer(1), SETTINGS));
    expect(workers).toHaveLength(2);
    // A late message from the crashed worker carrying the new id is still ignored.
    crashed.onmessage?.(new MessageEvent('message', { data: success(2, RESULT_B) }));
    await flush();
    expect(next.outcome).toBeNull();
    workers[1].respond(success(2, RESULT_A));
    await flush();
    expect(next.outcome).toEqual({ status: 'success', requestId: 2, result: RESULT_A });
  });

  it('fails without pending state when the message cannot be posted or the worker cannot start', async () => {
    const outcome = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    workers[0].respond(success(1, RESULT_A));
    await outcome;
    workers[0].failPost = true;
    expect(await client.analyse(1, new ArrayBuffer(1), SETTINGS)).toEqual({
      status: 'failure',
      requestId: 2,
      error: { kind: 'internal', code: 'WORKER_FAILED' },
    });
    expect(client.pending()).toBe(false);

    TestBed.resetTestingModule();
    const broken = setup(() => {
      throw new Error('workers unavailable');
    });
    expect((await broken.analyse(1, new ArrayBuffer(1), SETTINGS)).status).toBe('failure');
    expect(broken.pending()).toBe(false);
  });

  it('ignores malformed messages', async () => {
    const outcome = track(client.analyse(1, new ArrayBuffer(1), SETTINGS));
    workers[0].respond({ id: 1 });
    workers[0].respond('noise');
    await flush();
    expect(outcome.outcome).toBeNull();
    expect(client.pending()).toBe(true);
  });

  it('cancels and cleans up on destroy', async () => {
    const cancelled = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    client.cancel();
    expect(await cancelled).toEqual({ status: 'superseded', requestId: 1 });
    expect(client.pending()).toBe(false);
    workers[0].respond(success(1, RESULT_A));
    expect(client.pending()).toBe(false);

    const inFlight = client.analyse(1, new ArrayBuffer(1), SETTINGS);
    client.ngOnDestroy();
    expect(await inFlight).toEqual({ status: 'superseded', requestId: 2 });
    expect(workers[0].terminated).toBe(true);
    expect(client.pending()).toBe(false);
  });
});

describe('EngineClient with the real handler', () => {
  it('shows the newer result when the older request finishes last in the worker', async () => {
    const consumptions: Record<number, ParsedConsumption> = {
      1: flatConsumption('2024-03-01', '2024-03-02', 0.25),
      2: flatConsumption('2025-03-01', '2025-03-02', 0.25),
    };
    const source = new ControlledDataSource([2025]);
    const handle = createEngineHandler(source, (bytes) => consumptions[new Uint8Array(bytes)[0]]);
    const worker = new FakeWorker();
    worker.postMessage = (message) => {
      void handle(message).then((response) => worker.respond(response));
    };
    const client = setup(() => worker);

    const older = track(client.analyse(1, new Uint8Array([1]).buffer, SETTINGS));
    const newer = track(client.analyse(2, new Uint8Array([2]).buffer, SETTINGS));
    await flush();
    expect(newer.outcome?.status).toBe('success');
    expect(newer.outcome?.status === 'success' && newer.outcome.result.period.start).toBe(
      '2025-03-01T00:00+00:00',
    );

    source.release(2024);
    await flush();
    await flush();
    expect(older.outcome).toEqual({ status: 'superseded', requestId: 1 });
    expect(newer.outcome?.status === 'success' && newer.outcome.result.period.start).toBe(
      '2025-03-01T00:00+00:00',
    );
    expect(client.pending()).toBe(false);
  });
});
