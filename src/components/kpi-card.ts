// KPI cards: fleet utilization, idle time, approx engine hours, exceptions by
// severity. viz-agent scope. Math lives in the exported pure computeKpis() so
// it's testable without DOM/fetch (see kpi-card.check.ts).

import { fetchTrips } from '../api/fetchers/trip';
import { fetchExceptionEvents } from '../api/fetchers/exception-event';
import { fetchDevices } from '../api/fetchers/device';
import { defaultDateRange, toUtcRange } from '../utils/date-range';
import type { TripDTO, ExceptionEventDTO, FilterChangeDetail } from '../api/fetchers/types';
import { esc, clamp, fin, int, one, durationHm } from '../utils/format';

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

// --- explanation layer -----------------------------------------------------
// "Utilisasi Armada 5,0%" means nothing to a fleet manager who cannot see where
// the 5,0 came from. These strings are DATA, not markup, so the check file can
// assert the arithmetic without a DOM.

export type KpiKind = 'terukur' | 'heuristik' | 'estimasi';

export interface KpiExplanation {
  formula: string;
  substituted: string;
  source: string;
  kind: KpiKind;
}

export type KpiExplainKey = 'utilization' | 'idle' | 'engineHours' | 'exceptions';

export interface KpiExplainInput {
  drivingSec: number;
  idleSec: number;
  deviceCount: number;
  periodSec: number;
  working: WorkingHours;
  exceptionsBySeverity: { low: number; medium: number; high: number };
}

export function explainKpis(input: KpiExplainInput): Record<KpiExplainKey, KpiExplanation> {
  const drivingSec = fin(input.drivingSec);
  const idleSec = fin(input.idleSec);
  const devices = fin(input.deviceCount);
  // Same basis computeKpis() uses — derived, not passed, so the two can't drift.
  const workSec = fin(workingSecondsInPeriod(fin(input.periodSec), input.working));
  const denom = devices * workSec;
  const pct = denom > 0 ? (drivingSec / denom) * 100 : 0;
  const engineHours = (drivingSec + idleSec) / 3600;
  const low = fin(input.exceptionsBySeverity.low);
  const medium = fin(input.exceptionsBySeverity.medium);
  const high = fin(input.exceptionsBySeverity.high);

  return {
    utilization: {
      formula: 'Σ durasi jalan ÷ (jumlah unit aktif × jam kerja pada rentang) × 100',
      substituted:
        denom > 0
          ? `${int(drivingSec)} dtk jalan ÷ (${int(devices)} unit × ${int(workSec)} dtk jam kerja) × 100 = ${one(pct)}%`
          : `Belum bisa dihitung: ${int(devices)} unit aktif × ${int(workSec)} dtk jam kerja = 0 pembagi, jadi ditampilkan ${one(0)}%`,
      source:
        `Trip.drivingDuration + jumlah Device aktif (MyGeotab). Jam kerja BUKAN dari MyGeotab — ` +
        `berasal dari isian Anda di kartu ini: ${int(input.working.hoursPerDay)} jam/hari × ` +
        `${int(input.working.daysPerWeek)} hari/minggu. Ubah isian itu dan persentasenya ikut berubah.`,
      kind: 'heuristik',
    },
    idle: {
      formula: 'Σ Trip.idlingDuration',
      substituted: `${int(idleSec)} dtk idle = ${durationHm(idleSec)}`,
      source: 'Trip.idlingDuration (MyGeotab), dijumlahkan apa adanya tanpa asumsi apa pun.',
      kind: 'terukur',
    },
    engineHours: {
      formula: '(Σ durasi jalan + Σ durasi idle) ÷ 3.600',
      substituted: `(${int(drivingSec)} dtk jalan + ${int(idleSec)} dtk idle) ÷ 3.600 = ${one(engineHours)} jam`,
      source:
        'Trip (MyGeotab). Ini BUKAN pembacaan counter jam mesin kendaraan ' +
        '(StatusData DiagnosticEngineHoursId) — kartu ini tidak membaca counter tersebut, ' +
        'sehingga angkanya bisa berbeda dari jam mesin resmi unit.',
      kind: 'estimasi',
    },
    exceptions: {
      formula: 'Jumlah ExceptionEvent, dikelompokkan per tingkat keparahan',
      substituted: `${int(low + medium + high)} kejadian = ${int(high)} tinggi + ${int(medium)} sedang + ${int(low)} rendah`,
      source:
        'ExceptionEvent + Rule (MyGeotab). Tingkat keparahan diturunkan dari id aturan, ' +
        'bukan namanya — nama aturan bawaan Geotab diterjemahkan per bahasa database. ' +
        'Nama aturan yang ditampilkan diambil dari entity Rule.',
      kind: 'terukur',
    },
  };
}

