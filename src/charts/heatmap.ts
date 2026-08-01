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

export function initHeatmap(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const map = L.map(container).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
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

  const isVisible = () => container.clientWidth > 0 && container.clientHeight > 0;

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

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    try {
      const { fromIso, toIso } = toUtcRange(dateFrom, dateTo);
      const records = await fetchLogRecords({
        database: ctx.database,
        fromDate: fromIso,
        toDate: toIso,
        groupId,
        resultsLimit: RESULTS_LIMIT,
      });
      lastBuckets = aggregatePoints(records);

      // The fetch is async: the user may have switched views while it was in
      // flight, so re-check visibility here rather than at call time. The layer
      // is rebuilt from lastBuckets by onViewShown when we come back.
      if (!isVisible()) return;
      applyBuckets(lastBuckets, true);
    } catch (err) {
      console.error('heatmap: load failed', err);
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
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
