// Trip timeline as a Chart.js v4 floating horizontal bar chart (native
// indexAxis:'y' + [start,stop] data points — no separate gantt lib needed).
// viz-agent scope.

import { Chart, registerables } from 'chart.js';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchDevices } from '../api/fetchers/device';
import { fetchDiagnostics, resolveCumulativeFuelDiagnosticId } from '../api/fetchers/diagnostic';
import { fetchStatusData } from '../api/fetchers/status-data';
import { probeDiagnostics } from '../api/fetchers/probe';
import type { TripDTO, DeviceLite, FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange, toUtcRange } from '../utils/date-range';
import {
  buildTripDetails,
  fuelPerTrip,
  formatDurationId,
  formatTripTooltip,
  type TripDetail,
} from '../analytics/trip-detail';
import {
  zoomWindow,
  panWindow,
  clampWindow,
  DEFAULT_MIN_SPAN_MS,
  type TimeWindow,
} from '../analytics/time-zoom';

Chart.register(...registerables);

// The zoom stylesheet is pulled in at mount rather than as a top-level
// `import '../styles/trip-timeline.css'`.
//
// Measured, not guessed: trip-timeline.check.ts imports THIS module to assert
// tripsToFloatingBars under `tsx`, and Node cannot load a .css file. A static
// import makes that check die with ERR_UNKNOWN_FILE_EXTENSION, which takes
// `npm run check` down with it — exactly why heatmap.check.ts (whose module
// imports leaflet.css) is the one check missing from package.json's script.
// Deferring it to mount keeps the CSS out of the module graph Node walks, while
// Vite still statically analyses the literal specifier and emits the stylesheet.
//
// The ts-ignore is the cost: a bare `import 'x.css'` needs no type, but a
// dynamic import produces a value and TS wants a declaration this project has
// no *.css.d.ts for.
// ponytail: one suppressed line beats a css.d.ts + tsconfig edit in files I
// don't own. Delete it the day `vite/client` types get referenced.
let stylesLoaded = false;
function loadStyles() {
  if (stylesLoaded) return;
  stylesLoaded = true;
  // @ts-ignore -- no *.css module declaration in this project; see above.
  import('../styles/trip-timeline.css').catch((err) =>
    console.warn('trip-timeline: stylesheet failed to load', err)
  );
}

// Wheel notch and button step. 0.8 is small enough that a trackpad's many small
// deltas feel continuous rather than jumpy.
const ZOOM_STEP = 0.8;

// The cumulative fuel counter is resolved by resolveCumulativeFuelDiagnosticId
// (diagnostic.ts) — id first, name only as a fallback, shared with the BBM view
// so the two can never disagree about which counter they are reading.

/**
 * Maps trips to Chart.js floating-bar points. x uses raw epoch-ms timestamps
 * (not hour-offsets from day start) — simpler and correct across multi-day
 * ranges; tick labels are formatted for display in initTripTimeline instead.
 * Pure, no DOM/Chart.js dependency — independently testable.
 *
 * The point shape stays exactly {x, y}: per-bar tooltip context lives in a
 * PARALLEL TripDetail[] built by buildTripDetails from the same trips array, so
 * Chart.js's `dataIndex` addresses both. Both are straight `trips.map` calls and
 * neither may filter or reorder.
 */
export function tripsToFloatingBars(
  trips: TripDTO[],
  devices: DeviceLite[]
): { x: [number, number]; y: string }[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  return trips.map((t) => ({
    x: [new Date(t.start).getTime(), new Date(t.stop).getTime()],
    y: nameById.get(t.deviceId) ?? t.deviceId,
  }));
}

/**
 * Full extent of the loaded data — the outer limit zooming out can never pass.
 *
 * Padded by 2% so the first and last bars are not welded to the axis ends.
 * Falls back to the requested date range when nothing loaded, so the toolbar
 * still shows a meaningful window instead of 1970.
 */
