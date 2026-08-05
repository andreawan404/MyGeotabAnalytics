// "Trip Report" — journeys between registered geofences.
//
// A Geotab Trip is ignition-on -> ignition-off, so the chaining that turns three
// raw trips into one Cikarang -> Priok journey lives in analytics/trip-report.ts
// (pure, self-checked). This file only fetches, renders and cleans up.
//
// Cost: zones + trips + devices (all cached and shared with other views), and
// the fuel ladder only when the database actually reports a cumulative counter.

import '../styles/trip-report.css';
import { fetchZones } from '../api/fetchers/zone';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchDiagnostics, resolveCumulativeFuelDiagnosticId } from '../api/fetchers/diagnostic';
import { probeDiagnostics } from '../api/fetchers/probe';
import { fetchStatusData } from '../api/fetchers/status-data';
import { fuelPerTrip } from '../analytics/trip-detail';
import { buildJourneys, summariseUnmatched, type JourneyRow } from '../analytics/trip-report';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import type { ViewCtx } from './registry';
import { esc, int, upto1 } from '../utils/format';
import { renderExplainCard, bindExplainToggles } from '../components/kpi-explain';
import { exportButtonHtml, bindExport } from '../components/export-button';
import { summarizeTripReport } from '../analytics/summary';
import type { TripDTO, ZoneDTO, DeviceLite, FilterChangeDetail } from '../api/fetchers/types';

const DEFAULT_DWELL_MINUTES = 15;
const STORAGE_PREFIX = 'fleet-analytics:trip-report-dwell:';
const MAX_ROWS = 200; // a worklist, not an export

function loadDwell(database: string): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_PREFIX + database));
    return Number.isFinite(n) && n > 0 && n <= 720 ? n : DEFAULT_DWELL_MINUTES;
  } catch {
    return DEFAULT_DWELL_MINUTES; // private mode
  }
}

function formatDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Snapshot {
  trips: TripDTO[];
  zones: ZoneDTO[];
  devices: DeviceLite[];
  fuelByTrip: Record<string, number | null>;
}

