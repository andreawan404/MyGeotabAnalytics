// The single list of dashboard views. side-menu renders it, view-host mounts
// from it — adding a view means adding one row here and one module.
//
// `load()` is async so a view's module (and its Chart.js/Leaflet work) is only
// evaluated when the user first opens it. vite.config.ts uses
// format:'iife' + inlineDynamicImports, so this does NOT code-split — the
// bundle stays single-file. The win is deferred EXECUTION (no API calls for
// views nobody opened), not download size.

export interface ViewCtx {
  database: string;
  rootEl: HTMLElement;
}

/** Same contract every component in this add-in follows: mount, return cleanup. */
export type ViewInit = (container: HTMLElement, ctx: ViewCtx) => () => void;

export interface ViewDef {
  id: string;
  label: string;
  load: () => Promise<ViewInit>;
}

export const VIEWS: ViewDef[] = [
  { id: 'overview', label: 'Ringkasan', load: () => import('./overview').then((m) => m.initOverviewView) },
  { id: 'trip-report', label: 'Trip Report', load: () => import('./trip-report').then((m) => m.initTripReportView) },
  { id: 'health', label: 'Kesehatan Armada', load: () => import('./fleet-health').then((m) => m.initFleetHealthView) },
  {
    id: 'maintenance',
    label: 'Predictive Maintenance',
    load: () => import('./predictive-maintenance').then((m) => m.initPredictiveView),
  },
  { id: 'security', label: 'Security & Emergency', load: () => import('./security').then((m) => m.initSecurityView) },
  { id: 'safety', label: 'Safety Behaviour', load: () => import('./safety').then((m) => m.initSafetyView) },
  { id: 'fuel', label: 'Konsumsi BBM', load: () => import('./fuel').then((m) => m.initFuelView) },
];
