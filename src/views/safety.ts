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
import { fetchRules } from '../api/fetchers/rule';
import { fetchDiagnostics } from '../api/fetchers/diagnostic';
import type {
  ExceptionEventDTO,
  TripDTO,
  DeviceLite,
  DriverLite,
  RuleDTO,
  DiagnosticDTO,
  FilterChangeDetail,
} from '../api/fetchers/types';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import { esc, token, int, two, upto1 } from '../utils/format';
import { renderExplainCard, bindExplainToggles, type KpiExplanation } from '../components/kpi-explain';
import { summarizeSafety } from '../analytics/summary';
import { exportButtonHtml, bindExport } from '../components/export-button';
import type { ViewCtx } from './registry';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  categoryBreakdown,
  configuredCategories,
  dailyTrend,
  driverAttributionRate,
  eventsPer100Km,
  rankDevices,
  rankDrivers,
  topCategoryByDevice,
  violationsByDevice,
  type Category,
  type ViolationBreakdown,
} from '../analytics/safety';

Chart.register(...registerables);

/** Below this, a per-driver ranking is fiction — see the note it renders instead. */
const ATTRIBUTION_GATE = 0.5;

/** Chart colors are read from the dashboard.css palette rather than re-invented,
 *  so a theme change moves the charts too. */
const PALETTE_TOKENS: Array<[string, string]> = [
  ['--fa-high-fg', '#b91c1c'],
  ['--fa-med-fg', '#b45309'],
  ['--fa-accent', '#3b82f6'],
  ['--fa-low-fg', '#1d4ed8'],
  ['--fa-danger', '#b91c1c'],
  ['--fa-muted', '#6b7280'],
  ['--fa-border', '#e2e5e9'],
];

