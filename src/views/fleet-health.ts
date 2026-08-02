// "Monitoring Kesehatan Armada" — engine fault (DTC) health for the fleet.
// All the impure work lives here: fetching, Chart.js, DOM. The math is in
// ../analytics/fleet-health.ts and stays pure so its .check.ts runs under tsx.

import { Chart, registerables } from 'chart.js';
import '../styles/fleet-health.css';
import { fetchFaultData } from '../api/fetchers/fault-data';
import { fetchDiagnostics } from '../api/fetchers/diagnostic';
import { fetchDevices } from '../api/fetchers/device';
import { probeDiagnostics, WELL_KNOWN_DIAGNOSTICS } from '../api/fetchers/probe';
import { fetchStatusDataMulti } from '../api/fetchers/status-data';
import type { DiagnosticDTO, DeviceLite, StatusDataDTO, FilterChangeDetail } from '../api/fetchers/types';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import type { ViewCtx } from './registry';
import {
  activeFaults,
  healthSummary,
  rankVehiclesByFault,
  topFaultCodes,
  type FaultCodeTally,
} from '../analytics/fleet-health';

Chart.register(...registerables);

/** Rows shown in the two tables. Beyond this nobody scrolls; the point is a
 *  worklist, not an export. */
const TABLE_ROWS = 15;
/** Engine-hours/odometer window: the freshest reading per device, not a series.
 *  2 days matches probe.ts's lookback so a parked vehicle still reports. */
const USAGE_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/** Modest on purpose — we only keep one max per device out of these rows. */
const USAGE_LIMIT = 5000;

