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
    toolsContainer: {} as any,
  }),
  initFilterBar: () => fakeCleanup,
  initSideMenu: () => fakeCleanup,
  initViewHost: () => fakeCleanup,
  initOperatingProfile: () => fakeCleanup,
  initGlossary: () => fakeCleanup,
});

let callbackCalled = false;
addin.initialize({} as any, { database: 'testdb' }, () => {
  callbackCalled = true;
});
assert.strictEqual(callbackCalled, true, 'expected callback() to be invoked synchronously by initialize()');

addin.blur();
assert.strictEqual(cleanupCalls, 5, 'expected all 5 cleanup functions to be called exactly once');

addin.blur();
assert.strictEqual(cleanupCalls, 5, 'expected a second blur() call to not re-invoke cleanups');

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
    toolsContainer: {} as any,
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
  initOperatingProfile: () => () => {
    survivorCleanups++;
  },
  initGlossary: () => () => {
    survivorCleanups++;
  },
});
throwingAddin.initialize({} as any, { database: 'testdb' }, () => {
  cbAfterThrow = true;
});
assert.strictEqual(cbAfterThrow, true, 'expected callback() to still run when a component throws');

// The surviving 2 components must still be wired and cleanable.
throwingAddin.blur();
assert.strictEqual(survivorCleanups, 4, 'expected the 4 non-throwing components to still register cleanups');

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
  initOperatingProfile: () => () => {},
  initGlossary: () => () => {},
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


// --- blur() lalu focus() harus MEMASANG ULANG -------------------------------
//
// Bug sungguhan: blur() membongkar semuanya (view-host mengosongkan area view,
// side-menu dan filter-bar melepas listener-nya), sementara focus() dulu tidak
// membangun apa pun kembali. Tombol menunya tetap ada di DOM beserta sorotan
// halaman terakhir — hanya saja mati. Setiap kali pengguna berpindah ke halaman
// MyGeotab lain lalu kembali, add-in berubah jadi cangkang yang tidak merespon
// klik apa pun. Ini yang menjaganya tidak terulang.
{
  let mounts = 0;
  let cleans = 0;
  const spy = () => {
    mounts++;
    return () => {
      cleans++;
    };
  };
  const a = createAddin({
    initGeotabClient: () => {},
    getAppElement: () => ({}) as any,
    renderShell: () => ({
      rootEl: {} as any,
      filterBarContainer: {} as any,
      sideMenuContainer: {} as any,
      viewContainer: {} as any,
      toolsContainer: {} as any,
    }),
    initFilterBar: spy,
    initSideMenu: spy,
    initViewHost: spy,
    initOperatingProfile: spy,
    initGlossary: spy,
  });

  a.initialize({} as any, { database: 'db1' }, () => {});
  assert.strictEqual(mounts, 5, 'initialize memasang kelima komponen');

  a.blur();
  assert.strictEqual(cleans, 5, 'blur membongkar kelimanya');

  a.focus({} as any, { database: 'db1' });
  assert.strictEqual(mounts, 10, 'focus() harus MEMASANG ULANG, bukan diam');

  // Idempoten: host yang memanggil focus() lagi tanpa blur() di antaranya tidak
  // boleh menumpuk lapisan kedua — itu akan menggandakan listener dan panggilan
  // API pada setiap siklus.
  a.focus({} as any, { database: 'db1' });
  assert.strictEqual(mounts, 10, 'focus() berulang tanpa blur() tidak memasang lagi');

  a.blur();
  assert.strictEqual(cleans, 10, 'blur kedua membongkar pemasangan kedua');

  // focus() tanpa state lengkap tetap bisa memasang, memakai state terakhir
  // dari initialize() — host tidak selalu mengisi argumen focus() selengkap
  // initialize(), dan kehilangan nama database berarti tidak bisa memasang apa pun.
  a.focus(undefined as any, undefined as any);
  assert.strictEqual(mounts, 15, 'focus() tanpa argumen memakai api/state terakhir');
  a.blur();

  // initialize() di atas instance yang masih hidup tidak boleh menggandakan:
  // pasang, lalu initialize lagi tanpa blur.
  a.initialize({} as any, { database: 'db1' }, () => {});
  const afterFirst = mounts;
  a.initialize({} as any, { database: 'db1' }, () => {});
  assert.strictEqual(mounts, afterFirst + 5, 'initialize ulang membongkar dulu, baru memasang');
  assert.strictEqual(cleans, mounts - 5, 'tidak ada pemasangan yang tertinggal tanpa pembongkaran');
}

// focus() sebelum initialize() sama sekali: tidak ada api/state untuk dipakai,
// jadi harus diam — bukan melempar.
createAddin().focus(undefined as any, undefined as any);

console.log('addin.check.ts: PASS');

