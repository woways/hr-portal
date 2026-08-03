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
export interface ResolvedThresholds { minHours: number; halfDayThreshold: number; }

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
export function useAttendanceThresholds(): ResolvedThresholds {
  const initial = getConfiguredThresholds();
  const [thresholds, setThresholds] = useState<ResolvedThresholds>({
    minHours: initial.minHours,
    halfDayThreshold: initial.halfDayThreshold ?? 0,
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
