// "Security & Emergency" — panic/SOS, accident, unauthorized movement and
// geofence breaches in one feed, plus the emergency contact per vehicle.
//
// Every incident category is PROBED, never assumed: most databases have none of
// these rules configured, and a KPI reading "0" is indistinguishable from "this
// feature was never switched on". Unconfigured categories render greyed with the
// actual reason instead.
//
// ponytail: NO auto-dial, auto-SMS or auto-WhatsApp, and none should ever be
// added. Every category here is a heuristic over data the database may not even
// be configured for — a geofence rule with a sloppy polygon false-positives all
// day. Software that places a call on its own turns that into a fleet manager
// being phoned at 3am about nothing, or worse, an emergency number dialled by a
// bug. Buttons are user-initiated, always.

import '../styles/security.css';

import { fetchExceptionEvents } from '../api/fetchers/exception-event';
import { fetchZones } from '../api/fetchers/zone';
import { fetchDeviceStatus } from '../api/fetchers/device-status';
import { fetchDrivers } from '../api/fetchers/driver';
import { fetchDevices } from '../api/fetchers/device';
import { fetchTrips } from '../api/fetchers/trip';
import { fetchRules } from '../api/fetchers/rule';
import { getCurrentFilter } from '../components/filter-bar';
import { onFilterChangeVisible } from './reload-when-visible';
import { esc, clamp, int } from '../utils/format';
import { renderExplainCard, bindExplainToggles, type KpiExplanation } from '../components/kpi-explain';
import { openGlossary } from '../components/glossary';
import { summarizeSecurity } from '../analytics/summary';
import { toUtcRange } from '../utils/date-range';
import { DEFAULT_WORKING_HOURS } from '../components/kpi-card';
import {
  classifyIncident,
  summarizeIncidents,
  telHref,
  waHref,
  breachesForZone,
  isOutsideWorkingHours,
  toE164,
  type IncidentCategory,
} from '../analytics/security';
import type {
  DeviceLite,
  DeviceStatusDTO,
  DriverLite,
  ExceptionEventDTO,
  FilterChangeDetail,
  RuleDTO,
  TripDTO,
  ZoneDTO,
} from '../api/fetchers/types';
import type { ViewCtx } from './registry';

/** Categories the feed shows. 'other' exceptions belong to Safety Behaviour. */
type FeedCategory = Exclude<IncidentCategory, 'other'> | 'unauthorized';

interface Incident {
  at: string;
  category: FeedCategory;
  severity: 'low' | 'medium' | 'high';
  deviceId: string;
  label: string;
}

interface Loaded {
  events: ExceptionEventDTO[];
  zones: ZoneDTO[];
  statuses: DeviceStatusDTO[];
  drivers: DriverLite[];
  devices: DeviceLite[];
  trips: TripDTO[];
  rules: RuleDTO[];
  filter: FilterChangeDetail;
}

interface SecurityHours {
  startHour: number;
  hoursPerDay: number;
}

// ponytail: own storage key rather than extending kpi-card's working-hours
// value, because startHour is meaningless to the utilization KPI and a shared
// key means two views racing each other's writes. hoursPerDay reuses
// DEFAULT_WORKING_HOURS so the default only lives in one place. Merge into a
// shared utils/working-hours.ts if a third view needs the shift start.
const HOURS_KEY = 'fleet-analytics:security-hours:';
const CONTACT_KEY = 'fleet-analytics:emergency-contact:';
const DEFAULT_START_HOUR = 7;

/** A real fleet produced 5436 exception events in 7 days. Rendering all of them
 *  is a DOM freeze nobody scrolls through anyway. */
const FEED_LIMIT = 100;
const CONTACT_LIMIT = 25;

const CATEGORY_LABEL: Record<FeedCategory, string> = {
  panic: 'Panik / SOS',
  accident: 'Kecelakaan / Benturan',
  unauthorized: 'Pergerakan Tak Sah',
  geofence: 'Pelanggaran Geofence',
};

