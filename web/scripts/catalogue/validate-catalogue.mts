import {
  SCHEMA_VERSION,
  type AccessTariffPeriod,
  type Catalogue,
  type CycleCatalogue,
  type CycleId,
  type DayType,
  type EnergyPrices,
  type Fee,
  type IndexedFormula,
  type Offer,
  type OfferPrice,
  type PowerPrice,
  type Season,
  type Sourced,
  type Taxes,
  type TimeInterval,
  type VatRule,
} from './catalogue-types.mts';

/**
 * Schema validation for the tariff catalogue. Pure: it receives parsed YAML values and returns
 * either the normalised catalogue or a list of `path: message` errors. Unknown fields are
 * rejected, so nothing (ranking, sponsorship, affiliate links) can be added without a schema
 * change.
 */

export const SECTION_NAMES = ['cycles', 'access_tariffs', 'taxes', 'offers'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

/** Contracted powers every price list must cover. */
export const REQUIRED_KVA = [3.45, 6.9, 10.35] as const;
export const REQUIRED_FIXED_OFFERS = 6;
export const REQUIRED_INDEXED_OFFERS = 4;
/** At least this many fixed offers of each tariff type. */
export const REQUIRED_PER_FIXED_TYPE = 2;
export const REQUIRED_FEES: readonly Fee['id'][] = ['iec', 'dgeg', 'audiovisual_contribution'];

/** Upper bounds that catch unit mistakes such as EUR/MWh typed where EUR/kWh is expected. */
const MAX_ENERGY_EUR_KWH = 1;
const MAX_POWER_EUR_DAY = 5;
const PRICE_TOLERANCE = 0.00005;

const FORBIDDEN_KEY = /sponsor|affiliate|rank|commission|featured|promot|referral/i;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CATALOGUE_VERSION = /^(\d{4})\.(\d{2})\.(\d{2})$/;
const TIME = /^(?:([01]\d|2[0-3]):(00|15|30|45)|24:00)$/;
const UNVERIFIED_ID = /^U\d+$/;
const SECTION_FILE = /^[a-z0-9-]+\.yaml$/;

export interface CatalogueInput {
  manifest: unknown;
  sections: Partial<Record<SectionName, unknown>>;
  /** Entries of catalogue/UNVERIFIED.md: id to heading title. */
  unverified: ReadonlyMap<string, string>;
}

export interface ValidateOptions {
  /** Today's date (YYYY-MM-DD); verified_on dates may not be later. */
  today: string;
}

export interface ValidationResult {
  errors: string[];
  catalogue: Catalogue | null;
}

type Fields = Record<string, unknown>;

function isPlainObject(value: unknown): value is Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function child(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Calendar day after an ISO date. */
export function nextDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/** Validation context: collects errors and knows which UNVERIFIED.md ids exist. */
class Checker {
  readonly errors: string[] = [];
  private readonly unverifiedIds: ReadonlyMap<string, string>;
  private readonly today: string;

  constructor(unverifiedIds: ReadonlyMap<string, string>, today: string) {
    this.unverifiedIds = unverifiedIds;
    this.today = today;
  }

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  record(
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
  ): Fields | null {
    if (!isPlainObject(value)) {
      this.fail(path, 'must be a mapping');
      return null;
    }
    for (const key of Object.keys(value)) {
      if (required.includes(key) || optional.includes(key)) continue;
      this.fail(
        child(path, key),
        FORBIDDEN_KEY.test(key)
          ? 'is not allowed: ranking, sponsorship and affiliate data are never part of the catalogue'
          : 'is not a known field',
      );
    }
    for (const key of required) {
      if (!Object.hasOwn(value, key)) this.fail(child(path, key), 'is required');
    }
    return value;
  }

  array(value: unknown, path: string): unknown[] | null {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be a list');
      return null;
    }
    return value;
  }

  string(value: unknown, path: string): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      this.fail(path, 'must be a non-empty string');
      return null;
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      this.fail(path, 'must not contain control characters');
      return null;
    }
    return value;
  }

  optionalString(value: unknown, path: string): string | null {
    return value === undefined || value === null ? null : this.string(value, path);
  }

  stringList(value: unknown, path: string): string[] {
    if (value === undefined) return [];
    const items = this.array(value, path) ?? [];
    return items.flatMap((item, i) => this.string(item, child(path, i)) ?? []);
  }

  slug(value: unknown, path: string): string | null {
    const text = this.string(value, path);
    if (text !== null && !SLUG.test(text)) {
      this.fail(path, 'must be lowercase letters, digits, "-" or "_"');
      return null;
    }
    return text;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(path, `must be one of ${allowed.join(', ')}`);
      return null;
    }
    return value as T;
  }

  url(value: unknown, path: string): string | null {
    const text = this.string(value, path);
    if (text === null) return null;
    let parsed: URL | null = null;
    try {
      parsed = /\s/.test(text) ? null : new URL(text);
    } catch {
      parsed = null;
    }
    if (parsed === null || parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) {
      this.fail(path, 'must be an absolute https URL');
      return null;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      this.fail(path, 'must not contain credentials');
      return null;
    }
    return text;
  }

  optionalUrl(value: unknown, path: string): string | null {
    return value === undefined || value === null ? null : this.url(value, path);
  }

  urlList(value: unknown, path: string): string[] {
    if (value === undefined) return [];
    const items = this.array(value, path) ?? [];
    return items.flatMap((item, i) => this.url(item, child(path, i)) ?? []);
  }

  date(value: unknown, path: string): string | null {
    const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
    if (match === null || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      this.fail(path, 'must be an ISO date (YYYY-MM-DD) that exists');
      return null;
    }
    return value as string;
  }

  verifiedOn(value: unknown, path: string): string | null {
    const date = this.date(value, path);
    if (date !== null && date > this.today) {
      this.fail(path, `must not be later than today (${this.today})`);
      return null;
    }
    return date;
  }

  number(
    value: unknown,
    path: string,
    min: number,
    max: number,
    minExclusive = false,
  ): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, 'must be a number');
      return null;
    }
    if ((minExclusive ? value <= min : value < min) || value > max) {
      this.fail(
        path,
        `must be ${minExclusive ? 'greater than' : 'at least'} ${min} and at most ${max}`,
      );
      return null;
    }
    return value;
  }

  /** Strictly positive price with an upper bound. */
  price(value: unknown, path: string, max: number): number | null {
    return this.number(value, path, 0, max, true);
  }

  /** Rate or factor expressed as a fraction (0.23 = 23 %). */
  fraction(value: unknown, path: string): number | null {
    return this.number(value, path, 0, 1, true);
  }

  unverified(value: unknown, path: string): string[] {
    if (value === undefined) return [];
    const ids: string[] = [];
    (this.array(value, path) ?? []).forEach((item, i) => {
      const itemPath = child(path, i);
      if (typeof item !== 'string' || !UNVERIFIED_ID.test(item)) {
        this.fail(itemPath, 'must be an id such as U1');
      } else if (!this.unverifiedIds.has(item)) {
        this.fail(itemPath, `${item} is not described in catalogue/UNVERIFIED.md`);
      } else if (ids.includes(item)) {
        this.fail(itemPath, `${item} is listed twice`);
      } else {
        ids.push(item);
      }
    });
    return ids;
  }

  sourced(fields: Fields, path: string): Sourced {
    return {
      source_url: this.url(fields['source_url'], child(path, 'source_url')) ?? '',
      verified_on: this.verifiedOn(fields['verified_on'], child(path, 'verified_on')) ?? '',
      unverified: this.unverified(fields['unverified'], child(path, 'unverified')),
      notes: this.stringList(fields['notes'], child(path, 'notes')),
    };
  }

  uniqueIds(items: readonly { id: string }[], path: string): void {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id)) this.fail(child(child(path, i), 'id'), `duplicate id ${item.id}`);
      seen.add(item.id);
    });
  }
}

