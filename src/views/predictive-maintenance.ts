// "Predictive Maintenance" — the impure half. All DOM, Chart.js and fetcher work
// lives here; the math is in ../analytics/predictive.ts, which stays pure so its
// check runs under plain `tsx`.
//
// What this view refuses to do, deliberately: there is NO composite risk score.
// Geotab has no ML endpoint and the database holds no service history unless the
// customer runs Maintenance Reminders, so a single blended number would be a
// weighting nobody can see and nobody can argue with. Instead every signal is a
// separate column, each carries a terukur/heuristik chip, and the only aggregate
// is a flag COUNT the user can decompose by eye.

import '../styles/predictive-maintenance.css';
import { Chart, registerables } from 'chart.js';

import { probeDiagnostics, WELL_KNOWN_DIAGNOSTICS } from '../api/fetchers/probe';
import { fetchStatusDataMulti } from '../api/fetchers/status-data';
import { fetchFaultData } from '../api/fetchers/fault-data';
import { fetchDvirDefects } from '../api/fetchers/dvir-log';
import { fetchDevices } from '../api/fetchers/device';
import type { FilterChangeDetail, FaultDataDTO, DvirDefectDTO, StatusDataDTO } from '../api/fetchers/types';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import type { ViewCtx } from './registry';
import { esc, clamp as clampNumber, int } from '../utils/format';
import { renderExplainCard, bindExplainToggles } from '../components/kpi-explain';
import { openGlossary } from '../components/glossary';
import { summarizePredictive } from '../analytics/summary';
import {
  latestValuePerDevice,
  chronicFaults,
  faultTrendRatio,
  flagsForDevice,
  monthlyFaultCounts,
  TREND_THRESHOLD,
  TREND_NO_BASELINE,
  type DeviceSignals,
} from '../analytics/predictive';

Chart.register(...registerables);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Trends need history, so faults are pulled on their own trailing window and
 *  the UI says so loudly — this range deliberately ignores the filter's dateFrom. */
const FAULT_WINDOW_DAYS = 90;
/** Odometer/engine hours are a "latest reading" lookup, not a range query. Same
 *  lookback probe.ts uses, so a parked vehicle still reports. */
const LATEST_READING_DAYS = 2;

const STORAGE_PREFIX = 'fleet-analytics:service-interval:';
const DEFAULT_INTERVAL = { km: 10000, hours: 250 };

interface ServiceInterval {
  km: number;
  hours: number;
}

interface Loaded {
  devices: { id: string; name: string }[];
  odometerKm?: Record<string, number>;
  engineHours?: Record<string, number>;
  faults: FaultDataDTO[];
  defects: DvirDefectDTO[];
  toIso: string;
}

// --- persistence -----------------------------------------------------------

function loadInterval(database: string): ServiceInterval {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + database);
    if (!raw) return { ...DEFAULT_INTERVAL };
    const parsed = JSON.parse(raw);
    return {
      km: clampNumber(Number(parsed?.km), 1, 1_000_000, DEFAULT_INTERVAL.km),
      hours: clampNumber(Number(parsed?.hours), 1, 100_000, DEFAULT_INTERVAL.hours),
    };
  } catch {
    return { ...DEFAULT_INTERVAL }; // private mode / corrupt value — defaults are fine
  }
}

function saveInterval(database: string, interval: ServiceInterval): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + database, JSON.stringify(interval));
  } catch {
    /* storage unavailable — the setting just won't persist */
  }
}

// --- formatting ------------------------------------------------------------

function num(n: number): string {
  return int(Math.round(n));
}

/** Kelas chip yang sama dengan yang dipakai kartu KPI di seluruh dashboard —
 *  sebelumnya halaman ini punya sistem chip sendiri (fa-pm-chip-*) yang terlihat
 *  berbeda untuk arti yang persis sama. Sekaligus dibuat bisa diklik: sampai
 *  sekarang tidak ada satu pun tempat yang menjelaskan apa arti "heuristik". */
function chip(kind: 'terukur' | 'heuristik'): string {
  return `<button type="button" class="fa-kpi-kind fa-kpi-kind-${kind} fa-kpi-kind-btn" data-term="${kind}"
    aria-label="Apa arti ${kind}?">${kind}</button>`;
}

function formatTrend(ratio: number | undefined): string {
  if (ratio === undefined) return '<span class="fa-pm-muted">&ndash;</span>';
  // The sentinel means "no baseline to divide by", not a 999x increase.
  if (ratio === TREND_NO_BASELINE) return 'baru';
  return `${ratio.toFixed(1)}&times;`;
}

