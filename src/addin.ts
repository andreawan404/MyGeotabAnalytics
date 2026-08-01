// MyGeotab Add-In entrypoint. Thin composition only — wires the host
// lifecycle (initialize/focus/blur) to the shell + the 5 init* components.
// No business logic here (root CLAUDE.md).

import { initGeotabClient, type GeotabApi } from './api/geotabClient';
import { renderShell } from './components/shell';
import { initFilterBar } from './components/filter-bar';
import { initKpiCards } from './components/kpi-card';
import { initHeatmap } from './charts/heatmap';
import { initTripTimeline } from './charts/trip-timeline';

export interface GeotabAddinState {
  database: string;
}

type Cleanup = () => void;

// ponytail: DI seam exists only so addin.check.ts can swap in fake init*
// functions and skip real DOM/Leaflet — the host always uses defaultDeps.
export interface AddinDeps {
  initGeotabClient: typeof initGeotabClient;
  getAppElement: () => HTMLElement | null;
  renderShell: typeof renderShell;
  initFilterBar: typeof initFilterBar;
  initKpiCards: typeof initKpiCards;
  initHeatmap: typeof initHeatmap;
  initTripTimeline: typeof initTripTimeline;
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
  initKpiCards,
  initHeatmap,
  initTripTimeline,
};

/** Set by initialize(); read by the diagnostic timer at the bottom of this file. */
let initializeCalled = false;

/** Internal factory — the `deps` seam exists only for addin.check.ts. */
export function createAddin(deps: AddinDeps = defaultDeps) {
  let cleanups: Cleanup[] = [];

  return {
    initialize(api: GeotabApi, state: GeotabAddinState, callback: () => void): void {
      // MyGeotab's loading spinner clears only when callback() runs, so nothing
      // here may escape: a throwing component would hang the add-in entirely.
      // Log and degrade to a partial dashboard instead.
      initializeCalled = true;
      cleanups = [];
      try {
        deps.initGeotabClient(api);

        const appEl = deps.getAppElement();
        if (!appEl) throw new Error('fleetAnalyticsDashboard: #app element not found');

        const shell = deps.renderShell(appEl, { database: state.database });
        const ctx = { database: state.database, rootEl: shell.rootEl };

        // Wire each component independently so one failure doesn't take the rest down.
        for (const [name, init, container] of [
          ['filter-bar', deps.initFilterBar, shell.filterBarContainer],
          ['kpi-cards', deps.initKpiCards, shell.kpiContainer],
          ['heatmap', deps.initHeatmap, shell.heatmapContainer],
          ['trip-timeline', deps.initTripTimeline, shell.timelineContainer],
        ] as [string, (c: HTMLElement, x: typeof ctx) => Cleanup, HTMLElement][]) {
          try {
            cleanups.push(init(container, ctx));
          } catch (err) {
            console.error(`fleetAnalyticsDashboard: ${name} failed to initialize`, err);
          }
        }
      } catch (err) {
        console.error('fleetAnalyticsDashboard: initialize failed', err);
      } finally {
        callback();
      }
    },

    focus(_api: GeotabApi, _state: GeotabAddinState): void {
      // ponytail: no stored "last filter" to re-dispatch — each init* already
      // fetched a default range in initialize(). Add a stored-filter
      // re-dispatch here if reopening the menu ever needs to force a refresh.
    },

    blur(): void {
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
