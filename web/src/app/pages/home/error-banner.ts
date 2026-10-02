import { Component, computed, inject, input, output } from '@angular/core';

import { AppFailure, errorCopy } from '../../copy/error-copy';
import { CatalogueStore } from '../../state/catalogue-store';

/**
 * Error banner (DESIGN.md): what failed, what to do, and the recovery action. It sits above the
 * upload zone or the setup form, never replacing them. The buttons are native so they are keyboard
 * operable; the host decides what "Escolher outro ficheiro" opens.
 */
@Component({
  selector: 'app-error-banner',
  template: `
    <div class="error-banner" role="alert" data-testid="error-banner">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="var(--danger)" />
        <path d="M10 5v6m0 3v1" stroke="#fff" stroke-width="2" />
      </svg>
      <div>
        <h2>{{ copy().title }}</h2>
        <p>
          {{ copy().detail }}
          @if (copy().recovery === 'edit-settings') {
            Depois carregue em Calcular.
          }
        </p>
        @if (copy().recovery !== 'edit-settings') {
          <p class="actions">
            @if (copy().recovery === 'retry') {
              <button class="button secondary" type="button" (click)="retry.emit()">
                Tentar de novo
              </button>
            }
            <button class="button secondary" type="button" (click)="chooseFile.emit()">
              Escolher outro ficheiro
            </button>
          </p>
        }
      </div>
    </div>
  `,
})
export class ErrorBanner {
  private readonly catalogue = inject(CatalogueStore);

  readonly failure = input.required<AppFailure>();
  readonly retry = output<void>();
  readonly chooseFile = output<void>();

  protected readonly copy = computed(() => {
    const state = this.catalogue.state();
    const period = state.status === 'ready' ? state.catalogue.scope.catalogue_period : undefined;
    return errorCopy(this.failure(), { cataloguePeriod: period });
  });
}
