// Raw MyGeotab API fixtures for dev-only mock (see dev/mock-api.ts).
// Shapes match exactly what each src/api/fetchers/*.ts toDTO() reads off the
// RAW response — these are NOT pre-normalized DTOs. Region: Greater Jakarta
// (this is an Indonesian reseller's product — root CLAUDE.md).
//
// Dates are relative to "now" (not hardcoded) so they always fall inside the
// filter bar's default trailing-7-day window (src/components/filter-bar.ts)
// no matter when `npm run dev` is run.

import { haversineKm } from '../src/utils/geo';

const now = Date.now();
const HOUR = 60 * 60 * 1000;

function iso(hoursAgo: number): string {
  return new Date(now - hoursAgo * HOUR).toISOString();
}

// MyGeotab serializes TimeSpan the .NET way — "HH:MM:SS", and "d.HH:MM:SS" once
// it passes 24h — NOT ISO-8601. Getting this wrong is what zeroed every duration
// KPI against the real database (see src/api/fetchers/parseDuration.ts).
function dur(h: number, m: number, s = 0): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const body = `${pad(h % 24)}:${pad(m)}:${pad(s)}`;
  return h >= 24 ? `${Math.floor(h / 24)}.${body}` : body;
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
  // Deliberately swallows all four zones above. Trip Report must resolve a stop
  // to the SMALLEST zone containing it — otherwise every journey reads
  // "Jabodetabek -> Jabodetabek" and the report says nothing. Without an
  // overlapping zone in the fixtures that rule is never exercised in dev.
  {
    id: 'zone-5',
    name: 'Jabodetabek',
    points: [
      { x: 106.5, y: -5.9 },
      { x: 107.3, y: -5.9 },
      { x: 107.3, y: -6.5 },
      { x: 106.5, y: -6.5 },
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

// Driver assignment per vehicle. device-4 is deliberately left unidentified
// (Geotab's UnknownDriverId sentinel) so dev mode exercises BOTH branches of the
// safety module's attribution gate rather than only the happy path.
const DRIVER_BY_DEVICE: Record<string, string> = {
  'device-1': 'user-1',
  'device-2': 'user-2',
  'device-3': 'user-3',
};

export const rawTrips = TRIP_SPECS.map((t) => {
  const startHoursAgo = t.stopHoursAgo + t.driveHours;
  const [driveH, driveMFrac] = [Math.floor(t.driveHours), (t.driveHours % 1) * 60];
  return {
    id: t.id,
    device: { id: t.deviceId },
    driver: { id: DRIVER_BY_DEVICE[t.deviceId] ?? 'UnknownDriverId' },
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

// Rule entities, fetched separately (Get Rule) — this is the ONLY place a rule
// name exists. Built-in ids are Geotab's stable, non-localized system ids; the
// two lowercase ids are customer-defined rules, whose names an Indonesian
// database returns in Indonesian.
// No seatbelt rule on purpose — plenty of vehicles never report seatbelt status,
// so this is a realistic gap AND it is what makes dev mode render the "Rule belum
// dikonfigurasi" branch. A fixture where everything is configured only ever
// exercises the happy path, and the whole point of the coverage check is that a
// missing rule must not look like zero violations. Same reasoning as omitting
// DiagnosticOdometerId from the StatusData rows below.
// `condition` is Geotab's hierarchical Condition tree: `value` is the threshold
// the rule fires at, `diagnostic` is what it compares. Real rules nest the
// comparison under AND/OR plumbing, so the fixtures nest too — a flat tree would
// not prove the walker recurses.
//
// "SMA-07" is deliberately named nothing like braking and has an opaque id: it
// is the case that made every unit read "Lainnya" on the real database, and it
// can ONLY be classified from the diagnostic inside its condition.
const cond = (diagnosticId: string, conditionType: string, value: number) => ({
  conditionType: 'And',
  children: [{ conditionType, value, diagnostic: { id: diagnosticId } }],
});

export const rawRules = [
  { id: 'RuleHarshBrakingId', name: 'Pengereman Mendadak', baseType: 'Stock', condition: cond('DiagnosticAccelerationForwardBrakingId', 'ValueLessThan', -0.4) },
  { id: 'RuleHarshAccelerationId', name: 'Akselerasi Mendadak', baseType: 'Stock', condition: cond('DiagnosticAccelerationForwardBrakingId', 'ValueMoreThan', 0.38) },
  { id: 'RuleHarshCorneringId', name: 'Menikung Tajam', baseType: 'Stock', condition: cond('DiagnosticAccelerationSideToSideId', 'ValueMoreThan', 0.45) },
  { id: 'RuleSpeedingId', name: 'Melebihi Batas Kecepatan', baseType: 'Stock', condition: cond('DiagnosticGoDeviceSpeedId', 'ValueMoreThan', 80) },
  { id: 'RuleIdlingId', name: 'Mesin Menyala Terlalu Lama', baseType: 'Stock', condition: cond('DiagnosticIdleTimeId', 'ValueMoreThan', 300) },
  { id: 'SMA-07', name: 'Peringatan Unit', baseType: 'Custom', condition: cond('DiagnosticAccelerationForwardBrakingId', 'ValueLessThan', -0.55) },
  { id: 'b1A2', name: 'Masuk Zona Terlarang', baseType: 'Custom', condition: { conditionType: 'And', children: [] } },
  { id: 'c3D4', name: 'Perawatan Terjadwal', baseType: 'Custom', condition: null },
];

// Get ExceptionEvent returns `rule` as a BARE {id} — no name. Deriving severity
// from a name that is never present is what bucketed every event as "low".
export const rawExceptionEvents = [
  { id: 'exc-1', device: { id: 'device-1' }, rule: { id: 'RuleHarshBrakingId' }, activeFrom: iso(4), activeTo: iso(3.98), duration: dur(0, 1, 12) },
  { id: 'exc-2', device: { id: 'device-2' }, rule: { id: 'RuleSpeedingId' }, activeFrom: iso(11), activeTo: iso(10.9), duration: dur(0, 3, 30) },
  { id: 'exc-3', device: { id: 'device-3' }, rule: { id: 'RuleSeatbeltId' }, activeFrom: iso(28), activeTo: iso(27.7), duration: dur(0, 18, 0) },
  { id: 'exc-4', device: { id: 'device-4' }, rule: { id: 'RuleHarshCorneringId' }, activeFrom: iso(45), activeTo: iso(44.99), duration: dur(0, 0, 40) },
  { id: 'exc-5', device: { id: 'device-1' }, rule: { id: 'RuleIdlingId' }, activeFrom: iso(9), activeTo: iso(8.6), duration: dur(0, 24, 0) },
  { id: 'exc-6', device: { id: 'device-2' }, rule: { id: 'RuleHarshAccelerationId' }, activeFrom: iso(13), activeTo: iso(12.98), duration: dur(0, 1, 5) },
  { id: 'exc-7', device: { id: 'device-3' }, rule: { id: 'b1A2' }, activeFrom: iso(31), activeTo: iso(30.9), duration: dur(0, 6, 0) },
  { id: 'exc-8', device: { id: 'device-4' }, rule: { id: 'RuleIdlingId' }, activeFrom: iso(52), activeTo: iso(51.5), duration: dur(0, 30, 0) },
  // >24h duration — exercises the "d.HH:MM:SS" TimeSpan form ("1.02:00:00").
  { id: 'exc-9', device: { id: 'device-1' }, rule: { id: 'c3D4' }, activeFrom: iso(60), activeTo: iso(34), duration: dur(26, 0, 0) },
  { id: 'exc-10', device: { id: 'device-2' }, rule: { id: 'c3D4' }, activeFrom: iso(35), activeTo: iso(34.8), duration: dur(0, 12, 0) },
  { id: 'exc-11', device: { id: 'device-3' }, rule: { id: 'RuleHarshBrakingId' }, activeFrom: iso(56), activeTo: iso(55.98), duration: dur(0, 0, 55) },
  { id: 'exc-12', device: { id: 'device-4' }, rule: { id: 'RuleSpeedingId' }, activeFrom: iso(72), activeTo: iso(71.9), duration: dur(0, 4, 0) },
];

// Raw Diagnostic carries its unit as a nested {id} reference, not a string.
// Note "Total Fuel Used" has a DATABASE-SPECIFIC lowercase id: there is no
// confirmed well-known id for it, which is exactly why the fuel module resolves
// it via findDiagnosticIdByName instead of a constant (see probe.ts).
export const rawDiagnostics = [
  { id: 'DiagnosticOdometerId', name: 'Odometer', unitOfMeasure: { id: 'UnitOfMeasureKilometersId' } },
  { id: 'DiagnosticOdometerAdjustmentId', name: 'Odometer adjustment', unitOfMeasure: { id: 'UnitOfMeasureKilometersId' } },
  { id: 'DiagnosticEngineHoursId', name: 'Engine hours', unitOfMeasure: { id: 'UnitOfMeasureHoursId' } },
  { id: 'DiagnosticFuelLevelId', name: 'Fuel level', unitOfMeasure: { id: 'UnitOfMeasurePercentageId' } },
  // The counter MyGeotab's own Fuel Usage report is built on. It has a CONFIRMED
  // well-known id, so it is resolved by id — names are localized and a name-only
  // lookup finds nothing on a non-English database.
  { id: 'DiagnosticDeviceTotalFuelId', name: 'Total fuel used', unitOfMeasure: { id: 'UnitOfMeasureLitersId' } },
  { id: 'DiagnosticEngineCoolantTemperatureId', name: 'Engine coolant temperature', unitOfMeasure: { id: 'UnitOfMeasureDegreesCelsiusId' } },
  // Referenced by the safety Rules below. Without these the threshold line falls
  // back to printing the raw diagnostic id — the fallback works, but a reader
  // should see "Acceleration forward/braking < −0,40", not an identifier.
  { id: 'DiagnosticAccelerationForwardBrakingId', name: 'Acceleration forward/braking', unitOfMeasure: { id: 'UnitOfMeasureGForceId' } },
  { id: 'DiagnosticAccelerationSideToSideId', name: 'Acceleration side to side', unitOfMeasure: { id: 'UnitOfMeasureGForceId' } },
  { id: 'DiagnosticGoDeviceSpeedId', name: 'Kecepatan kendaraan', unitOfMeasure: { id: 'UnitOfMeasureKilometersPerHourId' } },
  { id: 'DiagnosticIdleTimeId', name: 'Durasi idle', unitOfMeasure: { id: 'UnitOfMeasureSecondsId' } },
];

// StatusData: sampled every 6h over the last 7 days, per device.
// DiagnosticOdometerId is deliberately NOT emitted even though it exists in the
// catalogue above — a database can list a diagnostic and never report it. That
// is the whole reason probeDiagnostics() exists, and dev mode should show it
// coming back false rather than silently pretending everything is available.
const STATUS_SAMPLE_HOURS = 6;
const STATUS_SPAN_HOURS = 7 * 24;

interface StatusSeedSpec {
  deviceId: string;
  odometerKm: number; // reading 7 days ago
  kmPerSample: number;
  engineHours: number; // reading 7 days ago
  hoursPerSample: number;
  fuelStartPct: number;
  fuelDropPct: number; // burn between samples
}

const STATUS_SEEDS: StatusSeedSpec[] = [
  { deviceId: 'device-1', odometerKm: 184_320, kmPerSample: 41, engineHours: 6_412, hoursPerSample: 1.4, fuelStartPct: 82, fuelDropPct: 5 },
  { deviceId: 'device-2', odometerKm: 251_870, kmPerSample: 78, engineHours: 9_105, hoursPerSample: 2.1, fuelStartPct: 61, fuelDropPct: 7 },
  { deviceId: 'device-3', odometerKm: 92_540, kmPerSample: 33, engineHours: 3_288, hoursPerSample: 1.1, fuelStartPct: 74, fuelDropPct: 4 },
  { deviceId: 'device-4', odometerKm: 65_110, kmPerSample: 28, engineHours: 2_140, hoursPerSample: 0.9, fuelStartPct: 90, fuelDropPct: 6 },
  { deviceId: 'device-5', odometerKm: 31_760, kmPerSample: 12, engineHours: 1_004, hoursPerSample: 0.5, fuelStartPct: 55, fuelDropPct: 3 },
];

const REFUEL_THRESHOLD_PCT = 18;
const REFUEL_TO_PCT = 95;

// StatusData puts its number in `data` (NOT `value`) — status-data.ts normalizes it.
function statusRow(deviceId: string, diagnosticId: string, hoursAgo: number, data: number) {
  return {
    device: { id: deviceId },
    diagnostic: { id: diagnosticId },
    dateTime: iso(hoursAgo),
    data: Math.round(data * 100) / 100,
  };
}

function deviceStatusRows(seed: StatusSeedSpec) {
  const rows: any[] = [];
  let odometer = seed.odometerKm;
  let engineHours = seed.engineHours;
  let fuel = seed.fuelStartPct;

  for (let hoursAgo = STATUS_SPAN_HOURS; hoursAgo >= 0; hoursAgo -= STATUS_SAMPLE_HOURS) {
    rows.push(statusRow(seed.deviceId, 'DiagnosticOdometerAdjustmentId', hoursAgo, odometer));
    rows.push(statusRow(seed.deviceId, 'DiagnosticEngineHoursId', hoursAgo, engineHours));
    rows.push(statusRow(seed.deviceId, 'DiagnosticFuelLevelId', hoursAgo, fuel));

    odometer += seed.kmPerSample; // monotonic — a decrease would be a data bug, not a fixture
    engineHours += seed.hoursPerSample;
    fuel = fuel - seed.fuelDropPct <= REFUEL_THRESHOLD_PCT ? REFUEL_TO_PCT : fuel - seed.fuelDropPct;
  }
  return rows;
}

// "Total fuel used" is a LIFETIME counter written at ignition-off, so it gets
// one reading per trip rather than the 6-hourly sampling above — and that
// reading is timestamped a little AFTER trip.stop, exactly as the real device
// behaves. That lag is what the tooltip's grace window has to absorb, so the
// fixtures reproduce it instead of landing conveniently on the stop instant.
const LITRES_PER_KM = 0.12;
const IGNITION_OFF_LAG_HOURS = 0.01; // ~36 s after the trip ends

function totalFuelUsedRows() {
  const rows: ReturnType<typeof statusRow>[] = [];
  const running = new Map<string, number>();
  // Oldest first, so the counter only ever climbs.
  for (const t of [...TRIP_SPECS].sort((a, b) => b.stopHoursAgo - a.stopHoursAgo)) {
    if (!running.has(t.deviceId)) {
      running.set(t.deviceId, 4000);
      // A baseline reading BEFORE the device's first trip: without one there is
      // nothing to subtract from and the first trip is legitimately unmeasured.
      rows.push(statusRow(t.deviceId, 'DiagnosticDeviceTotalFuelId', t.stopHoursAgo + t.driveHours + 0.1, 4000));
    }
    const next = running.get(t.deviceId)! + haversineKm(t.from, t.to) * LITRES_PER_KM;
    running.set(t.deviceId, next);
    rows.push(statusRow(t.deviceId, 'DiagnosticDeviceTotalFuelId', t.stopHoursAgo - IGNITION_OFF_LAG_HOURS, next));
  }
  return rows;
}

export const rawStatusData = [...STATUS_SEEDS.flatMap(deviceStatusRows), ...totalFuelUsedRows()];

// FaultData: severity lives under a DIFFERENT key depending on database version,
// so the fixtures deliberately mix all three forms fault-data.ts coalesces.
export const rawFaultData = [
  { id: 'flt-1', device: { id: 'device-1' }, diagnostic: { id: 'DiagnosticEngineCoolantTemperatureId' }, dateTime: iso(5), faultState: 'Active', severity: 'Critical', count: 3, dismissDateTime: null, failureMode: { id: 'fm-overheat' }, faultLampState: 'RedStopLamp', riskOfBreakdown: 0.82, controller: { name: 'Engine #1' } },
  { id: 'flt-2', device: { id: 'device-2' }, diagnostic: { id: 'DiagnosticEngineCoolantTemperatureId' }, dateTime: iso(14), faultState: 'Pending', faultSeverity: 'Warning', count: 1, dismissDateTime: null, failureMode: { id: 'fm-sensor' }, faultLampState: 'AmberWarningLamp', riskOfBreakdown: null, controller: { name: 'Engine #1' } },
  { id: 'flt-3', device: { id: 'device-2' }, diagnostic: { id: 'DiagnosticOdometerId' }, dateTime: iso(26), faultState: 'Inactive', diagnosticSeverity: 'Informational', count: 7, dismissDateTime: iso(24), failureMode: null, faultLampState: null, riskOfBreakdown: null, controller: null },
  { id: 'flt-4', device: { id: 'device-3' }, diagnostic: { id: 'DiagnosticFuelLevelId' }, dateTime: iso(38), faultState: 'Active', severity: 'Warning', count: 2, dismissDateTime: null, failureMode: { id: 'fm-fuel-sensor' }, faultLampState: 'MalfunctionLamp', riskOfBreakdown: 0.41, controller: { name: 'Body Controller' } },
  // No severity key at all -> must land on 'Unknown', not undefined.
  { id: 'flt-5', device: { id: 'device-4' }, diagnostic: { id: 'DiagnosticEngineHoursId' }, dateTime: iso(50), faultState: 'Active', count: 1, dismissDateTime: null, failureMode: null, faultLampState: 'AmberWarningLamp', riskOfBreakdown: null, controller: { name: 'Transmission' } },
  { id: 'flt-6', device: { id: 'device-1' }, diagnostic: { id: 'DiagnosticEngineCoolantTemperatureId' }, dateTime: iso(63), faultState: 'Active', severity: 'Critical', count: 5, dismissDateTime: null, failureMode: { id: 'fm-overheat' }, faultLampState: 'RedStopLamp', riskOfBreakdown: 0.77, controller: { name: 'Engine #1' } },
  { id: 'flt-7', device: { id: 'device-5' }, diagnostic: { id: 'DiagnosticFuelLevelId' }, dateTime: iso(88), faultState: 'None', severity: 'Informational', count: 1, dismissDateTime: iso(80), failureMode: null, faultLampState: null, riskOfBreakdown: null, controller: null },
];

// Volume is `volume`, currency is `currencyCode`, distance is `odometer`.
//
// Volumes are sized against the distances these devices actually cover in the
// fixture window (tens of km, not thousands), so fuel economy lands in a
// believable 9-12 km/L. Litres that outweigh the kilometres make the BBM view
// render a real calculation over nonsense input — the arithmetic looks broken
// when it is the data that is, and that costs a debugging round trip every time
// someone eyeballs dev mode. IDR ~13.500/L.
export const rawFuelTransactions = [
  { id: 'fuel-1', device: { id: 'device-1' }, dateTime: iso(10), volume: 2.4, cost: 32_400, currencyCode: 'IDR', odometer: 184_690 },
  { id: 'fuel-2', device: { id: 'device-2' }, dateTime: iso(20), volume: 8.1, cost: 109_350, currencyCode: 'IDR', odometer: 252_640 },
  { id: 'fuel-3', device: { id: 'device-3' }, dateTime: iso(33), volume: 4.0, cost: 54_000, currencyCode: 'IDR', odometer: 92_870 },
  // cost/currency deliberately null — the Biaya column must degrade, not NaN.
  { id: 'fuel-4', device: { id: 'device-1' }, dateTime: iso(58), volume: 1.5, cost: null, currencyCode: null, odometer: null },
  { id: 'fuel-5', device: { id: 'device-4' }, dateTime: iso(76), volume: 6.8, cost: 91_800, currencyCode: 'IDR', odometer: 65_390 },
];

// Get User with search {isDriver:true}. `name` is the LOGIN (an email), not a
// person's name — driver.ts prefers firstName+lastName and only falls back here.
export const rawDrivers = [
  { id: 'user-1', name: 'budi.santoso@jpt.co.id', firstName: 'Budi', lastName: 'Santoso', phoneNumber: '+628121110001', isDriver: true },
  { id: 'user-2', name: 'siti.rahayu@jpt.co.id', firstName: 'Siti', lastName: 'Rahayu', phoneNumber: '+628121110002', isDriver: true },
  { id: 'user-3', name: 'agus.wijaya@jpt.co.id', firstName: 'Agus', lastName: 'Wijaya', phoneNumber: null, isDriver: true },
  { id: 'user-4', name: 'dewi.lestari@jpt.co.id', firstName: 'Dewi', lastName: 'Lestari', phoneNumber: '+628121110004', isDriver: true },
  // Names not filled in — the DTO must fall back to the login rather than render blank.
  { id: 'user-5', name: 'driver05@jpt.co.id', firstName: '', lastName: '', isDriver: true },
];

// One DVIRLog holds MANY defects; dvir-log.ts flattens them into one row each.
// The defect NAME lives at defects[].defect.name, one level deeper than it looks.
export const rawDvirLogs = [
  {
    id: 'dvir-1',
    device: { id: 'device-1' },
    dateTime: iso(6),
    defects: [
      { id: 'dd-1', defect: { id: 'def-brakes', name: 'Brakes', severity: 'Critical' }, repairStatus: 'NotRepaired' },
      { id: 'dd-2', defect: { id: 'def-lights', name: 'Lights', severity: 'Minor' }, repairStatus: 'Repaired' },
    ],
  },
  {
    id: 'dvir-2',
    device: { id: 'device-2' },
    dateTime: iso(29),
    defects: [{ id: 'dd-3', defect: { id: 'def-tires', name: 'Tires', severity: 'Major' }, repairStatus: 'NotRepaired' }],
  },
  // Defect rows without their own id — dvir-log.ts synthesizes `${log.id}:${i}`.
  {
    id: 'dvir-3',
    device: { id: 'device-4' },
    dateTime: iso(54),
    defects: [
      { defect: { id: 'def-wipers', name: 'Windshield Wipers' }, repairStatus: 'Repaired' },
      { defect: { id: 'def-mirror', name: 'Mirrors' }, repairStatus: null },
    ],
  },
  // A clean inspection: zero defects, and must contribute zero rows.
  { id: 'dvir-4', device: { id: 'device-3' }, dateTime: iso(70), defects: [] },
];
