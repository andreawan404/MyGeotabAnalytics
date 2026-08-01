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
  getAppElement: () => document.getElementById('app'),
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
      deps.initGeotabClient(api);

      const appEl = deps.getAppElement();
      if (!appEl) throw new Error('fleetAnalyticsDashboard: #app element not found');

      const shell = deps.renderShell(appEl, { database: state.database });
      const ctx = { database: state.database, rootEl: shell.rootEl };

      cleanups = [
        deps.initFilterBar(shell.filterBarContainer, ctx),
        deps.initKpiCards(shell.kpiContainer, ctx),
        deps.initHeatmap(shell.heatmapContainer, ctx),
        deps.initTripTimeline(shell.timelineContainer, ctx),
      ];

      callback();
    },

    focus(_api: GeotabApi, _state: GeotabAddinState): void {
      // ponytail: no stored "last filter" to re-dispatch — each init* already
      // fetched a default range in initialize(). Add a stored-filter
      // re-dispatch here if reopening the menu ever needs to force a refresh.
    },

    blur(): void {
      cleanups.forEach((fn) => fn());
      cleanups = [];
    },
  };
}

// Host looks up geotab.addin.<name> per config.json's add-in name (see the
// scaffold this replaces). `window.geotab.addin` only exists inside the real
// MyGeotab host — guarded so this doesn't throw under Node (addin.check.ts)
// or in the dev-mock harness (dev/main.ts calls fleetAnalyticsDashboard()
// directly instead of going through window.geotab.addin).
if (typeof window !== 'undefined' && (window as any).geotab?.addin) {
  (window as any).geotab.addin.fleetAnalyticsDashboard = fleetAnalyticsDashboard;
}