const SOURCED_OPTIONAL = ['unverified', 'notes'] as const;

function validateManifest(c: Checker, value: unknown) {
  const fields = c.record(value, 'catalogue.yaml', [
    'schema_version',
    'catalogue_version',
    'currency',
    'prices_include_vat',
    'scope',
    'sections',
  ]);
  if (fields === null) return null;
  if (fields['schema_version'] !== SCHEMA_VERSION) {
    c.fail('catalogue.yaml.schema_version', `must be ${SCHEMA_VERSION}`);
  }
  const version = fields['catalogue_version'];
  const match = typeof version === 'string' ? CATALOGUE_VERSION.exec(version) : null;
  if (match === null || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    c.fail('catalogue.yaml.catalogue_version', 'must be a date written as YYYY.MM.DD');
  }
  if (fields['currency'] !== 'EUR') c.fail('catalogue.yaml.currency', 'must be EUR');
  if (fields['prices_include_vat'] !== false) {
    c.fail('catalogue.yaml.prices_include_vat', 'must be false: catalogue prices exclude VAT');
  }
  const scope = c.record(fields['scope'], 'catalogue.yaml.scope', [
    'market',
    'voltage_level',
    'catalogue_period',
  ]);
  const period = c.record(scope?.['catalogue_period'], 'catalogue.yaml.scope.catalogue_period', [
    'from',
    'to',
  ]);
  const from = period ? c.date(period['from'], 'catalogue.yaml.scope.catalogue_period.from') : null;
  const to = period ? c.date(period['to'], 'catalogue.yaml.scope.catalogue_period.to') : null;
  if (from !== null && to !== null && from > to) {
    c.fail('catalogue.yaml.scope.catalogue_period', 'from must not be later than to');
  }
  const sections = c.record(fields['sections'], 'catalogue.yaml.sections', SECTION_NAMES);
  for (const name of SECTION_NAMES) {
    const file = sections?.[name];
    if (file !== undefined && (typeof file !== 'string' || !SECTION_FILE.test(file))) {
      c.fail(`catalogue.yaml.sections.${name}`, 'must be a file name such as offers.yaml');
    }
  }
  return {
    catalogue_version: typeof version === 'string' ? version : '',
    scope: {
      market: (scope && c.string(scope['market'], 'catalogue.yaml.scope.market')) ?? '',
      voltage_level:
        (scope && c.string(scope['voltage_level'], 'catalogue.yaml.scope.voltage_level')) ?? '',
      catalogue_period: { from: from ?? '', to: to ?? '' },
    },
  };
}

