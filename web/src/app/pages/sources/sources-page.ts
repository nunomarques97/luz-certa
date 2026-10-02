import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { unverifiedText } from '../../copy/assumption-copy';
import {
  cycleLabel,
  decimal,
  isoDateLong,
  isoDateShort,
  kva,
  offerName,
  percent,
  pricingLabel,
  safeHttpUrl,
  sourceHost,
} from '../../copy/format';
import { CatalogueStore } from '../../state/catalogue-store';

interface LinkCell {
  url: string | null;
  label: string;
}

function link(url: string | null): LinkCell {
  const safe = safeHttpUrl(url);
  return { url: safe, label: sourceHost(safe) || 'sem fonte' };
}

const FEE_BASIS: Record<string, string> = {
  per_kwh: '€/kWh',
  per_day: '€ por dia',
  per_month: '€ por mês',
};

/** Screen 5: how the costs are calculated and where every price comes from. */
@Component({
  selector: 'app-sources-page',
  imports: [RouterLink],
  templateUrl: './sources-page.html',
})
export class SourcesPage {
  protected readonly catalogueStore = inject(CatalogueStore);
  protected readonly isoDateLong = isoDateLong;

  protected readonly view = computed(() => {
    const state = this.catalogueStore.state();
    if (state.status !== 'ready') {
      return null;
    }
    const { catalogue, omie } = state;
    const offers = [...catalogue.offers]
      .sort((a, b) => offerName(a.supplier, a.name).localeCompare(offerName(b.supplier, b.name), 'pt-PT'))
      .map((offer) => ({
        id: offer.id,
        name: offerName(offer.supplier, offer.name),
        kind: `${pricingLabel(offer.pricing)}, ${cycleLabel(offer.tariff_type, offer.cycle)}`,
        source: link(offer.source_url),
        offerPage: offer.offer_url ? link(offer.offer_url) : null,
        verifiedOn: isoDateShort(offer.verified_on),
        unverified: offer.unverified.map((id) => ({ id, text: unverifiedText(id) })),
      }));
    const tar = catalogue.access_tariffs.map((period) => ({
      id: period.id,
      range: `${isoDateShort(period.valid_from)} a ${isoDateShort(period.valid_to)}`,
      source: link(period.source_url),
      verifiedOn: isoDateShort(period.verified_on),
    }));
    const vat = catalogue.taxes.vat;
    const vatRules = vat.rules.map((rule) => {
      const scope =
        rule.applies_to === 'energy'
          ? `energia até ${decimal(rule.kwh_per_30_days ?? 0)} kWh por 30 dias (${decimal(rule.kwh_per_30_days_large_family ?? rule.kwh_per_30_days ?? 0)} kWh em família numerosa)`
          : 'parte da potência que corresponde às tarifas de acesso';
      const end = rule.valid_to ? ` até ${isoDateLong(rule.valid_to)}` : '';
      return {
        text: `IVA a ${percent(rule.rate)} sobre a ${scope}, para potências até ${kva(rule.max_contracted_kva)}, desde ${isoDateLong(rule.valid_from)}${end}.`,
        source: link(rule.source_url),
      };
    });
    const fees = catalogue.taxes.fees.map((fee) => ({
      text: `${fee.name}: ${decimal(fee.amount_eur)} ${FEE_BASIS[fee.basis] ?? ''}, IVA a ${percent(fee.vat_rate)}.`,
      source: link(fee.source_url),
    }));
    return {
      version: catalogue.catalogue_version,
      period: catalogue.scope.catalogue_period,
      offers,
      tar,
      vatStandard: { text: `IVA à taxa normal de ${percent(vat.standard_rate)}.`, source: link(vat.source_url) },
      vatRules,
      fees,
      cycles: { source: link(catalogue.cycles.source_url), verifiedOn: isoDateShort(catalogue.cycles.verified_on) },
      omieText: omie
        ? `Preços do mercado diário do OMIE para Portugal, publicados em omie.es, de ${isoDateLong(omie.first_day)} a ${isoDateLong(omie.last_day)}. Atualizados todos os dias.`
        : 'Preços do mercado diário do OMIE para Portugal, publicados em omie.es. Atualizados todos os dias.',
      unverified: catalogue.unverified.map((entry) => ({ id: entry.id, text: unverifiedText(entry.id) })),
    };
  });

  constructor() {
    this.catalogueStore.ensureLoaded();
  }
}
