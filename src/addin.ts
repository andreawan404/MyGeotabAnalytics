// MyGeotab Add-In entrypoint. Thin composition only — wires the host
// lifecycle (initialize/focus/blur) to the shell + the 3 init* components.
// No business logic here (root CLAUDE.md).
//
// The charts are no longer wired here: view-host mounts them via the
// "overview" view (src/views/registry.ts).

import { initGeotabClient, type GeotabApi } from './api/geotabClient';
import { renderShell } from './components/shell';
import { initFilterBar } from './components/filter-bar';
import { initSideMenu } from './components/side-menu';
import { initViewHost } from './components/view-host';
import { initOperatingProfile } from './components/operating-profile';
import { initGlossary } from './components/glossary';

export interface GeotabAddinState {
  database: string;
  /** Pindah ke halaman MyGeotab lain. Satu-satunya jalan tersisa menuju rekaman
   *  kamera: klipnya tidak ada di API publik (lihat media-file.ts), jadi yang
   *  bisa dilakukan add-in hanyalah mengantar pengguna ke halaman Video bawaan. */
  gotoPage?: (page: string, params?: object) => void;
  /** Apakah halaman itu ADA dan boleh dibuka pengguna ini. Dipakai supaya
   *  tombolnya tidak pernah menjanjikan halaman yang tidak akan terbuka. */
  hasAccessToPage?: (page: string) => boolean;
}

type Cleanup = () => void;

// ponytail: DI seam exists only so addin.check.ts can swap in fake init*
// functions and skip real DOM/Leaflet — the host always uses defaultDeps.
export interface AddinDeps {
  initGeotabClient: typeof initGeotabClient;
  getAppElement: () => HTMLElement | null;
  renderShell: typeof renderShell;
  initFilterBar: typeof initFilterBar;
  initSideMenu: typeof initSideMenu;
  initViewHost: typeof initViewHost;
  initOperatingProfile: typeof initOperatingProfile;
  initGlossary: typeof initGlossary;
}

const defaultDeps: AddinDeps = {
  initGeotabClient,
  // Create #app if the host injected the page without it — nothing in
  // initialize() may throw, or the spinner never clears (see below).
  getAppElement: () => {
    let el = document.getElementById('app');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app';
      document.body.appendChild(el);
    }
    return el;
  },
  renderShell,
  initFilterBar,
  initSideMenu,
  initViewHost,
  initOperatingProfile,
  initGlossary,
};

/** Set by initialize(); read by the diagnostic timer at the bottom of this file. */
let initializeCalled = false;

/** Internal factory — the `deps` seam exists only for addin.check.ts. */
export function createAddin(deps: AddinDeps = defaultDeps) {
  let cleanups: Cleanup[] = [];
  /** Sudah terpasang? Menjaga focus() tidak memasang lapisan kedua di atas
   *  yang pertama kalau host memanggilnya tanpa blur() di antaranya. */
  let mounted = false;
  /** api & state terakhir dari initialize(). focus() SEHARUSNYA membawanya
   *  sendiri, tapi tidak semua host mengisinya lengkap — dan kehilangan nama
   *  database berarti tidak bisa memasang apa pun. */
  let lastApi: GeotabApi | null = null;
  let lastState: GeotabAddinState | null = null;

  function mount(api: GeotabApi, state: GeotabAddinState): void {
    if (mounted) return;
    deps.initGeotabClient(api);

    const appEl = deps.getAppElement();
    if (!appEl) throw new Error('fleetAnalyticsDashboard: #app element not found');

    const shell = deps.renderShell(appEl, { database: state.database });
    const ctx = { database: state.database, rootEl: shell.rootEl, state };

    // Wire each component independently so one failure doesn't take the rest down.
    // filter-bar FIRST: it publishes the current filter that views read at mount.
    for (const [name, init, container] of [
      ['filter-bar', deps.initFilterBar, shell.filterBarContainer],
      ['operating-profile', deps.initOperatingProfile, shell.toolsContainer],
      ['glossary', deps.initGlossary, shell.toolsContainer],
      ['side-menu', deps.initSideMenu, shell.sideMenuContainer],
      ['view-host', deps.initViewHost, shell.viewContainer],
    ] as [string, (c: HTMLElement, x: typeof ctx) => Cleanup, HTMLElement][]) {
      try {
        cleanups.push(init(container, ctx));
      } catch (err) {
        console.error(`fleetAnalyticsDashboard: ${name} failed to initialize`, err);
      }
    }
    mounted = true;
  }

  function unmount(): void {
    // One failing cleanup must not strand the others (leaked listeners/maps
    // accumulate across focus/blur cycles).
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('fleetAnalyticsDashboard: cleanup failed', err);
      }
    });
    cleanups = [];
    mounted = false;
  }

  return {
    initialize(api: GeotabApi, state: GeotabAddinState, callback: () => void): void {
      // MyGeotab's loading spinner clears only when callback() runs, so nothing
      // here may escape: a throwing component would hang the add-in entirely.
      // Log and degrade to a partial dashboard instead.
      initializeCalled = true;
      lastApi = api;
      lastState = state;
      try {
        unmount(); // re-initialize on top of a live instance must not double-wire
        mount(api, state);
      } catch (err) {
        console.error('fleetAnalyticsDashboard: initialize failed', err);
      } finally {
        callback();
      }
    },

    /**
     * MEMASANG ULANG, bukan no-op.
     *
     * blur() membongkar semuanya: view-host mengosongkan area view, side-menu
     * dan filter-bar melepas listener-nya. Tombol menunya tetap ada di DOM
     * beserta sorotan halaman terakhir — hanya saja sudah mati. Sebelumnya
     * focus() tidak membangun apa pun kembali, jadi setiap kali pengguna
     * berpindah ke halaman MyGeotab lain lalu kembali, add-in ini berubah jadi
     * cangkang: menu terlihat normal, area isi kosong, dan tidak ada satu pun
     * klik yang direspon. Itulah "terkadang add-in tidak merespon".
     *
     * mount() idempoten, jadi host yang memanggil focus() tanpa blur() di
     * antaranya tidak menghasilkan lapisan kedua.
     */
    focus(api: GeotabApi, state: GeotabAddinState): void {
      // Host tidak selalu mengisi argumen focus() selengkap initialize().
      const useApi = api ?? lastApi;
      const useState = state?.database ? state : lastState;
      if (!useApi || !useState) return;
      lastApi = useApi;
      lastState = useState;
      try {
        mount(useApi, useState);
      } catch (err) {
        console.error('fleetAnalyticsDashboard: focus failed to remount', err);
      }
    },

    blur(): void {
      unmount();
    },
  };
}

