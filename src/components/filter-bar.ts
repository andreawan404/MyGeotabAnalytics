// Date-time range + group + zone filters. Emits `dashboard:filter-change` on
// ctx.rootEl for viz-agent components to consume (ui-agent CLAUDE.md contract).
// No data fetching beyond populating the group/zone selects (allowed: this is
// the filter's own options list, not chart data).
//
// The inputs are `datetime-local`, so dateFrom/dateTo are "YYYY-MM-DDTHH:mm".
// FilterChangeDetail is unchanged (both still strings) and toUtcRange accepts
// that shape as exact local instants — see utils/date-range.ts.

import { fetchGroups } from '../api/fetchers/group';
import { fetchZones } from '../api/fetchers/zone';
import type { FilterChangeDetail } from '../api/fetchers/types';
import { defaultDateRange, presetRange, type PresetId } from '../utils/date-range';

/** Bursts of `change` events (datetime spinners, a fast group+zone edit) would
 *  each fan out to every mounted view. One emit per settled edit is enough. */
const DEBOUNCE_MS = 300;
const HINT_MS = 3000;

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Hari ini' },
  { id: 'last24h', label: '24 jam' },
  { id: 'last7d', label: '7 hari' },
  { id: 'last30d', label: '30 hari' },
  { id: 'thisMonth', label: 'Bulan ini' },
];

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
    <div class="fa-presets" role="group" aria-label="Rentang cepat">
      ${PRESETS.map(
        (p) => `<button type="button" class="fa-preset-btn" data-preset="${p.id}" aria-pressed="false">${p.label}</button>`
      ).join('')}
    </div>
    <label class="fa-field">Dari
      <input type="datetime-local" id="fa-date-from" value="${defaults.dateFrom}">
    </label>
    <label class="fa-field">Sampai
      <input type="datetime-local" id="fa-date-to" value="${defaults.dateTo}">
    </label>
    <label class="fa-field">Grup
      <select id="fa-group"><option value="">Semua grup</option></select>
    </label>
    <label class="fa-field">Zona
      <select id="fa-zone"><option value="">Semua zona</option></select>
    </label>
    <p class="fa-filter-hint" role="status" hidden></p>
  `;

  const presetsEl = container.querySelector<HTMLElement>('.fa-presets')!;
  const hintEl = container.querySelector<HTMLElement>('.fa-filter-hint')!;
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
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function showHint(msg: string) {
    hintEl.textContent = msg;
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintEl.hidden = true;
    }, HINT_MS);
  }

  function setActivePreset(id: PresetId | null) {
    for (const btn of presetsEl.querySelectorAll<HTMLButtonElement>('.fa-preset-btn')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === id));
    }
  }

  /** A negative window silently reads as 0% utilization downstream — this project
   *  already shipped that bug once. Clamp instead of emitting it. Lexical compare
   *  is safe: "YYYY-MM-DDTHH:mm" sorts chronologically. */
  function validRange(): boolean {
    if (!dateFromEl.value || !dateToEl.value) {
      showHint('Isi tanggal & jam awal dan akhir.');
      return false;
    }
    if (dateFromEl.value > dateToEl.value) {
      const from = dateFromEl.value;
      dateFromEl.value = dateToEl.value;
      dateToEl.value = from;
      showHint('Rentang terbalik — tanggal ditukar otomatis.');
    }
    return true;
  }

  function emitNow() {
    if (!validRange()) return;
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

  // Editing a date by hand means the range is no longer whatever preset was
  // pressed. Group/zone edits leave the preset alone — the range is still its range.
  function onManualChange(ev: Event) {
    if (ev.currentTarget === dateFromEl || ev.currentTarget === dateToEl) setActivePreset(null);
    emitChange();
  }

  // One delegated listener for all five buttons.
  function onPresetClick(ev: Event) {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.fa-preset-btn');
    if (!btn) return;
    const id = btn.dataset.preset as PresetId;
    const range = presetRange(id);
    dateFromEl.value = range.dateFrom;
    dateToEl.value = range.dateTo;
    setActivePreset(id);
    // A deliberate single action: emit now, and drop any half-typed manual edit
    // still sitting in the debounce so it can't fire afterwards with stale values.
    clearTimeout(debounceTimer);
    emitNow();
  }

  const controls = [dateFromEl, dateToEl, groupEl, zoneEl];
  controls.forEach((el) => el.addEventListener('change', onManualChange));
  presetsEl.addEventListener('click', onPresetClick);

  // Populate lastFilter immediately (undebounced) so a view mounting in this
  // same tick already sees the real filter rather than falling back to defaults.
  emitNow();

  return () => {
    clearTimeout(debounceTimer);
    clearTimeout(hintTimer);
    controls.forEach((el) => el.removeEventListener('change', onManualChange));
    presetsEl.removeEventListener('click', onPresetClick);
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
