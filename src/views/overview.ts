// "Ringkasan" — the dashboard as it was before the side menu existed: KPI row,
// heat map, trip timeline. This is exactly the mount loop addin.ts used to run,
// moved down one level so the three components are now lazy like every other
// view. The components themselves are untouched.

import { initKpiCards } from '../components/kpi-card';
import { initHeatmap } from '../charts/heatmap';
import { initTripTimeline } from '../charts/trip-timeline';
import type { ViewCtx, ViewInit } from './registry';

export function initOverviewView(container: HTMLElement, ctx: ViewCtx): () => void {
  const cleanups: (() => void)[] = [];

  // Same class names the shell used to hard-code, so the CSS applies unchanged.
  for (const [name, init, className] of [
    ['kpi-cards', initKpiCards, 'fa-kpi-row'],
    ['heatmap', initHeatmap, 'fa-heatmap'],
    ['trip-timeline', initTripTimeline, 'fa-timeline'],
  ] as [string, ViewInit, string][]) {
    const el = document.createElement('div');
    el.className = className;
    container.appendChild(el);
    // One failing component must not take the other two down (addin.ts rule).
    try {
      cleanups.push(init(el, ctx));
    } catch (err) {
      console.error(`overview: ${name} failed to initialize`, err);
    }
  }

  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch (err) {
        console.error('overview: cleanup failed', err);
      }
    }
  };
}