function validateIntervals(c: Checker, value: unknown, path: string): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  let previousEnd = -1;
  (c.array(value, path) ?? []).forEach((item, i) => {
    const itemPath = child(path, i);
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      !item.every((t) => typeof t === 'string' && TIME.test(t))
    ) {
      c.fail(itemPath, 'must be [start, end] in HH:MM on quarter-hours (end may be 24:00)');
      return;
    }
    const [start, end] = item as [string, string];
    if (minutes(start) >= minutes(end)) {
      c.fail(itemPath, 'start must be earlier than end');
      return;
    }
    if (minutes(start) < previousEnd) {
      c.fail(itemPath, 'intervals must be sorted and must not overlap');
      return;
    }
    previousEnd = minutes(end);
    intervals.push([start, end]);
  });
  return intervals;
}

function validateCycles(c: Checker, value: unknown): CycleCatalogue | null {
  const path = 'cycles.yaml';
  const fields = c.record(
    value,
    path,
    ['source_url', 'verified_on', 'cycles'],
    ['page_url', ...SOURCED_OPTIONAL],
  );
  if (fields === null) return null;
  const cycleIds: readonly CycleId[] = ['daily', 'weekly'];
  const seasons: readonly Season[] = ['winter', 'summer'];
  const dayTypes: readonly DayType[] = ['weekday', 'saturday', 'sunday'];
  const cyclesPath = child(path, 'cycles');
  const cyclesFields = c.record(fields['cycles'], cyclesPath, cycleIds);
  const cycles = {} as CycleCatalogue['cycles'];
  for (const cycle of cycleIds) {
    const cyclePath = child(cyclesPath, cycle);
    const seasonFields = cyclesFields ? c.record(cyclesFields[cycle], cyclePath, seasons) : null;
    cycles[cycle] = {} as CycleCatalogue['cycles'][CycleId];
    for (const season of seasons) {
      const seasonPath = child(cyclePath, season);
      const dayFields = seasonFields ? c.record(seasonFields[season], seasonPath, dayTypes) : null;
      cycles[cycle][season] = {} as CycleCatalogue['cycles'][CycleId][Season];
      for (const day of dayTypes) {
        const dayPath = child(seasonPath, day);
        const periods = dayFields ? c.record(dayFields[day], dayPath, ['empty']) : null;
        cycles[cycle][season][day] = {
          empty: periods ? validateIntervals(c, periods['empty'], child(dayPath, 'empty')) : [],
        };
      }
    }
  }
  return {
    ...c.sourced(fields, path),
    page_url: c.optionalUrl(fields['page_url'], child(path, 'page_url')),
    cycles,
  };
}

function validatePowerList(c: Checker, value: unknown, path: string): PowerPrice[] {
  const prices: PowerPrice[] = [];
  (c.array(value, path) ?? []).forEach((item, i) => {
    const itemPath = child(path, i);
    const fields = c.record(item, itemPath, ['kva', 'eur_day']);
    if (fields === null) return;
    const kva = c.price(fields['kva'], child(itemPath, 'kva'), 41.4);
    const eurDay = c.price(fields['eur_day'], child(itemPath, 'eur_day'), MAX_POWER_EUR_DAY);
    if (kva !== null && eurDay !== null) prices.push({ kva, eur_day: eurDay });
  });
  checkKvaList(c, prices, path);
  return prices;
}

/** Contracted powers must ascend without repeats and include every required value. */
function checkKvaList(c: Checker, items: readonly { kva: number }[], path: string): void {
  for (let i = 1; i < items.length; i++) {
    if (items[i].kva <= items[i - 1].kva) {
      c.fail(child(path, i), 'kva values must be listed in ascending order without repeats');
    }
  }
  for (const kva of REQUIRED_KVA) {
    if (!items.some((item) => item.kva === kva)) c.fail(path, `must include ${kva} kVA`);
  }
}

