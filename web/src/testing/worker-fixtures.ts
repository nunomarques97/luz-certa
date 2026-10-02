import type { Catalogue } from '../app/engine/catalogue-model';
import type { OmieYearFile } from '../app/engine/omie-time';
import type { EngineDataSource } from '../app/worker/engine-handler';
import { buildOmieFiles, fixedOffer, indexedOffer, testCatalogue } from './engine-fixtures';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run (a macrotask runs after all queued microtasks). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Data source whose loads are controlled by the test: each OMIE year load waits for `release(year)`
 * unless the year is listed in `immediate`. Calls are recorded.
 */
export class ControlledDataSource implements EngineDataSource {
  readonly calls: string[] = [];
  readonly catalogue: Catalogue = testCatalogue([fixedOffer('a'), indexedOffer('i')]);
  private readonly years = new Map<number, Deferred<OmieYearFile>>();
  failCatalogue = false;

  constructor(private readonly immediate: number[] = []) {}

  loadCatalogue(): Promise<Catalogue> {
    this.calls.push('catalogue');
    return this.failCatalogue
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(this.catalogue);
  }

  loadOmieIndex(): Promise<{ years: number[] }> {
    this.calls.push('index');
    return Promise.resolve({ years: [2024, 2025] });
  }

  loadOmieYear(year: number): Promise<OmieYearFile> {
    this.calls.push(`omie-${year}`);
    if (this.immediate.includes(year)) {
      return Promise.resolve(omieYear(year));
    }
    const pending = deferred<OmieYearFile>();
    this.years.set(year, pending);
    return pending.promise;
  }

  release(year: number): void {
    this.years.get(year)?.resolve(omieYear(year));
  }

  fail(year: number): void {
    this.years.get(year)?.reject(new Error('offline'));
  }
}

const omieCache = new Map<number, OmieYearFile>();

/** A flat 100 EUR/MWh OMIE year, hourly (enough for tests that do not look at OMIE timing). */
function omieYear(year: number): OmieYearFile {
  let file = omieCache.get(year);
  if (!file) {
    file = buildOmieFiles(`${year}-01-01`, `${year}-12-31`, () => 100, '9999-01-01').find((entry) =>
      Object.keys(entry.days)[0]?.startsWith(String(year)),
    ) as OmieYearFile;
    omieCache.set(year, file);
  }
  return file;
}
