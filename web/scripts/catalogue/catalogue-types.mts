/**
 * Shape of web/public/data/catalogue.json, produced by `npm run catalogue:build` from the YAML
 * files in catalogue/. Every price excludes VAT. Dates are ISO calendar dates (YYYY-MM-DD) and
 * validity ranges are inclusive.
 *
 * The catalogue has no ranking, sponsorship or affiliate data: offers are sorted by id only.
 */

export const SCHEMA_VERSION = 1;

export type TariffType = 'simple' | 'bi_hourly';
export type CycleId = 'daily' | 'weekly';
export type Season = 'winter' | 'summer';
export type DayType = 'weekday' | 'saturday' | 'sunday';
export type Pricing = 'fixed' | 'omie_indexed';

/** Fields shared by every sourced entry. */
export interface Sourced {
  source_url: string;
  verified_on: string;
  /** Ids of entries in catalogue/UNVERIFIED.md that qualify this entry. */
  unverified: string[];
  notes: string[];
}

export interface Catalogue {
  schema_version: number;
  catalogue_version: string;
  currency: 'EUR';
  prices_include_vat: false;
  scope: {
    market: string;
    voltage_level: string;
    catalogue_period: { from: string; to: string };
  };
  cycles: CycleCatalogue;
  access_tariffs: AccessTariffPeriod[];
  taxes: Taxes;
  offers: Offer[];
  /** Headings of catalogue/UNVERIFIED.md, so the app can show what each id means. */
  unverified: { id: string; title: string }[];
}

/** [start, end) in Portugal legal time, "HH:MM"; end may be "24:00". */
export type TimeInterval = [string, string];

export interface CycleCatalogue extends Sourced {
  page_url: string | null;
  /** Bi-hourly "vazio" intervals per cycle, season and day type; the rest is "fora de vazio". */
  cycles: Record<CycleId, Record<Season, Record<DayType, { empty: TimeInterval[] }>>>;
}

export interface PowerPrice {
  kva: number;
  eur_day: number;
}

export interface AccessTariffPeriod extends Sourced {
  id: string;
  valid_from: string;
  valid_to: string;
  page_url: string | null;
  energy_eur_kwh: {
    simple: number;
    bi_hourly: { out_of_empty: number; empty: number };
  };
  power_eur_day: PowerPrice[];
}

export interface VatRule extends Sourced {
  id: string;
  description: string;
  applies_to: 'tar_power_term' | 'energy';
  rate: number;
  max_contracted_kva: number;
  /** Only for applies_to = energy: reduced-rate allowance per 30 days. */
  kwh_per_30_days: number | null;
  kwh_per_30_days_large_family: number | null;
  valid_from: string;
  valid_to: string | null;
  legal_reference: string;
}

export interface Fee extends Sourced {
  id: 'iec' | 'dgeg' | 'audiovisual_contribution';
  name: string;
  basis: 'per_kwh' | 'per_day' | 'per_month';
  amount_eur: number;
  vat_rate: number;
  vat_source_url: string;
}

export interface Taxes {
  vat: Sourced & { standard_rate: number; legal_reference: string; rules: VatRule[] };
  fees: Fee[];
}

export type EnergyPrices = { simple: number } | { out_of_empty: number; empty: number };

export interface OfferPrice {
  kva: number;
  power_eur_day: number;
  /** Present for fixed offers only; indexed offers price energy through `formula`. */
  energy_eur_kwh: EnergyPrices | null;
}

export interface LossFactor {
  basis: 'erse_loss_profile' | 'fixed' | 'supplier_table';
  /** Fraction (0.15 = 15 %); null when the supplier does not publish it. */
  value: number | null;
  value_kind: 'published' | 'indicative_average' | 'unpublished';
  source_url: string;
}

/**
 * Energy price in EUR/kWh for an OMIE price P (EUR/MWh):
 * ((P + k_eur_mwh) x (1 + loss_factor.value) x multiplier + adder_eur_mwh) / 1000,
 * plus the TAR energy price for the consumption date when includes_tar is true,
 * plus every extra fee.
 */
export interface IndexedFormula {
  type: 'omie_indexed';
  /**
   * market_period: each OMIE market period price (hourly before 2025-10-01, quarter-hourly after).
   * billing_period_mean: mean OMIE price over the billing period.
   * billing_period_mean_by_tariff_period: mean OMIE price per tariff period over the billing period.
   */
  omie_averaging: 'market_period' | 'billing_period_mean' | 'billing_period_mean_by_tariff_period';
  /** Added to the OMIE price before losses. */
  k_eur_mwh: number;
  loss_factor: LossFactor;
  /** Applied after losses (EDP's K1, for example). */
  multiplier: number;
  /** Added after losses and multiplier; equals the sum of adder_components. */
  adder_eur_mwh: number;
  adder_components: { id: string; eur_mwh: number }[];
  includes_tar: true;
  extra_fees: { id: string; label: string; eur_kwh: number; source_url: string }[];
  /** Published bill components without a published value; not priced. */
  unpriced_components: { id: string; label: string }[];
}

export interface Offer extends Sourced {
  id: string;
  supplier: string;
  name: string;
  pricing: Pricing;
  tariff_type: TariffType;
  /** ERSE cycle for bi-hourly offers, null for simple ones. */
  cycle: CycleId | null;
  erse_offer_code: string | null;
  offer_url: string | null;
  additional_sources: string[];
  conditions: string[];
  prices: OfferPrice[];
  /** Indexed offers whose power price is a margin over the TAR power term in force each day. */
  power_formula: { type: 'tar_plus_margin'; margin_eur_day: number } | null;
  formula: IndexedFormula | null;
}
