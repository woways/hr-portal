// Single source of truth for deriving an attendance record's Present / Half Day /
// Absent status from clock-in/out + hours worked, used by BOTH the Attendance
// dashboard and the Reports module so they can never disagree (BUG-06).

export interface AttThresholds {
  minHours: number;         // full-day minimum (>= this → Present)
  halfDayThreshold?: number; // retained for compatibility; not used by the current rule
}

export interface AttStatusRecord {
  clockIn?: string;
  clockOut?: string;
  status?: string;
  workingHours?: string;
}

export const DEFAULT_ATT_THRESHOLDS: AttThresholds = { minHours: 8, halfDayThreshold: 0 };

// "Xh Ym" from two clock strings (accepts "hh:mm AM/PM" and 24h "HH:MM").
export function computeHoursStr(clockIn = "", clockOut = ""): string {
  const toMins = (t: string): number | null => {
    if (!t) return null;
    const m12 = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (m12) {
      let h = parseInt(m12[1], 10); const min = parseInt(m12[2], 10);
      if (/PM/i.test(m12[3]) && h !== 12) h += 12;
      if (/AM/i.test(m12[3]) && h === 12) h = 0;
      return h * 60 + min;
    }
    const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
    return null;
  };
  const a = toMins(clockIn), b = toMins(clockOut);
  if (a == null || b == null) return "";
  let diff = b - a;
  if (diff < 0) diff += 24 * 60; // overnight
  return `${Math.floor(diff / 60)}h ${String(diff % 60).padStart(2, "0")}m`;
}

// Worked hours as a decimal, from stored workingHours or computed from clock times.
export function parseWorkedHours(rec: AttStatusRecord): number {
  const wh = (rec.workingHours && rec.workingHours.trim()) || computeHoursStr(rec.clockIn ?? "", rec.clockOut ?? "");
  const m = wh.match(/(\d+)\s*h\s*(\d+)?\s*m?/i);
  return m ? Number(m[1]) + Number(m[2] || 0) / 60 : 0;
}

// Session-wide CONFIGURED thresholds (BUG-ATT-02). effectiveStatus() reads these
// instead of the hardcoded defaults so the Half-Day / Present cutoffs set in
// Settings → Attendance Rules are honored on EVERY surface (attendance tiles,
// dashboard, reports) — and, because it's one shared value, those surfaces stay
// reconciled with each other (BUG-06 / BUG-DASH-01). Kept in sync by
// useAttendanceThresholds(), which subscribes to settings/attendanceRules.
let CONFIGURED_ATT_THRESHOLDS: AttThresholds = { ...DEFAULT_ATT_THRESHOLDS };
export function setConfiguredThresholds(t: AttThresholds): void {
  CONFIGURED_ATT_THRESHOLDS = { minHours: t.minHours, halfDayThreshold: t.halfDayThreshold ?? 0 };
}
export function getConfiguredThresholds(): AttThresholds {
  return CONFIGURED_ATT_THRESHOLDS;
}

// Convenience wrapper — uses the CONFIGURED thresholds (from Settings). Prefer this
// in UI counting paths (dashboard tile, attendance page counts, reports) so every
// surface applies the same, Settings-driven derivation regardless of what's stored
// in `status`. Fixes BUG-06 (dashboard/report mismatch) + BUG-ATT-02 (honor config).
export function effectiveStatus(rec: AttStatusRecord): string {
  return deriveAttendanceStatus(rec, CONFIGURED_ATT_THRESHOLDS);
}

// Derive the effective attendance status. Single rule shared by dashboard + reports,
// driven by the configured thresholds (BUG-ATT-02):
//  • No clock-in / 0 hours    → Absent (or the stored Leave / Week Off).
//  • Leave / Week Off         → unchanged.
//  • Clocked in, not out yet   → Present (an open shift is treated as working).
//  • Clocked out, ≥ minHours   → Present (full day, threshold from Settings).
//  • Clocked out, ≥ halfDay    → Half Day (met the configured half-day minimum).
//  • Clocked out, below halfDay → Absent (didn't reach the half-day threshold).
// With the default halfDayThreshold of 0, "≥ halfDay" is any positive time, so the
// baseline "any work under a full day = Half Day" rule (ATT-003) is unchanged.
export function deriveAttendanceStatus(rec: AttStatusRecord, t: AttThresholds): string {
  const clockIn = rec.clockIn ?? "";
  const status = rec.status ?? "";
  const hasClockIn = !!clockIn && clockIn !== "—" && clockIn !== "";
  if (!hasClockIn) return status || "Absent";
  if (status === "Leave" || status === "Week Off") return status;
  const clockOut = rec.clockOut ?? "";
  const clockedOut = !!clockOut && clockOut !== "Ongoing" && clockOut !== "—" && clockOut !== "";
  if (!clockedOut) return status && status !== "Absent" ? status : "Present";
  const hrs = parseWorkedHours(rec);
  const halfMin = t.halfDayThreshold ?? 0;
  if (hrs >= t.minHours) return "Present";          // full day or more (configured minHours)
  if (hrs > 0 && hrs >= halfMin) return "Half Day"; // within the configured half-day band
  return "Absent";                                   // below the half-day threshold (or no time)
}
