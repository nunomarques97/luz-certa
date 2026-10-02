import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { flatConsumption } from '../../testing/engine-fixtures';
import { FIXTURE_FILES } from '../../testing/synthetic-fixtures';
import { ControlledDataSource, flush } from '../../testing/worker-fixtures';
import type { CostSettings } from '../engine/cost-engine';
import type { ParsedConsumption } from '../engine/eredes-parser';
import { createEngineHandler, fetchDataSource } from './engine-handler';
import type { AnalyseRequest, EngineResponse } from './engine-protocol';

const CONSUMPTION: Record<number, ParsedConsumption> = {
  1: flatConsumption('2024-03-01', '2024-03-02', 0.25),
  2: flatConsumption('2025-03-01', '2025-03-02', 0.25),
};

/** Stand-in parser: the first byte selects one of the consumptions above. */
function fakeParse(bytes: Uint8Array | ArrayBuffer): ParsedConsumption {
  const marker = new Uint8Array(bytes)[0];
  const consumption = CONSUMPTION[marker];
  if (!consumption) {
    throw new Error(`unexpected marker ${marker}`);
  }
  return consumption;
}

const SETTINGS: CostSettings = {
  contractedKva: 6.9,
  largeFamily: false,
  current: { kind: 'offer', offerId: 'a' },
};

function request(
  id: number,
  fileId: number,
  marker: number,
  settings: CostSettings = SETTINGS,
): AnalyseRequest {
  return { type: 'analyse', id, fileId, bytes: new Uint8Array([marker]).buffer, settings };
}

function periodStart(response: EngineResponse): string | null {
  return response.ok ? response.result.period.start : null;
}

describe('createEngineHandler', () => {
  it('answers each overlapping request with its own result when the older one finishes last', async () => {
    const source = new ControlledDataSource([2025]);
    const handle = createEngineHandler(source, fakeParse);
    const order: number[] = [];
    const older = handle(request(1, 1, 1)).then((response) => (order.push(response.id), response));
    const newer = handle(request(2, 2, 2)).then((response) => (order.push(response.id), response));

    const newerResponse = await newer;
    await flush();
    expect(order).toEqual([2]);

    source.release(2024);
    const olderResponse = await older;
    expect(order).toEqual([2, 1]);
    expect(newerResponse.id).toBe(2);
    expect(periodStart(newerResponse)).toBe('2025-03-01T00:00+00:00');
    expect(olderResponse.id).toBe(1);
    expect(periodStart(olderResponse)).toBe('2024-03-01T00:00+00:00');
  });

  it('loads only the OMIE years of the period and reuses loaded data', async () => {
    const source = new ControlledDataSource([2024, 2025]);
    const handle = createEngineHandler(source, fakeParse);
    await handle(request(1, 1, 2));
    await handle(request(2, 1, 2));
    expect(source.calls).toEqual(['catalogue', 'index', 'omie-2025']);
  });

  it('parses a file once per fileId and again when the fileId changes', async () => {
    const parse = vi.fn(fakeParse);
    const handle = createEngineHandler(new ControlledDataSource([2024, 2025]), parse);
    await handle(request(1, 7, 1));
    await handle(request(2, 7, 1, { ...SETTINGS, contractedKva: 3.45 }));
    expect(parse).toHaveBeenCalledTimes(1);
    await handle(request(3, 8, 2));
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('returns a typed parse error without loading any data', async () => {
    const source = new ControlledDataSource([2024, 2025]);
    const handle = createEngineHandler(source);
    const bytes = readFileSync(
      resolve(process.cwd(), '../fixtures/synthetic', FIXTURE_FILES.notXlsx),
    );
    const response = await handle({ ...request(4, 1, 0), bytes: new Uint8Array(bytes).buffer });
    expect(response).toEqual({
      id: 4,
      ok: false,
      error: { kind: 'parse', code: 'NOT_XLSX', details: {} },
    });
    expect(source.calls).toEqual([]);
  });

  it('returns a typed engine error', async () => {
    const handle = createEngineHandler(new ControlledDataSource([2024, 2025]), fakeParse);
    const response = await handle(
      request(5, 1, 1, { ...SETTINGS, current: { kind: 'offer', offerId: 'nope' } }),
    );
    expect(response).toEqual({
      id: 5,
      ok: false,
      error: { kind: 'engine', code: 'UNKNOWN_OFFER' },
    });
  });

  it('reports unavailable data and loads it again on retry', async () => {
    const source = new ControlledDataSource([2025]);
    source.failCatalogue = true;
    const handle = createEngineHandler(source, fakeParse);
    expect(await handle(request(1, 1, 2))).toEqual({
      id: 1,
      ok: false,
      error: { kind: 'data', code: 'DATA_UNAVAILABLE' },
    });

    source.failCatalogue = false;
    const retry = await handle(request(2, 1, 2));
    expect(retry.ok).toBe(true);
    expect(source.calls.filter((call) => call === 'catalogue')).toHaveLength(2);
  });

  it('does not keep a failed OMIE year load', async () => {
    const source = new ControlledDataSource();
    const handle = createEngineHandler(source, fakeParse);
    const first = handle(request(1, 1, 1));
    await flush();
    source.fail(2024);
    expect((await first).ok).toBe(false);

    const second = handle(request(2, 1, 1));
    await flush();
    source.release(2024);
    expect((await second).ok).toBe(true);
    expect(source.calls.filter((call) => call === 'omie-2024')).toHaveLength(2);
  });

  it('rejects malformed requests and hides unexpected error text', async () => {
    const handle = createEngineHandler(new ControlledDataSource([2024]), () => {
      throw new Error('text from the file');
    });
    expect(await handle({ type: 'analyse', id: 9 })).toEqual({
      id: 9,
      ok: false,
      error: { kind: 'internal', code: 'INVALID_REQUEST' },
    });
    expect(await handle(null)).toEqual({
      id: -1,
      ok: false,
      error: { kind: 'internal', code: 'INVALID_REQUEST' },
    });
    expect(await handle({ ...request(3, 1, 1), bytes: 'not a buffer' })).toMatchObject({
      id: 3,
      ok: false,
    });
    expect(
      await handle({ ...request(4, 1, 1), settings: { ...SETTINGS, current: { kind: 'other' } } }),
    ).toMatchObject({
      id: 4,
      error: { code: 'INVALID_REQUEST' },
    });

    const response = await handle(request(5, 1, 1));
    expect(response).toEqual({ id: 5, ok: false, error: { kind: 'internal', code: 'INTERNAL' } });
    expect(JSON.stringify(response)).not.toContain('text from the file');
  });
});

describe('fetchDataSource', () => {
  it('reads the static data files with same-origin GET requests and no body', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ years: [2025] }), { status: 200 });
    }) as typeof fetch;
    const source = fetchDataSource(new URL('https://luz.example/app/'), fetchFn);
    await source.loadCatalogue();
    await source.loadOmieIndex();
    await source.loadOmieYear(2025);
    expect(requests.map((entry) => entry.url)).toEqual([
      'https://luz.example/app/data/catalogue.json',
      'https://luz.example/app/data/omie/index.json',
      'https://luz.example/app/data/omie/2025.json',
    ]);
    for (const entry of requests) {
      expect(entry.init).toEqual({ method: 'GET', credentials: 'same-origin' });
    }
  });

  it('fails on an HTTP error', async () => {
    const fetchFn = (async () => new Response('missing', { status: 404 })) as typeof fetch;
    await expect(
      fetchDataSource(new URL('https://luz.example/'), fetchFn).loadCatalogue(),
    ).rejects.toThrow('HTTP 404');
  });
});
