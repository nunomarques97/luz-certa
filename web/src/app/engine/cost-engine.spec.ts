import {
  biHourlyOffer,
  buildConsumption,
  buildOmieFiles,
  fixedOffer,
  flatConsumption,
  indexedOffer,
  lisbonToUtc,
  seededValues,
  testCatalogue,
} from '../../testing/engine-fixtures';
import type { Catalogue, Fee, Offer, VatRule } from './catalogue-model';
import {
  CostAnalysis,
  CostSettings,
  MANUAL_TARIFF_ID,
  TariffCost,
  calculateCosts,
} from './cost-engine';
import { EngineError, EngineErrorCode } from './engine-errors';
import type { ParsedConsumption } from './eredes-parser';
import { OmiePriceLookup, OmieYearFile } from './omie-time';

const NO_OMIE = new OmiePriceLookup([]);

function settings(overrides: Partial<CostSettings> = {}): CostSettings {
  return {
    contractedKva: 6.9,
    largeFamily: false,
    current: { kind: 'offer', offerId: 'a' },
    ...overrides,
  };
}

function run(
  catalogue: Catalogue,
  consumption: ParsedConsumption,
  overrides: Partial<CostSettings> = {},
  omie: OmieYearFile[] = [],
): CostAnalysis {
  return calculateCosts(
    consumption,
    { catalogue, omie: omie.length ? new OmiePriceLookup(omie) : NO_OMIE },
    settings(overrides),
  );
}

function tariff(result: CostAnalysis, id: string): TariffCost {
  const found = result.ranking.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`No result for ${id}`);
  }
  return found;
}

function expectEngineError(action: () => unknown, code: EngineErrorCode): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EngineError);
  expect((caught as EngineError).code).toBe(code);
}

function codes(result: CostAnalysis): string[] {
  return result.assumptions.map((assumption) => assumption.code);
}

const TWO_JANUARY_DAYS = flatConsumption('2024-01-10', '2024-01-12', 0.25);

