// Mounts the view selected by side-menu. The only stateful component in the
// add-in.
//
// Once mounted a view is never unmounted, only hidden. Re-showing it therefore
// costs zero API calls and keeps its Leaflet map / Chart.js instances alive —
// which is also why hidden views must use views/reload-when-visible.ts instead
// of listening to `dashboard:filter-change` directly.

import { VIEWS } from '../views/registry';

interface MountedView {
  el: HTMLElement;
  cleanup: () => void;
  /** Set by our cleanup so a load() still in flight knows not to attach. */
  disposed: boolean;
}

export function initViewHost(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  const mounted = new Map<string, MountedView>();
  let currentId: string | null = null;

  // Charts sized while hidden render wrong (Leaflet shows grey tiles), so tell
  // the view it is visible now — see the listener in charts/heatmap.ts.
  function announceShown(viewId: string) {
    ctx.rootEl.dispatchEvent(new CustomEvent('dashboard:view-shown', { bubbles: true, detail: { viewId } }));
  }

  function show(viewId: string) {
    const def = VIEWS.find((v) => v.id === viewId);
    if (!def || viewId === currentId) return;

    const previous = currentId ? mounted.get(currentId) : undefined;
    if (previous) previous.el.hidden = true;
    currentId = viewId;

    const existing = mounted.get(viewId);
    if (existing) {
      existing.el.hidden = false;
      announceShown(viewId);
      return;
    }

    const el = document.createElement('div');
    el.className = 'fa-view';
    container.appendChild(el);
    const entry: MountedView = { el, cleanup: () => {}, disposed: false };
    mounted.set(viewId, entry);

    def
      .load()
      .then((init) => {
        // ponytail: blur() landed while the module was loading. Skipping init()
        // entirely is stronger than init-then-cleanup — nothing to leak if it
        // was never created, and no wasted API calls on the way out.
        if (entry.disposed) return;
        try {
          entry.cleanup = init(el, ctx);
        } catch (err) {
          console.error(`view-host: ${viewId} failed to initialize`, err);
          el.innerHTML = '<p class="fa-error">Modul gagal dimuat.</p>';
        }
        if (!el.hidden) announceShown(viewId);
      })
      .catch((err) => {
        console.error(`view-host: ${viewId} failed to load`, err);
        el.innerHTML = '<p class="fa-error">Modul gagal dimuat.</p>';
      });
  }

  function onViewChange(e: Event) {
    show((e as CustomEvent<{ viewId: string }>).detail.viewId);
  }

  ctx.rootEl.addEventListener('dashboard:view-change', onViewChange);
  show(VIEWS[0].id);

  return () => {
    ctx.rootEl.removeEventListener('dashboard:view-change', onViewChange);
    for (const entry of mounted.values()) {
      entry.disposed = true;
      try {
        entry.cleanup();
      } catch (err) {
        console.error('view-host: cleanup failed', err);
      }
    }
    mounted.clear();
    currentId = null;
    container.innerHTML = '';
  };
}
