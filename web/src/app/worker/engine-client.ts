import { Injectable, InjectionToken, OnDestroy, inject, signal } from '@angular/core';

import type { CostAnalysis, CostSettings } from '../engine/cost-engine';
import { AnalyseRequest, EngineFailure, isEngineResponse } from './engine-protocol';

/** The part of the Worker API the client uses, so tests can supply a fake. */
export interface EngineWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: AnalyseRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export const ENGINE_WORKER_FACTORY = new InjectionToken<() => EngineWorkerLike>(
  'ENGINE_WORKER_FACTORY',
);

export type EngineOutcome =
  | { status: 'success'; requestId: number; result: CostAnalysis }
  | { status: 'failure'; requestId: number; error: EngineFailure }
  /** A newer request (or cancel) replaced this one; its eventual response is discarded. */
  | { status: 'superseded'; requestId: number };

const WORKER_FAILED: EngineFailure = { kind: 'internal', code: 'WORKER_FAILED' };

/**
 * Sends analyse requests to the engine worker. Only the latest request is awaited: starting a new
 * one settles the previous promise as superseded, and a late response for it is ignored, so an
 * older success or failure can never replace a newer outcome. `pending` is true only while the
 * latest request has no outcome, and every exit path (response, crash, post failure, cancel,
 * destroy) clears it.
 */
@Injectable({ providedIn: 'root' })
export class EngineClient implements OnDestroy {
  private readonly createWorker = inject(ENGINE_WORKER_FACTORY);
  private worker: EngineWorkerLike | null = null;
  private lastId = 0;
  private waiting: { id: number; resolve: (outcome: EngineOutcome) => void } | null = null;
  private readonly busy = signal(false);

  /** True while the latest request is running. */
  readonly pending = this.busy.asReadonly();

  /**
   * Parses `bytes` (identified by `fileId`, which must change when the user picks another file) and
   * computes costs. The caller's buffer is copied, so it can be reused for a retry.
   */
  analyse(fileId: number, bytes: ArrayBuffer, settings: CostSettings): Promise<EngineOutcome> {
    this.supersede();
    const id = ++this.lastId;
    const outcome = new Promise<EngineOutcome>((resolve) => {
      this.waiting = { id, resolve };
    });
    this.busy.set(true);
    try {
      const copy = bytes.slice(0);
      this.ensureWorker().postMessage({ type: 'analyse', id, fileId, bytes: copy, settings }, [
        copy,
      ]);
    } catch {
      this.discardWorker();
      this.settle(id, { status: 'failure', requestId: id, error: WORKER_FAILED });
    }
    return outcome;
  }

  /** Stops waiting for the current request; its result will be discarded. */
  cancel(): void {
    this.supersede();
  }

  ngOnDestroy(): void {
    this.supersede();
    this.discardWorker();
  }

  private ensureWorker(): EngineWorkerLike {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = (event) => this.onMessage(worker, event.data);
      worker.onerror = () => this.onCrash(worker);
      worker.onmessageerror = () => this.onCrash(worker);
      this.worker = worker;
    }
    return this.worker;
  }

  private onMessage(worker: EngineWorkerLike, data: unknown): void {
    if (worker !== this.worker || !isEngineResponse(data)) {
      return;
    }
    this.settle(
      data.id,
      data.ok
        ? { status: 'success', requestId: data.id, result: data.result }
        : { status: 'failure', requestId: data.id, error: data.error },
    );
  }

  /** A crashed worker is replaced on the next request; the request in flight fails. */
  private onCrash(worker: EngineWorkerLike): void {
    if (worker !== this.worker) {
      return;
    }
    this.discardWorker();
    if (this.waiting) {
      this.settle(this.waiting.id, {
        status: 'failure',
        requestId: this.waiting.id,
        error: WORKER_FAILED,
      });
    }
  }

  private discardWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  /** Resolves the latest request; outcomes for any other id are discarded. */
  private settle(id: number, outcome: EngineOutcome): void {
    if (!this.waiting || this.waiting.id !== id) {
      return;
    }
    const { resolve } = this.waiting;
    this.waiting = null;
    this.busy.set(false);
    resolve(outcome);
  }

  private supersede(): void {
    if (this.waiting) {
      const { id } = this.waiting;
      this.settle(id, { status: 'superseded', requestId: id });
    }
  }
}

/** Provides the real dedicated worker. */
export function provideEngineWorker() {
  return {
    provide: ENGINE_WORKER_FACTORY,
    useValue: (): EngineWorkerLike =>
      new Worker(new URL('./engine.worker', import.meta.url), { type: 'module' }),
  };
}
