"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, Calendar } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs, onSnapshot, setDoc, updateDoc, addDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { markEmpNotifRead } from "@/lib/firebaseService";

type AttStatus = "Present" | "Absent" | "Half Day" | "Leave" | "Week Off";

interface AttEntry {
  date: string;
  day: string;
  clockIn: string;
  clockOut: string;
  hours: string;
  hoursVal: number;
  status: AttStatus;
  late: boolean;
  isWeekend: boolean;
}

// Derive the displayed attendance category from hours worked against the CURRENT
// Settings → Attendance Rules thresholds, so the employee view depends entirely on
// the HR-configured rules (same rule as the HR Attendance module):
//   • no clock-in            → keep stored (Absent / Week Off / Leave)
//   • Leave / Week Off       → unchanged
//   • clocked in, not out    → Present (open shift)
//   • hours ≥ Full-Day       → Present
//   • hours ≥ Half-Day start → Half Day
//   • below Half-Day start   → Absent
function deriveDisplayStatus(e: AttEntry, minHours: number, halfDayThreshold: number): AttStatus {
  const hasClockIn = !!e.clockIn && e.clockIn !== "—" && e.clockIn !== "";
  if (!hasClockIn) return e.status || (e.isWeekend ? "Week Off" : "Absent");
  if (e.status === "Leave" || e.status === "Week Off") return e.status;
  const clockedOut = !!e.clockOut && e.clockOut !== "—" && e.clockOut !== "" && e.clockOut !== "Ongoing";
  if (!clockedOut) return "Present"; // open shift counts as working
  const hrs = e.hoursVal;
  if (hrs >= minHours) return "Present";
  if (hrs > 0 && hrs >= halfDayThreshold) return "Half Day";
  return "Absent";
}

interface RegRequest {
  id: string;
  date: string;
  day: string;
  reason: string;
  actualArrival: string;
  status: "Pending" | "Approved" | "Rejected";
  hrComment?: string;
  empId?: string;
  empName?: string;
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function getTodayDateStr() {
  const d = new Date();
  return `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}, ${d.getFullYear()}`;
}
function getTodayDayStr() { return DAY_ABBR[new Date().getDay()]; }
function isTodayWeekend() { const d = new Date().getDay(); return d === 0 || d === 6; }

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmt(secs: number, showSeconds = false) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return showSeconds ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
}

function getTodayMonthLabel() {
  const d = new Date();
  return `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;
}

function logDateToISO(logDate: string): string {
  const [mon, dayComma, year] = logDate.split(" ");
  const month = String(SHORT_MONTHS.indexOf(mon) + 1).padStart(2, "0");
  return `${year}-${month}-${dayComma.replace(",", "").padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: AttStatus }) {
  const map: Record<AttStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    Present:   { cls: "bg-green-100 text-green-700",   icon: <CheckCircle size={11} />,  label: "Present"  },
    Absent:    { cls: "bg-red-100 text-red-700",       icon: <XCircle size={11} />,      label: "Absent"   },
    "Half Day":{ cls: "bg-yellow-100 text-yellow-700", icon: <AlertCircle size={11} />,  label: "Half Day" },
    Leave:     { cls: "bg-blue-100 text-blue-700",     icon: <Clock size={11} />,        label: "Leave"    },
    "Week Off":{ cls: "bg-gray-100 text-gray-500",     icon: null,                       label: "Week Off" },
  };
  const { cls, icon, label } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