describe('calculateCosts: fixed offers', () => {
  it('prices energy, the power term per day and VAT over the exact period', () => {
    const result = run(testCatalogue([fixedOffer('a')]), TWO_JANUARY_DAYS);
    const a = tariff(result, 'a');
    // 48 kWh x 0.2 = 9.6; 2 days x 0.5 = 1.0; VAT 20 % of 10.6 = 2.12.
    expect(a.breakdown).toEqual({ energy: 9.6, power: 1, fees: 0, vat: 2.12 });
    expect(a.total).toBe(12.72);
    expect(a.months).toEqual([
      {
        month: '2024-01',
        days: 2,
        kwh: 48,
        energy: 9.6,
        power: 1,
        fees: 0,
        vat: 2.12,
        total: 12.72,
      },
    ]);
    expect(result.period.days).toBe(2);
    expect(result.period.annualised).toBe(true);
    expect(a.annualised).toBe(2321.4);
    expect(a.isCurrent).toBe(true);
    expect(a.differenceVsCurrent).toBe(0);
    expect(codes(result)).toContain('FIXED_PRICES_CURRENT');
    expect(result.assumptions.find((item) => item.code === 'ANNUALISED')?.values).toEqual({
      days: 2,
    });
  });

  it('splits partly covered days and months pro rata', () => {
    const consumption = buildConsumption(lisbonToUtc('2024-01-31T12:00'), new Array(96).fill(0.25));
    const result = run(testCatalogue([fixedOffer('a')]), consumption);
    const a = tariff(result, 'a');
    expect(a.months.map((month) => [month.month, month.days, month.kwh, month.total])).toEqual([
      ['2024-01', 0.5, 12, 3.18],
      ['2024-02', 0.5, 12, 3.18],
    ]);
    expect(a.total).toBe(6.36);
    expect(codes(result)).toContain('PARTIAL_DAYS_PRO_RATA');
  });

  it('adds fees per kWh, per day and per month with their own VAT rates', () => {
    const catalogue = testCatalogue([fixedOffer('a')]);
    const fee = (id: Fee['id'], basis: Fee['basis'], amount: number, vat: number): Fee => ({
      id,
      name: id,
      basis,
      amount_eur: amount,
      vat_rate: vat,
      source_url: 'https://example.org',
      vat_source_url: 'https://example.org',
      verified_on: '2026-10-02',
      unverified: [],
      notes: [],
    });
    catalogue.taxes.fees = [
      fee('iec', 'per_kwh', 0.01, 0.2),
      fee('dgeg', 'per_month', 0.31, 0.2),
      fee('audiovisual_contribution', 'per_day', 0.1, 0.05),
    ];
    const result = run(catalogue, flatConsumption('2024-01-10', '2024-01-20', 0.25));
    const a = tariff(result, 'a');
    // 240 kWh: energy 48, power 5. Fees 2.4 + 0.31 x 10/31 + 1.0 = 3.5.
    // VAT: 20 % of 53 = 10.6, plus 0.48 + 0.02 + 0.05 on the fees.
    expect(a.breakdown).toEqual({ energy: 48, power: 5, fees: 3.5, vat: 11.15 });
    expect(a.total).toBe(67.65);
    expect(result.assumptions.find((item) => item.code === 'FEES_CURRENT_AMOUNTS')?.values).toEqual(
      {
        iec: 0.01,
        dgeg: 0.31,
        audiovisual_contribution: 0.1,
      },
    );
  });

  it('uses the TAR power term in force on each day for a TAR-plus-margin power price', () => {
    const offer = fixedOffer('a', {
      power_formula: { type: 'tar_plus_margin', margin_eur_day: 0.05 },
    });
    const result = run(testCatalogue([offer]), flatConsumption('2024-05-31', '2024-06-02', 0));
    // (0.1 + 0.05) on 31 May, (0.2 + 0.05) on 1 June.
    expect(tariff(result, 'a').breakdown.power).toBe(0.4);
    expect(tariff(result, 'a').months.map((month) => month.power)).toEqual([0.15, 0.25]);
  });

  it('never fills missing readings and reports them', () => {
    const consumption = buildConsumption(lisbonToUtc('2024-01-10T10:00'), [1, null, null, 1]);
    const result = run(testCatalogue([fixedOffer('a')]), consumption);
    expect(tariff(result, 'a').breakdown.energy).toBe(0.4);
    expect(result.consumption.missingIntervals).toBe(2);
    expect(
      result.assumptions.find((item) => item.code === 'MISSING_CONSUMPTION_NOT_FILLED')?.values,
    ).toEqual({
      quarterHours: 2,
    });
  });
});

