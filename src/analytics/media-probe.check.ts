import assert from 'node:assert';
import { summarizeMediaProbe, mediaCoversMoment, MATCH_WINDOW_SEC } from './media-probe';
import type { MediaFileDTO } from '../api/fetchers/media-file';

const m = (o: Partial<MediaFileDTO>): MediaFileDTO => ({
  id: 'm1',
  deviceId: 'd1',
  fromDate: '2026-08-01T10:00:00.000Z',
  toDate: '2026-08-01T10:00:20.000Z',
  mediaType: 'Video',
  status: 'Ok',
  solutionId: 'go-focus',
  thumbnailCount: 1,
  ...o,
});

const at = (iso: string) => Date.parse(iso);

// --- mediaCoversMoment ------------------------------------------------------
//
// Klip punya DURASI, jadi ini uji tumpang tindih rentang. Memperlakukannya
// sebagai satu titik akan meleset untuk insiden yang jatuh di tengah klip.
{
  const clip = m({});
  assert.ok(mediaCoversMoment(clip, at('2026-08-01T10:00:10.000Z'), 0), 'di tengah klip harus cocok');
  assert.ok(mediaCoversMoment(clip, at('2026-08-01T10:00:00.000Z'), 0), 'tepat di awal');
  assert.ok(mediaCoversMoment(clip, at('2026-08-01T10:00:20.000Z'), 0), 'tepat di akhir');
  assert.ok(!mediaCoversMoment(clip, at('2026-08-01T10:00:25.000Z'), 0), 'di luar, tanpa toleransi');
  assert.ok(mediaCoversMoment(clip, at('2026-08-01T10:00:25.000Z'), 30), 'di luar, tapi masuk toleransi');
  assert.ok(mediaCoversMoment(clip, at('2026-08-01T09:59:40.000Z'), 30), 'toleransi berlaku dua arah');
  assert.ok(!mediaCoversMoment(clip, at('2026-08-01T10:01:30.000Z'), 30), 'jauh di luar toleransi');

  // toDate rusak: jangan jatuhkan barisnya, perlakukan sebagai satu titik.
  const noEnd = m({ toDate: '' });
  assert.ok(mediaCoversMoment(noEnd, at('2026-08-01T10:00:05.000Z'), 30));
  assert.ok(!mediaCoversMoment(noEnd, at('2026-08-01T10:05:00.000Z'), 30));

  // fromDate rusak: tidak ada yang bisa diklaim.
  assert.ok(!mediaCoversMoment(m({ fromDate: 'bukan-tanggal' }), at('2026-08-01T10:00:05.000Z'), 30));
}

// --- summarizeMediaProbe ----------------------------------------------------
{
  const media = [
    m({ id: 'a', deviceId: 'd1', mediaType: 'Video', status: 'Ok', solutionId: 'go-focus' }),
    m({ id: 'b', deviceId: 'd1', mediaType: 'Image', status: 'Ok', solutionId: 'go-focus', thumbnailCount: 0 }),
    m({
      id: 'c',
      deviceId: 'd2',
      mediaType: 'Video',
      status: 'Pending',
      solutionId: null,
      fromDate: '2026-08-01T12:00:00.000Z',
      toDate: '2026-08-01T12:00:15.000Z',
    }),
  ];
  const incidents = [
    { deviceId: 'd1', at: '2026-08-01T10:00:10.000Z' }, // di dalam klip a & b
    { deviceId: 'd2', at: '2026-08-01T12:00:05.000Z' }, // di dalam klip c
    { deviceId: 'd3', at: '2026-08-01T10:00:10.000Z' }, // unit tanpa media sama sekali
    { deviceId: 'd1', at: '2026-08-01T18:00:00.000Z' }, // unit punya media, tapi jam lain
  ];

  const r = summarizeMediaProbe(media, incidents);
  assert.equal(r.total, 3);
  assert.deepStrictEqual(r.byMediaType, { Video: 2, Image: 1 });
  assert.deepStrictEqual(r.byStatus, { Ok: 2, Pending: 1 });
  // Tanpa solutionId dilaporkan, bukan dibuang — justru itu temuannya.
  assert.deepStrictEqual(r.bySolutionId, { 'go-focus': 2, '(tanpa solutionId)': 1 });
  assert.equal(r.withThumbnail, 2);
  assert.equal(r.deviceCount, 2);
  assert.equal(r.earliest, '2026-08-01T10:00:00.000Z');
  assert.equal(r.latest, '2026-08-01T12:00:15.000Z');
  assert.equal(r.incidentsTotal, 4);
  assert.equal(r.incidentsWithMedia, 2, 'hanya insiden yang unit DAN waktunya cocok');

  // Nilai enum kosong harus terlihat sebagai kosong, bukan menghilang dari
  // laporan — kalau API mengembalikan bentuk tak terduga, itu yang mau kita tahu.
  const blank = summarizeMediaProbe([m({ mediaType: '', status: '', solutionId: null })], []);
  assert.deepStrictEqual(blank.byMediaType, { '(kosong)': 1 });
  assert.deepStrictEqual(blank.byStatus, { '(kosong)': 1 });
}

// --- keadaan kosong ---------------------------------------------------------
//
// Ini jalur yang PALING mungkin terjadi di database sungguhan, jadi ia tidak
// boleh melempar maupun mencetak NaN/null yang bocor ke layar.
{
  const empty = summarizeMediaProbe([], []);
  assert.equal(empty.total, 0);
  assert.equal(empty.deviceCount, 0);
  assert.equal(empty.earliest, null);
  assert.equal(empty.latest, null);
  assert.equal(empty.incidentsWithMedia, 0);
  assert.deepStrictEqual(empty.byMediaType, {});

  // Ada insiden, nol media: tetap harus melaporkan jumlah insidennya, karena
  // "0 dari 47" dan "0 dari 0" adalah dua temuan yang sangat berbeda.
  const noMedia = summarizeMediaProbe([], [{ deviceId: 'd1', at: '2026-08-01T10:00:00.000Z' }]);
  assert.equal(noMedia.incidentsTotal, 1);
  assert.equal(noMedia.incidentsWithMedia, 0);

  // Stempel waktu insiden rusak tidak boleh dihitung sebagai cocok.
  const badAt = summarizeMediaProbe([m({})], [{ deviceId: 'd1', at: 'entah' }]);
  assert.equal(badAt.incidentsWithMedia, 0);
}

assert.equal(MATCH_WINDOW_SEC, 30);

console.log('media-probe.check.ts: PASS');
