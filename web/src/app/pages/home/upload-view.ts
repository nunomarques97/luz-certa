import { Component, computed, inject, signal } from '@angular/core';

import { GUIDE_STEPS, PRIVACY_DETAIL, PRIVACY_TITLE } from '../../copy/upload-copy';
import { AnalysisStore } from '../../state/analysis-store';
import { ErrorBanner } from './error-banner';

/** Screen 1: the question, the upload zone, the privacy statement and the guide to the file. */
@Component({
  selector: 'app-upload-view',
  imports: [ErrorBanner],
  templateUrl: './upload-view.html',
})
export class UploadView {
  protected readonly store = inject(AnalysisStore);
  protected readonly steps = GUIDE_STEPS;
  protected readonly privacyTitle = PRIVACY_TITLE;
  protected readonly privacyDetail = PRIVACY_DETAIL;
  protected readonly dragOver = signal(false);
  protected readonly uploadError = computed(() => {
    const error = this.store.error();
    return error?.screen === 'upload' ? error : null;
  });

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clearing the value lets the user pick the same file again after fixing an error.
    input.value = '';
    if (file) {
      void this.store.selectFile(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.dragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget)) {
      this.dragOver.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.store.selectFile(file);
    }
  }

  protected retry(): void {
    void this.store.retry();
  }
}
