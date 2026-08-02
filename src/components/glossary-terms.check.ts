import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY, ALL_TERMS, termIds } from './glossary-terms';

// --- id unik -----------------------------------------------------------------
// id dipakai sebagai id elemen DOM (`fa-term-<id>`) dan sebagai target deep-link.
// Duplikat berarti deep-link mendarat di istilah yang salah.
const ids = termIds();
assert.equal(new Set(ids).size, ids.length, 'id istilah harus unik');
for (const id of ids) {
  assert.match(id, /^[a-z0-9-]+$/, `id "${id}" harus kebab-case ASCII (dipakai sebagai id elemen)`);
}

// --- isi tiap istilah --------------------------------------------------------
for (const t of ALL_TERMS) {
  assert.ok(t.term.trim(), `${t.id}: term kosong`);
  // Satu kalimat pendek biasanya berarti definisi melingkar ("MIL adalah lampu
  // MIL"). Glosarium ini ada justru untuk pembaca yang belum tahu istilahnya.
  assert.ok(t.body.length >= 60, `${t.id}: penjelasan terlalu pendek (${t.body.length} karakter)`);
}
assert.ok(GLOSSARY.every((g) => g.title.trim() && g.terms.length > 0));

// --- deep-link dari view harus menunjuk istilah yang ada ----------------------
//
// openGlossary('risk-of-breakdown') yang salah ketik membuka dialog di posisi
// teratas tanpa error apa pun — user mengira istilahnya memang tidak ada.
// Check ini memindai seluruh src/ dan mencocokkan tiap argumen literal.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') && !full.endsWith('.check.ts') ? [full] : [];
  });
}

const known = new Set(ids);
let linkCount = 0;
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/openGlossary\(\s*'([^']+)'\s*\)/g)) {
    linkCount++;
    assert.ok(known.has(m[1]), `${file}: openGlossary('${m[1]}') menunjuk istilah yang tidak ada`);
  }
  // Bentuk data-attribute yang dipakai listener terdelegasi di dalam view.
  for (const m of src.matchAll(/data-term="([^"]+)"/g)) {
    linkCount++;
    assert.ok(known.has(m[1]), `${file}: data-term="${m[1]}" menunjuk istilah yang tidak ada`);
  }
}

// --- istilah yang WAJIB ada --------------------------------------------------
// Semuanya tampil mentah ke user tanpa definisi sebelum glosarium ini ada.
for (const id of [
  'risk-of-breakdown',
  'mil',
  'dvir',
  'terukur',
  'heuristik',
  'estimasi',
  'idle',
  'tren-baru',
  'severity',
  'unknown-driver',
]) {
  assert.ok(known.has(id), `istilah wajib "${id}" hilang dari glosarium`);
}

console.log(`glossary-terms.check.ts OK (${ids.length} istilah, ${linkCount} deep-link diverifikasi)`);