describe('calculateCosts: bi-hourly cycles in Portugal legal time', () => {
  const catalogue = testCatalogue([
    fixedOffer('a'),
    biHourlyOffer('daily', 'daily', 0.1, 0.3),
    biHourlyOffer('weekly', 'weekly', 0.1, 0.3),
  ]);

  function energyAt(id: string, wall: string, occurrence: 'first' | 'second' = 'first'): number {
    const result = run(catalogue, buildConsumption(lisbonToUtc(wall, occurrence), [1]));
    return tariff(result, id).breakdown.energy;
  }

  it.each([
    ['2024-01-08T21:45', 0.3],
    ['2024-01-08T22:00', 0.1],
    ['2024-01-08T07:45', 0.1],
    ['2024-01-08T08:00', 0.3],
    ['2024-07-08T23:45', 0.1],
    ['2024-10-27T01:00', 0.1],
  ])('daily cycle at Lisbon %s costs %d per kWh', (wall, price) => {
    expect(energyAt('daily', wall)).toBe(price);
  });

  it.each([
    // Saturday 09:15: vazio in winter (until 09:30), fora de vazio in summer (until 09:00).
    ['2024-01-06T09:15', 0.1],
    ['2024-06-08T09:15', 0.3],
    // Saturdays next to the clock changes keep the season in force on that day.
    ['2024-03-30T09:15', 0.1],
    ['2024-10-26T09:15', 0.3],
    ['2024-01-06T13:00', 0.1],
    ['2024-06-08T13:45', 0.3],
    ['2024-06-08T19:45', 0.1],
    ['2024-01-08T06:45', 0.1],
    ['2024-01-08T07:00', 0.3],
    ['2024-01-07T12:00', 0.1],
  ])('weekly cycle at Lisbon %s costs %d per kWh', (wall, price) => {
    expect(energyAt('weekly', wall)).toBe(price);
  });

  it('classifies both repeated hours of the autumn clock change in the summer and winter tables', () => {
    expect(energyAt('weekly', '2024-10-27T01:00', 'first')).toBe(0.1);
    expect(energyAt('weekly', '2024-10-27T01:00', 'second')).toBe(0.1);
    expect(energyAt('daily', '2024-10-27T01:00', 'second')).toBe(0.1);
  });

  it('reports kWh per tariff period and lists the cycle assumptions', () => {
    const result = run(catalogue, flatConsumption('2024-01-08', '2024-01-09', 0.25));
    expect(tariff(result, 'daily').kwhByPeriod).toEqual({ empty: 10, outOfEmpty: 14 });
    expect(tariff(result, 'weekly').kwhByPeriod).toEqual({ empty: 7, outOfEmpty: 17 });
    expect(tariff(result, 'a').kwhByPeriod).toBeNull();
    const cycleHours = result.assumptions.find((item) => item.code === 'CYCLE_HOURS_CURRENT');
    expect(cycleHours?.tariffIds.sort()).toEqual(['daily', 'weekly']);
    expect(codes(result)).toContain('PUBLIC_HOLIDAYS_AS_WEEKDAYS');
  });
});

