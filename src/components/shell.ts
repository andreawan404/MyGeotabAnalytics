// Layout shell: header + CSS grid (side menu | filter bar over the view host).
// ui-agent scope only — no data fetching here (root CLAUDE.md).
//
// The shell no longer knows about KPIs/heat map/timeline: those are the
// overview view's own children now (src/views/overview.ts).

import '../styles/dashboard.css';

export interface DashboardShell {
  rootEl: HTMLElement;
  filterBarContainer: HTMLElement;
  sideMenuContainer: HTMLElement;
  viewContainer: HTMLElement;
}

export function renderShell(root: HTMLElement, ctx: { database: string }): DashboardShell {
  root.classList.add('fa-dashboard');
  root.innerHTML = `
    <header class="fa-header">
      <h1>Fleet Analytics</h1>
      <span class="fa-database"></span>
    </header>
    <div class="fa-layout">
      <nav class="fa-sidemenu" id="fa-menu"></nav>
      <div class="fa-body">
        <section class="fa-filter" id="fa-filter"></section>
        <main class="fa-views" id="fa-views"></main>
      </div>
    </div>
  `;

  // textContent, not template interpolation, since ctx.database is host-provided data.
  root.querySelector('.fa-database')!.textContent = ctx.database;

  return {
    rootEl: root,
    filterBarContainer: root.querySelector('#fa-filter')!,
    sideMenuContainer: root.querySelector('#fa-menu')!,
    viewContainer: root.querySelector('#fa-views')!,
  };
}
