// Trip/log-record density heat map. Leaflet + leaflet.heat with a real OSM
// basemap (decision approved by Aan — see task brief). viz-agent scope.
//
// Rule from viz-agent CLAUDE.md: never feed thousands of raw points into
// L.heatLayer without aggregation — aggregatePoints() grid-buckets first.

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { fetchLogRecords } from '../api/fetchers/logrecord';
import type { FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange, toUtcRange } from '../utils/date-range';

const DEFAULT_CENTER: [number, number] = [0, 0];
const DEFAULT_ZOOM = 2;
// Matches logrecord.ts's own hard ceiling — asking for more was a dead number.
// No visual loss: aggregatePoints collapses everything into ~111m cells first,
// so points beyond this only deepen buckets that are already saturated.
const RESULTS_LIMIT = 5000;

/**
 * Grid-buckets lat/lon points by rounding to `precision` decimals (default 3,
 * ~111m cells at the equator) and sums weight per cell. Pure, no DOM/Leaflet
 * dependency — independently testable (see heatmap.check.ts).
 */
export function aggregatePoints(
  points: { lat: number; lon: number }[],
  precision = 3
): [number, number, number][] {
  const buckets = new Map<string, [number, number, number]>();
  const factor = 10 ** precision;

  for (const p of points) {
    const lat = Math.round(p.lat * factor) / factor;
    const lon = Math.round(p.lon * factor) / factor;
    const key = `${lat},${lon}`;
    const existing = buckets.get(key);
    if (existing) {
      existing[2] += 1;
    } else {
      buckets.set(key, [lat, lon, 1]);
    }
  }

  return [...buckets.values()];
}

/** Gradien bawaan leaflet.heat: biru (jarang) → hijau → kuning → merah (padat).
 *  Dituliskan ulang di sini karena legenda HARUS memakai warna yang sama persis
 *  dengan petanya; kalau salah satu berubah, keduanya harus ikut. */
const HEAT_GRADIENT = 'linear-gradient(to right, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)';