const STORAGE_PREFIX = 'fleet-analytics:working-hours:';

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

const KIND_LABEL: Record<KpiKind, string> = {
  terukur: 'TERUKUR',
  heuristik: 'HEURISTIK',
  estimasi: 'ESTIMASI',
};

// The terukur/heuristik/estimasi distinction must survive without colour.
const KIND_NOTE: Record<KpiKind, string> = {
  terukur: 'Terukur — dijumlahkan langsung dari data MyGeotab, tanpa asumsi.',
  heuristik: 'Heuristik — sebagian angka berasal dari asumsi yang Anda isi sendiri, bukan dari MyGeotab.',
  estimasi: 'Estimasi — dihitung tidak langsung dari data lain, jadi bukan angka resmi.',
};

/** One card. `extra` carries the working-hours inputs on the utilisation card. */
function renderKpiCard(
  key: KpiExplainKey,
  label: string,
  valueHtml: string,
  caption: string,
  exp: KpiExplanation,
  open: boolean,
  extra = ''
): string {
  const btnId = `fa-kpi-why-btn-${key}`;
  const panelId = `fa-kpi-why-panel-${key}`;
  return `
    <div class="fa-kpi-card">
      <div class="fa-kpi-label">${esc(label)}</div>
      <div class="fa-kpi-value">${valueHtml}</div>
      <p class="fa-kpi-source">
        <span class="fa-kpi-kind fa-kpi-kind-${exp.kind}">${KIND_LABEL[exp.kind]}</span>
        ${esc(caption)}
      </p>
      ${extra}
      <button type="button" class="fa-kpi-why" id="${btnId}" data-why="${key}"
              aria-expanded="${open}" aria-controls="${panelId}">Bagaimana ini dihitung?</button>
      <div class="fa-kpi-detail" id="${panelId}" role="region" aria-labelledby="${btnId}"${open ? '' : ' hidden'}>
        <dl class="fa-kpi-detail-list">
          <dt>Rumus</dt><dd>${esc(exp.formula)}</dd>
          <dt>Angka yang dipakai</dt><dd>${esc(exp.substituted)}</dd>
          <dt>Sumber data</dt><dd>${esc(exp.source)}</dd>
          <dt>Tingkat keyakinan</dt><dd>${esc(KIND_NOTE[exp.kind])}</dd>
        </dl>
      </div>
    </div>`;
}

