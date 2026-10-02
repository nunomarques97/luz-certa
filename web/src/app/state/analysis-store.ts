import { Injectable, inject, signal } from '@angular/core';

import { AppFailure, errorCopy } from '../copy/error-copy';
import { eur, offerName } from '../copy/format';
import type { CostAnalysis, CostSettings } from '../engine/cost-engine';
import { MAX_FILE_BYTES } from '../engine/eredes-parser';
import { EngineClient } from '../worker/engine-client';
import { SettingsDraft, defaultDraft } from './settings';

export type View = 'upload' | 'setup' | 'processing' | 'results';

/** A file the user picked, read into memory. It never leaves the page and its worker. */
export interface SelectedFile {
  /** Changes with every pick, so the worker re-parses a new file with the same name. */
  id: number;
  name: string;
  size: number;
  bytes: ArrayBuffer;
}

/** What was sent to the engine: retry runs exactly this again. */
export interface Submission {
  file: SelectedFile;
  settings: CostSettings;
}

export interface AnalysisResult {
  analysis: CostAnalysis;
  submission: Submission;
}

export interface AnalysisError {
  failure: AppFailure;
  /** The screen that shows the banner: the upload zone or the setup form. */
  screen: 'upload' | 'setup';
}

/** Something a `File` from an input or a drop provides; tests pass plain objects. */
export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Owns the flow upload -> setup -> processing -> results and its asynchronous state.
 *
 * Ownership rules:
 * - Every file read and every engine run has a token; a completion whose token is not the latest is
 *   dropped, so an older success or failure can never replace a newer state.
 * - Starting a run, picking a file, going back or starting over clears the previous result and
 *   error first, so loading, error and result states never show stale results.
 * - Retry re-runs the last submitted file and settings, not unsubmitted edits.
 * - Announcements go to one polite live region; focus is never moved by the store.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisStore {
  private readonly engine = inject(EngineClient);
  private fileSeq = 0;
  private readToken = 0;
  private runToken = 0;

  private readonly viewState = signal<View>('upload');
  private readonly fileState = signal<SelectedFile | null>(null);
  private readonly readingState = signal(false);
  private readonly resultState = signal<AnalysisResult | null>(null);
  private readonly errorState = signal<AnalysisError | null>(null);
  private readonly lastSubmission = signal<Submission | null>(null);
  private readonly announcementState = signal('');

  readonly view = this.viewState.asReadonly();
  readonly file = this.fileState.asReadonly();
  readonly reading = this.readingState.asReadonly();
  readonly result = this.resultState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly submission = this.lastSubmission.asReadonly();
  /** Text of the polite live region. */
  readonly announcement = this.announcementState.asReadonly();
  /** The setup form, kept while the user moves between screens. */
  readonly draft = signal<SettingsDraft>(defaultDraft());

  /** Reads a picked or dropped file and opens the setup form. Any run in progress is discarded. */
  async selectFile(file: FileLike): Promise<void> {
    const token = ++this.readToken;
    this.discardRun();
    this.resultState.set(null);
    this.errorState.set(null);
    if (file.size > MAX_FILE_BYTES) {
      this.readingState.set(false);
      this.fileState.set(null);
      this.viewState.set('upload');
      this.fail({ kind: 'parse', code: 'FILE_TOO_LARGE', details: {} }, 'upload');
      return;
    }
    this.readingState.set(true);
    this.announce('A abrir o ficheiro.');
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      if (token === this.readToken) {
        this.readingState.set(false);
        this.fileState.set(null);
        this.viewState.set('upload');
        this.fail({ kind: 'file', code: 'FILE_UNREADABLE' }, 'upload');
      }
      return;
    }
    if (token !== this.readToken) {
      return;
    }
    this.readingState.set(false);
    this.fileState.set({ id: ++this.fileSeq, name: file.name, size: file.size, bytes });
    this.viewState.set('setup');
    this.announce('Ficheiro escolhido. Indique a potência contratada e a sua tarifa atual.');
  }

  /** Runs the engine with the selected file and these settings. */
  submit(settings: CostSettings): Promise<void> {
    const file = this.fileState();
    if (!file) {
      this.viewState.set('upload');
      return Promise.resolve();
    }
    const submission: Submission = { file, settings };
    this.lastSubmission.set(submission);
    return this.run(submission);
  }

  /** Runs the last submitted file and settings again. */
  retry(): Promise<void> {
    const submission = this.lastSubmission();
    if (!submission) {
      return Promise.resolve();
    }
    this.fileState.set(submission.file);
    return this.run(submission);
  }

  /** Back to the setup form; a run in progress is discarded and the old result is dropped. */
  editSettings(): void {
    const cancelled = this.discardRun();
    this.resultState.set(null);
    if (this.errorState()?.screen !== 'setup') {
      this.errorState.set(null);
    }
    this.viewState.set(this.fileState() ? 'setup' : 'upload');
    if (cancelled) {
      this.announce('Cálculo cancelado.');
    }
  }

  /** Back to the upload screen to pick another file. */
  startOver(): void {
    const cancelled = this.discardRun();
    this.readToken++;
    this.readingState.set(false);
    this.resultState.set(null);
    this.errorState.set(null);
    this.viewState.set('upload');
    if (cancelled) {
      this.announce('Cálculo cancelado.');
    }
  }

  private async run(submission: Submission): Promise<void> {
    const token = ++this.runToken;
    this.resultState.set(null);
    this.errorState.set(null);
    this.viewState.set('processing');
    this.announce('A calcular o custo de cada tarifa.');
    const outcome = await this.engine.analyse(
      submission.file.id,
      submission.file.bytes,
      submission.settings,
    );
    if (token !== this.runToken || outcome.status === 'superseded') {
      return;
    }
    if (outcome.status === 'success') {
      this.resultState.set({ analysis: outcome.result, submission });
      this.viewState.set('results');
      this.announce(resultAnnouncement(outcome.result));
      return;
    }
    const screen = errorScreen(outcome.error);
    this.viewState.set(screen);
    this.fail(outcome.error, screen);
  }

  /** Invalidates the current run; returns true when one was in progress. */
  private discardRun(): boolean {
    const running = this.viewState() === 'processing';
    this.runToken++;
    this.engine.cancel();
    return running;
  }

  private fail(failure: AppFailure, screen: AnalysisError['screen']): void {
    this.errorState.set({ failure, screen });
    this.announce(`Erro: ${errorCopy(failure).title}.`);
  }

  /** A repeated message gets a trailing no-break space toggled, so screen readers say it again. */
  private announce(text: string): void {
    const previous = this.announcementState();
    this.announcementState.set(previous === text ? `${text} ` : text);
  }
}

/** Settings problems are shown on the setup form, everything else above the upload zone. */
export function errorScreen(failure: AppFailure): AnalysisError['screen'] {
  return errorCopy(failure).recovery === 'edit-settings' ? 'setup' : 'upload';
}

function resultAnnouncement(analysis: CostAnalysis): string {
  const best = analysis.ranking[0];
  if (!best) {
    return 'Resultados prontos.';
  }
  const name = best.isCurrent ? 'a sua tarifa atual' : offerName(best.supplier, best.name);
  return `Resultados prontos. A tarifa mais barata é ${name}, com ${eur(best.total)}.`;
}
