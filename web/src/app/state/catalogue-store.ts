import { Injectable, InjectionToken, inject, signal } from '@angular/core';

import type { Catalogue } from '../engine/catalogue-model';

/** fetch, replaceable in tests. */
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

export interface OmieIndex {
  years: number[];
  first_day: string;
  last_day: string;
}

export type CatalogueState =
  | { status: 'loading' }
  | { status: 'ready'; catalogue: Catalogue; omie: OmieIndex | null }
  | { status: 'error' };

/**
 * Loads the tariff catalogue (and the OMIE coverage index) from the app's own origin for the setup
 * form and the sources page. Only same-origin GET requests without a body; nothing about the user's
 * consumption is involved. A failed load can be retried; overlapping loads keep the latest.
 */
@Injectable({ providedIn: 'root' })
export class CatalogueStore {
  private readonly fetchFn = inject(FETCH);
  private readonly current = signal<CatalogueState>({ status: 'loading' });
  private attempt = 0;
  private started = false;

  readonly state = this.current.asReadonly();

  /** Starts the first load; later calls do nothing unless the last load failed. */
  ensureLoaded(): void {
    if (!this.started || this.current().status === 'error') {
      this.reload();
    }
  }

  reload(): void {
    this.started = true;
    const attempt = ++this.attempt;
    this.current.set({ status: 'loading' });
    void Promise.all([
      this.getJson<Catalogue>('data/catalogue.json'),
      this.getJson<OmieIndex>('data/omie/index.json').catch(() => null),
    ]).then(
      ([catalogue, omie]) => {
        if (attempt === this.attempt) {
          this.current.set({ status: 'ready', catalogue, omie });
        }
      },
      () => {
        if (attempt === this.attempt) {
          this.current.set({ status: 'error' });
        }
      },
    );
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchFn(new URL(path, document.baseURI), {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
