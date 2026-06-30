"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Pencil, X, Download, MapPin, Clock, TrendingUp, Users, AlertTriangle, Wifi } from "lucide-react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { getAttendance, updateAttendance, getAllClockRecords, updateRegularizationStatus } from "@/lib/firebaseService";
import { collection, onSnapshot, query, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { backfillAllEmployees } from "@/lib/attendanceBackfill";

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
  // Keyed by empId → WorkLocation derived from employee's workMode
  const empWorkLocRef = useRef<Map<string, WorkLocation>>(new Map());
  const backfillDoneRef = useRef(false);
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
  const [regToast, setRegToast] = useState<string | null>(null);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [monthlyAttendance, setMonthlyAttendance] = useState<AttendanceRecord[]>([]);

  // ── Load ALL employees + today's attendance and merge ─────────────────────
  function defaultLocation(workMode: string): WorkLocation {
    if (workMode === "Remote" || workMode === "WFH") return "WFH";
    if (workMode === "Hybrid") return "WFH";
    return "Office";
  }

  const loadAttendance = useCallback(async () => {
    try {
      // ── Step 1: Load employees from primary `employees` collection ──
      let empDocs: Record<string, unknown>[] = [];
      try {
        const snap = await getDocs(collection(db, "employees"));
        empDocs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      } catch { /* ignore */ }

      const empList = empDocs.map((d) => ({
        id:               String(d.employeeId ?? d.id ?? ""),
        name:             String(d.name ?? ""),
        department:       String(d.department ?? ""),
        reportingManager: String(d.reportingManager ?? ""),
        shift:            String(d.shift ?? "9AM-6PM"),
        workMode:         String(d.workMode ?? "Office"),
      })).filter((e) => e.id);   // drop any rows with no id


      // ── Step 3: Load today's attendance records ──
      let attList: Record<string, unknown>[] = [];
      try {
        const raw = await getAttendance(TODAY);
        attList = raw as Record<string, unknown>[];
      } catch { /* ignore */ }

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
        const existing = attMap.get(emp.id);
        if (existing) return existing;
        return {
          id:            `${TODAY}-${emp.id}`,
          empId:         emp.id,
          name:          emp.name,
          dept:          emp.department,
          manager:       emp.reportingManager,
          location:      defaultLocation(emp.workMode),
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
      setLoadingRecords(false);

      if (!backfillDoneRef.current && empList.length > 0) {
        backfillDoneRef.current = true;
        backfillAllEmployees(empList).catch(() => {});
      }
    } catch (e) {
      setLoadingRecords(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAttendance();
    const t = setInterval(loadAttendance, 10000);
    return () => clearInterval(t);
  }, [loadAttendance]);

  // ── Live clock polling — merges real employee clock-in/out into HR records ─
  interface ClockRecord { empId: string; empName: string; department?: string; date: string; clockInTs: number; clockInStr: string; clockOutStr?: string; totalSeconds?: number; status: "clocked-in" | "clocked-out"; isLate: boolean; }

  function fmtHours(secs: number) {
    if (!secs) return "—";
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  const syncClockData = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    getAllClockRecords(today)
      .then((rawClocks) => {
        const clockData = rawClocks as unknown as ClockRecord[];
        const todayClocks = clockData.filter((c) => c.date === today);
        if (todayClocks.length === 0) return;

        // Tick live seconds for any clocked-in employee
        const clocked = todayClocks.find((c) => c.status === "clocked-in");
        if (clocked) setLiveSeconds(Math.floor((Date.now() - clocked.clockInTs) / 1000));

        setRecords((prev) => {
          // Update records that already exist in the list
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

          // Add records for employees who clocked in but aren't in the list yet
          const existingIds = new Set(prev.map((r) => r.empId));
          const newRecs: AttendanceRecord[] = todayClocks
            .filter((c) => !existingIds.has(c.empId))
            .map((c) => {
              const secs = c.status === "clocked-in"
                ? Math.floor((Date.now() - c.clockInTs) / 1000)
                : (c.totalSeconds ?? 0);
              return {
                id:            `${today}-${c.empId}`,
                empId:         c.empId,
                name:          c.empName,
                dept:          c.department ?? "",
                manager:       "",
                location:      (empWorkLocRef.current.get(c.empId) ?? "Office") as WorkLocation,
                shift:         "9AM-6PM",
                date:          today,
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
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    syncClockData();
    const interval = setInterval(syncClockData, 10000);
    return () => clearInterval(interval);
  }, [syncClockData]);

  // Also tick live working hours every second for clocked-in employees
  useEffect(() => {
    const t = setInterval(() => setLiveSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

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
      if (rec.status === "Absent") byMonth[m].absent++;
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
  const totalAbsent = allForRate.filter((r) => r.status === "Absent").length;
  const absenteeismRate = ((totalAbsent / totalEmployeeDays) * 100).toFixed(1);

  // Compute OT from today's records — parse "Xh Ym" or numeric strings
  function parseOTHours(s: string): number {
    if (!s || s === "-" || s === "—") return 0;
    const hm = s.match(/(\d+)h\s*(\d*)m?/);
    if (hm) return Number(hm[1]) + Number(hm[2] || 0) / 60;
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
  }
  const totalOTHours = records.reduce((sum, r) => sum + parseOTHours(r.overtimeHours), 0);
  const totalOTDisplay = totalOTHours > 0 ? `${totalOTHours.toFixed(1)}h` : "0h";

  // Compute per-employee OT for bar chart
  const computedOvertimeData = records
    .map((r) => ({ name: r.name, hours: parseOTHours(r.overtimeHours) }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 8);

  // Compute Monthly Report from real Firestore data (monthlyAttendance)
  const computedMonthlyReport = (() => {
    const byEmp: Record<string, { name: string; empId: string; dept: string; present: number; absent: number; halfDays: number; late: number; totalSecs: number; dayCount: number }> = {};
    const allRecs = [...monthlyAttendance, ...records.filter(r => r.date === TODAY)];
    for (const r of allRecs) {
      if (!r.empId) continue;
      if (!byEmp[r.empId]) byEmp[r.empId] = { name: r.name, empId: r.empId, dept: r.dept, present: 0, absent: 0, halfDays: 0, late: 0, totalSecs: 0, dayCount: 0 };
      const e = byEmp[r.empId];
      if (r.status === "Present") e.present++;
      if (r.status === "Absent") e.absent++;
      if (r.status === "Half Day") { e.halfDays++; e.present++; }
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
          let h = parseInt(parts[1]), m = parseInt(parts[2]);
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
      if (r.status === "Present" || r.status === "Half Day") dayMap[r.date].present++;
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
      if ((r.status === "Present" || r.status === "Half Day") && !r.late) byDept[dept].onTime++;
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

  const filtered = records.filter((r) => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.empId.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || r.status === statusFilter;
    const matchManager = managerFilter === "All" || r.manager === managerFilter;
    const matchLocation = locationFilter === "All" || r.location === locationFilter;
    return matchSearch && matchStatus && matchManager && matchLocation;
  });

  const presentCount = filtered.filter(r => r.status === "Present").length;
  const absentCount = filtered.filter(r => r.status === "Absent").length;
  const lateCount = filtered.filter(r => r.late).length;
  const halfDayCount = filtered.filter(r => r.status === "Half Day").length;
  const wfhCount = filtered.filter(r => r.location === "WFH" && r.status === "Present").length;
  const overtimeCount = filtered.filter(r => r.overtimeHours !== "-").length;

  const wfhPieData = [
    { name: "Office",      value: records.filter(r => r.location === "Office").length },
    { name: "WFH",         value: records.filter(r => r.location === "WFH").length },
    { name: "Client Site", value: records.filter(r => r.location === "Client Site").length },
  ];

  // Geo data derived from real records
  const total = records.length || 1;
  const geoData = [
    { location: "Office",           count: records.filter(r => r.location === "Office").length,      pct: Math.round(records.filter(r => r.location === "Office").length / total * 100) },
    { location: "WFH",              count: records.filter(r => r.location === "WFH").length,         pct: Math.round(records.filter(r => r.location === "WFH").length / total * 100) },
    { location: "Client Site",      count: records.filter(r => r.location === "Client Site").length, pct: Math.round(records.filter(r => r.location === "Client Site").length / total * 100) },
    { location: "Not Logged In",    count: records.filter(r => !r.clockIn && r.status !== "Leave").length, pct: Math.round(records.filter(r => !r.clockIn && r.status !== "Leave").length / total * 100) },
  ];

  function openEdit(r: AttendanceRecord) {
    setEditRecord(r);
    setCorrection({ name: r.name, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, status: r.status, reason: "" });
  }

  async function saveCorrection() {
    if (!editRecord) return;
    const updated = { ...editRecord, clockIn: correction.clockIn, clockOut: correction.clockOut, status: correction.status, late: correction.clockIn > "09:30" };
    setRecords(records.map((r) => r.id === editRecord.id ? updated : r));
    setEditRecord(null);
    try {
      const { id: attId, ...rest } = updated;
      await updateAttendance(attId, rest as Record<string, unknown>);
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
      "Location":        r.location,
      "Clock In":        r.clockIn  || "-",
      "Clock Out":       r.clockOut || "-",
      "Working Hours":   r.workingHours,
      "Overtime Hours":  r.overtimeHours,
      "Status":          r.status,
      "Late":            r.late ? "Yes" : "No",
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance & Workforce Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Operational visibility across teams, locations and shifts</p>
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
            <label className="text-xs text-gray-400">Location</label>
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Search</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input placeholder="Employee / ID" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} pl-8 w-44`} />
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
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap ${
                activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {activeTab === "Overview" && (
          <div className="p-6 space-y-6">

      {/* ── Row 1: Heatmap + WFH vs Office ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Attendance Heatmap */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Daily Attendance Heatmap</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="py-1 pr-3 text-left text-gray-400 font-normal w-20"></th>
                  {heatmapDays.map(d => <th key={d} className="py-1 px-2 text-center text-gray-500 font-medium">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {computedHeatmap.data.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-xs text-gray-400">No attendance data for selected month yet.</td></tr>
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
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <span className="text-xs text-gray-400">Legend:</span>
            {[["≥95%","bg-green-600 text-white"],["90-94%","bg-green-400 text-white"],["85-89%","bg-green-200 text-green-900"],["80-84%","bg-yellow-200 text-yellow-900"],["<80%","bg-red-200 text-red-900"]].map(([label, cls]) => (
              <span key={label} className={`text-xs px-2 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>
            ))}
          </div>
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

      {/* ── Row 2: Late Login Tracker + Absenteeism Trends ── */}
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
              {filtered.filter(r => r.late).map(r => (
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

        {/* Absenteeism Trends */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Absenteeism Trends (6 Months)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={absenteeismTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="absent" stroke="#EF4444" strokeWidth={2} dot={{ r: 4 }} name="Absent" />
              <Line type="monotone" dataKey="late" stroke="#F59E0B" strokeWidth={2} dot={{ r: 4 }} name="Late Logins" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Avg Absent/Month</p>
              <p className="text-lg font-bold text-red-600">{avgAbsent}</p>
            </div>
            <div className="bg-yellow-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Avg Late/Month</p>
              <p className="text-lg font-bold text-yellow-600">{avgLate}</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Absenteeism Rate</p>
              <p className="text-lg font-bold text-orange-600">{absenteeismRate}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Shift Compliance + Overtime ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shift Compliance */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Shift Compliance by Department</h2>
          <div className="space-y-3">
            {computedShiftCompliance.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No attendance data loaded yet.</p>}
            {computedShiftCompliance.map((s) => (
              <div key={s.dept} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 w-28 shrink-0">{s.dept}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full ${s.compliance >= 90 ? "bg-green-500" : s.compliance >= 80 ? "bg-yellow-400" : "bg-red-400"}`}
                    style={{ width: `${s.compliance}%` }}
                  />
                </div>
                <span className={`text-sm font-semibold w-10 text-right ${s.compliance >= 90 ? "text-green-700" : s.compliance >= 80 ? "text-yellow-600" : "text-red-600"}`}>
                  {s.compliance}%
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-5">
            {[["≥90% On Track","bg-green-100 text-green-700"],["80-89% Watch","bg-yellow-100 text-yellow-700"],["<80% Action Needed","bg-red-100 text-red-700"]].map(([l, c]) => (
              <span key={l} className={`text-xs px-2 py-0.5 rounded-full font-medium ${c}`}>{l}</span>
            ))}
          </div>
        </div>

        {/* Overtime Hours */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Overtime Hours (This Month)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={computedOvertimeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={55} />
              <Tooltip formatter={(v) => [`${v}h overtime`]} />
              <Bar dataKey="hours" fill="#4F3CC9" radius={[0, 6, 6, 0]} name="Overtime (hrs)" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="bg-purple-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Total OT Hours</p>
              <p className="text-lg font-bold text-purple-700">{totalOTDisplay}</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">Employees with OT</p>
              <p className="text-lg font-bold text-purple-700">{overtimeCount}</p>
            </div>
          </div>
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

      {regRequests.filter((r) => r.status !== "Pending").length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-3 border-b">
            <h2 className="text-sm font-semibold text-gray-500">Reviewed Requests ({regRequests.filter((r) => r.status !== "Pending").length})</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {regRequests.filter((r) => r.status !== "Pending").map((req) => (
              <div key={req.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center text-xs font-bold shrink-0">
                    {(req.empName ?? "?").split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{req.empName} <span className="text-gray-400 font-normal">· {req.date}</span></p>
                    {req.hrComment && <p className="text-xs text-gray-400">Comment: {req.hrComment}</p>}
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${req.status === "Approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                <th className="px-4 py-3 text-left">Location</th>
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
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
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
                    {r.clockOut === "Ongoing" ? fmtHours(liveSeconds) : r.workingHours}
                  </td>
                  <td className="px-4 py-3">
                    {r.overtimeHours !== "-"
                      ? <span className="text-xs text-purple-700 font-medium bg-purple-50 px-2 py-0.5 rounded-full">+{r.overtimeHours}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.late
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Late</span>
                      : r.clockIn
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-600">On Time</span>
                        : null}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
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
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No attendance data for this month yet.</td></tr>
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