function validateAccessTariffs(
  c: Checker,
  value: unknown,
  cataloguePeriod: { from: string; to: string } | undefined,
): AccessTariffPeriod[] {
  const path = 'access-tariffs.yaml';
  const fields = c.record(value, path, ['periods']);
  const periodsPath = child(path, 'periods');
  const items = fields ? (c.array(fields['periods'], periodsPath) ?? []) : [];
  if (fields && items.length === 0) c.fail(periodsPath, 'must list at least one period');
  const periods: AccessTariffPeriod[] = [];
  items.forEach((item, i) => {
    const itemPath = child(periodsPath, i);
    const period = c.record(
      item,
      itemPath,
      [
        'id',
        'valid_from',
        'valid_to',
        'source_url',
        'verified_on',
        'energy_eur_kwh',
        'power_eur_day',
      ],
      ['page_url', ...SOURCED_OPTIONAL],
    );
    if (period === null) return;
    const id = c.slug(period['id'], child(itemPath, 'id'));
    const validFrom = c.date(period['valid_from'], child(itemPath, 'valid_from'));
    const validTo = c.date(period['valid_to'], child(itemPath, 'valid_to'));
    if (validFrom !== null && validTo !== null && validFrom > validTo) {
      c.fail(itemPath, 'valid_from must not be later than valid_to');
    }
    const energyPath = child(itemPath, 'energy_eur_kwh');
    const energy = c.record(period['energy_eur_kwh'], energyPath, ['simple', 'bi_hourly']);
    const simple = energy
      ? c.price(energy['simple'], child(energyPath, 'simple'), MAX_ENERGY_EUR_KWH)
      : null;
    const biPath = child(energyPath, 'bi_hourly');
    const bi = energy ? c.record(energy['bi_hourly'], biPath, ['out_of_empty', 'empty']) : null;
    const outOfEmpty = bi
      ? c.price(bi['out_of_empty'], child(biPath, 'out_of_empty'), MAX_ENERGY_EUR_KWH)
      : null;
    const empty = bi ? c.price(bi['empty'], child(biPath, 'empty'), MAX_ENERGY_EUR_KWH) : null;
    const power = validatePowerList(c, period['power_eur_day'], child(itemPath, 'power_eur_day'));
    const sourced = c.sourced(period, itemPath);
    if (id === null || validFrom === null || validTo === null) return;
    if (simple === null || outOfEmpty === null || empty === null) return;
    periods.push({
      id,
      valid_from: validFrom,
      valid_to: validTo,
      ...sourced,
      page_url: c.optionalUrl(period['page_url'], child(itemPath, 'page_url')),
      energy_eur_kwh: { simple, bi_hourly: { out_of_empty: outOfEmpty, empty } },
      power_eur_day: power,
    });
  });
  c.uniqueIds(periods, periodsPath);
  checkTarTimeline(c, periods, periodsPath, cataloguePeriod);
  return periods;
}

/** TAR validity periods must not overlap, must be in date order and must leave no gap. */
function checkTarTimeline(
  c: Checker,
  periods: readonly AccessTariffPeriod[],
  path: string,
  cataloguePeriod: { from: string; to: string } | undefined,
): void {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i];
      const b = periods[j];
      if (a.valid_from <= b.valid_to && b.valid_from <= a.valid_to) {
        c.fail(path, `TAR period ${b.id} overlaps ${a.id}`);
      }
    }
  }
  for (let i = 1; i < periods.length; i++) {
    const previous = periods[i - 1];
    const current = periods[i];
    if (current.valid_from <= previous.valid_from) {
      c.fail(path, `TAR period ${current.id} must be listed after ${previous.id} in date order`);
    } else if (current.valid_from > nextDay(previous.valid_to)) {
      c.fail(path, `gap between TAR periods ${previous.id} and ${current.id}`);
    }
  }
  if (cataloguePeriod && cataloguePeriod.from !== '' && cataloguePeriod.to !== '') {
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (first !== undefined && first.valid_from > cataloguePeriod.from) {
      c.fail(path, `TAR periods must start by ${cataloguePeriod.from}`);
    }
    if (last !== undefined && last.valid_to < cataloguePeriod.to) {
      c.fail(path, `TAR periods must cover up to ${cataloguePeriod.to}`);
    }
  }
}

/** TAR period in force on a date. */
export function tarOn(periods: readonly AccessTariffPeriod[], date: string) {
  return periods.find((period) => period.valid_from <= date && date <= period.valid_to);
}

function validateTaxes(c: Checker, value: unknown): Taxes | null {
  const path = 'taxes.yaml';
  const fields = c.record(value, path, ['vat', 'fees']);
  if (fields === null) return null;
  const vatPath = child(path, 'vat');
  const vat = c.record(
    fields['vat'],
    vatPath,
    ['standard_rate', 'source_url', 'legal_reference', 'verified_on', 'rules'],
    SOURCED_OPTIONAL,
  );
  const rulesPath = child(vatPath, 'rules');
  const rules: VatRule[] = [];
  (vat ? (c.array(vat['rules'], rulesPath) ?? []) : []).forEach((item, i) => {
    const rule = validateVatRule(c, item, child(rulesPath, i));
    if (rule !== null) rules.push(rule);
  });
  c.uniqueIds(rules, rulesPath);
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      const aEnd = a.valid_to ?? '9999-12-31';
      const bEnd = b.valid_to ?? '9999-12-31';
      if (a.applies_to === b.applies_to && a.valid_from <= bEnd && b.valid_from <= aEnd) {
        c.fail(rulesPath, `VAT rules ${a.id} and ${b.id} overlap for ${a.applies_to}`);
      }
    }
  }

  const feesPath = child(path, 'fees');
  const fees: Fee[] = [];
  (c.array(fields['fees'], feesPath) ?? []).forEach((item, i) => {
    const fee = validateFee(c, item, child(feesPath, i));
    if (fee !== null) fees.push(fee);
  });
  c.uniqueIds(fees, feesPath);
  for (const id of REQUIRED_FEES) {
    if (!fees.some((fee) => fee.id === id)) c.fail(feesPath, `must include ${id}`);
  }
  if (vat === null) return null;
  return {
    vat: {
      ...c.sourced(vat, vatPath),
      standard_rate: c.fraction(vat['standard_rate'], child(vatPath, 'standard_rate')) ?? 0,
      legal_reference: c.string(vat['legal_reference'], child(vatPath, 'legal_reference')) ?? '',
      rules,
    },
    fees,
  };
}

