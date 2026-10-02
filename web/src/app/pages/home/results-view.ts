import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { eur, integer, kva, kwh } from '../../copy/format';
import { NOT_SPONSORED } from '../../copy/upload-copy';
import { AnalysisStore } from '../../state/analysis-store';
import { RankingRow, buildResultsModel, perYear } from '../../state/results-model';
import { MonthlySection } from './monthly-section';

/** Screen 4: the answer, the ranking, the monthly breakdown, assumptions and sources. */
@Component({
  selector: 'app-results-view',
  imports: [MonthlySection, RouterLink],
  templateUrl: './results-view.html',
})
export class ResultsView {
  protected readonly store = inject(AnalysisStore);
  protected readonly eur = eur;
  protected readonly kwh = kwh;
  protected readonly kva = kva;
  protected readonly integer = integer;
  protected readonly perYear = perYear;
  protected readonly notSponsored = NOT_SPONSORED;

  protected readonly result = computed(() => this.store.result());
  protected readonly model = computed(() => {
    const result = this.result();
    return result ? buildResultsModel(result.analysis, result.submission.settings) : null;
  });
  /** The next tariff after the current one, used when the current tariff is already the cheapest. */
  protected readonly runnerUp = computed(() => {
    const model = this.model();
    return model?.rows.find((row) => !row.isCurrent) ?? null;
  });

  protected deltaText(row: RankingRow): string {
    if (row.isCurrent) {
      return 'a sua tarifa';
    }
    if (row.delta === 'same') {
      return 'igual';
    }
    return `${eur(Math.abs(row.difference))} ${row.delta === 'cheaper' ? 'menos' : 'mais'}`;
  }

  protected pricingWord(row: RankingRow): string {
    return row.kind.startsWith('Indexada') ? 'indexada ao OMIE' : 'de preço fixo';
  }
}
