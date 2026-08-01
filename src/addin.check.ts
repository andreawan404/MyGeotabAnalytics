// Runs headlessly under plain Node/tsx — no DOM/Leaflet available, so this
// only checks: (1) blur() is safe before initialize() ever ran, and (2) via
// injected fake init* functions, initialize() wires all 4 components and
// blur() invokes each returned cleanup exactly once (idempotently). It does
// NOT verify real DOM rendering, filter wiring, or Leaflet/Chart.js behavior
// — that needs a real browser, same limitation as heatmap.check.ts.

import assert from 'node:assert';
import { fleetAnalyticsDashboard } from './addin';

// blur() before initialize() must be a safe no-op, not a crash.
const neverInitialized = fleetAnalyticsDashboard();
neverInitialized.blur();

// DI: fake components each return a cleanup spy.
let cleanupCalls = 0;
const fakeCleanup = () => {
  cleanupCalls++;
};

const addin = fleetAnalyticsDashboard({
  initGeotabClient: () => {},
  getAppElement: () => ({} as any),
  renderShell: () => ({
    rootEl: {} as any,
    filterBarContainer: {} as any,
    kpiContainer: {} as any,
    heatmapContainer: {} as any,
    timelineContainer: {} as any,
  }),
  initFilterBar: () => fakeCleanup,
  initKpiCards: () => fakeCleanup,
  initHeatmap: () => fakeCleanup,
  initTripTimeline: () => fakeCleanup,
});

let callbackCalled = false;
addin.initialize({} as any, { database: 'testdb' }, () => {
  callbackCalled = true;
});
assert.strictEqual(callbackCalled, true, 'expected callback() to be invoked synchronously by initialize()');

addin.blur();
assert.strictEqual(cleanupCalls, 4, 'expected all 4 cleanup functions to be called exactly once');

addin.blur();
assert.strictEqual(cleanupCalls, 4, 'expected a second blur() call to not re-invoke cleanups');

console.log('addin.check.ts: PASS');