function validateVatRule(c: Checker, value: unknown, path: string): VatRule | null {
  const rule = c.record(
    value,
    path,
    [
      'id',
      'description',
      'applies_to',
      'rate',
      'max_contracted_kva',
      'valid_from',
      'valid_to',
      'legal_reference',
      'source_url',
      'verified_on',
    ],
    ['kwh_per_30_days', 'kwh_per_30_days_large_family', ...SOURCED_OPTIONAL],
  );
  if (rule === null) return null;
  const id = c.slug(rule['id'], child(path, 'id'));
  const appliesTo = c.oneOf(rule['applies_to'], child(path, 'applies_to'), [
    'tar_power_term',
    'energy',
  ] as const);
  const validFrom = c.date(rule['valid_from'], child(path, 'valid_from'));
  const validTo =
    rule['valid_to'] === null ? null : c.date(rule['valid_to'], child(path, 'valid_to'));
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    c.fail(path, 'valid_from must not be later than valid_to');
  }
  let kwh: number | null = null;
  let kwhLargeFamily: number | null = null;
  if (appliesTo === 'energy') {
    kwh = c.price(rule['kwh_per_30_days'], child(path, 'kwh_per_30_days'), 10_000);
    kwhLargeFamily =
      rule['kwh_per_30_days_large_family'] === undefined
        ? null
        : c.price(
            rule['kwh_per_30_days_large_family'],
            child(path, 'kwh_per_30_days_large_family'),
            10_000,
          );
  } else if (
    rule['kwh_per_30_days'] !== undefined ||
    rule['kwh_per_30_days_large_family'] !== undefined
  ) {
    c.fail(path, 'kWh allowances only apply to energy rules');
  }
  const result = {
    id: id ?? '',
    description: c.string(rule['description'], child(path, 'description')) ?? '',
    applies_to: appliesTo ?? 'energy',
    rate: c.fraction(rule['rate'], child(path, 'rate')) ?? 0,
    max_contracted_kva:
      c.price(rule['max_contracted_kva'], child(path, 'max_contracted_kva'), 41.4) ?? 0,
    kwh_per_30_days: kwh,
    kwh_per_30_days_large_family: kwhLargeFamily,
    valid_from: validFrom ?? '',
    valid_to: validTo,
    legal_reference: c.string(rule['legal_reference'], child(path, 'legal_reference')) ?? '',
    ...c.sourced(rule, path),
  };
  return id === null || appliesTo === null || validFrom === null ? null : result;
}

function validateFee(c: Checker, value: unknown, path: string): Fee | null {
  const fee = c.record(
    value,
    path,
    [
      'id',
      'name',
      'basis',
      'amount_eur',
      'vat_rate',
      'source_url',
      'vat_source_url',
      'verified_on',
    ],
    SOURCED_OPTIONAL,
  );
  if (fee === null) return null;
  const id = c.oneOf(fee['id'], child(path, 'id'), REQUIRED_FEES);
  const basis = c.oneOf(fee['basis'], child(path, 'basis'), [
    'per_kwh',
    'per_day',
    'per_month',
  ] as const);
  const result = {
    id: id ?? 'iec',
    name: c.string(fee['name'], child(path, 'name')) ?? '',
    basis: basis ?? 'per_kwh',
    amount_eur: c.price(fee['amount_eur'], child(path, 'amount_eur'), 100) ?? 0,
    vat_rate: c.fraction(fee['vat_rate'], child(path, 'vat_rate')) ?? 0,
    vat_source_url: c.url(fee['vat_source_url'], child(path, 'vat_source_url')) ?? '',
    ...c.sourced(fee, path),
  };
  return id === null || basis === null ? null : result;
}