export function initFleetHealthView(container: HTMLElement, ctx: ViewCtx): () => void {
  container.innerHTML = `
    <div class="fa-kpi-row fh-kpi" data-fh="kpi" hidden></div>
    <section class="fh-panel" data-fh="chart" hidden>
      <h2 class="fh-title">Kode Fault Terbanyak</h2>
      <div class="fh-chart-box"><canvas></canvas></div>
    </section>
    <section data-fh="faults"></section>
    <section data-fh="usage"></section>
  `;

  const kpiEl = panel('kpi');
  const chartEl = panel('chart');
  const faultsEl = panel('faults');
  const usageEl = panel('usage');

  let chart: Chart | null = null;
  let latestTop: FaultCodeTally[] = [];
  // Every async continuation checks this: a filter change (or teardown) while a
  // fetch is in flight must not let the stale response paint over the new one.
  let runId = 0;

  function panel(name: string): HTMLElement {
    return container.querySelector<HTMLElement>(`[data-fh="${name}"]`)!;
  }

  async function load(filter: FilterChangeDetail): Promise<void> {
    const run = ++runId;
    const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);

    faultsEl.innerHTML = '<p class="fa-empty">Memuat data kesehatan armada…</p>';
    usageEl.innerHTML = '';
    hideChart();
    kpiEl.hidden = true;

    let diagnostics: DiagnosticDTO[];
    let devices: DeviceLite[];
    try {
      const [faults, diags, devs] = await Promise.all([
        fetchFaultData({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId: filter.groupId }),
        fetchDiagnostics({ database: ctx.database }),
        fetchDevices({ database: ctx.database, groupId: filter.groupId, fromDate: fromIso, toDate: toIso }),
      ]);
      if (run !== runId) return;
      diagnostics = diags;
      devices = devs;

      if (faults.length === 0) {
        // KPIs stay hidden deliberately: "0 dari 42 unit bermasalah" would read as
        // a clean bill of health when the real answer is "we received nothing".
        faultsEl.innerHTML = `<p class="fa-empty">Tidak ada data fault engine pada rentang ini — perangkat perlu koneksi OBD/J1939 dan kendaraan yang melaporkan DTC.</p>`;
      } else {
        const active = activeFaults(faults);
        renderKpis(healthSummary(faults, devices));
        latestTop = topFaultCodes(faults, diagnostics, 10);
        renderChart();
        // The worklist is built from ACTIVE faults only — a red lamp that already
        // cleared is history, not a job for the workshop.
        renderFaultTable(rankVehiclesByFault(active, devices));
      }
    } catch (err) {
      console.error('fleet-health: load failed', err);
      if (run !== runId) return;
      faultsEl.innerHTML = '<p class="fa-error">Gagal memuat data fault. Coba muat ulang atau persempit rentang tanggal.</p>';
      return;
    }

    // Usage is independent of faults and much slower (probe + StatusData), so it
    // is awaited separately — the fault panels are already on screen by now.
    await loadUsage(run, toIso, filter.groupId, diagnostics, devices);
  }

  // Active / Pending / resolved are disjoint and sum to the row count — the three
  // counts come from healthSummary rather than being re-derived here, so no card
  // can drift out of step with the others.
  function renderKpis(s: ReturnType<typeof healthSummary>): void {
    kpiEl.hidden = false;
    kpiEl.innerHTML = `
      ${kpiCard('Unit Bermasalah', `${s.devicesWithActiveFaults} dari ${s.totalDevices}`, `${s.pctAffected.toFixed(1)}% armada`)}
      ${kpiCard('Lampu Kritis (MIL)', String(s.criticalLampCount), 'Fault aktif dengan lampu MIL / stop merah')}
      ${kpiCard('Fault Aktif', String(s.activeCount), 'Terkonfirmasi ECU, belum ditangani')}
      ${kpiCard('Perlu Dipantau', String(s.pendingCount), 'Pending — terdeteksi, belum dikonfirmasi ECU')}
      ${kpiCard('Fault Ditolak/Selesai', String(s.resolvedCount), 'Sudah dismiss atau sudah hilang sendiri')}
    `;
  }

  function kpiCard(label: string, value: string, note: string): string {
    return `
      <div class="fa-kpi-card">
        <div class="fa-kpi-label">${esc(label)}</div>
        <div class="fa-kpi-value">${esc(value)}</div>
        <div class="fa-kpi-note">${esc(note)}</div>
      </div>`;
  }

  function hideChart(): void {
    chart?.destroy();
    chart = null;
    latestTop = [];
    chartEl.hidden = true;
  }

  function renderChart(): void {
    chart?.destroy();
    chart = null;
    if (latestTop.length === 0) {
      chartEl.hidden = true;
      return;
    }
    chartEl.hidden = false;

    // A chart constructed inside a hidden view measures 0x0 and stays that way.
    // Leave the panel populated-but-chartless; `dashboard:view-shown` builds it
    // the moment this view actually has a width. (Same trap that bit the heat map.)
    if (container.clientWidth <= 0) return;

    const box = chartEl.querySelector<HTMLElement>('.fh-chart-box')!;
    box.innerHTML = '<canvas></canvas>';

    chart = new Chart(box.querySelector('canvas')!, {
      type: 'bar',
      data: {
        labels: latestTop.map((t) => truncate(t.name, 44)),
        datasets: [{ label: 'Kejadian', data: latestTop.map((t) => t.occurrences), backgroundColor: cssVar('--fa-accent', '#3b82f6') }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Jumlah kejadian' } } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              // Spread matters as much as volume: 400 hits on one truck is a
              // different problem from 400 spread over the fleet.
              afterLabel: (item) => `${latestTop[item.dataIndex]?.deviceCount ?? 0} unit terdampak`,
            },
          },
        },
      },
    });
  }

  function renderFaultTable(rows: ReturnType<typeof rankVehiclesByFault>): void {
    if (rows.length === 0) {
      faultsEl.innerHTML = '<p class="fa-empty">Ada data fault pada rentang ini, tapi tidak ada yang masih aktif — semua sudah selesai atau sudah di-dismiss.</p>';
      return;
    }
    const shown = rows.slice(0, TABLE_ROWS);
    faultsEl.innerHTML = `
      <h2 class="fh-title">Unit Perlu Perhatian</h2>
      <table class="fa-table">
        <thead><tr><th>Unit</th><th>Lampu Kritis</th><th>Fault Aktif</th><th>Terakhir</th></tr></thead>
        <tbody>
          ${shown
            .map(
              (r) => `<tr>
                <td>${esc(r.deviceName)}</td>
                <td>${r.criticalLamps > 0 ? `<span class="fh-critical">${r.criticalLamps}</span>` : '0'}</td>
                <td>${r.activeCount}</td>
                <td>${esc(formatDateTime(r.lastFaultAt))}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${rows.length > shown.length ? `<p class="fh-note">Menampilkan ${shown.length} dari ${rows.length} unit bermasalah.</p>` : ''}
    `;
  }

  async function loadUsage(
    run: number,
    toIso: string,
    groupId: string | undefined,
    diagnostics: DiagnosticDTO[],
    devices: DeviceLite[]
  ): Promise<void> {
    const engineHoursId = WELL_KNOWN_DIAGNOSTICS.engineHours;
    const odometerId = WELL_KNOWN_DIAGNOSTICS.odometerAdjustment;

    try {
      const available = await probeDiagnostics({
        database: ctx.database,
        diagnosticIds: [engineHoursId, odometerId],
        toIso,
        groupId,
      });
      if (run !== runId) return;

      // Unavailable diagnostics are omitted entirely — a column of zeros would be
      // read as "these trucks never ran", which is a different claim from
      // "this database does not report the value".
      const wanted = [engineHoursId, odometerId].filter((id) => available[id]);
      if (wanted.length === 0) {
        usageEl.innerHTML = '<p class="fa-empty">Jam mesin & odometer tidak dilaporkan oleh perangkat di grup ini.</p>';
        return;
      }

      const fromIso = new Date(Date.parse(toIso) - USAGE_LOOKBACK_MS).toISOString();
      const byDiagnostic = await fetchStatusDataMulti({
        database: ctx.database,
        diagnosticIds: wanted,
        fromDate: fromIso,
        toDate: toIso,
        groupId,
        resultsLimit: USAGE_LIMIT,
      });
      if (run !== runId) return;

      renderUsageTable(wanted, byDiagnostic, diagnostics, devices, available);
    } catch (err) {
      console.error('fleet-health: usage load failed', err);
      if (run !== runId) return;
      usageEl.innerHTML = '<p class="fa-error">Gagal memuat jam mesin / odometer.</p>';
    }
  }

  function renderUsageTable(
    wanted: string[],
    byDiagnostic: Record<string, StatusDataDTO[]>,
    diagnostics: DiagnosticDTO[],
    devices: DeviceLite[],
    available: Record<string, boolean>
  ): void {
    const unitById = new Map(diagnostics.map((d) => [d.id, d.unitOfMeasureId]));
    const nameById = new Map(devices.map((d) => [d.id, d.name]));
    const maxByDiagnostic = new Map(wanted.map((id) => [id, maxPerDevice(byDiagnostic[id] ?? [])]));

    const deviceIds = [...new Set(wanted.flatMap((id) => [...maxByDiagnostic.get(id)!.keys()]))];
    if (deviceIds.length === 0) {
      usageEl.innerHTML = '<p class="fa-empty">Belum ada pembacaan jam mesin / odometer dalam 2 hari terakhir.</p>';
      return;
    }

    const sortId = wanted[0];
    deviceIds.sort((a, b) => (maxByDiagnostic.get(sortId)!.get(b) ?? -1) - (maxByDiagnostic.get(sortId)!.get(a) ?? -1));
    const shown = deviceIds.slice(0, TABLE_ROWS);

    const columns = wanted.map((id) => ({
      id,
      label: id === WELL_KNOWN_DIAGNOSTICS.engineHours ? 'Jam Mesin' : 'Odometer',
      unit: unitById.get(id),
    }));
    const missing = [WELL_KNOWN_DIAGNOSTICS.engineHours, WELL_KNOWN_DIAGNOSTICS.odometerAdjustment].filter(
      (id) => !available[id]
    );

    usageEl.innerHTML = `
      <h2 class="fh-title">Jam Mesin / Odometer (terbaru)</h2>
      <table class="fa-table">
        <thead><tr><th>Unit</th>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${shown
            .map(
              (deviceId) => `<tr>
                <td>${esc(nameById.get(deviceId) ?? deviceId)}</td>
                ${columns
                  .map((c) => {
                    const value = maxByDiagnostic.get(c.id)!.get(deviceId);
                    return `<td>${value === undefined ? '—' : esc(formatUsage(value, c.unit))}</td>`;
                  })
                  .join('')}
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="fh-note">
        Nilai tertinggi per unit dalam 2 hari terakhir.
        ${deviceIds.length > shown.length ? `Menampilkan ${shown.length} dari ${deviceIds.length} unit.` : ''}
        ${missing.length ? `Kolom ${missing.map((id) => (id === WELL_KNOWN_DIAGNOSTICS.engineHours ? 'jam mesin' : 'odometer')).join(' & ')} disembunyikan: tidak dilaporkan perangkat di grup ini.` : ''}
      </p>
    `;
  }

  // `dashboard:view-shown` is broadcast on the shared rootEl for EVERY view —
  // including the ones that just hid us — so the width guard is what makes it
  // safe, not the event itself.
  function onShown(): void {
    if (container.clientWidth <= 0) return;
    if (chart) chart.resize();
    else if (latestTop.length > 0) renderChart();
  }

  ctx.rootEl.addEventListener('dashboard:view-shown', onShown);
  const stopFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  return () => {
    runId++; // in-flight loads become stale and will not touch the DOM
    ctx.rootEl.removeEventListener('dashboard:view-shown', onShown);
    stopFilter();
    chart?.destroy();
    chart = null;
  };
}

/** Freshest reading per device: StatusData is cumulative for both engine hours
 *  and odometer, so the max in the window IS the latest. */
function maxPerDevice(rows: StatusDataDTO[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const current = out.get(r.deviceId);
    if (current === undefined || r.value > current) out.set(r.deviceId, r.value);
  }
  return out;
}

/** Converts only against Geotab's declared unit. An unrecognised unit prints the
 *  raw number rather than guessing a scale factor and being confidently wrong. */
function formatUsage(value: number, unitOfMeasureId?: string): string {
  if (unitOfMeasureId === 'UnitOfMeasureSecondsId') return `${(value / 3600).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`;
  if (unitOfMeasureId === 'UnitOfMeasureMetersId') return `${(value / 1000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} km`;
  return value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Chart.js needs a concrete color string, so read the shared palette instead of
 *  hardcoding a second blue next to dashboard.css's. */
function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Device and diagnostic names are customer-entered free text landing in
 *  innerHTML. ponytail: 4 lines beats a DOM-building refactor of every table. */
function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}
