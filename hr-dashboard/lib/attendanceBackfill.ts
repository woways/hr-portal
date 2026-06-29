"use client";
import {
  collection, query, where, getDocs,
  writeBatch, doc, getDoc,
} from "firebase/firestore";
import { db } from "./firebase";

interface EmpInfo {
  id: string;
  name: string;
  department: string;
  reportingManager?: string;
  shift?: string;
  workMode?: string;
}

function defaultLocation(workMode?: string): "Office" | "WFH" | "Client Site" {
  if (workMode === "Remote") return "WFH";
  if (workMode === "Hybrid") return "WFH";
  return "Office";
}

async function loadHolidayDates(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const snap = await getDoc(doc(db, "settings", "holidays"));
    if (snap.exists()) {
      const data = snap.data() as { list?: { date: string }[] };
      (data.list ?? []).forEach((h) => set.add(h.date.slice(0, 10)));
    }
  } catch {}
  return set;
}

function buildWorkingDates(lookbackDays: number, holidays: Set<string>): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates: string[] = [];
  for (let i = 0; i <= lookbackDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekends
    const iso = d.toISOString().slice(0, 10);
    if (holidays.has(iso)) continue; // skip holidays
    dates.push(iso);
  }
  return dates;
}

async function fetchExistingIds(
  empIds: string[],
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  const existing = new Set<string>();
  const CHUNK = 10; // Firestore "in" limit
  for (let i = 0; i < empIds.length; i += CHUNK) {
    const chunk = empIds.slice(i, i + CHUNK);
    try {
      const snap = await getDocs(
        query(
          collection(db, "attendance"),
          where("empId", "in", chunk),
          where("date", ">=", startDate),
          where("date", "<=", endDate),
        ),
      );
      snap.docs.forEach((d) => existing.add(d.id));
    } catch {}
  }
  return existing;
}

async function commitMissing(
  employees: EmpInfo[],
  dates: string[],
  existing: Set<string>,
): Promise<number> {
  let written = 0;
  const now = new Date().toISOString();
  const BATCH_LIMIT = 450;
  let batch = writeBatch(db);
  let count = 0;

  for (const date of dates) {
    for (const emp of employees) {
      const id = `${date}-${emp.id}`;
      if (existing.has(id)) continue;

      batch.set(doc(db, "attendance", id), {
        empId:         emp.id,
        name:          emp.name,
        dept:          emp.department,
        manager:       emp.reportingManager ?? "",
        location:      defaultLocation(emp.workMode),
        shift:         emp.shift ?? "9AM-6PM",
        date,
        clockIn:       "",
        clockOut:      "",
        workingHours:  "",
        overtimeHours: "-",
        status:        "Absent",
        late:          false,
        updatedAt:     now,
      });

      count++;
      written++;
      if (count >= BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
  }

  if (count > 0) await batch.commit();
  return written;
}

/**
 * Writes "Absent" attendance records for ALL employees for every working
 * day in the past `lookbackDays` where no record exists.
 * Skips weekends and holidays stored in settings/holidays.
 * Safe to call multiple times — only creates docs that don't exist yet.
 */
export async function backfillAllEmployees(
  employees: EmpInfo[],
  lookbackDays = 30,
): Promise<void> {
  if (employees.length === 0) return;

  const holidays = await loadHolidayDates();
  const dates    = buildWorkingDates(lookbackDays, holidays);
  if (dates.length === 0) return;

  const startDate = dates[dates.length - 1];
  const endDate   = dates[0];
  const existing  = await fetchExistingIds(employees.map((e) => e.id), startDate, endDate);
  await commitMissing(employees, dates, existing);
}

/**
 * Writes "Absent" attendance records for a SINGLE employee for every
 * working day in the past `lookbackDays` where no record exists.
 */
export async function backfillEmployee(
  emp: EmpInfo,
  lookbackDays = 30,
): Promise<void> {
  const holidays = await loadHolidayDates();
  const dates    = buildWorkingDates(lookbackDays, holidays);
  if (dates.length === 0) return;

  const startDate = dates[dates.length - 1];
  const endDate   = dates[0];

  const existing = new Set<string>();
  try {
    const snap = await getDocs(
      query(
        collection(db, "attendance"),
        where("empId", "==", emp.id),
        where("date", ">=", startDate),
        where("date", "<=", endDate),
      ),
    );
    snap.docs.forEach((d) => existing.add(d.id));
  } catch {}

  await commitMissing([emp], dates, existing);
}
