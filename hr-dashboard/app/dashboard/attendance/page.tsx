"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Pencil, X, Download, MapPin, Clock, TrendingUp, Users, AlertTriangle, Wifi } from "lucide-react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { getAttendance, updateAttendance, upsertAttendance, updateRegularizationStatus, markHRNotifRead } from "@/lib/firebaseService";
import { invalidateAttendance } from "@/lib/cachedService";
import { deriveAttendanceStatus, effectiveStatus } from "@/lib/attendanceStatus";
import { canonicalWorkMode } from "@/lib/enums";
import { useAttendanceThresholds } from "@/lib/useAttendanceThresholds";
import { readCache, writeCache } from "@/lib/cache";
import { SkeletonTableRows } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { collection, onSnapshot, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { backfillAllEmployees, deletePreStartAttendance } from "@/lib/attendanceBackfill";

type AttendanceStatus = "Present" | "Absent" | "Half Day" | "Leave" | "Week Off";
type WorkLocation = "Office" | "WFH" | "Client Site";

interface AttendanceRecord {
  id: string; name: string; empId: string; dept: string; manager: string;
  location: WorkLocation; shift: string; date: string;
  clockIn: string; clockOut: string; workingHours: string;
  overtimeHours: string; status: AttendanceStatus; late: boolean;
}

// No static initRecords — data loads from /api/attendance (real employees only)

const heatmapDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const PIE_COLORS = ["#4F3CC9", "#10B981", "#F59E0B", "#EF4444"];

const monthlyReport: { name: string; empId: string; dept: string; present: number; absent: number; halfDays: number; late: number; overtime: string; avgHours: string }[] = [];

const statusColor: Record<AttendanceStatus, string> = {
  Present: "bg-green-100 text-green-700",
  Absent: "bg-red-100 text-red-700",
  "Half Day": "bg-yellow-100 text-yellow-700",
  Leave: "bg-purple-100 text-purple-700",
  "Week Off": "bg-gray-100 text-gray-600",
};

function heatColor(pct: number) {
  if (pct >= 95) return "bg-green-600 text-white";
  if (pct >= 90) return "bg-green-400 text-white";
  if (pct >= 85) return "bg-green-200 text-green-900";
  if (pct >= 80) return "bg-yellow-200 text-yellow-900";
  return "bg-red-200 text-red-900";
}

const blankCorrection = { name: "", date: "", clockIn: "", clockOut: "", status: "Present" as AttendanceStatus, reason: "" };

interface RegRequest {
  id: string;
  date: string;
  day: string;
  reason: string;
  actualArrival: string;
  status: "Pending" | "Approved" | "Rejected";
  hrComment?: string;
  empName?: string;
  empId?: string;
}


const TODAY = new Date().toISOString().slice(0, 10);

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  // Configured Late Login Threshold (HH:MM, 24h) from Settings → Work Timings.
  const [lateThreshold, setLateThreshold] = useState("09:30");
  // Min full-day hours and half-day threshold from Settings → Attendance Rules,
  // via the shared reactive hook so the Half-Day / Present calculation honors the
  // configured values AND every surface (tiles, dashboard, reports) stays in sync
  // through effectiveStatus() (BUG-ATT-02).
  const { minHours, halfDayThreshold } = useAttendanceThresholds();
  // Standard hours beyond which extra time counts as Overtime (ATT-009). Default 9.
  const [overtimeThreshold, setOvertimeThreshold] = useState(9);

  useEffect(() => {
    getDoc(doc(db, "settings", "workTimings"))
      .then((snap) => { if (snap.exists()) { const t = snap.data().lateThreshold as string; if (t) setLateThreshold(t); } })
      .catch(() => { /* keep default */ });
    getDoc(doc(db, "settings", "attendanceRules"))
      .then((snap) => {
        if (!snap.exists()) return;
        const ot = parseFloat((snap.data().overtimeThreshold ?? snap.data().standardHours) as string);
        if (!isNaN(ot)) setOvertimeThreshold(ot);
      })
      .catch(() => { /* keep defaults */ });
  }, []);
  // Keyed by empId → WorkLocation derived from employee's workMode
  const empWorkLocRef = useRef<Map<string, WorkLocation>>(new Map());
  const backfillDoneRef = useRef(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedEmpId, setHighlightedEmpId] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [shiftFilter, setShiftFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState(TODAY);
  const [dateTo, setDateTo] = useState(TODAY);
  const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
  const [correction, setCorrection] = useState({ ...blankCorrection });
  const [month, setMonth] = useState(() => new Date().toLocaleString("en-IN", { month: "long", year: "numeric" }));
  const [regRequests, setRegRequests] = useState<RegRequest[]>([]);
  const [hrComment, setHrComment] = useState<Record<string, string>>({});
  const [clearedReviewedIds, setClearedReviewedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("hr_att_reviewed_cleared") ?? "[]")); }
    catch { return new Set(); }
  });
  const [regToast, setRegToast] = useState<string | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [monthlyAttendance, setMonthlyAttendance] = useState<AttendanceRecord[]>([]);

  // Auto-mark all unread attendance notifications as read when HR opens this page
  useEffect(() => { const t = setTimeout(() => markHRNotifRead("attendance"), 10000); return () => clearTimeout(t); }, []);

  // Close autocomplete dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Load ALL employees + today's attendance and merge ─────────────────────
  // Work-location attribution derived from the employee's ACTUAL configured Work
  // Mode (BUG-ATT-01) — canonicalized first so "On-site"/"Office", "Remote"/"WFH"
  // and casing variants all resolve correctly. Only genuine remote/hybrid modes
  // count as WFH; On-site (office) employees are never defaulted to WFH.
  function defaultLocation(workMode: string): WorkLocation {
    const wm = canonicalWorkMode(workMode);
    if (wm === "Remote" || wm === "Hybrid") return "WFH";
    return "Office"; // On-site / office / anything else
  }

  const loadAttendance = useCallback(async () => {
    try {
      // ── Load employees + today's attendance IN PARALLEL ──
      const [empSnap, rawAtt] = await Promise.all([
        getDocs(collection(db, "employees")).catch(() => null),
        getAttendance(TODAY).catch(() => []),
      ]);

      const empDocs: Record<string, unknown>[] = empSnap
        ? empSnap.docs.map((d) => ({ ...d.data(), id: d.id }))
        : [];

      const empList = empDocs.map((d) => ({
        id:               String(d.employeeId ?? d.id ?? ""),
        name:             String(d.name ?? ""),
        department:       String(d.department ?? ""),
        reportingManager: String(d.reportingManager ?? ""),
        shift:            String(d.shift ?? "9AM-6PM"),
        workMode:         String(d.workMode ?? "Office"),
        doj:              String(d.doj ?? ""),
      })).filter((e) => e.id && (!e.doj || e.doj <= TODAY)); // only employees who have joined by today

      // Compute dept headcount from already-loaded employees — no extra Firestore call
      const deptMap: Record<string, number> = {};
      empDocs.forEach((e) => {
        const d = String(e.department ?? "Other");
        deptMap[d] = (deptMap[d] ?? 0) + 1;
      });
      setDeptCount(Object.entries(deptMap).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count));

      const attList: Record<string, unknown>[] = (rawAtt ?? []) as Record<string, unknown>[];

      // Populate work-location ref for syncClockData
      const locMap = new Map<string, WorkLocation>();
      empList.forEach((e) => locMap.set(e.id, defaultLocation(e.workMode)));
      empWorkLocRef.current = locMap;

      // Build attMap keyed by empId
      const attMap = new Map<string, AttendanceRecord>();
      attList.forEach((a) => {
        if (a.empId) attMap.set(String(a.empId), a as unknown as AttendanceRecord);
      });

      // Merge: every employee gets a record (existing or default Absent)
      const merged: AttendanceRecord[] = empList.map((emp) => {
        const empLoc = defaultLocation(emp.workMode);
        const existing = attMap.get(emp.id);
        if (existing) {
          // BUG-ATT-01: attribute the record to the employee's ACTUAL configured
          // Work Mode, not a stale/defaulted `location` on the stored doc. The
          // employee clock-in writes no location, and old backfills may have written
          // a location from a since-changed workMode — so a stored WFH/Office value
          // must never override the current workMode. Only a genuinely-distinct
          // "Client Site" (which can't be derived from workMode) is preserved.
          const stored = existing.location as string | undefined;
          return {
            ...existing,
            location: (stored === "Client Site" ? "Client Site" : empLoc) as WorkLocation,
          };
        }
        return {
          id:            `${TODAY}-${emp.id}`,
          empId:         emp.id,
          name:          emp.name,
          dept:          emp.department,
          manager:       emp.reportingManager,
          location:      empLoc,
          shift:         emp.shift,
          date:          TODAY,
          clockIn:       "",
          clockOut:      "",
          workingHours:  "",
          overtimeHours: "-",
          status:        "Absent" as AttendanceStatus,
          late:          false,
        };
      });

      setRecords(merged);
      writeCache(`hr_att_records_${TODAY}`, merged);
      setLoadingRecords(false);

      if (!backfillDoneRef.current && empList.length > 0) {
        backfillDoneRef.current = true;
        // Clean up any pre-July records already in Firestore, then backfill from July 1st onwards
        deletePreStartAttendance()
          .then(() => backfillAllEmployees(empList))
          .catch(() => {});
      }
    } catch (e) {
      setLoadingRecords(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Seed from cache so the attendance table renders instantly, then refresh
    const cached = readCache<AttendanceRecord[]>(`hr_att_records_${TODAY}`);
    if (cached && cached.length) {
      setRecords(cached);
      setLoadingRecords(false);
    }
    loadAttendance(); // single initial load — real-time clock updates handled by onSnapshot below
  }, [loadAttendance]);

  // ── Live clock polling — merges real employee clock-in/out into HR records ─
  interface ClockRecord { empId: string; empName: string; department?: string; date: string; clockInTs: number; clockInStr: string; clockOutStr?: string; totalSeconds?: number; status: "clocked-in" | "clocked-out"; isLate: boolean; }

  function fmtHours(secs: number) {
    if (!secs) return "—";
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  // Compute "Xh Ym" from two clock strings (accepts both "hh:mm AM/PM" and 24h "HH:MM").
  function computeHours(clockIn: string, clockOut: string): string {
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
    if (diff < 0) diff += 24 * 60; // handle overnight
    return `${Math.floor(diff / 60)}h ${String(diff % 60).padStart(2, "0")}m`;
  }

  // Re-derive "late" from the record's clock-in vs the CURRENT configured threshold,
  // so changing the Late Login Threshold in Settings immediately affects the status
  // (the stored `late` flag was frozen at clock-in time).
  function lateByThreshold(r: AttendanceRecord): boolean {
    const ci = r.clockIn;
    if (!ci || ci === "—" || ci === "" || ci === "Ongoing") return false; // no clock-in → not late
    if (r.date) { const dow = new Date(r.date + "T00:00:00").getDay(); if (dow === 0 || dow === 6) return false; }
    const m = ci.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return false;
    let h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
    if (m[3]) { if (/PM/i.test(m[3]) && h !== 12) h += 12; if (/AM/i.test(m[3]) && h === 12) h = 0; }
    const [thH, thM] = lateThreshold.split(":").map(Number);
    return (h * 60 + min) > ((thH || 0) * 60 + (thM || 0));
  }

  function applyClockRecords(todayClocks: ClockRecord[]) {
    if (todayClocks.length === 0) return;

    const clocked = todayClocks.find((c) => c.status === "clocked-in");
    if (clocked) setLiveSeconds(Math.floor((Date.now() - clocked.clockInTs) / 1000));

    setRecords((prev) => {
      const updated = prev.map((rec) => {
        const clock = todayClocks.find((c) => c.empId === rec.empId);
        if (!clock) return rec;
        const secs = clock.status === "clocked-in"
          ? Math.floor((Date.now() - clock.clockInTs) / 1000)
          : (clock.totalSeconds ?? 0);
        return {
          ...rec,
          clockIn:      clock.clockInStr,
          clockOut:     clock.clockOutStr ?? (clock.status === "clocked-in" ? "Ongoing" : "—"),
          workingHours: fmtHours(secs),
          status:       "Present" as const,
          late:         clock.isLate,
        };
      });

      const existingIds = new Set(prev.map((r) => r.empId));
      const newRecs: AttendanceRecord[] = todayClocks
        .filter((c) => !existingIds.has(c.empId))
        .map((c) => {
          const secs = c.status === "clocked-in"
            ? Math.floor((Date.now() - c.clockInTs) / 1000)
            : (c.totalSeconds ?? 0);
          return {
            id:            `${TODAY}-${c.empId}`,
            empId:         c.empId,
            name:          c.empName,
            dept:          c.department ?? "",
            manager:       "",
            location:      (empWorkLocRef.current.get(c.empId) ?? "Office") as WorkLocation,
            shift:         "9AM-6PM",
            date:          TODAY,
            clockIn:       c.clockInStr,
            clockOut:      c.clockOutStr ?? (c.status === "clocked-in" ? "Ongoing" : "—"),
            workingHours:  fmtHours(secs),
            overtimeHours: "-",
            status:        "Present" as const,
            late:          c.isLate,
          };
        });

      return [...updated, ...newRecs];
    });
  }

  useEffect(() => {
    // onSnapshot fires immediately on mount with current data, then again on every change —
    // processes snapshot docs directly, no extra getAllClockRecords Firestore read needed
    const q = query(collection(db, "clockRecords"), where("date", "==", TODAY));
    const unsub = onSnapshot(q, (snap) => {
      applyClockRecords(snap.docs.map(d => d.data() as ClockRecord));
    }, () => {});
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also tick live working hours every second for clocked-in employees
  useEffect(() => {
    const t = setInterval(() => setLiveSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Department Headcount — populated inside loadAttendance from already-loaded employees ──
  const [deptCount, setDeptCount] = useState<{ dept: string; count: number }[]>([]);

  // ── 6-month attendance history for Absenteeism Trends ────────────────────
  const [historyRecords, setHistoryRecords] = useState<(AttendanceRecord & { _month: string })[]>([]);

  useEffect(() => {
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      months.push(`${yyyy}-${mm}`);
    }
    // Fetch one representative date per month (1st of each month) — client-side Firestore (authenticated HR admin)
    Promise.all(
      months.map((ym) =>
        getAttendance(`${ym}-01`)
          .then((docs) => (docs as Record<string, unknown>[]).map((rec) => ({ ...rec, _month: ym })))
          .catch(() => [])
      )
    ).then((results) => setHistoryRecords(results.flat() as (AttendanceRecord & { _month: string })[]));
  }, []);

  // Load all attendance records for the selected month (for Monthly Report tab)
  useEffect(() => {
    const parts = month.split(" ");
    if (parts.length < 2) return;
    const monthName = parts[0];
    const year = parts[parts.length - 1];
    const monthIdx = ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(monthName);
    if (monthIdx < 0) return;
    const yyyy = parseInt(year);
    const mm = String(monthIdx + 1).padStart(2, "0");
    const startDate = `${yyyy}-${mm}-01`;
    const endDay = new Date(yyyy, monthIdx + 1, 0).getDate();
    const endDate = `${yyyy}-${mm}-${String(endDay).padStart(2, "0")}`;

    import("firebase/firestore").then(({ getDocs, query: q2, collection: col, where: wh }) =>
      getDocs(q2(col(db, "attendance"), wh("date", ">=", startDate), wh("date", "<=", endDate)))
        .then((snap) => {
          const docs = snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
          setMonthlyAttendance(docs as unknown as AttendanceRecord[]);
        })
        .catch(() => {})
    ).catch(() => {});
  }, [month]);

  // Compute 6-month absenteeism trend from history + today
  const absenteeismTrend = (() => {
    const allRecs: (AttendanceRecord & { _month: string })[] = [
      ...historyRecords,
      ...records.map((r) => ({ ...r, _month: TODAY.slice(0, 7) })),
    ];
    const byMonth: Record<string, { absent: number; late: number }> = {};
    for (const rec of allRecs) {
      const m = rec._month ?? rec.date?.slice(0, 7) ?? "";
      if (!m) continue;
      if (!byMonth[m]) byMonth[m] = { absent: 0, late: 0 };
      if (effectiveStatus(rec) === "Absent") byMonth[m].absent++; // BUG-06
      if (rec.late) byMonth[m].late++;
    }
    return Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([ym, v]) => {
      const [y, mo] = ym.split("-");
      const label = new Date(Number(y), Number(mo) - 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
      return { month: label, absent: v.absent, late: v.late };
    });
  })();

  const avgAbsent = absenteeismTrend.length
    ? (absenteeismTrend.reduce((s, m) => s + m.absent, 0) / absenteeismTrend.length).toFixed(1)
    : "0.0";
  const avgLate = absenteeismTrend.length
    ? (absenteeismTrend.reduce((s, m) => s + m.late, 0) / absenteeismTrend.length).toFixed(1)
    : "0.0";
  const allForRate = [...historyRecords, ...records];
  const totalEmployeeDays = allForRate.length || 1;
  const totalAbsent = allForRate.filter((r) => effectiveStatus(r) === "Absent").length; // BUG-06
  const absenteeismRate = ((totalAbsent / totalEmployeeDays) * 100).toFixed(1);

  // Compute OT from today's records — parse "Xh Ym" or numeric strings
  function parseOTHours(s: string): number {
    if (!s || s === "-" || s === "—") return 0;
    const hm = s.match(/(\d+)h\s*(\d*)m?/);
    if (hm) return Number(hm[1]) + Number(hm[2] || 0) / 60;
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }

  // Compute Monthly Report from real Firestore data (monthlyAttendance)
  const computedMonthlyReport = (() => {
    const byEmp: Record<string, { name: string; empId: string; dept: string; present: number; absent: number; halfDays: number; late: number; totalSecs: number; dayCount: number }> = {};
    const allRecs = [...monthlyAttendance, ...records.filter(r => r.date === TODAY)];
    for (const r of allRecs) {
      if (!r.empId) continue;
      if (!byEmp[r.empId]) byEmp[r.empId] = { name: r.name, empId: r.empId, dept: r.dept, present: 0, absent: 0, halfDays: 0, late: 0, totalSecs: 0, dayCount: 0 };
      const e = byEmp[r.empId];
      const eff = effectiveStatus(r); // BUG-06
      if (eff === "Present") e.present++;
      if (eff === "Absent") e.absent++;
      if (eff === "Half Day") { e.halfDays++; e.present++; }
      if (r.late) e.late++;
      const secs = parseOTHours(r.workingHours) * 3600;
      if (secs > 0) { e.totalSecs += secs; e.dayCount++; }
    }
    return Object.values(byEmp).sort((a, b) => a.name.localeCompare(b.name)).map(e => ({
      name: e.name, empId: e.empId, dept: e.dept,
      present: e.present, absent: e.absent, halfDays: e.halfDays, late: e.late,
      overtime: e.present > 0 && (e.totalSecs / e.present) > 32400 ? `${((e.totalSecs / e.present - 32400) / 3600).toFixed(1)}h` : "0h",
      avgHours: e.dayCount > 0 ? `${Math.floor(e.totalSecs / e.dayCount / 3600)}h ${String(Math.floor((e.totalSecs / e.dayCount % 3600) / 60)).padStart(2,"0")}m` : "—",
    }));
  })();

  // Compute Late Tracker from history + today
  const computedLateTracker = (() => {
    const byEmp: Record<string, { name: string; empId: string; lateDays: number; totalDelayMins: number }> = {};
    const allRecs = [...historyRecords, ...records];
    for (const r of allRecs) {
      if (!r.late || !r.empId) continue;
      if (!byEmp[r.empId]) byEmp[r.empId] = { name: r.name, empId: r.empId, lateDays: 0, totalDelayMins: 0 };
      byEmp[r.empId].lateDays++;
      // Estimate delay from clockIn vs 09:00
      if (r.clockIn && r.clockIn !== "—") {
        const parts = r.clockIn.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (parts) {
          let h = parseInt(parts[1]); const m = parseInt(parts[2]);
          if (parts[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (parts[3].toUpperCase() === "AM" && h === 12) h = 0;
          const delayMins = Math.max(0, h * 60 + m - 9 * 60);
          byEmp[r.empId].totalDelayMins += delayMins;
        }
      }
    }
    return Object.values(byEmp).sort((a, b) => b.lateDays - a.lateDays).slice(0, 10).map(e => ({
      name: e.name, empId: e.empId, lateDays: e.lateDays,
      avgDelay: e.lateDays > 0 ? `${Math.round(e.totalDelayMins / e.lateDays)}m` : "0m",
    }));
  })();

  // Compute heatmap from monthlyAttendance (% present per weekday per week)
  const computedHeatmap = (() => {
    const dayMap: Record<string, { present: number; total: number }> = {};
    for (const r of [...monthlyAttendance, ...records.filter(r2 => r2.date === TODAY)]) {
      if (!dayMap[r.date]) dayMap[r.date] = { present: 0, total: 0 };
      dayMap[r.date].total++;
      { const eff = effectiveStatus(r); if (eff === "Present" || eff === "Half Day") dayMap[r.date].present++; } // BUG-06
    }
    const weekMap = new Map<string, (number | null)[]>();
    for (const date of Object.keys(dayMap).sort()) {
      const d = new Date(date + "T00:00:00");
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const mon = new Date(d);
      mon.setDate(d.getDate() - (dow - 1));
      const wk = `${String(mon.getDate()).padStart(2,"0")}/${String(mon.getMonth()+1).padStart(2,"0")}`;
      if (!weekMap.has(wk)) weekMap.set(wk, [null,null,null,null,null]);
      const row = weekMap.get(wk)!;
      const { present, total } = dayMap[date];
      row[dow - 1] = total > 0 ? Math.round((present / total) * 100) : 0;
    }
    const weeks = Array.from(weekMap.keys());
    const data = weeks.map(w => weekMap.get(w)!.map(v => v ?? 0));
    return { data, weeks };
  })();

  // Compute shift compliance by department from today's records
  const computedShiftCompliance = (() => {
    const byDept: Record<string, { onTime: number; total: number }> = {};
    for (const r of records) {
      const dept = r.dept || "Unknown";
      if (!byDept[dept]) byDept[dept] = { onTime: 0, total: 0 };
      byDept[dept].total++;
      { const eff = effectiveStatus(r); if ((eff === "Present" || eff === "Half Day") && !lateByThreshold(r)) byDept[dept].onTime++; } // BUG-06
    }
    return Object.entries(byDept)
      .map(([dept, { onTime, total }]) => ({ dept, compliance: total > 0 ? Math.round((onTime / total) * 100) : 0 }))
      .sort((a, b) => b.compliance - a.compliance);
  })();

  // Derive unique managers from loaded records
  const managerOptions = ["All", ...Array.from(new Set(records.map(r => r.manager).filter(Boolean))).sort()];

  // Real-time regularization requests — onSnapshot (authenticated HR admin client)
  useEffect(() => {
    const q = query(collection(db, "regularization"));
    const unsub = onSnapshot(q, (snap) => {
      setRegRequests(snap.docs.map((d) => {
        const r = d.data() as Record<string, unknown>;
        return {
          id:            d.id,
          empId:         String(r.empId        ?? ""),
          empName:       String(r.empName       ?? ""),
          date:          String(r.date          ?? ""),
          day:           String(r.day           ?? ""),
          reason:        String(r.reason        ?? ""),
          actualArrival: String(r.actualArrival ?? ""),
          status:        (String(r.status       ?? "Pending")) as "Pending" | "Approved" | "Rejected",
          hrComment:     String(r.hrComment     ?? ""),
        };
      }));
    }, () => {});
    return () => unsub();
  }, []);

  async function actionRequest(id: string, action: "Approved" | "Rejected") {
    const req = regRequests.find((r) => r.id === id);
    const comment = hrComment[id] ?? "";
    const payload = { id, status: action, hrComment: comment };

    // Optimistic update
    setRegRequests((prev) => prev.map((r) => r.id === id ? { ...r, ...payload } : r));

    // Update in Firestore so employee app picks it up on next poll
    try {
      await updateRegularizationStatus(id, action, comment);
    } catch {}

    // Clear the HR_PORTAL badge for this attendance notification
    if (req) {
      markHRNotifRead("attendance", req.empId, (msg) => msg.includes(req.empName ?? "") && msg.includes(req.date ?? ""));
    }

    // If approved, update the HR attendance log in real time
    if (action === "Approved" && req) {
      setRecords((prev) =>
        prev.map((r) => {
          if (r.date === req.date && (r.empId === req.empId || r.name === req.empName)) {
            const [h, m] = req.actualArrival.split(":").map(Number);
            const suffix = h >= 12 ? "PM" : "AM";
            const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
            const clockInFormatted = `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
            return { ...r, status: "Present" as const, clockIn: clockInFormatted, late: true };
          }
          return r;
        })
      );
    }

    setRegToast(`Request ${action === "Approved" ? "approved ✓" : "rejected ✗"} — ${req?.empName}`);
    setTimeout(() => setRegToast(null), 3500);
  }

  // Worked hours (as a decimal) from stored workingHours, or computed from clock times.
  function workedHrs(r: AttendanceRecord): number {
    const wh = r.workingHours || computeHours(r.clockIn, r.clockOut);
    const m = wh.match(/(\d+)\s*h\s*(\d+)?\s*m?/i);
    return m ? Number(m[1]) + Number(m[2] || 0) / 60 : 0;
  }

  // Overtime = worked hours beyond the standard threshold (ATT-009). Returns a
  // "Xh YYm" string, or "-" when there's no overtime. Rounds to whole minutes.
  function overtimeFor(r: AttendanceRecord): string {
    const otMins = Math.round((workedHrs(r) - overtimeThreshold) * 60);
    if (otMins <= 0) return "-";
    return `${Math.floor(otMins / 60)}h ${String(otMins % 60).padStart(2, "0")}m`;
  }

  // Re-derive the displayed status from hours worked vs the configured thresholds so
  // it's always consistent with the half-day rule (not a stale/default/manually-set
  // value). A record with a real clock-in is never "Absent" (ATT-008); Leave / Week
  // Off are left untouched.
  const normalizedRecords = records.map((r) => {
    // Derive status via the shared helper so the Attendance dashboard and the
    // Reports module always agree on Present/Half Day/Absent (BUG-06 / ATT-003).
    const derived = deriveAttendanceStatus(r, { minHours, halfDayThreshold }) as AttendanceStatus;
    // Derive overtime from hours worked beyond the standard threshold (ATT-009).
    const overtimeHours = overtimeFor(r);
    if (derived === r.status && overtimeHours === r.overtimeHours) return r;
    return { ...r, status: derived, overtimeHours };
  });

  // OT aggregates run off the normalized records so they reflect the computed
  // overtime (ATT-009), not the raw "-" placeholders on the stored records.
  const totalOTHours = normalizedRecords.reduce((sum, r) => sum + parseOTHours(r.overtimeHours), 0);
  const totalOTDisplay = totalOTHours > 0 ? `${totalOTHours.toFixed(1)}h` : "0h";

  // Per-employee OT for the bar chart.
  const computedOvertimeData = normalizedRecords
    .map((r) => ({ name: r.name, hours: parseOTHours(r.overtimeHours) }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8);

  const filtered = normalizedRecords.filter((r) => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.empId.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || r.status === statusFilter;
    const matchManager = managerFilter === "All" || r.manager === managerFilter;
    const matchLocation = locationFilter === "All" || r.location === locationFilter;
    return matchSearch && matchStatus && matchManager && matchLocation;
  });

  // Overview summary must reflect the full day's records — NOT the search/status/
  // manager/location filters that only apply to the Daily Attendance log. Scoping to
  // today (and ignoring UI filters) keeps these counts reconciled with the records.
  // "Actually worked from home" = clocked in at a WFH location, regardless of whether
  // the day ended up Present/Half Day/Late. Used by the WFH tile and the charts so
  // they all reconcile against the same underlying records (ATT-010).
  const clocedIn = (r: AttendanceRecord) => !!(r.clockIn && r.clockIn !== "" && r.clockIn !== "—");
  const summaryRecords = normalizedRecords.filter(r => r.date === TODAY);
  // BUG-06: derive effective status so the tiles align with the Reports module.
  const summaryDerived = summaryRecords.map(r => ({ r, eff: effectiveStatus(r) }));
  const presentCount = summaryDerived.filter(x => x.eff === "Present").length;
  const absentCount = summaryDerived.filter(x => x.eff === "Absent").length;
  const lateCount = summaryRecords.filter(r => lateByThreshold(r)).length;
  const halfDayCount = summaryDerived.filter(x => x.eff === "Half Day").length;
  // Count every WFH employee who clocked in today — not just those whose status is
  // Present — so the tile doesn't undercount Half Day / Late remote workers (ATT-010).
  const wfhCount = summaryRecords.filter(r => r.location === "WFH" && clocedIn(r)).length;
  const overtimeCount = summaryRecords.filter(r => r.overtimeHours !== "-").length;

  // WFH distribution — count only employees who actually clocked in, by their location
  const wfhPieData = [
    { name: "Office",      value: records.filter(r => clocedIn(r) && r.location === "Office").length },
    { name: "WFH",         value: records.filter(r => clocedIn(r) && r.location === "WFH").length },
    { name: "Client Site", value: records.filter(r => clocedIn(r) && r.location === "Client Site").length },
  ];

  // Geo data derived from real records
  const total = records.length || 1;
  const geoData = [
    { location: "Office",        count: records.filter(r => clocedIn(r) && r.location === "Office").length,      pct: Math.round(records.filter(r => clocedIn(r) && r.location === "Office").length / total * 100) },
    { location: "WFH",           count: records.filter(r => clocedIn(r) && r.location === "WFH").length,         pct: Math.round(records.filter(r => clocedIn(r) && r.location === "WFH").length / total * 100) },
    { location: "Client Site",   count: records.filter(r => clocedIn(r) && r.location === "Client Site").length, pct: Math.round(records.filter(r => clocedIn(r) && r.location === "Client Site").length / total * 100) },
    { location: "Not Logged In", count: records.filter(r => !clocedIn(r) && r.status !== "Leave").length,        pct: Math.round(records.filter(r => !clocedIn(r) && r.status !== "Leave").length / total * 100) },
  ];

  function to24h(t: string): string {
    if (!t || t === "—") return "";
    // Already HH:MM (24h)
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return "";
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    const isPM = /PM/i.test(m[3]);
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  function openEdit(r: AttendanceRecord) {
    setEditRecord(r);
    setCorrection({ name: r.name, date: r.date, clockIn: to24h(r.clockIn), clockOut: to24h(r.clockOut), status: r.status, reason: "" });
  }

  async function saveCorrection() {
    if (!editRecord) return;
    // Preserve existing clock times if HR didn't enter new ones
    const ciStr = correction.clockIn  || editRecord.clockIn  || "";
    const coStr = correction.clockOut || editRecord.clockOut || "";
    const isLate = (() => {
      if (editRecord.date) {
        const dayOfWeek = new Date(editRecord.date + "T00:00:00").getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) return false; // no late on weekends
      }
      const t = ciStr.replace(/\s*(AM|PM)/i, "");
      const [h, m] = t.split(":").map(Number);
      if (isNaN(h)) return false;
      const hr24 = /PM/i.test(ciStr) && h !== 12 ? h + 12 : (/AM/i.test(ciStr) && h === 12 ? 0 : h);
      // Compare against the configured Late Login Threshold (e.g. "09:30").
      const [thH, thM] = lateThreshold.split(":").map(Number);
      const clockMins = hr24 * 60 + (m ?? 0);
      const thresholdMins = (thH || 0) * 60 + (thM || 0);
      return clockMins > thresholdMins;
    })();
    const computedHours = computeHours(ciStr, coStr);
    const updated = { ...editRecord, clockIn: ciStr, clockOut: coStr, status: correction.status, late: isLate, workingHours: computedHours || editRecord.workingHours };
    setRecords(records.map((r) => r.id === editRecord.id ? updated : r));
    setEditRecord(null);
    try {
      const { id: attId, ...rest } = updated;
      // upsertAttendance (setDoc merge:true) creates the doc if it doesn't exist yet,
      // which happens when HR marks a default in-memory "Absent" record as Present.
      await upsertAttendance(attId, rest as Record<string, unknown>);
      invalidateAttendance();
    } catch {}
  }

  const inputCls = "px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] bg-white";

  function exportAttendanceExcel(rows: AttendanceRecord[], filename: string) {
    const today = new Date().toISOString().slice(0, 10);
    const data = rows.map((r) => ({
      "Emp ID":          r.empId,
      "Name":            r.name,
      "Department":      r.dept,
      "Manager":         r.manager,
      "Date":            r.date,
      "Shift":           r.shift,
      "Work Mode":       r.location,
      "Clock In":        r.clockIn  || "-",
      "Clock Out":       r.clockOut || "-",
      "Working Hours":   r.workingHours,
      "Overtime Hours":  r.overtimeHours,
      "Status":          r.status,
      "Late":            lateByThreshold(r) ? "Yes" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 8 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 6 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `${filename}_${today}.xlsx`);
  }

  const TABS = ["Overview", "Attendance Requests", "Daily Attendance", "Monthly Report"] as const;
  type Tab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  function selectEmployee(empId: string, name: string) {
    setSearch(name);
    setShowSuggestions(false);
    setActiveTab("Daily Attendance");
    setHighlightedEmpId(empId);
    // Scroll to the row after the tab renders
    setTimeout(() => {
      const row = rowRefs.current.get(empId);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    // Clear highlight after 3 seconds
    setTimeout(() => setHighlightedEmpId(null), 3200);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance & Workforce Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Operational visibility across teams, locations and shifts</p>
          {/* Make the active status rule explicit so the cutoff in force is never
              ambiguous (ATT-003) — values come live from Settings → Attendance Rules. */}
          <p className="text-xs text-gray-400 mt-1">
            Status rule: Present ≥ {minHours}h worked · Half Day = {halfDayThreshold > 0 ? `${halfDayThreshold}h to under ${minHours}h` : `any work under ${minHours}h`} · Absent = {halfDayThreshold > 0 ? `no clock-in or under ${halfDayThreshold}h` : "no clock-in"} · thresholds configurable in Settings → Attendance Rules
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => exportAttendanceExcel(filtered, "attendance")}
            className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Filters</p>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Manager</label>
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className={inputCls}>
              {managerOptions.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Work Mode</label>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className={inputCls}>
              {["All","Office","WFH","Client Site"].map(l => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Shift</label>
            <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} className={inputCls}>
              {["All","9AM-6PM","10AM-7PM","Night Shift"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
              {["All","Present","Absent","Half Day","Leave","Week Off"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1" ref={searchContainerRef}>
            <label className="text-xs text-gray-400">Search</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="Employee / ID"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const q = search.toLowerCase();
                    const match = records.find(r => r.name.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q));
                    if (match) selectEmployee(match.empId, match.name);
                    else setShowSuggestions(false);
                  }
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
                className={`${inputCls} pl-8 w-52`}
              />
              {search && (
                <button onClick={() => { setSearch(""); setShowSuggestions(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={12} />
                </button>
              )}
              {showSuggestions && search.trim().length > 0 && (() => {
                const q = search.toLowerCase();
                const suggestions = records.filter(r =>
                  r.name.toLowerCase().includes(q) || r.empId.toLowerCase().includes(q)
                ).slice(0, 8);
                if (suggestions.length === 0) return null;
                return (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                    {suggestions.map(r => (
                      <button
                        key={r.empId}
                        onMouseDown={(e) => { e.preventDefault(); selectEmployee(r.empId, r.name); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#F5F3FF] text-left transition-colors"
                      >
                        <div className="w-7 h-7 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center text-xs font-bold shrink-0">
                          {r.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.empId} · {r.dept}</p>
                        </div>
                        {(() => { const eff = effectiveStatus(r); return (
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                          eff === "Present" ? "bg-green-100 text-green-700" :
                          eff === "Absent"  ? "bg-red-100 text-red-600"   :
                          "bg-gray-100 text-gray-500"
                        }`}>{eff}</span>
                        ); })()}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Live data label */}
      {!loadingRecords && <p className="text-xs text-gray-400 -mt-2">Showing today&apos;s attendance for {records.length} active employees · auto-refreshes every 10s</p>}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Present",   val: presentCount,  icon: <Users size={16}/>,         bg: "bg-green-50",   text: "text-green-700"  },
          { label: "Absent",    val: absentCount,   icon: <AlertTriangle size={16}/>,  bg: "bg-red-50",     text: "text-red-700"    },
          { label: "Late",      val: lateCount,     icon: <Clock size={16}/>,          bg: "bg-orange-50",  text: "text-orange-700" },
          { label: "Half Day",  val: halfDayCount,  icon: <TrendingUp size={16}/>,     bg: "bg-yellow-50",  text: "text-yellow-700" },
          { label: "WFH",       val: wfhCount,      icon: <Wifi size={16}/>,           bg: "bg-blue-50",    text: "text-blue-700"   },
          { label: "Overtime",  val: overtimeCount, icon: <Clock size={16}/>,          bg: "bg-purple-50",  text: "text-purple-700" },
        ].map((c) => (
          <div key={c.label} className={`${c.bg} rounded-2xl p-4 flex items-center gap-3`}>
            <div className={`${c.text} opacity-70`}>{c.icon}</div>
            <div>
              <p className={`text-xl font-bold ${c.text}`}>{c.val}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tab Bar ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100">
          {TABS.map((tab) => {
            const pendingCount = tab === "Attendance Requests"
              ? regRequests.filter((r) => r.status === "Pending").length
              : 0;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap flex items-center gap-2 ${
                  activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
                {pendingCount > 0 && (
                  <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Overview ── */}
        {activeTab === "Overview" && (
          <div className="p-6 space-y-6">

      {/* ── Row 1: Heatmap + WFH vs Office ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Attendance Heatmap */}
        <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Daily Attendance Heatmap</h2>
            <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">{month}</span>
          </div>

          {/* Today's quick stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Present",  val: presentCount,  cls: "bg-green-50  text-green-700"  },
              { label: "Absent",   val: absentCount,   cls: "bg-red-50    text-red-700"    },
              { label: "Late",     val: lateCount,     cls: "bg-orange-50 text-orange-700" },
              { label: "On Leave", val: filtered.filter(r => r.status === "Leave").length, cls: "bg-purple-50 text-purple-700" },
            ].map(s => (
              <div key={s.label} className={`rounded-xl p-2 text-center ${s.cls}`}>
                <p className="text-lg font-bold">{s.val}</p>
                <p className="text-[10px] font-medium opacity-80">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="py-1 pr-3 text-left text-gray-400 font-normal w-16"></th>
                  {heatmapDays.map(d => <th key={d} className="py-1 px-2 text-center text-gray-500 font-medium">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {computedHeatmap.data.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-xs text-gray-400">No attendance data for selected month yet.</td></tr>
                )}
                {computedHeatmap.data.map((row, wi) => (
                  <tr key={wi}>
                    <td className="py-1 pr-3 text-gray-400 text-xs">{computedHeatmap.weeks[wi]}</td>
                    {row.map((pct, di) => (
                      <td key={di} className="py-1 px-1">
                        <div className={`rounded-lg py-2 text-center font-semibold text-xs cursor-default ${heatColor(pct)}`} title={`${pct}% attendance`}>
                          {pct}%
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">Legend:</span>
            {[["≥95%","bg-green-600 text-white"],["90-94%","bg-green-400 text-white"],["85-89%","bg-green-200 text-green-900"],["80-84%","bg-yellow-200 text-yellow-900"],["<80%","bg-red-200 text-red-900"]].map(([label, cls]) => (
              <span key={label} className={`text-xs px-2 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>
            ))}
          </div>

          {/* Department on-time compliance */}
          {computedShiftCompliance.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">On-Time Compliance by Dept</p>
              <div className="space-y-2">
                {computedShiftCompliance.map(s => (
                  <div key={s.dept} className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-24 shrink-0 truncate">{s.dept}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${s.compliance >= 90 ? "bg-green-500" : s.compliance >= 80 ? "bg-yellow-400" : "bg-red-400"}`}
                        style={{ width: `${s.compliance}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold w-8 text-right ${s.compliance >= 90 ? "text-green-700" : s.compliance >= 80 ? "text-yellow-600" : "text-red-600"}`}>
                      {s.compliance}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* WFH vs Office */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">WFH vs Office Distribution</h2>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie data={wfhPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={3}>
                  {wfhPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${v} employees`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-3">
              {wfhPieData.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i] }} />
                    <span className="text-sm text-gray-700">{item.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {geoData.map((g) => (
              <div key={g.location} className="bg-[#F5F3FF] rounded-xl p-3 text-center">
                <MapPin size={14} className="text-[#4F3CC9] mx-auto mb-1" />
                <p className="text-xs text-gray-500 leading-tight">{g.location.split(" - ")[0]}</p>
                <p className="text-lg font-bold text-[#4F3CC9]">{g.count}</p>
                <p className="text-xs text-gray-400">{g.pct}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 2: Late Login Tracker + Department Headcount ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Late Login Tracker */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Late Login Tracker</h2>
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Top Offenders</span>
          </div>
          <div className="space-y-3">
            {computedLateTracker.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No late logins recorded.</p>}
            {computedLateTracker.map((emp, i) => (
              <div key={emp.empId} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-5">#{i+1}</span>
                <div className="w-8 h-8 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center text-xs font-bold shrink-0">
                  {emp.name.split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{emp.name}</p>
                  <p className="text-xs text-gray-400">{emp.empId}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-orange-600">{emp.lateDays} days</p>
                  <p className="text-xs text-gray-400">avg +{emp.avgDelay}</p>
                </div>
                <div className="w-20">
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-orange-400" style={{ width: `${(emp.lateDays / 10) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Today&apos;s Late Arrivals</h3>
            <div className="space-y-1">
              {filtered.filter(r => lateByThreshold(r)).map(r => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 bg-red-50 rounded-xl">
                  <span className="text-sm text-gray-700">{r.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">{r.clockIn}</span>
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Late</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Department Headcount */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-[#4F3CC9]" />
            <h2 className="text-base font-semibold text-gray-900">Department Headcount</h2>
          </div>
          {deptCount.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-10">No employee data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptCount} margin={{ left: 0, right: 8 }}>
                <XAxis dataKey="dept" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                <Bar dataKey="count" name="Employees" fill="#4F3CC9" radius={[5, 5, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>


          </div>
        )}

        {/* ── Attendance Requests ── */}
        {activeTab === "Attendance Requests" && (
          <div className="p-6 space-y-6">

      {/* ── Regularization Requests ── */}
      {regRequests.filter((r) => r.status === "Pending").length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 border-orange-400">
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900">Attendance Regularization Requests</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                {regRequests.filter((r) => r.status === "Pending").length} Pending
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {regRequests.filter((r) => r.status === "Pending").map((req) => (
              <div key={req.id} className="px-6 py-5 flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="w-8 h-8 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center text-xs font-bold shrink-0">
                      {(req.empName ?? "?").split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{req.empName}</p>
                      <p className="text-xs text-gray-400">{req.empId}</p>
                    </div>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{req.date} · {req.day}</span>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      Actual Arrival: {req.actualArrival}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">
                    &ldquo;{req.reason}&rdquo;
                  </p>
                  <input
                    placeholder="Add a comment (optional)..."
                    value={hrComment[req.id] ?? ""}
                    onChange={(e) => setHrComment({ ...hrComment, [req.id]: e.target.value })}
                    className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => actionRequest(req.id, "Approved")}
                    className="px-5 py-2 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-colors"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => actionRequest(req.id, "Rejected")}
                    className="px-5 py-2 rounded-xl bg-red-100 text-red-600 text-sm font-semibold hover:bg-red-200 transition-colors"
                  >
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const reviewed = regRequests.filter((r) => r.status !== "Pending");
        const visible  = reviewed.filter((r) => !clearedReviewedIds.has(r.id));
        if (reviewed.length === 0) return null;
        function clearReviewed() {
          const next = new Set([...clearedReviewedIds, ...reviewed.map(r => r.id)]);
          setClearedReviewedIds(next);
          try { localStorage.setItem("hr_att_reviewed_cleared", JSON.stringify([...next])); } catch { /* ignore */ }
        }
        return (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
            {/* Header */}
            <div className="px-6 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-700">Reviewed Requests</h2>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{visible.length}</span>
              </div>
              {visible.length > 0 && (
                <button onClick={clearReviewed} className="text-xs font-medium text-red-400 hover:text-red-600">
                  Clear All
                </button>
              )}
            </div>
            {visible.length === 0 ? (
              <p className="text-center text-xs text-gray-400 py-8">All reviewed requests have been cleared.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                      <th className="px-5 py-3 text-left">Employee</th>
                      <th className="px-5 py-3 text-left">Emp ID</th>
                      <th className="px-5 py-3 text-left">Date</th>
                      <th className="px-5 py-3 text-left">Day</th>
                      <th className="px-5 py-3 text-left">Actual Arrival</th>
                      <th className="px-5 py-3 text-left">Reason</th>
                      <th className="px-5 py-3 text-left">HR Comment</th>
                      <th className="px-5 py-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visible.map((req) => (
                      <tr key={req.id} className={`hover:bg-gray-50 transition-colors ${req.status === "Approved" ? "bg-green-50/20" : "bg-red-50/20"}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center text-xs font-bold shrink-0">
                              {(req.empName ?? "?").split(" ").map((n) => n[0]).join("")}
                            </div>
                            <span className="font-medium text-gray-900 whitespace-nowrap">{req.empName ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs">{req.empId ?? "—"}</td>
                        <td className="px-5 py-3 text-gray-600 whitespace-nowrap">{req.date}</td>
                        <td className="px-5 py-3 text-gray-500">{req.day}</td>
                        <td className="px-5 py-3 text-gray-600">{req.actualArrival || "—"}</td>
                        <td className="px-5 py-3 text-gray-600 max-w-[180px]">
                          <span className="block truncate" title={req.reason}>{req.reason || "—"}</span>
                        </td>
                        <td className="px-5 py-3 text-gray-500 text-xs max-w-[140px]">
                          <span className="block truncate" title={req.hrComment}>{req.hrComment || "—"}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${req.status === "Approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

          </div>
        )}

        {/* ── Daily Attendance ── */}
        {activeTab === "Daily Attendance" && (
          <div className="p-6">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Daily Attendance Log</h2>
          <span className="text-xs text-gray-400">{filtered.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Dept</th>
                <th className="px-4 py-3 text-left">Work Mode</th>
                <th className="px-4 py-3 text-left">Clock In</th>
                <th className="px-4 py-3 text-left">Clock Out</th>
                <th className="px-4 py-3 text-left">Hours</th>
                <th className="px-4 py-3 text-left">Overtime</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Late</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loadingRecords && filtered.length === 0 && <SkeletonTableRows rows={8} cols={13} />}
              {!loadingRecords && filtered.length === 0 && (
                <tr><td colSpan={13}><EmptyState title="No attendance records" subtitle="No records match the current search or filters." /></td></tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  ref={(el) => { if (el) rowRefs.current.set(r.empId, el); else rowRefs.current.delete(r.empId); }}
                  className={`hover:bg-gray-50 transition-colors ${highlightedEmpId === r.empId ? "ring-2 ring-inset ring-[#4F3CC9] bg-[#F5F3FF]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.empId}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.dept}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.location === "Office" ? "bg-purple-100 text-purple-700" : r.location === "WFH" ? "bg-blue-100 text-blue-700" : "bg-teal-100 text-teal-700"}`}>{r.location}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.clockIn || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.clockOut === "Ongoing"
                      ? <span className="text-green-600 font-medium animate-pulse">● Ongoing</span>
                      : (r.clockOut || "—")}
                  </td>
                  <td className="px-4 py-3 text-gray-700 font-medium tabular-nums">
                    {r.clockOut === "Ongoing" ? fmtHours(liveSeconds) : (r.workingHours || computeHours(r.clockIn, r.clockOut) || "—")}
                  </td>
                  <td className="px-4 py-3">
                    {r.overtimeHours !== "-"
                      ? <span className="text-xs text-purple-700 font-medium bg-purple-50 px-2 py-0.5 rounded-full">+{r.overtimeHours}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {(() => { const eff = effectiveStatus(r) as AttendanceStatus; return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[eff] ?? statusColor[r.status]}`}>{eff}</span>; })()}
                  </td>
                  <td className="px-4 py-3">
                    {lateByThreshold(r)
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Late</span>
                      : r.clockIn
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-600">On Time</span>
                        : null}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(r)} title="Edit attendance record" aria-label="Edit attendance record" className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

          </div>
        )}

        {/* ── Monthly Report ── */}
        {activeTab === "Monthly Report" && (
          <div className="p-6">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Monthly Attendance Report</h2>
          <div className="flex gap-3">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
              {Array.from({ length: 6 }, (_, i) => {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - i);
                return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
              }).map((m) => <option key={m}>{m}</option>)}
            </select>
            <button
              onClick={() => {
                if (computedMonthlyReport.length === 0) { alert("No monthly data loaded yet. Please wait or select a different month."); return; }
                const data = computedMonthlyReport.map(r => ({
                  "Emp ID": r.empId, "Name": r.name, "Department": r.dept,
                  "Present": r.present, "Absent": r.absent, "Half Days": r.halfDays,
                  "Late Days": r.late, "Avg Hours": r.avgHours, "Overtime": r.overtime,
                }));
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Monthly Report");
                XLSX.writeFile(wb, `monthly_report_${new Date().toISOString().slice(0,10)}.xlsx`);
              }}
              className="flex items-center gap-1 text-sm text-[#4F3CC9] hover:underline font-medium"
            >
              <Download size={14} /> Export Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Dept</th>
                <th className="px-4 py-3 text-center">Present</th>
                <th className="px-4 py-3 text-center">Absent</th>
                <th className="px-4 py-3 text-center">Half Days</th>
                <th className="px-4 py-3 text-center">Late</th>
                <th className="px-4 py-3 text-center">Overtime</th>
                <th className="px-4 py-3 text-center">Avg Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {computedMonthlyReport.length === 0 && (
                <tr><td colSpan={8}><EmptyState title="No attendance data yet" subtitle="No attendance records for this month." /></td></tr>
              )}
              {computedMonthlyReport.map((r) => (
                <tr key={r.empId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.empId}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.dept}</td>
                  <td className="px-4 py-3 text-center text-green-600 font-medium">{r.present}</td>
                  <td className="px-4 py-3 text-center text-red-500">{r.absent}</td>
                  <td className="px-4 py-3 text-center text-yellow-600">{r.halfDays}</td>
                  <td className="px-4 py-3 text-center text-orange-500">{r.late}</td>
                  <td className="px-4 py-3 text-center text-purple-600 font-medium">{r.overtime}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{r.avgHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </div>
        )}

      </div>

      {/* Toast */}
      {regToast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium">
          {regToast}
        </div>
      )}

      {/* Manual Correction Modal */}
      {editRecord && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Manual Correction</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editRecord.name} · {editRecord.date}</p>
              </div>
              <button onClick={() => setEditRecord(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Clock In</label>
                  <input type="time" value={correction.clockIn} onChange={(e) => setCorrection({ ...correction, clockIn: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Clock Out</label>
                  <input type="time" value={correction.clockOut} onChange={(e) => setCorrection({ ...correction, clockOut: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                <select value={correction.status} onChange={(e) => setCorrection({ ...correction, status: e.target.value as AttendanceStatus })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Present","Absent","Half Day","Leave","Week Off"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Reason for Correction</label>
                <textarea value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] h-20 resize-none" placeholder="Briefly describe the reason..." />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditRecord(null)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={saveCorrection} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8]">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
