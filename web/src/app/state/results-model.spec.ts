import {
  buildConsumption,
  fixedOffer,
  flatConsumption,
  indexedOffer,
  lisbonToUtc,
  testCatalogue,
} from '../../testing/engine-fixtures';
import { CostAnalysis, CostSettings, calculateCosts } from '../engine/cost-engine';
import type { ParsedConsumption } from '../engine/eredes-parser';
import { OmiePriceLookup } from '../engine/omie-time';
import { buildResultsModel, monthlyComparison, perYear } from './results-model';

const catalogue = testCatalogue([
  fixedOffer('cheap', {}, 0.4, 0.15),
  fixedOffer('mid', {}, 0.5, 0.2),
  fixedOffer('dear', {}, 0.6, 0.25),
  // No OMIE prices are supplied, so its energy is unpriced and the cost is understated.
  indexedOffer('idx'),
]);

function analyse(consumption: ParsedConsumption, settings: CostSettings): CostAnalysis {
  return calculateCosts(consumption, { catalogue, omie: new OmiePriceLookup([]) }, settings);
}

const MID: CostSettings = {
  contractedKva: 6.9,
  largeFamily: false,
  current: { kind: 'offer', offerId: 'mid' },
};

describe('buildResultsModel', () => {
  it('orders the ranking, flags the current tariff and signs the deltas', () => {
    const analysis = analyse(flatConsumption('2025-01-01', '2026-01-01', 0.1), MID);
    const model = buildResultsModel(analysis, MID);

    expect(model.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(model.current.id).toBe('mid');
    expect(model.current.delta).toBe('same');
    expect(model.rows.find((row) => row.id === 'cheap')?.delta).toBe('cheaper');
    expect(model.rows.find((row) => row.id === 'dear')?.delta).toBe('dearer');
    expect(Math.max(...model.rows.map((row) => row.barPercent))).toBeCloseTo(50, 5);
    expect(model.current.barPercent).toBe(0);
    expect(model.annualised).toBe(false);
    expect(model.rows.every((row) => row.annualised === null)).toBe(true);
    expect(model.periodLabel).toBe('1 de janeiro a 31 de dezembro de 2025');
    expect(model.years).toBe('2025');
    expect(model.cheaperCount + model.dearerCount).toBe(3);
  });

  it('keeps the caveat with an understated cheapest offer and names the cheapest firm one', () => {
    const analysis = analyse(flatConsumption('2025-01-01', '2026-01-01', 0.1), MID);
    const model = buildResultsModel(analysis, MID);
    expect(model.best.id).toBe('idx');
    expect(model.best.understated).toBe(true);
    expect(model.cheapestFirm?.id).toBe('cheap');
    // Missing OMIE prices are a data notice, listed before the assumptions.
    expect(model.notices.some((notice) => notice.includes('Faltam preços OMIE'))).toBe(true);
    expect(model.offerNotes.find((notes) => notes.id === 'idx')?.notes).toContain(
      'Preço da potência atual aplicado a todo o período.',
    );
  });

  it('shows the annualised value for a partial period and lists missing readings', () => {
    const start = lisbonToUtc('2025-01-01T00:00');
    // 90 days; 30 March has 92 quarter-hours (clock change).
    const quarters = (lisbonToUtc('2025-04-01T00:00') - start) / 900_000;
    const values: (number | null)[] = new Array(quarters).fill(0.1);
    values[100] = null;
    values[101] = null;
    const analysis = analyse(buildConsumption(start, values), MID);
    const model = buildResultsModel(analysis, MID);
    expect(model.annualised).toBe(true);
    expect(model.rows.every((row) => row.annualised !== null)).toBe(true);
    expect(perYear(model.rows[0].annualised)).toMatch(/^por ano: .+\s€$/);
    expect(perYear(null)).toBeNull();
    expect(model.periodLabel).toBe('1 de janeiro a 31 de março de 2025');
    expect(model.notices.some((notice) => notice.includes('Faltam leituras em 2 quartos de hora'))).toBe(true);
    expect(model.general.some((text) => text.startsWith('O ficheiro cobre 90 dias'))).toBe(true);
  });

  it('describes manual prices and leaves them out of the sources table', () => {
    const manual: CostSettings = {
      ...MID,
      current: {
        kind: 'manual',
        tariff: { tariffType: 'simple', energyEurKwh: { simple: 0.1658 }, powerEurDay: 0.452 },
      },
    };
    const analysis = analyse(flatConsumption('2025-01-01', '2026-01-01', 0.1), manual);
    const model = buildResultsModel(analysis, manual);
    expect(model.tariffCount).toBe(5);
    expect(model.current.name).toBe('A sua tarifa atual');
    expect(model.current.kind).toBe(
      'Preços que indicou, simples, 0,1658 €/kWh e 0,452 €/dia sem IVA',
    );
    expect(model.sources.map((source) => source.name)).not.toContain('A sua tarifa atual');
    expect(model.sources).toHaveLength(4);
    expect(model.sources[0].verifiedOn).toBe('2 out. 2026');
  });

  it('renders only http(s) source links', () => {
    const analysis = analyse(flatConsumption('2025-01-01', '2025-02-01', 0.1), MID);
    analysis.ranking[0].sourceUrl = 'javascript:alert(1)';
    const model = buildResultsModel(analysis, MID);
    expect(model.rows[0].sourceUrl).toBeNull();
  });
});

describe('monthlyComparison', () => {
  it('aligns months and signs the difference against the current tariff', () => {
    const analysis = analyse(flatConsumption('2025-01-01', '2025-04-01', 0.1), MID);
    const current = analysis.ranking.find((tariff) => tariff.id === 'mid')!;
    const cheap = analysis.ranking.find((tariff) => tariff.id === 'cheap')!;
    const rows = monthlyComparison(current, cheap);
    expect(rows.map((row) => row.month)).toEqual(['2025-01', '2025-02', '2025-03']);
    for (const row of rows) {
      expect(row.difference).toBeCloseTo(row.offer - row.current, 2);
      expect(row.delta).toBe('cheaper');
    }
  });
});
