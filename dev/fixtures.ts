// Raw MyGeotab API fixtures for dev-only mock (see dev/mock-api.ts).
// Shapes match exactly what each src/api/fetchers/*.ts toDTO() reads off the
// RAW response — these are NOT pre-normalized DTOs. Region: Greater Jakarta
// (this is an Indonesian reseller's product — root CLAUDE.md).
//
// Dates are relative to "now" (not hardcoded) so they always fall inside the
// filter bar's default trailing-7-day window (src/components/filter-bar.ts)
// no matter when `npm run dev` is run.

const now = Date.now();
const HOUR = 60 * 60 * 1000;

function iso(hoursAgo: number): string {
  return new Date(now - hoursAgo * HOUR).toISOString();
}

function dur(h: number, m: number, s = 0): string {
  return `PT${h}H${m}M${s}S`;
}

export const rawDevices = [
  { id: 'device-1', name: 'Truck Alpha (B 1234 ABC)' },
  { id: 'device-2', name: 'Truck Bravo (B 5678 DEF)' },
  { id: 'device-3', name: 'Van Charlie (B 9012 GHI)' },
  { id: 'device-4', name: 'Van Delta (B 3456 JKL)' },
  { id: 'device-5', name: 'Motor Echo (B 7890 MNO)' },
];

export const rawGroups = [
  { id: 'group-1', name: 'Jakarta Fleet' },
  { id: 'group-2', name: 'Bandung Fleet' },
  { id: 'group-3', name: 'VIP Clients' },
];

// Zone.points is Geotab's Point object: {x: longitude, y: latitude} (see zone.ts).
export const rawZones = [
  {
    id: 'zone-1',
    name: 'Kemayoran Warehouse',
    points: [
      { x: 106.8395, y: -6.158 },
      { x: 106.842, y: -6.158 },
      { x: 106.842, y: -6.1605 },
      { x: 106.8395, y: -6.1605 },
    ],
  },
  {
    id: 'zone-2',
    name: 'Tanjung Priok Port',
    points: [
      { x: 106.88, y: -6.103 },
      { x: 106.885, y: -6.103 },
      { x: 106.885, y: -6.108 },
      { x: 106.88, y: -6.108 },
    ],
  },
  {
    id: 'zone-3',
    name: 'Cikarang Depot',
    points: [
      { x: 107.14, y: -6.2585 },
      { x: 107.145, y: -6.2585 },
      { x: 107.145, y: -6.2635 },
      { x: 107.14, y: -6.2635 },
    ],
  },
  {
    id: 'zone-4',
    name: 'BSD Office',
    points: [
      { x: 106.6505, y: -6.2995 },
      { x: 106.6555, y: -6.2995 },
      { x: 106.6555, y: -6.3045 },
      { x: 106.6505, y: -6.3045 },
    ],
  },
];

// Named waypoints reused as trip endpoints and log-record route anchors.
const KEMAYORAN = { lat: -6.159, lon: 106.8405 };
const TG_PRIOK = { lat: -6.1055, lon: 106.8825 };
const CIKARANG = { lat: -6.261, lon: 107.1425 };
const BEKASI = { lat: -6.238, lon: 107.001 };
const SUDIRMAN = { lat: -6.2088, lon: 106.8228 };
const KELAPA_GADING = { lat: -6.161, lon: 106.906 };
const BSD = { lat: -6.302, lon: 106.653 };
const TANGERANG = { lat: -6.178, lon: 106.63 };

type LatLon = { lat: number; lon: number };

function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

interface RawTripSpec {
  id: string;
  deviceId: string;
  from: LatLon;
  to: LatLon;
  stopHoursAgo: number; // trip end, hours before now
  driveHours: number; // trip duration in hours (decimal)
  idleMinutes: number;
}

