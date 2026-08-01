// Layout shell: header + CSS grid (filter sidebar, KPI row, heat map, timeline).
// ui-agent scope only — no data fetching here (root CLAUDE.md).

import '../styles/dashboard.css';

export interface DashboardShell {
  rootEl: HTMLElement;
  filterBarContainer: HTMLElement;
  kpiContainer: HTMLElement;
  heatmapContainer: HTMLElement;
  timelineContainer: HTMLElement;
}

export function renderShell(root: HTMLElement, ctx: { database: string }): DashboardShell {
  root.classList.add('fa-dashboard');
  root.innerHTML = `
    <header class="fa-header">
      <h1>Fleet Analytics</h1>
      <span class="fa-database"></span>
    </header>
    <div class="fa-layout">
      <aside class="fa-filter" id="fa-filter"></aside>
      <main class="fa-main">
        <section class="fa-kpi-row" id="fa-kpi"></section>
        <section class="fa-heatmap" id="fa-heatmap"></section>
        <section class="fa-timeline" id="fa-timeline"></section>
      </main>
    </div>
  `;

  // textContent, not template interpolation, since ctx.database is host-provided data.
  root.querySelector('.fa-database')!.textContent = ctx.database;

  return {
    rootEl: root,
    filterBarContainer: root.querySelector('#fa-filter')!,
    kpiContainer: root.querySelector('#fa-kpi')!,
    heatmapContainer: root.querySelector('#fa-heatmap')!,
    timelineContainer: root.querySelector('#fa-timeline')!,
  };
}