function palette(): string[] {
  return PALETTE_TOKENS.map(([name, fallback]) => token(name, fallback));
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
    container.innerHTML = '<p class="fa-loading">Memuat data keselamatan…</p>';

    try {
      const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
      const groupIds = filter.groupIds;
      const [events, trips, devices, drivers, rules, diagnostics] = await Promise.all([
        fetchExceptionEvents({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupIds }),
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupIds }),
        fetchDevices({ database: ctx.database, groupIds, fromDate: fromIso, toDate: toIso }),
        // Driver names are a nicety; a permission error here must not blank the view.
        fetchDrivers({ database: ctx.database }).catch((err) => {
          console.warn('safety: fetchDrivers failed, continuing without names', err);
          return [] as DriverLite[];
        }),
        // Which categories this database can measure at all. Cached 30 min and
        // already fetched by exception-event.ts, so this is effectively free.
        // Failing to know coverage must not blank the view — fall back to "no
        // rules known", which only ever makes the UI more cautious.
        fetchRules({ database: ctx.database }).catch((err) => {
          console.warn('safety: fetchRules failed, coverage unknown', err);
          return [] as RuleDTO[];
        }),
        // Only to turn a diagnostic id into a readable name in the threshold
        // line. Cached 24h and shared with every other view — effectively free.
        fetchDiagnostics({ database: ctx.database }).catch((err) => {
          console.warn('safety: fetchDiagnostics failed, thresholds will show raw ids', err);
          return [] as DiagnosticDTO[];
        }),
      ]);

      if (seq !== loadSeq) return; // a newer load won
      render(events, trips, devices, drivers, rules, diagnostics, fromIso, toIso);
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
    rules: RuleDTO[],
    diagnostics: DiagnosticDTO[],
    fromIso: string,
    toIso: string
  ): void {
    const configured = configuredCategories(rules);
    const diagnosticNames = new Map(diagnostics.map((d) => [d.id, d.name]));
    // `other` is the catch-all, so it never proves a safety rule exists.
    const safetyCats = CATEGORIES.filter((c) => c !== 'other');
    const missing = safetyCats.filter((c) => !configured[c]);
    const noSafetyRules = missing.length === safetyCats.length;

    // Degrade with a REASON. An empty chart looks like a broken chart — and "0
    // pelanggaran" on a database with no rules is worse: it reads as a clean
    // fleet. Now that coverage is known, say which it actually is.
    if (events.length === 0) {
      // Teks penyebabnya sekarang datang dari summarizeSafety(), sumber yang sama
      // dengan ringkasan di jalur normal — supaya "nol sungguhan" dan "Rule tidak
      // pernah dibuat" tidak bisa berbunyi beda di dua tempat.
      container.innerHTML = `<p class="fa-empty">${esc(
        summarizeSafety({
          events: 0,
          totalKm: trips.reduce((n, t) => n + (t.distanceKm || 0), 0),
          fleetPer100: null,
          ranked: [],
          missingCategories: missing.map((c) => CATEGORY_LABELS[c]),
          anyRuleConfigured: !noSafetyRules,
          driverAttributionPct: 0,
        })
      )}</p>`;
      return;
    }

    const breakdown = categoryBreakdown(events);
    const perDevice = eventsPer100Km(events, trips);
    const ranked = rankDevices(perDevice, devices);
    const topCat = topCategoryByDevice(events, rules);
    const violations = violationsByDevice(events, rules);
    const trend = dailyTrend(events, fromIso, toIso);
    const attribution = driverAttributionRate(trips);

    const totalKm = trips.reduce((n, t) => n + (t.distanceKm || 0), 0);
    const fleetPer100 = totalKm > 0 ? (events.length / totalKm) * 100 : null;

    lastRanked = ranked;
    lastTopCat = new Map(
      ranked.map((r) => [r.name, CATEGORY_LABELS[topCat.get(r.deviceId) ?? 'other']])
    );

    container.innerHTML = `
      <div class="fa-safety">
        <p class="fa-summary">${esc(
          summarizeSafety({
            events: events.length,
            totalKm,
            fleetPer100,
            ranked,
            missingCategories: missing.map((c) => CATEGORY_LABELS[c]),
            anyRuleConfigured: !noSafetyRules,
            driverAttributionPct: attribution * 100,
          })
        )}</p>
        <div class="fa-kpi-row">
          ${explainKpi(openPanels, 'sf-total', 'Total Pelanggaran', int(events.length), {
            formula: 'Jumlah seluruh ExceptionEvent pada rentang, dari semua Rule keselamatan yang aktif',
            substituted: `${int(events.length)} kejadian dari ${int(trips.length)} trip (${two(totalKm)} km)`,
            source:
              'ExceptionEvent + Rule (MyGeotab), dijumlahkan apa adanya. Angka ini naik-turun mengikuti kesibukan ' +
              'armada, jadi jangan dipakai untuk peringkat — gunakan per 100 km di sebelahnya.',
            kind: 'terukur',
          })}
          ${explainKpi(
            openPanels,
            'sf-per100',
            'Pelanggaran / 100 km (armada)',
            fleetPer100 === null ? '—' : two(fleetPer100),
            {
              formula: 'Σ pelanggaran ÷ Σ jarak (km) × 100',
              substituted:
                fleetPer100 === null
                  ? `Belum bisa dihitung: jarak armada 0 km pada rentang ini, jadi pembaginya nol`
                  : `${int(events.length)} kejadian ÷ ${two(totalKm)} km × 100 = ${two(fleetPer100)}`,
              source:
                'ExceptionEvent + Trip.distance (MyGeotab). Dinormalkan terhadap jarak supaya unit 4.000 km/minggu ' +
                'bisa dibandingkan adil dengan unit 200 km/minggu. Jarak SELURUH armada dijumlah dulu baru dibagi ' +
                '— ini bukan rata-rata dari angka per unit, jadi unit tersibuk berbobot lebih besar di angka armada.',
              kind: 'terukur',
            }
          )}
          ${categoryKpi('harsh-braking', breakdown, configured, openPanels)}
          ${categoryKpi('speeding', breakdown, configured, openPanels)}
        </div>

        ${
          missing.length
            ? `<p class="fa-safety-caveat fa-safety-missing">
                 <span class="fa-safety-flag">tidak diukur</span>
                 Kategori berikut <strong>belum punya Rule</strong> di database ini, jadi tidak pernah bisa muncul —
                 angkanya sengaja dikosongkan, bukan nol:
                 <strong>${missing.map((c) => esc(CATEGORY_LABELS[c])).join(', ')}</strong>.
               </p>`
            : ''
        }

        <div>
          <p class="fa-safety-caveat">
            <span class="fa-safety-flag">heuristik</span>
            ExceptionEvent dari MyGeotab <strong>tidak memuat besaran pelanggaran</strong> — misalnya berapa km/jam
            kelebihan kecepatannya, atau seberapa keras pengeremannya. Yang tersedia hanya durasi kejadian. Jadi setiap
            pelanggaran dihitung sama beratnya di halaman ini; durasi tidak dipakai sebagai bobot keparahan.
          </p>
          <p class="fa-safety-caveat">
            Semua angka di sini berasal dari <strong>Rule</strong> yang aktif di database ini beserta
            <strong>ambang batasnya</strong> (misal pengereman mendadak dipicu pada −0,4G). Ambang itu disetel di
            MyGeotab dan bisa diubah kapan saja, jadi angka ini sah untuk membandingkan unit
            <strong>di dalam database yang sama</strong> — bukan untuk dibandingkan dengan armada atau klien lain.
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
          <h2>Peringkat Unit — terburuk ke terbaik ${exportButtonHtml('safety')}</h2>
          <p class="fa-note">
            Tiga baris teratas disorot: itulah unit dengan pelanggaran per 100 km tertinggi,
            dan tempat coaching paling masuk akal dimulai. Klik tanda panah untuk melihat
            aturan mana yang terpicu di tiap unit. Unit tanpa jarak tempuh tampil
            &ldquo;&mdash;&rdquo; dan turun ke bawah &mdash; lajunya tidak diketahui, bukan nol.
          </p>
          <div class="fa-safety-tablewrap">${deviceTable(ranked, topCat, violations, diagnosticNames)}</div>
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
      const pct = int(attribution * 100);
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

    const pct = int(attribution * 100);
    return `
      <p class="fa-safety-caveat">${pct}% trip punya identitas pengemudi. Pelanggaran dikaitkan ke pengemudi lewat trip yang sedang berjalan saat kejadian.</p>
      <p class="fa-note">Tiga baris teratas disorot: pelanggaran per 100 km tertinggi.</p>
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
                <td class="fa-safety-num">${int(r.events)}</td>
                <td class="fa-safety-num">${upto1(r.km)}</td>
                <td class="fa-safety-num">${r.per100Km === null ? '<span class="fa-safety-na">—</span>' : two(r.per100Km)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Panel penjelasan yang terbuka bertahan melewati render ulang.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);

  /** Baris peringkat hasil render terakhir, supaya export tidak menghitung ulang
   *  maupun mengambil ulang dari API. */
  let lastRanked: { name: string; events: number; km: number; per100Km: number | null }[] = [];
  let lastTopCat = new Map<string, string>();

  const stopExport = bindExport(container, () => {
    if (lastRanked.length === 0) return null;
    return {
      filenameBase: 'perilaku-berkendara',
      headers: ['Unit', 'Pelanggaran', 'Jarak (km)', 'Per 100 km', 'Kategori Teratas'],
      rows: lastRanked.map((r) => [
        r.name, int(r.events), upto1(r.km),
        r.per100Km === null ? null : two(r.per100Km),
        lastTopCat.get(r.name) ?? null,
      ]),
    };
  });

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

  // Delegated on the container: the table is rebuilt on every filter change, so
  // per-row handlers would have to be re-attached (and would leak) each time.
  function onToggle(e: Event): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.fa-safety-toggle');
    if (!btn) return;
    const row = document.getElementById(btn.dataset.target ?? '');
    if (!row) return;
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    row.hidden = open;
  }
  container.addEventListener('click', onToggle);

  return () => {
    loadSeq++; // in-flight responses land after unmount; make them no-ops
    ctx.rootEl.removeEventListener('dashboard:view-shown', onShown);
    container.removeEventListener('click', onToggle);
    stopExplain();
    stopExport();
    unsubscribeFilter();
    destroyCharts();
  };
}

