import { fleetAnalyticsDashboard } from '../src/addin';
import { createMockApi, mockState } from './mock-api';

// Host tiruan untuk gotoPage/hasAccessToPage. Nama halaman Video MyGeotab tidak
// ada di dokumentasi publik, jadi add-in menanyakannya ke host — dan di dev
// jawabannya bisa disetel lewat window.__FA_VIDEO_PAGE__ ('none' = tidak ada
// halaman Video sama sekali). Tanpa ini, cabang "tombol harus hilang" hanya
// bisa diyakini benar dari kode.
const wanted = (window as any).__FA_VIDEO_PAGE__ as string | undefined;
const state = {
  ...mockState,
  hasAccessToPage: (page: string) => wanted !== 'none' && page === (wanted ?? 'addin-geotabvideo-events'),
  gotoPage: (page: string, params?: object) => {
    (window as any).__FA_LAST_GOTO__ = { page, params };
    console.log('[dev] gotoPage', page, params);
  },
};

// Instance-nya diekspos supaya skrip uji bisa memanggil blur()/focus() persis
// seperti MyGeotab. Menguji lewat instance BARU tidak sah: dua instance akan
// berebut #app dan menghasilkan kegagalan yang tidak pernah terjadi di host.
const addin = fleetAnalyticsDashboard();
(window as any).__FA_ADDIN__ = addin;
(window as any).__FA_STATE__ = state;
(window as any).__FA_API__ = createMockApi();

addin.initialize((window as any).__FA_API__, state, () => {
  console.log('[dev] dashboard initialized with mock data');
});
