// "Safety Behaviour" — exception events normalised into a coachable ranking.
//
// The whole view is built around one decision: rank by events per 100 km, not by
// raw counts. Raw counts rank the busiest truck first every single time, which
// tells a fleet manager nothing they didn't already know. Normalising by distance
// is what makes a 4000 km/week unit comparable to a 200 km/week one.
//
// All aggregation lives in ../analytics/safety.ts (pure, self-checked). This file
// only fetches, renders and cleans up.

import { Chart, registerables } from 'chart.js';
import '../styles/safety.css';
import { fetchExceptionEvents } from '../api/fetchers/exception-event';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchDrivers } from '../api/fetchers/driver';
import type { ExceptionEventDTO, TripDTO, DeviceLite, DriverLite, FilterChangeDetail } from '../api/fetchers/types';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import type { ViewCtx } from './registry';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  categoryBreakdown,
  dailyTrend,
  driverAttributionRate,
  eventsPer100Km,
  rankDevices,
  rankDrivers,
  topCategoryByDevice,
} from '../analytics/safety';

Chart.register(...registerables);

/** Below this, a per-driver ranking is fiction — see the note it renders instead. */
const ATTRIBUTION_GATE = 0.5;

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Chart colors are read from the dashboard.css palette rather than re-invented,
 *  so a theme change moves the charts too. */
function palette(): string[] {
  const s = getComputedStyle(document.documentElement);
  return ['--fa-high-fg', '--fa-med-fg', '--fa-accent', '--fa-low-fg', '--fa-danger', '--fa-muted', '--fa-border']
    .map((v) => s.getPropertyValue(v).trim())
    .map((c, i) => c || ['#b91c1c', '#b45309', '#3b82f6', '#1d4ed8', '#b91c1c', '#6b7280', '#e2e5e9'][i]);
}

