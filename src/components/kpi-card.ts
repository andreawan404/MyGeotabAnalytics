// KPI cards: fleet utilization, idle time, approx engine hours, exceptions by
// severity. viz-agent scope. Math lives in the exported pure computeKpis() so
// it's testable without DOM/fetch (see kpi-card.check.ts).

import { fetchTrips } from '../api/fetchers/trip';
import { fetchExceptionEvents } from '../api/fetchers/exception-event';
import { fetchDevices } from '../api/fetchers/device';
import { defaultDateRange, toUtcRange } from '../utils/date-range';
import type { TripDTO, ExceptionEventDTO, FilterChangeDetail } from '../api/fetchers/types';

export interface KpiTotals {
  utilizationPct: number;
  idleSec: number;
  engineHoursApprox: number;
  exceptionsBySeverity: { low: number; medium: number; high: number };
}

/** Utilization basis. 24/7 wall clock made every fleet look idle — a truck that
 *  never runs at night is not under-utilized (Aan's decision). */
export interface WorkingHours {
  hoursPerDay: number;
  daysPerWeek: number;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { hoursPerDay: 10, daysPerWeek: 6 };

// ponytail: pro-rates by daysPerWeek/7 instead of counting which calendar days
// are actually working days. Exact over whole weeks, off by at most one day's
// basis on ragged ranges, and blind to public holidays. Count real weekdays here
// if someone starts comparing week-on-week numbers to the payroll calendar.
export function workingSecondsInPeriod(periodSec: number, working: WorkingHours): number {
  return (periodSec / 86400) * (working.daysPerWeek / 7) * working.hoursPerDay * 3600;
}

export function computeKpis(
  trips: TripDTO[],
  exceptions: ExceptionEventDTO[],
  deviceCount: number,
  periodSec: number,
  working: WorkingHours = DEFAULT_WORKING_HOURS
): KpiTotals {
  const drivingSum = trips.reduce((sum, t) => sum + t.drivingDurationSec, 0);
  const idleSum = trips.reduce((sum, t) => sum + t.idlingDurationSec, 0);
  const denom = deviceCount * workingSecondsInPeriod(periodSec, working);

  const exceptionsBySeverity = { low: 0, medium: 0, high: 0 };
  for (const e of exceptions) exceptionsBySeverity[e.severity]++;

  return {
    utilizationPct: denom > 0 ? (drivingSum / denom) * 100 : 0,
    idleSec: idleSum,
    // Engine-on = driving + idling. Driving alone ignored every minute a truck
    // sat running at a loading dock, which is most of the idle KPI next to it.
    engineHoursApprox: (drivingSum + idleSum) / 3600,
    exceptionsBySeverity,
  };
}

const STORAGE_PREFIX = 'fleet-analytics:working-hours:';

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function loadWorkingHours(database: string): WorkingHours {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + database);
    if (!raw) return DEFAULT_WORKING_HOURS;
    const parsed = JSON.parse(raw);
    return {
      hoursPerDay: clamp(Number(parsed?.hoursPerDay), 1, 24, DEFAULT_WORKING_HOURS.hoursPerDay),
      daysPerWeek: clamp(Number(parsed?.daysPerWeek), 1, 7, DEFAULT_WORKING_HOURS.daysPerWeek),
    };
  } catch {
    return DEFAULT_WORKING_HOURS; // private mode / corrupt value — defaults are fine
  }
}

function saveWorkingHours(database: string, working: WorkingHours): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + database, JSON.stringify(working));
  } catch {
    /* storage unavailable — the setting just won't persist */
  }
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}j ${m}m`;
}

export function initKpiCards(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  container.classList.add('fa-kpi-cards');

  let working = loadWorkingHours(ctx.database);
  // Kept so changing the working-hours basis re-renders without re-fetching.
  let latest: { trips: TripDTO[]; exceptions: ExceptionEventDTO[]; deviceCount: number; periodSec: number } | null = null;

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    try {
      const { fromIso, toIso, periodSec } = toUtcRange(dateFrom, dateTo);
      const [trips, exceptions, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchExceptionEvents({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
      ]);
      latest = { trips, exceptions, deviceCount: devices.length, periodSec };
      render();
    } catch (err) {
      console.error('kpi-card: load failed', err);
      container.innerHTML = '<p class="fa-error">Gagal memuat data KPI.</p>';
    }
  }

  function render() {
    if (!latest) return;
    const kpis = computeKpis(latest.trips, latest.exceptions, latest.deviceCount, latest.periodSec, working);

    container.innerHTML = `
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Utilisasi Armada</div>
        <div class="fa-kpi-value">${kpis.utilizationPct.toFixed(1)}%</div>
        <div class="fa-kpi-note">
          <label>Jam kerja/hari <input type="number" id="fa-hours-per-day" min="1" max="24" value="${working.hoursPerDay}"></label>
          <label>Hari kerja/minggu <input type="number" id="fa-days-per-week" min="1" max="7" value="${working.daysPerWeek}"></label>
        </div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Total Waktu Idle</div>
        <div class="fa-kpi-value">${formatDuration(kpis.idleSec)}</div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Estimasi Jam Mesin</div>
        <div class="fa-kpi-value">${kpis.engineHoursApprox.toFixed(1)}j</div>
        <div class="fa-kpi-note">Estimasi dari data trip (jalan + idle)</div>
      </div>
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">Pelanggaran</div>
        <div class="fa-kpi-value">
          <span class="fa-badge fa-badge-low">Rendah ${kpis.exceptionsBySeverity.low}</span>
          <span class="fa-badge fa-badge-medium">Sedang ${kpis.exceptionsBySeverity.medium}</span>
          <span class="fa-badge fa-badge-high">Tinggi ${kpis.exceptionsBySeverity.high}</span>
        </div>
      </div>
    `;

    container.querySelector<HTMLInputElement>('#fa-hours-per-day')!.addEventListener('change', onWorkingChange);
    container.querySelector<HTMLInputElement>('#fa-days-per-week')!.addEventListener('change', onWorkingChange);
  }

  function onWorkingChange() {
    const hours = Number(container.querySelector<HTMLInputElement>('#fa-hours-per-day')!.value);
    const days = Number(container.querySelector<HTMLInputElement>('#fa-days-per-week')!.value);
    working = {
      hoursPerDay: clamp(hours, 1, 24, working.hoursPerDay),
      daysPerWeek: clamp(days, 1, 7, working.daysPerWeek),
    };
    saveWorkingHours(ctx.database, working);
    render(); // listeners are re-attached by render(); the old nodes are discarded
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
  };
}
