import { fixedOffer, testCatalogue } from '../../testing/engine-fixtures';
import { defaultDraft, powerOptions, toCostSettings } from './settings';

const catalogue = testCatalogue([fixedOffer('a')]);

describe('settings', () => {
  it('requires a current tariff', () => {
    const result = toCostSettings(defaultDraft(), catalogue);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.offerId).toContain('Escolha a sua tarifa atual');
  });

  it('builds offer settings', () => {
    const result = toCostSettings({ ...defaultDraft(), offerId: 'a', largeFamily: true }, catalogue);
    expect(result).toEqual({
      ok: true,
      settings: { contractedKva: 6.9, largeFamily: true, current: { kind: 'offer', offerId: 'a' } },
    });
  });

  it('rejects an offer that is not in the catalogue', () => {
    const result = toCostSettings({ ...defaultDraft(), offerId: 'gone' }, catalogue);
    expect(!result.ok && result.errors.offerId).toContain('já não está na lista');
  });

  it('reads manual prices with a decimal comma or point', () => {
    const draft = defaultDraft();
    draft.currentMode = 'manual';
    draft.manual = { ...draft.manual, energySimple: '0,1658', power: '0.452' };
    expect(toCostSettings(draft, catalogue)).toEqual({
      ok: true,
      settings: {
        contractedKva: 6.9,
        largeFamily: false,
        current: {
          kind: 'manual',
          tariff: { tariffType: 'simple', energyEurKwh: { simple: 0.1658 }, powerEurDay: 0.452 },
        },
      },
    });
  });

  it('flags empty, non-numeric, zero and implausible manual prices per field', () => {
    const draft = defaultDraft();
    draft.currentMode = 'manual';
    draft.manual = {
      ...draft.manual,
      tariffType: 'bi_hourly',
      energyOutOfEmpty: 'abc',
      energyEmpty: '0',
      power: '',
    };
    const result = toCostSettings(draft, catalogue);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.energyOutOfEmpty).toContain('maior que 0');
      expect(result.errors.energyEmpty).toContain('maior que 0');
      expect(result.errors.power).toBe('Indique o preço em €/dia.');
    }
    draft.manual = { ...draft.manual, energyOutOfEmpty: '3', energyEmpty: '0,1', power: '0,5' };
    const tooHigh = toCostSettings(draft, catalogue);
    expect(!tooHigh.ok && tooHigh.errors.energyOutOfEmpty).toContain('até 2 €/kWh');
  });

  it('builds bi-hourly manual settings with the chosen cycle', () => {
    const draft = defaultDraft();
    draft.currentMode = 'manual';
    draft.manual = {
      tariffType: 'bi_hourly',
      cycle: 'weekly',
      energySimple: '',
      energyOutOfEmpty: '0,2',
      energyEmpty: '0,1',
      power: '0,5',
    };
    const result = toCostSettings(draft, null);
    expect(result.ok && result.settings.current).toEqual({
      kind: 'manual',
      tariff: {
        tariffType: 'bi_hourly',
        cycle: 'weekly',
        energyEurKwh: { out_of_empty: 0.2, empty: 0.1 },
        powerEurDay: 0.5,
      },
    });
  });

  it('lists the contracted powers of the access tariffs in order', () => {
    const powers = powerOptions(catalogue);
    expect(powers[0]).toBe(1.15);
    expect(powers).toContain(6.9);
    expect([...powers].sort((a, b) => a - b)).toEqual(powers);
  });
});
