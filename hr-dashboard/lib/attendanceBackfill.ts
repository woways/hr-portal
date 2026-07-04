"use client";
import {
  collection, query, where, getDocs,
  writeBatch, doc, getDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// Attendance records are only created on or after this date.
// Change this if the company go-live date ever shifts.
const ATTENDANCE_START = "2026-07-01";

interface EmpInfo {
  id: string;
  name: string;
  department: string;
  reportingManager?: string;
  shift?: string;
  workMode?: string;
  doj?: string; // YYYY-MM-DD — records are only created from this date onwards
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

// Returns working dates from `minDate` up to today, skipping weekends and holidays.
function buildWorkingDates(lookbackDays: number, holidays: Set<string>, minDate?: string): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates: string[] = [];
  for (let i = 0; i <= lookbackDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekends
    const iso = d.toISOString().slice(0, 10);
    if (holidays.has(iso)) continue;       // skip holidays
    if (iso < ATTENDANCE_START) continue;  // never create records before company go-live
    if (minDate && iso < minDate) continue; // skip dates before employee joined
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
  const CHUNK = 10;
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
      // Never create records before the employee's joining date
      if (emp.doj && date < emp.doj) continue;

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
 * Writes "Absent" records for all employees for every working day they
 * were already employed (on or after their DOJ). Skips weekends and holidays.
 * Safe to call multiple times — only creates docs that don't exist yet.
 */
export async function backfillAllEmployees(
  employees: EmpInfo[],
  lookbackDays = 30,
): Promise<void> {
  if (employees.length === 0) return;

  const holidays = await loadHolidayDates();
  const today = new Date().toISOString().slice(0, 10);

  // For each employee, only backfill from their DOJ (or lookbackDays, whichever is later)
  const lookbackStart = new Date();
  lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);
  const lookbackStartStr = lookbackStart.toISOString().slice(0, 10);

  // Group employees by their effective start date to minimise Firestore reads
  // Use the employee's DOJ if it's after the lookback window, else use lookbackStart
  const startDate = employees.reduce((earliest, emp) => {
    const empStart = emp.doj && emp.doj > lookbackStartStr ? emp.doj : lookbackStartStr;
    return empStart < earliest ? empStart : earliest;
  }, today);

  const dates = buildWorkingDates(lookbackDays, holidays);
  if (dates.length === 0) return;

  const existing = await fetchExistingIds(
    employees.map((e) => e.id),
    startDate,
    today,
  );
  await commitMissing(employees, dates, existing);
}

/**
 * One-time cleanup: deletes all attendance documents whose date is before
 * ATTENDANCE_START ("2026-07-01"). Safe to call multiple times — it's a no-op
 * once no pre-July docs remain.
 */
export async function deletePreStartAttendance(): Promise<void> {
  const CHUNK = 10;
  let deleted = 0;

  // Firestore doesn't support < on a string field without a collection-group index,
  // so we query all docs and filter client-side by date string comparison.
  // We do it in employee-ID chunks to avoid huge reads.
  try {
    // Fetch all unique empIds first, then query per empId
    const allSnap = await getDocs(collection(db, "attendance"));
    const toDelete: string[] = [];
    allSnap.docs.forEach((d) => {
      const data = d.data() as { date?: string };
      if (data.date && data.date < ATTENDANCE_START) toDelete.push(d.id);
    });

    const BATCH_LIMIT = 450;
    let batch = writeBatch(db);
    let count = 0;
    for (const id of toDelete) {
      batch.delete(doc(db, "attendance", id));
      count++;
      deleted++;
      if (count >= BATCH_LIMIT) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  } catch { /* ignore — non-critical cleanup */ }
}

/**
 * Writes "Absent" records for a SINGLE employee for every working day
 * since their DOJ (or last 30 days, whichever is more recent).
 */
export async function backfillEmployee(
  emp: EmpInfo,
  lookbackDays = 30,
): Promise<void> {
  const holidays = await loadHolidayDates();

  // Only go back as far as the employee's DOJ
  const dates = buildWorkingDates(lookbackDays, holidays, emp.doj || undefined);
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
