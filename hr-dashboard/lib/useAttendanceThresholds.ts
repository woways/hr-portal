"use client";
import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEFAULT_ATT_THRESHOLDS,
  setConfiguredThresholds,
  getConfiguredThresholds,
} from "@/lib/attendanceStatus";

// Concrete (non-optional) thresholds returned to components so callers can use
// halfDayThreshold as a plain number without null-guards.
export interface ResolvedThresholds {
  minHours: number;
  halfDayThreshold: number;
  lateLoginCutoff: string; // "HH:MM" 24h
  clockOutCutoff: string;  // "HH:MM" 24h — Clock-Out disabled after this same-day
}

/**
 * Live attendance thresholds (BUG-ATT-02). Reads Min Working Hours (full-day
 * cutoff) and Half Day Threshold from settings/attendanceRules — the same doc
 * Settings → Attendance Rules writes — so the Half-Day / Present calculation
 * honors the configured values instead of a hardcoded 8h.
 *
 * It also pushes the values into the shared module state via
 * setConfiguredThresholds() so effectiveStatus() (used across the attendance
 * tiles, dashboard and reports) applies the SAME configured thresholds and the
 * three surfaces stay reconciled (BUG-06 / BUG-DASH-01). Returning the values as
 * component state makes the pages re-render when the settings change.
 */
const DEFAULT_LATE_CUTOFF = DEFAULT_ATT_THRESHOLDS.lateLoginCutoff || "10:30";
const DEFAULT_CO_CUTOFF   = DEFAULT_ATT_THRESHOLDS.clockOutCutoff  || "23:00";

// Accept "HH:MM" (24h) or "H:MM" — Settings' <input type="time"> already emits
// zero-padded HH:MM, but be lenient in case older docs stored the value.
function normalizeCutoff(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function useAttendanceThresholds(): ResolvedThresholds {
  const initial = getConfiguredThresholds();
  const [thresholds, setThresholds] = useState<ResolvedThresholds>({
    minHours: initial.minHours,
    halfDayThreshold: initial.halfDayThreshold ?? 0,
    lateLoginCutoff: initial.lateLoginCutoff || DEFAULT_LATE_CUTOFF,
    clockOutCutoff:  initial.clockOutCutoff  || DEFAULT_CO_CUTOFF,
  });
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "settings", "attendanceRules"),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        const mh = parseFloat(String(data.minHours));
        const hd = parseFloat(String(data.halfDayThreshold));
        const next: ResolvedThresholds = {
          minHours: isNaN(mh) ? DEFAULT_ATT_THRESHOLDS.minHours : mh,
          halfDayThreshold: isNaN(hd) ? (DEFAULT_ATT_THRESHOLDS.halfDayThreshold ?? 0) : hd,
          lateLoginCutoff: normalizeCutoff(data.lateLoginCutoff, DEFAULT_LATE_CUTOFF),
          clockOutCutoff:  normalizeCutoff(data.clockOutCutoff,  DEFAULT_CO_CUTOFF),
        };
        setConfiguredThresholds(next); // keep effectiveStatus() in sync everywhere
        setThresholds(next);
      },
      () => { /* keep defaults on error */ }
    );
    return unsub;
  }, []);
  return thresholds;
}
