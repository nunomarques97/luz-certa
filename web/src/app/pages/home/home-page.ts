import { Component, inject } from '@angular/core';

import { AnalysisStore } from '../../state/analysis-store';
import { CatalogueStore } from '../../state/catalogue-store';
import { ProcessingView } from './processing-view';
import { ResultsView } from './results-view';
import { SetupView } from './setup-view';
import { UploadView } from './upload-view';

/** The analysis flow; the store decides which screen is shown. */
@Component({
  selector: 'app-home-page',
  imports: [UploadView, SetupView, ProcessingView, ResultsView],
  template: `
    @switch (store.view()) {
      @case ('upload') {
        <app-upload-view />
      }
      @case ('setup') {
        <app-setup-view />
      }
      @case ('processing') {
        <app-processing-view />
      }
      @case ('results') {
        <app-results-view />
      }
    }
  `,
})
export class HomePage {
  protected readonly store = inject(AnalysisStore);

  constructor() {
    // Load the offer list early so the setup form is ready when the file is.
    inject(CatalogueStore).ensureLoaded();
  }
}
