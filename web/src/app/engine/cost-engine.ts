import {
  AccessTariffPeriod,
  Catalogue,
  CycleId,
  DayType,
  Fee,
  IndexedFormula,
  Offer,
  Season,
  TariffType,
  VatRule,
} from './catalogue-model';
import { EngineError } from './engine-errors';
import { MissingRange, ParsedConsumption } from './eredes-parser';
import { QUARTER_HOUR_MS, lisbonOffsetMinutes, toLisbonLocal } from './lisbon-time';
import { OmiePriceLookup } from './omie-time';

/**
 * Cost engine: what each tariff would have cost over the exact period of a consumption file.
 *
 * Pure TypeScript with no DOM access, so it runs inside a Web Worker. Every price in the catalogue
 * excludes VAT; VAT and fees are added per catalogue rules. Missing readings and missing OMIE
 * prices are counted and reported, never filled in.
 */

export const SUPPORTED_CATALOGUE_SCHEMA = 1;
/** Id of the user's manually entered current tariff in results. */
export const MANUAL_TARIFF_ID = 'manual';
/** First OMIE market day with quarter-hourly prices; earlier days are hourly. */
export const OMIE_QUARTER_HOUR_FROM = '2025-10-01';
/** Plausible upper bounds for manually entered prices (EUR/kWh and EUR/day, VAT excluded). */
export const MAX_MANUAL_ENERGY_EUR_KWH = 2;
export const MAX_MANUAL_POWER_EUR_DAY = 10;

export type ManualTariff =
  | { tariffType: 'simple'; energyEurKwh: { simple: number }; powerEurDay: number }
  | {
      tariffType: 'bi_hourly';
      cycle: CycleId;
      energyEurKwh: { out_of_empty: number; empty: number };
      powerEurDay: number;
    };

export type CurrentTariff =
  { kind: 'offer'; offerId: string } | { kind: 'manual'; tariff: ManualTariff };

export interface CostSettings {
  /** Contracted power in kVA, one of the standard BTN values. */
  contractedKva: number;
  current: CurrentTariff;
  /** Large family (five or more people): higher reduced-VAT energy allowance. */
  largeFamily: boolean;
}

export interface EngineData {
  catalogue: Catalogue;
  omie: OmiePriceLookup;
}

export const ASSUMPTION_CODES = [
  /** Costs are grouped by Lisbon calendar month; a month is one billing period. */
  'BILLING_PERIOD_CALENDAR_MONTH',
  /** Days only partly covered by the file count pro rata for daily and monthly terms. */
  'PARTIAL_DAYS_PRO_RATA',
  /** Fixed offers: current catalogue prices applied to past consumption. */
  'FIXED_PRICES_CURRENT',
  /** Indexed offers: historical OMIE prices and the access tariffs (TAR) in force on each date. */
  'INDEXED_HISTORICAL_OMIE_TAR',
  /** OMIE prices are published in Spanish time; Lisbon time is one hour behind. */
  'OMIE_SPAIN_TIME',
  /** Before the switch date OMIE prices are hourly and apply to the four quarter-hours of the hour. */
  'OMIE_HOURLY_BEFORE_SWITCH',
  /** Some quarter-hours have no OMIE price; their energy is not priced. */
  'MISSING_OMIE_PRICES',
  /** Quarter-hours without a reading are not filled in. */
  'MISSING_CONSUMPTION_NOT_FILLED',
  /** Readings marked as estimated by E-Redes are used as they are. */
  'ESTIMATED_READINGS_USED',
  /** Repeated readings: the first one is kept. */
  'DUPLICATE_READINGS_FIRST_KEPT',
  'VAT_STANDARD_RATE',
  /** Reduced VAT on the TAR part of the power term, using the TAR in force each day. */
  'VAT_REDUCED_TAR_POWER',
  /** Reduced VAT on energy up to an allowance per 30 days, pro rata by days, shared across tariff periods. */
  'VAT_REDUCED_ENERGY',
  /** The reduced energy VAT rule is not applied before its start date. */
  'VAT_REDUCED_ENERGY_NOT_BEFORE',
  /** Current IEC, DGEG and audiovisual contribution amounts for the whole period, no exemption. */
  'FEES_CURRENT_AMOUNTS',
  /** Current ERSE cycle hours applied to the whole period. */
  'CYCLE_HOURS_CURRENT',
  /** Public holidays are treated like any other day of the week. */
  'PUBLIC_HOLIDAYS_AS_WEEKDAYS',
  /** The period is not a whole year: an annualised value is shown next to the period cost. */
  'ANNUALISED',
  /** Manually entered prices are read as VAT excluded and including the access tariffs. */
  'MANUAL_PRICES_EXCLUDE_VAT',
  /** Indexed offer: indicative average loss factor. */
  'LOSS_FACTOR_INDICATIVE',
  /** Indexed offer: loss factor not published, computed without losses (cost understated). */
  'LOSS_FACTOR_UNPUBLISHED',
  /** Indexed offer: published bill components without a published value are not priced. */
  'UNPRICED_COMPONENTS',
  /** Indexed offer: arithmetic mean of OMIE prices over each calendar month. */
  'OMIE_BILLING_PERIOD_MEAN',
  /** Indexed offer: arithmetic mean of OMIE prices per tariff period over each calendar month. */
  'OMIE_BILLING_PERIOD_MEAN_BY_TARIFF_PERIOD',
  /** Indexed offer: power price = TAR power term in force each day plus a fixed margin. */
  'POWER_TAR_PLUS_MARGIN',
  /** Indexed offer: current power price applied to past days. */
  'POWER_PRICE_CURRENT',
  /** Indexed offer: current extra fees per kWh applied to the whole period. */
  'EXTRA_FEES_CURRENT',
] as const;

