// Fleet-health math over DTOs. PURE: no DOM, no Chart.js, no Leaflet, no
// fetchers — that is the only reason fleet-health.check.ts runs under plain
// `tsx`. Every impure thing (fetching, rendering) lives in views/fleet-health.ts.
//
// ponytail: deliberately NO composite 0-100 "health score". Its weights would be
// unfalsifiable — nobody can say whether a MIL lamp is worth 30 points or 45, so
// the number would look authoritative while encoding one afternoon's guess. A
// table sorted by (critical lamp, active fault count, recency) carries the same
// signal and every column is checkable against the vehicle. Add a score only if
// a customer supplies the weights and owns them.

import type { FaultDataDTO, DiagnosticDTO, DeviceLite } from '../api/fetchers/types';

/** MIL / red-stop style lamps mean "stop driving now". Amber/warning lamps are
 *  advisory and are deliberately NOT critical: on any fleet with a stuck
 *  emissions sensor, folding amber in makes the KPI permanently red and useless. */
const CRITICAL_LAMP = /malfunction|redstop|red_stop|stop/i;

export function isCriticalLamp(faultLampState: string | null): boolean {
  return faultLampState != null && CRITICAL_LAMP.test(faultLampState);
}

/** Geotab also emits Inactive/None rows (a fault that already cleared) and rows
 *  a technician dismissed. Neither is something anyone still has to act on. */
const ACTIVE_STATE = /^active$/i;

/** In OBD-II, "Pending" means the ECU saw the fault ONCE and has not confirmed it
 *  — confirmation needs a second drive cycle. A mechanic does not treat that as
 *  work, so folding it into "aktif" inflates the workshop list with faults that
 *  may clear by themselves. Counted separately, never as active. */
const PENDING_STATE = /^pending$/i;

function undismissed(f: FaultDataDTO): boolean {
  return f.dismissDateTime == null;
}

/** Confirmed and still outstanding — the workshop worklist. */
export function activeFaults(faults: FaultDataDTO[]): FaultDataDTO[] {
  return faults.filter((f) => undismissed(f) && ACTIVE_STATE.test(f.faultState));
}

/** Detected but unconfirmed — watch, do not dispatch. Disjoint from activeFaults
 *  by construction, so the two can be summed without double counting. */
export function pendingFaults(faults: FaultDataDTO[]): FaultDataDTO[] {
  return faults.filter((f) => undismissed(f) && PENDING_STATE.test(f.faultState));
}

export interface FaultCodeTally {
  diagnosticId: string;
  name: string;
  occurrences: number;
  deviceCount: number;
}

/** Which fault codes dominate, and how widely they are spread. `deviceCount`
 *  separates "one broken truck reporting 400 times" from "40 trucks with the
 *  same defect" — occurrences alone cannot tell those apart. */
export function topFaultCodes(
  faults: FaultDataDTO[],
  diagnostics: DiagnosticDTO[],
  limit = 10
): FaultCodeTally[] {
  const nameById = new Map(diagnostics.map((d) => [d.id, d.name]));
  const byCode = new Map<string, { occurrences: number; devices: Set<string> }>();

  for (const f of faults) {
    let entry = byCode.get(f.diagnosticId);
    if (!entry) {
      entry = { occurrences: 0, devices: new Set() };
      byCode.set(f.diagnosticId, entry);
    }
    // Plenty of real rows carry count 0 (or no count at all) — a row that exists
    // still happened at least once, so 0 would silently erase whole codes.
    entry.occurrences += f.count > 0 ? f.count : 1;
    entry.devices.add(f.deviceId);
  }

  return [...byCode]
    .map(([diagnosticId, entry]) => ({
      diagnosticId,
      // Unresolvable ids stay visible as the raw id rather than becoming a blank
      // row — an unknown code is a finding, not something to hide.
      name: nameById.get(diagnosticId) ?? diagnosticId,
      occurrences: entry.occurrences,
      deviceCount: entry.devices.size,
    }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

export interface VehicleFaultRank {
  deviceId: string;
  deviceName: string;
  criticalLamps: number;
  activeCount: number;
  lastFaultAt: string;
}

/** Worst-first worklist. Ordering is the whole point: a critical lamp outranks
 *  any volume of amber chatter, volume breaks that tie, recency breaks the next.
 *  Devices with no faults never enter the list. */
export function rankVehiclesByFault(faults: FaultDataDTO[], devices: DeviceLite[]): VehicleFaultRank[] {
  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  const byDevice = new Map<string, VehicleFaultRank>();

  for (const f of faults) {
    let row = byDevice.get(f.deviceId);
    if (!row) {
      row = {
        deviceId: f.deviceId,
        deviceName: nameById.get(f.deviceId) ?? f.deviceId,
        criticalLamps: 0,
        activeCount: 0,
        lastFaultAt: f.dateTime,
      };
      byDevice.set(f.deviceId, row);
    }
    if (isCriticalLamp(f.faultLampState)) row.criticalLamps++;
    if (undismissed(f) && ACTIVE_STATE.test(f.faultState)) row.activeCount++;
    if (isAfter(f.dateTime, row.lastFaultAt)) row.lastFaultAt = f.dateTime;
  }

  return [...byDevice.values()].sort(
    (a, b) =>
      b.criticalLamps - a.criticalLamps ||
      b.activeCount - a.activeCount ||
      (isAfter(b.lastFaultAt, a.lastFaultAt) ? 1 : isAfter(a.lastFaultAt, b.lastFaultAt) ? -1 : 0)
  );
}

/** Compare instants, not strings: an unparseable/absent dateTime sorts oldest
 *  instead of throwing off the whole ordering. */
function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

export interface HealthSummary {
  devicesWithActiveFaults: number;
  totalDevices: number;
  pctAffected: number;
  criticalLampCount: number;
  activeCount: number;
  pendingCount: number;
  /** Rows that are neither active nor pending: dismissed, or already cleared. */
  resolvedCount: number;
  /** Raw faultState histogram across ALL rows, dismissed included. */
  byState: Record<string, number>;
}

export function healthSummary(faults: FaultDataDTO[], devices: DeviceLite[]): HealthSummary {
  const active = activeFaults(faults);
  const pending = pendingFaults(faults);
  // "Bermasalah" means confirmed work outstanding — a pending fault the ECU has
  // not confirmed does not put a vehicle on the workshop list.
  const affected = new Set(active.map((f) => f.deviceId));

  const byState: Record<string, number> = {};
  for (const f of faults) byState[f.faultState] = (byState[f.faultState] ?? 0) + 1;

  return {
    devicesWithActiveFaults: affected.size,
    totalDevices: devices.length,
    // An empty fleet is 0% affected, never NaN — this renders straight into a KPI.
    pctAffected: devices.length > 0 ? (affected.size / devices.length) * 100 : 0,
    // Counted over ACTIVE faults only: a red lamp that already cleared is history.
    criticalLampCount: active.filter((f) => isCriticalLamp(f.faultLampState)).length,
    activeCount: active.length,
    pendingCount: pending.length,
    // Derived here rather than in the view so the three buckets provably sum to
    // the row count and no KPI can ever double count or go negative.
    resolvedCount: faults.length - active.length - pending.length,
    byState,
  };
}
