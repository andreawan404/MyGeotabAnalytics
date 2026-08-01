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

const DEFAULT_CENTER: [number, number] = [0, 0];
const DEFAULT_ZOOM = 2;
const RESULTS_LIMIT = 20000; // bounded fetch; aggregatePoints keeps the heat layer light even at this volume

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

// ponytail: default-range helper duplicated across the 5 decoupled files by
// design (see kpi-card.ts comment) — no cross-imports until integration phase.
function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function initHeatmap(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const map = L.map(container).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  let heatLayer: L.Layer | null = null;

  async function load(dateFrom: string, dateTo: string) {
    try {
      const records = await fetchLogRecords({
        database: ctx.database,
        fromDate: dateFrom,
        toDate: dateTo,
        resultsLimit: RESULTS_LIMIT,
      });
      const buckets = aggregatePoints(records);

      if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
      }
      if (buckets.length === 0) return;

      heatLayer = L.heatLayer(buckets, { radius: 20 }).addTo(map);
      const bounds = L.latLngBounds(buckets.map(([lat, lon]): [number, number] => [lat, lon]));
      map.fitBounds(bounds, { maxZoom: 14 });
    } catch (err) {
      console.error('heatmap: load failed', err);
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo);
  }

  const initial = defaultDateRange();
  load(initial.from, initial.to);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    map.remove();
  };
}