const TRIP_SPECS: RawTripSpec[] = [
  // device-1: short port shuttle runs, several times a day
  { id: 'trip-1', deviceId: 'device-1', from: KEMAYORAN, to: TG_PRIOK, stopHoursAgo: 3, driveHours: 0.6, idleMinutes: 8 },
  { id: 'trip-2', deviceId: 'device-1', from: TG_PRIOK, to: KEMAYORAN, stopHoursAgo: 9, driveHours: 0.7, idleMinutes: 5 },
  { id: 'trip-3', deviceId: 'device-1', from: KEMAYORAN, to: TG_PRIOK, stopHoursAgo: 27, driveHours: 0.55, idleMinutes: 12 },
  { id: 'trip-4', deviceId: 'device-1', from: TG_PRIOK, to: KEMAYORAN, stopHoursAgo: 51, driveHours: 0.65, idleMinutes: 4 },
  { id: 'trip-5', deviceId: 'device-1', from: KEMAYORAN, to: TG_PRIOK, stopHoursAgo: 99, driveHours: 0.6, idleMinutes: 15 },

  // device-2: long haul Cikarang <-> Bekasi <-> Sudirman
  { id: 'trip-6', deviceId: 'device-2', from: CIKARANG, to: BEKASI, stopHoursAgo: 5, driveHours: 0.8, idleMinutes: 10 },
  { id: 'trip-7', deviceId: 'device-2', from: BEKASI, to: SUDIRMAN, stopHoursAgo: 12, driveHours: 1.3, idleMinutes: 25 },
  { id: 'trip-8', deviceId: 'device-2', from: SUDIRMAN, to: BEKASI, stopHoursAgo: 34, driveHours: 1.2, idleMinutes: 18 },
  { id: 'trip-9', deviceId: 'device-2', from: BEKASI, to: CIKARANG, stopHoursAgo: 41, driveHours: 0.75, idleMinutes: 6 },
  { id: 'trip-10', deviceId: 'device-2', from: CIKARANG, to: BEKASI, stopHoursAgo: 80, driveHours: 0.85, idleMinutes: 20 },

  // device-3: city delivery Sudirman <-> Kelapa Gading
  { id: 'trip-11', deviceId: 'device-3', from: SUDIRMAN, to: KELAPA_GADING, stopHoursAgo: 2, driveHours: 0.9, idleMinutes: 22 },
  { id: 'trip-12', deviceId: 'device-3', from: KELAPA_GADING, to: SUDIRMAN, stopHoursAgo: 7, driveHours: 0.95, idleMinutes: 14 },
  { id: 'trip-13', deviceId: 'device-3', from: SUDIRMAN, to: KELAPA_GADING, stopHoursAgo: 30, driveHours: 0.85, idleMinutes: 9 },
  { id: 'trip-14', deviceId: 'device-3', from: KELAPA_GADING, to: SUDIRMAN, stopHoursAgo: 55, driveHours: 1.0, idleMinutes: 30 },

  // device-4: BSD <-> Tangerang <-> Sudirman
  { id: 'trip-15', deviceId: 'device-4', from: BSD, to: TANGERANG, stopHoursAgo: 4, driveHours: 0.5, idleMinutes: 5 },
  { id: 'trip-16', deviceId: 'device-4', from: TANGERANG, to: SUDIRMAN, stopHoursAgo: 15, driveHours: 1.1, idleMinutes: 16 },
  { id: 'trip-17', deviceId: 'device-4', from: SUDIRMAN, to: BSD, stopHoursAgo: 44, driveHours: 1.15, idleMinutes: 11 },
  { id: 'trip-18', deviceId: 'device-4', from: BSD, to: TANGERANG, stopHoursAgo: 70, driveHours: 0.55, idleMinutes: 7 },
];

export const rawTrips = TRIP_SPECS.map((t) => {
  const startHoursAgo = t.stopHoursAgo + t.driveHours;
  const [driveH, driveMFrac] = [Math.floor(t.driveHours), (t.driveHours % 1) * 60];
  return {
    id: t.id,
    device: { id: t.deviceId },
    start: iso(startHoursAgo),
    stop: iso(t.stopHoursAgo),
    distance: Math.round(haversineKm(t.from, t.to) * 10) / 10,
    drivingDuration: dur(driveH, Math.round(driveMFrac)),
    idlingDuration: dur(0, t.idleMinutes),
    startLatitude: t.from.lat,
    startLongitude: t.from.lon,
    stopLatitude: t.to.lat,
    stopLongitude: t.to.lon,
  };
});

// Breadcrumb points interpolated along each trip's route so the heat map has
// visible density clusters around real trip corridors (deterministic lerp,
// no randomness — easy to eyeball-verify against the trip list above).
const STEPS_PER_TRIP = 16;

function tripLogRecords(spec: RawTripSpec) {
  const startHoursAgo = spec.stopHoursAgo + spec.driveHours;
  const points: any[] = [];
  for (let i = 0; i <= STEPS_PER_TRIP; i++) {
    const frac = i / STEPS_PER_TRIP;
    const hoursAgo = startHoursAgo - frac * spec.driveHours;
    const lat = spec.from.lat + (spec.to.lat - spec.from.lat) * frac;
    const lon = spec.from.lon + (spec.to.lon - spec.from.lon) * frac;
    // speed ramps up then down (0 at endpoints, peaks mid-route) — deterministic, not random.
    const speedKmh = Math.round(70 * Math.sin(Math.PI * frac) + 10);
    points.push({
      device: { id: spec.deviceId },
      dateTime: iso(hoursAgo),
      latitude: lat,
      longitude: lon,
      speed: speedKmh,
    });
  }
  return points;
}

