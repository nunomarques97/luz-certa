import { ASSUMPTION_PLACEMENT, assumptionText, unverifiedText } from '../copy/assumption-copy';
import {
  cycleLabel,
  decimal,
  eur,
  integer,
  isoDateShort,
  lisbonDateTime,
  offerName,
  periodLabel,
  periodYears,
  pricingLabel,
  safeHttpUrl,
  sourceHost,
} from '../copy/format';
import type { CostAnalysis, CostSettings, MonthCost, TariffCost } from '../engine/cost-engine';

export type DeltaKind = 'cheaper' | 'dearer' | 'same';

export interface RankingRow {
  id: string;
  rank: number;
  name: string;
  isCurrent: boolean;
  /** "Indexada ao OMIE, simples" or the manual prices the user entered. */
  kind: string;
  sourceUrl: string | null;
  sourceLabel: string;
  verifiedOn: string;
  total: number;
  annualised: number | null;
  difference: number;
  delta: DeltaKind;
  /** Bar length as a percentage of the half track (0 to 50). */
  barPercent: number;
  understated: boolean;
}

export interface OfferNotes {
  id: string;
  name: string;
  notes: string[];
}

export interface SourceRow {
  name: string;
  url: string | null;
  label: string;
  verifiedOn: string;
}

export interface ResultsModel {
  periodLabel: string;
  years: string;
  annualised: boolean;
  periodDays: number;
  totalKwh: number;
  contractedKva: number;
  catalogueVersion: string;
  tariffCount: number;
  rows: RankingRow[];
  best: RankingRow;
  current: RankingRow;
  cheaperCount: number;
  dearerCount: number;
  /** Cheapest tariff without the "valor mínimo" caveat, when the cheapest one has it. */
  cheapestFirm: RankingRow | null;
  /** Missing or doubtful data, shown first in the assumptions and in the context line. */
  notices: string[];
  general: string[];
  offerNotes: OfferNotes[];
  sources: SourceRow[];
  /** Offers left out because they have no price for the contracted power. */
  unavailable: string[];
}

function deltaOf(difference: number): DeltaKind {
  if (Math.abs(difference) < 0.005) {
    return 'same';
  }
  return difference < 0 ? 'cheaper' : 'dearer';
}

function manualKind(settings: CostSettings): string {
  if (settings.current.kind !== 'manual') {
    return '';
  }
  const tariff = settings.current.tariff;
  const power = `${decimal(tariff.powerEurDay)} €/dia`;
  if (tariff.tariffType === 'simple') {
    return `Preços que indicou, simples, ${decimal(tariff.energyEurKwh.simple)} €/kWh e ${power} sem IVA`;
  }
  const cycle = tariff.cycle === 'weekly' ? 'ciclo semanal' : 'ciclo diário';
  return `Preços que indicou, bi-horária, ${cycle}, fora de vazio ${decimal(tariff.energyEurKwh.out_of_empty)} €/kWh, vazio ${decimal(tariff.energyEurKwh.empty)} €/kWh e ${power} sem IVA`;
}

export function tariffName(tariff: TariffCost): string {
  return tariff.source === 'manual' ? 'A sua tarifa atual' : offerName(tariff.supplier, tariff.name);
}