export function initTripReportView(container: HTMLElement, ctx: ViewCtx): () => void {
  let dwellMinutes = loadDwell(ctx.database);
  // Panel penjelasan yang terbuka bertahan melewati render ulang: mengubah ambang
  // berhenti tidak boleh membanting tutup panel yang menjelaskan ambang itu.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);
  let snapshot: Snapshot | null = null;
  let seq = 0;

  /** Same ladder as the trip timeline tooltip: resolve the cumulative counter by
   *  id, probe it, and only then pull StatusData. Unavailable -> no extra call. */
  async function loadFuel(
    trips: TripDTO[],
    fromIso: string,
    toIso: string,
    groupIds?: string[]
  ): Promise<Record<string, number | null>> {
    if (trips.length === 0) return {};
    try {
      const diagnostics = await fetchDiagnostics({ database: ctx.database });
      const diagnosticId = resolveCumulativeFuelDiagnosticId(diagnostics);
      if (!diagnosticId) return {};

      const probe = await probeDiagnostics({
        database: ctx.database,
        diagnosticIds: [diagnosticId],
        toIso,
        groupIds,
      });
      if (probe[diagnosticId] !== true) return {};

      const rows = await fetchStatusData({
        database: ctx.database,
        diagnosticId,
        fromDate: fromIso,
        toDate: toIso,
        groupIds,
      });
      return fuelPerTrip(trips, rows);
    } catch (err) {
      // Fuel is a column, not the report. Losing it must not lose the journeys.
      console.warn('trip-report: fuel unavailable', err);
      return {};
    }
  }

  async function load(filter: FilterChangeDetail): Promise<void> {
    const run = ++seq;
    container.innerHTML = '<p class="fa-loading">Memuat laporan perjalanan…</p>';
    const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
    const groupIds = filter.groupIds;

    try {
      const [trips, zones, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupIds }),
        fetchZones({ database: ctx.database }),
        fetchDevices({ database: ctx.database, groupIds, fromDate: fromIso, toDate: toIso }),
      ]);
      if (run !== seq) return;

      const fuelByTrip = await loadFuel(trips, fromIso, toIso, groupIds);
      if (run !== seq) return;

      snapshot = { trips, zones, devices, fuelByTrip };
      render();
    } catch (err) {
      if (run !== seq) return;
      console.error('trip-report: load failed', err);
      container.innerHTML =
        '<p class="fa-empty fa-error">Gagal memuat laporan perjalanan. Periksa koneksi atau hak akses, lalu ubah filter untuk mencoba lagi.</p>';
    }
  }

  function controls(): string {
    return `
      <div class="tr-controls">
        <label class="tr-field">Ambang berhenti (menit)
          <input type="number" id="tr-dwell" min="1" max="720" step="5" value="${dwellMinutes}">
        </label>
        <span class="tr-hint">Berhenti lebih singkat dari ini dianggap masih satu perjalanan — mis. mampir isi BBM tidak memecah perjalanan jadi dua.
          Tabel dihitung ulang setelah Anda keluar dari kolom ini (klik di luar atau tekan Tab), bukan saat mengetik.</span>
      </div>`;
  }

  function row(r: JourneyRow, anyFuel: boolean): string {
    return `
      <tr>
        <td>${esc(r.deviceName)}</td>
        <td>
          <div class="tr-zone">${esc(r.fromZone.name)}</div>
          <div class="tr-when">${esc(formatWhen(r.departAt))}</div>
        </td>
        <td>
          <div class="tr-zone">${esc(r.toZone.name)}${r.isRoundTrip ? '<button type="button" class="tr-badge fa-term-link" data-term="pulang-pergi">pulang-pergi</button>' : ''}</div>
          <div class="tr-when">${esc(formatWhen(r.arriveAt))}</div>
        </td>
        <td class="tr-num">${esc(formatDur(r.durationSec))}</td>
        <td class="tr-num">${upto1(r.distanceKm)}</td>
        ${anyFuel ? `<td class="tr-num">${r.fuelL === null ? '<span class="tr-na">—</span>' : upto1(r.fuelL)}</td>` : ''}
        <td class="tr-num">${int(r.stops)}</td>
      </tr>`;
  }

  function render(): void {
    if (!snapshot) return;
    const { trips, zones, devices, fuelByTrip } = snapshot;

    // Each empty state names its own cause. A blank table just looks broken.
    if (zones.length === 0) {
      container.innerHTML =
        '<p class="fa-empty">Belum ada geofence/zona terdaftar di database ini. Buat zona dulu di MyGeotab — laporan ini menyusun perjalanan dari zona ke zona.</p>';
      return;
    }
    if (trips.length === 0) {
      container.innerHTML = '<p class="fa-empty">Tidak ada perjalanan pada rentang tanggal ini.</p>';
      return;
    }

    const rows = buildJourneys(trips, zones, devices, { dwellMinutes, fuelByTrip });
    const unmatched = summariseUnmatched(trips, rows);
    const anyFuel = rows.some((r) => r.fuelL !== null);

    if (rows.length === 0) {
      container.innerHTML = `
        ${controls()}
        <p class="fa-empty">Ada ${int(trips.length)} perjalanan pada rentang ini, tapi tidak ada yang berawal DAN berakhir di zona terdaftar
        (total ${upto1(unmatched.distanceKm)} km). Tambahkan geofence di lokasi yang sering dikunjungi agar muncul di sini.</p>`;
      return;
    }

    const shown = rows.slice(0, MAX_ROWS);
    const roundTrips = rows.filter((r) => r.isRoundTrip).length;
    container.innerHTML = `
      <p class="fa-summary">${esc(
        summarizeTripReport({
          journeys: rows.length,
          roundTrips,
          tripCount: trips.length,
          unmatchedTrips: unmatched.trips,
          unmatchedKm: unmatched.distanceKm,
          zoneCount: zones.length,
          dwellMinutes,
        })
      )}</p>
      ${controls()}
      <div class="fa-kpi-row">
        ${renderExplainCard({
          key: 'tr-journeys',
          label: 'Perjalanan Tersusun',
          valueHtml: int(rows.length),
          caption: `Dari ${int(trips.length)} trip mentah MyGeotab, digabung pada ambang ${int(dwellMinutes)} menit`,
          explain: {
            formula:
              'Trip berurutan dari unit yang sama digabung jadi satu perjalanan selama jeda antar trip lebih pendek dari ambang berhenti',
            substituted:
              `${int(trips.length)} trip → ${int(rows.length)} perjalanan zona-ke-zona` +
              (roundTrips ? `, ${int(roundTrips)} di antaranya pulang-pergi (berakhir di zona asal)` : ''),
            source:
              'Trip + Zone (MyGeotab). Tiga hal yang perlu diketahui sebelum memakai angkanya: (1) kolom Durasi ' +
              'menghitung waktu dari berangkat sampai tiba TERMASUK berhenti di tengah, bukan hanya waktu jalan; ' +
              '(2) kalau titik berada di dalam beberapa zona yang bertumpuk, yang dipilih adalah poligon TERKECIL, ' +
              'sehingga "Gudang A" menang atas "Kawasan Industri"; (3) kolom BBM dikosongkan kalau ada SATU saja ' +
              'ruas perjalanan yang tidak terukur — separuh angka lebih menyesatkan daripada tidak ada angka.',
            kind: 'terukur',
          },
          open: openPanels.has('tr-journeys'),
        })}
      </div>
      <div class="fa-export-bar">${exportButtonHtml('trip')}</div>
      <div class="tr-tablewrap">
        <table class="fa-table tr-table">
          <thead><tr>
            <th>Unit</th><th>Dari</th><th>Ke</th>
            <th class="tr-num">Durasi</th><th class="tr-num">Jarak (km)</th>
            ${anyFuel ? '<th class="tr-num">BBM (L)</th>' : ''}
            <th class="tr-num">Berhenti</th>
          </tr></thead>
          <tbody>${shown.map((r) => row(r, anyFuel)).join('')}</tbody>
        </table>
      </div>
      ${rows.length > shown.length ? `<p class="tr-note">Menampilkan ${int(shown.length)} dari ${int(rows.length)} perjalanan.</p>` : ''}
      ${
        unmatched.trips > 0
          ? `<p class="tr-note">${int(unmatched.trips)} perjalanan lain berakhir di luar zona terdaftar (total ${upto1(unmatched.distanceKm)} km) — tidak muncul di tabel ini.</p>`
          : ''
      }
      ${
        anyFuel
          ? ''
          : '<p class="tr-note">Kolom BBM disembunyikan: database ini tidak melaporkan counter bahan bakar mesin, jadi konsumsi per perjalanan tidak terukur.</p>'
      }`;
  }

  // Changing the dwell threshold only re-chains data we already hold — no refetch.
  function onInput(e: Event): void {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.id !== 'tr-dwell') return;
    const n = Number(el.value);
    if (!Number.isFinite(n) || n <= 0 || n > 720) return;
    dwellMinutes = n;
    try {
      localStorage.setItem(STORAGE_PREFIX + ctx.database, String(n));
    } catch {
      /* private mode — the setting just will not persist */
    }
    render();
  }


  // Profil Operasi menulis knob ini ke localStorage lalu menyiarkan event ini.
  // Baca ulang dan render dari data yang sudah ada — tidak ada fetch baru.
  // Export mengambil SELURUH perjalanan hasil filter, bukan 200 yang tampil.
  // Batas itu ada supaya browser tidak berat merender; orang meng-export justru
  // untuk mengolah yang tidak muat di layar.
  const stopExport = bindExport(container, () => {
    if (!snapshot) return null;
    const { trips, zones, devices, fuelByTrip } = snapshot;
    const rows = buildJourneys(trips, zones, devices, { dwellMinutes, fuelByTrip });
    const anyFuel = rows.some((r) => r.fuelL !== null);
    return {
      filenameBase: 'laporan-perjalanan',
      headers: ['Unit', 'Dari', 'Berangkat', 'Ke', 'Tiba', 'Durasi', 'Jarak (km)',
        ...(anyFuel ? ['BBM (L)'] : []), 'Berhenti', 'Pulang-pergi'],
      rows: rows.map((r) => [
        r.deviceName, r.fromZone.name, formatWhen(r.departAt), r.toZone.name, formatWhen(r.arriveAt),
        formatDur(r.durationSec), upto1(r.distanceKm),
        ...(anyFuel ? [r.fuelL === null ? null : upto1(r.fuelL)] : []),
        int(r.stops), r.isRoundTrip ? 'Ya' : 'Tidak',
      ]),
    };
  });

  const onProfileChange = (): void => {
    dwellMinutes = loadDwell(ctx.database);
    render();
  };
  ctx.rootEl.addEventListener('dashboard:profile-change', onProfileChange);

  container.addEventListener('change', onInput);
  const stopFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  return () => {
    seq++; // in-flight loads become stale and will not paint
    ctx.rootEl.removeEventListener('dashboard:profile-change', onProfileChange);
    container.removeEventListener('change', onInput);
    stopExplain();
    stopExport();
    stopFilter();
  };
}
