// "Monitoring Kesehatan Armada" — engine fault (DTC) health for the fleet.
// All the impure work lives here: fetching, Chart.js, DOM. The math is in
// ../analytics/fleet-health.ts and stays pure so its .check.ts runs under tsx.

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
import { esc, int, one } from '../utils/format';
import { renderExplainCard, bindExplainToggles } from '../components/kpi-explain';
import { summarizeFleetHealth } from '../analytics/summary';
import { exportButtonHtml, bindExport } from '../components/export-button';
import {
  activeFaults,
  healthSummary,
  rankVehiclesByFault,
  topFaultCodes,
  faultsForDevices,
  type FaultCodeTally,
  type DeviceFaultDetail,
} from '../analytics/fleet-health';

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
    <p class="fa-summary" data-fh="summary" hidden></p>
    <div class="fa-kpi-row fh-kpi" data-fh="kpi" hidden></div>
    <section class="fh-panel" data-fh="chart" hidden>
      <h2 class="fh-title">Kode Fault Terbanyak</h2>
      <div class="fh-chart-box"><canvas></canvas></div>
    </section>
    <section data-fh="faults"></section>
    <section data-fh="usage"></section>
  `;

  const kpiEl = panel('kpi');
  const summaryEl = panel('summary');
  const chartEl = panel('chart');
  const faultsEl = panel('faults');
  const usageEl = panel('usage');

  // Panel penjelasan yang terbuka bertahan melewati render ulang — ganti filter
  // tidak boleh membanting tutup penjelasan yang sedang dibaca.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);

  /** Peringkat unit hasil render terakhir — export memakai SELURUHNYA, bukan 15
   *  baris yang tampil di tabel. */
  let lastRank: ReturnType<typeof rankVehiclesByFault> = [];

  const stopExport = bindExport(container, () => {
    if (lastRank.length === 0) return null;
    return {
      filenameBase: 'kesehatan-armada',
      headers: ['Unit', 'Lampu Kritis', 'Fault Aktif', 'Fault Terakhir'],
      rows: lastRank.map((r) => [
        r.deviceName, int(r.criticalLamps), int(r.activeCount), formatDateTime(r.lastFaultAt),
      ]),
    };
  });

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

    faultsEl.innerHTML = '<p class="fa-loading">Memuat data kesehatan armada…</p>';
    usageEl.innerHTML = '';
    hideChart();
    kpiEl.hidden = true;

    let diagnostics: DiagnosticDTO[];
    let devices: DeviceLite[];
    try {
      const [faults, diags, devs] = await Promise.all([
        fetchFaultData({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupIds: filter.groupIds }),
        fetchDiagnostics({ database: ctx.database }),
        fetchDevices({ database: ctx.database, groupIds: filter.groupIds, fromDate: fromIso, toDate: toIso }),
      ]);
      if (run !== runId) return;
      diagnostics = diags;
      devices = devs;

      if (faults.length === 0) {
        // KPIs stay hidden deliberately: "0 dari 42 unit bermasalah" would read as
        // a clean bill of health when the real answer is "we received nothing".
        summaryEl.textContent = summarizeFleetHealth(null);
        summaryEl.hidden = false;
        faultsEl.innerHTML =
          `<p class="fa-empty">Tidak ada data fault engine pada rentang ini — perangkat perlu koneksi ` +
          `<button type="button" class="fa-term-link" data-term="obd">OBD/J1939</button> dan kendaraan yang melaporkan ` +
          `<button type="button" class="fa-term-link" data-term="dtc">DTC</button>. Kosong di sini bukan berarti armada sehat.</p>`;
      } else {
        const active = activeFaults(faults);
        renderKpis(healthSummary(faults, devices));
        latestTop = topFaultCodes(faults, diagnostics, 10);
        renderChart();
        // The worklist is ranked on ACTIVE faults only — a red lamp that already
        // cleared is history, not a job for the workshop. The expandable detail
        // then shows Active AND Pending so a mechanic sees what to watch too.
        renderFaultTable(rankVehiclesByFault(active, devices), faultsForDevices(faults, diagnostics));
      }
    } catch (err) {
      console.error('fleet-health: load failed', err);
      if (run !== runId) return;
      faultsEl.innerHTML = '<p class="fa-error">Gagal memuat data fault. Coba muat ulang atau persempit rentang tanggal.</p>';
      return;
    }

    // Usage is independent of faults and much slower (probe + StatusData), so it
    // is awaited separately — the fault panels are already on screen by now.
    await loadUsage(run, toIso, filter.groupIds, diagnostics, devices);
  }

  // Active / Pending / resolved are disjoint and sum to the row count — the three
  // counts come from healthSummary rather than being re-derived here, so no card
  // can drift out of step with the others.
  // Setiap kartu membawa panel "Bagaimana ini dihitung?". Yang paling penting
  // dibuka di sini adalah dua keputusan yang sebelumnya hanya hidup sebagai
  // komentar kode: lampu kuning SENGAJA tidak dihitung kritis, dan Pending
  // SENGAJA tidak dihitung aktif. Keduanya mengubah angka secara besar, jadi
  // user berhak menolaknya kalau tidak setuju.
  function renderKpis(s: ReturnType<typeof healthSummary>): void {
    kpiEl.hidden = false;
    summaryEl.textContent = summarizeFleetHealth(s);
    summaryEl.hidden = false;
    kpiEl.innerHTML = [
      renderExplainCard({
        key: 'fh-affected',
        label: 'Unit Bermasalah',
        valueHtml: `${int(s.devicesWithActiveFaults)} dari ${int(s.totalDevices)}`,
        caption: 'Unit dengan minimal satu fault aktif yang belum di-dismiss',
        explain: {
          formula: 'Jumlah unit berbeda yang punya ≥1 fault aktif ÷ jumlah unit di filter × 100',
          substituted: `${int(s.devicesWithActiveFaults)} unit ÷ ${int(s.totalDevices)} unit × 100 = ${one(s.pctAffected)}%`,
          source:
            'FaultData + Device (MyGeotab). Satu unit dihitung sekali walau melapor puluhan fault. ' +
            'Yang sudah di-dismiss teknisi dan yang sudah hilang sendiri tidak masuk hitungan.',
          kind: 'terukur',
        },
        open: openPanels.has('fh-affected'),
      }),
      renderExplainCard({
        key: 'fh-lamp',
        label: 'Lampu Kritis (MIL)',
        valueHtml: int(s.criticalLampCount),
        caption: 'Fault aktif yang menyalakan lampu MIL / stop merah',
        explain: {
          formula: 'Jumlah fault aktif yang status lampunya cocok dengan malfunction / red stop / stop',
          substituted: `${int(s.criticalLampCount)} dari ${int(s.activeCount)} fault aktif`,
          source:
            'FaultData.faultLampState (MyGeotab). Lampu kuning/amber SENGAJA tidak dihitung: lampu itu sifatnya ' +
            'anjuran, dan di armada mana pun yang punya satu sensor emisi macet, memasukkan amber membuat KPI ini ' +
            'merah terus sehingga tidak berguna. Buka tabel di bawah untuk melihat seluruh fault per unit.',
          kind: 'terukur',
        },
        open: openPanels.has('fh-lamp'),
      }),
      renderExplainCard({
        key: 'fh-active',
        label: 'Fault Aktif',
        valueHtml: int(s.activeCount),
        caption: 'Terkonfirmasi ECU, belum ditangani',
        explain: {
          formula: 'Jumlah baris FaultData berstatus Active yang belum di-dismiss',
          substituted: `${int(s.activeCount)} aktif + ${int(s.pendingCount)} pending + ${int(s.resolvedCount)} selesai/ditolak`,
          source:
            'FaultData.faultState (MyGeotab). Aktif, Pending, dan selesai/ditolak saling lepas dan jumlahnya ' +
            'sama dengan total baris — tidak ada fault yang terhitung dua kali di antara ketiga kartu ini.',
          kind: 'terukur',
        },
        open: openPanels.has('fh-active'),
      }),
      renderExplainCard({
        key: 'fh-pending',
        label: 'Perlu Dipantau',
        valueHtml: int(s.pendingCount),
        caption: 'Pending — terdeteksi, belum dikonfirmasi ECU',
        explain: {
          formula: 'Jumlah baris FaultData berstatus Pending yang belum di-dismiss',
          substituted: `${int(s.pendingCount)} fault pending`,
          source:
            'FaultData.faultState (MyGeotab). Pending berarti ECU baru melihat gejalanya sekali dan belum ' +
            'mengkonfirmasi — konfirmasi butuh siklus berkendara kedua. Sengaja TIDAK digabung ke Fault Aktif: ' +
            'menggabungkannya menggelembungkan daftar kerja bengkel dengan hal yang bisa hilang sendiri.',
          kind: 'terukur',
        },
        open: openPanels.has('fh-pending'),
      }),
      renderExplainCard({
        key: 'fh-resolved',
        label: 'Fault Ditolak/Selesai',
        valueHtml: int(s.resolvedCount),
        caption: 'Sudah dismiss atau sudah hilang sendiri',
        explain: {
          formula: 'Total baris FaultData − (aktif + pending)',
          substituted: `${int(s.resolvedCount)} dari ${int(s.activeCount + s.pendingCount + s.resolvedCount)} baris fault pada rentang ini`,
          source:
            'FaultData (MyGeotab): baris yang sudah di-dismiss teknisi, atau yang statusnya sudah bukan ' +
            'Active/Pending lagi. Ditampilkan supaya angka yang hilang dari ketiga kartu di sebelah kiri ' +
            'bisa dilacak, bukan sebagai daftar kerja.',
          kind: 'terukur',
        },
        open: openPanels.has('fh-resolved'),
      }),
    ].join('');
  }

  function hideChart(): void {
    latestTop = [];
    chartEl.hidden = true;
  }

  /**
   * HTML bars, not a canvas. Geotab fault names run long ("Telematics device
   * fault: internal reset initiated…") and a Chart.js category axis truncates
   * them to an ellipsis, which is precisely the label a user needs to read.
   * Real text wraps, is selectable, is reachable by a screen reader, and needs
   * no width guard or resize handling — so this panel also stops depending on
   * the 0x0-inside-a-hidden-view dance the canvas required.
   *
   * Counts are printed as text next to every bar rather than living in a
   * tooltip: hover-only values are unreadable on touch and to assistive tech.
   */
  function renderChart(): void {
    if (latestTop.length === 0) {
      chartEl.hidden = true;
      return;
    }
    chartEl.hidden = false;

    const max = Math.max(...latestTop.map((t) => t.occurrences), 1);
    const box = chartEl.querySelector<HTMLElement>('.fh-chart-box')!;

    box.innerHTML = `
      <ol class="fh-bars">
        ${latestTop
          .map((t, i) => {
            const pct = Math.max((t.occurrences / max) * 100, 2); // never a zero-width sliver
            return `
              <li class="fh-bar-row">
                <span class="fh-bar-rank" aria-hidden="true">${i + 1}</span>
                <div class="fh-bar-main">
                  <div class="fh-bar-head">
                    <span class="fh-bar-name">${esc(t.name)}</span>
                    <span class="fh-bar-count"><strong>${t.occurrences.toLocaleString('id-ID')}</strong> kejadian</span>
                  </div>
                  <div class="fh-bar-track">
                    <div class="fh-bar-fill${i === 0 ? ' is-top' : ''}" style="width:${pct.toFixed(1)}%"></div>
                  </div>
                  <div class="fh-bar-meta">${t.deviceCount.toLocaleString('id-ID')} unit terdampak</div>
                </div>
              </li>`;
          })
          .join('')}
      </ol>
      <p class="fh-note">Diurutkan dari kejadian terbanyak. "Unit terdampak" memisahkan satu unit yang melapor berkali-kali dari masalah yang menyebar ke banyak unit.</p>
    `;
  }

  function renderFaultTable(
    rows: ReturnType<typeof rankVehiclesByFault>,
    detailByDevice: Record<string, DeviceFaultDetail[]>
  ): void {
    if (rows.length === 0) {
      faultsEl.innerHTML = '<p class="fa-empty">Ada data fault pada rentang ini, tapi tidak ada yang masih aktif — semua sudah selesai atau sudah di-dismiss.</p>';
      return;
    }
    lastRank = rows; // export memakai SELURUHNYA, bukan TABLE_ROWS yang tampil
    const shown = rows.slice(0, TABLE_ROWS);
    faultsEl.innerHTML = `
      <h2 class="fh-title">Unit Perlu Perhatian ${exportButtonHtml('health')}</h2>
      <table class="fa-table fh-table">
        <thead><tr><th></th><th>Unit</th>
          <th><button type="button" class="fa-term-link" data-term="mil">Lampu Kritis</button></th>
          <th>Fault Aktif</th><th>Terakhir</th></tr></thead>
        <tbody>
          ${shown.map((r, i) => faultRow(r, detailByDevice[r.deviceId] ?? [], i)).join('')}
        </tbody>
      </table>
      ${rows.length > shown.length ? `<p class="fh-note">Menampilkan ${shown.length} dari ${rows.length} unit bermasalah.</p>` : ''}
    `;
  }

  function faultRow(
    r: ReturnType<typeof rankVehiclesByFault>[number],
    details: DeviceFaultDetail[],
    i: number
  ): string {
    const id = `fh-detail-${i}`;
    // A real <button> with aria-expanded/aria-controls: the row must open by
    // keyboard and be announced as a disclosure, not just react to a click.
    return `
      <tr class="fh-row">
        <td class="fh-toggle-cell">
          <button type="button" class="fh-toggle" aria-expanded="false" aria-controls="${id}"
                  aria-label="Lihat daftar fault ${esc(r.deviceName)}" data-target="${id}">
            <span class="fh-chevron" aria-hidden="true"></span>
          </button>
        </td>
        <td>${esc(r.deviceName)}</td>
        <td>${r.criticalLamps > 0 ? `<span class="fh-critical">${r.criticalLamps}</span>` : '0'}</td>
        <td>${r.activeCount}</td>
        <td>${esc(formatDateTime(r.lastFaultAt))}</td>
      </tr>
      <tr class="fh-detail-row" id="${id}" hidden>
        <td colspan="5">${detailList(details)}</td>
      </tr>`;
  }

  function detailList(details: DeviceFaultDetail[]): string {
    if (details.length === 0) {
      return '<p class="fh-detail-empty">Tidak ada fault terbuka pada unit ini di rentang yang dipilih.</p>';
    }
    return `
      <ul class="fh-detail-list">
        ${details
          .map(
            (d) => `
              <li class="fh-detail-item">
                <span class="fh-chip fh-chip-${d.state}">${d.state === 'active' ? 'AKTIF' : 'PANTAU'}</span>
                <div class="fh-detail-main">
                  <div class="fh-detail-name">
                    ${esc(d.name)}
                    ${d.criticalLamp ? '<span class="fh-chip fh-chip-lamp">LAMPU KRITIS</span>' : ''}
                  </div>
                  <div class="fh-detail-meta">
                    ${esc(formatDateTime(d.dateTime))}
                    · ${d.count.toLocaleString('id-ID')}× kejadian
                    ${d.controllerName ? `· ${esc(d.controllerName)}` : ''}
                  </div>
                </div>
              </li>`
          )
          .join('')}
      </ul>`;
  }

  async function loadUsage(
    run: number,
    toIso: string,
    groupIds: string[] | undefined,
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
        groupIds,
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
        groupIds,
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

  // One delegated listener on the container, not one per row: the table is
  // re-rendered on every filter change, and per-row handlers would have to be
  // re-attached (and leaked) each time.
  function onToggle(e: Event): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.fh-toggle');
    if (!btn) return;
    const row = document.getElementById(btn.dataset.target ?? '');
    if (!row) return;
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    row.hidden = open;
  }


  container.addEventListener('click', onToggle);
  const stopFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  // No `dashboard:view-shown` listener any more: this view has no canvas left,
  // and HTML bars need no re-measure when the view becomes visible.
  return () => {
    runId++; // in-flight loads become stale and will not touch the DOM
    container.removeEventListener('click', onToggle);
    stopExplain();
    stopExport();
    stopFilter();
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

