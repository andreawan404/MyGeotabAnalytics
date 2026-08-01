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

export interface DeviceLite {
  id: string;
  name: string;
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

/** Shape of the `dashboard:filter-change` CustomEvent detail (ui-agent -> viz-agent contract). */
export interface FilterChangeDetail {
  dateFrom: string;
  dateTo: string;
  groupId?: string;
  zoneId?: string;
}
