// Trip timeline as a Chart.js v4 floating horizontal bar chart (native
// indexAxis:'y' + [start,stop] data points — no separate gantt lib needed).
// viz-agent scope.

import { Chart, registerables } from 'chart.js';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import type { TripDTO, DeviceLite, FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange, toUtcRange } from '../utils/date-range';

Chart.register(...registerables);

/**
 * Maps trips to Chart.js floating-bar points. x uses raw epoch-ms timestamps
 * (not hour-offsets from day start) — simpler and correct across multi-day
 * ranges; tick labels are formatted for display in initTripTimeline instead.
 * Pure, no DOM/Chart.js dependency — independently testable.
 */
export function tripsToFloatingBars(
  trips: TripDTO[],
  devices: DeviceLite[]
): { x: [number, number]; y: string }[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  return trips.map((t) => ({
    x: [new Date(t.start).getTime(), new Date(t.stop).getTime()],
    y: nameById.get(t.deviceId) ?? t.deviceId,
  }));
}

export function initTripTimeline(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  let chart: Chart | null = null;

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    try {
      const { fromIso, toIso } = toUtcRange(dateFrom, dateTo);
      const [trips, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
      ]);
      const bars = tripsToFloatingBars(trips, devices);

      chart?.destroy();
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          datasets: [
            {
              label: 'Trips',
              data: bars as unknown as number[],
              backgroundColor: '#3b82f6',
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'linear',
              // Values are absolute epoch-ms timestamps, not counts from zero —
              // beginAtZero (BarController's default) would stretch the axis
              // back to 1970 and shrink every real bar to sub-pixel width.
              beginAtZero: false,
              ticks: {
                callback: (value) =>
                  new Date(Number(value)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
              },
            },
          },
          plugins: {
            legend: { display: false },
          },
        },
      });
    } catch (err) {
      console.error('trip-timeline: load failed', err);
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
  }

  const initial = defaultDateRange();
  load(initial.dateFrom, initial.dateTo);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    chart?.destroy();
  };
}