function validateOfferPrices(
  c: Checker,
  value: unknown,
  path: string,
  pricing: Offer['pricing'] | null,
  tariffType: Offer['tariff_type'] | null,
): OfferPrice[] {
  const prices: OfferPrice[] = [];
  (c.array(value, path) ?? []).forEach((item, i) => {
    const itemPath = child(path, i);
    const fields = c.record(item, itemPath, ['kva', 'power_eur_day'], ['energy_eur_kwh']);
    if (fields === null) return;
    const kva = c.price(fields['kva'], child(itemPath, 'kva'), 41.4);
    const power = c.price(
      fields['power_eur_day'],
      child(itemPath, 'power_eur_day'),
      MAX_POWER_EUR_DAY,
    );
    const energyPath = child(itemPath, 'energy_eur_kwh');
    let energy: EnergyPrices | null = null;
    if (pricing === 'omie_indexed') {
      if (fields['energy_eur_kwh'] !== undefined) {
        c.fail(energyPath, 'indexed offers price energy through formula, not fixed prices');
      }
    } else if (pricing === 'fixed' && tariffType === 'simple') {
      const prices = c.record(fields['energy_eur_kwh'], energyPath, ['simple']);
      const simple = prices
        ? c.price(prices['simple'], child(energyPath, 'simple'), MAX_ENERGY_EUR_KWH)
        : null;
      energy = simple === null ? null : { simple };
    } else if (pricing === 'fixed' && tariffType === 'bi_hourly') {
      const prices = c.record(fields['energy_eur_kwh'], energyPath, ['out_of_empty', 'empty']);
      const outOfEmpty = prices
        ? c.price(prices['out_of_empty'], child(energyPath, 'out_of_empty'), MAX_ENERGY_EUR_KWH)
        : null;
      const empty = prices
        ? c.price(prices['empty'], child(energyPath, 'empty'), MAX_ENERGY_EUR_KWH)
        : null;
      energy = outOfEmpty === null || empty === null ? null : { out_of_empty: outOfEmpty, empty };
    }
    if (kva !== null && power !== null)
      prices.push({ kva, power_eur_day: power, energy_eur_kwh: energy });
  });
  checkKvaList(c, prices, path);
  return prices;
}

function validateFormula(c: Checker, value: unknown, path: string): IndexedFormula | null {
  const fields = c.record(value, path, [
    'type',
    'omie_averaging',
    'k_eur_mwh',
    'loss_factor',
    'multiplier',
    'adder_eur_mwh',
    'adder_components',
    'includes_tar',
    'extra_fees',
    'unpriced_components',
  ]);
  if (fields === null) return null;
  if (fields['type'] !== 'omie_indexed') c.fail(child(path, 'type'), 'must be omie_indexed');
  const averaging = c.oneOf(fields['omie_averaging'], child(path, 'omie_averaging'), [
    'market_period',
    'billing_period_mean',
    'billing_period_mean_by_tariff_period',
  ] as const);
  const k = c.number(fields['k_eur_mwh'], child(path, 'k_eur_mwh'), 0, 500);

  const lossPath = child(path, 'loss_factor');
  const loss = c.record(fields['loss_factor'], lossPath, [
    'basis',
    'value',
    'value_kind',
    'source_url',
  ]);
  const lossBasis = loss
    ? c.oneOf(loss['basis'], child(lossPath, 'basis'), [
        'erse_loss_profile',
        'fixed',
        'supplier_table',
      ] as const)
    : null;
  const lossKind = loss
    ? c.oneOf(loss['value_kind'], child(lossPath, 'value_kind'), [
        'published',
        'indicative_average',
        'unpublished',
      ] as const)
    : null;
  let lossValue: number | null = null;
  if (loss && loss['value'] === null) {
    if (lossKind !== null && lossKind !== 'unpublished') {
      c.fail(child(lossPath, 'value'), 'may be null only when value_kind is unpublished');
    }
  } else if (loss) {
    lossValue = c.number(loss['value'], child(lossPath, 'value'), 0, 0.5);
    if (lossKind === 'unpublished') {
      c.fail(child(lossPath, 'value_kind'), 'cannot be unpublished when a value is given');
    }
  }
  const lossSource = loss ? c.url(loss['source_url'], child(lossPath, 'source_url')) : null;

  const multiplier = c.number(fields['multiplier'], child(path, 'multiplier'), 0, 3, true);
  const adder = c.number(fields['adder_eur_mwh'], child(path, 'adder_eur_mwh'), 0, 500);
  const componentsPath = child(path, 'adder_components');
  const components: IndexedFormula['adder_components'] = [];
  (c.array(fields['adder_components'], componentsPath) ?? []).forEach((item, i) => {
    const itemPath = child(componentsPath, i);
    const component = c.record(item, itemPath, ['id', 'eur_mwh']);
    if (component === null) return;
    const id = c.slug(component['id'], child(itemPath, 'id'));
    const eurMwh = c.number(component['eur_mwh'], child(itemPath, 'eur_mwh'), 0, 500);
    if (id !== null && eurMwh !== null) components.push({ id, eur_mwh: eurMwh });
  });
  const componentSum = components.reduce((sum, component) => sum + component.eur_mwh, 0);
  if (adder !== null && Math.abs(componentSum - adder) > 1e-9) {
    c.fail(componentsPath, `must add up to adder_eur_mwh (${adder}), got ${componentSum}`);
  }
  if (fields['includes_tar'] !== true) {
    c.fail(
      child(path, 'includes_tar'),
      'must be true: indexed offers add the TAR in force on each date',
    );
  }

  const feesPath = child(path, 'extra_fees');
  const extraFees: IndexedFormula['extra_fees'] = [];
  (c.array(fields['extra_fees'], feesPath) ?? []).forEach((item, i) => {
    const itemPath = child(feesPath, i);
    const fee = c.record(item, itemPath, ['id', 'label', 'eur_kwh', 'source_url']);
    if (fee === null) return;
    const id = c.slug(fee['id'], child(itemPath, 'id'));
    const label = c.string(fee['label'], child(itemPath, 'label'));
    const eurKwh = c.price(fee['eur_kwh'], child(itemPath, 'eur_kwh'), 0.1);
    const source = c.url(fee['source_url'], child(itemPath, 'source_url'));
    if (id !== null && label !== null && eurKwh !== null && source !== null) {
      extraFees.push({ id, label, eur_kwh: eurKwh, source_url: source });
    }
  });

  const unpricedPath = child(path, 'unpriced_components');
  const unpriced: IndexedFormula['unpriced_components'] = [];
  (c.array(fields['unpriced_components'], unpricedPath) ?? []).forEach((item, i) => {
    const itemPath = child(unpricedPath, i);
    const component = c.record(item, itemPath, ['id', 'label']);
    if (component === null) return;
    const id = c.slug(component['id'], child(itemPath, 'id'));
    const label = c.string(component['label'], child(itemPath, 'label'));
    if (id !== null && label !== null) unpriced.push({ id, label });
  });

  if (
    averaging === null ||
    k === null ||
    lossBasis === null ||
    lossKind === null ||
    lossSource === null ||
    multiplier === null ||
    adder === null
  ) {
    return null;
  }
  return {
    type: 'omie_indexed',
    omie_averaging: averaging,
    k_eur_mwh: k,
    loss_factor: {
      basis: lossBasis,
      value: lossValue,
      value_kind: lossKind,
      source_url: lossSource,
    },
    multiplier,
    adder_eur_mwh: adder,
    adder_components: components,
    includes_tar: true,
    extra_fees: extraFees,
    unpriced_components: unpriced,
  };
}

