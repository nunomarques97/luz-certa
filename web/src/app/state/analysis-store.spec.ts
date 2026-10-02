import { TestBed } from '@angular/core/testing';

import { deferred, flush } from '../../testing/worker-fixtures';
import type { CostAnalysis, CostSettings } from '../engine/cost-engine';
import { ENGINE_WORKER_FACTORY, EngineWorkerLike } from '../worker/engine-client';
import type { AnalyseRequest, EngineFailure } from '../worker/engine-protocol';
import { AnalysisStore, FileLike } from './analysis-store';

class FakeWorker implements EngineWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly posted: AnalyseRequest[] = [];

  postMessage(message: AnalyseRequest): void {
    this.posted.push(message);
  }

  terminate(): void {}

  succeed(id: number, total: number): void {
    this.onmessage?.(new MessageEvent('message', { data: { id, ok: true, result: analysis(total) } }));
  }

  fail(id: number, error: EngineFailure): void {
    this.onmessage?.(new MessageEvent('message', { data: { id, ok: false, error } }));
  }
}

function analysis(total: number): CostAnalysis {
  return {
    ranking: [{ id: 'a', supplier: 'Fornecedor', name: 'Oferta A', isCurrent: false, total }],
  } as unknown as CostAnalysis;
}

function file(name: string, size = 100): FileLike & { read: ReturnType<typeof deferred<ArrayBuffer>> } {
  const read = deferred<ArrayBuffer>();
  return { name, size, arrayBuffer: () => read.promise, read };
}

async function readyFile(store: AnalysisStore, name = 'consumos.xlsx'): Promise<void> {
  const picked = file(name);
  const done = store.selectFile(picked);
  picked.read.resolve(new Uint8Array([1, 2, 3]).buffer);
  await done;
}

const OFFER_A: CostSettings = {
  contractedKva: 6.9,
  largeFamily: false,
  current: { kind: 'offer', offerId: 'a' },
};
const OFFER_B: CostSettings = { ...OFFER_A, current: { kind: 'offer', offerId: 'b' } };

