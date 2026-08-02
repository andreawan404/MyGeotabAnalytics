// "Konsumsi BBM" — fuel consumption.
//
// The problem this view solves is that we do NOT know how (or whether) a given
// Geotab database reports fuel. Fuel-card transactions, an engine "total fuel
// used" counter, a tank-level percentage, or nothing at all. So the view probes,
// picks the best source available (analytics/fuel.ts pickFuelSource), and a
// permanent banner states which one it used and whether the numbers are
// MEASURED (terukur) or GUESSED (estimasi). Silent estimates are how a fleet
// manager ends up billing a client off a ratio someone typed once.
//
// Probe budget: one Trip + one Device + one FuelTransaction fetch (all cached,
// all in parallel), and — only if no fuel card data exists — ONE extra
// multiCall via the shared probeDiagnostics that tests both candidate
// diagnostics at once. Never per device, never per diagnostic.

import { Chart, registerables } from 'chart.js';
import '../styles/fuel.css';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchFuelTransactions } from '../api/fetchers/fuel-transaction';
import { fetchDiagnostics, resolveCumulativeFuelDiagnosticId } from '../api/fetchers/diagnostic';
import { fetchStatusDataMulti } from '../api/fetchers/status-data';
import { probeDiagnostics, WELL_KNOWN_DIAGNOSTICS } from '../api/fetchers/probe';
import { toUtcRange } from '../utils/date-range';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import { esc, clamp, token, int, one, upto1 } from '../utils/format';
import { renderExplainCard, bindExplainToggles, type KpiExplanation } from '../components/kpi-explain';
import { openGlossary } from '../components/glossary';

// Dari mana liternya datang. Empat sumber, akurasi jauh berbeda — dan halaman
// ini tidak boleh terdengar sama yakinnya untuk keempatnya.
const SOURCE_FORMULA: Record<FuelSource, string> = {
  transactions: 'Σ volume seluruh transaksi kartu BBM pada rentang ini',
  cumulative: 'Σ kenaikan counter "total fuel used" pada ECU antar pembacaan',
  level: 'Σ penurunan level tangki × kapasitas tangki ÷ 100',
  distance: 'Σ jarak (km) × rasio L/100km yang Anda isi ÷ 100',
  none: 'Tidak ada yang bisa dihitung',
};

const SOURCE_DETAIL: Record<FuelSource, string> = {
  transactions:
    'FuelTransaction (MyGeotab). Sumber paling akurat: volume dan biaya nyata dari pengisian, bukan hasil hitungan. ' +
    'Perhatikan bahwa waktu pengisian tidak sama dengan waktu pemakaian — BBM yang diisi hari ini bisa dipakai minggu depan.',
  cumulative:
    'StatusData "total fuel used" dari ECU (MyGeotab). Hanya kenaikan yang dijumlah; penurunan diabaikan karena ' +
    'itu berarti counter di-reset, bukan BBM yang kembali ke tangki.',
  level:
    'StatusData level tangki (MyGeotab). Hanya PENURUNAN level yang dijumlah — pengisian ulang sengaja diabaikan. ' +
    'Kalau level dilaporkan dalam persen, konversinya memakai kapasitas tangki yang Anda isi di bawah, dan kapasitas ' +
    'itu diterapkan sama rata ke semua unit walau tangkinya sebenarnya berbeda-beda.',
  distance:
    'Trip.distance (MyGeotab) × rasio yang ANDA isi. Database ini tidak melaporkan data bahan bakar apa pun, jadi ' +
    'angka di halaman ini BUKAN hasil pengukuran — ia hanya jarak yang dikalikan sebuah tebakan. Semua unit akan ' +
    'terlihat sama efisien, karena memang begitulah cara angkanya dibuat.',
  none: 'Tidak ada sumber bahan bakar maupun jarak tempuh pada rentang ini.',
};
import type { ViewCtx } from './registry';
import type {
  FilterChangeDetail,
  TripDTO,
  DeviceLite,
  FuelTransactionDTO,
  StatusDataDTO,
} from '../api/fetchers/types';
import {
  pickFuelSource,
  consumptionFromCumulative,
  consumptionFromLevel,
  estimateFromDistance,
  litresPer100Km,
  fleetKmPerLitre,
  economyByDevice,
  idleFuelWaste,
  groupByDay,
  dayKey,
  sumValues,
  type FuelSource,
} from '../analytics/fuel';