describe('calculateCosts: OMIE-indexed offers', () => {
  const omieByHourMinute = buildOmieFiles(
    '2025-09-29',
    '2025-10-02',
    (wall) => Number(wall.slice(11, 13)) * 100 + Number(wall.slice(14, 16)),
  );
  const acrossSwitch = buildConsumption(lisbonToUtc('2025-09-30T22:45'), [100, 100, 100]);

  it('applies the formula to each market period, hourly before 2025-10-01 and quarter-hourly after', () => {
    const result = run(
      testCatalogue([fixedOffer('a'), indexedOffer('i')]),
      acrossSwitch,
      {},
      omieByHourMinute,
    );
    const i = tariff(result, 'i');
    // ((P + 10) x 1.1 x 2 + 5) / 1000 + TAR 0.06 + fee 0.001, for 100 kWh at each P:
    // Lisbon 22:45 = Spanish 23:45, hourly period 23:00 -> P = 2300 -> 514.80
    // Lisbon 23:00 = Spanish 00:00 on 2025-10-01 -> P = 0 -> 8.80
    // Lisbon 23:15 = Spanish 00:15 -> P = 15 -> 12.10
    expect(i.breakdown.energy).toBe(535.7);
    expect(i.unpricedQuarterHours).toBe(0);
    expect(i.understated).toBe(false);
    expect(result.omieQuarterHoursWithoutPrice).toBe(0);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'INDEXED_HISTORICAL_OMIE_TAR',
        'OMIE_SPAIN_TIME',
        'OMIE_HOURLY_BEFORE_SWITCH',
      ]),
    );
    expect(
      result.assumptions.find((item) => item.code === 'INDEXED_HISTORICAL_OMIE_TAR')?.tariffIds,
    ).toEqual(['i']);
  });

  it('counts quarter-hours without an OMIE price and leaves their energy unpriced', () => {
    const onlyOctober = buildOmieFiles('2025-10-01', '2025-10-01', () => 0);
    const result = run(
      testCatalogue([fixedOffer('a'), indexedOffer('i')]),
      acrossSwitch,
      {},
      onlyOctober,
    );
    const i = tariff(result, 'i');
    expect(i.unpricedQuarterHours).toBe(1);
    expect(i.unpricedKwh).toBe(100);
    // Two priced quarter-hours at P = 0: 2 x 100 x 0.088.
    expect(i.breakdown.energy).toBe(17.6);
    expect(i.understated).toBe(true);
    expect(tariff(result, 'a').unpricedQuarterHours).toBe(0);
    expect(result.omieQuarterHoursWithoutPrice).toBe(1);
    expect(result.assumptions.find((item) => item.code === 'MISSING_OMIE_PRICES')?.values).toEqual({
      quarterHours: 1,
    });
  });

  describe('billing-period averages', () => {
    // Spanish hour x 10: Lisbon 06:00 to 10:00 = Spanish 07:00 to 11:00 -> 70, 80, 90, 100.
    const omieByHour = buildOmieFiles(
      '2025-01-14',
      '2025-01-16',
      (wall) => Number(wall.slice(11, 13)) * 10,
    );
    const kwh = new Array<number>(16).fill(0);
    kwh[0] = 100; // Lisbon 06:00, vazio in the daily cycle
    kwh[8] = 200; // Lisbon 08:00, fora de vazio
    const consumption = buildConsumption(lisbonToUtc('2025-01-15T06:00'), kwh);
    const plain = {
      k_eur_mwh: 0,
      multiplier: 1,
      adder_eur_mwh: 0,
      adder_components: [],
      extra_fees: [],
    };
    const loss0 = {
      basis: 'fixed' as const,
      value: 0,
      value_kind: 'published' as const,
      source_url: 'https://example.org',
    };
    const biHourlyIndexed = (
      id: string,
      averaging: NonNullable<Offer['formula']>['omie_averaging'],
    ): Offer => ({
      ...indexedOffer(id, { ...plain, loss_factor: loss0, omie_averaging: averaging }),
      tariff_type: 'bi_hourly',
      cycle: 'daily',
    });

    it('uses each market period, the month mean or the month mean per tariff period', () => {
      const offers = [
        fixedOffer('a'),
        biHourlyIndexed('market', 'market_period'),
        biHourlyIndexed('mean', 'billing_period_mean'),
        biHourlyIndexed('mean-by-period', 'billing_period_mean_by_tariff_period'),
      ];
      const result = run(testCatalogue(offers), consumption, {}, omieByHour);
      // TAR 2025: vazio 0.03, fora de vazio 0.12.
      // market: 100 x (0.070 + 0.03) + 200 x (0.090 + 0.12) = 52.00
      // mean (85 over the four hours): 100 x 0.115 + 200 x 0.205 = 52.50
      // mean by period (vazio 75, fora de vazio 95): 100 x 0.105 + 200 x 0.215 = 53.50
      expect(tariff(result, 'market').breakdown.energy).toBe(52);
      expect(tariff(result, 'mean').breakdown.energy).toBe(52.5);
      expect(tariff(result, 'mean-by-period').breakdown.energy).toBe(53.5);
      expect(
        result.assumptions.find((item) => item.code === 'OMIE_BILLING_PERIOD_MEAN')?.tariffIds,
      ).toEqual(['mean']);
      expect(
        result.assumptions.find((item) => item.code === 'OMIE_BILLING_PERIOD_MEAN_BY_TARIFF_PERIOD')
          ?.tariffIds,
      ).toEqual(['mean-by-period']);
    });
  });

  it('computes an unpublished loss factor as zero and flags the result as understated', () => {
    const offer = indexedOffer('i', {
      loss_factor: {
        basis: 'supplier_table',
        value: null,
        value_kind: 'unpublished',
        source_url: 'https://example.org',
      },
    });
    const result = run(testCatalogue([fixedOffer('a'), offer]), acrossSwitch, {}, omieByHourMinute);
    const i = tariff(result, 'i');
    // ((P + 10) x 2 + 5) / 1000 + 0.061 per kWh, 100 kWh each: 468.60 + 8.60 + 11.60.
    expect(i.breakdown.energy).toBe(488.8);
    expect(i.understated).toBe(true);
    expect(
      result.assumptions.find((item) => item.code === 'LOSS_FACTOR_UNPUBLISHED')?.tariffIds,
    ).toEqual(['i']);
  });

  it('flags unpriced bill components', () => {
    const offer = indexedOffer('i', {
      unpriced_components: [{ id: 'system_costs', label: 'Custos de sistema' }],
    });
    const result = run(testCatalogue([fixedOffer('a'), offer]), acrossSwitch, {}, omieByHourMinute);
    expect(tariff(result, 'i').understated).toBe(true);
    expect(result.assumptions.find((item) => item.code === 'UNPRICED_COMPONENTS')).toEqual({
      code: 'UNPRICED_COMPONENTS',
      tariffIds: ['i'],
      values: { components: 'Custos de sistema' },
    });
  });
});

