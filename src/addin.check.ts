// Importing ./addin transitively loads a .css file (unknown extension to Node)
// and leaflet (touches `document` at module scope), either of which throws
// before an assert can run. Every assertion below drives createAddin() through
// injected fakes, so those modules are never actually exercised — stub them at
// resolve time and the whole lifecycle spec runs under plain `tsx`.
//
// What it specifies: (1) blur() is safe before initialize() ever ran;
// (2) initialize() wires all 3 components and blur() invokes each cleanup
// exactly once, idempotently; (3) callback() ALWAYS fires â€” even when a
// component throws, or when initialize() itself throws. (3) is the contract
// whose violation left the add-in spinning forever in MyGeotab.

import assert from 'node:assert';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return /\.css$|^leaflet/.test(specifier)
      ? { url: 'data:text/javascript,export default {}', shortCircuit: true }
      : nextResolve(specifier, context);
  },
});

// Dynamic so the hook above is registered before ./addin's import chain resolves.
const { createAddin, fleetAnalyticsDashboard } = await import('./addin');

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
    sideMenuContainer: {} as any,
    viewContainer: {} as any,
  }),
  initFilterBar: () => fakeCleanup,
  initSideMenu: () => fakeCleanup,
  initViewHost: () => fakeCleanup,
});

let callbackCalled = false;
addin.initialize({} as any, { database: 'testdb' }, () => {
  callbackCalled = true;
});
assert.strictEqual(callbackCalled, true, 'expected callback() to be invoked synchronously by initialize()');

addin.blur();
assert.strictEqual(cleanupCalls, 3, 'expected all 3 cleanup functions to be called exactly once');

addin.blur();
assert.strictEqual(cleanupCalls, 3, 'expected a second blur() call to not re-invoke cleanups');

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
    sideMenuContainer: {} as any,
    viewContainer: {} as any,
  }),
  initFilterBar: () => () => {
    survivorCleanups++;
  },
  initSideMenu: () => {
    throw new Error('boom: simulated component failure');
  },
  initViewHost: () => () => {
    survivorCleanups++;
  },
});
throwingAddin.initialize({} as any, { database: 'testdb' }, () => {
  cbAfterThrow = true;
});
assert.strictEqual(cbAfterThrow, true, 'expected callback() to still run when a component throws');

// The surviving 2 components must still be wired and cleanable.
throwingAddin.blur();
assert.strictEqual(survivorCleanups, 2, 'expected the 2 non-throwing components to still register cleanups');

// A failure inside initialize() itself (before components) must also reach callback().
let cbAfterFatal = false;
const fatalAddin = createAddin({
  initGeotabClient: () => {
    throw new Error('boom: simulated fatal failure');
  },
  getAppElement: () => ({} as any),
  renderShell: () => ({}) as any,
  initFilterBar: () => () => {},
  initSideMenu: () => () => {},
  initViewHost: () => () => {},
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

