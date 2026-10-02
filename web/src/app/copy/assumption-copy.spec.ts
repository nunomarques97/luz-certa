import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Catalogue } from '../engine/catalogue-model';
import { ASSUMPTION_CODES, type Assumption } from '../engine/cost-engine';
import {
  ASSUMPTION_PLACEMENT,
  UNVERIFIED_FALLBACK,
  assumptionText,
  unverifiedText,
} from './assumption-copy';

/** En and em dashes, built from char codes so this file holds neither character. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const VALUES: Record<string, Assumption['values']> = {
  FIXED_PRICES_CURRENT: { catalogueVersion: '2026.10.02' },
  OMIE_HOURLY_BEFORE_SWITCH: { switchDate: '2025-10-01' },
  MISSING_OMIE_PRICES: { quarterHours: 8 },
  MISSING_CONSUMPTION_NOT_FILLED: { quarterHours: 113 },
  ESTIMATED_READINGS_USED: { quarterHours: 66 },
  DUPLICATE_READINGS_FIRST_KEPT: { rows: 3 },
  VAT_STANDARD_RATE: { rate: 0.23 },
  VAT_REDUCED_TAR_POWER: { rate: 0.06, maxKva: 3.45, from: '2024-01-01' },
  VAT_REDUCED_ENERGY: { rate: 0.06, maxKva: 6.9, kwhPer30Days: 200, from: '2025-01-01' },
  VAT_REDUCED_ENERGY_NOT_BEFORE: { from: '2025-01-01' },
  FEES_CURRENT_AMOUNTS: { iec: 0.001, dgeg: 0.07, audiovisual_contribution: 0.09363 },
  ANNUALISED: { days: 90 },
  LOSS_FACTOR_INDICATIVE: { lossFactor: 0.15 },
  UNPRICED_COMPONENTS: { components: 'Custos de sistema' },
  POWER_TAR_PLUS_MARGIN: { marginEurDay: 0.1171 },
};

describe('assumptionText', () => {
  it('has Portuguese text and a placement for every assumption code', () => {
    for (const code of ASSUMPTION_CODES) {
      const text = assumptionText({ code, tariffIds: [], values: VALUES[code] ?? {} });
      expect(text.length, code).toBeGreaterThan(15);
      expect(text, code).not.toMatch(/undefined|NaN/);
      expect(text, code).not.toMatch(DASHES);
      expect(text, code).not.toContain(code);
      expect(ASSUMPTION_PLACEMENT[code], code).toMatch(/^(notice|general|offer)$/);
    }
  });

  it('fills in values with Portuguese formatting', () => {
    const text = (code: (typeof ASSUMPTION_CODES)[number]) =>
      assumptionText({ code, tariffIds: [], values: VALUES[code] ?? {} });
    expect(text('VAT_REDUCED_ENERGY')).toBe(
      'IVA a 6 % sobre a energia até 200 kWh por 30 dias, para potências até 6,9 kVA, desde 1 de janeiro de 2025.',
    );
    expect(text('FEES_CURRENT_AMOUNTS')).toBe(
      'IEC 0,001 €/kWh, taxa DGEG 0,07 € por mês e contribuição audiovisual 0,09363 € por dia, valores atuais em todo o período, sem isenções.',
    );
    expect(text('OMIE_HOURLY_BEFORE_SWITCH')).toContain('Até 30 de setembro de 2025');
    expect(text('MISSING_CONSUMPTION_NOT_FILLED')).toContain('113 quartos de hora');
    expect(text('LOSS_FACTOR_INDICATIVE')).toBe('Fator de perdas indicativo de 15 %.');
  });

  it('marks missing and doubtful data as notices', () => {
    expect(ASSUMPTION_PLACEMENT.MISSING_CONSUMPTION_NOT_FILLED).toBe('notice');
    expect(ASSUMPTION_PLACEMENT.MISSING_OMIE_PRICES).toBe('notice');
    expect(ASSUMPTION_PLACEMENT.ESTIMATED_READINGS_USED).toBe('notice');
    expect(ASSUMPTION_PLACEMENT.DUPLICATE_READINGS_FIRST_KEPT).toBe('notice');
  });

  it('never shows untranslated text for an unknown unverified entry', () => {
    expect(unverifiedText('U1')).toContain('fórmula');
    expect(unverifiedText('U99')).toBe(UNVERIFIED_FALLBACK);
  });

  it('translates every unverified entry of the shipped catalogue', () => {
    const catalogue = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/data/catalogue.json'), 'utf8'),
    ) as Catalogue;
    expect(catalogue.unverified.length).toBeGreaterThan(0);
    for (const entry of catalogue.unverified) {
      expect(unverifiedText(entry.id), entry.id).not.toBe(UNVERIFIED_FALLBACK);
      expect(unverifiedText(entry.id), entry.id).not.toMatch(/por confirmar/i);
    }
  });
});
