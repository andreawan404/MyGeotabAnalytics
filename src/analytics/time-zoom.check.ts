import assert from 'node:assert';
import { zoomWindow, panWindow, clampWindow, DEFAULT_MIN_SPAN_MS, type TimeWindow } from './time-zoom';

const DAY = 86_400_000;
const T0 = Date.parse('2026-07-27T00:00:00.000Z');
const bounds: TimeWindow = { min: T0, max: T0 + 7 * DAY }; // the 7-day range Aan complained about
const boundSpan = bounds.max - bounds.min;

const span = (w: TimeWindow) => w.max - w.min;
const finite = (w: TimeWindow, what: string) => {
  assert.ok(Number.isFinite(w.min) && Number.isFinite(w.max), `${what}: expected finite window, got ${JSON.stringify(w)}`);
  assert.ok(w.max > w.min, `${what}: expected max > min, got ${JSON.stringify(w)}`);
};

// --- zoom in halves the span -------------------------------------------------
const half = zoomWindow(bounds, 0.5, 0.5, bounds);
assert.strictEqual(span(half), boundSpan / 2, 'factor 0.5 should halve the span');
// centred zoom keeps the centre put
assert.strictEqual(half.min + span(half) / 2, bounds.min + boundSpan / 2, 'centre should not move at anchorRatio 0.5');

// --- the anchor is what stays still -----------------------------------------
const atStart = zoomWindow(bounds, 0.5, 0, bounds);
assert.strictEqual(atStart.min, bounds.min, 'anchorRatio 0 must pin min');
assert.strictEqual(span(atStart), boundSpan / 2, 'anchorRatio 0 should still halve the span');

const atEnd = zoomWindow(bounds, 0.5, 1, bounds);
assert.strictEqual(atEnd.max, bounds.max, 'anchorRatio 1 must pin max');
assert.strictEqual(span(atEnd), boundSpan / 2, 'anchorRatio 1 should still halve the span');

// an anchor a third of the way in keeps that instant at the same ratio
const third = zoomWindow(bounds, 0.5, 1 / 3, bounds);
const anchorInstant = bounds.min + boundSpan / 3;
assert.ok(Math.abs((anchorInstant - third.min) / span(third) - 1 / 3) < 1e-9, 'anchor should hold its relative position');

// --- zooming out never escapes bounds ---------------------------------------
let wide = zoomWindow(half, 4, 0.5, bounds);
assert.ok(wide.min >= bounds.min && wide.max <= bounds.max, 'zoom out must not exceed bounds');
for (let i = 0; i < 20; i++) wide = zoomWindow(wide, 2, Math.random(), bounds);
assert.deepStrictEqual(wide, bounds, 'repeated zoom out should settle exactly on bounds');

// zooming out from an off-centre window must not overshoot either
const offCentre = zoomWindow(zoomWindow(bounds, 0.2, 1, bounds), 3, 1, bounds);
assert.ok(offCentre.max <= bounds.max, 'zoom out at the right edge must not pass bounds.max');
finite(offCentre, 'offCentre');

// --- zooming in never goes below minSpanMs ----------------------------------
let tight: TimeWindow = bounds;
for (let i = 0; i < 40; i++) tight = zoomWindow(tight, 0.5, 0.5, bounds);
assert.strictEqual(span(tight), DEFAULT_MIN_SPAN_MS, '40x zoom in should rest exactly at the default floor');
assert.ok(tight.min >= bounds.min && tight.max <= bounds.max, 'the floored window must still sit inside bounds');

let custom: TimeWindow = bounds;
for (let i = 0; i < 40; i++) custom = zoomWindow(custom, 0.5, 0, bounds, 5 * 60_000);
assert.strictEqual(span(custom), 5 * 60_000, 'an explicit minSpanMs should be honoured');

// bounds narrower than the floor: bounds win, and nothing goes NaN
const narrow: TimeWindow = { min: T0, max: T0 + 10_000 };
assert.deepStrictEqual(zoomWindow(narrow, 0.5, 0.5, narrow), narrow, 'a sub-minute range cannot be zoomed past itself');

// --- panWindow preserves the span, especially at an edge --------------------
const zoomed = zoomWindow(bounds, 0.25, 0.5, bounds);
const panned = panWindow(zoomed, 0.5, bounds);
assert.strictEqual(span(panned), span(zoomed), 'a mid-range pan must not resize the window');
assert.strictEqual(panned.min, zoomed.min + span(zoomed) * 0.5, 'pan should shift by deltaRatio x span');

const slammedLeft = panWindow(zoomed, -99, bounds);
assert.strictEqual(span(slammedLeft), span(zoomed), 'hitting the left edge must not shrink the span');
assert.strictEqual(slammedLeft.min, bounds.min, 'pan should stop exactly at bounds.min');

const slammedRight = panWindow(zoomed, 99, bounds);
assert.strictEqual(span(slammedRight), span(zoomed), 'hitting the right edge must not shrink the span');
assert.strictEqual(slammedRight.max, bounds.max, 'pan should stop exactly at bounds.max');

// panning a full-bounds window is a no-op, not a resize
assert.deepStrictEqual(panWindow(bounds, 0.5, bounds), bounds, 'panning at full extent should do nothing');

// --- totality: garbage in, sane window out ----------------------------------
const reversed = clampWindow({ min: bounds.max, max: bounds.min }, bounds);
finite(reversed, 'reversed window');
assert.deepStrictEqual(reversed, bounds, 'a reversed window should unswap to the full range');

finite(clampWindow({ min: NaN, max: NaN }, bounds), 'NaN window');
finite(clampWindow({ min: NaN, max: bounds.max }, bounds), 'half-NaN window');
finite(clampWindow(bounds, { min: NaN, max: NaN }), 'NaN bounds');
finite(clampWindow({ min: bounds.max, max: bounds.min }, { min: bounds.max, max: bounds.min }), 'reversed bounds');
finite(zoomWindow({ min: NaN, max: NaN }, NaN, NaN, bounds), 'NaN everything');
finite(zoomWindow(bounds, -3, 5, bounds), 'negative factor, out-of-range anchor');
finite(zoomWindow(bounds, Infinity, -1, bounds), 'infinite factor');
finite(panWindow({ min: NaN, max: NaN }, NaN, bounds), 'NaN pan');
finite(clampWindow(undefined as unknown as TimeWindow, undefined as unknown as TimeWindow), 'undefined everything');

// a NaN factor must leave the window alone rather than blank the axis
assert.deepStrictEqual(zoomWindow(zoomed, NaN, 0.5, bounds), zoomed, 'NaN factor should be a no-op');

console.log('time-zoom.check.ts: PASS');
