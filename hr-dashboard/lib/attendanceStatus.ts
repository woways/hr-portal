// Single source of truth for deriving an attendance record's Present / Half Day /
// Absent status from clock-in/out + hours worked, used by BOTH the Attendance
// dashboard and the Reports module so they can never disagree (BUG-06).

export interface AttThresholds {
  minHours: number;         // full-day minimum (>= this → Present)
  halfDayThreshold?: number; // retained for compatibility; not used by the current rule
  lateLoginCutoff?: string;  // "HH:MM" 24h — clock-in after this = late (default "10:30")
  clockOutCutoff?: string;   // "HH:MM" 24h — Clock-Out button disabled after this same-day (default "23:00")
}

export interface AttStatusRecord {
  clockIn?: string;
  clockOut?: string;
  status?: string;
  workingHours?: string;
  statusManual?: boolean; // true when HR has manually set the status (override wins)
  // Late-login-workflow fields (attached by the UI layer per-row, not persisted on
  // attendance/{docId} — the source-of-truth request lives in lateLoginRequests/).
  lateRequestStatus?: "Pending" | "Approved" | "Rejected";
}

export const DEFAULT_ATT_THRESHOLDS: AttThresholds = { minHours: 8, halfDayThreshold: 0, lateLoginCutoff: "10:30", clockOutCutoff: "23:00" };

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
  CONFIGURED_ATT_THRESHOLDS = {
    minHours: t.minHours,
    halfDayThreshold: t.halfDayThreshold ?? 0,
    lateLoginCutoff: t.lateLoginCutoff || DEFAULT_ATT_THRESHOLDS.lateLoginCutoff,
    clockOutCutoff:  t.clockOutCutoff  || DEFAULT_ATT_THRESHOLDS.clockOutCutoff,
  };
}
export function getConfiguredThresholds(): AttThresholds {
  return CONFIGURED_ATT_THRESHOLDS;
}

// Parse an "HH:MM" 24h string (from Settings) or "hh:mm AM/PM" (from a clock-in
// record) into minutes-since-midnight. Returns null when unparseable.
function parseTimeToMins(t: string | undefined | null): number | null {
  if (!t) return null;
  const s = String(t).trim();
  if (!s || s === "—" || s === "--:--") return null;
  const m12 = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m12) {
    let h = parseInt(m12[1], 10); const min = parseInt(m12[2], 10);
    if (/PM/i.test(m12[3]) && h !== 12) h += 12;
    if (/AM/i.test(m12[3]) && h === 12) h = 0;
    return h * 60 + min;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  return null;
}

// True when the clock-in time is strictly after the configured late cutoff.
// Uses the configured cutoff (from Settings → Attendance Rules); pass an explicit
// cutoff string to override. Returns false when either value is unparseable so a
// missing/bad config never flags a normal login as late.
export function isLateClockIn(clockIn: string | undefined | null, cutoff?: string): number | null {
  const inMins = parseTimeToMins(clockIn);
  const cutMins = parseTimeToMins(cutoff || CONFIGURED_ATT_THRESHOLDS.lateLoginCutoff || DEFAULT_ATT_THRESHOLDS.lateLoginCutoff);
  if (inMins == null || cutMins == null) return null;
  return inMins > cutMins ? inMins - cutMins : 0; // returns 0 = on-time, N minutes late otherwise
}

// Convenience wrapper — uses the CONFIGURED thresholds (from Settings). Prefer this
// in UI counting paths (dashboard tile, attendance page counts, reports) so every
// surface applies the same, Settings-driven derivation regardless of what's stored
// in `status`. Fixes BUG-06 (dashboard/report mismatch) + BUG-ATT-02 (honor config).
export function effectiveStatus(rec: AttStatusRecord): string {
  return deriveAttendanceStatus(rec, CONFIGURED_ATT_THRESHOLDS);
}

// Derive the effective attendance status. Shared by the HR Attendance module,
// Dashboard, Reports and the employee view. Precedence:
//   1. HR manual override (statusManual) always wins.
//   2. Leave / Week Off — system-managed, unchanged.
//   3. No clock-in → Absent.
//   4. Clocked in-and-out with 0 working hours → Absent.
//   5. Late-clock-in (past configured cutoff) →
//        Approved late request  → "Present"   (HR excused the lateness)
//        Rejected late request  → "Late"      (kept as Late for the record)
//        Pending late request   → "Late (Pending Review)"
//        No request raised      → "Late"
//   6. Otherwise → Present.
// The optional thresholds argument is accepted for compatibility; when omitted
// the configured (Settings-driven) cutoff is used.
export function deriveAttendanceStatus(rec: AttStatusRecord, t?: AttThresholds): string {
  const status = rec.status ?? "";
  if (rec.statusManual) return status || "Absent";          // HR override wins
  if (status === "Leave" || status === "Week Off" || status === "Incomplete" || status === "Half Day") return status; // system-managed / neutral
  const clockIn = rec.clockIn ?? "";
  const hasClockIn = !!clockIn && clockIn !== "—" && clockIn !== "" && clockIn !== "--:--";
  if (!hasClockIn) return "Absent";
  const clockOut = rec.clockOut ?? "";
  const clockedOut = !!clockOut && clockOut !== "Ongoing" && clockOut !== "—" && clockOut !== "" && clockOut !== "--:--";
  if (clockedOut && parseWorkedHours(rec) <= 0) return "Absent"; // 0 hours worked → not Present

  // Late-login handling — clockIn strictly after configured cutoff is "Late".
  // An HR-approved late-login request excuses the lateness (Present); pending
  // request surfaces as "Late (Pending Review)" so both employee and HR can see
  // the review is in flight without losing the original Late signal.
  const cutoff = (t?.lateLoginCutoff ?? CONFIGURED_ATT_THRESHOLDS.lateLoginCutoff);
  const lateMins = isLateClockIn(clockIn, cutoff);
  if (lateMins != null && lateMins > 0) {
    const req = rec.lateRequestStatus;
    if (req === "Approved") return "Present";
    if (req === "Pending")  return "Late (Pending Review)";
    return "Late";
  }

  return "Present";
}