function boundsFromBars(bars: { x: [number, number] }[], fallback: TimeWindow): TimeWindow {
  let min = Infinity;
  let max = -Infinity;
  for (const b of bars) {
    if (b.x[0] < min) min = b.x[0];
    if (b.x[1] > max) max = b.x[1];
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return clampWindow(fallback, fallback);
  const pad = Math.max((max - min) * 0.02, DEFAULT_MIN_SPAN_MS);
  return { min: min - pad, max: max + pad };
}

const WINDOW_FMT = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Chart.js tooltips are hover/tap driven. Fine for a chart, but the numbers
 *  must not exist ONLY on hover, so the same values go on the canvas as text a
 *  screen reader can reach. Capped — a week of fleet trips would otherwise build
 *  a label thousands of lines long. */
function ariaSummary(details: TripDetail[]): string {
  if (details.length === 0) return 'Linimasa perjalanan: tidak ada perjalanan pada rentang ini.';

  const units = new Set(details.map((d) => d.deviceName)).size;
  const totalKm = details.reduce((sum, d) => sum + d.distanceKm, 0);
  const totalSec = details.reduce((sum, d) => sum + d.engineOnSec, 0);
  const head =
    `Linimasa ${details.length} perjalanan dari ${units} unit. ` +
    `Total jarak ${totalKm.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km, ` +
    `total mesin menyala ${formatDurationId(totalSec)}.`;

  const LIMIT = 25;
  const rows = details
    .slice(0, LIMIT)
    .map((d) => `${d.deviceName} — ${formatTripTooltip(d).join('; ')}`);
  if (details.length > LIMIT) rows.push(`… dan ${details.length - LIMIT} perjalanan lainnya.`);

  return [head, ...rows].join(' ');
}

/**
 * Litres per trip, but only when the database genuinely measures it.
 *
 * Deliberately NOT `jarak x rasio`: that is distance times a constant sitting
 * next to the distance already in the tooltip — no new information, dressed up
 * as a measurement. Absent -> null -> the tooltip says so.
 *
 * Cost ladder, cheapest exit first. Every step is cached and fleet-wide; there
 * is no per-trip and no per-device call anywhere in here, which is what keeps a
 * real fleet off the rate limiter (root CLAUDE.md rule 6):
 *   1. no trips                    -> 0 calls
 *   2. no such diagnostic by name  -> 1 (Diagnostic catalogue, cached 24h)
 *   3. diagnostic never reports    -> + 1 probe multiCall (cached 24h), and NO StatusData
 *   4. it reports                  -> + 1 StatusData for the whole visible range
 */
async function fetchFuelRows(params: {
  database: string;
  trips: TripDTO[];
  fromIso: string;
  toIso: string;
  groupId?: string;
}) {
  const { database, trips, fromIso, toIso, groupId } = params;
  if (trips.length === 0) return [];

  const diagnostics = await fetchDiagnostics({ database }); // near-static, cached 24h
  const diagnosticId = resolveCumulativeFuelDiagnosticId(diagnostics);
  if (!diagnosticId) return [];

  const probe = await probeDiagnostics({ database, diagnosticIds: [diagnosticId], toIso, groupId });
  if (probe[diagnosticId] !== true) return [];

  return fetchStatusData({ database, diagnosticId, fromDate: fromIso, toDate: toIso, groupId });
}

export function initTripTimeline(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  loadStyles();
  container.classList.add('tt-root');

  // Toolbar first, then the canvas in its own wrapper: dashboard.css forces the
  // canvas to 100% of its parent, so it needs a parent that is "the space left
  // under the toolbar" rather than the whole panel.
  const toolbar = document.createElement('div');
  toolbar.className = 'tt-toolbar';

  const mkBtn = (label: string, ariaLabel: string) => {
    const b = document.createElement('button');
    b.type = 'button'; // inside a form this would otherwise submit it
    b.className = 'tt-btn';
    b.textContent = label;
    b.setAttribute('aria-label', ariaLabel);
    return b;
  };

  // Visible controls are not optional: the wheel gesture is invisible, needs a
  // modifier, and is unreachable by touch or keyboard entirely.
  const zoomInBtn = mkBtn('+', 'Perbesar rentang waktu');
  const zoomOutBtn = mkBtn('−', 'Perkecil rentang waktu');
  const resetBtn = mkBtn('Reset', 'Atur ulang zoom ke rentang penuh');

  const hint = document.createElement('span');
  hint.className = 'tt-hint';
  hint.textContent = 'Ctrl + gulir untuk zoom, seret untuk geser';

  const windowLabel = document.createElement('span');
  windowLabel.className = 'tt-window';
  // Announce the new window on zoom — otherwise the only feedback is visual.
  windowLabel.setAttribute('aria-live', 'polite');

  toolbar.append(zoomInBtn, zoomOutBtn, resetBtn, hint, windowLabel);
  container.appendChild(toolbar);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'tt-chart-wrap';
  const canvas = document.createElement('canvas');
  chartWrap.appendChild(canvas);
  container.appendChild(chartWrap);

  let chart: Chart | null = null;
  // Index-parallel to the chart's data points; the tooltip callbacks read it by
  // dataIndex. Reassigned as a whole with the chart so the two can never drift.
  let details: TripDetail[] = [];
  // Fuel adds up to two more awaits, widening the window in which a second
  // filter change can overtake the first. Only the newest load may render.
  let loadToken = 0;

  const initial = defaultDateRange();

  // Full loaded extent, and the slice of it currently on screen. Seeded from the
  // range we are about to request so the toolbar reads sensibly on first paint —
  // an epoch-0 placeholder would flash "1 Jan 1970" until the fetch returns.
  const initialRange = toUtcRange(initial.dateFrom, initial.dateTo);
  let bounds: TimeWindow = {
    min: Date.parse(initialRange.fromIso),
    max: Date.parse(initialRange.toIso),
  };
  let visible: TimeWindow = bounds;

  /** Pushes `visible` onto the axis and resyncs the toolbar. */
  function applyWindow() {
    visible = clampWindow(visible, bounds, DEFAULT_MIN_SPAN_MS);

    // scales.x is a union across every registered scale type; the linear scale's
    // min/max are plain numbers and this is the least noisy way to say so.
    const x = chart?.options.scales?.x as { min?: number; max?: number } | undefined;
    if (x) {
      x.min = visible.min;
      x.max = visible.max;
      // 'none' skips the animation — a single wheel gesture fires dozens of
      // updates and animating each one turns the chart to treacle.
      chart!.update('none');
    }

    windowLabel.textContent = `${WINDOW_FMT.format(new Date(visible.min))} – ${WINDOW_FMT.format(new Date(visible.max))}`;

    // Disabled for real, not just greyed: a control that looks dead but still
    // fires is worse than no control.
    const boundSpan = bounds.max - bounds.min;
    const span = visible.max - visible.min;
    const atFull = span >= boundSpan - 1;
    const atFloor = span <= Math.min(DEFAULT_MIN_SPAN_MS, boundSpan) + 1;
    zoomOutBtn.disabled = atFull;
    resetBtn.disabled = atFull;
    zoomInBtn.disabled = atFloor;
  }

  function zoomBy(factor: number, anchorRatio: number) {
    visible = zoomWindow(visible, factor, anchorRatio, bounds, DEFAULT_MIN_SPAN_MS);
    applyWindow();
  }

  /** Pointer position as 0..1 across the plot area, so zoom centres on the
   *  cursor. Falls back to the middle before the first render. */
  function anchorFromEvent(e: MouseEvent): number {
    const area = chart?.chartArea;
    if (!area) return 0.5;
    const width = area.right - area.left;
    if (!(width > 0)) return 0.5;
    const x = e.clientX - canvas.getBoundingClientRect().left - area.left;
    return x / width;
  }

  function onWheel(e: WheelEvent) {
    // Plain wheel MUST keep scrolling the page. Grabbing it would trap the
    // cursor and make the dashboard unscrollable anywhere over the chart, so
    // only ctrl (or cmd on macOS) means zoom — and only then do we preventDefault.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, anchorFromEvent(e));
  }

  // Drag to pan. Tracked incrementally from the last x so a drag that leaves the
  // canvas still tracks, and mouseup on window still ends it.
  let dragX: number | null = null;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    dragX = e.clientX;
    canvas.classList.add('tt-grabbing');
  }

  function onMouseMove(e: MouseEvent) {
    if (dragX === null) return;
    const area = chart?.chartArea;
    if (!area) return;
    const width = area.right - area.left;
    if (!(width > 0)) return;
    const dx = e.clientX - dragX;
    dragX = e.clientX;
    // Drag right = look further back in time, i.e. the window moves left.
    visible = panWindow(visible, -dx / width, bounds);
    applyWindow();
  }

  function onMouseUp() {
    if (dragX === null) return;
    dragX = null;
    canvas.classList.remove('tt-grabbing');
  }

  function onZoomIn() {
    zoomBy(ZOOM_STEP, 0.5);
  }
  function onZoomOut() {
    zoomBy(1 / ZOOM_STEP, 0.5);
  }
  function onReset() {
    visible = bounds;
    applyWindow();
  }

  async function load(dateFrom: string, dateTo: string, groupId?: string) {
    const token = ++loadToken;
    try {
      const { fromIso, toIso } = toUtcRange(dateFrom, dateTo);
      const [trips, devices] = await Promise.all([
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
      ]);

      // Fuel is a tooltip nicety — it must never cost us the chart.
      let fuelRows: Awaited<ReturnType<typeof fetchFuelRows>> = [];
      try {
        fuelRows = await fetchFuelRows({ database: ctx.database, trips, fromIso, toIso, groupId });
      } catch (err) {
        console.warn('trip-timeline: fuel lookup failed, tooltip will show "—"', err);
      }

      if (token !== loadToken) return; // a newer load already owns the chart

      const bars = tripsToFloatingBars(trips, devices);
      details = buildTripDetails(trips, devices, fuelPerTrip(trips, fuelRows));

      // New data, new extent — and the view resets to unzoomed, because a
      // leftover window from the previous filter would show an empty axis.
      bounds = boundsFromBars(bars, { min: Date.parse(fromIso), max: Date.parse(toIso) });
      visible = bounds;

      chart?.destroy();
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          datasets: [
            {
              label: 'Perjalanan',
              data: bars as unknown as number[],
              backgroundColor: '#3b82f6',
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          // The wheel handler is our own; Chart.js should not also chase the
          // pointer through dozens of events per gesture.
          animation: false,
          scales: {
            x: {
              type: 'linear',
              // Values are absolute epoch-ms timestamps, not counts from zero —
              // beginAtZero (BarController's default) would stretch the axis
              // back to 1970 and shrink every real bar to sub-pixel width.
              beginAtZero: false,
              min: visible.min,
              max: visible.max,
              ticks: {
                callback: (value) =>
                  new Date(Number(value)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
              },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              // Without these the default label callback prints the raw floating-bar
              // payload — `Trips: [1785029489000, 1785029895000]`, two epoch-ms
              // numbers. Device name in the title, the real figures in the body.
              callbacks: {
                title: (items) => details[items[0]?.dataIndex ?? -1]?.deviceName ?? '',
                label: (item) => {
                  const d = details[item.dataIndex];
                  return d ? formatTripTooltip(d) : [];
                },
              },
            },
          },
        },
      });

      applyWindow();

      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', ariaSummary(details));
    } catch (err) {
      console.error('trip-timeline: load failed', err);
    }
  }

  function onFilterChange(e: Event) {
    const detail = (e as CustomEvent<FilterChangeDetail>).detail;
    load(detail.dateFrom, detail.dateTo, detail.groupId);
  }

  // `dashboard:view-shown` is broadcast on the SHARED rootEl for EVERY view,
  // including the ones that just hid this one. Resizing a Chart.js instance
  // whose container is display:none collapses it to 0x0 and it never comes back
  // — the exact bug that bit the heat map. clientWidth > 0 means "actually us".
  function onViewShown() {
    if (container.clientWidth > 0) chart?.resize();
  }

  load(initial.dateFrom, initial.dateTo);
  applyWindow(); // toolbar is legible (and correctly disabled) before data lands

  // passive:false — the default for wheel is passive, where preventDefault is
  // ignored and the ctrl+wheel would zoom the whole browser page instead.
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  zoomInBtn.addEventListener('click', onZoomIn);
  zoomOutBtn.addEventListener('click', onZoomOut);
  resetBtn.addEventListener('click', onReset);
  ctx.rootEl.addEventListener('dashboard:filter-change', onFilterChange);
  ctx.rootEl.addEventListener('dashboard:view-shown', onViewShown);

  return () => {
    loadToken++; // an in-flight load must not build a chart into a dead container
    // The window-level listeners in particular outlive the container, so they
    // must come off — otherwise every blur()/focus() cycle leaves another live
    // pan handler pointing at a destroyed chart.
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    zoomInBtn.removeEventListener('click', onZoomIn);
    zoomOutBtn.removeEventListener('click', onZoomOut);
    resetBtn.removeEventListener('click', onReset);
    ctx.rootEl.removeEventListener('dashboard:filter-change', onFilterChange);
    ctx.rootEl.removeEventListener('dashboard:view-shown', onViewShown);
    container.classList.remove('tt-root');
    chart?.destroy();
    chart = null;
  };
}
