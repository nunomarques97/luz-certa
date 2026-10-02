import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';

import { eur, integer, kwh, monthLong, monthShort, signedEur } from '../../copy/format';
import type { TariffCost } from '../../engine/cost-engine';
import { monthlyComparison, tariffName } from '../../state/results-model';

const CHART_HEIGHT = 220;
const AXIS_WIDTH = 34;
const LABEL_HEIGHT = 20;

/**
 * Monthly chart and table: the current tariff against one offer the user picks (the cheapest by
 * default). The SVG is decorative detail with an aria-label; the table is the accessible equivalent
 * and always shown. The chart redraws at the container width.
 */
@Component({
  selector: 'app-monthly-section',
  templateUrl: './monthly-section.html',
})
export class MonthlySection {
  readonly ranking = input.required<TariffCost[]>();
  readonly totalKwh = input.required<number>();

  private readonly chartBox = viewChild<ElementRef<HTMLElement>>('chartBox');
  private readonly width = signal(640);

  protected readonly eur = eur;
  protected readonly signedEur = signedEur;
  protected readonly integer = integer;
  protected readonly kwh = kwh;
  protected readonly monthLong = monthLong;

  protected readonly current = computed(
    () => this.ranking().find((tariff) => tariff.isCurrent) ?? this.ranking()[0],
  );
  protected readonly offers = computed(() => this.ranking().filter((tariff) => !tariff.isCurrent));
  /** Selected offer id; resets to the cheapest offer whenever a new ranking arrives. */
  protected readonly compareId = linkedSignal(() => this.offers()[0]?.id ?? '');
  protected readonly compared = computed(
    () => this.offers().find((tariff) => tariff.id === this.compareId()) ?? this.offers()[0],
  );
  protected readonly comparedName = computed(() => {
    const offer = this.compared();
    return offer ? tariffName(offer) : '';
  });
  protected readonly comparedShort = computed(() => this.compared()?.supplier ?? 'Oferta');
  protected readonly rows = computed(() => {
    const offer = this.compared();
    return offer ? monthlyComparison(this.current(), offer) : [];
  });
  /** Month names carry the year when the period crosses a new year. */
  protected readonly multiYear = computed(() => {
    const rows = this.rows();
    return rows.length > 0 && rows[0].month.slice(0, 4) !== rows[rows.length - 1].month.slice(0, 4);
  });
  protected readonly totalDifference = computed(() => {
    const offer = this.compared();
    return offer ? Math.round((offer.total - this.current().total) * 100) / 100 : 0;
  });
  protected readonly offerColour = computed(() =>
    this.totalDifference() < 0 ? 'var(--cheaper)' : 'var(--dearer)',
  );

  protected readonly chart = computed(() => {
    const rows = this.rows();
    const width = Math.max(280, this.width());
    const max = Math.max(1, ...rows.map((row) => Math.max(row.current, row.offer)));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const plotHeight = CHART_HEIGHT - LABEL_HEIGHT - 10;
    const y = (value: number) => CHART_HEIGHT - LABEL_HEIGHT - (value / top) * plotHeight;
    const slot = (width - AXIS_WIDTH) / Math.max(1, rows.length);
    const barWidth = Math.max(2, slot * 0.32);
    // Show every month label when there is room, otherwise every second or third one.
    const labelEvery = slot >= 26 ? 1 : slot >= 13 ? 2 : 3;
    const bars = rows.map((row, i) => {
      const x = AXIS_WIDTH + i * slot + slot * 0.15;
      return {
        key: row.month,
        currentX: x,
        currentY: y(row.current),
        currentH: Math.max(0, y(0) - y(row.current)),
        offerX: x + barWidth + 2,
        offerY: y(row.offer),
        offerH: Math.max(0, y(0) - y(row.offer)),
        labelX: x + barWidth + 1,
        label: i % labelEvery === 0 ? monthShort(row.month) : '',
      };
    });
    const grid = [];
    for (let value = 0; value <= top + 1e-9; value += step) {
      grid.push({ y: y(value), label: integer(value) });
    }
    return { width, height: CHART_HEIGHT, barWidth, bars, grid, labelY: CHART_HEIGHT - 4 };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const box = this.chartBox()?.nativeElement;
      if (!box || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect.width ?? 0);
        if (width > 0 && width !== this.width()) {
          this.width.set(width);
        }
      });
      observer.observe(box);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected select(event: Event): void {
    this.compareId.set((event.target as HTMLSelectElement).value);
  }

  protected name(tariff: TariffCost): string {
    return tariffName(tariff);
  }
}

/** Grid step giving four to six lines: 1, 2 or 5 times a power of ten. */
function niceStep(max: number): number {
  const rough = max / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (rough <= factor * power) {
      return factor * power;
    }
  }
  return 10 * power;
}