Chart.register(...registerables);

// The cumulative counter is resolved by resolveCumulativeFuelDiagnosticId
// (diagnostic.ts): the confirmed DiagnosticDeviceTotalFuelId first, localized
// name matching only as a fallback. Shared with the trip timeline tooltip.

/** Above this the readings cannot be a percentage, so they are already litres
 *  and the tank size must NOT be applied. */
const PERCENT_CEILING = 100;

// ponytail: a 300-vehicle fleet makes an unreadable 300-bar chart. Top 20 by
// consumption, the rest stay in the table. Add paging if someone asks.
const CHART_UNITS = 20;

interface Settings {
  litresPer100Km: number;
  litresPerIdleHour: number;
  tankLitres: number;
}

const DEFAULTS: Settings = { litresPer100Km: 30, litresPerIdleHour: 2, tankLitres: 100 };
const STORAGE_PREFIX = 'fleet-analytics:fuel-settings:';

function loadSettings(database: string): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + database) ?? '{}');
    return {
      litresPer100Km: clamp(Number(parsed?.litresPer100Km), 1, 200, DEFAULTS.litresPer100Km),
      litresPerIdleHour: clamp(Number(parsed?.litresPerIdleHour), 0, 50, DEFAULTS.litresPerIdleHour),
      tankLitres: clamp(Number(parsed?.tankLitres), 1, 5000, DEFAULTS.tankLitres),
    };
  } catch {
    return { ...DEFAULTS }; // private mode / corrupt value — defaults are fine
  }
}

function saveSettings(database: string, s: Settings): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + database, JSON.stringify(s));
  } catch {
    /* storage unavailable — the setting just won't persist */
  }
}

/** Everything one load() produced, kept so changing a RATE re-renders without
 *  going back to the API. */
interface Snapshot {
  source: FuelSource;
  /** The resolved diagnostic name, for the banner ("Total Fuel Used"). */
  sourceDetail: string;
  trips: TripDTO[];
  devices: DeviceLite[];
  transactions: FuelTransactionDTO[];
  /** StatusData rows for the cumulative/level source; empty otherwise. */
  rows: StatusDataDTO[];
  /** Do the level readings look like percent points rather than litres? */
  levelIsPercent: boolean;
}

