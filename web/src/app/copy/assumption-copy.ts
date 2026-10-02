import type { Assumption, AssumptionCode } from '../engine/cost-engine';
import { decimal, integer, isoDateLong, kva, percent } from './format';

/**
 * Where an assumption is shown on the results page:
 * - `notice`: missing or doubtful data, listed first and repeated in the context line;
 * - `general`: applies to every tariff or to a group (fixed, indexed, bi-hourly);
 * - `offer`: qualifies one offer and is listed under its name.
 */
export type AssumptionPlacement = 'notice' | 'general' | 'offer';

export const ASSUMPTION_PLACEMENT: Record<AssumptionCode, AssumptionPlacement> = {
  BILLING_PERIOD_CALENDAR_MONTH: 'general',
  PARTIAL_DAYS_PRO_RATA: 'general',
  FIXED_PRICES_CURRENT: 'general',
  INDEXED_HISTORICAL_OMIE_TAR: 'general',
  OMIE_SPAIN_TIME: 'general',
  OMIE_HOURLY_BEFORE_SWITCH: 'general',
  MISSING_OMIE_PRICES: 'notice',
  MISSING_CONSUMPTION_NOT_FILLED: 'notice',
  ESTIMATED_READINGS_USED: 'notice',
  DUPLICATE_READINGS_FIRST_KEPT: 'notice',
  VAT_STANDARD_RATE: 'general',
  VAT_REDUCED_TAR_POWER: 'general',
  VAT_REDUCED_ENERGY: 'general',
  VAT_REDUCED_ENERGY_NOT_BEFORE: 'general',
  FEES_CURRENT_AMOUNTS: 'general',
  CYCLE_HOURS_CURRENT: 'general',
  PUBLIC_HOLIDAYS_AS_WEEKDAYS: 'general',
  ANNUALISED: 'general',
  MANUAL_PRICES_EXCLUDE_VAT: 'general',
  LOSS_FACTOR_INDICATIVE: 'offer',
  LOSS_FACTOR_UNPUBLISHED: 'offer',
  UNPRICED_COMPONENTS: 'offer',
  OMIE_BILLING_PERIOD_MEAN: 'offer',
  OMIE_BILLING_PERIOD_MEAN_BY_TARIFF_PERIOD: 'offer',
  POWER_TAR_PLUS_MARGIN: 'offer',
  POWER_PRICE_CURRENT: 'offer',
  EXTRA_FEES_CURRENT: 'offer',
};

