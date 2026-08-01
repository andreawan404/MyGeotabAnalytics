// Frozen DTO contracts shared by data-agent's fetchers and ui-agent/viz-agent's
// consumers. Types only — no logic here (see root CLAUDE.md naming conventions).

export interface TripDTO {
  id: string;
  deviceId: string;
  start: string;
  stop: string;
  distanceKm: number;
  drivingDurationSec: number;
  idlingDurationSec: number;
  startLat: number;
  startLon: number;
  stopLat: number;
  stopLon: number;
  /** undefined when the trip has no identified driver (Geotab's UnknownDriverId,
   * normal on fleets without NFC/iButton). The safety module hides its per-driver
   * ranking when too few trips carry one. */
  driverId?: string;
}

export interface LogRecordDTO {
  deviceId: string;
  dateTime: string;
  lat: number;
  lon: number;
  speedKmh: number;
}

export interface ExceptionEventDTO {
  id: string;
  deviceId: string;
  ruleId: string;
  ruleName: string;
  severity: 'low' | 'medium' | 'high';
  start: string;
  stop: string | null;
  durationSec: number;
}

export interface RuleDTO {
  id: string;
  name: string;
}

export interface DeviceLite {
  id: string;
  name: string;
  /** Decommissioned devices carry a past activeTo; live ones default to 2050-01-01. */
  activeFrom?: string;
  activeTo?: string;
}

export interface DeviceStatusDTO {
  deviceId: string;
  deviceName: string;
  isDriving: boolean;
  lat: number;
  lon: number;
  speedKmh: number;
  dateTime: string;
}

export interface ZoneDTO {
  id: string;
  name: string;
  points: { lat: number; lon: number }[];
  centerLat: number;
  centerLon: number;
}

export interface DiagnosticDTO {
  id: string;
  name: string;
  unitOfMeasureId?: string;
}

export interface StatusDataDTO {
  deviceId: string;
  diagnosticId: string;
  dateTime: string;
  value: number;
}

export interface FaultDataDTO {
  id: string;
  deviceId: string;
  diagnosticId: string;
  dateTime: string;
  /** Active | Inactive | Pending | None */
  faultState: string;
  /** raw.severity, coalescing faultSeverity then diagnosticSeverity */
  severity: string;
  count: number;
  dismissDateTime: string | null;
  failureModeId: string | null;
  /** e.g. MalfunctionLamp / RedStopLamp / AmberWarningLamp */
  faultLampState: string | null;
  /** Geotab's own signal; often null */
  riskOfBreakdown: number | null;
  controllerName: string | null;
}

export interface FuelTransactionDTO {
  id: string;
  deviceId: string;
  dateTime: string;
  volumeL: number;
  cost: number | null;
  currency: string | null;
  odometerKm: number | null;
}

export interface DvirDefectDTO {
  id: string;
  deviceId: string;
  dateTime: string;
  defectName: string;
  severity: string | null;
  repairStatus: string | null;
}

export interface DriverLite {
  id: string;
  name: string;
  phone: string | null;
}

/** Shape of the `dashboard:filter-change` CustomEvent detail (ui-agent -> viz-agent contract). */
export interface FilterChangeDetail {
  dateFrom: string;
  dateTo: string;
  groupId?: string;
  zoneId?: string;
}