export type AssumptionCode = (typeof ASSUMPTION_CODES)[number];

export interface Assumption {
  code: AssumptionCode;
  /** Tariffs the assumption applies to; empty when it applies to every tariff. */
  tariffIds: string[];
  values: Record<string, string | number>;
}

export interface MonthCost {
  /** Lisbon calendar month, YYYY-MM. */
  month: string;
  /** Days of the month covered by the file (fractional for partly covered days). */
  days: number;
  kwh: number;
  /** Amounts in EUR rounded to cents. Energy, power and fees exclude VAT. */
  energy: number;
  power: number;
  fees: number;
  vat: number;
  /** Rounded month total; the period total is the sum of the month totals. */
  total: number;
}

export interface TariffCost {
  id: string;
  supplier: string | null;
  name: string | null;
  source: 'catalogue' | 'manual';
  pricing: 'fixed' | 'omie_indexed';
  tariffType: TariffType;
  cycle: CycleId | null;
  sourceUrl: string | null;
  offerUrl: string | null;
  verifiedOn: string | null;
  /** Ids of catalogue/UNVERIFIED.md entries that qualify this offer. */
  unverified: string[];
  /** 1-based position by cost over the period (ties ordered by id). */
  rank: number;
  isCurrent: boolean;
  /** Cost over the file's period, VAT and fees included (EUR). */
  total: number;
  /** total x 365 / period days when the period is not a whole year, otherwise null. */
  annualised: number | null;
  /** total minus the current tariff's total; negative means cheaper than the current tariff. */
  differenceVsCurrent: number;
  breakdown: { energy: number; power: number; fees: number; vat: number };
  months: MonthCost[];
  /** kWh per bi-hourly period; null for simple tariffs. */
  kwhByPeriod: { empty: number; outOfEmpty: number } | null;
  /** Quarter-hours with a reading whose energy could not be priced (no OMIE price). */
  unpricedQuarterHours: number;
  unpricedKwh: number;
  /** True when the cost leaves out known components, so the real bill would be higher. */
  understated: boolean;
}

export interface UnavailableTariff {
  id: string;
  supplier: string;
  name: string;
  reason: 'POWER_NOT_OFFERED';
}

export interface CostAnalysis {
  catalogueVersion: string;
  contractedKva: number;
  largeFamily: boolean;
  period: {
    start: string;
    end: string;
    startUtc: number;
    endUtc: number;
    /** Covered days (fractional for partly covered days). */
    days: number;
    /** True when the period is not 365 or 366 days and annualised values are given. */
    annualised: boolean;
  };
  consumption: {
    totalKwh: number;
    intervalCount: number;
    expectedIntervalCount: number;
    missingIntervals: number;
    missingRanges: MissingRange[];
    estimatedIntervals: number;
    duplicates: number;
  };
  /** Quarter-hours of the period without an OMIE price. */
  omieQuarterHoursWithoutPrice: number;
  currentId: string;
  /** Every computed tariff, cheapest first. The current tariff is included and flagged. */
  ranking: TariffCost[];
  unavailable: UnavailableTariff[];
  assumptions: Assumption[];
}

// ---------------------------------------------------------------------------
// Timeline: one slot per quarter-hour of the period
// ---------------------------------------------------------------------------

const EMPTY = 1;

interface DayInfo {
  date: string;
  month: number;
  /** Covered share of the local day (1 for a full day, 92 or 100 quarter-hours on clock-change days). */
  fraction: number;
  covered: number;
  quarters: number;
  dayType: DayType;
  tar: AccessTariffPeriod;
}

interface MonthInfo {
  key: string;
  daysInMonth: number;
  days: number;
  kwh: number;
}

interface Timeline {
  count: number;
  /** kWh per quarter-hour, NaN without a reading. */
  kwh: Float64Array;
  day: Int32Array;
  month: Int32Array;
  /** 1 = vazio, 0 = fora de vazio, per ERSE cycle. */
  cycleClass: Record<CycleId, Uint8Array>;
  /** OMIE EUR/MWh, NaN without a price. */
  omie: Float64Array;
  omieMissing: number;
  days: DayInfo[];
  months: MonthInfo[];
}

