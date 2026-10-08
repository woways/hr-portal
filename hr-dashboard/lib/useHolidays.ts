"use client";
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Live set of declared public-holiday dates (ISO YYYY-MM-DD) from
 * `settings/holidays.list`. Combined with the Sunday-only rule, this is the
 * source of truth for non-working days across HR + employee attendance code.
 *
 * The returned Set reference is stable across unrelated snapshots (useMemo)
 * so downstream useMemo/useEffect don't thrash — matches the perf posture of
 * the existing attendance subscriptions.
 */
export function useHolidays(): Set<string> {
  const [raw, setRaw] = useState<string[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "settings", "holidays"),
      (snap) => {
        if (!snap.exists()) { setRaw([]); return; }
        const data = snap.data() as { list?: { date?: unknown }[] };
        const dates = (data.list ?? [])
          .map((h) => String(h.date ?? "").slice(0, 10))
          .filter(Boolean);
        setRaw(dates);
      },
      () => { /* keep empty on error — fail-open to Sunday-only */ }
    );
    return () => unsub();
  }, []);
  return useMemo(() => new Set(raw), [raw]);
}

/**
 * Non-working-day predicate — Sunday or a declared holiday.
 * Saturday is a working day (6-day workweek policy).
 */
export function isNonWorkingDay(iso: string, holidaySet: Set<string>): boolean {
  if (holidaySet.has(iso)) return true;
  const d = new Date(iso + "T00:00:00");
  return d.getDay() === 0; // 0 = Sunday
}
