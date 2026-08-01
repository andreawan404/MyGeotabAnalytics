// Side navigation. Emits `dashboard:view-change`; view-host does the mounting —
// this component owns nothing but the active highlight.
//
// No router: the add-in runs in a MyGeotab iframe and the URL belongs to the
// host, so hash/History routing would fight it (root CLAUDE.md).

import { VIEWS } from '../views/registry';

export function initSideMenu(container: HTMLElement, ctx: { database: string; rootEl: HTMLElement }): () => void {
  // ponytail: the shell already hands us the <nav>, so fill it instead of
  // nesting a second <nav> inside it. Setting the class here keeps the
  // component self-sufficient if it is ever mounted into a plain <div>.
  container.classList.add('fa-sidemenu');
  container.innerHTML = '';

  for (const [i, view] of VIEWS.entries()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fa-nav-item';
    btn.dataset.viewId = view.id;
    btn.textContent = view.label;
    if (i === 0) btn.setAttribute('aria-current', 'page');
    container.appendChild(btn);
  }

  // One delegated listener instead of six — one thing to remove on cleanup.
  function onClick(e: Event) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.fa-nav-item');
    const viewId = btn?.dataset.viewId;
    if (!btn || !viewId || btn.getAttribute('aria-current') === 'page') return;

    for (const el of container.querySelectorAll('.fa-nav-item')) el.removeAttribute('aria-current');
    btn.setAttribute('aria-current', 'page');

    ctx.rootEl.dispatchEvent(new CustomEvent('dashboard:view-change', { bubbles: true, detail: { viewId } }));
  }

  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
  };
}