/** Turns the engine result into what the results screen shows, in reading order. */
export function buildResultsModel(analysis: CostAnalysis, settings: CostSettings): ResultsModel {
  const maxAbs = Math.max(0.01, ...analysis.ranking.map((t) => Math.abs(t.differenceVsCurrent)));
  const rows: RankingRow[] = analysis.ranking.map((tariff) => {
    const url = safeHttpUrl(tariff.sourceUrl);
    return {
      id: tariff.id,
      rank: tariff.rank,
      name: tariffName(tariff),
      isCurrent: tariff.isCurrent,
      kind:
        tariff.source === 'manual'
          ? manualKind(settings)
          : `${pricingLabel(tariff.pricing)}, ${cycleLabel(tariff.tariffType, tariff.cycle)}`,
      sourceUrl: url,
      sourceLabel: sourceHost(url),
      verifiedOn: isoDateShort(tariff.verifiedOn),
      total: tariff.total,
      annualised: tariff.annualised,
      difference: tariff.isCurrent ? 0 : tariff.differenceVsCurrent,
      delta: tariff.isCurrent ? 'same' : deltaOf(tariff.differenceVsCurrent),
      barPercent: tariff.isCurrent ? 0 : (Math.abs(tariff.differenceVsCurrent) / maxAbs) * 50,
      understated: tariff.understated,
    };
  });
  const current = rows.find((row) => row.isCurrent) ?? rows[0];
  const best = rows[0];
  const cheapestFirm = best.understated ? (rows.find((row) => !row.understated) ?? null) : null;

  const names = new Map(rows.map((row) => [row.id, row.name]));
  const notices: string[] = [];
  const general: string[] = [];
  const notesById = new Map<string, string[]>();
  const addNote = (id: string, note: string) => {
    const list = notesById.get(id) ?? [];
    list.push(note);
    notesById.set(id, list);
  };
  for (const assumption of analysis.assumptions) {
    const text = assumptionText(assumption);
    const placement = ASSUMPTION_PLACEMENT[assumption.code];
    if (placement === 'notice') {
      notices.push(text);
    } else if (placement === 'general' || assumption.tariffIds.length === 0) {
      general.push(text);
    } else {
      for (const id of assumption.tariffIds) {
        addNote(id, text);
      }
    }
  }
  const missingRanges = analysis.consumption.missingRanges;
  if (missingRanges.length > 0) {
    const first = missingRanges
      .slice(0, 3)
      .map((range) => `${lisbonDateTime(range.startUtc)} (${integer(range.count)})`)
      .join('; ');
    const more = missingRanges.length > 3 ? ` e mais ${integer(missingRanges.length - 3)}` : '';
    notices.push(`Primeiras falhas de leitura (início e quartos de hora em falta): ${first}${more}.`);
  }
  for (const tariff of analysis.ranking) {
    for (const id of tariff.unverified) {
      addNote(tariff.id, `Por confirmar (${id}): ${unverifiedText(id)}`);
    }
  }
  const unavailable = analysis.unavailable.map((offer) => offerName(offer.supplier, offer.name));
  if (unavailable.length > 0) {
    notices.push(
      `Sem preço para ${decimal(analysis.contractedKva)} kVA e por isso fora da lista: ${unavailable.join(', ')}.`,
    );
  }

  const offerNotes: OfferNotes[] = rows
    .filter((row) => notesById.has(row.id))
    .map((row) => ({ id: row.id, name: names.get(row.id) ?? row.id, notes: notesById.get(row.id)! }));

  const sources: SourceRow[] = rows
    .filter((row) => !(row.isCurrent && !row.sourceUrl))
    .map((row) => ({
      name: row.name,
      url: row.sourceUrl,
      label: row.sourceLabel || 'sem fonte',
      verifiedOn: row.verifiedOn,
    }));

  return {
    periodLabel: periodLabel(analysis.period.startUtc, analysis.period.endUtc),
    years: periodYears(analysis.period.startUtc, analysis.period.endUtc),
    annualised: analysis.period.annualised,
    periodDays: analysis.period.days,
    totalKwh: analysis.consumption.totalKwh,
    contractedKva: analysis.contractedKva,
    catalogueVersion: analysis.catalogueVersion,
    tariffCount: rows.length,
    rows,
    best,
    current,
    cheaperCount: rows.filter((row) => !row.isCurrent && row.delta === 'cheaper').length,
    dearerCount: rows.filter((row) => !row.isCurrent && row.delta === 'dearer').length,
    cheapestFirm,
    notices,
    general,
    offerNotes,
    sources,
    unavailable,
  };
}

export interface MonthRow {
  month: string;
  kwh: number;
  current: number;
  offer: number;
  difference: number;
  delta: DeltaKind;
}

/** Month-by-month comparison of the current tariff with one offer, aligned by month. */
export function monthlyComparison(current: TariffCost, offer: TariffCost): MonthRow[] {
  const offerMonths = new Map<string, MonthCost>(offer.months.map((month) => [month.month, month]));
  return current.months.map((month) => {
    const other = offerMonths.get(month.month);
    const offerTotal = other?.total ?? 0;
    const difference = Math.round((offerTotal - month.total) * 100) / 100;
    return {
      month: month.month,
      kwh: month.kwh,
      current: month.total,
      offer: offerTotal,
      difference,
      delta: deltaOf(difference),
    };
  });
}

/** "por ano: 1012,40 €" under a period cost, when the period is not a whole year. */
export function perYear(value: number | null): string | null {
  return value === null ? null : `por ano: ${eur(value)}`;
}