type MinuteRanges = [number, number][];
type CycleTable = Record<CycleId, Record<Season, Record<DayType, MinuteRanges>>>;

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function compileCycles(catalogue: Catalogue): CycleTable {
  const table = {} as CycleTable;
  for (const cycle of ['daily', 'weekly'] as const) {
    table[cycle] = {} as Record<Season, Record<DayType, MinuteRanges>>;
    for (const season of ['winter', 'summer'] as const) {
      table[cycle][season] = {} as Record<DayType, MinuteRanges>;
      for (const dayType of ['weekday', 'saturday', 'sunday'] as const) {
        table[cycle][season][dayType] = catalogue.cycles.cycles[cycle][season][dayType].empty.map(
          ([from, to]) => [toMinutes(from), toMinutes(to)] as [number, number],
        );
      }
    }
  }
  return table;
}

function inRanges(ranges: MinuteRanges, minute: number): boolean {
  for (const [from, to] of ranges) {
    if (minute >= from && minute < to) {
      return true;
    }
  }
  return false;
}

function dateWallMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** UTC instant of Lisbon midnight; midnight is never inside a clock change. */
function lisbonMidnightUtc(date: string): number {
  const wall = dateWallMs(date);
  return lisbonOffsetMinutes(wall) === 60 ? wall - 3_600_000 : wall;
}

function quartersInLisbonDay(date: string): number {
  const next = new Date(dateWallMs(date) + 86_400_000).toISOString().slice(0, 10);
  return (lisbonMidnightUtc(next) - lisbonMidnightUtc(date)) / QUARTER_HOUR_MS;
}

function dayTypeOf(date: string): DayType {
  const weekday = new Date(dateWallMs(date)).getUTCDay();
  return weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday';
}

function daysInMonth(monthKey: string): number {
  return new Date(
    Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0),
  ).getUTCDate();
}

function findTar(catalogue: Catalogue, date: string): AccessTariffPeriod {
  const tar = catalogue.access_tariffs.find(
    (period) => period.valid_from <= date && date <= period.valid_to,
  );
  if (!tar) {
    throw new EngineError('PERIOD_OUTSIDE_CATALOGUE');
  }
  return tar;
}

function buildTimeline(consumption: ParsedConsumption, data: EngineData): Timeline {
  const { periodStartUtc: start, periodEndUtc: end } = consumption.metadata;
  const count = Math.round((end - start) / QUARTER_HOUR_MS);
  const kwh = new Float64Array(count).fill(Number.NaN);
  for (const interval of consumption.intervals) {
    kwh[(interval.startUtc - start) / QUARTER_HOUR_MS] = interval.kwh;
  }

  const cycles = compileCycles(data.catalogue);
  const timeline: Timeline = {
    count,
    kwh,
    day: new Int32Array(count),
    month: new Int32Array(count),
    cycleClass: { daily: new Uint8Array(count), weekly: new Uint8Array(count) },
    omie: new Float64Array(count),
    omieMissing: 0,
    days: [],
    months: [],
  };
  const dayIndex = new Map<string, number>();
  const monthIndex = new Map<string, number>();

  for (let q = 0; q < count; q++) {
    const utc = start + q * QUARTER_HOUR_MS;
    const local = toLisbonLocal(utc);
    let d = dayIndex.get(local.date);
    if (d === undefined) {
      const monthKey = local.date.slice(0, 7);
      let m = monthIndex.get(monthKey);
      if (m === undefined) {
        m = timeline.months.length;
        monthIndex.set(monthKey, m);
        timeline.months.push({
          key: monthKey,
          daysInMonth: daysInMonth(monthKey),
          days: 0,
          kwh: 0,
        });
      }
      d = timeline.days.length;
      dayIndex.set(local.date, d);
      timeline.days.push({
        date: local.date,
        month: m,
        fraction: 0,
        covered: 0,
        quarters: quartersInLisbonDay(local.date),
        dayType: dayTypeOf(local.date),
        tar: findTar(data.catalogue, local.date),
      });
    }
    const day = timeline.days[d];
    day.covered++;
    timeline.day[q] = d;
    timeline.month[q] = day.month;

    const season: Season = local.offsetMinutes === 60 ? 'summer' : 'winter';
    timeline.cycleClass.daily[q] = inRanges(cycles.daily[season][day.dayType], local.minuteOfDay)
      ? EMPTY
      : 0;
    timeline.cycleClass.weekly[q] = inRanges(cycles.weekly[season][day.dayType], local.minuteOfDay)
      ? EMPTY
      : 0;

    const price = data.omie.priceAt(utc);
    timeline.omie[q] = price ?? Number.NaN;
    if (price === undefined) {
      timeline.omieMissing++;
    }
    if (!Number.isNaN(kwh[q])) {
      timeline.months[day.month].kwh += kwh[q];
    }
  }

  for (const day of timeline.days) {
    day.fraction = day.covered / day.quarters;
    timeline.months[day.month].days += day.fraction;
  }
  return timeline;
}

// ---------------------------------------------------------------------------
// Tariff price models
// ---------------------------------------------------------------------------