function validateOffer(
  c: Checker,
  value: unknown,
  path: string,
  tar: readonly AccessTariffPeriod[],
): Offer | null {
  const fields = c.record(
    value,
    path,
    ['id', 'supplier', 'name', 'pricing', 'tariff_type', 'source_url', 'verified_on', 'prices'],
    [
      'cycle',
      'erse_offer_code',
      'offer_url',
      'additional_sources',
      'conditions',
      'power_formula',
      'formula',
      ...SOURCED_OPTIONAL,
    ],
  );
  if (fields === null) return null;
  const id = c.slug(fields['id'], child(path, 'id'));
  const pricing = c.oneOf(fields['pricing'], child(path, 'pricing'), [
    'fixed',
    'omie_indexed',
  ] as const);
  const tariffType = c.oneOf(fields['tariff_type'], child(path, 'tariff_type'), [
    'simple',
    'bi_hourly',
  ] as const);
  let cycle: CycleId | null = null;
  if (tariffType === 'bi_hourly') {
    cycle = c.oneOf(fields['cycle'], child(path, 'cycle'), ['daily', 'weekly'] as const);
  } else if (tariffType === 'simple' && fields['cycle'] !== undefined) {
    c.fail(child(path, 'cycle'), 'applies to bi-hourly offers only');
  }
  const sourced = c.sourced(fields, path);
  const prices = validateOfferPrices(
    c,
    fields['prices'],
    child(path, 'prices'),
    pricing,
    tariffType,
  );

  let formula: IndexedFormula | null = null;
  let powerFormula: Offer['power_formula'] = null;
  if (pricing === 'omie_indexed') {
    formula = validateFormula(c, fields['formula'], child(path, 'formula'));
    if (formula?.loss_factor.value === null && sourced.unverified.length === 0) {
      c.fail(
        child(path, 'unverified'),
        'must reference an UNVERIFIED.md entry explaining the missing loss factor',
      );
    }
    if (fields['power_formula'] !== undefined) {
      powerFormula = validatePowerFormula(c, fields['power_formula'], child(path, 'power_formula'));
      if (powerFormula !== null && sourced.verified_on !== '') {
        checkPowerFormula(c, powerFormula.margin_eur_day, prices, tar, sourced.verified_on, path);
      }
    }
  } else if (pricing === 'fixed') {
    if (fields['formula'] !== undefined)
      c.fail(child(path, 'formula'), 'applies to indexed offers only');
    if (fields['power_formula'] !== undefined) {
      c.fail(child(path, 'power_formula'), 'applies to indexed offers only');
    }
  }

  const supplier = c.string(fields['supplier'], child(path, 'supplier'));
  const name = c.string(fields['name'], child(path, 'name'));
  if (
    id === null ||
    pricing === null ||
    tariffType === null ||
    supplier === null ||
    name === null
  ) {
    return null;
  }
  return {
    id,
    supplier,
    name,
    pricing,
    tariff_type: tariffType,
    cycle,
    erse_offer_code: c.optionalString(fields['erse_offer_code'], child(path, 'erse_offer_code')),
    ...sourced,
    offer_url: c.optionalUrl(fields['offer_url'], child(path, 'offer_url')),
    additional_sources: c.urlList(fields['additional_sources'], child(path, 'additional_sources')),
    conditions: c.stringList(fields['conditions'], child(path, 'conditions')),
    prices,
    power_formula: powerFormula,
    formula,
  };
}