export default function AttendancePage() {
  // Employee identity (loaded from Firebase Auth → Firestore → HR API)
  const [empId, setEmpId]   = useState("");
  const [empName, setEmpName] = useState("");
  const [empDept, setEmpDept] = useState("");

  // Clock state
  const [isClockedIn, setIsClockedIn]         = useState(false);
  const [clockInTime, setClockInTime]         = useState<string | null>(null);
  const [clockOutTime, setClockOutTime]       = useState<string | null>(null);
  const [clockInTimestamp, setClockInTimestamp] = useState<number | null>(null);
  const [workingSeconds, setWorkingSeconds]   = useState(0);
  const [finalSeconds, setFinalSeconds]       = useState<number | null>(null);
  const [isLate, setIsLate]                   = useState(false);
  const [lateHour, setLateHour]               = useState(9);
  const [lateMinute, setLateMinute]           = useState(30);
  // Attendance rules from Settings → Attendance Rules (hours).
  const [minHours, setMinHours]               = useState(8);
  const [halfDayThreshold, setHalfDayThreshold] = useState(0);

  // Present ≥ Full-Day · Half Day = Half-Day start up to Full-Day · Absent below.
  // Honors BOTH configured thresholds so it matches the HR Attendance module.
  function statusFromHours(totalSeconds: number, isWeekend: boolean): AttStatus {
    if (isWeekend) return "Week Off";
    const hrs = totalSeconds / 3600;
    if (hrs >= minHours) return "Present";
    if (hrs > 0 && hrs >= halfDayThreshold) return "Half Day";
    return "Absent";
  }

  // UI state
  const [currentTime, setCurrentTime]   = useState("");
  const [currentDate, setCurrentDate]   = useState("");
  const [pastLog, setPastLog]           = useState<AttEntry[]>([]);
  const [requests, setRequests]         = useState<RegRequest[]>([]);
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqTarget, setReqTarget]       = useState<AttEntry | null>(null);
  const [reqForm, setReqForm]           = useState({ actualArrival: "", reason: "", selectedDate: "" });
  const [reqToast, setReqToast]         = useState<string | null>(null);
  const [historyYear, setHistoryYear]       = useState(() => new Date().getFullYear());
  const [historyMonthIdx, setHistoryMonthIdx] = useState(() => new Date().getMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [selectedMonth, setSelectedMonth]   = useState(getTodayMonthLabel);

  // Auto-mark unread attendance notifications as read when employee opens this page
  useEffect(() => { if (empId) markEmpNotifRead("attendance", empId); }, [empId]);

  // Live attendance-rule thresholds: subscribe to Settings → Attendance Rules so a
  // change HR makes immediately re-categorizes this employee's attendance (the
  // display derives from these via deriveDisplayStatus). onSnapshot fires with the
  // current value on mount too, so this also covers the initial load.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "attendanceRules"), (snap) => {
      if (!snap.exists()) return;
      const mh = parseFloat(snap.data().minHours as string);
      const hd = parseFloat(snap.data().halfDayThreshold as string);
      if (!isNaN(mh)) setMinHours(mh);
      if (!isNaN(hd)) setHalfDayThreshold(hd);
    }, () => { /* keep last-known values on error */ });
    return unsub;
  }, []);

  // ── Load employee identity from Firebase Auth → Firestore ───────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) return;
        const userData = userSnap.data();
        const eid = (userData.employeeId as string) ?? "";
        if (!eid) return;

        const [empSnap, timingsSnap, rulesSnap] = await Promise.all([
          getDoc(doc(db, "employees", eid)),
          getDoc(doc(db, "settings", "workTimings")),
          getDoc(doc(db, "settings", "attendanceRules")),
        ]);
        if (!empSnap.exists()) return;
        const empData = empSnap.data();
        setEmpId(eid);
        setEmpName(empData.name ?? "");
        setEmpDept(empData.department ?? "");

        // Load late threshold from HR settings (e.g. "09:30")
        if (timingsSnap.exists()) {
          const threshold = (timingsSnap.data().lateThreshold as string) ?? "09:30";
          const [h, m] = threshold.split(":").map(Number);
          if (!isNaN(h)) { setLateHour(h); setLateMinute(m || 0); }
        }
        // Load min-hours / half-day thresholds (e.g. 8 / 4 hours)
        if (rulesSnap.exists()) {
          const mh = parseFloat(rulesSnap.data().minHours as string);
          const hd = parseFloat(rulesSnap.data().halfDayThreshold as string);
          if (!isNaN(mh)) setMinHours(mh);
          if (!isNaN(hd)) setHalfDayThreshold(hd);
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, []);

  // Ref to track active clock session — prevents HR corrections from overwriting live state
  const isClockedInRef = useRef(false);
  // Cache clockRecords so we only fetch once (historical backfill data doesn't change)
  const crCacheRef = useRef<Record<string, { clockIn: string; clockOut: string; totalSeconds: number }> | null>(null);
  useEffect(() => { isClockedInRef.current = isClockedIn; }, [isClockedIn]);

  // ── Live listener for today's record — reflects HR corrections instantly ────
  useEffect(() => {
    if (!empId) return;
    const unsub = onSnapshot(doc(db, "attendance", `${todayISO()}-${empId}`), (snap) => {
      if (!snap.exists()) return;
      // Never overwrite state while the employee is actively clocked in
      if (isClockedInRef.current) return;
      const rec = snap.data();
      // Prefer stored string; fall back to reconstructing from timestamp
      const ciStr = String(rec.clockIn  ?? "") || (rec.clockInTs  ? fmtTime(Number(rec.clockInTs))  : "");
      const coStr = String(rec.clockOut ?? "") || (rec.clockOutTs ? fmtTime(Number(rec.clockOutTs)) : "");
      setClockInTime(ciStr || null);
      setClockInTimestamp((rec.clockInTs as number) ?? null);
      setIsLate(rec.late ?? false);
      if (ciStr && !coStr) {
        setIsClockedIn(true);
      } else if (ciStr && coStr) {
        setClockOutTime(coStr);
        setFinalSeconds((rec.totalSeconds as number) ?? null);
        setIsClockedIn(false);
      }
    }, () => {});
    return unsub;
  }, [empId]);

  // ── Load attendance history (past days) — live listener so HR changes reflect instantly ──
  useEffect(() => {
    if (!empId) return;
    const todayIso = todayISO();

    async function processAndSet(rawDocs: Record<string, unknown>[]) {
      let past = rawDocs
        .filter((rec) => rec.date && rec.date !== todayIso)
        .map((rec) => {
          const d = new Date(rec.date + "T00:00:00");
          const dayIdx = d.getDay();
          const isWeekend = dayIdx === 0 || dayIdx === 6;

          // Prefer stored formatted strings; fall back to reconstructing from timestamps
          const clockInStr  = String(rec.clockIn  ?? "");
          const clockOutStr = String(rec.clockOut ?? "");
          const whStr       = String(rec.workingHours ?? "");
          const totalSecs   = Number(rec.totalSeconds ?? 0);

          const clockInFinal  = clockInStr  || (rec.clockInTs  ? fmtTime(Number(rec.clockInTs))  : "");
          const clockOutFinal = clockOutStr || (rec.clockOutTs ? fmtTime(Number(rec.clockOutTs)) : "");
          const hoursFinal    = whStr || (totalSecs > 0
            ? `${Math.floor(totalSecs / 3600)}h ${String(Math.floor((totalSecs % 3600) / 60)).padStart(2, "0")}m`
            : "");

          const hoursMatch = hoursFinal.match(/(\d+)h\s*(\d+)m/);
          const hoursVal = hoursMatch ? parseInt(hoursMatch[1]) + parseInt(hoursMatch[2]) / 60 : 0;
          return {
            date:     `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`,
            day:      DAY_ABBR[dayIdx],
            clockIn:  clockInFinal  || "—",
            clockOut: clockOutFinal || "—",
            hours:    hoursFinal    || "—",
            hoursVal,
            status:   (rec.status || (isWeekend ? "Week Off" : "Absent")) as AttStatus,
            late:     rec.late ?? false,
            isWeekend,
            isoDate:  rec.date as string,
          } as AttEntry & { isoDate: string };
        })
        .sort((a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime());

      // Backfill missing times from clockRecords for any Present day missing clock data
      const incomplete = past.filter(e =>
        e.status === "Present" && (e.clockIn === "—" || e.clockOut === "—" || e.hours === "—")
      );
      if (incomplete.length > 0) {
        // Fetch clockRecords only once; subsequent snapshot fires reuse the cache
        if (crCacheRef.current === null) {
          crCacheRef.current = {};
          const dates = [...new Set(incomplete.map(e => e.isoDate))];
          const chunks: string[][] = [];
          for (let i = 0; i < dates.length; i += 30) chunks.push(dates.slice(i, i + 30));
          await Promise.all(chunks.map(async chunk => {
            const crSnap = await getDocs(query(
              collection(db, "clockRecords"),
              where("empId", "==", empId),
              where("date", "in", chunk)
            ));
            crSnap.docs.forEach(d => {
              const r = d.data() as Record<string, unknown>;
              crCacheRef.current![r.date as string] = {
                clockIn:      (r.clockInStr  as string) ?? "",
                clockOut:     (r.clockOutStr as string) ?? "",
                totalSeconds: (r.totalSeconds as number) ?? 0,
              };
            });
          }));
        }

        const crMap = crCacheRef.current;
        past = past.map(e => {
          const cr = crMap[(e as AttEntry & { isoDate: string }).isoDate];
          if (!cr) return e;
          let updated = { ...e };
          if (e.clockIn === "—" && cr.clockIn) updated = { ...updated, clockIn: cr.clockIn };
          if ((e.clockOut === "—" || e.hours === "—") && cr.clockOut && cr.totalSeconds > 0) {
            const h = Math.floor(cr.totalSeconds / 3600);
            const m = Math.floor((cr.totalSeconds % 3600) / 60);
            updated = { ...updated, clockOut: cr.clockOut, hours: `${h}h ${String(m).padStart(2, "0")}m`, hoursVal: h + m / 60 };
          }
          return updated;
        });
      }

      setPastLog(past.map(({ isoDate: _iso, ...e }) => e as AttEntry));
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const historyStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

    const unsub = onSnapshot(
      query(collection(db, "attendance"), where("empId", "==", empId), where("date", ">=", historyStart)),
      (snap) => { processAndSet(snap.docs.map(d => d.data())).catch(() => {}); },
      () => {}
    );
    return () => unsub();
  }, [empId]);

  // ── Load regularization requests from Firestore ──────────────────────────────
  function loadRequests() {
    if (!empId) return;
    getDocs(query(collection(db, "regularization"), where("empId", "==", empId)))
      .then((snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RegRequest));
        setRequests(all);
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!empId) return;
    loadRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  // ── Live clock ticker ────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
      setCurrentDate(now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
      if (clockInTimestamp && isClockedIn) {
        setWorkingSeconds(Math.floor((Date.now() - clockInTimestamp) / 1000));
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [clockInTimestamp, isClockedIn]);

  // ── Clock in / out ───────────────────────────────────────────────────────────
  async function handleClockToggle() {
    if (!empId) return;
    const now = new Date();
    const ts  = now.getTime();
    const timeStr = fmtTime(ts);
    const date    = todayISO();

    if (!isClockedIn) {
      const h = now.getHours(), m = now.getMinutes();
      const dayOfWeek = now.getDay();
      const isWeekendToday = dayOfWeek === 0 || dayOfWeek === 6;
      const late = !isWeekendToday && (h > lateHour || (h === lateHour && m > lateMinute));
      const attId = `${date}-${empId}`;
      const payload = {
        empId, name: empName, dept: empDept,
        date, clockIn: timeStr, clockInTs: ts, clockOut: "", workingHours: "", totalSeconds: 0,
        status: "Present", late, updatedAt: new Date().toISOString(),
      };
      try {
        // Write to both attendance (history source) and clockRecords (HR live view + backfill source)
        await setDoc(doc(db, "attendance",   attId), payload, { merge: true });
        await setDoc(doc(db, "clockRecords", attId), {
          empId, empName, date,
          clockInStr: timeStr, clockInTs: ts,
          clockOutStr: "", clockOutTs: 0, totalSeconds: 0,
          status: "clocked-in", isLate: late,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch { return; }
      setClockInTime(timeStr);
      setClockInTimestamp(ts);
      setClockOutTime(null);
      setFinalSeconds(null);
      setWorkingSeconds(0);
      setIsLate(late);
      setIsClockedIn(true);
    } else {
      const total = workingSeconds;
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const wh = `${h}h ${String(m).padStart(2, "0")}m`;
      const attId = `${date}-${empId}`;
      // Derive Present / Half Day from hours worked against configured thresholds.
      const isWeekendToday = [0, 6].includes(new Date(date + "T00:00:00").getDay());
      const derivedStatus = statusFromHours(total, isWeekendToday);
      try {
        await updateDoc(doc(db, "attendance", attId), {
          clockOut: timeStr, clockOutTs: ts, totalSeconds: total,
          workingHours: wh, status: derivedStatus, updatedAt: new Date().toISOString(),
        });
        // Persist to clockRecords so history backfill can recover times
        await setDoc(doc(db, "clockRecords", attId), {
          clockOutStr: timeStr, clockOutTs: ts, totalSeconds: total,
          status: "clocked-out", updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch { return; }
      setClockOutTime(timeStr);
      setFinalSeconds(total);
      setClockInTimestamp(null);
      setIsClockedIn(false);
    }
  }

  // ── Submit regularization request ────────────────────────────────────────────
  async function submitRequest() {
    if (!reqForm.selectedDate || !reqForm.actualArrival || !reqForm.reason.trim()) return;
    const isoDate = reqForm.selectedDate;
    const dayLabel = new Date(isoDate + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
    const payload = {
      empId, empName,
      date: isoDate, day: reqTarget?.day ?? dayLabel,
      reason: reqForm.reason.trim(),
      actualArrival: reqForm.actualArrival,
      status: "Pending" as const,
      updatedAt: new Date().toISOString(),
    };
    try {
      const docRef = await addDoc(collection(db, "regularization"), payload);
      const newReq: RegRequest = { id: docRef.id, ...payload };
      setRequests((prev) => [...prev.filter((r) => r.date !== isoDate), newReq]);
      // Notify HR
      await addDoc(collection(db, "notifications"), {
        userId: "HR_PORTAL",
        type: "attendance",
        title: `Attendance Correction — ${empName}`,
        message: `${empName} has requested attendance correction for ${isoDate}. Reason: ${payload.reason}`,
        read: false,
        createdAt: new Date().toISOString(),
      });
    } catch { /* ignore */ }
    setShowReqModal(false);
    setReqForm({ actualArrival: "", reason: "", selectedDate: "" });
    setReqTarget(null);
    setReqToast("Regularization request submitted to HR!");
    setTimeout(() => setReqToast(null), 4000);
  }

  function getRequestForDate(date: string) {
    const iso = date.includes("-") ? date : logDateToISO(date);
    return requests.find((r) => r.date === iso);
  }

  const displayedSecs = finalSeconds ?? (isClockedIn ? workingSeconds : 0);

  // Today's entry — dynamic, prioritises clock-in over weekend status
  const todayEntry = useMemo<AttEntry>(() => {
    const weekend = isTodayWeekend();
    return {
      date:      getTodayDateStr(),
      day:       getTodayDayStr(),
      clockIn:   clockInTime  ?? "—",
      clockOut:  clockOutTime ?? (isClockedIn ? "Ongoing" : "—"),
      hours:     clockInTime  ? fmt(displayedSecs, isClockedIn) : "—",
      hoursVal:  displayedSecs / 3600,
      status:    clockInTime ? "Present" : (weekend ? "Week Off" : "Absent"),
      late:      isLate && !!clockInTime,
      isWeekend: weekend && !clockInTime,
    };
  }, [clockInTime, clockOutTime, isClockedIn, displayedSecs, isLate]);

  // Merge regularisation approvals into log
  const fullLog = useMemo<AttEntry[]>(() => {
    const base = [...pastLog, todayEntry];
    return base.map((entry) => {
      const isoDate = logDateToISO(entry.date);
      const approved = requests.find((r) => r.status === "Approved" && r.date === isoDate);
      if (approved) {
        // An approved regularisation is a manual HR override → Present.
        const [h, m] = approved.actualArrival.split(":").map(Number);
        const suffix = h >= 12 ? "PM" : "AM";
        const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return {
          ...entry,
          status: "Present" as const,
          clockIn: `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`,
          late: h > lateHour || (h === lateHour && m > lateMinute),
        };
      }
      // Otherwise derive the category from hours worked against the CURRENT
      // Settings → Attendance Rules thresholds, so the employee's Present/Half
      // Day/Absent depends entirely on the HR-configured rules and updates live
      // when HR changes them — never a status frozen at clock-out time.
      return { ...entry, status: deriveDisplayStatus(entry, minHours, halfDayThreshold) };
    });
  }, [pastLog, todayEntry, requests, minHours, halfDayThreshold, lateHour, lateMinute]);

  // Stats for current month
  const currentMonthEntries = fullLog.filter((e) => {
    const d = new Date();
    return e.date.startsWith(SHORT_MONTHS[d.getMonth()]) && e.date.endsWith(String(d.getFullYear()));
  });
  const presentCount = currentMonthEntries.filter(e => e.status === "Present").length;
  const absentCount  = currentMonthEntries.filter(e => !e.isWeekend && e.status === "Absent").length;
  const halfDayCount = currentMonthEntries.filter(e => e.status === "Half Day").length;
  const lateCount    = currentMonthEntries.filter(e => e.late).length;
  const totalWorkDays = (() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), d).getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return count;
  })();

  // History table — selected month/year
  const now = new Date();
  const mStr = SHORT_MONTHS[historyMonthIdx];
  const monthEntries = fullLog.filter(e => e.date.startsWith(mStr) && e.date.endsWith(String(historyYear)));
  const visibleRows  = monthEntries.filter(e => !e.isWeekend || e.clockIn !== "—");

  // Bar chart — one bar per working day (weekday) of the selected month up to today
  const barData = (() => {
    const [selMonthName, selYear] = selectedMonth.split(" ");
    const selMonthIdx = new Date(`${selMonthName} 1, ${selYear}`).getMonth();
    const selYearNum  = parseInt(selYear);
    const todayD      = new Date();
    const isCurrentMonth = todayD.getMonth() === selMonthIdx && todayD.getFullYear() === selYearNum;
    const daysInMonth    = new Date(selYearNum, selMonthIdx + 1, 0).getDate();
    const maxDay         = isCurrentMonth ? todayD.getDate() : daysInMonth;

    // Build lookup: calendar day → log entry
    const logMap = new Map<number, AttEntry>();
    fullLog.forEach((e) => {
      const d = new Date(logDateToISO(e.date) + "T00:00:00");
      if (d.getMonth() === selMonthIdx && d.getFullYear() === selYearNum) {
        logMap.set(d.getDate(), e);
      }
    });

    const result: { day: string; hours: number; status: string }[] = [];
    for (let day = 1; day <= maxDay; day++) {
      const date   = new Date(selYearNum, selMonthIdx, day);
      const dayIdx = date.getDay();
      if (dayIdx === 0 || dayIdx === 6) continue; // skip weekends
      const entry  = logMap.get(day);
      const hours  = entry ? parseFloat(entry.hoursVal.toFixed(2)) : 0;
      const status = entry?.status ?? "Absent";
      result.push({ day: String(day), hours, status });
    }
    return result;
  })();

  return (
    <>
    {reqToast && (
      <div className="fixed top-5 right-5 z-50 bg-[#4F3CC9] text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center gap-2">
        <CheckCircle size={16} /> {reqToast}
      </div>
    )}

    {showReqModal && (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowReqModal(false)}>
        <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-bold text-gray-900">Request Attendance Correction</h3>
              <p className="text-xs text-gray-400 mt-0.5">Submit to HR for review</p>
            </div>
            <button onClick={() => setShowReqModal(false)}><XCircle size={20} className="text-gray-400" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-orange-50 rounded-xl px-4 py-3 text-sm text-orange-700 flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>Were you present but marked <strong>Absent</strong>? Select the date, enter your actual arrival time, and describe the reason.</span>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Select Date</label>
              <select
                value={reqForm.selectedDate}
                onChange={(e) => {
                  const iso = e.target.value;
                  const selected = fullLog.find((d) => logDateToISO(d.date) === iso) ?? null;
                  setReqTarget(selected);
                  setReqForm({ ...reqForm, selectedDate: iso });
                }}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
              >
                <option value="">— Select a date —</option>
                {(() => {
                  const days: { date: string; label: string }[] = [];
                  for (let i = 0; i <= 7; i++) {
                    const d = new Date();
                    d.setDate(d.getDate() - i);
                    const dayName = d.toLocaleDateString("en-IN", { weekday: "short" });
                    if (dayName === "Sun" || dayName === "Sat") continue;
                    const iso = d.toISOString().slice(0, 10);
                    const label = `${dayName}, ${d.toLocaleDateString("en-IN", { day: "2-digit" })} ${d.toLocaleDateString("en-IN", { month: "short" })} ${d.getFullYear()}`;
                    if (getRequestForDate(iso)) continue;
                    days.push({ date: iso, label });
                  }
                  return days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>);
                })()}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Actual Arrival Time</label>
              <input type="time" value={reqForm.actualArrival}
                onChange={(e) => setReqForm({ ...reqForm, actualArrival: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Reason</label>
              <textarea rows={3} placeholder="e.g. Heavy traffic, metro suspended, medical emergency..."
                value={reqForm.reason}
                onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowReqModal(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={submitRequest}
                disabled={!reqForm.selectedDate || !reqForm.actualArrival || !reqForm.reason.trim()}
                className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-[#3d2fa3]">
                Submit to HR
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-500 text-sm mt-1">Track your daily attendance and working hours.</p>
          {/* Same rule line the HR view shows, so both sides read the same cutoff (ATT-003). */}
          <p className="text-xs text-gray-400 mt-1">
            Status rule: Present ≥ {minHours}h worked · Half Day = {halfDayThreshold > 0 ? `${halfDayThreshold}h to under ${minHours}h` : `any work under ${minHours}h`} · Absent = {halfDayThreshold > 0 ? `no clock-in or under ${halfDayThreshold}h` : "no clock-in"} · set by HR in Settings
          </p>
        </div>
        {empId && (
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-800">{empName}</p>
            <p className="text-xs text-gray-400">{empId} · {empDept}</p>
          </div>
        )}
      </div>

      {/* Clock In/Out */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleClockToggle}
              disabled={!empId}
              className={`w-36 h-36 rounded-full text-white text-lg font-bold shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                isClockedIn ? "bg-red-500 hover:bg-red-600" : "bg-[#4F3CC9] hover:bg-[#3d2fa3]"
              }`}
            >
              {!empId ? "Loading..." : isClockedIn ? "Clock Out" : "Clock In"}
            </button>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              isClockedIn ? "bg-green-100 text-green-700" : clockOutTime ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-600"
            }`}>
              <CheckCircle size={12} />
              {isClockedIn ? "Present" : clockOutTime ? "Clocked Out" : "Not Started"}
            </span>
          </div>

          <div className="flex-1 space-y-4 w-full">
            <div>
              <p className="text-xs text-gray-400 mb-1">Current Date & Time</p>
              <p className="text-base font-semibold text-gray-900">{currentDate}</p>
              <p className="text-3xl font-bold text-[#4F3CC9] tabular-nums mt-1">{currentTime}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#F5F3FF] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Clock In Time</p>
                <p className="text-lg font-bold text-gray-900">{clockInTime ?? "—"}</p>
              </div>
              <div className="bg-[#F5F3FF] rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Working Hours</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">
                  {isClockedIn ? fmt(workingSeconds, true) : finalSeconds != null ? fmt(finalSeconds) : "—"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Present Days",  val: presentCount, sub: `Out of ${totalWorkDays} working days`, icon: <CheckCircle size={18} className="text-green-600" />,  bg: "bg-green-50"  },
          { label: "Absent Days",   val: absentCount,  sub: "Unmarked absences",                    icon: <XCircle size={18} className="text-red-500" />,        bg: "bg-red-50"    },
          { label: "Half Days",     val: halfDayCount, sub: "Partial attendance",                   icon: <AlertCircle size={18} className="text-yellow-500" />, bg: "bg-yellow-50" },
          { label: "Late Logins",   val: lateCount,    sub: `After ${String(lateHour).padStart(2,"0")}:${String(lateMinute).padStart(2,"0")} AM`,                       icon: <Clock size={18} className="text-[#4F3CC9]" />,        bg: "bg-purple-50" },
        ].map(({ label, val, sub, icon, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{label}</span>
              <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>{icon}</div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{val}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Request Attendance Correction */}
      <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-orange-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Attendance marked incorrectly?</p>
            <p className="text-xs text-gray-500 mt-0.5">If you were present but marked Absent, raise a correction request and HR will review it.</p>
          </div>
        </div>
        <button
          onClick={() => {
            const absentDays = fullLog.filter((e) => e.status === "Absent" && !e.isWeekend && e.date !== getTodayDateStr());
            if (absentDays.length > 0) {
              setReqTarget(absentDays[0]);
              setReqForm({ actualArrival: "", reason: "", selectedDate: logDateToISO(absentDays[0].date) });
              setShowReqModal(true);
            }
          }}
          className="shrink-0 bg-orange-500 hover:bg-orange-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap"
        >
          + Request Attendance
        </button>
      </div>

      {/* My Requests */}
      {requests.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">My Attendance Requests</h2>
            <span className="text-xs bg-[#EDE9FF] text-[#4F3CC9] px-2 py-0.5 rounded-full font-semibold">{requests.length} submitted</span>
          </div>
          <div className="divide-y divide-gray-50">
            {requests.map((req) => (
              <div key={req.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${req.status === "Pending" ? "bg-yellow-400" : req.status === "Approved" ? "bg-green-500" : "bg-red-400"}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{req.date} <span className="text-gray-400 font-normal">· {req.day}</span></p>
                    <p className="text-xs text-gray-500 mt-0.5">Actual arrival: <span className="font-medium text-gray-700">{req.actualArrival}</span></p>
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.reason}</p>
                    {req.hrComment && <p className="text-xs text-[#4F3CC9] mt-1">HR: {req.hrComment}</p>}
                  </div>
                </div>
                <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${
                  req.status === "Pending"  ? "bg-yellow-100 text-yellow-700" :
                  req.status === "Approved" ? "bg-green-100 text-green-700" :
                  "bg-red-100 text-red-600"
                }`}>
                  {req.status === "Pending" ? "⏳ Pending" : req.status === "Approved" ? "✓ Approved" : "✗ Rejected"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance History */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Attendance History</h2>
          <div className="relative">
            <button
              onClick={() => setShowMonthPicker(p => !p)}
              className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-2 text-sm font-medium text-gray-700 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors bg-white"
            >
              <Calendar size={15} />
              {mStr} {historyYear}
              <ChevronDown size={13} className="text-gray-400" />
            </button>
            {showMonthPicker && (
              <div className="absolute right-0 top-11 z-30 bg-white border border-gray-100 rounded-2xl shadow-xl p-4 w-64">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setHistoryYear(y => y - 1)} className="text-xs px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-500">◀ Prev</button>
                  <span className="text-sm font-bold text-gray-800">{historyYear}</span>
                  <button onClick={() => setHistoryYear(y => Math.min(y + 1, now.getFullYear()))}
                    disabled={historyYear >= now.getFullYear()}
                    className="text-xs px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30">Next ▶</button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {SHORT_MONTHS.map((m, idx) => {
                    const isFuture = historyYear === now.getFullYear() && idx > now.getMonth();
                    return (
                      <button key={m} disabled={isFuture}
                        onClick={() => { setHistoryMonthIdx(idx); setShowMonthPicker(false); }}
                        className={`py-1.5 rounded-xl text-xs font-medium transition-colors
                          ${isFuture ? "text-gray-300 cursor-not-allowed" :
                            idx === historyMonthIdx ? "bg-[#4F3CC9] text-white" :
                            "hover:bg-[#EDE9FF] text-gray-600"}`}>
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F5F3FF]">
                {["Date","Clock In","Clock Out","Working Hours","Status","Late","Action"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleRows.map((row, i) => (
                <tr key={i} className={`transition-colors hover:bg-[#F5F3FF] ${row.date === getTodayDateStr() ? "bg-[#EDE9FF]/30 font-medium" : ""}`}>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{row.date}</p>
                    <p className="text-xs text-gray-400">{row.day}</p>
                  </td>
                  <td className={`px-6 py-4 text-sm ${row.late ? "text-orange-600 font-medium" : "text-gray-700"}`}>{row.clockIn}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{row.clockOut}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 tabular-nums">{row.hours}</td>
                  <td className="px-6 py-4"><StatusBadge status={row.status} /></td>
                  <td className="px-6 py-4">
                    {row.late
                      ? <span className="inline-flex px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">Yes</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">No</span>}
                  </td>
                  <td className="px-6 py-4">
                    {row.status === "Absent" && !row.isWeekend && (() => {
                      const req = getRequestForDate(row.date);
                      if (!req) return (
                        <button onClick={() => { setReqTarget(row); setReqForm({ actualArrival: "", reason: "", selectedDate: logDateToISO(row.date) }); setShowReqModal(true); }}
                          className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                          Raise Request
                        </button>
                      );
                      if (req.status === "Pending")  return <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-medium">⏳ Pending</span>;
                      if (req.status === "Approved") return <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium">✓ Approved</span>;
                      return <span className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-medium">✗ Rejected</span>;
                    })()}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && !empId && (
                <>{Array.from({ length: 6 }, (_, i) => (
                  <tr key={`skel-${i}`} className="border-b border-gray-100">
                    {Array.from({ length: 7 }, (_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-3.5 w-24 bg-gray-200/70 animate-pulse rounded" /></td>
                    ))}
                  </tr>
                ))}</>
              )}
              {visibleRows.length === 0 && empId && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400 text-sm">No records for this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Report */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Monthly Report</h2>
          <div className="relative">
            <select
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2 pr-10 text-sm font-medium text-gray-700 focus:outline-none focus:border-[#4F3CC9] cursor-pointer"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {Array.from({ length: 6 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                return d.toLocaleString("en-US", { month: "long", year: "numeric" });
              }).map((m) => <option key={m}>{m}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          {(() => {
            const [selMonthName, selYear] = selectedMonth.split(" ");
            const selMonthIdx2 = new Date(`${selMonthName} 1, ${selYear}`).getMonth();
            const selYearNum = parseInt(selYear);
            const selEntries = fullLog.filter(e => {
              const d = new Date(logDateToISO(e.date) + "T00:00:00");
              return d.getMonth() === selMonthIdx2 && d.getFullYear() === selYearNum;
            });
            const selPresent  = selEntries.filter(e => e.status === "Present").length;
            const selAbsent   = selEntries.filter(e => !e.isWeekend && e.status === "Absent").length;
            const selHalfDay  = selEntries.filter(e => e.status === "Half Day").length;
            const selHours    = selEntries.filter(e => e.hoursVal > 0);
            const avgHours    = selHours.length > 0
              ? fmt(Math.round(selHours.reduce((s, e) => s + e.hoursVal, 0) / selHours.length * 3600))
              : "—";
            return [
              { val: selPresent, label: "Present",   cls: "bg-green-50 text-green-700 text-green-600"  },
              { val: selAbsent,  label: "Absent",    cls: "bg-red-50 text-red-600 text-red-500"        },
              { val: selHalfDay, label: "Half Days", cls: "bg-yellow-50 text-yellow-600 text-yellow-500" },
              { val: avgHours,   label: "Avg Hours", cls: "bg-purple-50 text-[#4F3CC9] text-purple-500" },
            ].map(({ val, label, cls }) => {
              const [bg, text, sub] = cls.split(" ");
              return (
                <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
                  <p className={`text-2xl font-bold ${text}`}>{val}</p>
                  <p className={`text-xs ${sub} mt-1`}>{label}</p>
                </div>
              );
            });
          })()}
        </div>

        <p className="text-sm text-gray-500 mb-3">Hours Worked — {selectedMonth}</p>
        {barData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">No data for this month</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} barSize={barData.length > 20 ? 14 : 20} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <YAxis domain={[0, "auto"]} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <Tooltip
                contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: 12 }}
                formatter={(value, _name, props) => {
                  const h = Number(value ?? 0);
                  const status = (props.payload as { status?: string })?.status ?? "Absent";
                  return [h > 0 ? `${h}h` : `0h — ${status}`, "Hours Worked"];
                }}
                labelFormatter={(label) => `Day ${label}`}
              />
              <Bar dataKey="hours" radius={[5, 5, 0, 0]} minPointSize={3}>
                {barData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={
                      entry.hours > 0
                        ? "#4F3CC9"
                        : entry.status === "Leave"
                        ? "#F59E0B"
                        : "#E5E7EB"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="flex items-center gap-4 mt-3">
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-3 rounded-sm bg-[#4F3CC9] inline-block" />Present</span>
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-3 rounded-sm bg-[#E5E7EB] inline-block" />Absent</span>
          <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-3 h-3 rounded-sm bg-[#F59E0B] inline-block" />Leave</span>
        </div>
      </div>
    </div>
    </>
  );
}
