// Time-window maths for the trip timeline's x axis (epoch-ms).
//
// PURE on purpose: no DOM, no Chart.js, no imports at all. That is what lets
// time-zoom.check.ts run under `tsx` — and it keeps the only fiddly part of the
// zoom feature (the arithmetic) testable without a browser.
//
// Every function here is TOTAL: NaN, undefined, reversed or absurd input yields
// a sane window inside bounds, never NaN. A NaN reaching `scales.x.min` blanks
// the whole chart with no error in the console, which is a miserable bug to
// chase — cheaper to make it unrepresentable here.

export interface TimeWindow {
  min: number;
  max: number;
}

/** Below one minute the axis stops meaning anything — every tick collapses onto
 *  the same label and the bars are wider than the view. */
export const DEFAULT_MIN_SPAN_MS = 60_000;

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Bounds are the authority on the outer limit, so they get repaired first and
 *  everything else is fitted to them. */
function normalizeBounds(bounds: TimeWindow | undefined | null): TimeWindow {
  let min = isNum(bounds?.min) ? (bounds as TimeWindow).min : NaN;
  let max = isNum(bounds?.max) ? (bounds as TimeWindow).max : NaN;

  if (!isNum(min) && !isNum(max)) {
    min = 0;
    max = DEFAULT_MIN_SPAN_MS;
  } else if (!isNum(min)) {
    min = max - DEFAULT_MIN_SPAN_MS;
  } else if (!isNum(max)) {
    max = min + DEFAULT_MIN_SPAN_MS;
  }

  if (max < min) [min, max] = [max, min]; // reversed: swap, don't discard the range
  if (max === min) max = min + DEFAULT_MIN_SPAN_MS; // zero-width: give it the floor

  return { min, max };
}

/** A loaded range shorter than the requested floor makes "inside bounds" and "at
 *  least minSpan" contradictory. Bounds win — you can never see more time than
 *  was actually loaded. */
function effectiveMinSpan(minSpanMs: number | undefined, boundSpan: number): number {
  const requested = isNum(minSpanMs) && minSpanMs > 0 ? minSpanMs : DEFAULT_MIN_SPAN_MS;
  return Math.min(requested, boundSpan);
}

/**
 * Fits `win` inside `bounds`, honouring the minimum span.
 *
 * When the window overruns an edge it is TRANSLATED, not trimmed — its span is
 * preserved. That single property is what makes panWindow correct at the edges
 * (a trimmed window would shrink a little on every pan into the wall).
 */
export function clampWindow(
  win: TimeWindow,
  bounds: TimeWindow,
  minSpanMs?: number
): TimeWindow {
  const b = normalizeBounds(bounds);
  const boundSpan = b.max - b.min;
  const minSpan = effectiveMinSpan(minSpanMs, boundSpan);

  let min = isNum(win?.min) ? win.min : b.min;
  let max = isNum(win?.max) ? win.max : b.max;
  if (max < min) [min, max] = [max, min];

  let span = max - min;
  if (span < minSpan) {
    const centre = min + span / 2;
    min = centre - minSpan / 2;
    max = centre + minSpan / 2;
    span = minSpan;
  } else if (span > boundSpan) {
    min = b.min;
    max = b.max;
    span = boundSpan;
  }

  if (min < b.min) {
    min = b.min;
    max = b.min + span;
  } else if (max > b.max) {
    max = b.max;
    min = b.max - span;
  }

  return { min, max };
}

/**
 * Scales the window about `anchorRatio` (0..1 across the plot area).
 *
 * Anchoring on the pointer rather than the centre is the whole point: you zoom
 * into the trip you are looking at instead of watching it slide off-screen.
 * `factor < 1` zooms in, `> 1` zooms out.
 */
export function zoomWindow(
  win: TimeWindow,
  factor: number,
  anchorRatio: number,
  bounds: TimeWindow,
  minSpanMs?: number
): TimeWindow {
  const cur = clampWindow(win, bounds, minSpanMs);
  const f = isNum(factor) && factor > 0 ? factor : 1;
  const r = isNum(anchorRatio) ? Math.min(1, Math.max(0, anchorRatio)) : 0.5;

  // The instant under the cursor keeps its pixel position: both distances from
  // the anchor to the edges scale by the same factor. At r=0 that leaves `min`
  // untouched, at r=1 `max`.
  const anchor = cur.min + (cur.max - cur.min) * r;
  return clampWindow(
    { min: anchor - (anchor - cur.min) * f, max: anchor + (cur.max - anchor) * f },
    bounds,
    minSpanMs
  );
}

/** Shifts the window by a fraction of its own span. Stops at bounds without
 *  changing the span — see clampWindow's translate-don't-trim rule. */
export function panWindow(win: TimeWindow, deltaRatio: number, bounds: TimeWindow): TimeWindow {
  const cur = clampWindow(win, bounds);
  const span = cur.max - cur.min;
  const shift = span * (isNum(deltaRatio) ? deltaRatio : 0);
  // Passing the current span as the floor pins it exactly: a pan can never be
  // the thing that resizes the window.
  return clampWindow({ min: cur.min + shift, max: cur.max + shift }, bounds, span);
}
