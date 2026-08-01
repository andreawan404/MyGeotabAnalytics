// Date range + group + zone filters. Emits `dashboard:filter-change` on
// ctx.rootEl for viz-agent components to consume (ui-agent CLAUDE.md contract).
// No data fetching beyond populating the group/zone selects (allowed: this is
// the filter's own options list, not chart data).

import { fetchGroups } from '../api/fetchers/group';
import { fetchZones } from '../api/fetchers/zone';
import type { FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange } from '../utils/date-range';

/** Bursts of `change` events (date spinners, a fast group+zone edit) would each
 *  fan out to every mounted view. One emit per settled edit is enough. */
const DEBOUNCE_MS = 300;

// ponytail: module-level singleton, not per-instance state. MyGeotab loads
// exactly ONE add-in instance per iframe, so there is never a second filter bar
// to get confused about. This is how a view mounted later learns the current
// filter (views/*.ts call getCurrentFilter() at init) — no event replay.
let lastFilter: FilterChangeDetail | null = null;

export function getDefaultFilters(): FilterChangeDetail {
  return defaultDateRange();
}

/** The filter as it stands right now — for views that mount after the last emit. */
export function getCurrentFilter(): FilterChangeDetail {
  return lastFilter ?? getDefaultFilters();
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

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function emitNow() {
    // Record BEFORE dispatching: a listener may call getCurrentFilter().
    lastFilter = {
      dateFrom: dateFromEl.value,
      dateTo: dateToEl.value,
      groupId: groupEl.value || undefined,
      zoneId: zoneEl.value || undefined,
    };
    ctx.rootEl.dispatchEvent(new CustomEvent('dashboard:filter-change', { bubbles: true, detail: lastFilter }));
  }

  function emitChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(emitNow, DEBOUNCE_MS);
  }

  const controls = [dateFromEl, dateToEl, groupEl, zoneEl];
  controls.forEach((el) => el.addEventListener('change', emitChange));

  // Populate lastFilter immediately (undebounced) so a view mounting in this
  // same tick already sees the real filter rather than falling back to defaults.
  emitNow();

  return () => {
    clearTimeout(debounceTimer);
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