/**
 * The entry point MyGeotab invokes. It MUST accept no parameters: the SDK's own
 * example is `geotab.addin.x = function (api, state, callback)`, so the host may
 * call this with arguments — and any parameter declared here would be mistaken
 * for injected deps, throwing before a usable lifecycle object is returned.
 * Tests use createAddin(deps) instead.
 */
export function fleetAnalyticsDashboard() {
  return createAddin();
}

// MyGeotab derives the entry key from the add-in HTML's FILE NAME and calls
// geotab.addin.<filename-without-extension>. Verified against every official
// sample: startStop.html -> startStop, tripsTimeline.html -> tripsTimeline,
// ioxOutput.html -> ioxOutput, heatmap.html -> heatmap. So this key MUST stay
// equal to the entry filename in vite.config.ts (fleetAnalyticsDashboard.html)
// — a mismatch means initialize() is never called and the add-in renders blank.
//
// Create the namespace rather than only checking for it: the host does not
// always pre-create it, and a silent skip leaves MyGeotab loading forever.
const ADDIN_KEY = 'fleetAnalyticsDashboard';

if (typeof window !== 'undefined') {
  const w = window as any;
  w.geotab = w.geotab || {};
  w.geotab.addin = w.geotab.addin || {};
  w.geotab.addin[ADDIN_KEY] = fleetAnalyticsDashboard;

  // The official samples assign to a BARE `geotab`, not `window.geotab`. If the
  // host evaluates add-in scripts with its own `geotab` in scope, that object is
  // not necessarily window.geotab — register on it too so either model works.
  try {
    // eslint-disable-next-line no-eval
    const scoped = (0, eval)('typeof geotab !== "undefined" ? geotab : undefined');
    if (scoped && scoped !== w.geotab) {
      scoped.addin = scoped.addin || {};
      scoped.addin[ADDIN_KEY] = fleetAnalyticsDashboard;
    }
  } catch {
    /* bare `geotab` not in scope — window.geotab registration above is enough */
  }

  // If the host never calls initialize(), the page just sits on its placeholder
  // with no clue why. Replace it with the facts needed to diagnose that, since
  // this only ever runs inside MyGeotab where a console isn't always at hand.
  window.setTimeout(() => {
    if (initializeCalled) return;
    const el = document.getElementById('app');
    if (!el) return;
    const entry = window.location.pathname.split('/').pop() ?? '(unknown)';
    const keys = Object.keys(w.geotab?.addin ?? {});
    el.innerHTML = `
      <div style="font:13px/1.6 system-ui,sans-serif;color:#1f2937;padding:24px;max-width:760px">
        <h2 style="margin:0 0 4px;font-size:16px">Add-in loaded, but MyGeotab never called initialize()</h2>
        <p style="margin:0 0 16px;color:#6b7280">The script ran (you are reading output it produced).
        The host did not invoke the lifecycle, so no data was requested.</p>
        <table style="border-collapse:collapse;font-family:ui-monospace,monospace;font-size:12px">
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">page</td><td>${entry}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">expected key</td><td>${entry.replace(/\.html?$/i, '')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">registered key</td><td>${ADDIN_KEY}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">geotab.addin keys</td><td>${keys.join(', ') || '(none)'}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">in iframe</td><td>${String(window.top !== window.self)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">host geotab.api</td><td>${typeof w.geotab?.api}</td></tr>
        </table>
      </div>`;
  }, 6000);
}