const SEVERITY_LABEL = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' } as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback; // private mode / corrupt value
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the override just won't persist */
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function osmHref(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

export function initSecurityView(container: HTMLElement, ctx: ViewCtx): () => void {
  container.classList.add('fa-security');

  let hours = normalizeHours(readJson<SecurityHours>(HOURS_KEY + ctx.database, defaultHours()));
  let contacts = readJson<Record<string, string>>(CONTACT_KEY + ctx.database, {});
  let latest: Loaded | null = null;
  // Filter changes can overlap (7-day fetch still in flight when the user picks
  // 30 days) — only the newest load may paint.
  let loadSeq = 0;

  function defaultHours(): SecurityHours {
    return { startHour: DEFAULT_START_HOUR, hoursPerDay: DEFAULT_WORKING_HOURS.hoursPerDay };
  }

  function normalizeHours(h: SecurityHours): SecurityHours {
    return {
      startHour: clamp(Number(h.startHour), 0, 23, DEFAULT_START_HOUR),
      hoursPerDay: clamp(Number(h.hoursPerDay), 1, 24, DEFAULT_WORKING_HOURS.hoursPerDay),
    };
  }

  async function load(filter: FilterChangeDetail): Promise<void> {
    const seq = ++loadSeq;
    container.innerHTML = '<p class="fa-empty">Memuat data keamanan…</p>';
    try {
      const { fromIso, toIso } = toUtcRange(filter.dateFrom, filter.dateTo);
      const groupId = filter.groupId;
      const [events, zones, statuses, drivers, devices, trips, rules] = await Promise.all([
        fetchExceptionEvents({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchZones({ database: ctx.database }),
        fetchDeviceStatus({ database: ctx.database }),
        fetchDrivers({ database: ctx.database }),
        fetchDevices({ database: ctx.database, groupId, fromDate: fromIso, toDate: toIso }),
        fetchTrips({ database: ctx.database, fromDate: fromIso, toDate: toIso, groupId }),
        fetchRules({ database: ctx.database }),
      ]);
      if (seq !== loadSeq) return;
      latest = { events, zones, statuses, drivers, devices, trips, rules, filter };
      render();
    } catch (err) {
      console.error('security: load failed', err);
      if (seq !== loadSeq) return;
      container.innerHTML = '<p class="fa-error">Gagal memuat data keamanan.</p>';
    }
  }

  function render(): void {
    if (!latest) return;
    const { events, zones, statuses, drivers, devices, trips, rules, filter } = latest;

    const deviceName = new Map(devices.map((d) => [d.id, d.name]));
    for (const s of statuses) if (!deviceName.has(s.deviceId)) deviceName.set(s.deviceId, s.deviceName);
    const nameOf = (id: string) => deviceName.get(id) ?? id;
    const statusOf = new Map(statuses.map((s) => [s.deviceId, s]));

    // PROBE: which categories does this database actually have rules for?
    const ruleCategories = new Set(rules.map((r) => classifyIncident(r.id, r.name)));

    const totals = summarizeIncidents(events);
    const incidents: Incident[] = [];

    for (const e of events) {
      const category = classifyIncident(e.ruleId, e.ruleName);
      if (category === 'other') continue;
      incidents.push({
        at: e.start,
        category,
        severity: e.severity,
        deviceId: e.deviceId,
        label: e.ruleName || e.ruleId,
      });
    }

    const offHoursTrips = trips.filter((t) => isOutsideWorkingHours(t.start, hours.startHour, hours.hoursPerDay));
    for (const t of offHoursTrips) {
      incidents.push({
        at: t.start,
        category: 'unauthorized',
        severity: 'medium',
        deviceId: t.deviceId,
        label: 'Trip dimulai di luar jam kerja',
      });
    }

    incidents.sort((a, b) => b.at.localeCompare(a.at));

    // The zone filter has been emitted by the filter bar since day one and
    // consumed by nobody — this is what finally reads it.
    const selectedZone = filter.zoneId ? zones.find((z) => z.id === filter.zoneId) : undefined;
    const breaches = selectedZone ? breachesForZone(trips, selectedZone) : [];

    const shiftEnd = (hours.startHour + hours.hoursPerDay) % 24;
    const shiftLabel = `${String(hours.startHour).padStart(2, '0')}:00–${String(shiftEnd).padStart(2, '0')}:00`;

    container.innerHTML = `
      <p class="fa-summary">${esc(
        summarizeSecurity({
          panic: totals.panic,
          accident: totals.accident,
          offHoursTrips: offHoursTrips.length,
          geofence: totals.geofence,
          tripCount: trips.length,
          configured: {
            panic: ruleCategories.has('panic'),
            accident: ruleCategories.has('accident'),
            geofence: ruleCategories.has('geofence') || zones.length > 0,
          },
          shiftLabel,
          shiftHours: hours.hoursPerDay,
        })
      )}</p>
      <div class="fa-kpi-row">
        ${kpiCard(
          'sec-panic',
          'Panik / SOS',
          totals.panic,
          ruleCategories.has('panic') ? 'Dari aturan panic/SOS di database ini' : '',
          ruleCategories.has('panic') ? '' : 'Tombol panik belum dikonfigurasi di database ini',
          {
            formula: 'Jumlah ExceptionEvent dari Rule yang namanya mengandung panic / SOS / emergency',
            substituted: `${int(totals.panic)} kejadian pada rentang ini`,
            source:
              'ExceptionEvent + Rule (MyGeotab). Kategori ditentukan dengan mencocokkan NAMA aturan, karena tidak ' +
              'ada tipe khusus untuk panic di MyGeotab. Aturan panik dengan nama tidak lazim tidak akan terdeteksi ' +
              'di sini — periksa penamaan Rule Anda kalau angkanya terasa terlalu kecil.',
            kind: 'terukur',
          }
        )}
        ${kpiCard(
          'sec-accident',
          'Kecelakaan / Benturan',
          totals.accident,
          ruleCategories.has('accident') ? 'Dari aturan deteksi benturan' : '',
          ruleCategories.has('accident') ? '' : 'Aturan deteksi kecelakaan belum dikonfigurasi di database ini',
          {
            formula: 'Jumlah ExceptionEvent dari Rule yang namanya mengandung accident / collision / impact / crash',
            substituted: `${int(totals.accident)} kejadian pada rentang ini`,
            source:
              'ExceptionEvent + Rule (MyGeotab). Sama seperti panik: pencocokan berdasarkan nama aturan. ' +
              'Aturan benturan biasanya dipicu ambang akselerometer yang Anda setel sendiri di MyGeotab, jadi ' +
              'satu kejadian di sini belum tentu kecelakaan — bisa juga polisi tidur yang dilewati terlalu cepat.',
            kind: 'terukur',
          }
        )}
        ${kpiCard(
          'sec-offhours',
          'Pergerakan Tak Sah',
          offHoursTrips.length,
          `Trip mulai di luar ${shiftLabel}
           <label>Mulai <input type="number" id="fa-sec-start" min="0" max="23" value="${hours.startHour}"></label>
           <label>Durasi (jam) <input type="number" id="fa-sec-hours" min="1" max="24" value="${hours.hoursPerDay}"></label>`,
          trips.length ? '' : 'Tidak ada data trip pada rentang tanggal ini',
          {
            formula: `Jumlah Trip yang jam mulainya (waktu lokal) berada di luar jendela ${shiftLabel}`,
            substituted:
              hours.hoursPerDay >= 24
                ? `${int(offHoursTrips.length)} dari ${int(trips.length)} trip. Shift disetel 24 jam, jadi tidak ada jam yang bisa disebut di luar jam kerja — angka ini akan selalu 0. Itu benar untuk operasi 24/7; persempit durasinya kalau site Anda punya jam tutup.`
                : `${int(offHoursTrips.length)} dari ${int(trips.length)} trip mulai di luar ${shiftLabel}`,
            source:
              'Trip.start (MyGeotab), dibandingkan dengan jam shift yang ANDA isi di kartu ini — bukan dari ' +
              'MyGeotab. Ini murni perbandingan jam, BUKAN deteksi pencurian: lembur yang sah, jemput muatan ' +
              'dini hari, dan sopir yang pulang telat semuanya akan muncul di sini.',
            kind: 'heuristik',
          }
        )}
        ${kpiCard(
          'sec-geofence',
          'Pelanggaran Geofence',
          totals.geofence,
          geofenceNote(ruleCategories.has('geofence'), zones.length, selectedZone, breaches.length),
          ruleCategories.has('geofence') || zones.length
            ? ''
            : 'Belum ada zona/geofence maupun aturannya di database ini',
          {
            formula: 'Jumlah ExceptionEvent dari Rule zona/geofence',
            substituted: selectedZone
              ? `${int(totals.geofence)} dari aturan zona, ditambah ${int(breaches.length)} trip yang mulai atau berakhir di dalam zona "${selectedZone.name}" (dihitung langsung dari titik trip, bukan dari aturan)`
              : `${int(totals.geofence)} kejadian dari aturan zona. Pilih satu zona di filter untuk melihat perhitungan langsung dari titik awal/akhir trip.`,
            source:
              'ExceptionEvent + Rule + Zone (MyGeotab). Perhitungan langsung memakai uji titik-dalam-poligon pada ' +
              'titik awal dan akhir trip — zona tanpa poligon tidak bisa dihitung. Trip yang hanya MELINTAS zona ' +
              'tanpa berhenti tidak terdeteksi cara ini, karena hanya kedua ujungnya yang diperiksa.',
            kind: 'terukur',
          }
        )}
      </div>

      <section class="fa-sec-panel">
        <h2 class="fa-sec-title">Insiden Terbaru</h2>
        ${renderFeed(incidents, nameOf, statusOf)}
      </section>

      ${filter.zoneId ? renderBreaches(selectedZone, breaches, nameOf) : ''}

      <section class="fa-sec-panel">
        <h2 class="fa-sec-title">Kontak Darurat per Kendaraan</h2>
        ${renderContacts(incidents, devices, drivers)}
      </section>
    `;
  }

  /**
   * Kategori yang belum dikonfigurasi tetap tampil abu-abu dengan alasannya —
   * dan TIDAK mendapat panel "Bagaimana ini dihitung?", karena tidak ada yang
   * dihitung. "0" pada kategori yang aturannya tidak pernah dibuat tidak bisa
   * dibedakan dari "fitur ini tidak pernah dinyalakan"; itulah kenapa nilainya
   * "—", bukan nol.
   */
  function kpiCard(
    key: string,
    label: string,
    value: number,
    note: string,
    disabledReason: string,
    explain?: KpiExplanation
  ): string {
    if (disabledReason) {
      return `<div class="fa-kpi-card fa-sec-off">
        <div class="fa-kpi-label">${esc(label)}</div>
        <div class="fa-kpi-value">—</div>
        <div class="fa-kpi-note fa-sec-reason">${esc(disabledReason)}</div>
      </div>`;
    }
    if (!explain) {
      return `<div class="fa-kpi-card">
        <div class="fa-kpi-label">${esc(label)}</div>
        <div class="fa-kpi-value">${int(value)}</div>
        ${note ? `<div class="fa-kpi-note">${note}</div>` : ''}
      </div>`;
    }
    return renderExplainCard({
      key,
      label,
      valueHtml: int(value),
      caption: '',
      explain,
      open: openPanels.has(key),
      // `note` membawa markup milik kartu (input shift), jadi tidak boleh di-escape.
      extra: note ? `<div class="fa-kpi-note">${note}</div>` : '',
    });
  }

  function geofenceNote(hasRule: boolean, zoneCount: number, zone: ZoneDTO | undefined, breachCount: number): string {
    const parts: string[] = [];
    parts.push(hasRule ? 'Dari aturan zona' : `Tanpa aturan zona — ${zoneCount} zona tersedia`);
    if (zone) parts.push(`${breachCount} pelanggaran terhitung langsung di zona "${esc(zone.name)}"`);
    else if (zoneCount) parts.push('Pilih zona di filter untuk perhitungan langsung');
    return parts.join(' · ');
  }

  function renderFeed(
    incidents: Incident[],
    nameOf: (id: string) => string,
    statusOf: Map<string, DeviceStatusDTO>
  ): string {
    if (!incidents.length) {
      return `<p class="fa-empty">Tidak ada insiden keamanan pada rentang dan filter ini. Kategori yang berwarna abu-abu di atas belum dikonfigurasi, jadi kejadiannya memang tidak akan pernah muncul.</p>`;
    }

    const rows = incidents
      .slice(0, FEED_LIMIT)
      .map((i) => {
        const status = statusOf.get(i.deviceId);
        const hasFix = status && !(status.lat === 0 && status.lon === 0);
        const location = hasFix
          ? `<a href="${osmHref(status!.lat, status!.lon)}" target="_blank" rel="noopener">Lokasi</a>`
          : '<span class="fa-sec-muted">Tidak ada posisi</span>';
        return `<tr>
          <td>${esc(formatTime(i.at))}</td>
          <td>${esc(nameOf(i.deviceId))}</td>
          <td>${esc(CATEGORY_LABEL[i.category])}<div class="fa-sec-muted">${esc(i.label)}</div></td>
          <td><span class="fa-badge fa-badge-${i.severity}">${SEVERITY_LABEL[i.severity]}</span></td>
          <td>${location}</td>
        </tr>`;
      })
      .join('');

    const more =
      incidents.length > FEED_LIMIT
        ? `<p class="fa-sec-muted fa-sec-foot">Menampilkan ${FEED_LIMIT} dari ${incidents.length} insiden terbaru.</p>`
        : '';

    return `<table class="fa-table">
        <thead><tr><th>Waktu</th><th>Unit</th><th>Kategori</th><th>Keparahan</th><th>Posisi Terakhir</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>${more}`;
  }

  function renderBreaches(
    zone: ZoneDTO | undefined,
    breaches: ReturnType<typeof breachesForZone>,
    nameOf: (id: string) => string
  ): string {
    if (!zone) {
      return `<section class="fa-sec-panel"><h2 class="fa-sec-title">Pelanggaran Geofence</h2>
        <p class="fa-empty">Zona yang dipilih tidak ditemukan di database ini.</p></section>`;
    }
    const body = breaches.length
      ? `<table class="fa-table">
          <thead><tr><th>Waktu</th><th>Unit</th><th>Kejadian</th></tr></thead>
          <tbody>${breaches
            .slice()
            .sort((a, b) => b.at.localeCompare(a.at))
            .map(
              (b) => `<tr>
                <td>${esc(formatTime(b.at))}</td>
                <td>${esc(nameOf(b.deviceId))}</td>
                <td>${b.kind === 'start' ? 'Trip dimulai di dalam zona' : 'Trip berakhir di dalam zona'}</td>
              </tr>`
            )
            .join('')}</tbody>
        </table>`
      : `<p class="fa-empty">Tidak ada trip yang mulai atau berakhir di dalam zona ini pada rentang tanggal terpilih.${
          zone.points.length ? '' : ' Zona ini tidak punya poligon, jadi tidak ada yang bisa dihitung.'
        }</p>`;

    return `<section class="fa-sec-panel">
      <h2 class="fa-sec-title">Pelanggaran Geofence — ${esc(zone.name)}</h2>
      <p class="fa-sec-muted">Dihitung langsung dari titik awal/akhir trip, bukan dari aturan zona.</p>
      ${body}
    </section>`;
  }

  function renderContacts(incidents: Incident[], devices: DeviceLite[], drivers: DriverLite[]): string {
    if (!devices.length) return '<p class="fa-empty">Tidak ada kendaraan aktif pada filter ini.</p>';

    const involved = new Set(incidents.map((i) => i.deviceId));
    const sorted = [...devices].sort((a, b) => a.name.localeCompare(b.name));
    const hit = sorted.filter((d) => involved.has(d.id));
    // ponytail: cap at CONTACT_LIMIT when nothing happened — a 5000-vehicle
    // fleet would otherwise render 5000 cards nobody scrolls. Add a search box
    // here if someone needs to reach a vehicle that had no incident.
    const shown = hit.length ? hit : sorted.slice(0, CONTACT_LIMIT);
    const note = hit.length
      ? 'Kendaraan yang terlibat insiden pada rentang ini.'
      : `Belum ada insiden — menampilkan ${shown.length} kendaraan pertama.`;

    // ponytail: no fetcher exposes the driver↔vehicle assignment (DriverChange /
    // DeviceStatusInfo.driver are not in any DTO), so the number cannot be
    // pre-filled automatically. One shared <datalist> of every driver's number
    // is the native way to pick one without rendering N selects x M options.
    const options = drivers
      .map((d) => ({ d, e164: d.phone ? toE164(d.phone) : null }))
      .filter((x) => x.e164)
      .map((x) => `<option value="${esc(x.e164!)}">${esc(x.d.name)}</option>`)
      .join('');

    const cards = shown
      .map((d) => {
        const phone = contacts[d.id] ?? '';
        const tel = telHref(phone);
        const wa = waHref(phone);
        const actions =
          tel && wa
            ? `<a class="fa-sec-btn" href="${tel}">Telepon</a>
               <a class="fa-sec-btn fa-sec-btn-wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`
            : `<span class="fa-sec-btn fa-sec-btn-off" aria-disabled="true">Telepon</span>
               <span class="fa-sec-btn fa-sec-btn-off" aria-disabled="true">WhatsApp</span>`;
        return `<div class="fa-sec-contact">
          <div class="fa-sec-contact-name">${esc(d.name)}</div>
          <label class="fa-sec-field">Nomor darurat
            <input type="tel" class="fa-sec-phone" list="fa-sec-drivers" data-device="${esc(d.id)}"
                   value="${esc(phone)}" placeholder="08xx / +62xx">
          </label>
          ${phone && !tel ? '<div class="fa-sec-reason">Nomor tidak valid — tombol dimatikan.</div>' : ''}
          <div class="fa-sec-actions">${actions}</div>
        </div>`;
      })
      .join('');

    return `<p class="fa-sec-muted">${esc(note)} Nomor disimpan lokal di browser ini, per database.</p>
      <datalist id="fa-sec-drivers">${options}</datalist>
      <div class="fa-sec-contacts">${cards}</div>`;
  }

  // One delegated listener for every input the view renders, so re-rendering
  // never leaks handlers and cleanup is a single removeEventListener.
  function onChange(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.matches('.fa-sec-phone')) {
      const input = target as HTMLInputElement;
      const deviceId = input.dataset.device!;
      const value = input.value.trim();
      if (value) contacts[deviceId] = value;
      else delete contacts[deviceId];
      writeJson(CONTACT_KEY + ctx.database, contacts);
      render(); // re-enables/disables the call buttons for the new number
      return;
    }

    if (target.matches('#fa-sec-start') || target.matches('#fa-sec-hours')) {
      const startEl = container.querySelector<HTMLInputElement>('#fa-sec-start');
      const hoursEl = container.querySelector<HTMLInputElement>('#fa-sec-hours');
      hours = normalizeHours({
        startHour: Number(startEl?.value),
        hoursPerDay: Number(hoursEl?.value),
      });
      writeJson(HOURS_KEY + ctx.database, hours);
      render(); // pure re-derivation from `latest` — no refetch
    }
  }


  // Profil Operasi menulis knob ini ke localStorage lalu menyiarkan event ini.
  // Baca ulang dan render dari data yang sudah ada — tidak ada fetch baru.
  // Panel penjelasan yang terbuka bertahan melewati render ulang: mengubah jam
  // shift tidak boleh membanting tutup panel yang menjelaskan jam shift itu.
  const { open: openPanels, stop: stopExplain } = bindExplainToggles(container);

  const onTermClick = (e: Event): void => {
    const term = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-term]')?.dataset.term;
    if (term) openGlossary(term);
  };
  container.addEventListener('click', onTermClick);

  const onProfileChange = (): void => {
    hours = normalizeHours(readJson<SecurityHours>(HOURS_KEY + ctx.database, defaultHours()));
    render();
  };
  ctx.rootEl.addEventListener('dashboard:profile-change', onProfileChange);

  container.addEventListener('change', onChange);
  const offFilter = onFilterChangeVisible(ctx.rootEl, container, load);
  load(getCurrentFilter());

  return () => {
    loadSeq++; // any in-flight load must not paint after cleanup
    offFilter();
    ctx.rootEl.removeEventListener('dashboard:profile-change', onProfileChange);
    container.removeEventListener('change', onChange);
    container.removeEventListener('click', onTermClick);
    stopExplain();
    container.innerHTML = ''; // discards every rendered input with its node
  };
}