interface TariffModel {
  meta: Omit<
    TariffCost,
    | 'rank'
    | 'isCurrent'
    | 'total'
    | 'annualised'
    | 'differenceVsCurrent'
    | 'breakdown'
    | 'months'
    | 'kwhByPeriod'
    | 'unpricedQuarterHours'
    | 'unpricedKwh'
  >;
  /** Energy price in EUR/kWh (VAT excluded) for quarter-hour q, NaN when it cannot be priced. */
  energyPrice(q: number): number;
  /** Power term in EUR/day (VAT excluded) for a day. */
  powerPerDay(day: DayInfo): number;
}

function tarPower(tar: AccessTariffPeriod, kva: number): number {
  const row = tar.power_eur_day.find((price) => price.kva === kva);
  if (!row) {
    throw new EngineError('UNSUPPORTED_POWER');
  }
  return row.eur_day;
}

function fixedEnergy(
  tariffType: TariffType,
  cycle: CycleId | null,
  prices: { simple: number } | { out_of_empty: number; empty: number },
  timeline: Timeline,
): (q: number) => number {
  if (tariffType === 'simple' && 'simple' in prices) {
    const price = prices.simple;
    return () => price;
  }
  if (tariffType === 'bi_hourly' && 'empty' in prices && cycle) {
    const classes = timeline.cycleClass[cycle];
    const { empty, out_of_empty } = prices;
    return (q) => (classes[q] === EMPTY ? empty : out_of_empty);
  }
  throw new EngineError('UNSUPPORTED_CATALOGUE');
}

/** Time-weighted mean OMIE price per month and tariff class, ignoring quarter-hours without a price. */
function omieMeans(timeline: Timeline, classes: Uint8Array | null): Float64Array {
  const sums = new Float64Array(timeline.months.length * 2);
  const counts = new Float64Array(timeline.months.length * 2);
  for (let q = 0; q < timeline.count; q++) {
    const price = timeline.omie[q];
    if (!Number.isNaN(price)) {
      const slot = timeline.month[q] * 2 + (classes ? classes[q] : 0);
      sums[slot] += price;
      counts[slot]++;
    }
  }
  return sums.map((sum, slot) => (counts[slot] > 0 ? sum / counts[slot] : Number.NaN));
}

function indexedEnergy(
  offer: Offer,
  formula: IndexedFormula,
  timeline: Timeline,
): (q: number) => number {
  const classes =
    offer.tariff_type === 'bi_hourly' && offer.cycle ? timeline.cycleClass[offer.cycle] : null;
  if (offer.tariff_type === 'bi_hourly' && !classes) {
    throw new EngineError('UNSUPPORTED_CATALOGUE');
  }
  const loss = formula.loss_factor.value ?? 0;
  const factor = (1 + loss) * formula.multiplier;
  const fees = formula.extra_fees.reduce((sum, fee) => sum + fee.eur_kwh, 0);
  const tarEnergy = (q: number): number => {
    const energy = timeline.days[timeline.day[q]].tar.energy_eur_kwh;
    if (!classes) {
      return energy.simple;
    }
    return classes[q] === EMPTY ? energy.bi_hourly.empty : energy.bi_hourly.out_of_empty;
  };
  const price = (omie: number, q: number): number =>
    ((omie + formula.k_eur_mwh) * factor + formula.adder_eur_mwh) / 1000 + tarEnergy(q) + fees;

  switch (formula.omie_averaging) {
    case 'market_period':
      return (q) => price(timeline.omie[q], q);
    case 'billing_period_mean': {
      const means = omieMeans(timeline, null);
      return (q) => price(means[timeline.month[q] * 2], q);
    }
    case 'billing_period_mean_by_tariff_period': {
      const means = omieMeans(timeline, classes);
      return (q) => price(means[timeline.month[q] * 2 + (classes ? classes[q] : 0)], q);
    }
  }
}

function offerModel(offer: Offer, kva: number, timeline: Timeline): TariffModel | null {
  const row = offer.prices.find((price) => price.kva === kva);
  if (!row) {
    return null;
  }
  const formula = offer.formula;
  const understated =
    formula !== null &&
    (formula.loss_factor.value === null || formula.unpriced_components.length > 0);
  const meta: TariffModel['meta'] = {
    id: offer.id,
    supplier: offer.supplier,
    name: offer.name,
    source: 'catalogue',
    pricing: offer.pricing,
    tariffType: offer.tariff_type,
    cycle: offer.cycle,
    sourceUrl: offer.source_url,
    offerUrl: offer.offer_url,
    verifiedOn: offer.verified_on,
    unverified: [...offer.unverified],
    understated,
  };

  let energyPrice: (q: number) => number;
  if (offer.pricing === 'fixed') {
    if (!row.energy_eur_kwh) {
      throw new EngineError('UNSUPPORTED_CATALOGUE');
    }
    energyPrice = fixedEnergy(offer.tariff_type, offer.cycle, row.energy_eur_kwh, timeline);
  } else {
    if (!formula) {
      throw new EngineError('UNSUPPORTED_CATALOGUE');
    }
    energyPrice = indexedEnergy(offer, formula, timeline);
  }

  const powerFormula = offer.power_formula;
  const powerPerDay = powerFormula
    ? (day: DayInfo) => tarPower(day.tar, kva) + powerFormula.margin_eur_day
    : () => row.power_eur_day;
  return { meta, energyPrice, powerPerDay };
}