export function initHeatmap(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  // Peta tanpa legenda tidak bisa dibaca: warnanya terlihat berarti sesuatu,
  // tapi tidak ada yang mengatakan apa. Yang paling sering disalahartikan —
  // merah dikira "banyak kendaraan" atau "banyak pelanggaran", padahal ini
  // kepadatan TITIK GPS: satu truk yang parkir lama dengan mesin menyala
  // menghasilkan merah yang sama dengan sepuluh truk yang lewat.
  container.innerHTML = `
    <div class="fa-heat-head">
      <h2 class="fa-heat-title">Kepadatan Pergerakan</h2>
      <div class="fa-heat-legend" role="img"
           aria-label="Skala kepadatan titik GPS: biru berarti jarang, merah berarti padat">
        <span>jarang</span>
        <span class="fa-heat-scale" style="background:${HEAT_GRADIENT}"></span>
        <span>padat</span>
      </div>
    </div>
    <p class="fa-heat-note">
      Warna menunjukkan banyaknya <strong>titik GPS</strong> yang tercatat di suatu lokasi &mdash;
      bukan jumlah kendaraan dan bukan jumlah kejadian. Satu unit yang lama berhenti dengan mesin
      menyala menghasilkan warna semerah sepuluh unit yang melintas.
    </p>
    <div class="fa-heat-map"></div>
    <p class="fa-heat-empty fa-empty" hidden></p>
  `;

  const mapEl = container.querySelector<HTMLElement>('.fa-heat-map')!;
  const emptyEl = container.querySelector<HTMLElement>('.fa-heat-empty')!;

  const map = L.map(mapEl).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  let heatLayer: L.Layer | null = null;
  // Latest aggregated data, kept so the layer can be detached while hidden and
  // rebuilt on return. leaflet.heat renders via getImageData, which throws
  // "source width is 0" on a 0x0 canvas — and Leaflet redraws on ANY window
  // resize, including for maps sitting inside a hidden view. Detaching is the
  // only way to make that structurally impossible rather than merely unlikely.
  let lastBuckets: [number, number, number][] = [];

  const isVisible = () => mapEl.clientWidth > 0 && mapEl.clientHeight > 0;

  /** Rentang tanpa data sebelumnya hanya menyisakan peta polos — tidak bisa
   *  dibedakan dari peta yang gagal dimuat.
   *
   *  Petanya di-`display:none`, bukan `visibility:hidden`: yang kedua tetap
   *  memakan 400px sehingga pesannya terdorong keluar kotak. Konsekuensinya
   *  Leaflet kehilangan ukuran container saat disembunyikan, jadi saat data
   *  kembali ada ia harus diukur ulang — kalau tidak, yang muncul hanya tile abu. */
  function setEmpty(message: string): void {
    const wasHidden = mapEl.style.display === 'none';
    emptyEl.textContent = message;
    emptyEl.hidden = message === '';
    mapEl.style.display = message === '' ? '' : 'none';
    if (wasHidden && message === '' && mapEl.clientWidth > 0) map.invalidateSize();
  }

  function detachHeat() {
    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
  }

  function applyBuckets(buckets: [number, number, number][], fit: boolean) {
    detachHeat();
    if (buckets.length === 0) return;

    heatLayer = L.heatLayer(buckets, { radius: 20 }).addTo(map);
    if (!fit) return;
    const bounds = L.latLngBounds(buckets.map(([lat, lon]): [number, number] => [lat, lon]));
    map.fitBounds(bounds, { maxZoom: 14 });
  }

  async function load(dateFrom: string, dateTo: string, groupIds?: string[]) {
    try {
      const { fromIso, toIso } = toUtcRange(dateFrom, dateTo);
      const records = await fetchLogRecords({
        database: ctx.database,
        fromDate: fromIso,
        toDate: toIso,
        groupIds,
        resultsLimit: RESULTS_LIMIT,
      });
      lastBuckets = aggregatePoints(records);
      setEmpty(
        lastBuckets.length === 0
          ? 'Tidak ada titik GPS pada rentang tanggal dan grup ini. Perangkat perlu mengirim posisi — kalau unit memang jalan tapi peta kosong, periksa koneksi perangkatnya.'
          : ''
      );

      // The fetch is async: the user may have switched views while it was in
      // flight, so re-check visibility here rather than at call time. The layer
      // is rebuilt from lastBuckets by onViewShown when we come back.
      if (!isVisible()) return;
      applyBuckets(lastBuckets, true);
    } catch (err) {
      console.error('heatmap: load failed', err);
      setEmpty('Gagal memuat data posisi. Periksa koneksi atau hak akses, lalu ubah filter untuk mencoba lagi.');
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupIds);
  }

  // Leaflet measures its container once, at creation. Inside a hidden view that
  // measurement is 0x0, so the map renders grey tiles until it is told to
  // re-measure — every single time the user comes back to this view.
  //
  // `dashboard:view-shown` is broadcast on the SHARED rootEl, so this fires when
  // ANY view is revealed, including ones that hide us. Invalidating while our own
  // container is 0x0 makes leaflet.heat redraw into a zero-width canvas and throw
  // "getImageData: source width is 0" — so only act when we are the visible view.
  function onViewShown() {
    // Fires for EVERY view on the shared rootEl, so this is also how we learn we
    // have just been hidden: drop the heat layer so no resize can redraw it at 0x0.
    if (!isVisible()) {
      detachHeat();
      return;
    }
    map.invalidateSize();
    if (!heatLayer) applyBuckets(lastBuckets, false); // keep the user's pan/zoom
  }

  const initial = defaultDateRange();
  load(initial.dateFrom, initial.dateTo);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);
  ctx.rootEl.addEventListener('dashboard:view-shown', onViewShown);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    ctx.rootEl.removeEventListener('dashboard:view-shown', onViewShown);
    map.remove();
  };
}
