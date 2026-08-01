// KPI cards: fleet utilization, idle time, approx engine hours, exceptions by
// severity. viz-agent scope. Math lives in the exported pure computeKpis() so
// it's testable without DOM/fetch (see kpi-card.check.ts).

import { fetchTrips } from '../api/fetchers/trip';
import { fetchExceptionEvents } from '../api/fetchers/exception-event';
import { fetchDevices } from '../api/fetchers/device';
import type { TripDTO, ExceptionEventDTO, FilterChangeDetail } from '../api/fetchers/types';

export interface KpiTotals {
  utilizationPct: number;
  idleSec: number;
  engineHoursApprox: number;
  exceptionsBySeverity: { low: number; medium: number; high: number };
}

export function computeKpis(
  trips: TripDTO[],
  exceptions: ExceptionEventDTO[],
  deviceCount: number,
  periodSec: number
): KpiTotals {
  const drivingSum = trips.reduce((sum, t) => sum + t.drivingDurationSec, 0);
  const idleSum = trips.reduce((sum, t) => sum + t.idlingDurationSec, 0);
  const denom = deviceCount * periodSec;

  const exceptionsBySeverity = { low: 0, medium: 0, high: 0 };
  for (const e of exceptions) exceptionsBySeverity[e.severity]++;

  return {
    utilizationPct: denom > 0 ? (drivingSum / denom) * 100 : 0,
    idleSec: idleSum,
    engineHoursApprox: drivingSum / 3600,
    exceptionsBySeverity,
  };
}

// ponytail: this phase keeps the 5 files decoupled (no cross-imports between
// them per the task brief), so the default-range helper is duplicated in
// kpi-card.ts / heatmap.ts / trip-timeline.ts instead of shared. Promote to a
// shared util once the integration phase wires these together.
function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function initKpiCards(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  container.classList.add('fa-kpi-cards');

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    try {
      const [trips, exceptions, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: dateFrom, toDate: dateTo, groupId }),
        fetchExceptionEvents({ database: ctx.database, fromDate: dateFrom, toDate: dateTo, groupId }),
        fetchDevices({ database: ctx.database, groupId }),
      ]);
      const periodSec = Math.max(0, (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 1000);
      render(computeKpis(trips, exceptions, devices.length, periodSec));
    } catch (err) {
      console.error('kpi-card: load failed', err);
      container.innerHTML = '<p class="fa-error">Failed to load KPI data.</p>';
    }
  }

  function render(kpis: KpiTotals) {
    container.innerHTML = `
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Fleet Utilization</div>
        <div class="fa-kpi-value">${kpis.utilizationPct.toFixed(1)}%</div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Total Idle Time</div>
        <div class="fa-kpi-value">${formatDuration(kpis.idleSec)}</div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Engine Hours (approx)</div>
        <div class="fa-kpi-value">${kpis.engineHoursApprox.toFixed(1)}h</div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Exceptions</div>
        <div class="fa-kpi-value">
          <span class="fa-badge fa-badge-low">Low ${kpis.exceptionsBySeverity.low}</span>
          <span class="fa-badge fa-badge-medium">Med ${kpis.exceptionsBySeverity.medium}</span>
          <span class="fa-badge fa-badge-high">High ${kpis.exceptionsBySeverity.high}</span>
        </div>
      </div>
    `;
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
  }

  const initial = defaultDateRange();
  load(initial.from, initial.to);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
  };
}