export function initKpiCards(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  container.classList.add('fa-kpi-cards');

  let working = loadWorkingHours(ctx.database);
  // Which "Bagaimana ini dihitung?" panels are open, kept across re-renders —
  // editing the working-hours inputs must not slam shut the panel that explains
  // what those inputs do.
  const openPanels = new Set<KpiExplainKey>();
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
    const drivingSec = latest.trips.reduce((sum, t) => sum + t.drivingDurationSec, 0);
    const exp = explainKpis({
      drivingSec,
      idleSec: kpis.idleSec,
      deviceCount: latest.deviceCount,
      periodSec: latest.periodSec,
      working,
      exceptionsBySeverity: kpis.exceptionsBySeverity,
    });

    const workingInputs = `
      <div class="fa-kpi-note">
        <label>Jam kerja/hari <input type="number" id="fa-hours-per-day" min="1" max="24" value="${working.hoursPerDay}"></label>
        <label>Hari kerja/minggu <input type="number" id="fa-days-per-week" min="1" max="7" value="${working.daysPerWeek}"></label>
      </div>`;

    container.innerHTML = [
      renderKpiCard(
        'utilization',
        'Utilisasi Armada',
        `${one(kpis.utilizationPct)}%`,
        'Trip (durasi jalan) ÷ jam kerja armada yang Anda isi di bawah',
        exp.utilization,
        openPanels.has('utilization'),
        workingInputs
      ),
      renderKpiCard(
        'idle',
        'Total Waktu Idle',
        durationHm(kpis.idleSec),
        'Penjumlahan Trip.idlingDuration dari MyGeotab',
        exp.idle,
        openPanels.has('idle')
      ),
      renderKpiCard(
        'engineHours',
        'Estimasi Jam Mesin',
        `${one(kpis.engineHoursApprox)}j`,
        'Dihitung dari Trip (jalan + idle), bukan dari counter jam mesin',
        exp.engineHours,
        openPanels.has('engineHours')
      ),
      renderKpiCard(
        'exceptions',
        'Pelanggaran',
        `<span class="fa-badge fa-badge-low">Rendah ${kpis.exceptionsBySeverity.low}</span>` +
          `<span class="fa-badge fa-badge-medium">Sedang ${kpis.exceptionsBySeverity.medium}</span>` +
          `<span class="fa-badge fa-badge-high">Tinggi ${kpis.exceptionsBySeverity.high}</span>`,
        'Jumlah ExceptionEvent per tingkat, nama aturan dari Rule',
        exp.exceptions,
        openPanels.has('exceptions')
      ),
    ].join('');
  }

  // Delegated, so re-rendering the cards (working-hours change, new filter)
  // can't leak a listener per render. Both come off in cleanup.
  function onContainerClick(e: Event) {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.fa-kpi-why');
    if (!btn) return;
    const key = btn.dataset.why as KpiExplainKey;
    const open = !openPanels.has(key);
    if (open) openPanels.add(key);
    else openPanels.delete(key);
    btn.setAttribute('aria-expanded', String(open));
    const panel = btn.nextElementSibling as HTMLElement | null;
    if (panel) panel.hidden = !open;
  }

  function onContainerChange(e: Event) {
    const id = (e.target as HTMLElement | null)?.id;
    if (id === 'fa-hours-per-day' || id === 'fa-days-per-week') onWorkingChange();
  }

  function onWorkingChange() {
    const hours = Number(container.querySelector<HTMLInputElement>('#fa-hours-per-day')!.value);
    const days = Number(container.querySelector<HTMLInputElement>('#fa-days-per-week')!.value);
    working = {
      hoursPerDay: clamp(hours, 1, 24, working.hoursPerDay),
      daysPerWeek: clamp(days, 1, 7, working.daysPerWeek),
    };
    saveWorkingHours(ctx.database, working);
    render(); // delegated listeners survive the innerHTML swap
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
  }


  // Profil Operasi menulis knob ini ke localStorage lalu menyiarkan event ini.
  // Baca ulang dan render dari data yang sudah ada — tidak ada fetch baru.
  function onProfileChange() {
    working = loadWorkingHours(ctx.database);
    render();
  }

  const initial = defaultDateRange();
  load(initial.dateFrom, initial.dateTo);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);
  ctx.rootEl.addEventListener('dashboard:profile-change', onProfileChange);
  container.addEventListener('click', onContainerClick);
  container.addEventListener('change', onContainerChange);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    ctx.rootEl.removeEventListener('dashboard:profile-change', onProfileChange);
    container.removeEventListener('click', onContainerClick);
    container.removeEventListener('change', onContainerChange);
  };
}
