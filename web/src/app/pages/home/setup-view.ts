import { Component, ElementRef, computed, inject, signal } from '@angular/core';

import { cycleLabel, decimal, fileSize, kva, offerName, pricingLabel } from '../../copy/format';
import type { CycleId } from '../../engine/catalogue-model';
import { AnalysisStore } from '../../state/analysis-store';
import { CatalogueStore } from '../../state/catalogue-store';
import {
  SettingsDraft,
  SettingsField,
  powerOptions,
  toCostSettings,
} from '../../state/settings';
import { ErrorBanner } from './error-banner';

const FIELD_ORDER: SettingsField[] = [
  'contractedKva',
  'offerId',
  'energySimple',
  'energyOutOfEmpty',
  'energyEmpty',
  'power',
];

/** Screen 2: contracted power and current tariff (catalogue pick or manual prices). */
@Component({
  selector: 'app-setup-view',
  imports: [ErrorBanner],
  templateUrl: './setup-view.html',
})
export class SetupView {
  protected readonly store = inject(AnalysisStore);
  protected readonly catalogueStore = inject(CatalogueStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly draft = this.store.draft;
  protected readonly errors = signal<Partial<Record<SettingsField, string>>>({});
  protected readonly fileSize = fileSize;
  protected readonly decimal = decimal;
  protected readonly kva = kva;

  protected readonly catalogue = computed(() => {
    const state = this.catalogueStore.state();
    return state.status === 'ready' ? state.catalogue : null;
  });
  protected readonly powers = computed(() => {
    const catalogue = this.catalogue();
    return catalogue ? powerOptions(catalogue) : [];
  });
  protected readonly offers = computed(() =>
    (this.catalogue()?.offers ?? [])
      .map((offer) => ({
        id: offer.id,
        label: offerName(offer.supplier, offer.name),
        kind: `${pricingLabel(offer.pricing)}, ${cycleLabel(offer.tariff_type, offer.cycle)}.`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-PT')),
  );
  protected readonly selectedOffer = computed(() =>
    this.offers().find((offer) => offer.id === this.draft().offerId),
  );
  protected readonly setupError = computed(() => {
    const error = this.store.error();
    return error?.screen === 'setup' ? error : null;
  });

  constructor() {
    this.catalogueStore.ensureLoaded();
  }

  protected update(change: (draft: SettingsDraft) => SettingsDraft): void {
    this.draft.update(change);
  }

  protected setKva(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.update((d) => ({ ...d, contractedKva: value }));
    this.clearError('contractedKva');
  }

  protected setMode(mode: SettingsDraft['currentMode']): void {
    this.update((d) => ({ ...d, currentMode: mode }));
  }

  protected setOffer(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.update((d) => ({ ...d, offerId: value }));
    this.clearError('offerId');
  }

  protected setTariffType(tariffType: SettingsDraft['manual']['tariffType']): void {
    this.update((d) => ({ ...d, manual: { ...d.manual, tariffType } }));
  }

  protected setCycle(event: Event): void {
    const cycle = (event.target as HTMLSelectElement).value as CycleId;
    this.update((d) => ({ ...d, manual: { ...d.manual, cycle } }));
  }

  protected setPrice(
    field: 'energySimple' | 'energyOutOfEmpty' | 'energyEmpty' | 'power',
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    this.update((d) => ({ ...d, manual: { ...d.manual, [field]: value } }));
    this.clearError(field);
  }

  protected setLargeFamily(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.update((d) => ({ ...d, largeFamily: checked }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const result = toCostSettings(this.draft(), this.catalogue());
    if (!result.ok) {
      this.errors.set(result.errors);
      // Focus follows the user's own submit to the first field to correct.
      const first = FIELD_ORDER.find((field) => result.errors[field]);
      queueMicrotask(() =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus(),
      );
      return;
    }
    this.errors.set({});
    void this.store.submit(result.settings);
  }

  protected chooseAnotherFile(): void {
    this.store.startOver();
  }

  private clearError(field: SettingsField): void {
    if (this.errors()[field]) {
      this.errors.update((errors) => ({ ...errors, [field]: undefined }));
    }
  }
}