describe('calculateCosts: VAT rules', () => {
  const rule = (overrides: Partial<VatRule>): VatRule => ({
    id: 'rule',
    description: 'test',
    applies_to: 'energy',
    rate: 0.05,
    max_contracted_kva: 6.9,
    kwh_per_30_days: null,
    kwh_per_30_days_large_family: null,
    valid_from: '2024-01-01',
    valid_to: null,
    legal_reference: 'test',
    source_url: 'https://example.org',
    verified_on: '2026-10-02',
    unverified: [],
    notes: [],
    ...overrides,
  });
  const catalogue = testCatalogue([fixedOffer('a')]);
  catalogue.taxes.vat.rules = [
    rule({ id: 'power', applies_to: 'tar_power_term', max_contracted_kva: 3.45 }),
    rule({
      id: 'energy',
      kwh_per_30_days: 30,
      kwh_per_30_days_large_family: 60,
      valid_from: '2025-01-01',
    }),
  ];
  const twoDays2025 = flatConsumption('2025-01-10', '2025-01-12', 0.25);

  it('applies the reduced rate to the TAR power part and to the energy allowance pro rata by days', () => {
    const result = run(catalogue, twoDays2025, { contractedKva: 3.45 });
    // Power 1.0, TAR part 2 x 0.2 = 0.4: 5 % x 0.4 + 20 % x 0.6 = 0.14.
    // Energy 9.6 for 48 kWh, allowance 30 x 2 / 30 = 2 kWh: 20 % x 9.6 - 15 % x 0.4 = 1.86.
    expect(tariff(result, 'a').breakdown.vat).toBe(2);
    expect(tariff(result, 'a').total).toBe(12.6);
    expect(codes(result)).toEqual(
      expect.arrayContaining(['VAT_REDUCED_TAR_POWER', 'VAT_REDUCED_ENERGY']),
    );
  });

  it('uses the large-family allowance', () => {
    const result = run(catalogue, twoDays2025, { contractedKva: 3.45, largeFamily: true });
    expect(tariff(result, 'a').total).toBe(12.54);
    expect(result.largeFamily).toBe(true);
  });

  it('skips reduced rates above their contracted power limits', () => {
    const result = run(catalogue, twoDays2025, { contractedKva: 10.35 });
    expect(tariff(result, 'a').total).toBe(12.72);
    expect(codes(result)).not.toContain('VAT_REDUCED_ENERGY');
    expect(codes(result)).not.toContain('VAT_REDUCED_TAR_POWER');
  });

  it('does not apply the energy rule before it starts', () => {
    const result = run(catalogue, TWO_JANUARY_DAYS, { contractedKva: 3.45 });
    // 2024: TAR power 0.1/day -> 5 % x 0.2 + 20 % x 0.8 = 0.17; energy VAT 1.92.
    expect(tariff(result, 'a').total).toBe(12.69);
    expect(
      result.assumptions.find((item) => item.code === 'VAT_REDUCED_ENERGY_NOT_BEFORE')?.values,
    ).toEqual({
      from: '2025-01-01',
    });
  });
});

