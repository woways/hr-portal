"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { Clock, CheckCircle, XCircle, AlertCircle, ChevronDown, Calendar } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { collection, query, where, onSnapshot, setDoc, addDoc, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEmployeeProfile } from "@/lib/useEmployeeProfile";
import { backfillEmployee, deletePreStartAttendance } from "@/lib/attendanceBackfill";
import { markEmpNotifRead } from "@/lib/firebaseService";
import { effectiveStatus } from "@/lib/attendanceStatus";

type AttStatus = "Present" | "Absent" | "Half Day" | "Leave" | "Week Off" | "Incomplete" | "Late" | "Late (Pending Review)";

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

interface LateReq {
  id: string;
  date: string;         // ISO YYYY-MM-DD
  day: string;
  clockInTime: string;  // "hh:mm AM/PM" — actual, preserved for audit
  cutoff: string;       // "HH:MM" 24h — active cutoff when raised
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  hrComment?: string;
}

// Past records loaded dynamically from attendance API — not hardcoded
let PAST_LOG: AttEntry[] = [];

// Bar data and monthly summary are computed from real clock records — no hardcoded data

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_ABBR    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function getTodayDateStr(): string {
  const d = new Date();
  return `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}, ${d.getFullYear()}`;
}
function getTodayDayStr(): string { return DAY_ABBR[new Date().getDay()]; }
function isTodayWeekend(): boolean { const day = new Date().getDay(); return day === 0 || day === 6; }
// Converts "May 08, 2026" → "2026-05-08" for matching against ISO dates from the API
function logDateToISO(logDate: string): string {
  const [mon, dayComma, year] = logDate.split(" ");
  const month = String(SHORT_MONTHS.indexOf(mon) + 1).padStart(2, "0");
  return `${year}-${month}-${dayComma.replace(",", "").padStart(2, "0")}`;
}

