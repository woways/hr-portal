"use client";
import { useState, useEffect, useMemo } from "react";
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, Calendar } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs, setDoc, updateDoc, addDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

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
  const [lateHour, setLateHour]               = useState(10);
  const [lateMinute, setLateMinute]           = useState(0);

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

        const empSnap = await getDoc(doc(db, "employees", eid));
        if (!empSnap.exists()) return;
        const empData = empSnap.data();
        setEmpId(eid);
        setEmpName(empData.name ?? "");
        setEmpDept(empData.department ?? "");

        // Load late threshold from HR settings (e.g. "09:30")
        const timingsSnap = await getDoc(doc(db, "settings", "workTimings"));
        if (timingsSnap.exists()) {
          const threshold = (timingsSnap.data().lateThreshold as string) ?? "10:00";
          const [h, m] = threshold.split(":").map(Number);
          if (!isNaN(h)) { setLateHour(h); setLateMinute(m || 0); }
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, []);

  // ── Restore today's clock state from Firestore on mount ─────────────────────
  useEffect(() => {
    if (!empId) return;
    getDoc(doc(db, "attendance", `${todayISO()}-${empId}`))
      .then((snap) => {
        if (!snap.exists()) return;
        const rec = snap.data();
        setClockInTime(rec.clockIn ?? null);
        setClockInTimestamp(rec.clockInTs ?? null);
        setIsLate(rec.late ?? false);
        if (rec.clockIn && !rec.clockOut) {
          setIsClockedIn(true);
        } else if (rec.clockIn && rec.clockOut) {
          setClockOutTime(rec.clockOut ?? null);
          setFinalSeconds(rec.totalSeconds ?? null);
          setIsClockedIn(false);
        }
      })
      .catch(() => {});
  }, [empId]);

  // ── Load attendance history (past days) from Firestore ──────────────────────
  useEffect(() => {
    if (!empId) return;
    const todayIso = todayISO();
    getDocs(query(collection(db, "attendance"), where("empId", "==", empId)))
      .then((snap) => {
        const all = snap.docs.map((d) => d.data());
        const past = all
          .filter((rec) => rec.date && rec.date !== todayIso)
          .map((rec) => {
            // Parse as local midnight (avoids UTC-shift on "YYYY-MM-DD" strings)
            const d = new Date(rec.date + "T00:00:00");
            const dayIdx = d.getDay();
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            const hoursMatch = (rec.workingHours ?? "").match(/(\d+)h\s*(\d+)m/);
            const hoursVal = hoursMatch ? parseInt(hoursMatch[1]) + parseInt(hoursMatch[2]) / 60 : 0;
            return {
              date:     `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`,
              day:      DAY_ABBR[dayIdx],
              clockIn:  rec.clockIn  || "—",
              clockOut: rec.clockOut || "—",
              hours:    rec.workingHours || "—",
              hoursVal,
              status:   (rec.status || (isWeekend ? "Week Off" : "Absent")) as AttStatus,
              late:     rec.late ?? false,
              isWeekend,
            } as AttEntry;
          })
          .sort((a, b) => new Date(logDateToISO(b.date)).getTime() - new Date(logDateToISO(a.date)).getTime());
        setPastLog(past);
      })
      .catch(() => {});
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
      const late = h > lateHour || (h === lateHour && m > lateMinute);
      try {
        await setDoc(doc(db, "attendance", `${date}-${empId}`), {
          empId, name: empName, dept: empDept,
          date, clockIn: timeStr, clockInTs: ts, clockOut: "", workingHours: "",
          status: "Present", late, updatedAt: new Date().toISOString(),
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
      try {
        await updateDoc(doc(db, "attendance", `${date}-${empId}`), {
          clockOut: timeStr, clockOutTs: ts, totalSeconds: total,
          workingHours: wh, status: "Present", updatedAt: new Date().toISOString(),
        });
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
        userId: "HR",
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
      if (!approved) return entry;
      const [h, m] = approved.actualArrival.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return {
        ...entry,
        status: "Present" as const,
        clockIn: `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`,
        late: h > lateHour || (h === lateHour && m > lateMinute),
      };
    });
  }, [pastLog, todayEntry, requests]);

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

  // Bar chart — built from the full attendance log for the selected month
  const barData = (() => {
    const [selMonthName, selYear] = selectedMonth.split(" ");
    const selMonthIdx = new Date(`${selMonthName} 1, ${selYear}`).getMonth();
    const selYearNum  = parseInt(selYear);
    return fullLog
      .filter((e) => {
        if (e.hoursVal <= 0) return false;
        const d = new Date(logDateToISO(e.date) + "T00:00:00");
        return d.getMonth() === selMonthIdx && d.getFullYear() === selYearNum;
      })
      .map((e) => {
        const d = new Date(logDateToISO(e.date) + "T00:00:00");
        return { day: String(d.getDate()), hours: parseFloat(e.hoursVal.toFixed(2)) };
      })
      .sort((a, b) => parseInt(a.day) - parseInt(b.day))
      .slice(0, 30);
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
              {visibleRows.length === 0 && (
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
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={barData} barSize={20}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <YAxis domain={[0, 10]} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
              formatter={(value) => [`${value}h`, "Hours Worked"]} />
            <Bar dataKey="hours" fill="#4F3CC9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    </>
  );
}