describe('calculateCosts: ranking and current tariff', () => {
  const offers = [fixedOffer('b', {}, 0.4, 0.25), fixedOffer('a2'), fixedOffer('a')];

  it('ranks by cost with ties ordered by id and gives the difference against a manual current tariff', () => {
    const result = run(testCatalogue(offers), TWO_JANUARY_DAYS, {
      current: {
        kind: 'manual',
        tariff: { tariffType: 'simple', energyEurKwh: { simple: 0.3 }, powerEurDay: 0.1 },
      },
    });
    expect(
      result.ranking.map((entry) => [
        entry.rank,
        entry.id,
        entry.total,
        entry.differenceVsCurrent,
        entry.isCurrent,
      ]),
    ).toEqual([
      [1, 'a', 12.72, -4.8, false],
      [2, 'a2', 12.72, -4.8, false],
      [3, 'b', 15.36, -2.16, false],
      [4, MANUAL_TARIFF_ID, 17.52, 0, true],
    ]);
    expect(result.currentId).toBe(MANUAL_TARIFF_ID);
    expect(tariff(result, MANUAL_TARIFF_ID).source).toBe('manual');
    expect(codes(result)).toContain('MANUAL_PRICES_EXCLUDE_VAT');
  });

  it('gives the difference against a catalogue offer and prices a manual bi-hourly tariff', () => {
    const result = run(testCatalogue(offers), TWO_JANUARY_DAYS, {
      current: { kind: 'offer', offerId: 'b' },
    });
    expect(tariff(result, 'a').differenceVsCurrent).toBe(-2.64);
    expect(tariff(result, 'b').isCurrent).toBe(true);

    const manual = run(testCatalogue(offers), TWO_JANUARY_DAYS, {
      current: {
        kind: 'manual',
        tariff: {
          tariffType: 'bi_hourly',
          cycle: 'daily',
          energyEurKwh: { empty: 0.1, out_of_empty: 0.3 },
          powerEurDay: 0.5,
        },
      },
    });
    // 20 kWh vazio x 0.1 + 28 kWh fora de vazio x 0.3 = 10.4.
    expect(tariff(manual, MANUAL_TARIFF_ID).breakdown.energy).toBe(10.4);
    expect(tariff(manual, MANUAL_TARIFF_ID).kwhByPeriod).toEqual({ empty: 20, outOfEmpty: 28 });
  });

  it('lists offers without a price for the contracted power as unavailable', () => {
    const limited = fixedOffer('x', {
      prices: [{ kva: 1.15, power_eur_day: 0.1, energy_eur_kwh: { simple: 0.1 } }],
    });
    const result = run(testCatalogue([fixedOffer('a'), limited]), TWO_JANUARY_DAYS);
    expect(result.ranking.map((entry) => entry.id)).toEqual(['a']);
    expect(result.unavailable).toEqual([
      { id: 'x', supplier: 'Supplier x', name: 'Offer x', reason: 'POWER_NOT_OFFERED' },
    ]);
    expectEngineError(
      () =>
        run(testCatalogue([fixedOffer('a'), limited]), TWO_JANUARY_DAYS, {
          current: { kind: 'offer', offerId: 'x' },
        }),
      'CURRENT_OFFER_UNAVAILABLE',
    );
  });
});