function kpi(label: string, value: string, note = ''): string {
  return `
    <div class="fa-kpi-card">
      <div class="fa-kpi-label">${label}</div>
      <div class="fa-kpi-value">${value}</div>
      ${note ? `<div class="fa-kpi-note">${note}</div>` : ''}
    </div>`;
}

function explainKpi(
  openPanels: Set<string>,
  key: string,
  label: string,
  valueHtml: string,
  explain: KpiExplanation
): string {
  return renderExplainCard({ key, label, valueHtml, caption: '', explain, open: openPanels.has(key) });
}

/** A category with no Rule shows "—", never 0: zero is a measurement, and none
 *  was taken. Same distinction the fleet-health view makes for absent data. */
function categoryKpi(
  cat: Category,
  breakdown: Record<Category, number>,
  configured: Record<Category, boolean>,
  openPanels: Set<string>
): string {
  // Tanpa Rule tidak ada yang bisa dijelaskan — kartu tetap "—" tanpa panel.
  if (!configured[cat]) {
    return kpi(esc(CATEGORY_LABELS[cat]), '—', 'Rule belum dikonfigurasi di database ini');
  }
  return explainKpi(openPanels, `sf-${cat}`, CATEGORY_LABELS[cat], int(breakdown[cat]), {
    formula: `Jumlah ExceptionEvent yang masuk kategori "${CATEGORY_LABELS[cat]}"`,
    substituted: `${int(breakdown[cat])} kejadian`,
    source:
      'ExceptionEvent + Rule + Diagnostic (MyGeotab). Kategori ditentukan bertingkat: pertama dari diagnostic ' +
      'yang dipicu Rule, lalu dari id aturan bawaan Geotab, dan baru terakhir dari pencocokan nama. Urutan itu ' +
      'penting karena nama aturan bawaan diterjemahkan per bahasa database — mencocokkan nama duluan akan gagal ' +
      'di database berbahasa Indonesia. Aturan buatan sendiri yang tidak cocok satu pun masuk kategori "lainnya".',
    kind: 'terukur',
  });
}