function num(values: Assumption['values'], key: string): number {
  const value = values[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function text(values: Assumption['values'], key: string): string {
  const value = values[key];
  return value === undefined ? '' : String(value);
}

function date(values: Assumption['values'], key: string): string {
  const value = text(values, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? isoDateLong(value) : value;
}

/** Day before an ISO date, as a long Portuguese date: the last day of the previous rule. */
function dayBefore(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso;
  }
  const day = new Date(`${iso}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return isoDateLong(day.toISOString().slice(0, 10));
}

function quarterHours(count: number): string {
  return count === 1 ? '1 quarto de hora' : `${integer(count)} quartos de hora`;
}

/** European Portuguese sentence for one assumption, with its values filled in. */
export function assumptionText(assumption: Assumption): string {
  const v = assumption.values;
  switch (assumption.code) {
    case 'BILLING_PERIOD_CALENDAR_MONTH':
      return 'Cada mês civil conta como um período de faturação.';
    case 'PARTIAL_DAYS_PRO_RATA':
      return 'Os dias cobertos só em parte pelo ficheiro contam em proporção nos termos diários e mensais.';
    case 'FIXED_PRICES_CURRENT':
      return `Ofertas de preço fixo: os preços atuais do catálogo (versão ${text(v, 'catalogueVersion')}) são aplicados ao consumo passado. O preço real nessa altura pode ter sido outro.`;
    case 'INDEXED_HISTORICAL_OMIE_TAR':
      return 'Ofertas indexadas: preços OMIE históricos e tarifas de acesso à rede (TAR) em vigor em cada dia.';
    case 'OMIE_SPAIN_TIME':
      return 'Os preços OMIE são publicados na hora de Espanha. A hora de Lisboa é uma hora a menos.';
    case 'OMIE_HOURLY_BEFORE_SWITCH':
      return `Até ${dayBefore(text(v, 'switchDate'))} o OMIE publicava preços por hora: cada preço vale para os quatro quartos de hora dessa hora.`;
    case 'MISSING_OMIE_PRICES':
      return `Faltam preços OMIE em ${quarterHours(num(v, 'quarterHours'))}. A energia desses quartos de hora não tem preço nas ofertas indexadas, que ficam abaixo do custo real.`;
    case 'MISSING_CONSUMPTION_NOT_FILLED':
      return `Faltam leituras em ${quarterHours(num(v, 'quarterHours'))} do período. Não são preenchidas: o custo real seria um pouco mais alto em todas as tarifas.`;
    case 'ESTIMATED_READINGS_USED':
      return `${quarterHours(num(v, 'quarterHours'))} com leituras marcadas como estimadas pela E-Redes, usadas tal como estão.`.replace(
        /^./,
        (first) => first.toUpperCase(),
      );
    case 'DUPLICATE_READINGS_FIRST_KEPT': {
      const rows = num(v, 'rows');
      return rows === 1
        ? 'Uma leitura aparece repetida no ficheiro: foi usada a primeira.'
        : `${integer(rows)} leituras aparecem repetidas no ficheiro: foi usada a primeira de cada.`;
    }
    case 'VAT_STANDARD_RATE':
      return `IVA à taxa normal de ${percent(num(v, 'rate'))}.`;
    case 'VAT_REDUCED_TAR_POWER':
      return `IVA a ${percent(num(v, 'rate'))} sobre a parte da potência que corresponde às tarifas de acesso, para potências até ${kva(num(v, 'maxKva'))}, desde ${date(v, 'from')}.`;
    case 'VAT_REDUCED_ENERGY':
      return `IVA a ${percent(num(v, 'rate'))} sobre a energia até ${integer(num(v, 'kwhPer30Days'))} kWh por 30 dias, para potências até ${kva(num(v, 'maxKva'))}, desde ${date(v, 'from')}.`;
    case 'VAT_REDUCED_ENERGY_NOT_BEFORE':
      return `Antes de ${date(v, 'from')} não se aplica IVA reduzido à energia.`;
    case 'FEES_CURRENT_AMOUNTS': {
      const parts: string[] = [];
      if (v['iec'] !== undefined) {
        parts.push(`IEC ${decimal(num(v, 'iec'))} €/kWh`);
      }
      if (v['dgeg'] !== undefined) {
        parts.push(`taxa DGEG ${decimal(num(v, 'dgeg'))} € por mês`);
      }
      if (v['audiovisual_contribution'] !== undefined) {
        parts.push(`contribuição audiovisual ${decimal(num(v, 'audiovisual_contribution'))} € por dia`);
      }
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : parts.join('');
      return `${list.replace(/^./, (first) => first.toUpperCase())}, valores atuais em todo o período, sem isenções.`;
    }
    case 'CYCLE_HOURS_CURRENT':
      return 'Ofertas bi-horárias: horários atuais dos ciclos da ERSE em todo o período.';
    case 'PUBLIC_HOLIDAYS_AS_WEEKDAYS':
      return 'Ofertas bi-horárias: os feriados contam como dias normais da semana.';
    case 'ANNUALISED':
      return `O ficheiro cobre ${decimal(num(v, 'days'))} dias, não um ano inteiro. Cada custo do período tem ao lado o valor por ano: custo do período x 365 / número de dias.`;
    case 'MANUAL_PRICES_EXCLUDE_VAT':
      return 'A sua tarifa atual: os preços que indicou são lidos sem IVA e já com as tarifas de acesso.';
    case 'LOSS_FACTOR_INDICATIVE':
      return `Fator de perdas indicativo de ${percent(num(v, 'lossFactor'))}.`;
    case 'LOSS_FACTOR_UNPUBLISHED':
      return 'Fator de perdas não publicado: calculado sem perdas, a fatura real seria mais alta.';
    case 'UNPRICED_COMPONENTS':
      return `Sem valor publicado e por isso não incluído: ${text(v, 'components')}. A fatura real seria mais alta.`;
    case 'OMIE_BILLING_PERIOD_MEAN':
      return 'Média aritmética mensal dos preços OMIE.';
    case 'OMIE_BILLING_PERIOD_MEAN_BY_TARIFF_PERIOD':
      return 'Média mensal dos preços OMIE por período tarifário.';
    case 'POWER_TAR_PLUS_MARGIN':
      return `Potência: tarifa de acesso em vigor em cada dia mais ${decimal(num(v, 'marginEurDay'))} € por dia.`;
    case 'POWER_PRICE_CURRENT':
      return 'Preço da potência atual aplicado a todo o período.';
    case 'EXTRA_FEES_CURRENT':
      return 'Encargos extra por kWh com os valores atuais em todo o período.';
  }
}

/**
 * Portuguese text for the catalogue's "por confirmar" entries (catalogue/UNVERIFIED.md). Unknown ids
 * fall back to a generic sentence, so a new catalogue entry never shows untranslated text.
 */
export const UNVERIFIED_FALLBACK = 'Ponto em aberto no catálogo.';

const UNVERIFIED_TEXT: Record<string, string> = {
  U1: 'As duas formas publicadas da fórmula não coincidem.',
  U2: 'Os custos de sistema não são publicados como valor.',
  U3: 'Fator de perdas e preço da potência ao longo do tempo.',
  U4: 'Perfil de perdas por quarto de hora não incluído.',
  U5: 'Coeficientes de perdas não publicados.',
  U6: 'Base do preço da potência e período de faturação.',
  U7: 'IVA reduzido na energia antes de 2025.',
  U8: 'Valores do IEC, da taxa DGEG e da contribuição audiovisual.',
  U9: 'Preços confirmados nos dados abertos da ERSE, não na página do comercializador.',
  U10: 'Ciclo bi-horário oferecido pelo comercializador.',
  U11: 'Horários dos ciclos da ERSE antes de 2026.',
  U12: 'IVA sobre a potência até 3,45 kVA.',
  U13: 'Método de cálculo da média.',
  U14: 'Financiamento da tarifa social em períodos passados.',
};

export function unverifiedText(id: string): string {
  return UNVERIFIED_TEXT[id] ?? UNVERIFIED_FALLBACK;
}
