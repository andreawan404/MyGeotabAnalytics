// Kartu KPI yang bisa menjelaskan dirinya sendiri.
//
// Pola ini lahir di kartu Ringkasan dan selama ini hanya hidup di sana: empat
// kartu dari total belasan di seluruh dashboard. Enam view lain menampilkan
// angka tanpa satu pun cara mengetahui dari mana asalnya — padahal justru di
// situlah asumsi paling berat bersembunyi (fault kronis pakai hari UTC, MIL
// sengaja tidak menghitung lampu kuning, km/L dijumlah dulu baru dibagi).
//
// Empat baris penjelasannya tetap: Rumus / Angka yang dipakai / Sumber data /
// Tingkat keyakinan. "Angka yang dipakai" yang membedakannya dari sekadar
// tooltip — ia menunjukkan bilangan asli yang masuk ke rumus, jadi user bisa
// menghitung ulang sendiri kalau tidak percaya.
//
// Tidak pernah hover-only: caption selalu terlihat dan panelnya dibuka <button>
// sungguhan, jadi layar sentuh dan pembaca layar dapat informasi yang sama.

import { esc } from '../utils/format';

export type KpiKind = 'terukur' | 'heuristik' | 'estimasi';

export interface KpiExplanation {
  formula: string;
  substituted: string;
  source: string;
  kind: KpiKind;
}

export const KIND_LABEL: Record<KpiKind, string> = {
  terukur: 'TERUKUR',
  heuristik: 'HEURISTIK',
  estimasi: 'ESTIMASI',
};

// Pembedaan terukur/heuristik/estimasi harus bertahan tanpa warna.
export const KIND_NOTE: Record<KpiKind, string> = {
  terukur: 'Terukur — dijumlahkan langsung dari data MyGeotab, tanpa asumsi.',
  heuristik: 'Heuristik — sebagian angka berasal dari asumsi yang Anda isi sendiri, bukan dari MyGeotab.',
  estimasi: 'Estimasi — dihitung tidak langsung dari data lain, jadi bukan angka resmi.',
};

export interface ExplainCardInput {
  /** Unik dalam satu container — dipakai sebagai id elemen dan kunci buka/tutup. */
  key: string;
  label: string;
  /** HTML, bukan teks: sebagian kartu menaruh badge di dalam nilainya. Pemanggil
   *  yang bertanggung jawab meng-escape apa pun yang berasal dari database. */
  valueHtml: string;
  caption: string;
  explain: KpiExplanation;
  open?: boolean;
  /** Markup tambahan di dalam kartu, mis. input asumsi milik kartu itu. */
  extra?: string;
}

export function renderExplainCard(input: ExplainCardInput): string {
  const { key, label, valueHtml, caption, explain, open = false, extra = '' } = input;
  const btnId = `fa-kpi-why-btn-${key}`;
  const panelId = `fa-kpi-why-panel-${key}`;
  return `
    <div class="fa-kpi-card">
      <div class="fa-kpi-label">${esc(label)}</div>
      <div class="fa-kpi-value">${valueHtml}</div>
      <p class="fa-kpi-source">
        <span class="fa-kpi-kind fa-kpi-kind-${explain.kind}">${KIND_LABEL[explain.kind]}</span>
        ${esc(caption)}
      </p>
      ${extra}
      <button type="button" class="fa-kpi-why" id="${btnId}" data-why="${esc(key)}"
              aria-expanded="${open}" aria-controls="${panelId}">Bagaimana ini dihitung?</button>
      <div class="fa-kpi-detail" id="${panelId}" role="region" aria-labelledby="${btnId}"${open ? '' : ' hidden'}>
        <dl class="fa-kpi-detail-list">
          <dt>Rumus</dt><dd>${esc(explain.formula)}</dd>
          <dt>Angka yang dipakai</dt><dd>${esc(explain.substituted)}</dd>
          <dt>Sumber data</dt><dd>${esc(explain.source)}</dd>
          <dt>Tingkat keyakinan</dt><dd>${esc(KIND_NOTE[explain.kind])}</dd>
        </dl>
      </div>
    </div>`;
}

/**
 * Satu listener terdelegasi untuk semua tombol "Bagaimana ini dihitung?" di
 * dalam `container`, plus set panel yang terbuka.
 *
 * Set-nya dikembalikan, bukan disimpan sendiri, karena view memakainya saat
 * render ulang: mengubah asumsi di sebuah kartu tidak boleh membanting tutup
 * panel yang sedang menjelaskan asumsi itu.
 */
export function bindExplainToggles(container: HTMLElement): { open: Set<string>; stop: () => void } {
  const open = new Set<string>();

  function onClick(e: Event): void {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('.fa-kpi-why');
    if (!btn || !container.contains(btn)) return;
    const key = btn.dataset.why;
    if (!key) return;
    const nowOpen = !open.has(key);
    if (nowOpen) open.add(key);
    else open.delete(key);
    btn.setAttribute('aria-expanded', String(nowOpen));
    const panel = btn.nextElementSibling as HTMLElement | null;
    if (panel) panel.hidden = !nowOpen;
  }

  container.addEventListener('click', onClick);
  return { open, stop: () => container.removeEventListener('click', onClick) };
}
