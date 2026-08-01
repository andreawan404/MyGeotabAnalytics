// Trip timeline as a Chart.js v4 floating horizontal bar chart (native
// indexAxis:'y' + [start,stop] data points — no separate gantt lib needed).
// viz-agent scope.

import { Chart, registerables } from 'chart.js';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchDiagnostics, resolveCumulativeFuelDiagnosticId } from '../api/fetchers/diagnostic';
import { fetchStatusData } from '../api/fetchers/status-data';
import { probeDiagnostics } from '../api/fetchers/probe';
import type { TripDTO, DeviceLite, FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange, toUtcRange } from '../utils/date-range';
import {
  buildTripDetails,
  fuelPerTrip,
  formatDurationId,
  formatTripTooltip,
  type TripDetail,
} from '../analytics/trip-detail';

Chart.register(...registerables);

// The cumulative fuel counter is resolved by resolveCumulativeFuelDiagnosticId
// (diagnostic.ts) — id first, name only as a fallback, shared with the BBM view
// so the two can never disagree about which counter they are reading.

/**
 * Maps trips to Chart.js floating-bar points. x uses raw epoch-ms timestamps
 * (not hour-offsets from day start) — simpler and correct across multi-day
 * ranges; tick labels are formatted for display in initTripTimeline instead.
 * Pure, no DOM/Chart.js dependency — independently testable.
 *
 * The point shape stays exactly {x, y}: per-bar tooltip context lives in a
 * PARALLEL TripDetail[] built by buildTripDetails from the same trips array, so
 * Chart.js's `dataIndex` addresses both. Both are straight `trips.map` calls and
 * neither may filter or reorder.
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

/** Chart.js tooltips are hover/tap driven. Fine for a chart, but the numbers
 *  must not exist ONLY on hover, so the same values go on the canvas as text a
 *  screen reader can reach. Capped — a week of fleet trips would otherwise build
 *  a label thousands of lines long. */
function ariaSummary(details: TripDetail[]): string {
  if (details.length === 0) return 'Linimasa perjalanan: tidak ada perjalanan pada rentang ini.';

  const units = new Set(details.map((d) => d.deviceName)).size;
  const totalKm = details.reduce((sum, d) => sum + d.distanceKm, 0);
  const totalSec = details.reduce((sum, d) => sum + d.engineOnSec, 0);
  const head =
    `Linimasa ${details.length} perjalanan dari ${units} unit. ` +
    `Total jarak ${totalKm.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km, ` +
    `total mesin menyala ${formatDurationId(totalSec)}.`;

  const LIMIT = 25;
  const rows = details
    .slice(0, LIMIT)
    .map((d) => `${d.deviceName} — ${formatTripTooltip(d).join('; ')}`);
  if (details.length > LIMIT) rows.push(`… dan ${details.length - LIMIT} perjalanan lainnya.`);

  return [head, ...rows].join(' ');
}

/**
 * Litres per trip, but only when the database genuinely measures it.
 *
 * Deliberately NOT `jarak x rasio`: that is distance times a constant sitting
 * next to the distance already in the tooltip — no new information, dressed up
 * as a measurement. Absent -> null -> the tooltip says so.
 *
 * Cost ladder, cheapest exit first. Every step is cached and fleet-wide; there
 * is no per-trip and no per-device call anywhere in here, which is what keeps a
 * real fleet off the rate limiter (root CLAUDE.md rule 6):
 *   1. no trips                    -> 0 calls
 *   2. no such diagnostic by name  -> 1 (Diagnostic catalogue, cached 24h)
 *   3. diagnostic never reports    -> + 1 probe multiCall (cached 24h), and NO StatusData
 *   4. it reports                  -> + 1 StatusData for the whole visible range
 */
async function fetchFuelRows(params: {
  database: string;
  trips: TripDTO[];
  fromIso: string;
  toIso: string;
  groupId?: string;
}) {
  const { database, trips, fromIso, toIso, groupId } = params;
  if (trips.length === 0) return [];

  const diagnostics = await fetchDiagnostics({ database }); // near-static, cached 24h
  const diagnosticId = resolveCumulativeFuelDiagnosticId(diagnostics);
  if (!diagnosticId) return [];

  const probe = await probeDiagnostics({ database, diagnosticIds: [diagnosticId], toIso, groupId });
  if (probe[diagnosticId] !== true) return [];

  return fetchStatusData({ database, diagnosticId, fromDate: fromIso, toDate: toIso, groupId });
}

export function initTripTimeline(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  let chart: Chart | null = null;
  // Index-parallel to the chart's data points; the tooltip callbacks read it by
  // dataIndex. Reassigned as a whole with the chart so the two can never drift.
  let details: TripDetail[] = [];
  // Fuel adds up to two more awaits, widening the window in which a second
  // filter change can overtake the first. Only the newest load may render.
  let loadToken = 0;

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    const token = ++loadToken;
    try {
      const { fromIso, toIso } = toUtcRange(dateFrom, dateTo);
      const [trips, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
      ]);

      // Fuel is a tooltip nicety — it must never cost us the chart.
      let fuelRows: Awaited<ReturnType<typeof fetchFuelRows>> = [];
      try {
        fuelRows = await fetchFuelRows({ database: ctx.database, trips, fromIso, toIso, groupId });
      } catch (err) {
        console.warn('trip-timeline: fuel lookup failed, tooltip will show "—"', err);
      }

      if (token !== loadToken) return; // a newer load already owns the chart

      const bars = tripsToFloatingBars(trips, devices);
      details = buildTripDetails(trips, devices, fuelPerTrip(trips, fuelRows));

      chart?.destroy();
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          datasets: [
            {
              label: 'Perjalanan',
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
            tooltip: {
              // Without these the default label callback prints the raw floating-bar
              // payload — `Trips: [1785029489000, 1785029895000]`, two epoch-ms
              // numbers. Device name in the title, the real figures in the body.
              callbacks: {
                title: (items) => details[items[0]?.dataIndex ?? -1]?.deviceName ?? '',
                label: (item) => {
                  const d = details[item.dataIndex];
                  return d ? formatTripTooltip(d) : [];
                },
              },
            },
          },
        },
      });

      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', ariaSummary(details));
    } catch (err) {
      console.error('trip-timeline: load failed', err);
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
  }

  // `dashboard:view-shown` is broadcast on the SHARED rootEl for EVERY view,
  // including the ones that just hid this one. Resizing a Chart.js instance
  // whose container is display:none collapses it to 0x0 and it never comes back
  // — the exact bug that bit the heat map. clientWidth > 0 means "actually us".
  function onViewShown() {
    if (container.clientWidth > 0) chart?.resize();
  }

  const initial = defaultDateRange();
  load(initial.dateFrom, initial.dateTo);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);
  ctx.rootEl.addEventListener('dashboard:view-shown', onViewShown);

  return () => {
    loadToken++; // an in-flight load must not build a chart into a dead container
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    ctx.rootEl.removeEventListener('dashboard:view-shown', onViewShown);
    chart?.destroy();
    chart = null;
  };
}