function validatePowerFormula(c: Checker, value: unknown, path: string): Offer['power_formula'] {
  const fields = c.record(value, path, ['type', 'margin_eur_day']);
  if (fields === null) return null;
  if (fields['type'] !== 'tar_plus_margin') c.fail(child(path, 'type'), 'must be tar_plus_margin');
  const margin = c.price(
    fields['margin_eur_day'],
    child(path, 'margin_eur_day'),
    MAX_POWER_EUR_DAY,
  );
  return margin === null ? null : { type: 'tar_plus_margin', margin_eur_day: margin };
}

/** Listed power prices must equal margin + TAR power term on the verification date. */
function checkPowerFormula(
  c: Checker,
  margin: number,
  prices: readonly OfferPrice[],
  tar: readonly AccessTariffPeriod[],
  verifiedOn: string,
  path: string,
): void {
  const period = tarOn(tar, verifiedOn);
  if (period === undefined) {
    c.fail(child(path, 'power_formula'), `no TAR period covers verified_on ${verifiedOn}`);
    return;
  }
  for (const price of prices) {
    const tarPower = period.power_eur_day.find((p) => p.kva === price.kva);
    if (tarPower === undefined) {
      c.fail(
        child(path, 'power_formula'),
        `${period.id} has no TAR power price for ${price.kva} kVA`,
      );
    } else if (Math.abs(margin + tarPower.eur_day - price.power_eur_day) > PRICE_TOLERANCE) {
      c.fail(
        child(path, 'power_formula'),
        `margin + TAR (${period.id}) for ${price.kva} kVA is ${(margin + tarPower.eur_day).toFixed(4)}, ` +
          `but the listed price is ${price.power_eur_day}`,
      );
    }
  }
}

function validateOffers(c: Checker, value: unknown, tar: readonly AccessTariffPeriod[]): Offer[] {
  const path = 'offers.yaml';
  const fields = c.record(value, path, ['offers']);
  const offersPath = child(path, 'offers');
  const offers: Offer[] = [];
  (fields ? (c.array(fields['offers'], offersPath) ?? []) : []).forEach((item, i) => {
    const offer = validateOffer(c, item, child(offersPath, i), tar);
    if (offer !== null) offers.push(offer);
  });
  c.uniqueIds(offers, offersPath);
  for (let i = 1; i < offers.length; i++) {
    if (offers[i].id < offers[i - 1].id) {
      c.fail(
        child(offersPath, i),
        `offers must be sorted by id (${offers[i].id} comes before ${offers[i - 1].id}); order is never a ranking`,
      );
    }
  }
  if (fields === null) return offers;
  const fixed = offers.filter((offer) => offer.pricing === 'fixed');
  const indexed = offers.filter((offer) => offer.pricing === 'omie_indexed');
  if (fixed.length !== REQUIRED_FIXED_OFFERS) {
    c.fail(
      offersPath,
      `must have exactly ${REQUIRED_FIXED_OFFERS} fixed offers, found ${fixed.length}`,
    );
  }
  if (indexed.length !== REQUIRED_INDEXED_OFFERS) {
    c.fail(
      offersPath,
      `must have exactly ${REQUIRED_INDEXED_OFFERS} indexed offers, found ${indexed.length}`,
    );
  }
  for (const type of ['simple', 'bi_hourly'] as const) {
    const count = fixed.filter((offer) => offer.tariff_type === type).length;
    if (count < REQUIRED_PER_FIXED_TYPE) {
      c.fail(
        offersPath,
        `must have at least ${REQUIRED_PER_FIXED_TYPE} fixed ${type} offers, found ${count}`,
      );
    }
  }
  if (!indexed.some((offer) => /coop[eé]rnico/i.test(offer.supplier))) {
    c.fail(offersPath, 'must include the Coopérnico indexed offer');
  }
  return offers;
}

/** Validates every catalogue section and returns the normalised catalogue when valid. */
export function validateCatalogue(
  input: CatalogueInput,
  options: ValidateOptions,
): ValidationResult {
  const c = new Checker(input.unverified, options.today);
  const manifest = validateManifest(c, input.manifest);
  for (const name of SECTION_NAMES) {
    if (input.sections[name] === undefined) c.fail(name, 'section is missing');
  }
  const cycles = validateCycles(c, input.sections.cycles);
  const tar = validateAccessTariffs(
    c,
    input.sections.access_tariffs,
    manifest?.scope.catalogue_period,
  );
  const taxes = validateTaxes(c, input.sections.taxes);
  const offers = validateOffers(c, input.sections.offers, tar);

  if (c.errors.length > 0 || manifest === null || cycles === null || taxes === null) {
    return { errors: c.errors, catalogue: null };
  }
  return {
    errors: [],
    catalogue: {
      schema_version: SCHEMA_VERSION,
      catalogue_version: manifest.catalogue_version,
      currency: 'EUR',
      prices_include_vat: false,
      scope: manifest.scope,
      cycles,
      access_tariffs: tar,
      taxes,
      offers,
      unverified: [...input.unverified].map(([id, title]) => ({ id, title })),
    },
  };
}
