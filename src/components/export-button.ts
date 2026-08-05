// Tombol "Export CSV" yang sama di keenam halaman.
//
// Satu helper, bukan enam salinan: bentuk, teks dan posisinya harus identik,
// dan tanpa tempat bersama, halaman ketujuh nanti pasti berbeda sedikit.

import { esc } from '../utils/format';
import { toCsv, downloadCsv, csvFilename } from '../utils/csv';
import { getCurrentFilter } from './filter-bar';

/** Ikon unduh inline, sejalan dengan PIN_SVG dan FILM_SVG di security.ts:
 *  tanpa pustaka ikon, tanpa permintaan jaringan, ikut warna tombolnya. */
const DOWNLOAD_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/>' +
  '</svg>';

/** Markup tombol. Ditaruh di kepala tabelnya masing-masing. */
export function exportButtonHtml(key: string): string {
  return `<button type="button" class="fa-export-btn" data-export="${esc(key)}">
    ${DOWNLOAD_SVG}<span>Export CSV</span>
  </button>`;
}

export interface ExportTable {
  /** Dipakai sebagai awalan nama berkas. */
  filenameBase: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Memasang satu listener terdelegasi pada container.
 *
 * `build` dipanggil SAAT DITEKAN, bukan saat dipasang: isi tabel berubah tiap
 * filter, pencarian, dan pengurutan, dan menyiapkan berkasnya di muka berarti
 * mengekspor keadaan yang sudah basi.
 *
 * Terdelegasi karena view menulis ulang innerHTML-nya pada tiap render — tombol
 * per-render akan meninggalkan listener mati setiap kali.
 */
export function bindExport(
  container: HTMLElement,
  build: (key: string) => ExportTable | null
): () => void {
  function onClick(e: Event): void {
    const key = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-export]')?.dataset.export;
    if (!key) return;

    const table = build(key);
    if (!table) return;

    const filter = getCurrentFilter();
    downloadCsv(
      csvFilename(table.filenameBase, filter.dateFrom, filter.dateTo),
      toCsv(table.headers, table.rows)
    );
  }

  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}
