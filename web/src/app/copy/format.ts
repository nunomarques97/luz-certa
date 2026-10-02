import type { CycleId, TariffType } from '../engine/catalogue-model';

/** European Portuguese number, money and date formatting for the UI. */

const eurFormat = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const intFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 6 });
const dayMonthYear = new Intl.DateTimeFormat('pt-PT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Lisbon',
});
const dayMonth = new Intl.DateTimeFormat('pt-PT', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Lisbon',
});
const lisbonParts = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Lisbon',
});

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Minus sign used for negative amounts (U+2212), never a hyphen or a dash. */
export const MINUS = '−';

/** "943,25 €" */
export function eur(value: number): string {
  return eurFormat.format(value);
}

/** Signed amount with a real minus sign: "−38,63 €", "+19,41 €" or "0,00 €". */
export function signedEur(value: number): string {
  if (Math.abs(value) < 0.005) {
    return eur(0);
  }
  return (value < 0 ? MINUS : '+') + eur(Math.abs(value));
}

export function integer(value: number): string {
  return intFormat.format(value);
}

/** Up to six decimals, comma separator: "0,1658". */
export function decimal(value: number): string {
  return decimalFormat.format(value);
}

/** Rate as a percentage: 0.23 -> "23 %". */
export function percent(rate: number): string {
  return `${decimalFormat.format(Math.round(rate * 10000) / 100)} %`;
}

export function kwh(value: number): string {
  return `${intFormat.format(value)} kWh`;
}

export function kva(value: number): string {
  return `${decimalFormat.format(value)} kVA`;
}

/** "jan" from "2025-01". */
export function monthShort(key: string): string {
  return MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key;
}

/** "janeiro de 2025" from "2025-01"; the year is dropped when `withYear` is false. */
export function monthLong(key: string, withYear = false): string {
  const name = MONTHS_LONG[Number(key.slice(5, 7)) - 1] ?? key;
  return withYear ? `${name} de ${key.slice(0, 4)}` : name;
}

/** "2 out. 2026" from an ISO calendar date "2026-10-02" (built by hand: engines differ here). */
export function isoDateShort(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return 'sem data';
  }
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
  return month ? `${Number(iso.slice(8, 10))} ${month}. ${iso.slice(0, 4)}` : 'sem data';
}

/** "1 de janeiro de 2025" from an ISO calendar date. */
export function isoDateLong(iso: string): string {
  return dayMonthYear.format(new Date(`${iso}T12:00:00Z`));
}

/** "15 jun. 2025, 12:15" in Lisbon time. */
export function lisbonDateTime(utcMs: number): string {
  const parts = Object.fromEntries(
    lisbonParts.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
  );
  return `${isoDateShort(`${parts['year']}-${parts['month']}-${parts['day']}`)}, ${parts['hour']}:${parts['minute']}`;
}

/**
 * Period label in Lisbon time from the first instant to the exclusive end:
 * "1 de janeiro a 31 de dezembro de 2025" or "1 de dezembro de 2024 a 28 de fevereiro de 2025".
 */
export function periodLabel(startUtc: number, endUtc: number): string {
  const first = new Date(startUtc);
  const last = new Date(endUtc - 1);
  const yearOf = (date: Date) =>
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Lisbon' }).format(date);
  if (yearOf(first) === yearOf(last)) {
    return `${dayMonth.format(first)} a ${dayMonthYear.format(last)}`;
  }
  return `${dayMonthYear.format(first)} a ${dayMonthYear.format(last)}`;
}

/** Calendar years covered, as text: "2025" or "2024 e 2025". */
export function periodYears(startUtc: number, endUtc: number): string {
  const year = (ms: number) =>
    Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Lisbon' }).format(ms));
  const first = year(startUtc);
  const last = year(endUtc - 1);
  if (first === last) {
    return String(first);
  }
  const years = [];
  for (let y = first; y <= last; y++) {
    years.push(String(y));
  }
  return `${years.slice(0, -1).join(', ')} e ${years[years.length - 1]}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${integer(Math.max(1, Math.round(bytes / 1024)))} kB`;
  }
  return `${decimalFormat.format(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

export function cycleLabel(tariffType: TariffType, cycle: CycleId | null): string {
  if (tariffType === 'simple') {
    return 'simples';
  }
  return cycle === 'weekly' ? 'bi-horária, ciclo semanal' : 'bi-horária, ciclo diário';
}

export function pricingLabel(pricing: 'fixed' | 'omie_indexed'): string {
  return pricing === 'omie_indexed' ? 'Indexada ao OMIE' : 'Preço fixo';
}

/** Offer display name: the supplier is prefixed unless the offer name already starts with it. */
export function offerName(supplier: string | null, name: string | null): string {
  if (!name) {
    return supplier ?? '';
  }
  if (!supplier || name.startsWith(supplier)) {
    return name;
  }
  return `${supplier} ${name}`;
}

/** Host of a source URL without "www.", for compact link text. Empty for an invalid URL. */
export function sourceHost(url: string | null): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Only http(s) URLs are rendered as links; anything else is shown as text. */
export function safeHttpUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Parses a price typed in pt-PT or en style ("0,1658" or "0.1658"). Returns null when the text is
 * not a plain non-negative decimal number.
 */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(/\s/g, '');
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