describe('AnalysisStore', () => {
  let worker: FakeWorker;
  let store: AnalysisStore;

  beforeEach(() => {
    worker = new FakeWorker();
    TestBed.configureTestingModule({
      providers: [{ provide: ENGINE_WORKER_FACTORY, useValue: () => worker }],
    });
    store = TestBed.inject(AnalysisStore);
  });

  it('reads a picked file and opens the setup form', async () => {
    expect(store.view()).toBe('upload');
    await readyFile(store);
    expect(store.view()).toBe('setup');
    expect(store.file()?.name).toBe('consumos.xlsx');
    expect(store.announcement()).toContain('Ficheiro escolhido');
  });

  it('keeps the newest file when an older read finishes last', async () => {
    const first = file('primeiro.xlsx');
    const second = file('segundo.xlsx');
    const a = store.selectFile(first);
    const b = store.selectFile(second);
    second.read.resolve(new ArrayBuffer(2));
    await b;
    first.read.resolve(new ArrayBuffer(1));
    await a;
    expect(store.file()?.name).toBe('segundo.xlsx');
  });

  it('rejects a file over 25 MB without reading it', async () => {
    const big = file('grande.xlsx', 26 * 1024 * 1024);
    let read = false;
    big.arrayBuffer = () => {
      read = true;
      return Promise.resolve(new ArrayBuffer(0));
    };
    await store.selectFile(big);
    expect(read).toBe(false);
    expect(store.view()).toBe('upload');
    expect(store.error()?.failure).toEqual({ kind: 'parse', code: 'FILE_TOO_LARGE', details: {} });
  });

  it('shows an unreadable file as an upload error', async () => {
    const broken = file('x.xlsx');
    const done = store.selectFile(broken);
    broken.read.reject(new Error('NotReadableError'));
    await done;
    expect(store.error()).toEqual({
      failure: { kind: 'file', code: 'FILE_UNREADABLE' },
      screen: 'upload',
    });
  });

  it('shows processing without a stale result, then the result', async () => {
    await readyFile(store);
    const first = store.submit(OFFER_A);
    expect(store.view()).toBe('processing');
    expect(store.announcement()).toContain('A calcular');
    worker.succeed(worker.posted[0].id, 100);
    await first;
    expect(store.view()).toBe('results');
    expect(store.result()?.analysis.ranking[0].total).toBe(100);
    expect(store.announcement()).toContain('Resultados prontos');

    void store.submit(OFFER_B);
    expect(store.view()).toBe('processing');
    expect(store.result()).toBeNull();
  });

  it('discards an older success that arrives after a newer request', async () => {
    await readyFile(store);
    const older = store.submit(OFFER_A);
    const newer = store.submit(OFFER_B);
    const [first, second] = worker.posted;
    worker.succeed(second.id, 200);
    await newer;
    worker.succeed(first.id, 100);
    await older;
    await flush();
    expect(store.result()?.analysis.ranking[0].total).toBe(200);
    expect(store.result()?.submission.settings).toEqual(OFFER_B);
  });

  it('never lets a failure after a newer success overwrite it', async () => {
    await readyFile(store);
    void store.submit(OFFER_A);
    const newer = store.submit(OFFER_B);
    const [first, second] = worker.posted;
    worker.succeed(second.id, 200);
    await newer;
    worker.fail(first.id, { kind: 'data', code: 'DATA_UNAVAILABLE' });
    await flush();
    expect(store.view()).toBe('results');
    expect(store.error()).toBeNull();
    expect(store.result()?.analysis.ranking[0].total).toBe(200);
  });

  it('retries with the last submitted file and settings, not unsubmitted edits', async () => {
    await readyFile(store);
    const run = store.submit(OFFER_A);
    const failed = worker.posted[0];
    worker.fail(failed.id, { kind: 'data', code: 'DATA_UNAVAILABLE' });
    await run;
    expect(store.view()).toBe('upload');
    expect(store.error()?.screen).toBe('upload');
    expect(store.announcement()).toContain('Erro');

    store.draft.update((draft) => ({ ...draft, offerId: 'other', contractedKva: 3.45 }));
    const retry = store.retry();
    expect(store.error()).toBeNull();
    expect(store.view()).toBe('processing');
    const retried = worker.posted[1];
    expect(retried.fileId).toBe(failed.fileId);
    expect(retried.settings).toEqual(OFFER_A);
    expect(new Uint8Array(retried.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    worker.succeed(retried.id, 50);
    await retry;
    expect(store.view()).toBe('results');
  });

  it('shows settings errors on the form and file errors on the upload screen', async () => {
    await readyFile(store);
    let run = store.submit(OFFER_A);
    worker.fail(worker.posted[0].id, { kind: 'engine', code: 'INVALID_MANUAL_PRICES' });
    await run;
    expect(store.view()).toBe('setup');
    expect(store.error()?.screen).toBe('setup');

    run = store.submit(OFFER_A);
    worker.fail(worker.posted[1].id, { kind: 'parse', code: 'NOT_XLSX', details: {} });
    await run;
    expect(store.view()).toBe('upload');
    expect(store.error()?.screen).toBe('upload');
  });

  it('discards the run when the user goes back to the form or picks another file', async () => {
    await readyFile(store);
    let run = store.submit(OFFER_A);
    store.editSettings();
    expect(store.view()).toBe('setup');
    expect(store.announcement()).toBe('Cálculo cancelado.');
    worker.succeed(worker.posted[0].id, 100);
    await run;
    await flush();
    expect(store.view()).toBe('setup');
    expect(store.result()).toBeNull();

    run = store.submit(OFFER_A);
    store.startOver();
    expect(store.view()).toBe('upload');
    worker.fail(worker.posted[1].id, { kind: 'data', code: 'DATA_UNAVAILABLE' });
    await run;
    await flush();
    expect(store.view()).toBe('upload');
    expect(store.error()).toBeNull();
  });

  it('a new upload while computing discards the obsolete result', async () => {
    await readyFile(store, 'ano.xlsx');
    const run = store.submit(OFFER_A);
    await readyFile(store, 'trimestre.xlsx');
    expect(store.view()).toBe('setup');
    worker.succeed(worker.posted[0].id, 100);
    await run;
    await flush();
    expect(store.view()).toBe('setup');
    expect(store.result()).toBeNull();
    expect(store.file()?.name).toBe('trimestre.xlsx');
  });

  it('changes the announcement text when the same message repeats', async () => {
    const big = () => file('grande.xlsx', 26 * 1024 * 1024);
    await store.selectFile(big());
    const first = store.announcement();
    await store.selectFile(big());
    expect(store.announcement()).not.toBe(first);
    expect(store.announcement().trim()).toBe(first.trim());
  });
});
