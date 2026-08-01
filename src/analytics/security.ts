// Security & emergency logic. PURE — no DOM, no Chart.js/Leaflet, no fetchers,
// so it runs under plain `tsx` (see security.check.ts). Type-only imports of the
// frozen DTO contracts are fine: they erase at compile time.

import { pointInPolygon } from '../utils/geo';
import type { TripDTO, ZoneDTO } from '../api/fetchers/types';

export type IncidentCategory = 'panic' | 'accident' | 'geofence' | 'other';

// WHY THE ID COMES FIRST (same reasoning as fetchers/rule-severity.ts): Geotab's
// built-in rule NAMES are localized — an Indonesian database returns "Tombol
// Darurat", not "Panic Button" — while rule IDS are stable and English. Names
// are the fallback for customer-defined rules, whose ids are opaque ("b1A2"),
// which is why the name patterns carry the Indonesian words too.
const PANIC_ID_RE = /panic|sos|emergency/i;
const ACCIDENT_ID_RE = /accident|collision|impact/i;
const GEOFENCE_ID_RE = /zone|geofence/i;

const PANIC_NAME_RE = /panic|sos|emergency|darurat|panik/i;
const ACCIDENT_NAME_RE = /accident|collision|impact|kecelakaan|benturan|tabrakan/i;
const GEOFENCE_NAME_RE = /zone|zona|geofence|geo-?fence|pagar/i;

export function classifyIncident(ruleId: string, ruleName: string): IncidentCategory {
  if (PANIC_ID_RE.test(ruleId)) return 'panic';
  if (ACCIDENT_ID_RE.test(ruleId)) return 'accident';
  if (GEOFENCE_ID_RE.test(ruleId)) return 'geofence';

  if (PANIC_NAME_RE.test(ruleName)) return 'panic';
  if (ACCIDENT_NAME_RE.test(ruleName)) return 'accident';
  if (GEOFENCE_NAME_RE.test(ruleName)) return 'geofence';

  return 'other';
}

export function summarizeIncidents(
  events: { ruleId: string; ruleName: string }[]
): Record<IncidentCategory, number> {
  const totals: Record<IncidentCategory, number> = { panic: 0, accident: 0, geofence: 0, other: 0 };
  for (const e of events) totals[classifyIncident(e.ruleId, e.ruleName)]++;
  return totals;
}

// --- phone numbers ---------------------------------------------------------

// Everything a human types between digits. Kept deliberately small: anything
// else surviving the strip means the value is not a phone number.
const SEPARATORS = /[\s\-().]/g;
const DIGITS_ONLY = /^\d+$/;
const MIN_DIGITS = 8; // shortest plausible national number
const MAX_DIGITS = 15; // E.164 hard limit

/**
 * Indonesian mobile numbers arrive in four shapes and only one of them is
 * dialable as-is: `08123456789` (national, the common case), `+628123456789`,
 * `628123456789`, and `0812-3456-789`. Junk returns null so the UI can disable
 * the call buttons rather than render a `tel:` link that fails silently.
 */
export function toE164(phone: string, defaultCc = '62'): string | null {
  if (!phone) return null;

  const compact = phone.replace(SEPARATORS, '');
  const plus = compact.startsWith('+');
  let digits = plus ? compact.slice(1) : compact;
  if (!DIGITS_ONLY.test(digits)) return null;

  if (!plus) {
    // 00 = the other international prefix; 0 = national trunk prefix.
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = defaultCc + digits.slice(1);
    else if (!digits.startsWith(defaultCc)) digits = defaultCc + digits;
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return '+' + digits;
}

export function telHref(phone: string): string | null {
  const e164 = toE164(phone);
  return e164 && 'tel:' + e164;
}

/** wa.me takes bare digits — a leading `+` 404s. */
export function waHref(phone: string): string | null {
  const e164 = toE164(phone);
  return e164 && 'https://wa.me/' + e164.slice(1);
}

// --- geofence breaches -----------------------------------------------------

/** Only the trip fields the geometry needs, so callers (and the check) don't
 *  have to build a whole TripDTO. */
export type TripPoints = Pick<
  TripDTO,
  'id' | 'deviceId' | 'start' | 'stop' | 'startLat' | 'startLon' | 'stopLat' | 'stopLon'
>;

export interface ZoneBreach {
  tripId: string;
  deviceId: string;
  at: string;
  kind: 'start' | 'stop';
}

/**
 * Trips that began or ended inside `zone`. This is a direct geometric check, not
 * a rule lookup, so it reports breaches in databases that have zones but no
 * zone-based exception rule configured at all.
 *
 * ponytail: endpoints only, not the full breadcrumb path — a trip that drove
 * straight through a zone without stopping is invisible here. Upgrade path is
 * LogRecord per trip, which is one fetch per device on a 5000-device fleet;
 * not worth it until someone asks for pass-through detection.
 */
export function breachesForZone(trips: TripPoints[], zone: Pick<ZoneDTO, 'points'>): ZoneBreach[] {
  const breaches: ZoneBreach[] = [];
  for (const t of trips) {
    if (pointInPolygon({ lat: t.startLat, lon: t.startLon }, zone.points)) {
      breaches.push({ tripId: t.id, deviceId: t.deviceId, at: t.start, kind: 'start' });
    }
    if (pointInPolygon({ lat: t.stopLat, lon: t.stopLon }, zone.points)) {
      breaches.push({ tripId: t.id, deviceId: t.deviceId, at: t.stop, kind: 'stop' });
    }
  }
  return breaches;
}

// --- working hours ---------------------------------------------------------

/**
 * LOCAL time, deliberately: "outside working hours" is a claim about the depot's
 * wall clock, and an ISO instant read as UTC would shift a Jakarta fleet by 7
 * hours — flagging the whole morning shift as unauthorized.
 *
 * A window that runs past midnight (e.g. 22:00 + 8h) wraps, so the inside test
 * flips from AND to OR.
 */
export function isOutsideWorkingHours(iso: string, startHour: number, hoursPerDay: number): boolean {
  const at = new Date(iso);
  const ms = at.getTime();
  // Unparseable timestamp: no claim either way beats a false accusation.
  if (Number.isNaN(ms)) return false;
  if (hoursPerDay >= 24) return false;

  const hour = at.getHours() + at.getMinutes() / 60;
  const end = startHour + hoursPerDay;
  const inside = end <= 24 ? hour >= startHour && hour < end : hour >= startHour || hour < end - 24;
  return !inside;
}
