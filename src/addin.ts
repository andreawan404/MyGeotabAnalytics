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

export function fleetAnalyticsDashboard(deps: AddinDeps = defaultDeps) {
  let cleanups: Cleanup[] = [];

  return {
    initialize(api: GeotabApi, state: GeotabAddinState, callback: () => void): void {
      // MyGeotab's loading spinner clears only when callback() runs, so nothing
      // here may escape: a throwing component would hang the add-in entirely.
      // Log and degrade to a partial dashboard instead.
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

// Per the SDK: "Each of the Add-Ins will need to define its own unique namespace
// with the prefix geotab.addin" — the HOST DOES NOT PRE-CREATE IT. Create the
// namespace (without clobbering an existing one); never merely check for it, or
// registration silently no-ops and MyGeotab spins forever waiting for an add-in
// that never registered. Only the `typeof window` check is a real guard, for
// Node (addin.check.ts).
if (typeof window !== 'undefined') {
  const w = window as any;
  w.geotab = w.geotab || {};
  w.geotab.addin = w.geotab.addin || {};
  w.geotab.addin.fleetAnalyticsDashboard = fleetAnalyticsDashboard;
}
