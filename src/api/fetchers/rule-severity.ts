// Severity is not a MyGeotab field — it is derived. Pure module: no fetchers,
// no DOM, so it runs under plain `tsx` (see rule-severity.check.ts).
//
// WHY THE RULE ID COMES FIRST: Geotab's built-in rule NAMES are localized. An
// Indonesian database returns "Pengereman Mendadak" for harsh braking, so
// matching English keywords against names silently fails and buckets the whole
// fleet as "low" — exactly the production symptom. Rule IDS are stable, English
// and non-localized, so they are the reliable key. Names are only a fallback for
// customer-defined rules, whose ids are opaque (e.g. "b1A2").

export type Severity = 'low' | 'medium' | 'high';

// Exact ids seen in a real database go here — most specific, cheapest, and the
// only place to override a substring guess. Seed it from the "unmapped ruleId"
// warnings emitted by rule.ts.
const SEVERITY_BY_RULE_ID: Record<string, Severity> = {};

const HIGH_ID_RE = /HarshBraking|HarshAcceleration|HarshCornering|Accident|Collision|Speeding|Seatbelt/i;
const MEDIUM_ID_RE = /Idling|Idle|Zone|Stop|AfterHours/i;

// Name fallback for customer-defined rules only. Indonesian terms included
// because that is the language this reseller's customers name rules in.
const HIGH_NAME_RE = /harsh|speeding|collision|accident|seatbelt|mendadak|kecepatan|sabuk/i;
const MEDIUM_NAME_RE = /idle|idling|stop|zone|zona|berhenti|menganggur/i;

export function deriveSeverity(ruleId: string, ruleName: string): Severity {
  const exact = SEVERITY_BY_RULE_ID[ruleId];
  if (exact) return exact;

  if (HIGH_ID_RE.test(ruleId)) return 'high';
  if (MEDIUM_ID_RE.test(ruleId)) return 'medium';

  if (HIGH_NAME_RE.test(ruleName)) return 'high';
  if (MEDIUM_NAME_RE.test(ruleName)) return 'medium';

  return 'low';
}
