import type { Catalogue, CycleId } from '../engine/catalogue-model';
import {
  MAX_MANUAL_ENERGY_EUR_KWH,
  MAX_MANUAL_POWER_EUR_DAY,
  type CostSettings,
} from '../engine/cost-engine';
import { decimal, parseDecimal } from '../copy/format';

/** The setup form as the user edits it. Prices stay text until the form is submitted. */
export interface SettingsDraft {
  contractedKva: number;
  largeFamily: boolean;
  currentMode: 'offer' | 'manual';
  /** Empty until the user picks an offer. */
  offerId: string;
  manual: {
    tariffType: 'simple' | 'bi_hourly';
    cycle: CycleId;
    energySimple: string;
    energyOutOfEmpty: string;
    energyEmpty: string;
    power: string;
  };
}

export type SettingsField =
  | 'contractedKva'
  | 'offerId'
  | 'energySimple'
  | 'energyOutOfEmpty'
  | 'energyEmpty'
  | 'power';

export type SettingsResult =
  | { ok: true; settings: CostSettings }
  | { ok: false; errors: Partial<Record<SettingsField, string>> };

/** Most common contracted power in Portuguese households. */
export const DEFAULT_KVA = 6.9;

export function defaultDraft(): SettingsDraft {
  return {
    contractedKva: DEFAULT_KVA,
    largeFamily: false,
    currentMode: 'offer',
    offerId: '',
    manual: {
      tariffType: 'simple',
      cycle: 'daily',
      energySimple: '',
      energyOutOfEmpty: '',
      energyEmpty: '',
      power: '',
    },
  };
}

/** Standard contracted powers (kVA) that the access tariffs price, smallest first. */
export function powerOptions(catalogue: Catalogue): number[] {
  const values = new Set<number>();
  for (const period of catalogue.access_tariffs) {
    for (const price of period.power_eur_day) {
      values.add(price.kva);
    }
  }
  return [...values].sort((a, b) => a - b);
}

function price(
  text: string,
  max: number,
  unit: string,
  field: SettingsField,
  errors: Partial<Record<SettingsField, string>>,
): number {
  if (text.trim() === '') {
    errors[field] = `Indique o preço em ${unit}.`;
    return NaN;
  }
  const value = parseDecimal(text);
  if (value === null || value <= 0 || value > max) {
    errors[field] = `Indique um número maior que 0 e até ${decimal(max)} ${unit}, por exemplo 0,1658.`;
    return NaN;
  }
  return value;
}

/** Validates the draft and builds the engine settings, or returns one message per invalid field. */
export function toCostSettings(draft: SettingsDraft, catalogue: Catalogue | null): SettingsResult {
  const errors: Partial<Record<SettingsField, string>> = {};
  if (!Number.isFinite(draft.contractedKva) || draft.contractedKva <= 0) {
    errors.contractedKva = 'Escolha a potência contratada.';
  }
  let current: CostSettings['current'] | null = null;
  if (draft.currentMode === 'offer') {
    if (!draft.offerId) {
      errors.offerId = 'Escolha a sua tarifa atual, ou indique os preços da sua fatura.';
    } else if (catalogue && !catalogue.offers.some((offer) => offer.id === draft.offerId)) {
      errors.offerId = 'Esta tarifa já não está na lista. Escolha outra.';
    } else {
      current = { kind: 'offer', offerId: draft.offerId };
    }
  } else {
    const m = draft.manual;
    const power = price(m.power, MAX_MANUAL_POWER_EUR_DAY, '€/dia', 'power', errors);
    if (m.tariffType === 'simple') {
      const simple = price(m.energySimple, MAX_MANUAL_ENERGY_EUR_KWH, '€/kWh', 'energySimple', errors);
      current = {
        kind: 'manual',
        tariff: { tariffType: 'simple', energyEurKwh: { simple }, powerEurDay: power },
      };
    } else {
      const outOfEmpty = price(
        m.energyOutOfEmpty,
        MAX_MANUAL_ENERGY_EUR_KWH,
        '€/kWh',
        'energyOutOfEmpty',
        errors,
      );
      const empty = price(m.energyEmpty, MAX_MANUAL_ENERGY_EUR_KWH, '€/kWh', 'energyEmpty', errors);
      current = {
        kind: 'manual',
        tariff: {
          tariffType: 'bi_hourly',
          cycle: m.cycle,
          energyEurKwh: { out_of_empty: outOfEmpty, empty },
          powerEurDay: power,
        },
      };
    }
  }
  if (Object.keys(errors).length > 0 || !current) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    settings: { contractedKva: draft.contractedKva, current, largeFamily: draft.largeFamily },
  };
}