describe('calculateCosts: typed errors', () => {
  const catalogue = testCatalogue([fixedOffer('a')]);
  const manual = (tariff: unknown): Partial<CostSettings> => ({
    current: { kind: 'manual', tariff } as CostSettings['current'],
  });

  it('rejects an unknown current offer', () => {
    expectEngineError(
      () => run(catalogue, TWO_JANUARY_DAYS, { current: { kind: 'offer', offerId: 'nope' } }),
      'UNKNOWN_OFFER',
    );
  });

  it('rejects a non-standard contracted power', () => {
    expectEngineError(
      () => run(catalogue, TWO_JANUARY_DAYS, { contractedKva: 5 }),
      'UNSUPPORTED_POWER',
    );
  });

  it.each([
    { tariffType: 'simple', energyEurKwh: { simple: Number.NaN }, powerEurDay: 0.5 },
    { tariffType: 'simple', energyEurKwh: { simple: -0.1 }, powerEurDay: 0.5 },
    { tariffType: 'simple', energyEurKwh: { simple: 3 }, powerEurDay: 0.5 },
    { tariffType: 'simple', energyEurKwh: { simple: 0.2 }, powerEurDay: 11 },
    { tariffType: 'simple', powerEurDay: 0.5 },
    { tariffType: 'bi_hourly', energyEurKwh: { empty: 0.1, out_of_empty: 0.2 }, powerEurDay: 0.5 },
    { tariffType: 'bi_hourly', cycle: 'daily', energyEurKwh: { empty: 0.1 }, powerEurDay: 0.5 },
    { tariffType: 'tri_hourly', energyEurKwh: { simple: 0.1 }, powerEurDay: 0.5 },
    null,
  ])('rejects invalid manual prices %j', (tariff) => {
    expectEngineError(
      () => run(catalogue, TWO_JANUARY_DAYS, manual(tariff)),
      'INVALID_MANUAL_PRICES',
    );
  });

  it('rejects consumption outside the catalogue access tariff periods', () => {
    expectEngineError(
      () => run(catalogue, flatConsumption('2023-12-31', '2024-01-02', 0.25)),
      'PERIOD_OUTSIDE_CATALOGUE',
    );
  });

  it('rejects an unsupported catalogue schema', () => {
    expectEngineError(
      () => run({ ...catalogue, schema_version: 2 }, TWO_JANUARY_DAYS),
      'UNSUPPORTED_CATALOGUE',
    );
  });
});

describe('calculateCosts: monthly breakdown', () => {
  it('sums the month totals to the period total within 0.01 EUR for every tariff', () => {
    const catalogue = testCatalogue([
      fixedOffer('a', {}, 0.4567, 0.17123),
      biHourlyOffer('d', 'daily', 0.1171, 0.2033),
      biHourlyOffer('w', 'weekly', 0.1093, 0.2111),
      indexedOffer('i'),
    ]);
    catalogue.taxes.fees = [
      {
        id: 'dgeg',
        name: 'dgeg',
        basis: 'per_month',
        amount_eur: 0.07,
        vat_rate: 0.23,
        source_url: 'https://example.org',
        vat_source_url: 'https://example.org',
        verified_on: '2026-10-02',
        unverified: [],
        notes: [],
      },
    ];
    const start = lisbonToUtc('2025-02-17T13:45');
    const consumption = buildConsumption(start, seededValues(96 * 75, 7));
    const omie = buildOmieFiles(
      '2025-02-17',
      '2025-05-03',
      (wall) => 40 + ((Number(wall.slice(11, 13)) * 7.3) % 60),
    );
    const result = run(catalogue, consumption, {}, omie);
    expect(result.ranking).toHaveLength(4);
    for (const entry of result.ranking) {
      expect(entry.months.map((month) => month.month)).toEqual([
        '2025-02',
        '2025-03',
        '2025-04',
        '2025-05',
      ]);
      const monthSum = entry.months.reduce((sum, month) => sum + month.total, 0);
      expect(Math.abs(monthSum - entry.total)).toBeLessThan(0.01);
      const parts =
        entry.breakdown.energy + entry.breakdown.power + entry.breakdown.fees + entry.breakdown.vat;
      expect(Math.abs(parts - entry.total)).toBeLessThan(0.05);
      expect(entry.annualised).toBeCloseTo((entry.total * 365) / result.period.days, 1);
    }
  });
});
