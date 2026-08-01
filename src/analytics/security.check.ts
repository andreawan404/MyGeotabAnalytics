import assert from 'node:assert';
import {
  classifyIncident,
  summarizeIncidents,
  toE164,
  telHref,
  waHref,
  breachesForZone,
  isOutsideWorkingHours,
  type TripPoints,
} from './security';

// --- toE164: the four shapes an Indonesian number actually arrives in --------
assert.strictEqual(toE164('08123456789'), '+628123456789', 'national trunk 0 -> +62');
assert.strictEqual(toE164('+628123456789'), '+628123456789', 'already E.164 passes through');
assert.strictEqual(toE164('628123456789'), '+628123456789', 'bare country code just gains a +');
assert.strictEqual(toE164('0812-3456-789'), '+628123456789', 'dashes stripped');
assert.strictEqual(toE164(' (0812) 3456 789 '), '+628123456789', 'spaces and parens stripped');
assert.strictEqual(toE164('008123456789'), '+8123456789', '00 is an international prefix, not a trunk 0');
assert.strictEqual(toE164('8123456789'), '+628123456789', 'no prefix at all -> default cc');
assert.strictEqual(toE164(''), null, 'empty is not a number');
assert.strictEqual(toE164('abc'), null, 'letters are not a number');
assert.strictEqual(toE164('+62-812-ABCD'), null, 'partial junk is still junk');
assert.strictEqual(toE164('0812'), null, 'too short to dial');
assert.strictEqual(toE164('0' + '1'.repeat(20)), null, 'longer than E.164 allows');
assert.strictEqual(toE164('0412345678', '1'), '+1412345678', 'default country code is overridable');

assert.strictEqual(telHref('0812-3456-789'), 'tel:+628123456789');
assert.strictEqual(waHref('0812-3456-789'), 'https://wa.me/628123456789', 'wa.me wants digits, no +');
assert.strictEqual(telHref('abc'), null);
assert.strictEqual(waHref('abc'), null);

// --- classifyIncident: id first, then localized names -----------------------
assert.strictEqual(classifyIncident('RuleAccidentId', ''), 'accident', 'built-in id, no name needed');
assert.strictEqual(classifyIncident('RuleZoneStopId', ''), 'geofence', 'built-in zone id');
assert.strictEqual(classifyIncident('b1A2', 'Tombol Darurat Ditekan'), 'panic', 'custom Indonesian name');
assert.strictEqual(classifyIncident('c3D4', 'Keluar Zona Terlarang'), 'geofence', 'zona -> geofence');
assert.strictEqual(classifyIncident('e5F6', 'Deteksi Kecelakaan'), 'accident', 'kecelakaan -> accident');
assert.strictEqual(classifyIncident('aB9', 'Rem Mendadak'), 'other', 'harsh braking is not a security incident');

assert.deepStrictEqual(
  summarizeIncidents([]),
  { panic: 0, accident: 0, geofence: 0, other: 0 },
  'empty database summarizes to zeros, not to an empty object'
);
assert.deepStrictEqual(
  summarizeIncidents([
    { ruleId: 'RuleAccidentId', ruleName: '' },
    { ruleId: 'b1A2', ruleName: 'Tombol Panik' },
    { ruleId: 'b1A2', ruleName: 'Tombol Panik' },
    { ruleId: 'aB9', ruleName: 'Rem Mendadak' },
  ]),
  { panic: 2, accident: 1, geofence: 0, other: 1 }
);

// --- breachesForZone (pointInPolygon-backed) --------------------------------
// 0.01 deg square around Kemayoran, same region as dev/fixtures.ts.
const zone = {
  points: [
    { lat: -6.15, lon: 106.83 },
    { lat: -6.15, lon: 106.84 },
    { lat: -6.16, lon: 106.84 },
    { lat: -6.16, lon: 106.83 },
  ],
};

const trips: TripPoints[] = [
  {
    id: 'trip-in',
    deviceId: 'dev-1',
    start: '2026-08-01T01:00:00Z',
    stop: '2026-08-01T02:00:00Z',
    startLat: -6.155,
    startLon: 106.835, // inside
    stopLat: -6.2,
    stopLon: 106.9, // outside
  },
  {
    id: 'trip-out',
    deviceId: 'dev-2',
    start: '2026-08-01T03:00:00Z',
    stop: '2026-08-01T04:00:00Z',
    startLat: -6.3,
    startLon: 107.1,
    stopLat: -6.4,
    stopLon: 107.2,
  },
];

assert.deepStrictEqual(
  breachesForZone(trips, zone),
  [{ tripId: 'trip-in', deviceId: 'dev-1', at: '2026-08-01T01:00:00Z', kind: 'start' }],
  'only the endpoint actually inside the polygon is a breach'
);
assert.deepStrictEqual(breachesForZone([], zone), [], 'no trips, no breaches');
assert.deepStrictEqual(breachesForZone(trips, { points: [] }), [], 'a zone with no polygon contains nothing');

// --- isOutsideWorkingHours (LOCAL time, so build instants from local parts) --
const localIso = (h: number, m = 0) => new Date(2026, 7, 1, h, m).toISOString();

// 07:00 + 10h = 07:00-17:00
assert.strictEqual(isOutsideWorkingHours(localIso(9), 7, 10), false, '09:00 is inside 07-17');
assert.strictEqual(isOutsideWorkingHours(localIso(7), 7, 10), false, 'start hour is inside');
assert.strictEqual(isOutsideWorkingHours(localIso(16, 59), 7, 10), false, 'one minute before close is inside');
assert.strictEqual(isOutsideWorkingHours(localIso(17), 7, 10), true, 'end hour is already outside');
assert.strictEqual(isOutsideWorkingHours(localIso(6, 30), 7, 10), true, 'before the shift is outside');
assert.strictEqual(isOutsideWorkingHours(localIso(23), 7, 10), true, 'night is outside');

// 22:00 + 8h = 22:00-06:00, wrapping past midnight
assert.strictEqual(isOutsideWorkingHours(localIso(23), 22, 8), false, 'wrapped window: before midnight is inside');
assert.strictEqual(isOutsideWorkingHours(localIso(2), 22, 8), false, 'wrapped window: after midnight is inside');
assert.strictEqual(isOutsideWorkingHours(localIso(6), 22, 8), true, 'wrapped window: end hour is outside');
assert.strictEqual(isOutsideWorkingHours(localIso(12), 22, 8), true, 'wrapped window: midday is outside');

assert.strictEqual(isOutsideWorkingHours(localIso(3), 0, 24), false, '24h operation never flags');
assert.strictEqual(isOutsideWorkingHours('not-a-date', 7, 10), false, 'unparseable time makes no accusation');

console.log('security.check.ts: PASS');