function getTodayMonthLabel(): string {
  const d = new Date();
  return `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;
}

function fmt(secs: number, showSeconds = false) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return showSeconds ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
}

function StatusBadge({ status }: { status: AttStatus }) {
  const map: Record<AttStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    Present:   { cls: "bg-green-100 text-green-700",   icon: <CheckCircle size={11} />,  label: "Present"  },
    Absent:    { cls: "bg-red-100 text-red-700",       icon: <XCircle size={11} />,      label: "Absent"   },
    "Half Day":{ cls: "bg-yellow-100 text-yellow-700", icon: <AlertCircle size={11} />,  label: "Half Day" },
    Leave:     { cls: "bg-blue-100 text-blue-700",     icon: <Clock size={11} />,        label: "Leave"    },
    "Week Off":{ cls: "bg-gray-100 text-gray-500",     icon: null,                       label: "Week Off" },
    Incomplete:{ cls: "bg-orange-100 text-orange-700", icon: <AlertCircle size={11} aria-hidden="true" />,  label: "Incomplete" },
    Late:      { cls: "bg-orange-100 text-orange-700", icon: <AlertCircle size={11} aria-hidden="true" />,  label: "Late" },
    "Late (Pending Review)": { cls: "bg-yellow-100 text-yellow-700", icon: <Clock size={11} aria-hidden="true" />, label: "Late (Pending Review)" },
  };
  // Defensive fallback so any future status label we don't yet know about
  // renders a neutral badge instead of crashing the whole page (WCAG 4.1.1).
  const entry = map[status] ?? { cls: "bg-gray-100 text-gray-500", icon: null, label: String(status) };
  const { cls, icon, label } = entry;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function AttendancePage() {
  const { empId, empName, empDept, doj } = useEmployeeProfile();
  const backfillDoneRef = useRef(false);
  const [pastLog, setPastLog] = useState<AttEntry[]>([]);
  const [requests, setRequests] = useState<RegRequest[]>([]);
  const [showReqModal, setShowReqModal] = useState(false);
  const [reqTarget, setReqTarget] = useState<AttEntry | null>(null);
  const [reqForm, setReqForm] = useState({ actualArrival: "", reason: "", selectedDate: "" });
  const [reqToast, setReqToast] = useState<string | null>(null);
  // Late Login Request state (parallel to Regularization; separate collection).
  const [lateRequests, setLateRequests] = useState<LateReq[]>([]);
  const [showLateModal, setShowLateModal] = useState(false);
  const [lateReqTarget, setLateReqTarget] = useState<AttEntry | null>(null);
  const [lateReqForm, setLateReqForm] = useState({ reason: "", selectedDate: "", clockInTime: "" });
  const [lateReqError, setLateReqError] = useState<string>("");
  const lateReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const lateModalOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [clockOutTime, setClockOutTime] = useState<string | null>(null);
  const [clockInTimestamp, setClockInTimestamp] = useState<number | null>(null);
  const [workingSeconds, setWorkingSeconds] = useState(0);
  const [finalSeconds, setFinalSeconds] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [isLate, setIsLate] = useState(false);
  const [minHours, setMinHours] = useState(8);
  const [halfDayThreshold, setHalfDayThreshold] = useState(4);
  const [lateHour, setLateHour] = useState(10);
  const [lateMinute, setLateMinute] = useState(30);
  // Clock-Out same-day cutoff (default 23:00) — after this, button disabled.
  const [clockOutCutoff, setClockOutCutoff] = useState("23:00");
  const [selectedMonth, setSelectedMonth] = useState(getTodayMonthLabel);

  // Present ≥ full day · Half Day = any work under a full day · Absent = no work.
  function statusFromHours(totalSeconds: number, isWeekend: boolean): AttStatus {
    if (isWeekend) return "Week Off";
    const hrs = totalSeconds / 3600;
    if (hrs >= minHours) return "Present";
    if (hrs > 0) return "Half Day";
    return "Absent";
  }

  useEffect(() => {
    getDoc(doc(db, "settings", "attendanceRules"))
      .then((snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as Record<string, unknown>;
        const mh = parseFloat(String(d.minHours));
        const hd = parseFloat(String(d.halfDayThreshold));
        if (!isNaN(mh)) setMinHours(mh);
        if (!isNaN(hd)) setHalfDayThreshold(hd);
        // Late Login Cutoff (drives isLate + Late Login Request flow).
        const llc = String(d.lateLoginCutoff ?? "").trim();
        const mLL = llc.match(/^(\d{1,2}):(\d{2})$/);
        if (mLL) { setLateHour(parseInt(mLL[1], 10)); setLateMinute(parseInt(mLL[2], 10)); }
        // Same-day Clock-Out Cutoff.
        const coc = String(d.clockOutCutoff ?? "").trim();
        if (/^(\d{1,2}):(\d{2})$/.test(coc)) setClockOutCutoff(coc);
      })
      .catch(() => { /* keep defaults */ });
    // Load the configured Late Login Threshold (e.g. "09:30") so late status is
    // driven by settings, not a hardcoded 10:00 cutoff.
    getDoc(doc(db, "settings", "workTimings"))
      .then((snap) => {
        const t = snap.exists() ? (snap.data().lateThreshold as string) : "";
        if (t) { const [h, m] = t.split(":").map(Number); if (!isNaN(h)) { setLateHour(h); setLateMinute(m || 0); } }
      })
      .catch(() => { /* keep defaults */ });
  }, []);
  const [historyYear, setHistoryYear]         = useState(() => new Date().getFullYear());
  const [historyMonthIdx, setHistoryMonthIdx] = useState(() => new Date().getMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  // Auto-mark unread attendance notifications as read when employee opens this page
  useEffect(() => { if (empId) markEmpNotifRead("attendance", empId); }, [empId]);

  // Backup listener on clockRecords — a Sunday clock-in that never mirrored to
  // attendance/ (e.g. write raced with an auth refresh) still surfaces from here
  // so the day is not silently missing from history.
  const [crBackup, setCrBackup] = useState<Record<string, { clockIn: string; clockOut: string; totalSeconds: number }>>({});
  useEffect(() => {
    if (!empId) return;
    const q2 = query(collection(db, "clockRecords"), where("empId", "==", empId));
    const unsub = onSnapshot(q2, (snap) => {
      const map: Record<string, { clockIn: string; clockOut: string; totalSeconds: number }> = {};
      snap.docs.forEach((d) => {
        const r = d.data() as Record<string, unknown>;
        const date = String(r.date ?? "");
        if (!date) return;
        map[date] = {
          clockIn:      String(r.clockInStr  ?? ""),
          clockOut:     String(r.clockOutStr ?? ""),
          totalSeconds: Number(r.totalSeconds ?? 0),
        };
      });
      setCrBackup(map);
    }, () => {});
    return () => unsub();
  }, [empId]);

  // Live listener for attendance history — HR changes reflect instantly without page refresh
  useEffect(() => {
    if (!empId) return;
    const todayIso = todayISO();
    const q = query(collection(db, "attendance"), where("empId", "==", empId), where("date", ">=", "2026-07-01"));
    const unsub = onSnapshot(q, (snap) => {
      const past = snap.docs
        .map(d => d.data() as Record<string, unknown>)
        .filter((rec) => rec.date && rec.date !== todayIso)
        .map((rec) => {
          const d = new Date((rec.date as string) + "T00:00:00");
          const dayIdx = d.getDay();
          const isWeekend = dayIdx === 0 || dayIdx === 6;
          const hoursMatch = ((rec.workingHours as string) ?? "").match(/(\d+)h\s*(\d+)m/);
          const hoursVal = hoursMatch ? parseInt(hoursMatch[1]) + parseInt(hoursMatch[2]) / 60 : 0;
          const clockInRaw  = (rec.clockIn  as string) || "";
          const clockOutRaw = (rec.clockOut as string) || "";
          // Missed clock-out: past day, employee clocked in but never clocked out.
          // Show as "Incomplete" (neutral status) so it's not counted as Present
          // or Absent. Actual clock-in and any other data stay untouched.
          const isMissedClockOut = !!clockInRaw && !clockOutRaw && !isWeekend;
          const rawStatus = (rec.status as string) || (isWeekend ? "Week Off" : "Absent");
          const status = (isMissedClockOut ? "Incomplete" : rawStatus) as AttStatus;
          return {
            date:     `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}, ${d.getFullYear()}`,
            day:      DAY_ABBR[dayIdx],
            clockIn:  clockInRaw  || "—",
            clockOut: isMissedClockOut ? "Missed" : (clockOutRaw || "—"),
            hours:    isMissedClockOut ? "—" : ((rec.workingHours as string) || "—"),
            hoursVal: isMissedClockOut ? 0 : hoursVal,
            status,
            late:     (rec.late as boolean) ?? false,
            isWeekend,
          } as AttEntry;
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      PAST_LOG = past;
      setPastLog(past);
    }, () => {});
    return () => unsub();
  }, [empId]);

  // Ref to track active clock session — prevents HR corrections from overwriting live state
  const isClockedInRef = useRef(false);
  useEffect(() => { isClockedInRef.current = isClockedIn; }, [isClockedIn]);

  // Restore today's clock session state from clockRecords on mount
  useEffect(() => {
    if (!empId) return;
    const todayId = `${todayISO()}-${empId}`;
    getDoc(doc(db, "clockRecords", todayId))
      .then((snap) => {
        if (!snap.exists()) return;
        const rec = snap.data() as Record<string, unknown>;
        if (rec.date !== todayISO()) return;
        setClockInTime(rec.clockInStr as string);
        setClockInTimestamp(rec.clockInTs as number);
        setIsLate((rec.isLate as boolean) ?? false);
        if (rec.status === "clocked-in") {
          setIsClockedIn(true);
        } else if (rec.status === "clocked-out") {
          setClockOutTime((rec.clockOutStr as string) ?? null);
          setFinalSeconds((rec.totalSeconds as number) ?? null);
          setIsClockedIn(false);
        }
      })
      .catch(() => {});
  }, [empId]);

  // ── Live listener for today's attendance doc — reflects HR corrections instantly ──
  useEffect(() => {
    if (!empId) return;
    const unsub = onSnapshot(doc(db, "attendance", `${todayISO()}-${empId}`), (snap) => {
      if (!snap.exists()) return;
      // Don't overwrite an active employee clock-in session
      if (isClockedInRef.current) return;
      const rec = snap.data() as Record<string, unknown>;
      const ci = (rec.clockIn as string) ?? null;
      const co = (rec.clockOut as string) ?? null;
      if (ci) setClockInTime(ci);
      if (rec.late !== undefined) setIsLate(rec.late as boolean);
      if (ci && co) {
        setClockOutTime(co);
        const ts = (rec.totalSeconds as number) ?? null;
        if (ts != null) setFinalSeconds(ts);
        setIsClockedIn(false);
      } else if (ci && !co) {
        setIsClockedIn(true);
      }
    }, () => {});
    return unsub;
  }, [empId]);

  // Real-time listener for this employee's regularization requests (client-side auth → no permission issues)
  useEffect(() => {
    if (!empId) return;
    const q = query(collection(db, "regularization"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      const mine: RegRequest[] = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return {
          id:            d.id,
          date:          String(r.date          ?? ""),
          day:           String(r.day           ?? ""),
          reason:        String(r.reason        ?? ""),
          actualArrival: String(r.actualArrival ?? ""),
          status:        (r.status ?? "Pending") as RegRequest["status"],
          hrComment:     String(r.hrComment     ?? ""),
          empId:         String(r.empId         ?? ""),
          empName:       String(r.empName       ?? ""),
        };
      });
      setRequests(mine);
    }, () => {}); // silently ignore permission errors
    return () => unsub();
  }, [empId]);

  // Real-time listener for this employee's Late Login Requests (separate
  // collection so the actual clockIn/clockOut on attendance/ stays untouched).
  useEffect(() => {
    if (!empId) return;
    const q = query(collection(db, "lateLoginRequests"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      const mine: LateReq[] = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return {
          id:          d.id,
          date:        String(r.date        ?? ""),
          day:         String(r.day         ?? ""),
          clockInTime: String(r.clockInTime ?? ""),
          cutoff:      String(r.cutoff      ?? ""),
          reason:      String(r.reason      ?? ""),
          status:      (r.status ?? "Pending") as LateReq["status"],
          hrComment:   String(r.hrComment   ?? ""),
        };
      });
      setLateRequests(mine);
    }, () => {});
    return () => unsub();
  }, [empId]);

  // One-time backfill: create "Absent" records in Firestore for all working days
  // in the past 30 days where this employee has no attendance record, then reload log
  useEffect(() => {
    if (!empId || backfillDoneRef.current) return;
    backfillDoneRef.current = true;
    const todayIso = todayISO();
    deletePreStartAttendance()
      .catch(() => {});
    backfillEmployee({ id: empId, name: empName, department: empDept, doj: doj || undefined })
      .then(async () => {
        try {
          const snap = await getDocs(query(collection(db, "attendance"), where("empId", "==", empId)));
          const all = snap.docs.map(d => d.data() as Record<string, unknown>);
          let past = all
            .filter((rec) => rec.date && rec.date !== todayIso)
            .map((rec) => {
              const isoDate = rec.date as string;
              const d = new Date(isoDate + "T00:00:00");
              const dayIdx = d.getDay();
              const isWeekend = dayIdx === 0 || dayIdx === 6;
              const hoursMatch = ((rec.workingHours as string) ?? "").match(/(\d+)h\s*(\d+)m/);
              const hoursVal = hoursMatch ? parseInt(hoursMatch[1]) + parseInt(hoursMatch[2]) / 60 : 0;
              return {
                date:     `${SHORT_MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}, ${d.getFullYear()}`,
                day:      DAY_ABBR[dayIdx],
                clockIn:  (rec.clockIn as string) || "—",
                clockOut: (rec.clockOut as string) || "—",
                hours:    (rec.workingHours as string) || "—",
                hoursVal,
                status:   ((rec.status as string) || (isWeekend ? "Week Off" : "Absent")) as AttStatus,
                late:     (rec.late as boolean) ?? false,
                isWeekend,
                isoDate,
              } as AttEntry & { isoDate: string };
            })
            .sort((a, b) => new Date(b.isoDate).getTime() - new Date(a.isoDate).getTime());

          // Backfill missing clockOut / workingHours from clockRecords
          const incomplete = past.filter(e => e.clockIn !== "—" && (e.clockOut === "—" || e.hours === "—"));
          if (incomplete.length > 0) {
            const dates = [...new Set(incomplete.map(e => e.isoDate))];
            const chunks: string[][] = [];
            for (let i = 0; i < dates.length; i += 30) chunks.push(dates.slice(i, i + 30));
            const crMap: Record<string, { clockIn: string; clockOut: string; totalSeconds: number }> = {};
            await Promise.all(chunks.map(async chunk => {
              const crSnap = await getDocs(query(
                collection(db, "clockRecords"),
                where("empId", "==", empId),
                where("date", "in", chunk)
              ));
              crSnap.docs.forEach(d2 => {
                const r = d2.data() as Record<string, unknown>;
                crMap[r.date as string] = {
                  clockIn:      (r.clockInStr  as string) ?? "",
                  clockOut:     (r.clockOutStr as string) ?? "",
                  totalSeconds: (r.totalSeconds as number) ?? 0,
                };
              });
            }));
            past = past.map(e => {
              const cr = crMap[e.isoDate];
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

          // Missed-clock-out pass (runs AFTER clockRecords backfill so we only
          // flag genuinely-missed punches, not race conditions). Actual clockIn
          // is preserved; clockOut column shows "Missed" and hours blank.
          const finalPast = past.map(({ isoDate: _iso, ...e }) => {
            const isMissed = !e.isWeekend
              && e.clockIn && e.clockIn !== "—"
              && (!e.clockOut || e.clockOut === "—")
              && (!e.hours || e.hours === "—");
            if (!isMissed) return e as AttEntry;
            return { ...e, clockOut: "Missed", hours: "—", hoursVal: 0, status: "Incomplete" as AttStatus };
          });
          PAST_LOG = finalPast;
          setPastLog(finalPast);
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, [empId, empName, empDept]);

  function getRequestForDate(date: string) {
    // date may be ISO ("2026-06-10") or log format ("Jun 10, 2026") — normalise both to ISO
    const iso = date.includes("-") ? date : logDateToISO(date);
    return requests.find((r) => r.date === iso);
  }

  function getLateRequestForDate(date: string): LateReq | undefined {
    const iso = date.includes("-") ? date : logDateToISO(date);
    return lateRequests.find((r) => r.date === iso);
  }

  function openLateRequestModal(row: AttEntry) {
    const iso = logDateToISO(row.date);
    setLateReqTarget(row);
    setLateReqForm({ reason: "", selectedDate: iso, clockInTime: row.clockIn || clockInTime || "" });
    setLateReqError("");
    setShowLateModal(true);
    // Focus the textarea after paint so keyboard users land inside the dialog.
    setTimeout(() => lateReasonRef.current?.focus(), 60);
  }

  function closeLateRequestModal() {
    setShowLateModal(false);
    setLateReqError("");
    // Return focus to the button that opened the modal (WCAG 2.4.3).
    setTimeout(() => lateModalOpenerRef.current?.focus(), 60);
  }

  async function submitLateRequest() {
    const reason = lateReqForm.reason.trim();
    if (!lateReqForm.selectedDate || !lateReqForm.clockInTime || !reason) {
      setLateReqError("Please write a reason for your late clock-in.");
      lateReasonRef.current?.focus();
      return;
    }
    const isoDate = lateReqForm.selectedDate;
    const dayLabel = new Date(isoDate + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
    const reqId = `${empId}-${isoDate}`;
    const now = new Date().toISOString();
    // Store the cutoff that was active when the employee raised the request so
    // HR sees the exact rule that flagged the day, even if Settings change later.
    const cutoff = String(lateHour).padStart(2, "0") + ":" + String(lateMinute).padStart(2, "0");
    try {
      await setDoc(doc(db, "lateLoginRequests", reqId), {
        id:          reqId,
        empId,
        empName,
        date:        isoDate,
        day:         lateReqTarget?.day ?? dayLabel,
        clockInTime: lateReqForm.clockInTime,
        cutoff,
        reason,
        status:      "Pending",
        hrComment:   "",
        createdAt:   now,
        updatedAt:   now,
      });
      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        empId,
        type:      "attendance",
        title:     `Late Login Request — ${empName}`,
        message:   `${empName} (${empId}) requested late-login review for ${isoDate}. Clocked in at ${lateReqForm.clockInTime} (cutoff ${cutoff}).`,
        read:      false,
        createdAt: now,
        refId:     reqId,
      });
      setShowLateModal(false);
      setLateReqForm({ reason: "", selectedDate: "", clockInTime: "" });
      setLateReqTarget(null);
      setLateReqError("");
      setReqToast("Late Login Request submitted to HR.");
      setTimeout(() => setReqToast(null), 4000);
    } catch (err) {
      // Surface the real Firestore/network error to devtools so future failures
      // can be diagnosed instead of blind-caught. The banner stays user-friendly.
      console.error("Late Login submit failed", err);
      setLateReqError("Failed to submit. Please check your connection and try again.");
      lateReasonRef.current?.focus();
    }
  }

  async function submitRequest() {
    if (!reqForm.selectedDate || !reqForm.actualArrival || !reqForm.reason.trim()) return;
    const isoDate = reqForm.selectedDate;
    const dayLabel = new Date(isoDate + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
    const reqId = `${empId}-${isoDate}`;
    const now = new Date().toISOString();

    try {
      // Write directly to Firestore from the authenticated client (bypasses server-side auth issue)
      await setDoc(doc(db, "regularization", reqId), {
        id:            reqId,
        empId,
        empName,
        date:          isoDate,
        day:           reqTarget?.day ?? dayLabel,
        reason:        reqForm.reason.trim(),
        actualArrival: reqForm.actualArrival,
        status:        "Pending",
        hrComment:     "",
        updatedAt:     now,
      });
      // Notify HR via the notifications collection (already has Firestore rules)
      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        empId,
        type:      "attendance",
        title:     `Attendance Correction — ${empName}`,
        message:   `${empName} (${empId}) requested attendance correction for ${isoDate}. Actual arrival: ${reqForm.actualArrival}.`,
        read:      false,
        createdAt: now,
        refId:     reqId,
      });
      setShowReqModal(false);
      setReqForm({ actualArrival: "", reason: "", selectedDate: "" });
      setReqTarget(null);
      setReqToast("Regularization request submitted to HR!");
      setTimeout(() => setReqToast(null), 4000);
    } catch {
      setReqToast("Failed to submit. Please check your connection.");
      setTimeout(() => setReqToast(null), 4000);
    }
  }

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
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [clockInTimestamp, isClockedIn]);

  async function handleClockToggle() {
    const now = new Date();
    const ts = now.getTime();
    const timeStr = fmtTime(ts);
    const date = todayISO();

    const clockId = `${date}-${empId}`;
    const now2 = new Date().toISOString();

    // Enforce same-day Clock-Out cutoff (default 23:00). No-op if past cutoff —
    // the button is already disabled visually; this guards against any bypass.
    if (isClockedIn) {
      const [coH, coM] = (clockOutCutoff || "23:00").split(":").map(Number);
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const cutMins = (coH || 0) * 60 + (coM || 0);
      if (nowMins >= cutMins) return;
    }

    if (!isClockedIn) {
      const late = now.getHours() > lateHour || (now.getHours() === lateHour && now.getMinutes() > lateMinute);
      setClockInTime(timeStr);
      setClockInTimestamp(ts);
      setClockOutTime(null);
      setFinalSeconds(null);
      setWorkingSeconds(0);
      setIsLate(late);
      setIsClockedIn(true);

      // Write clock record directly to Firestore (authenticated client — no API route needed)
      Promise.all([
        setDoc(doc(db, "clockRecords", clockId), {
          empId, empName, department: empDept,
          date, clockInTs: ts, clockInStr: timeStr,
          clockOutTs: null, clockOutStr: null, totalSeconds: null,
          isLate: late, status: "clocked-in", updatedAt: now2,
        }, { merge: true }),
        // Mirror into attendance collection so HR dashboard sees this immediately
        setDoc(doc(db, "attendance", clockId), {
          empId, name: empName, dept: empDept,
          date, clockIn: timeStr, clockOut: "",
          workingHours: "", overtimeHours: "-",
          status: "Present", late, updatedAt: now2,
        }, { merge: true }),
      ]).catch(() => {});

    } else {
      const total = workingSeconds;
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const workingHoursStr = `${h}h ${String(m).padStart(2, "0")}m`;

      setClockOutTime(timeStr);
      setFinalSeconds(total);
      setClockInTimestamp(null);
      setIsClockedIn(false);

      // Update clock record and attendance record directly in Firestore
      Promise.all([
        setDoc(doc(db, "clockRecords", clockId), {
          clockOutTs: ts, clockOutStr: timeStr,
          totalSeconds: total, status: "clocked-out", updatedAt: now2,
        }, { merge: true }),
        setDoc(doc(db, "attendance", clockId), {
          clockOut: timeStr, workingHours: workingHoursStr,
          status: statusFromHours(total, [0, 6].includes(new Date(date + "T00:00:00").getDay())), updatedAt: now2,
        }, { merge: true }),
      ]).catch(() => {});
    }
  }

  const displayedSecs = finalSeconds ?? (isClockedIn ? workingSeconds : 0);

  // Today's entry — fully dynamic: uses real current date, day, and clock state
  const todayEntry = useMemo<AttEntry>(() => {
    const weekend = isTodayWeekend();
    // Prioritise clock-in over weekend: if the employee clocked in, mark as Present
    return {
      date:     getTodayDateStr(),
      day:      getTodayDayStr(),
      clockIn:  clockInTime  ?? "—",
      clockOut: clockOutTime ?? (isClockedIn ? "Ongoing" : "—"),
      hours:    clockInTime  ? fmt(displayedSecs, isClockedIn) : "—",
      hoursVal: displayedSecs / 3600,
      status:   clockInTime ? "Present" : (weekend ? "Week Off" : "Absent"),
      late:     isLate && !!clockInTime,
      isWeekend: weekend && !clockInTime,
    };
  }, [clockInTime, clockOutTime, isClockedIn, displayedSecs, isLate]);

  // Merge approved regularization requests into the log so status reflects HR decisions
  const fullLog = useMemo<AttEntry[]>(() => {
    const base = [todayEntry, ...pastLog];
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
  }, [todayEntry, requests, pastLog]);

  // Stats from today's-month entries only
  const currentMonthLabel = getTodayMonthLabel();
  const currentMonthEntries = fullLog.filter(e => {
    // Match entries belonging to the current month/year
    const d = new Date();
    const mStr = SHORT_MONTHS[d.getMonth()];
    return e.date.startsWith(mStr) && e.date.endsWith(String(d.getFullYear()));
  });
  // BUG-06: derive status so employee tile matches HR dashboard/reports.
  const cmDerived = currentMonthEntries.map(e => ({ e, eff: effectiveStatus(e) }));
  const presentCount  = cmDerived.filter(x => x.eff === "Present").length;
  const absentCount   = cmDerived.filter(x => !x.e.isWeekend && x.eff === "Absent").length;
  const halfDayCount  = cmDerived.filter(x => x.eff === "Half Day").length;
  const lateCount     = currentMonthEntries.filter(e => e.late).length;
  // Compute total working days for the current month dynamically
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
              <span>Want to correct your attendance for any past working day? The date is pre-filled from the row you clicked — you can change it below if needed.</span>
            </div>

            {/* Date — editable date input. Pre-filled from the row that opened
                the modal (if any); the user can still change it to any past
                day up to today. min = employee's joining date, max = today. */}
            <div>
              <label htmlFor="reg-req-date" className="text-xs font-medium text-gray-600 block mb-1">Date</label>
              <input
                id="reg-req-date"
                type="date"
                value={reqForm.selectedDate}
                min={doj || undefined}
                max={todayISO()}
                onChange={(e) => {
                  const iso = e.target.value;
                  // If the picked date matches an existing log row, sync reqTarget
                  // so the day label and clock-in context still surface correctly.
                  const selected = fullLog.find((d) => logDateToISO(d.date) === iso) ?? null;
                  setReqTarget(selected);
                  setReqForm({ ...reqForm, selectedDate: iso });
                }}
                aria-describedby="reg-req-date-help"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
              />
              {reqTarget?.day && (
                <p id="reg-req-date-help" className="mt-1 text-xs text-gray-400">{reqTarget.day} · {reqTarget.date}</p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Actual Arrival Time</label>
              <input
                type="time"
                value={reqForm.actualArrival}
                onChange={(e) => setReqForm({ ...reqForm, actualArrival: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Reason</label>
              <textarea
                rows={3}
                placeholder="e.g. Heavy traffic on outer ring road, metro suspended, medical emergency..."
                value={reqForm.reason}
                onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowReqModal(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button
                onClick={submitRequest}
                disabled={!reqForm.selectedDate || !reqForm.actualArrival || !reqForm.reason.trim()}
                className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-[#3d2fa3]"
              >
                Submit to HR
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {showLateModal && lateReqTarget && (
      <div
        className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
        onClick={closeLateRequestModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="late-req-title"
        onKeyDown={(e) => { if (e.key === "Escape") closeLateRequestModal(); }}
      >
        <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h3 id="late-req-title" className="font-bold text-gray-900">Raise Late Login Request</h3>
              <p className="text-xs text-gray-400 mt-0.5">Ask HR to excuse your late clock-in</p>
            </div>
            <button
              type="button"
              onClick={closeLateRequestModal}
              aria-label="Close late login request dialog"
            >
              <XCircle size={20} className="text-gray-400" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="bg-orange-50 rounded-xl px-4 py-3 text-sm text-orange-700 flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Your actual clock-in and clock-out times are always preserved. If HR approves, your status for the day updates to <strong>Present</strong>; your working hours stay based on the actual times.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Date</div>
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm text-gray-900">
                  {lateReqTarget?.date || lateReqForm.selectedDate || "—"}
                  {lateReqTarget?.day ? <span className="text-gray-400"> · {lateReqTarget.day}</span> : null}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Actual Clock-In</div>
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm text-gray-900">
                  {lateReqForm.clockInTime || "—"}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="late-req-reason" className="text-xs font-medium text-gray-600 block mb-1">
                Reason <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <textarea
                id="late-req-reason"
                ref={lateReasonRef}
                rows={4}
                placeholder="e.g. Traffic jam on ORR, unwell in the morning, urgent family matter…"
                value={lateReqForm.reason}
                onChange={(e) => { setLateReqForm({ ...lateReqForm, reason: e.target.value }); if (lateReqError) setLateReqError(""); }}
                aria-required="true"
                aria-invalid={!!lateReqError}
                aria-describedby={lateReqError ? "late-req-error" : undefined}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none"
              />
              {lateReqError && (
                <p id="late-req-error" role="alert" className="mt-1 text-xs text-red-600">
                  {lateReqError}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={closeLateRequestModal}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitLateRequest}
                className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3]"
              >
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
            Status rule: Present ≥ {minHours}h worked · Half Day = any work under {minHours}h · Absent = no clock-in
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
        {(() => {
          // Same-day Clock-Out cutoff (e.g. 23:00). currentTime updates every second
          // so this re-evaluates without any extra state. If the employee is clocked
          // in past the cutoff, we disable the button and show a Regularization hint.
          const [coH, coM] = (clockOutCutoff || "23:00").split(":").map(Number);
          const now = new Date();
          const nowMins = now.getHours() * 60 + now.getMinutes();
          const cutMins = (coH || 0) * 60 + (coM || 0);
          const pastCutoff = isClockedIn && nowMins >= cutMins;
          const buttonDisabled = !empId || pastCutoff;
          const to12h = (hh: number, mm: number) => {
            const suffix = hh >= 12 ? "PM" : "AM";
            const h12 = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
            return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${suffix}`;
          };
          return (
        <>
        {pastCutoff && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Clock-Out window closed</p>
              <p className="text-xs mt-0.5">
                The daily Clock-Out cutoff was <strong>{to12h(coH || 23, coM || 0)}</strong>. Please raise a
                {" "}<strong>Regularization Request</strong> below to record your actual clock-out time. Your clock-in time and today&apos;s hours are preserved.
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleClockToggle}
              disabled={buttonDisabled}
              aria-disabled={buttonDisabled}
              aria-describedby={pastCutoff ? "clock-out-cutoff-note" : undefined}
              title={pastCutoff ? `Clock-Out is disabled after ${to12h(coH || 23, coM || 0)}. Use Regularization.` : undefined}
              className={`w-36 h-36 rounded-full text-white text-lg font-bold shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                isClockedIn ? "bg-red-500 hover:bg-red-600" : "bg-[#4F3CC9] hover:bg-[#3d2fa3]"
              }`}
            >
              {!empId ? "Loading..." : isClockedIn ? "Clock Out" : "Clock In"}
            </button>
            {pastCutoff && (
              <span id="clock-out-cutoff-note" className="sr-only">
                Clock-Out is disabled after {to12h(coH || 23, coM || 0)}. Raise a regularization request to record the correct clock-out.
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              isClockedIn ? "bg-green-100 text-green-700" : clockOutTime ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-600"
            }`}>
              <CheckCircle size={12} aria-hidden="true" />
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
        </>
          );
        })()}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Present Days",   val: presentCount,  sub: `Out of ${totalWorkDays} working days`, icon: <CheckCircle size={18} className="text-green-600" />,  bg: "bg-green-50"  },
          { label: "Absent Days",    val: absentCount,   sub: "Unmarked absences",                     icon: <XCircle size={18} className="text-red-500" />,        bg: "bg-red-50"    },
          { label: "Half Days",      val: halfDayCount,  sub: "Partial attendance",                    icon: <AlertCircle size={18} className="text-yellow-500" />, bg: "bg-yellow-50" },
          { label: "Late Logins",    val: lateCount,     sub: `After ${String(lateHour).padStart(2,"0")}:${String(lateMinute).padStart(2,"0")}`, icon: <Clock size={18} className="text-[#4F3CC9]" />,        bg: "bg-purple-50" },
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
            // Pre-select the most recent absent day (if any), otherwise open blank modal
            const absentDays = fullLog.filter((e) => e.status === "Absent" && !e.isWeekend && e.date !== getTodayDateStr());
            if (absentDays.length > 0) {
              const isoDate = logDateToISO(absentDays[0].date); // convert to ISO for the select
              setReqTarget(absentDays[0]);
              setReqForm({ actualArrival: "", reason: "", selectedDate: isoDate });
            } else {
              setReqTarget(null);
              setReqForm({ actualArrival: "", reason: "", selectedDate: "" });
            }
            setShowReqModal(true); // always open — was missing before
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

      {/* Attendance History with Calendar */}
      {(() => {
        const now = new Date();
        const isCurrentMonth = historyYear === now.getFullYear() && historyMonthIdx === now.getMonth();
        const canGoNext = !(historyYear === now.getFullYear() && historyMonthIdx >= now.getMonth());
        const mStr = SHORT_MONTHS[historyMonthIdx];
        // Build a COMPLETE list of days for the selected month so history is not
        // limited to only days that have a Firestore attendance doc. For any day
        // without an entry we synthesize a neutral row (Week Off for Sat/Sun,
        // otherwise Absent — same treatment as the rest of the page). Existing
        // entries from fullLog override the synthesized row.
        const monthEntries = (() => {
          const dojD   = doj ? new Date(doj + "T00:00:00") : null;
          const dojKey = dojD ? dojD.getFullYear() * 12 + dojD.getMonth() : null;
          const monKey = historyYear * 12 + historyMonthIdx;
          // Nothing to show for months before joining.
          if (dojKey !== null && monKey < dojKey) return [] as AttEntry[];
          const daysInMonth = new Date(historyYear, historyMonthIdx + 1, 0).getDate();
          const todayIso = todayISO();
          const existingByLabel = new Map(fullLog.map((e) => [e.date, e]));
          const rows: AttEntry[] = [];
          for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(historyYear, historyMonthIdx, d);
            const iso = `${historyYear}-${String(historyMonthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            // Skip days before DOJ and days after today.
            if (dojD && dt < new Date(dojD.getFullYear(), dojD.getMonth(), dojD.getDate())) continue;
            if (iso > todayIso) continue;
            const label = `${mStr} ${String(d).padStart(2, "0")}, ${historyYear}`;
            const existing = existingByLabel.get(label);
            const dayIdx = dt.getDay();
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            const punch = crBackup[iso];
            // Existing attendance/ row usually wins — BUT the nightly backfill
            // seeds every workday with an empty "Absent" stub, and if the
            // employee later clocked in/out but the mirror write did not land
            // (network race, auth refresh), that stub sticks with clockIn="—".
            // The raw clockRecords/ punch log is the source of truth for what
            // was actually punched, so merge it in when the mirror is empty.
            if (existing) {
              const mirrorEmpty = !existing.clockIn || existing.clockIn === "—";
              if (mirrorEmpty && punch && (punch.clockIn || punch.clockOut)) {
                const h = Math.floor(punch.totalSeconds / 3600);
                const m = Math.floor((punch.totalSeconds % 3600) / 60);
                const hoursStr = punch.totalSeconds > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : "—";
                rows.push({
                  ...existing,
                  clockIn:  punch.clockIn  || "—",
                  clockOut: punch.clockOut || "—",
                  hours:    hoursStr,
                  hoursVal: punch.totalSeconds > 0 ? punch.totalSeconds / 3600 : 0,
                  status:   (isWeekend ? "Week Off" : (punch.clockOut ? "Present" : "Incomplete")) as AttStatus,
                });
                continue;
              }
              rows.push(existing);
              continue;
            }
            // No attendance/ mirror at all — reconstruct from clockRecords if any.
            if (punch && (punch.clockIn || punch.clockOut)) {
              const h = Math.floor(punch.totalSeconds / 3600);
              const m = Math.floor((punch.totalSeconds % 3600) / 60);
              const hoursStr = punch.totalSeconds > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : "—";
              rows.push({
                date: label,
                day: DAY_ABBR[dayIdx],
                clockIn:  punch.clockIn  || "—",
                clockOut: punch.clockOut || (punch.clockIn ? "—" : "—"),
                hours:    hoursStr,
                hoursVal: punch.totalSeconds > 0 ? punch.totalSeconds / 3600 : 0,
                status:   (isWeekend ? "Week Off" : (punch.clockOut ? "Present" : "Incomplete")) as AttStatus,
                late:     false,
                isWeekend,
              });
              continue;
            }
            rows.push({
              date: label,
              day: DAY_ABBR[dayIdx],
              clockIn: "—",
              clockOut: "—",
              hours: "—",
              hoursVal: 0,
              status: (isWeekend ? "Week Off" : "Absent") as AttStatus,
              late: false,
              isWeekend,
            });
          }
          // Newest date first — matches how fullLog is sorted elsewhere.
          return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        })();


        return (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Header with calendar month/year picker */}
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

                {showMonthPicker && (() => {
                  const dojDate   = doj ? new Date(doj + "T00:00:00") : null;
                  const dojYear   = dojDate ? dojDate.getFullYear() : now.getFullYear();
                  const dojMonth  = dojDate ? dojDate.getMonth()    : 0;
                  return (
                  <div className="absolute right-0 top-11 z-30 bg-white border border-gray-100 rounded-2xl shadow-xl p-4 w-64">
                    {/* Year selector */}
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={() => setHistoryYear(y => y - 1)}
                        disabled={historyYear <= dojYear}
                        className="text-xs px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
                      >◀ Prev</button>
                      <span className="text-sm font-bold text-gray-800">{historyYear}</span>
                      <button
                        onClick={() => setHistoryYear(y => Math.min(y + 1, now.getFullYear()))}
                        disabled={historyYear >= now.getFullYear()}
                        className="text-xs px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
                      >Next ▶</button>
                    </div>
                    {/* Month grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {SHORT_MONTHS.map((m, idx) => {
                        const isFuture  = historyYear === now.getFullYear() && idx > now.getMonth();
                        const isBeforeDoj = historyYear === dojYear && idx < dojMonth;
                        const disabled  = isFuture || isBeforeDoj;
                        return (
                          <button
                            key={m}
                            disabled={disabled}
                            onClick={() => { setHistoryMonthIdx(idx); setShowMonthPicker(false); }}
                            className={`py-1.5 rounded-xl text-xs font-medium transition-colors
                              ${disabled ? "text-gray-300 cursor-not-allowed" :
                                idx === historyMonthIdx ? "bg-[#4F3CC9] text-white" :
                                "hover:bg-[#EDE9FF] text-gray-600"}`}
                          >{m}</button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })()}
              </div>
            </div>

            {/* Detail table for the month */}
            <div>
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
                    {monthEntries.filter(e => !e.isWeekend || e.clockIn !== "—").map((row, i) => (
                      <tr key={i} className={`transition-colors hover:bg-[#F5F3FF] ${row.date === getTodayDateStr() ? "bg-[#EDE9FF]/30 font-medium" : ""}`}>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-gray-900">{row.date}</p>
                          <p className="text-xs text-gray-400">{row.day}</p>
                        </td>
                        <td className={`px-6 py-4 text-sm ${row.late ? "text-orange-600 font-medium" : "text-gray-700"}`}>{row.clockIn}</td>
                        <td className={`px-6 py-4 text-sm ${row.clockOut === "Missed" ? "text-red-600 font-medium" : "text-gray-700"}`}>{row.clockOut}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 tabular-nums">{row.hours}</td>
                        <td className="px-6 py-4">
                          {(() => {
                            // Derive from actual clockIn/clockOut so a stale stored
                            // "Absent" status on a day the employee clearly worked
                            // (both clock times present) is corrected in the display.
                            const derived = effectiveStatus({
                              clockIn: row.clockIn === "—" ? "" : row.clockIn,
                              clockOut: row.clockOut === "—" || row.clockOut === "Missed" ? "" : row.clockOut,
                              workingHours: row.hours === "—" ? "" : row.hours,
                              status: row.status,
                            }) as AttStatus;
                            return <StatusBadge status={derived} />;
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {row.late ? <span className="inline-flex px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-medium">Yes</span>
                                    : <span className="inline-flex px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">No</span>}
                        </td>
                        <td className="px-6 py-4">
                          {row.status === "Absent" && (() => {
                            const req = getRequestForDate(row.date);
                            if (!req) return <button onClick={() => { setReqTarget(row); setReqForm({ actualArrival: "", reason: "", selectedDate: logDateToISO(row.date) }); setShowReqModal(true); }} className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">Raise Request</button>;
                            if (req.status === "Pending")  return <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-medium" aria-label="Regularization request pending">⏳ Pending</span>;
                            if (req.status === "Approved") return <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium" aria-label="Regularization request approved">✓ Approved</span>;
                            return <span className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-medium" aria-label="Regularization request rejected">✗ Rejected</span>;
                          })()}
                          {row.status !== "Absent" && row.late && (() => {
                            const lreq = getLateRequestForDate(row.date);
                            if (!lreq) return (
                              <button
                                type="button"
                                ref={row.date === getTodayDateStr() ? lateModalOpenerRef : undefined}
                                onClick={() => openLateRequestModal(row)}
                                aria-label={`Raise Late Login Request for ${row.date}`}
                                className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 px-3 py-1.5 rounded-full font-medium whitespace-nowrap"
                              >
                                Raise Late Login Request
                              </button>
                            );
                            if (lreq.status === "Pending")  return <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1.5 rounded-full font-medium" aria-label="Late Login Request pending">⏳ Pending Review</span>;
                            if (lreq.status === "Approved") return <span className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-medium" aria-label="Late Login Request approved by HR">✓ Approved</span>;
                            return <span className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-full font-medium" aria-label="Late Login Request rejected by HR">✗ Rejected</span>;
                          })()}
                        </td>
                      </tr>
                    ))}
                    {monthEntries.filter(e => !e.isWeekend || e.clockIn !== "—").length === 0 && (
                      <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400 text-sm">No records for this month</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Monthly Report */}
      {(() => {
        // Generate months from joining date up to today
        const dojDate = doj ? new Date(doj + "T00:00:00") : null;
        const monthOptions = Array.from({ length: 6 }, (_, i) => {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth() - i);
          return d;
        }).filter(d => !dojDate || d >= new Date(dojDate.getFullYear(), dojDate.getMonth(), 1))
          .map(d => d.toLocaleString("en-US", { month: "long", year: "numeric" }));
        // Compute selected month stats from real fullLog entries
        const [selMonthName, selYear] = selectedMonth.split(" ");
        const selMonthIdx = new Date(`${selMonthName} 1, ${selYear}`).getMonth();
        const selYearNum = parseInt(selYear);
        const selEntries = fullLog.filter(e => {
          const mStr = SHORT_MONTHS[selMonthIdx];
          return e.date.startsWith(mStr) && e.date.endsWith(String(selYearNum));
        }).filter(e => !e.isWeekend);
        const selDerived = selEntries.map(e => effectiveStatus(e));
        const selPresent  = selDerived.filter(s => s === "Present").length;
        const selAbsent   = selDerived.filter(s => s === "Absent").length;
        const selHalfDay  = selDerived.filter(s => s === "Half Day").length;
        const selHoursArr = selEntries.map(e => e.hoursVal).filter(h => h > 0);
        const selAvgHours = selHoursArr.length > 0
          ? (selHoursArr.reduce((a, b) => a + b, 0) / selHoursArr.length).toFixed(1) + "h"
          : "—";

        // Build bar chart data from actual attendance entries for the selected month
        // e.date format: "Jun 29, 2026" — extract the day number from the middle segment
        const barData = selEntries
          .filter(e => e.hoursVal > 0)
          .map(e => ({
            day: String(parseInt(e.date.split(" ")[1])),   // "Jun 29, 2026" → "29"
            hours: parseFloat(e.hoursVal.toFixed(2)),
          }))
          .sort((a, b) => parseInt(a.day) - parseInt(b.day));
        return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-900">Monthly Report</h2>
          <div className="relative">
            <select
              className="appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2 pr-10 text-sm font-medium text-gray-700 focus:outline-none focus:border-[#4F3CC9] cursor-pointer"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((m) => <option key={m}>{m}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{selPresent}</p>
            <p className="text-xs text-green-600 mt-1">Present</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{selAbsent}</p>
            <p className="text-xs text-red-500 mt-1">Absent</p>
          </div>
          <div className="bg-yellow-50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{selHalfDay}</p>
            <p className="text-xs text-yellow-500 mt-1">Half Days</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-[#4F3CC9]">{selAvgHours}</p>
            <p className="text-xs text-purple-500 mt-1">Avg Hours</p>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-3">Hours Worked — {selectedMonth}</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={barData} barSize={20}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <YAxis domain={[0, Math.max(10, ...barData.map(d => d.hours)) + 1]} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <Tooltip
              contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
              formatter={(value) => [`${value}h`, "Hours Worked"]}
            />
            <Bar dataKey="hours" fill="#4F3CC9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
        );
      })()}
    </div>
    </>
  );
}