// --- view ------------------------------------------------------------------

interface Column {
  key: string;
  label: string;
  /** Omitted for the identity column — "Unit" is a name, not a signal to source. */
  kind?: 'terukur' | 'heuristik';
  /** id istilah glosarium untuk judul yang tidak bisa ditebak dari namanya. */
  term?: string;
  show: boolean;
  /** Sort value. undefined always sorts last, in both directions. */
  value: (r: DeviceSignals) => number | string | undefined;
  cell: (r: DeviceSignals) => string;
}

export function initPredictiveView(container: HTMLElement, ctx: ViewCtx): () => void {
  container.innerHTML = `
    <p class="fa-summary" data-pm="summary" hidden></p>
    <div class="fa-kpi-row" data-pm="kpis"></div>
    <div data-pm="controls"></div>
    <div class="fa-pm-panel" data-pm="chart-panel" hidden>
      <div class="fa-pm-panel-head">
        <h3 class="fa-pm-title">Jumlah fault per bulan</h3>
        ${chip('terukur')}
        <span class="fa-pm-note">tren 90 hari terakhir &mdash; sengaja tidak mengikuti filter tanggal</span>
      </div>
      <div class="fa-pm-chart"><canvas data-pm="canvas"></canvas></div>
    </div>
    <div data-pm="table"></div>
  `;

  const pick = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-pm="${name}"]`)!;
  const kpisEl = pick('kpis');
  const summaryEl = pick('summary');
  const controlsEl = pick('controls');
  const chartPanel = pick('chart-panel');
  const canvas = pick<HTMLCanvasElement>('canvas');
  const tableEl = pick('table');

  // Panel "Bagaimana ini dihitung?" yang terbuka bertahan melewati render ulang:
  // mengubah interval servis tidak boleh membanting tutup panel yang justru
  // sedang menjelaskan apa arti interval itu.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);

  let data: Loaded | null = null;
  let chart: Chart | null = null;
  let interval = loadInterval(ctx.database);
  let sortKey = 'flags';
  let sortDir: 1 | -1 = -1;
  let disposed = false;

  async function load(filter: FilterChangeDetail) {
    kpisEl.innerHTML = '<p class="fa-empty">Memuat data prediktif&hellip;</p>';
    try {
      const { toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
      const toMs = Date.parse(toIso);
      const faultFromIso = new Date(toMs - FAULT_WINDOW_DAYS * DAY_MS).toISOString();
      const latestFromIso = new Date(toMs - LATEST_READING_DAYS * DAY_MS).toISOString();
      const groupId = filter.groupId;

      // Which of these does this database actually report? Availability varies
      // per OEM, so we ask the SHARED probe rather than firing our own.
      const { odometer, odometerAdjustment, engineHours } = WELL_KNOWN_DIAGNOSTICS;
      const available = await probeDiagnostics({
        database: ctx.database,
        diagnosticIds: [odometerAdjustment, odometer, engineHours],
        toIso,
        groupId,
      });
      // Adjustment first: it is the odometer value corrected for device swaps,
      // which is the one a service interval should be counted against.
      const odoId: string | null = available[odometerAdjustment]
        ? odometerAdjustment
        : available[odometer]
          ? odometer
          : null;
      const hoursId: string | null = available[engineHours] ? engineHours : null;
      const wanted = [odoId, hoursId].filter((id): id is string => id !== null);

      const [status, faults, defects, devices] = await Promise.all([
        wanted.length
          ? fetchStatusDataMulti({
              database: ctx.database,
              diagnosticIds: wanted,
              fromDate: latestFromIso,
              toDate: toIso,
              groupId,
            })
          : Promise.resolve({} as Record<string, StatusDataDTO[]>),
        fetchFaultData({ database: ctx.database, fromDate: faultFromIso, toDate: toIso, groupId }),
        fetchDvirDefects({ database: ctx.database, fromDate: faultFromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: faultFromIso, toDate: toIso }),
      ]);

      if (disposed) return;

      data = {
        devices: devices.map((d) => ({ id: d.id, name: d.name })),
        odometerKm: odoId ? scale(latestValuePerDevice(status[odoId] ?? []), 1 / 1000) : undefined,
        engineHours: hoursId ? scale(latestValuePerDevice(status[hoursId] ?? []), 1 / 3600) : undefined,
        faults,
        defects,
        toIso,
      };
      render();
    } catch (err) {
      console.error('predictive-maintenance: load failed', err);
      data = null;
      kpisEl.innerHTML = '';
      controlsEl.innerHTML = '';
      chartPanel.hidden = true;
      tableEl.innerHTML = '<p class="fa-error">Gagal memuat data predictive maintenance.</p>';
    }
  }

  // ponytail: Geotab reports the odometer diagnostics in METRES and engine hours
  // in SECONDS. If these columns ever read ~1000x or ~3600x off, this factor is
  // the first thing to check — the API does not tell us the unit per row.
  function scale(latest: Record<string, { value: number }>, factor: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [deviceId, v] of Object.entries(latest)) out[deviceId] = v.value * factor;
    return out;
  }

  function render() {
    if (!data) return;

    const hasOdometer = !!data.odometerKm && Object.keys(data.odometerKm).length > 0;
    const hasHours = !!data.engineHours && Object.keys(data.engineHours).length > 0;
    const hasFaults = data.faults.length > 0;
    const hasDvir = data.defects.length > 0;

    const chronic = chronicFaults(data.faults);
    const trend = faultTrendRatio(data.faults, data.toIso);
    const rows = flagsForDevice({
      devices: data.devices,
      odometerKm: hasOdometer ? data.odometerKm : undefined,
      engineHours: hasHours ? data.engineHours : undefined,
      intervalKm: interval.km,
      intervalHours: interval.hours,
      chronic,
      trend,
      defects: data.defects,
      faults: data.faults,
    });

    // Geotab's own signal is null far more often than not — an all-null column is
    // noise, so it disappears entirely rather than showing a wall of dashes.
    const hasRisk = rows.some((r) => r.riskOfBreakdown !== undefined);

    summaryEl.textContent = summarizePredictive({
      rows,
      chronicSeries: chronic.length,
      hasOdometer,
      hasFaults,
      hasDvir,
      intervalKm: interval.km,
    });
    summaryEl.hidden = false;

    renderKpis(rows, chronic.length, hasOdometer, hasFaults, hasDvir);
    renderControls(hasOdometer, hasHours);
    renderChart(hasFaults ? monthlyFaultCounts(data.faults) : []);
    renderTable(rows, { hasOdometer, hasHours, hasFaults, hasRisk, hasDvir });
  }

  function renderKpis(
    rows: DeviceSignals[],
    chronicSeries: number,
    hasOdometer: boolean,
    hasFaults: boolean,
    hasDvir: boolean
  ) {
    const cards: string[] = [];
    // No odometer => the service card is DROPPED, not zeroed. A "0 unit perlu
    // servis" card on a database that cannot measure it is a lie.
    if (hasOdometer) {
      const due = rows.filter((r) => r.flags.includes('Servis jatuh tempo')).length;
      cards.push(
        renderExplainCard({
          key: 'pm-service',
          label: 'Unit Perlu Servis',
          valueHtml: num(due),
          caption: `Sisa jarak ke kelipatan interval ${num(interval.km)} km sudah menipis`,
          explain: {
            formula: 'sisa = interval − (odometer mod interval); ditandai bila sisa di bawah ambang',
            substituted: `${num(due)} dari ${num(rows.length)} unit, dengan interval ${num(interval.km)} km / ${num(interval.hours)} jam mesin`,
            source:
              'StatusData odometer (MyGeotab) — terukur. Jadwalnya TIDAK terukur: MyGeotab tidak menyimpan riwayat ' +
              'servis kecuali database ini memakai Maintenance Reminders, jadi perhitungan ini mengasumsikan setiap ' +
              'servis terjadi tepat pada kelipatan interval yang Anda isi di bawah. Kalau armada Anda baru saja ' +
              'servis di luar kelipatan itu, angkanya akan meleset — ubah intervalnya agar cocok.',
            kind: 'heuristik',
          },
          open: openPanels.has('pm-service'),
        })
      );
    }
    if (hasFaults) {
      const worsening = rows.filter((r) => r.trendRatio !== undefined && r.trendRatio > TREND_THRESHOLD).length;
      cards.push(
        renderExplainCard({
          key: 'pm-chronic',
          label: 'Fault Kronis',
          valueHtml: num(chronicSeries),
          caption: 'Kerusakan yang sama berulang di unit yang sama',
          explain: {
            formula: 'Pasangan (unit, jenis kerusakan) yang muncul di ≥3 hari BERBEDA dalam 90 hari terakhir',
            substituted: `${num(chronicSeries)} pasangan unit-kerusakan memenuhi syarat`,
            source:
              'FaultData + Diagnostic (MyGeotab). Yang dihitung hari berbeda, bukan jumlah kejadian — satu unit ' +
              'yang melapor 400 kali dalam sehari BUKAN kronis, itu satu insiden. Pengelompokan harinya memakai ' +
              'tanggal UTC, jadi kejadian larut malam waktu Indonesia bisa terhitung ke hari berikutnya.',
            kind: 'terukur',
          },
          open: openPanels.has('pm-chronic'),
        })
      );
      cards.push(
        renderExplainCard({
          key: 'pm-trend',
          label: 'Tren Memburuk',
          valueHtml: num(worsening),
          caption: `Fault 30 hari terakhir lebih dari ${TREND_THRESHOLD}× periode sebelumnya`,
          explain: {
            formula: 'rasio = jumlah fault 30 hari terakhir ÷ jumlah fault 30 hari sebelumnya',
            substituted: `${num(worsening)} unit punya rasio di atas ${TREND_THRESHOLD}×`,
            source:
              'FaultData 90 hari terakhir (MyGeotab) — sengaja mengabaikan tanggal mulai pada filter, karena tren ' +
              'butuh riwayat. Unit yang tidak punya fault sama sekali di periode sebelumnya ditulis "baru", bukan ' +
              'angka: pembaginya nol, jadi rasionya tak terhingga. Ambang 1,5× adalah pilihan kami, bukan standar industri.',
            kind: 'heuristik',
          },
          open: openPanels.has('pm-trend'),
        })
      );
    }
    if (hasDvir) {
      const openDefects = rows.reduce((s, r) => s + r.openDefects, 0);
      cards.push(
        renderExplainCard({
          key: 'pm-dvir',
          label: 'Defect DVIR Terbuka',
          valueHtml: num(openDefects),
          caption: 'Kerusakan yang dilaporkan sopir dan belum diperbaiki',
          explain: {
            formula: 'Jumlah defect DVIR 90 hari terakhir yang statusnya bukan Repaired',
            substituted: `${num(openDefects)} defect terbuka di ${num(rows.filter((r) => r.openDefects > 0).length)} unit`,
            source:
              'DVIRLog (MyGeotab). Ini satu-satunya sinyal di halaman ini yang datang dari mata manusia, bukan ' +
              'sensor — sopir bisa melihat ban gundul dan kaca retak yang tidak akan pernah muncul sebagai fault ECU. ' +
              'Kosong berarti armada Anda belum memakai DVIR, bukan berarti tidak ada kerusakan.',
            kind: 'terukur',
          },
          open: openPanels.has('pm-dvir'),
        })
      );
    }
    kpisEl.innerHTML = cards.join('');
  }

  function renderControls(hasOdometer: boolean, hasHours: boolean) {
    if (!hasOdometer && !hasHours) {
      controlsEl.innerHTML = '';
      return;
    }
    controlsEl.innerHTML = `
      <div class="fa-pm-panel">
        <div class="fa-pm-panel-head">
          <h3 class="fa-pm-title">Interval servis</h3>
          ${chip('heuristik')}
        </div>
        <div class="fa-pm-controls">
          <label>Interval km
            <input type="number" data-pm="interval-km" min="1" step="500" value="${interval.km}">
          </label>
          <label>Interval jam mesin
            <input type="number" data-pm="interval-hours" min="1" step="10" value="${interval.hours}">
          </label>
        </div>
        <p class="fa-pm-caveat">
          Geotab tidak menyimpan riwayat servis (kecuali database ini memakai Maintenance Reminders).
          Sisa km/jam di bawah dihitung dengan asumsi setiap servis terjadi tepat pada kelipatan interval
          di atas &mdash; angka odometer terukur, jadwalnya perkiraan. Ubah interval di sini bila armada
          Anda memakai standar lain; nilai disimpan per database di browser ini.
        </p>
      </div>`;

    const kmEl = pick<HTMLInputElement>('interval-km');
    const hoursEl = pick<HTMLInputElement>('interval-hours');
    const onIntervalChange = () => {
      interval = {
        km: clampNumber(Number(kmEl.value), 1, 1_000_000, interval.km),
        hours: clampNumber(Number(hoursEl.value), 1, 100_000, interval.hours),
      };
      saveInterval(ctx.database, interval);
      render(); // recompute from the data already in memory — no refetch
    };
    // Listeners live on nodes that render() throws away, so there is nothing to
    // detach on cleanup: the elements go with the container.
    kmEl.addEventListener('change', onIntervalChange);
    hoursEl.addEventListener('change', onIntervalChange);
  }

  function renderChart(points: { month: string; count: number }[]) {
    // No faults => no chart at all. A line pinned to zero looks like a measured
    // result; it isn't one.
    if (points.length === 0) {
      chartPanel.hidden = true;
      chart?.destroy();
      chart = null;
      return;
    }
    chartPanel.hidden = false;

    const labels = points.map((p) => p.month);
    const values = points.map((p) => p.count);

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.update();
      return;
    }
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Fault', data: values, borderColor: '#3b82f6', tension: 0.25 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function renderTable(
    rows: DeviceSignals[],
    flags: { hasOdometer: boolean; hasHours: boolean; hasFaults: boolean; hasRisk: boolean; hasDvir: boolean }
  ) {
    if (!flags.hasOdometer && !flags.hasFaults && !flags.hasDvir) {
      tableEl.innerHTML = `
        <p class="fa-empty">
          Tidak ada sinyal prediktif pada database ini: odometer tidak dilaporkan perangkat,
          tidak ada FaultData, dan tidak ada defect DVIR dalam 90 hari terakhir.
          Modul ini tidak menampilkan angka yang tidak bisa diukur.
        </p>`;
      return;
    }
    if (rows.length === 0) {
      tableEl.innerHTML = '<p class="fa-empty">Tidak ada unit pada filter grup ini.</p>';
      return;
    }

    const allColumns: Column[] = [
      {
        key: 'name',
        label: 'Unit',
        show: true,
        value: (r) => r.deviceName,
        cell: (r) => esc(r.deviceName),
      },
      {
        key: 'service',
        label: 'Sisa ke servis',
        kind: 'heuristik',
        show: flags.hasOdometer,
        value: (r) => r.serviceDueKm,
        cell: (r) => {
          const km = r.serviceDueKm === undefined ? '<span class="fa-pm-muted">&ndash;</span>' : `${num(r.serviceDueKm)} km`;
          const hrs =
            r.serviceDueHours === undefined ? '' : ` <span class="fa-pm-muted">&middot; ${num(r.serviceDueHours)} j</span>`;
          return km + hrs;
        },
      },
      {
        key: 'chronic',
        label: 'Fault kronis',
        kind: 'terukur',
        show: flags.hasFaults,
        value: (r) => r.chronicCount,
        cell: (r) => (r.chronicCount ? String(r.chronicCount) : '<span class="fa-pm-muted">0</span>'),
      },
      {
        key: 'trend',
        label: 'Tren',
        kind: 'heuristik',
        show: flags.hasFaults,
        value: (r) => r.trendRatio,
        cell: (r) => formatTrend(r.trendRatio),
      },
      {
        key: 'risk',
        // Sebelumnya kolom ini berjudul "riskOfBreakdown" — nama field API mentah,
        // camelCase, tanpa satuan dan tanpa skala. Geotab tidak mendokumentasikan
        // skalanya, jadi judulnya kini menyebutkan siapa yang menghitungnya dan
        // sisanya diserahkan ke glosarium.
        label: 'Risiko Breakdown (Geotab)',
        term: 'risk-of-breakdown',
        kind: 'terukur',
        show: flags.hasRisk,
        value: (r) => r.riskOfBreakdown,
        cell: (r) =>
          r.riskOfBreakdown === undefined ? '<span class="fa-pm-muted">&ndash;</span>' : r.riskOfBreakdown.toFixed(2),
      },
      {
        key: 'dvir',
        label: 'DVIR terbuka',
        kind: 'terukur',
        show: flags.hasDvir,
        value: (r) => r.openDefects,
        cell: (r) => (r.openDefects ? String(r.openDefects) : '<span class="fa-pm-muted">0</span>'),
      },
      {
        key: 'flags',
        label: 'Jumlah flag',
        // Inherits the weakest input: two of the five flags rest on a heuristic
        // threshold, so the total cannot claim to be measured.
        kind: 'heuristik',
        show: true,
        value: (r) => r.flags.length,
        // Nama flag-nya dicetak sebagai teks, bukan tooltip title=. title= hanya
        // muncul saat hover: tidak terjangkau di layar sentuh dan tidak terbaca
        // oleh pembaca layar — persis kebalikan dari yang dibutuhkan orang yang
        // sedang mencoba memahami kenapa sebuah unit ditandai.
        cell: (r) =>
          `<span class="fa-pm-flagcount" data-flagged="${r.flags.length > 0}">${r.flags.length}</span>` +
          (r.flags.length ? `<span class="fa-pm-flagnames">${esc(r.flags.join(', '))}</span>` : ''),
      },
    ];
    const columns = allColumns.filter((c) => c.show);

    const sorted = sortRows(rows, columns);

    const head = columns
      .map(
        (c) => `<th scope="col">
          <span class="fa-pm-th">
            <button type="button" class="fa-pm-sort" data-sort="${c.key}"${
              c.key === sortKey ? ` aria-sort="${sortDir === 1 ? 'ascending' : 'descending'}"` : ''
            }>${c.label}${c.key === sortKey ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}</button>
            ${c.term ? `<button type="button" class="fa-term-link" data-term="${c.term}" aria-label="Apa itu ${esc(c.label)}?">?</button>` : ''}
            ${c.kind ? chip(c.kind) : ''}
          </span>
        </th>`
      )
      .join('');

    const body = sorted
      .map((r) => `<tr>${columns.map((c) => `<td>${c.cell(r)}</td>`).join('')}</tr>`)
      .join('');

    // The window note is not decoration: the fault columns intentionally ignore
    // the date filter, and a table that lies about its own range is worse than
    // no table.
    tableEl.innerHTML = `
      <div class="fa-pm-panel">
        <div class="fa-pm-panel-head">
          <h3 class="fa-pm-title">Tabel inspeksi</h3>
          <span class="fa-pm-note">
            Odometer &amp; jam mesin: pembacaan terakhir (jendela ${LATEST_READING_DAYS} hari sebelum akhir filter).
            Fault &amp; DVIR: ${FAULT_WINDOW_DAYS} hari terakhir &mdash; sengaja mengabaikan tanggal mulai pada filter,
            karena tren butuh riwayat. Klik judul kolom untuk mengurutkan.
          </span>
        </div>
        <div class="fa-pm-scroll">
          <table class="fa-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        </div>
        ${flags.hasOdometer ? '' : '<p class="fa-empty">Odometer tidak dilaporkan perangkat pada database ini &mdash; kartu dan kolom servis disembunyikan.</p>'}
        ${flags.hasFaults ? '' : '<p class="fa-empty">Tidak ada FaultData dalam 90 hari terakhir &mdash; menampilkan sinyal DVIR saja.</p>'}
      </div>`;

    for (const btn of tableEl.querySelectorAll<HTMLButtonElement>('.fa-pm-sort')) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort!;
        if (key === sortKey) sortDir = sortDir === 1 ? -1 : 1;
        else {
          sortKey = key;
          sortDir = key === 'name' ? 1 : -1; // names read best A-Z, numbers worst-first
        }
        renderTable(rows, flags);
      });
    }
  }

  function sortRows(rows: DeviceSignals[], columns: Column[]): DeviceSignals[] {
    const col = columns.find((c) => c.key === sortKey) ?? columns[columns.length - 1];
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // "No reading" is not "zero" — those rows go last whichever way we sort.
      if (av === undefined) return bv === undefined ? 0 : 1;
      if (bv === undefined) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp * sortDir;
    });
  }

  // `dashboard:view-shown` is broadcast on the SHARED rootEl for every view,
  // including the ones that hide us. Resizing a chart whose container is 0px wide
  // is what left the heat map rendering into a zero-width canvas — only act when
  // we are actually the visible view.
  function onViewShown() {
    if (container.clientWidth > 0) chart?.resize();
  }


  // Profil Operasi menulis knob ini ke localStorage lalu menyiarkan event ini.
  // Baca ulang dan render dari data yang sudah ada — tidak ada fetch baru.
  const onProfileChange = () => {
    interval = loadInterval(ctx.database);
    render();
  };
  ctx.rootEl.addEventListener('dashboard:profile-change', onProfileChange);

  // Judul kolom yang tidak bisa ditebak dari namanya membuka glosarium.
  const onTermClick = (e: Event): void => {
    const term = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-term]')?.dataset.term;
    if (term) openGlossary(term);
  };
  container.addEventListener('click', onTermClick);

  const offFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  ctx.rootEl.addEventListener('dashboard:view-shown', onViewShown);
  load(getCurrentFilter());

  return () => {
    disposed = true;
    offFilter();
    ctx.rootEl.removeEventListener('dashboard:profile-change', onProfileChange);
    ctx.rootEl.removeEventListener('dashboard:view-shown', onViewShown);
    container.removeEventListener('click', onTermClick);
    stopExplain();
    chart?.destroy();
    chart = null;
  };
}