export const rawLogRecords = TRIP_SPECS.flatMap(tripLogRecords);

export const rawDeviceStatusInfo = [
  { device: { id: 'device-1', name: 'Truck Alpha (B 1234 ABC)' }, isDriving: true, latitude: TG_PRIOK.lat, longitude: TG_PRIOK.lon, speed: 42, dateTime: iso(0.05) },
  { device: { id: 'device-2', name: 'Truck Bravo (B 5678 DEF)' }, isDriving: true, latitude: BEKASI.lat, longitude: BEKASI.lon, speed: 58, dateTime: iso(0.02) },
  { device: { id: 'device-3', name: 'Van Charlie (B 9012 GHI)' }, isDriving: false, latitude: SUDIRMAN.lat, longitude: SUDIRMAN.lon, speed: 0, dateTime: iso(0.5) },
  { device: { id: 'device-4', name: 'Van Delta (B 3456 JKL)' }, isDriving: false, latitude: BSD.lat, longitude: BSD.lon, speed: 0, dateTime: iso(1.2) },
  { device: { id: 'device-5', name: 'Motor Echo (B 7890 MNO)' }, isDriving: true, latitude: KELAPA_GADING.lat, longitude: KELAPA_GADING.lon, speed: 31, dateTime: iso(0.1) },
];

// Rule names deliberately hit all three deriveSeverity() buckets in
// exception-event.ts: HIGH_KEYWORDS = harsh/speeding/collision/seatbelt,
// MEDIUM_KEYWORDS = idle/idling/stop/zone, everything else -> low.
export const rawExceptionEvents = [
  { id: 'exc-1', device: { id: 'device-1' }, rule: { id: 'rule-1', name: 'Harsh Braking' }, activeFrom: iso(4), activeTo: iso(3.98), duration: dur(0, 1, 12) },
  { id: 'exc-2', device: { id: 'device-2' }, rule: { id: 'rule-2', name: 'Speeding - Toll Road' }, activeFrom: iso(11), activeTo: iso(10.9), duration: dur(0, 3, 30) },
  { id: 'exc-3', device: { id: 'device-3' }, rule: { id: 'rule-3', name: 'Seatbelt Not Worn' }, activeFrom: iso(28), activeTo: iso(27.7), duration: dur(0, 18, 0) },
  { id: 'exc-4', device: { id: 'device-4' }, rule: { id: 'rule-4', name: 'Collision Warning' }, activeFrom: iso(45), activeTo: iso(44.99), duration: dur(0, 0, 40) },
  { id: 'exc-5', device: { id: 'device-1' }, rule: { id: 'rule-5', name: 'Excessive Idling' }, activeFrom: iso(9), activeTo: iso(8.6), duration: dur(0, 24, 0) },
  { id: 'exc-6', device: { id: 'device-2' }, rule: { id: 'rule-6', name: 'Stop Sign Violation' }, activeFrom: iso(13), activeTo: iso(12.98), duration: dur(0, 1, 5) },
  { id: 'exc-7', device: { id: 'device-3' }, rule: { id: 'rule-7', name: 'Zone Entry - Restricted Area' }, activeFrom: iso(31), activeTo: iso(30.9), duration: dur(0, 6, 0) },
  { id: 'exc-8', device: { id: 'device-4' }, rule: { id: 'rule-8', name: 'Idle Time Exceeded' }, activeFrom: iso(52), activeTo: iso(51.5), duration: dur(0, 30, 0) },
  { id: 'exc-9', device: { id: 'device-1' }, rule: { id: 'rule-9', name: 'After Hours Usage' }, activeFrom: iso(60), activeTo: iso(58), duration: dur(2, 0, 0) },
  { id: 'exc-10', device: { id: 'device-2' }, rule: { id: 'rule-10', name: 'Unauthorized Route Deviation' }, activeFrom: iso(35), activeTo: iso(34.8), duration: dur(0, 12, 0) },
  { id: 'exc-11', device: { id: 'device-3' }, rule: { id: 'rule-1', name: 'Harsh Braking' }, activeFrom: iso(56), activeTo: iso(55.98), duration: dur(0, 0, 55) },
  { id: 'exc-12', device: { id: 'device-4' }, rule: { id: 'rule-2', name: 'Speeding - Toll Road' }, activeFrom: iso(72), activeTo: iso(71.9), duration: dur(0, 4, 0) },
];