/** Renders a rule's firing threshold, e.g. "< −0,40 G". Geotab records the
 *  operator and the value; the diagnostic name says what is measured. */
function thresholdText(
  t: { diagnosticId: string | null; conditionType: string; value: number },
  diagnosticNames: Map<string, string>
): string {
  const op = /less|below/i.test(t.conditionType) ? '<' : /more|above|greater/i.test(t.conditionType) ? '>' : '=';
  const what = t.diagnosticId ? diagnosticNames.get(t.diagnosticId) ?? t.diagnosticId : '';
  return `${what ? `${esc(what)} ` : ''}${op} ${two(t.value)}`;
}

function violationList(rows: ViolationBreakdown[], diagnosticNames: Map<string, string>): string {
  if (rows.length === 0) {
    return '<p class="fa-safety-detail-empty">Tidak ada rincian pelanggaran untuk unit ini.</p>';
  }
  return `
    <ul class="fa-safety-detail-list">
      ${rows
        .map(
          (v) => `
        <li class="fa-safety-detail-item">
          <span class="fa-safety-count">${int(v.count)}×</span>
          <div class="fa-safety-detail-main">
            <div class="fa-safety-detail-name">
              ${esc(v.ruleName)}
              ${
                // The chip earns its place only when it says something the rule
                // name does not — "Pengereman Mendadak / Pengereman Mendadak" is
                // noise, but "Peringatan Unit / Pengereman Mendadak" is the whole
                // point of classifying by diagnostic.
                v.ruleName.trim().toLowerCase() === CATEGORY_LABELS[v.category].toLowerCase()
                  ? ''
                  : `<span class="fa-safety-cat">${esc(CATEGORY_LABELS[v.category])}</span>`
              }
            </div>
            <div class="fa-safety-detail-meta">
              ${
                v.thresholds.length
                  ? `Ambang: ${v.thresholds.map((t) => thresholdText(t, diagnosticNames)).join(' &amp; ')} · `
                  : ''
              }total durasi ${esc(formatDur(v.totalDurationSec))} · terakhir ${esc(formatWhen(v.lastAt))}
            </div>
          </div>
        </li>`
        )
        .join('')}
    </ul>
    <p class="fa-safety-detail-note">
      MyGeotab <strong>tidak menyimpan nilai terukur</strong> tiap pelanggaran (berapa G atau km/j sebenarnya) —
      yang tersedia hanya ambang batas Rule di atas, durasi, dan jarak.
    </p>`;
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
  return new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function deviceTable(
  ranked: ReturnType<typeof rankDevices>,
  topCat: ReturnType<typeof topCategoryByDevice>,
  violations: Record<string, ViolationBreakdown[]>,
  diagnosticNames: Map<string, string>
): string {
  return `
    <table class="fa-table fa-safety-table">
      <thead><tr>
        <th></th>
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
            const id = `fa-safety-detail-${i}`;
            return `
          <tr class="${i < 3 && r.per100Km !== null ? 'fa-safety-worst' : ''}">
            <td class="fa-safety-togglecell">
              <button type="button" class="fa-safety-toggle" aria-expanded="false" aria-controls="${id}"
                      aria-label="Lihat rincian pelanggaran ${esc(r.name)}" data-target="${id}">
                <span class="fa-safety-chevron" aria-hidden="true"></span>
              </button>
            </td>
            <td>${esc(r.name)}</td>
            <td class="fa-safety-num">${int(r.events)}</td>
            <td class="fa-safety-num">${upto1(r.km)}</td>
            <td class="fa-safety-num">${
              // 0 km means the rate is UNKNOWN, not zero. Showing "—" beats
              // showing Infinity, NaN, or a fake 0 that flatters a parked unit.
              r.per100Km === null ? '<span class="fa-safety-na">—</span>' : two(r.per100Km)
            }</td>
            <td>${cat ? CATEGORY_LABELS[cat] : '<span class="fa-safety-na">—</span>'}</td>
          </tr>
          <tr class="fa-safety-detail-row" id="${id}" hidden>
            <td colspan="6">${violationList(violations[r.deviceId] ?? [], diagnosticNames)}</td>
          </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}
