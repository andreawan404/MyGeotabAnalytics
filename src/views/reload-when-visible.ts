// Views stay mounted while hidden, so a naive `dashboard:filter-change` listener
// in every view means one date change fans out to 6 modules x ~4 queries at once
// — straight into MyGeotab's rate limit. Hidden views record the filter and
// refetch when they are shown again.

import type { FilterChangeDetail } from '../api/fetchers/types';

export function onFilterChangeVisible(
  rootEl: HTMLElement,
  el: HTMLElement,
  load: (filter: FilterChangeDetail) => void
): () => void {
  let stale: FilterChangeDetail | null = null;

  const onFilter = (e: Event) => {
    const filter = (e as CustomEvent<FilterChangeDetail>).detail;
    if (el.hidden) stale = filter;
    else load(filter);
  };

  // `el` is the view's own root, so !el.hidden == "this view is the one shown".
  const onShown = () => {
    if (el.hidden || !stale) return;
    const filter = stale;
    stale = null;
    load(filter);
  };

  rootEl.addEventListener('dashboard:filter-change', onFilter);
  rootEl.addEventListener('dashboard:view-shown', onShown);

  return () => {
    rootEl.removeEventListener('dashboard:filter-change', onFilter);
    rootEl.removeEventListener('dashboard:view-shown', onShown);
  };
}