function isValidPrice(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function manualModel(tariff: ManualTariff, timeline: Timeline): TariffModel {
  const valid =
    typeof tariff === 'object' &&
    tariff !== null &&
    isValidPrice(tariff.powerEurDay, MAX_MANUAL_POWER_EUR_DAY) &&
    (tariff.tariffType === 'simple'
      ? isValidPrice(tariff.energyEurKwh?.simple, MAX_MANUAL_ENERGY_EUR_KWH)
      : tariff.tariffType === 'bi_hourly' &&
        (tariff.cycle === 'daily' || tariff.cycle === 'weekly') &&
        isValidPrice(tariff.energyEurKwh?.empty, MAX_MANUAL_ENERGY_EUR_KWH) &&
        isValidPrice(tariff.energyEurKwh?.out_of_empty, MAX_MANUAL_ENERGY_EUR_KWH));
  if (!valid) {
    throw new EngineError('INVALID_MANUAL_PRICES');
  }
  const cycle = tariff.tariffType === 'bi_hourly' ? tariff.cycle : null;
  const power = tariff.powerEurDay;
  return {
    meta: {
      id: MANUAL_TARIFF_ID,
      supplier: null,
      name: null,
      source: 'manual',
      pricing: 'fixed',
      tariffType: tariff.tariffType,
      cycle,
      sourceUrl: null,
      offerUrl: null,
      verifiedOn: null,
      unverified: [],
      understated: false,
    },
    energyPrice: fixedEnergy(tariff.tariffType, cycle, tariff.energyEurKwh, timeline),
    powerPerDay: () => power,
  };
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

interface TaxContext {
  standardRate: number;
  energyRules: VatRule[];
  powerRules: VatRule[];
  /** Per day: index into energyRules of the reduced energy rule in force, or -1. */
  dayEnergyRule: Int32Array;
  /** Per day: reduced rate on the TAR power part, or -1. */
  dayPowerRate: Float64Array;
  fees: Fee[];
  allowanceKey: 'kwh_per_30_days' | 'kwh_per_30_days_large_family';
}

function ruleInForce(rule: VatRule, date: string, kva: number): boolean {
  return (
    rule.valid_from <= date &&
    (rule.valid_to === null || date <= rule.valid_to) &&
    kva <= rule.max_contracted_kva
  );
}

function taxContext(catalogue: Catalogue, timeline: Timeline, settings: CostSettings): TaxContext {
  const vat = catalogue.taxes.vat;
  const energyRules = vat.rules.filter((rule) => rule.applies_to === 'energy');
  const powerRules = vat.rules.filter((rule) => rule.applies_to === 'tar_power_term');
  const dayEnergyRule = new Int32Array(timeline.days.length).fill(-1);
  const dayPowerRate = new Float64Array(timeline.days.length).fill(-1);
  timeline.days.forEach((day, d) => {
    dayEnergyRule[d] = energyRules.findIndex((rule) =>
      ruleInForce(rule, day.date, settings.contractedKva),
    );
    const powerRule = powerRules.find((rule) =>
      ruleInForce(rule, day.date, settings.contractedKva),
    );
    dayPowerRate[d] = powerRule ? powerRule.rate : -1;
  });
  return {
    standardRate: vat.standard_rate,
    energyRules,
    powerRules,
    dayEnergyRule,
    dayPowerRate,
    fees: catalogue.taxes.fees,
    allowanceKey: settings.largeFamily ? 'kwh_per_30_days_large_family' : 'kwh_per_30_days',
  };
}

function cents(value: number): number {
  return Math.round(value * 100);
}

interface CostedTariff {
  model: TariffModel;
  totalCents: number;
  months: MonthCost[];
  breakdown: TariffCost['breakdown'];
  kwhByPeriod: TariffCost['kwhByPeriod'];
  unpricedQuarterHours: number;
  unpricedKwh: number;
}

function costTariff(
  model: TariffModel,
  timeline: Timeline,
  tax: TaxContext,
  kva: number,
): CostedTariff {
  const monthCount = timeline.months.length;
  const ruleCount = tax.energyRules.length;
  const energy = new Float64Array(monthCount);
  const eligibleCost = new Float64Array(monthCount * Math.max(ruleCount, 1));
  const eligibleKwh = new Float64Array(monthCount * Math.max(ruleCount, 1));
  const eligibleDays = new Float64Array(monthCount * Math.max(ruleCount, 1));
  const power = new Float64Array(monthCount);
  const reducedPowerVat = new Float64Array(monthCount);
  const powerVatBase = new Float64Array(monthCount);
  const classes =
    model.meta.tariffType === 'bi_hourly' && model.meta.cycle
      ? timeline.cycleClass[model.meta.cycle]
      : null;
  let emptyKwh = 0;
  let outOfEmptyKwh = 0;
  let unpricedQuarterHours = 0;
  let unpricedKwh = 0;

  for (let q = 0; q < timeline.count; q++) {
    const kwh = timeline.kwh[q];
    if (Number.isNaN(kwh)) {
      continue;
    }
    if (classes) {
      if (classes[q] === EMPTY) {
        emptyKwh += kwh;
      } else {
        outOfEmptyKwh += kwh;
      }
    }
    const m = timeline.month[q];
    const rule = tax.dayEnergyRule[timeline.day[q]];
    if (rule >= 0) {
      eligibleKwh[m * ruleCount + rule] += kwh;
    }
    const price = model.energyPrice(q);
    if (Number.isNaN(price)) {
      unpricedQuarterHours++;
      unpricedKwh += kwh;
      continue;
    }
    energy[m] += kwh * price;
    if (rule >= 0) {
      eligibleCost[m * ruleCount + rule] += kwh * price;
    }
  }

  timeline.days.forEach((day, d) => {
    const dayPower = model.powerPerDay(day) * day.fraction;
    power[day.month] += dayPower;
    const reducedRate = tax.dayPowerRate[d];
    if (reducedRate >= 0) {
      // The reduced rate covers only the TAR part of the power term (never more than the term itself).
      const tarPart = Math.min(tarPower(day.tar, kva) * day.fraction, dayPower);
      reducedPowerVat[day.month] += tarPart * reducedRate;
      powerVatBase[day.month] += dayPower - tarPart;
    } else {
      powerVatBase[day.month] += dayPower;
    }
    const rule = tax.dayEnergyRule[d];
    if (rule >= 0) {
      eligibleDays[day.month * ruleCount + rule] += day.fraction;
    }
  });

  const months: MonthCost[] = [];
  const sums = { energy: 0, power: 0, fees: 0, vat: 0, total: 0 };
  timeline.months.forEach((month, m) => {
    let energyVat = energy[m] * tax.standardRate;
    tax.energyRules.forEach((rule, r) => {
      const slot = m * ruleCount + r;
      if (eligibleKwh[slot] <= 0) {
        return;
      }
      const allowance =
        ((rule[tax.allowanceKey] ?? rule.kwh_per_30_days ?? 0) * eligibleDays[slot]) / 30;
      const reducedBase = eligibleCost[slot] * Math.min(1, allowance / eligibleKwh[slot]);
      energyVat -= reducedBase * (tax.standardRate - rule.rate);
    });
    const powerVat = powerVatBase[m] * tax.standardRate + reducedPowerVat[m];

    let fees = 0;
    let feesVat = 0;
    for (const fee of tax.fees) {
      const amount =
        fee.basis === 'per_kwh'
          ? fee.amount_eur * month.kwh
          : fee.basis === 'per_day'
            ? fee.amount_eur * month.days
            : (fee.amount_eur * month.days) / month.daysInMonth;
      fees += amount;
      feesVat += amount * fee.vat_rate;
    }

    const vat = energyVat + powerVat + feesVat;
    const cost: MonthCost = {
      month: month.key,
      days: month.days,
      kwh: month.kwh,
      energy: cents(energy[m]) / 100,
      power: cents(power[m]) / 100,
      fees: cents(fees) / 100,
      vat: cents(vat) / 100,
      total: cents(energy[m] + power[m] + fees + vat) / 100,
    };
    sums.energy += cents(energy[m]);
    sums.power += cents(power[m]);
    sums.fees += cents(fees);
    sums.vat += cents(vat);
    sums.total += cents(cost.total);
    months.push(cost);
  });

  return {
    model,
    totalCents: sums.total,
    months,
    breakdown: {
      energy: sums.energy / 100,
      power: sums.power / 100,
      fees: sums.fees / 100,
      vat: sums.vat / 100,
    },
    kwhByPeriod: classes ? { empty: emptyKwh, outOfEmpty: outOfEmptyKwh } : null,
    unpricedQuarterHours,
    unpricedKwh,
  };
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

function collectAssumptions(
  data: EngineData,
  consumption: ParsedConsumption,
  timeline: Timeline,
  tax: TaxContext,
  costed: CostedTariff[],
  settings: CostSettings,
  annualised: boolean,
  periodDays: number,
): Assumption[] {
  const list: Assumption[] = [];
  const add = (
    code: AssumptionCode,
    tariffIds: string[] = [],
    values: Assumption['values'] = {},
  ): void => {
    list.push({ code, tariffIds, values });
  };
  const models = costed.map((tariff) => tariff.model);
  const offersById = new Map(data.catalogue.offers.map((offer) => [offer.id, offer]));
  const offerOf = (model: TariffModel): Offer | undefined => offersById.get(model.meta.id);
  const idsWhere = (
    predicate: (model: TariffModel, offer: Offer | undefined) => boolean,
  ): string[] =>
    models.filter((model) => predicate(model, offerOf(model))).map((model) => model.meta.id);

  const metadata = consumption.metadata;
  const indexedIds = idsWhere((model) => model.meta.pricing === 'omie_indexed');
  const fixedIds = idsWhere(
    (model) => model.meta.source === 'catalogue' && model.meta.pricing === 'fixed',
  );
  const firstDate = timeline.days[0].date;

  add('BILLING_PERIOD_CALENDAR_MONTH');
  if (timeline.days.some((day) => day.fraction < 1)) {
    add('PARTIAL_DAYS_PRO_RATA');
  }
  if (fixedIds.length > 0) {
    add('FIXED_PRICES_CURRENT', fixedIds, { catalogueVersion: data.catalogue.catalogue_version });
  }
  if (indexedIds.length > 0) {
    add('INDEXED_HISTORICAL_OMIE_TAR', indexedIds);
    add('OMIE_SPAIN_TIME', indexedIds);
    if (firstDate < OMIE_QUARTER_HOUR_FROM) {
      add('OMIE_HOURLY_BEFORE_SWITCH', indexedIds, { switchDate: OMIE_QUARTER_HOUR_FROM });
    }
    if (timeline.omieMissing > 0) {
      add('MISSING_OMIE_PRICES', indexedIds, { quarterHours: timeline.omieMissing });
    }
  }
  if (metadata.missingIntervals > 0) {
    add('MISSING_CONSUMPTION_NOT_FILLED', [], { quarterHours: metadata.missingIntervals });
  }
  if (metadata.estimatedIntervals > 0) {
    add('ESTIMATED_READINGS_USED', [], { quarterHours: metadata.estimatedIntervals });
  }
  if (metadata.duplicates > 0) {
    add('DUPLICATE_READINGS_FIRST_KEPT', [], { rows: metadata.duplicates });
  }

  add('VAT_STANDARD_RATE', [], { rate: tax.standardRate });
  for (const rule of tax.powerRules) {
    if (settings.contractedKva <= rule.max_contracted_kva) {
      add('VAT_REDUCED_TAR_POWER', [], {
        rate: rule.rate,
        maxKva: rule.max_contracted_kva,
        from: rule.valid_from,
      });
    }
  }
  for (const rule of tax.energyRules) {
    if (settings.contractedKva > rule.max_contracted_kva) {
      continue;
    }
    if (timeline.days.some((day) => ruleInForce(rule, day.date, settings.contractedKva))) {
      add('VAT_REDUCED_ENERGY', [], {
        rate: rule.rate,
        maxKva: rule.max_contracted_kva,
        kwhPer30Days: rule[tax.allowanceKey] ?? rule.kwh_per_30_days ?? 0,
        from: rule.valid_from,
      });
    }
    if (firstDate < rule.valid_from) {
      add('VAT_REDUCED_ENERGY_NOT_BEFORE', [], { from: rule.valid_from });
    }
  }
  const feeValues: Assumption['values'] = {};
  for (const fee of tax.fees) {
    feeValues[fee.id] = fee.amount_eur;
  }
  add('FEES_CURRENT_AMOUNTS', [], feeValues);

  const biHourlyIds = idsWhere((model) => model.meta.tariffType === 'bi_hourly');
  if (biHourlyIds.length > 0) {
    add('CYCLE_HOURS_CURRENT', biHourlyIds);
    add('PUBLIC_HOLIDAYS_AS_WEEKDAYS', biHourlyIds);
  }
  if (annualised) {
    add('ANNUALISED', [], { days: Math.round(periodDays * 100) / 100 });
  }
  if (settings.current.kind === 'manual') {
    add('MANUAL_PRICES_EXCLUDE_VAT', [MANUAL_TARIFF_ID]);
  }

  const formulaIds = (predicate: (formula: IndexedFormula, offer: Offer) => boolean): string[] =>
    idsWhere((_, offer) => offer?.formula != null && predicate(offer.formula, offer));
  const indicative = formulaIds(
    (formula) => formula.loss_factor.value_kind === 'indicative_average',
  );
  for (const id of indicative) {
    add('LOSS_FACTOR_INDICATIVE', [id], {
      lossFactor: offersById.get(id)?.formula?.loss_factor.value ?? 0,
    });
  }
  const unpublished = formulaIds((formula) => formula.loss_factor.value === null);
  if (unpublished.length > 0) {
    add('LOSS_FACTOR_UNPUBLISHED', unpublished);
  }
  for (const id of formulaIds((formula) => formula.unpriced_components.length > 0)) {
    const labels =
      offersById.get(id)?.formula?.unpriced_components.map((component) => component.label) ?? [];
    add('UNPRICED_COMPONENTS', [id], { components: labels.join('; ') });
  }
  const mean = formulaIds((formula) => formula.omie_averaging === 'billing_period_mean');
  if (mean.length > 0) {
    add('OMIE_BILLING_PERIOD_MEAN', mean);
  }
  const meanByPeriod = formulaIds(
    (formula) => formula.omie_averaging === 'billing_period_mean_by_tariff_period',
  );
  if (meanByPeriod.length > 0) {
    add('OMIE_BILLING_PERIOD_MEAN_BY_TARIFF_PERIOD', meanByPeriod);
  }
  for (const id of idsWhere((_, offer) => offer?.power_formula != null)) {
    add('POWER_TAR_PLUS_MARGIN', [id], {
      marginEurDay: offersById.get(id)?.power_formula?.margin_eur_day ?? 0,
    });
  }
  const currentPower = idsWhere(
    (_, offer) => offer?.pricing === 'omie_indexed' && offer.power_formula === null,
  );
  if (currentPower.length > 0) {
    add('POWER_PRICE_CURRENT', currentPower);
  }
  const extraFees = formulaIds((formula) => formula.extra_fees.length > 0);
  if (extraFees.length > 0) {
    add('EXTRA_FEES_CURRENT', extraFees);
  }
  return list;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function assertSupportedCatalogue(catalogue: Catalogue): void {
  if (
    catalogue?.schema_version !== SUPPORTED_CATALOGUE_SCHEMA ||
    !Array.isArray(catalogue.offers) ||
    !Array.isArray(catalogue.access_tariffs) ||
    !catalogue.taxes?.vat ||
    !catalogue.cycles?.cycles
  ) {
    throw new EngineError('UNSUPPORTED_CATALOGUE');
  }
}

/**
 * Computes the cost of every catalogue offer and of the current tariff over the exact period of
 * the consumption file. Throws EngineError with a typed code on invalid settings or data.
 */
export function calculateCosts(
  consumption: ParsedConsumption,
  data: EngineData,
  settings: CostSettings,
): CostAnalysis {
  const { catalogue } = data;
  assertSupportedCatalogue(catalogue);
  const kva = settings.contractedKva;
  if (
    !catalogue.access_tariffs.every((tar) => tar.power_eur_day.some((price) => price.kva === kva))
  ) {
    throw new EngineError('UNSUPPORTED_POWER');
  }
  const current = settings.current;
  if (current.kind === 'offer' && !catalogue.offers.some((offer) => offer.id === current.offerId)) {
    throw new EngineError('UNKNOWN_OFFER');
  }

  const timeline = buildTimeline(consumption, data);
  const models: TariffModel[] = [];
  const unavailable: UnavailableTariff[] = [];
  for (const offer of catalogue.offers) {
    const model = offerModel(offer, kva, timeline);
    if (model) {
      models.push(model);
    } else {
      unavailable.push({
        id: offer.id,
        supplier: offer.supplier,
        name: offer.name,
        reason: 'POWER_NOT_OFFERED',
      });
    }
  }
  if (current.kind === 'manual') {
    models.push(manualModel(current.tariff, timeline));
  }
  const currentId = current.kind === 'manual' ? MANUAL_TARIFF_ID : current.offerId;
  if (!models.some((model) => model.meta.id === currentId)) {
    throw new EngineError('CURRENT_OFFER_UNAVAILABLE');
  }

  const tax = taxContext(catalogue, timeline, settings);
  const costed = models.map((model) => costTariff(model, timeline, tax, kva));
  const periodDays = timeline.days.reduce((sum, day) => sum + day.fraction, 0);
  const annualised = Math.abs(periodDays - 365) > 1e-9 && Math.abs(periodDays - 366) > 1e-9;
  const currentCents = costed.find((tariff) => tariff.model.meta.id === currentId)?.totalCents ?? 0;

  const ranking: TariffCost[] = costed
    .sort((a, b) => a.totalCents - b.totalCents || (a.model.meta.id < b.model.meta.id ? -1 : 1))
    .map((tariff, index) => ({
      ...tariff.model.meta,
      understated: tariff.model.meta.understated || tariff.unpricedQuarterHours > 0,
      rank: index + 1,
      isCurrent: tariff.model.meta.id === currentId,
      total: tariff.totalCents / 100,
      annualised: annualised ? cents(((tariff.totalCents / 100) * 365) / periodDays) / 100 : null,
      differenceVsCurrent: (tariff.totalCents - currentCents) / 100,
      breakdown: tariff.breakdown,
      months: tariff.months,
      kwhByPeriod: tariff.kwhByPeriod,
      unpricedQuarterHours: tariff.unpricedQuarterHours,
      unpricedKwh: tariff.unpricedKwh,
    }));

  const metadata = consumption.metadata;
  return {
    catalogueVersion: catalogue.catalogue_version,
    contractedKva: kva,
    largeFamily: settings.largeFamily,
    period: {
      start: metadata.periodStart,
      end: metadata.periodEnd,
      startUtc: metadata.periodStartUtc,
      endUtc: metadata.periodEndUtc,
      days: periodDays,
      annualised,
    },
    consumption: {
      totalKwh: metadata.totalKwh,
      intervalCount: metadata.intervalCount,
      expectedIntervalCount: metadata.expectedIntervalCount,
      missingIntervals: metadata.missingIntervals,
      missingRanges: metadata.missingRanges.map((range) => ({ ...range })),
      estimatedIntervals: metadata.estimatedIntervals,
      duplicates: metadata.duplicates,
    },
    omieQuarterHoursWithoutPrice: timeline.omieMissing,
    currentId,
    ranking,
    unavailable,
    assumptions: collectAssumptions(
      data,
      consumption,
      timeline,
      tax,
      costed,
      settings,
      annualised,
      periodDays,
    ),
  };
}
