import { Component, computed, inject } from '@angular/core';

import { fileSize, kva, offerName } from '../../copy/format';
import { AnalysisStore } from '../../state/analysis-store';
import { CatalogueStore } from '../../state/catalogue-store';

/**
 * Screen 3: the engine is working on the last submission. The status itself is announced by the
 * app's live region; this panel is static text. Cancel goes back to the form, and picking another
 * file starts over; both discard the run so its late result is never shown.
 */
@Component({
  selector: 'app-processing-view',
  template: `
    <div class="step-page">
      <section class="progress-panel" aria-labelledby="processing-title" data-testid="processing">
        <h1 id="processing-title">A calcular</h1>
        <p>
          Estamos a ler o ficheiro e a calcular o custo de cada tarifa neste navegador. Um ano de
          consumos demora poucos segundos.
        </p>
        <div class="progress-track" aria-hidden="true"><span></span></div>
        @if (store.submission(); as submission) {
          <dl class="summary-list">
            <dt>Ficheiro</dt>
            <dd>{{ submission.file.name }}, {{ fileSize(submission.file.size) }}</dd>
            <dt>Potência contratada</dt>
            <dd>{{ kva(submission.settings.contractedKva) }}</dd>
            <dt>Tarifa atual</dt>
            <dd>{{ currentLabel() }}</dd>
          </dl>
        }
        <p class="form-actions">
          <button class="button secondary" type="button" (click)="store.editSettings()">
            Cancelar e alterar dados
          </button>
          <button class="link-button" type="button" (click)="store.startOver()">
            Escolher outro ficheiro
          </button>
        </p>
      </section>
    </div>
  `,
})
export class ProcessingView {
  protected readonly store = inject(AnalysisStore);
  private readonly catalogueStore = inject(CatalogueStore);
  protected readonly fileSize = fileSize;
  protected readonly kva = kva;

  protected readonly currentLabel = computed(() => {
    const current = this.store.submission()?.settings.current;
    if (!current) {
      return '';
    }
    if (current.kind === 'manual') {
      return 'Preços que indicou';
    }
    const state = this.catalogueStore.state();
    const offer =
      state.status === 'ready'
        ? state.catalogue.offers.find((candidate) => candidate.id === current.offerId)
        : undefined;
    return offer ? offerName(offer.supplier, offer.name) : current.offerId;
  });
}
