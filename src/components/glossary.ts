// Glosarium — permukaan DOM. Isinya ada di glossary-terms.ts.
//
// ponytail: <dialog> native. Focus trap, tutup dengan Esc, backdrop, dan
// pengembalian fokus ke tombol pemanggil sudah gratis dari browser — tidak ada
// dependency modal dan tidak ada manajemen fokus buatan sendiri yang perlu
// dites. Tidak ada kotak pencarian sampai daftarnya melewati satu layar.

import '../styles/glossary.css';
import { esc } from '../utils/format';
import { GLOSSARY, type Term } from './glossary-terms';

export { GLOSSARY, termIds, type Term, type TermGroup } from './glossary-terms';

let dialogEl: HTMLDialogElement | null = null;

/** Dipanggil dari mana pun — tombol `?` di header maupun deep-link dari kolom
 *  yang istilahnya membingungkan. */
export function openGlossary(termId?: string): void {
  if (!dialogEl) return;
  if (!dialogEl.open) dialogEl.showModal();
  dialogEl.querySelectorAll('.fa-term-hit').forEach((el) => el.classList.remove('fa-term-hit'));
  const target = termId ? dialogEl.querySelector<HTMLElement>(`#fa-term-${CSS.escape(termId)}`) : null;
  if (target) {
    target.classList.add('fa-term-hit');
    target.scrollIntoView({ block: 'center' });
  } else {
    dialogEl.querySelector('.fa-glossary-body')?.scrollTo({ top: 0 });
  }
}

function renderTerm(t: Term): string {
  return `
    <div class="fa-term" id="fa-term-${esc(t.id)}">
      <dt>${esc(t.term)}${t.aka ? ` <span class="fa-term-aka">${esc(t.aka)}</span>` : ''}</dt>
      <dd>
        ${esc(t.body)}
        ${t.where ? `<span class="fa-term-where">Muncul di: ${esc(t.where)}</span>` : ''}
      </dd>
    </div>`;
}

export function initGlossary(container: HTMLElement, _ctx: { database: string; rootEl: HTMLElement }): () => void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fa-glossary-btn';
  btn.textContent = '?';
  btn.setAttribute('aria-label', 'Buka glosarium istilah');
  btn.title = 'Glosarium istilah';

  const dialog = document.createElement('dialog');
  dialog.className = 'fa-glossary';
  dialog.innerHTML = `
    <form method="dialog" class="fa-glossary-head">
      <h2>Glosarium</h2>
      <button type="submit" class="fa-glossary-close" aria-label="Tutup glosarium">×</button>
    </form>
    <div class="fa-glossary-body">
      <p class="fa-note">Istilah yang muncul di dashboard ini, dijelaskan apa adanya — termasuk apa yang <em>tidak</em> bisa disimpulkan dari angkanya.</p>
      ${GLOSSARY.map(
        (g) => `
        <section>
          <h3>${esc(g.title)}</h3>
          <dl class="fa-glossary-list">${g.terms.map(renderTerm).join('')}</dl>
        </section>`
      ).join('')}
    </div>
  `;

  container.appendChild(btn);
  container.appendChild(dialog);
  dialogEl = dialog;

  const onBtn = () => openGlossary();
  // Klik di backdrop menutup. <dialog> mengirim klik dengan target dialog itu
  // sendiri saat backdrop-nya yang ditekan.
  const onDialogClick = (e: MouseEvent) => {
    if (e.target === dialog) dialog.close();
  };

  btn.addEventListener('click', onBtn);
  dialog.addEventListener('click', onDialogClick);

  return () => {
    btn.removeEventListener('click', onBtn);
    dialog.removeEventListener('click', onDialogClick);
    if (dialogEl === dialog) dialogEl = null;
    btn.remove();
    dialog.remove();
  };
}