export function initSafetyView(container: HTMLElement, ctx: ViewCtx): () => void {
  const charts: Chart[] = [];
  // Filter changes can arrive faster than a fetch resolves. Without this, a slow
  // old response can land after a fast new one and render stale data.
  let loadSeq = 0;

  function destroyCharts(): void {
    while (charts.length) charts.pop()!.destroy();
  }

  async function load(filter: FilterChangeDetail): Promise<void> {
    const seq = ++loadSeq;
    destroyCharts();
    container.innerHTML = '<p class="fa-empty">Memuat data keselamatan…</p>';

    try {
      const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
      const groupId = filter.groupId;
      const [events, trips, devices, drivers] = await Promise.all([
        fetchExceptionEvents({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
        // Driver names are a nicety; a permission error here must not blank the view.
        fetchDrivers({ database: ctx.database }).catch((err) => {
          console.warn('safety: fetchDrivers failed, continuing without names', err);
          return [] as DriverLite[];
        }),
      ]);

      if (seq !== loadSeq) return; // a newer load won
      render(events, trips, devices, drivers, fromIso, toIso);
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error('safety: load failed', err);
      container.innerHTML =
        '<p class="fa-empty fa-error">Gagal memuat data keselamatan. Periksa koneksi atau hak akses database, lalu ubah filter untuk mencoba lagi.</p>';
    }
  }

  function render(
    events: ExceptionEventDTO[],
    trips: TripDTO[],
    devices: DeviceLite[],
    drivers: DriverLite[],
    fromIso: string,
    toIso: string
  ): void {
    // Degrade with a REASON. An empty chart looks like a broken chart.
    if (events.length === 0) {
      const why = trips.length
        ? 'Tidak ada pelanggaran (exception event) pada rentang tanggal ini. Data perjalanan tersedia, jadi kemungkinan besar memang tidak ada pelanggaran — atau belum ada Rule keselamatan yang aktif di database ini.'
        : 'Tidak ada pelanggaran maupun perjalanan pada rentang tanggal ini. Coba perlebar rentang tanggal atau pilih grup lain.';
      container.innerHTML = `<p class="fa-empty">${why}</p>`;
      return;
    }

    const breakdown = categoryBreakdown(events);
    const perDevice = eventsPer100Km(events, trips);
    const ranked = rankDevices(perDevice, devices);
    const topCat = topCategoryByDevice(events);
    const trend = dailyTrend(events, fromIso, toIso);
    const attribution = driverAttributionRate(trips);

    const totalKm = trips.reduce((n, t) => n + (t.distanceKm || 0), 0);
    const fleetPer100 = totalKm > 0 ? (events.length / totalKm) * 100 : null;

    container.innerHTML = `
      <div class="fa-safety">
        <div class="fa-kpi-row">
          ${kpi('Total Pelanggaran', nf0.format(events.length))}
          ${kpi('Pelanggaran / 100 km (armada)', fleetPer100 === null ? '—' : nf2.format(fleetPer100))}
          ${kpi('Pengereman Mendadak', nf0.format(breakdown['harsh-braking']))}
          ${kpi('Kecepatan Berlebih', nf0.format(breakdown.speeding))}
        </div>

        <div>
          <p class="fa-safety-caveat">
            <span class="fa-safety-flag">heuristik</span>
            ExceptionEvent dari MyGeotab <strong>tidak memuat besaran pelanggaran</strong> — misalnya berapa km/jam
            kelebihan kecepatannya, atau seberapa keras pengeremannya. Yang tersedia hanya durasi kejadian. Jadi setiap
            pelanggaran dihitung sama beratnya di halaman ini; durasi tidak dipakai sebagai bobot keparahan.
          </p>
          <p class="fa-safety-caveat">
            Peringkat memakai <strong>pelanggaran per 100 km</strong>, bukan jumlah mentah. Jumlah mentah selalu
            menempatkan unit paling sibuk di urutan teratas, sehingga tidak berguna untuk coaching.
          </p>
        </div>

        <div class="fa-safety-charts">
          <div class="fa-safety-card">
            <h3>Komposisi Pelanggaran</h3>
            <div class="fa-safety-canvas"><canvas id="fa-safety-cat"></canvas></div>
          </div>
          <div class="fa-safety-card">
            <h3>Tren Harian</h3>
            <div class="fa-safety-canvas"><canvas id="fa-safety-trend"></canvas></div>
          </div>
        </div>

        <section class="fa-safety-section">
          <h2>Peringkat Unit — terburuk ke terbaik</h2>
          <div class="fa-safety-tablewrap">${deviceTable(ranked, topCat)}</div>
        </section>

        <section class="fa-safety-section">
          <h2>Peringkat Pengemudi</h2>
          ${driverSection(events, trips, drivers, attribution)}
        </section>
      </div>
    `;

    const colors = palette();

    // Only the categories that actually occurred — a doughnut with four 0-value
    // slices in the legend reads as missing data.
    const present = CATEGORIES.filter((c) => breakdown[c] > 0);
    const catCanvas = container.querySelector<HTMLCanvasElement>('#fa-safety-cat');
    if (catCanvas) {
      charts.push(
        new Chart(catCanvas, {
          type: 'doughnut',
          data: {
            labels: present.map((c) => CATEGORY_LABELS[c]),
            datasets: [
              {
                data: present.map((c) => breakdown[c]),
                backgroundColor: present.map((c) => colors[CATEGORIES.indexOf(c) % colors.length]),
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
          },
        })
      );
    }

    const trendCanvas = container.querySelector<HTMLCanvasElement>('#fa-safety-trend');
    if (trendCanvas) {
      charts.push(
        new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: trend.map((d) => d.date.slice(5)), // MM-DD; the year is in the filter
            datasets: [
              {
                label: 'Pelanggaran',
                data: trend.map((d) => d.count),
                borderColor: colors[2],
                backgroundColor: colors[2],
                tension: 0.25,
                fill: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            // dailyTrend() emits every day in range including zeros, so the line
            // has no gaps to interpolate over.
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { display: false } },
          },
        })
      );
    }
  }

  function driverSection(
    events: ExceptionEventDTO[],
    trips: TripDTO[],
    drivers: DriverLite[],
    attribution: number
  ): string {
    if (attribution < ATTRIBUTION_GATE) {
      const pct = nf0.format(attribution * 100);
      // The honest reason matters more than the number: on most Indonesian fleets
      // there is no NFC/iButton reader at all, so every trip is UnknownDriverId.
      // A leaderboard built on that is one row holding the whole fleet.
      return `
        <p class="fa-empty">
          Ranking per pengemudi disembunyikan — hanya ${pct}% trip punya identitas pengemudi.
          Sebagian besar armada belum memakai NFC/iButton driver ID, sehingga perjalanan tercatat sebagai
          <em>UnknownDriverId</em>. Menampilkan peringkat dari data itu hanya akan menyalahkan satu pengemudi
          fiktif untuk pelanggaran seluruh armada. Gunakan peringkat per unit di atas untuk coaching.
        </p>
      `;
    }

    const rows = rankDrivers(events, trips, drivers);
    if (rows.length === 0) return '<p class="fa-empty">Tidak ada pelanggaran yang bisa dikaitkan ke pengemudi pada rentang ini.</p>';

    const pct = nf0.format(attribution * 100);
    return `
      <p class="fa-safety-caveat">${pct}% trip punya identitas pengemudi. Pelanggaran dikaitkan ke pengemudi lewat trip yang sedang berjalan saat kejadian.</p>
      <div class="fa-safety-tablewrap">
        <table class="fa-table">
          <thead><tr>
            <th>Pengemudi</th><th class="fa-safety-num">Pelanggaran</th>
            <th class="fa-safety-num">Jarak (km)</th><th class="fa-safety-num">Per 100 km</th>
          </tr></thead>
          <tbody>
            ${rows
              .map(
                (r, i) => `
              <tr class="${i < 3 ? 'fa-safety-worst' : ''}">
                <td>${esc(r.name)}</td>
                <td class="fa-safety-num">${nf0.format(r.events)}</td>
                <td class="fa-safety-num">${nf1.format(r.km)}</td>
                <td class="fa-safety-num">${r.per100Km === null ? '<span class="fa-safety-na">—</span>' : nf2.format(r.per100Km)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Initial paint + refetch when the filter changes (only while this view is the
  // visible one — reload-when-visible.ts keeps six views off the rate limit).
  const unsubscribeFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  // `dashboard:view-shown` is broadcast on the SHARED rootEl for every view,
  // including the ones that just hid this one. Resizing a Chart.js instance whose
  // container is display:none collapses it to 0x0 and it never comes back — the
  // exact bug that bit the heat map. clientWidth > 0 means "actually visible".
  const onShown = () => {
    if (container.clientWidth <= 0) return;
    for (const c of charts) c.resize();
  };
  ctx.rootEl.addEventListener('dashboard:view-shown', onShown);

  return () => {
    loadSeq++; // in-flight responses land after unmount; make them no-ops
    ctx.rootEl.removeEventListener('dashboard:view-shown', onShown);
    unsubscribeFilter();
    destroyCharts();
  };
}

function kpi(label: string, value: string): string {
  return `
    <div class="fa-kpi-card">
      <div class="fa-kpi-label">${label}</div>
      <div class="fa-kpi-value">${value}</div>
    </div>`;
}

function deviceTable(
  ranked: ReturnType<typeof rankDevices>,
  topCat: ReturnType<typeof topCategoryByDevice>
): string {
  return `
    <table class="fa-table">
      <thead><tr>
        <th>Unit</th>
        <th class="fa-safety-num">Pelanggaran</th>
        <th class="fa-safety-num">Jarak (km)</th>
        <th class="fa-safety-num">Per 100 km</th>
        <th>Kategori Teratas</th>
      </tr></thead>
      <tbody>
        ${ranked
          .map((r, i) => {
            const cat = topCat.get(r.deviceId);
            return `
          <tr class="${i < 3 && r.per100Km !== null ? 'fa-safety-worst' : ''}">
            <td>${esc(r.name)}</td>
            <td class="fa-safety-num">${nf0.format(r.events)}</td>
            <td class="fa-safety-num">${nf1.format(r.km)}</td>
            <td class="fa-safety-num">${
              // 0 km means the rate is UNKNOWN, not zero. Showing "—" beats
              // showing Infinity, NaN, or a fake 0 that flatters a parked unit.
              r.per100Km === null ? '<span class="fa-safety-na">—</span>' : nf2.format(r.per100Km)
            }</td>
            <td>${cat ? CATEGORY_LABELS[cat] : '<span class="fa-safety-na">—</span>'}</td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}
