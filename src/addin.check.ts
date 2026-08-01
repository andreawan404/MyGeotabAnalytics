// KNOWN LIMITATION: this does not currently execute under plain Node/tsx.
// Importing ./addin transitively loads charts/heatmap.ts -> leaflet, and
// Leaflet touches `window` at module scope, so the import throws before any
// assert runs. Same root limitation as heatmap.check.ts. Verified instead in a
// real browser via the dev harness (dev/dev-dashboard.html). Kept because the
// assertions below are the executable spec for the lifecycle contract, and
// they run as soon as that import chain is browser-independent.
//
// What it specifies: (1) blur() is safe before initialize() ever ran;
// (2) initialize() wires all 4 components and blur() invokes each cleanup
// exactly once, idempotently; (3) callback() ALWAYS fires â€” even when a
// component throws, or when initialize() itself throws. (3) is the contract
// whose violation left the add-in spinning forever in MyGeotab.

import assert from 'node:assert';
import { createAddin, fleetAnalyticsDashboard } from './addin';

// blur() before initialize() must be a safe no-op, not a crash.
const neverInitialized = createAddin();
neverInitialized.blur();

// DI: fake components each return a cleanup spy.
let cleanupCalls = 0;
const fakeCleanup = () => {
  cleanupCalls++;
};

const addin = createAddin({
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

// The spinner in MyGeotab only clears when callback() runs, so a throwing
// component must NOT prevent it â€” the whole reason the add-in hung before.
let cbAfterThrow = false;
let survivorCleanups = 0;
const throwingAddin = createAddin({
  initGeotabClient: () => {},
  getAppElement: () => ({} as any),
  renderShell: () => ({
    rootEl: {} as any,
    filterBarContainer: {} as any,
    kpiContainer: {} as any,
    heatmapContainer: {} as any,
    timelineContainer: {} as any,
  }),
  initFilterBar: () => () => {
    survivorCleanups++;
  },
  initKpiCards: () => {
    throw new Error('boom: simulated component failure');
  },
  initHeatmap: () => () => {
    survivorCleanups++;
  },
  initTripTimeline: () => () => {
    survivorCleanups++;
  },
});
throwingAddin.initialize({} as any, { database: 'testdb' }, () => {
  cbAfterThrow = true;
});
assert.strictEqual(cbAfterThrow, true, 'expected callback() to still run when a component throws');

// The surviving 3 components must still be wired and cleanable.
throwingAddin.blur();
assert.strictEqual(survivorCleanups, 3, 'expected the 3 non-throwing components to still register cleanups');

// A failure inside initialize() itself (before components) must also reach callback().
let cbAfterFatal = false;
const fatalAddin = createAddin({
  initGeotabClient: () => {
    throw new Error('boom: simulated fatal failure');
  },
  getAppElement: () => ({} as any),
  renderShell: () => ({}) as any,
  initFilterBar: () => () => {},
  initKpiCards: () => () => {},
  initHeatmap: () => () => {},
  initTripTimeline: () => () => {},
});
fatalAddin.initialize({} as any, { database: 'testdb' }, () => {
  cbAfterFatal = true;
});
assert.strictEqual(cbAfterFatal, true, 'expected callback() to still run when initialize() itself throws');

// The host entry must take NO parameters. The SDK's own example is
// `geotab.addin.x = function (api, state, callback)`, so MyGeotab may call the
// factory with arguments; if it declared a `deps` parameter those arguments
// would be mistaken for injected dependencies and it would throw instead of
// returning a lifecycle object — leaving the add-in blank.
assert.strictEqual(
  fleetAnalyticsDashboard.length,
  0,
  'fleetAnalyticsDashboard() must declare no parameters — the host may call it with arguments'
);
const asHostCallsIt = (fleetAnalyticsDashboard as (...a: unknown[]) => unknown)(
  { call: () => {}, multiCall: () => {} },
  { database: 'testdb' },
  () => {}
) as ReturnType<typeof createAddin>;
for (const fn of ['initialize', 'focus', 'blur'] as const) {
  assert.strictEqual(
    typeof asHostCallsIt[fn],
    'function',
    `expected a usable ${fn}() even when the host passes arguments to the factory`
  );
}

console.log('addin.check.ts: PASS');

