// Date range + group + zone filters. Emits `dashboard:filter-change` on
// ctx.rootEl for viz-agent components to consume (ui-agent CLAUDE.md contract).
// No data fetching beyond populating the group/zone selects (allowed: this is
// the filter's own options list, not chart data).

import { fetchGroups } from '../api/fetchers/group';
import { fetchZones } from '../api/fetchers/zone';

export function getDefaultFilters(): { dateFrom: string; dateTo: string; groupId?: string; zoneId?: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function initFilterBar(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const defaults = getDefaultFilters();
  container.innerHTML = `
    <label class="fa-field">From
      <input type="date" id="fa-date-from" value="${defaults.dateFrom}">
    </label>
    <label class="fa-field">To
      <input type="date" id="fa-date-to" value="${defaults.dateTo}">
    </label>
    <label class="fa-field">Group
      <select id="fa-group"><option value="">All groups</option></select>
    </label>
    <label class="fa-field">Zone
      <select id="fa-zone"><option value="">All zones</option></select>
    </label>
  `;

  const dateFromEl = container.querySelector<HTMLInputElement>('#fa-date-from')!;
  const dateToEl = container.querySelector<HTMLInputElement>('#fa-date-to')!;
  const groupEl = container.querySelector<HTMLSelectElement>('#fa-group')!;
  const zoneEl = container.querySelector<HTMLSelectElement>('#fa-zone')!;

  fetchGroups({ database: ctx.database })
    .then((groups) => appendOptions(groupEl, groups))
    .catch((err) => console.error('filter-bar: fetchGroups failed', err));

  fetchZones({ database: ctx.database })
    .then((zones) => appendOptions(zoneEl, zones))
    .catch((err) => console.error('filter-bar: fetchZones failed', err));

  function emitChange() {
    ctx.rootEl.dispatchEvent(
      new CustomEvent('dashboard:filter-change', {
        bubbles: true,
        detail: {
          dateFrom: dateFromEl.value,
          dateTo: dateToEl.value,
          groupId: groupEl.value || undefined,
          zoneId: zoneEl.value || undefined,
        },
      })
    );
  }

  const controls = [dateFromEl, dateToEl, groupEl, zoneEl];
  controls.forEach((el) => el.addEventListener('change', emitChange));

  return () => {
    controls.forEach((el) => el.removeEventListener('change', emitChange));
  };
}

function appendOptions(select: HTMLSelectElement, items: { id: string; name: string }[]): void {
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
}