export function initFuelView(container: HTMLElement, ctx: ViewCtx): () => void {
  let settings = loadSettings(ctx.database);
  let snapshot: Snapshot | null = null;

  // Panel penjelasan yang terbuka bertahan melewati render ulang: mengubah rasio
  // BBM tidak boleh membanting tutup panel yang menjelaskan rasio itu.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);

  /** `note` boleh membawa markup (tag sumber), jadi tidak di-escape. */
  const card = (key: string, label: string, valueHtml: string, note: string, explain: KpiExplanation): string =>
    renderExplainCard({
      key,
      label,
      valueHtml,
      caption: '',
      explain,
      open: openPanels.has(key),
      extra: note ? `<div class="fa-kpi-note">${note}</div>` : '',
    });
  let barChart: Chart | null = null;
  let trendChart: Chart | null = null;
  // A slow load must never overwrite a newer one (fast date-picker edits).
  let loadToken = 0;

  function destroyCharts(): void {
    barChart?.destroy();
    trendChart?.destroy();
    barChart = null;
    trendChart = null;
  }

  /** Always destroy before replacing innerHTML — an orphaned Chart keeps its
   *  detached canvas and its resize listener alive. */
  function setHtml(html: string): void {
    destroyCharts();
    container.innerHTML = html;
  }

  async function load(filter: FilterChangeDetail): Promise<void> {
    const token = ++loadToken;
    const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
    const groupId = filter.groupId;
    const database = ctx.database;

    setHtml('<p class="fa-empty">Memuat data BBM…</p>');

    try {
      // Trips are needed by every source (the km denominator and the idle
      // heuristic), and FuelTransaction doubles as its own probe — if it comes
      // back non-empty it IS the data, so nothing here is a wasted call.
      const [trips, devices, transactions] = await Promise.all([
        fetchTrips({ database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database, groupId, fromDate: fromIso, toDate: toIso }),
        fetchFuelTransactions({ database, fromDate: fromIso, toDate: toIso, groupId }),
      ]);

      const availability = {
        transactions: transactions.length > 0,
        cumulative: false,
        level: false,
        distance: trips.some((t) => t.distanceKm > 0),
      };

      let cumulativeId: string | null = null;
      let sourceDetail = '';

      // Skipped entirely when fuel-card data already exists — it would win the
      // precedence anyway, so probing would just burn a round trip.
      if (!availability.transactions) {
        const diagnostics = await fetchDiagnostics({ database }); // near-static, cached 24h
        cumulativeId = resolveCumulativeFuelDiagnosticId(diagnostics);
        sourceDetail = diagnostics.find((d) => d.id === cumulativeId)?.name ?? '';

        // ONE multiCall for both candidates (shared probe, cached 24h).
        const probe = await probeDiagnostics({
          database,
          diagnosticIds: [WELL_KNOWN_DIAGNOSTICS.fuelLevel, ...(cumulativeId ? [cumulativeId] : [])],
          toIso,
          groupId,
        });
        availability.cumulative = cumulativeId ? probe[cumulativeId] === true : false;
        availability.level = probe[WELL_KNOWN_DIAGNOSTICS.fuelLevel] === true;
      }

      const source = pickFuelSource(availability);

      // Only now pull the rows the winning source actually needs.
      let rows: StatusDataDTO[] = [];
      if (source === 'cumulative' || source === 'level') {
        const diagnosticId = source === 'cumulative' ? cumulativeId! : WELL_KNOWN_DIAGNOSTICS.fuelLevel;
        const byId = await fetchStatusDataMulti({
          database,
          diagnosticIds: [diagnosticId],
          fromDate: fromIso,
          toDate: toIso,
          groupId,
        });
        rows = byId[diagnosticId] ?? [];
      }

      if (token !== loadToken) return; // a newer load already owns the view

      snapshot = {
        source,
        sourceDetail,
        trips,
        devices,
        transactions,
        rows,
        levelIsPercent: source === 'level' && looksLikePercent(rows),
      };
      render();
    } catch (err) {
      console.error('fuel: load failed', err);
      if (token === loadToken) setHtml('<p class="fa-error">Gagal memuat data konsumsi BBM.</p>');
    }
  }

  function render(): void {
    const snap = snapshot;
    if (!snap) return;

    if (snap.source === 'none') {
      setHtml(
        `<p class="fa-empty">Tidak ada data BBM untuk periode ini. Database ini tidak punya transaksi kartu BBM,
         tidak melaporkan diagnostik bahan bakar (total fuel used / fuel level), dan tidak ada jarak tempuh dari
         trip yang bisa dipakai untuk estimasi. Coba perluas rentang tanggal atau pilih group lain.</p>`
      );
      return;
    }

    const litres = litresByDevice(snap, settings);
    const km = kmByDevice(snap.trips);
    const idle = idleFuelWaste(snap.trips, settings.litresPerIdleHour);
    const cost = snap.source === 'transactions' ? costByDevice(snap.transactions) : null;

    // km/L is only a comparison when the litres were MEASURED — see
    // economyBlocker. When it is blocked every economy cell is null, so the
    // dashes come from one decision instead of per-cell guesswork.
    const blocked = economyBlocker(snap.source);
    const economy = economyByDevice(km, litres);

    const nameById = new Map(snap.devices.map((d) => [d.id, d.name]));
    const rows = [...new Set([...Object.keys(litres), ...Object.keys(km)])]
      .map((id) => ({
        id,
        name: nameById.get(id) ?? id,
        km: km[id] ?? 0,
        litres: litres[id] ?? 0,
        efficiency: litresPer100Km(litres[id] ?? 0, km[id] ?? 0),
        economy: blocked ? null : (economy[id] ?? null),
        cost: cost ? (cost[id] ?? 0) : null,
      }))
      .sort((a, b) => b.litres - a.litres);

    const totalL = sumValues(litres);
    const totalKm = sumValues(km);
    const avg = litresPer100Km(totalL, totalKm);
    // Total km / total litres — deliberately NOT the average of the per-unit
    // column below it (see fleetKmPerLitre).
    const fleetEconomy = blocked ? null : fleetKmPerLitre(km, litres);
    const totalCost = cost ? sumValues(cost) : null;
    const currency = snap.transactions.find((t) => t.currency)?.currency ?? '';

    setHtml(`
      ${renderBanner(snap, settings)}
      <div class="fa-kpi-row">
        ${card('fu-total', 'Total BBM (L)', fmt(totalL), '', {
          formula: SOURCE_FORMULA[snap.source],
          substituted: `${fmt(totalL)} L pada rentang ini, dari ${fmt(totalKm, 0)} km jarak tempuh`,
          source: SOURCE_DETAIL[snap.source],
          kind: isEstimateSource(snap.source) ? 'estimasi' : 'terukur',
        })}
        ${card(
          'fu-avg',
          'Rata-rata L/100km',
          avg === null ? '—' : fmt(avg),
          totalKm > 0 ? `${fmt(totalKm, 0)} km total` : '',
          {
            formula: 'Σ liter ÷ Σ km × 100',
            substituted:
              avg === null
                ? 'Belum bisa dihitung: jarak tempuh armada 0 km pada rentang ini'
                : `${fmt(totalL)} L ÷ ${fmt(totalKm, 0)} km × 100 = ${fmt(avg)} L/100km`,
            source:
              'Trip.distance (MyGeotab) + liter dari sumber di banner atas. Seluruh armada dijumlah dulu baru ' +
              'dibagi — ini BUKAN rata-rata dari angka per unit, jadi unit yang paling banyak jalan berbobot ' +
              'lebih besar. Untuk membandingkan antar unit, pakai kolom L/100km di tabel bawah.',
            kind: isEstimateSource(snap.source) ? 'estimasi' : 'terukur',
          }
        )}
        ${card(
          'fu-economy',
          'Efisiensi BBM (km/L)',
          fleetEconomy === null ? '—' : fmt(fleetEconomy, 2),
          blocked ? blocked : `${sourceTag(isEstimateSource(snap.source))} ${fmt(totalKm, 0)} km ÷ ${fmt(totalL)} L`,
          {
            formula: 'Σ km ÷ Σ liter',
            substituted:
              fleetEconomy === null
                ? blocked || 'Belum bisa dihitung pada rentang ini'
                : `${fmt(totalKm, 0)} km ÷ ${fmt(totalL)} L = ${fmt(fleetEconomy, 2)} km/L`,
            source:
              'Kebalikan dari L/100km, disediakan karena banyak armada di Indonesia terbiasa berpikir dalam km/L. ' +
              'Kalau sumbernya estimasi jarak, kolom ini sengaja dikosongkan: litermya dihitung DARI jarak, jadi ' +
              'km/L akan sama persis untuk semua unit dan tidak memberi informasi apa pun.',
            kind: isEstimateSource(snap.source) ? 'estimasi' : 'terukur',
          }
        )}
        ${
          // Omitted entirely when there is no cost data — a "Rp 0" card reads as
          // "fuel was free", which is worse than no card at all.
          totalCost === null
            ? ''
            : card('fu-cost', 'Biaya', `${currency} ${fmt(totalCost, 0)}`, '', {
                formula: 'Σ biaya seluruh transaksi kartu BBM pada rentang ini',
                substituted: `${currency} ${fmt(totalCost, 0)} dari ${fmt(snap.transactions.length, 0)} transaksi`,
                source:
                  'FuelTransaction (MyGeotab) — angka rupiah yang benar-benar dibayar, bukan liter dikali harga ' +
                  'asumsi. Hanya muncul kalau database ini punya data kartu BBM.',
                kind: 'terukur',
              })
        }
        ${card(
          'fu-idle',
          'Estimasi Boros Idle (L)',
          fmt(sumValues(idle)),
          `Heuristik: jam idle × ${fmt(settings.litresPerIdleHour)} L/jam`,
          {
            formula: 'Σ jam idle × konsumsi idle (L/jam) yang Anda isi',
            substituted: `${fmt(sumValues(idle))} L, memakai ${fmt(settings.litresPerIdleHour)} L/jam`,
            source:
              'Trip.idlingDuration (MyGeotab) — jam idle-nya terukur, tapi laju konsumsinya TIDAK: MyGeotab tidak ' +
              'melaporkan berapa liter yang terbakar saat idle. Angka L/jam berasal dari isian Anda di bawah, ' +
              'dan berbeda jauh antar jenis kendaraan (van kota ±1,5; alat berat bisa 4 atau lebih). Ubah isian ' +
              'itu dan angka ini ikut berubah — jangan dipakai untuk menagih tanpa memverifikasi lajunya dulu.',
            kind: 'heuristik',
          }
        )}
      </div>

      ${renderControls(snap, settings)}

      <div class="fa-fuel-panel">
        <div class="fa-fuel-panel-title">Efisiensi per unit (L/100km)</div>
        <div class="fa-fuel-chart"><canvas id="fa-fuel-bar"></canvas></div>
      </div>

      <div class="fa-fuel-panel">
        <div class="fa-fuel-panel-title">Tren konsumsi harian (L)</div>
        <div class="fa-fuel-chart"><canvas id="fa-fuel-trend"></canvas></div>
      </div>

      <table class="fa-table">
        <thead><tr>
          <th>Unit</th><th>Jarak (km)</th><th>BBM (L)</th><th>L/100km</th>
          <th>km/L${blocked ? '<small class="fa-fuel-th-note">tidak tersedia</small>' : ''}</th>
          ${cost ? '<th>Biaya</th>' : ''}
        </tr></thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="${cost ? 6 : 5}">Tidak ada unit dengan data pada periode ini.</td></tr>`
              : rows
                  .map(
                    (r) => `<tr>
                      <td>${esc(r.name)}</td>
                      <td>${fmt(r.km, 0)}</td>
                      <td>${fmt(r.litres)}</td>
                      <td>${r.efficiency === null ? '—' : fmt(r.efficiency)}</td>
                      <td>${r.economy === null ? '—' : fmt(r.economy, 2)}</td>
                      ${cost ? `<td>${currency} ${fmt(r.cost ?? 0, 0)}</td>` : ''}
                    </tr>`
                  )
                  .join('')
          }
        </tbody>
      </table>
    `);

    drawBarChart(rows);
    drawTrendChart(snap, settings);
    bindControls();
  }

  function drawBarChart(rows: { name: string; efficiency: number | null }[]): void {
    const usable = rows.filter((r) => r.efficiency !== null).slice(0, CHART_UNITS);
    const holder = container.querySelector<HTMLCanvasElement>('#fa-fuel-bar')?.parentElement;
    if (!holder) return;
    if (usable.length === 0) {
      // A chart of zeros would imply the fleet burns nothing.
      holder.innerHTML = '<p class="fa-empty">Belum ada unit dengan jarak tempuh, efisiensi tidak bisa dihitung.</p>';
      return;
    }
    barChart = new Chart(holder.querySelector('canvas')!, {
      type: 'bar',
      data: {
        labels: usable.map((r) => r.name),
        datasets: [{ label: 'L/100km', data: usable.map((r) => r.efficiency as number), backgroundColor: accent() }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function drawTrendChart(snap: Snapshot, cfg: Settings): void {
    const daily = dailyLitres(snap, cfg);
    const holder = container.querySelector<HTMLCanvasElement>('#fa-fuel-trend')?.parentElement;
    if (!holder) return;
    if (daily.length === 0) {
      holder.innerHTML = '<p class="fa-empty">Belum ada data harian pada periode ini.</p>';
      return;
    }
    trendChart = new Chart(holder.querySelector('canvas')!, {
      type: 'line',
      data: {
        labels: daily.map((d) => d.day),
        datasets: [
          { label: 'Liter', data: daily.map((d) => d.litres), borderColor: accent(), tension: 0.25, fill: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function bindControls(): void {
    for (const [id, key, min, max] of [
      ['fa-fuel-rate', 'litresPer100Km', 1, 200],
      ['fa-fuel-idle-rate', 'litresPerIdleHour', 0, 50],
      ['fa-fuel-tank', 'tankLitres', 1, 5000],
    ] as [string, keyof Settings, number, number][]) {
      const el = container.querySelector<HTMLInputElement>('#' + id);
      el?.addEventListener('change', () => {
        settings = { ...settings, [key]: clamp(Number(el.value), min, max, settings[key]) };
        saveSettings(ctx.database, settings);
        render(); // recompute from the snapshot — no refetch
      });
    }
  }

  // `dashboard:view-shown` fires on the SHARED rootEl for every view, including
  // the ones that just HID this one. Resizing a chart inside a display:none
  // container collapses it to 0x0 and it never comes back (the exact bug that
  // bit the heat map).
  const onShown = (): void => {
    if (container.clientWidth <= 0) return;
    barChart?.resize();
    trendChart?.resize();
  };
  ctx.rootEl.addEventListener('dashboard:view-shown', onShown);


  // Profil Operasi menulis knob ini ke localStorage lalu menyiarkan event ini.
  // Baca ulang dan render dari data yang sudah ada — tidak ada fetch baru.
  const onProfileChange = (): void => {
    settings = loadSettings(ctx.database);
    render();
  };
  ctx.rootEl.addEventListener('dashboard:profile-change', onProfileChange);

  const onTermClick = (e: Event): void => {
    const term = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-term]')?.dataset.term;
    if (term) openGlossary(term);
  };
  container.addEventListener('click', onTermClick);

  const stopFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  void load(getCurrentFilter());

  return () => {
    loadToken++; // an in-flight load must not render into a dead container
    stopFilter();
    ctx.rootEl.removeEventListener('dashboard:profile-change', onProfileChange);
    ctx.rootEl.removeEventListener('dashboard:view-shown', onShown);
    container.removeEventListener('click', onTermClick);
    stopExplain();
    destroyCharts();
  };
}

// --- source-specific numbers -------------------------------------------------

function litresByDevice(snap: Snapshot, cfg: Settings): Record<string, number> {
  switch (snap.source) {
    case 'transactions':
      return sumBy(snap.transactions, (t) => t.deviceId, (t) => t.volumeL);
    case 'cumulative':
      return consumptionFromCumulative(snap.rows);
    case 'level':
      return consumptionFromLevel(snap.rows, snap.levelIsPercent ? cfg.tankLitres : undefined);
    case 'distance':
      return estimateFromDistance(snap.trips, cfg.litresPer100Km);
    default:
      return {};
  }
}

// ponytail: the cumulative/level trend re-runs the same per-day consumption
// function per bucket, so the cross-midnight delta (last reading of day N ->
// first of day N+1) lands in neither day. Daily bars therefore sum slightly
// BELOW the range total, which is why the KPI is computed over the whole range
// instead of from this series. Carry the boundary reading into the next bucket
// if the two numbers ever have to reconcile exactly.
function dailyLitres(snap: Snapshot, cfg: Settings): { day: string; litres: number }[] {
  const perDay: Record<string, number> = {};
  const add = (day: string, litres: number) => {
    perDay[day] = (perDay[day] ?? 0) + litres;
  };

  if (snap.source === 'transactions') {
    for (const t of snap.transactions) add(dayKey(t.dateTime), t.volumeL);
  } else if (snap.source === 'distance') {
    for (const t of snap.trips) add(dayKey(t.start), (t.distanceKm * cfg.litresPer100Km) / 100);
  } else {
    for (const [day, rows] of Object.entries(groupByDay(snap.rows, (r) => r.dateTime))) {
      const perDevice =
        snap.source === 'cumulative'
          ? consumptionFromCumulative(rows)
          : consumptionFromLevel(rows, snap.levelIsPercent ? cfg.tankLitres : undefined);
      add(day, sumValues(perDevice));
    }
  }

  return Object.entries(perDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, litres]) => ({ day, litres }));
}

function kmByDevice(trips: TripDTO[]): Record<string, number> {
  return sumBy(trips, (t) => t.deviceId, (t) => t.distanceKm);
}

function costByDevice(transactions: FuelTransactionDTO[]): Record<string, number> {
  return sumBy(transactions, (t) => t.deviceId, (t) => t.cost ?? 0);
}

function sumBy<T>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = valueOf(row);
    if (Number.isFinite(value)) out[keyOf(row)] = (out[keyOf(row)] ?? 0) + value;
  }
  return out;
}

/** Fuel level is a percentage in most databases but litres in some. Anything
 *  above 100 cannot be a percentage, so the tank size must not be applied. */
function looksLikePercent(rows: StatusDataDTO[]): boolean {
  for (const r of rows) if (r.value > PERCENT_CEILING) return false;
  return rows.length > 0;
}

// --- markup ------------------------------------------------------------------

/** One definition of "is this measured or guessed", so the banner and the
 *  km/L card can never end up telling the user different stories. */
function isEstimateSource(source: FuelSource): boolean {
  return source !== 'transactions' && source !== 'cumulative';
}

/**
 * Why km/L is refused for some sources.
 *
 * With the distance fallback litres = km × rasio, so km/L is exactly
 * 100/rasio — the SAME number for every unit in the fleet, no matter how they
 * drive. It compares nothing while looking like a measurement, which is the
 * one thing this view exists to prevent. Decided with Aan: show "—" and say
 * why. `null` means the figure is real and may be printed.
 */
function economyBlocker(source: FuelSource): string | null {
  switch (source) {
    case 'distance':
      return 'Tidak tersedia: liter dihitung dari jarak × rasio, jadi km/L akan sama persis untuk semua unit.';
    case 'none':
      return 'Tidak tersedia: database ini tidak melaporkan data bahan bakar.';
    default:
      return null; // transactions / cumulative / level — litres were measured
  }
}

/** The whole point of the module: never let the user read an estimate as a
 *  measurement. Visible for every source, on every render. */
function renderBanner(snap: Snapshot, cfg: Settings): string {
  switch (snap.source) {
    case 'transactions':
      return banner(false, 'Sumber: Transaksi kartu BBM (FuelTransaction) — terukur', 'Volume dan biaya nyata dari transaksi pengisian.');
    case 'cumulative':
      return banner(
        false,
        `Sumber: Data mesin (${esc(snap.sourceDetail || 'Total Fuel Used')}) — terukur`,
        'Dihitung dari kenaikan counter bahan bakar kumulatif pada ECU.'
      );
    case 'level':
      return banner(
        true,
        'Sumber: Level tangki (Fuel Level) — estimasi',
        snap.levelIsPercent
          ? `Dijumlahkan dari penurunan level tangki, dikonversi memakai kapasitas ${fmt(cfg.tankLitres, 0)} L. Pengisian ulang diabaikan.`
          : 'Dijumlahkan dari penurunan level tangki (satuan liter dari kendaraan). Pengisian ulang diabaikan.'
      );
    default:
      return banner(
        true,
        `Sumber: Estimasi jarak × ${fmt(cfg.litresPer100Km)} L/100km — ubah rasio di bawah`,
        'Database ini tidak melaporkan data bahan bakar apa pun. Angka di bawah BUKAN hasil pengukuran.'
      );
  }
}

/** The TERUKUR/ESTIMASI pill. Shared by the banner and the km/L card so the
 *  new card speaks the view's existing visual language instead of a second
 *  one. fuel.css sizes it up inside an estimate banner. */
/** Chip keyakinan yang sama dengan seluruh dashboard, dan bisa diklik ke
 *  glosarium — sebelumnya halaman ini punya gaya sendiri (fa-fuel-tag) dan
 *  tidak ada tempat mana pun yang menjelaskan bedanya terukur dan estimasi. */
function sourceTag(isEstimate: boolean): string {
  const kind = isEstimate ? 'estimasi' : 'terukur';
  return `<button type="button" class="fa-kpi-kind fa-kpi-kind-${kind} fa-kpi-kind-btn" data-term="${kind}"
    aria-label="Apa arti ${kind}?">${kind === 'estimasi' ? 'ESTIMASI' : 'TERUKUR'}</button>`;
}

function banner(isEstimate: boolean, headline: string, detail: string): string {
  return `
    <div class="fa-fuel-banner${isEstimate ? ' is-estimate' : ''}">
      ${sourceTag(isEstimate)}
      <span class="fa-fuel-banner-text">
        <strong>${headline}</strong>
        <small>${detail}</small>
      </span>
    </div>`;
}

function renderControls(snap: Snapshot, cfg: Settings): string {
  const rateActive = snap.source === 'distance';
  return `
    <div class="fa-fuel-controls">
      <label class="fa-field">Rasio estimasi jarak (L/100km)
        <input type="number" id="fa-fuel-rate" min="1" max="200" step="0.5" value="${cfg.litresPer100Km}">
      </label>
      <label class="fa-field">Konsumsi idle (L/jam)
        <input type="number" id="fa-fuel-idle-rate" min="0" max="50" step="0.1" value="${cfg.litresPerIdleHour}">
      </label>
      ${
        snap.source === 'level' && snap.levelIsPercent
          ? `<label class="fa-field">Kapasitas tangki (L)
               <input type="number" id="fa-fuel-tank" min="1" max="5000" step="1" value="${cfg.tankLitres}">
             </label>`
          : ''
      }
      <p class="fa-fuel-hint">${
        rateActive
          ? 'Rasio ini menentukan seluruh angka BBM di halaman ini.'
          : 'Rasio jarak hanya dipakai bila database tidak punya data BBM. Konsumsi idle selalu heuristik.'
      }</p>
    </div>`;
}

// --- small helpers -----------------------------------------------------------

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Chart.js needs a real color, so read the shared token instead of inventing
 *  a second blue next to dashboard.css. */
function accent(): string {
  return token('--fa-accent', '#3b82f6');
}
