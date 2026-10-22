"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Clock, CheckCircle, CalendarDays, Bell, AlertCircle,
  CalendarOff, Target, IndianRupee, Megaphone, BookOpen, KeyRound, X, ArrowRight,
} from "lucide-react";
import { useEmployeeProfile } from "@/lib/useEmployeeProfile";
import { useHolidayMap } from "@/lib/useHolidays";
import { shouldPromptPasswordChange } from "@/lib/passwordFlag";
import {
  collection, query, where, onSnapshot, doc, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface LeaveRequest { status: string; leaveType: string; days?: number; }

const DEFAULT_LEAVE_POLICIES: { type: string; days: number }[] = [
  { type: "Casual Leave", days: 12 },
  { type: "Sick Leave", days: 10 },
  { type: "Emergency Leave", days: 3 },
  { type: "Paid Leave", days: 15 },
];

interface ClockRecord {
  empId: string; date: string;
  clockInTs: number; clockInStr: string;
  clockOutTs?: number; clockOutStr?: string;
  totalSeconds?: number;
  status: "clocked-in" | "clocked-out";
  isLate: boolean;
}

interface AppNotification {
  id: string; type: string; title: string; message: string;
  createdAt: string; read: boolean;
}

function fmtDuration(s: number): string {
  if (s <= 0) return "0h 0m 0s";
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const NOTIF_ICON: Record<string, typeof Bell> = {
  leave: CalendarOff, goal: Target, payroll: IndianRupee,
  system: Megaphone, attendance: Clock,
};
const NOTIF_CLS: Record<string, string> = {
  leave: "bg-yellow-50 text-yellow-600",
  goal: "bg-purple-50 text-purple-600",
  payroll: "bg-green-50 text-green-600",
  system: "bg-blue-50 text-blue-600",
  attendance: "bg-orange-50 text-orange-600",
};

export default function DashboardPage() {
  const { empId, empName, loading: profileLoading } = useEmployeeProfile();
  const router = useRouter();
  // First-login prompt (fires on dashboard mount if the signed-in user has
  // never changed their temp password). Dismissal is per-session only.
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  const firstLoginReturnFocusRef = useRef<HTMLElement | null>(null);
  const firstLoginDialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    (async () => {
      try {
        if (sessionStorage.getItem("firstLoginPromptDismissed") === "1") return;
      } catch { /* ignore */ }
      const should = await shouldPromptPasswordChange();
      if (should) {
        firstLoginReturnFocusRef.current = document.activeElement as HTMLElement | null;
        setShowFirstLogin(true);
      }
    })();
  }, []);
  function closeFirstLogin(dismiss = true) {
    setShowFirstLogin(false);
    if (dismiss) {
      try { sessionStorage.setItem("firstLoginPromptDismissed", "1"); } catch { /* ignore */ }
    }
    setTimeout(() => firstLoginReturnFocusRef.current?.focus(), 50);
  }
  function openChangePassword() {
    closeFirstLogin(false);
    router.push("/employee/dashboard/profile#change-password");
  }

  // Portal Guide modal — on-demand quick reference for employees.
  const [showGuide, setShowGuide] = useState(false);
  const guideTriggerRef = useRef<HTMLButtonElement | null>(null);
  const guideSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  function openGuide() {
    guideTriggerRef.current = document.activeElement as HTMLButtonElement | null;
    setShowGuide(true);
  }
  function closeGuide() {
    setShowGuide(false);
    setTimeout(() => guideTriggerRef.current?.focus(), 50);
  }
  function jumpToGuideSection(id: string) {
    const el = guideSectionRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }
  // Upcoming-holiday banner source. Groups consecutive dates with the same
  // name into a single range (e.g. "Dasara — 20–21 October 2026").
  const holidayMap = useHolidayMap();
  const upcomingHoliday = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 14); // show anything in the next ~2 weeks
    // Flatten + sort + filter.
    const entries = Array.from(holidayMap.entries())
      .map(([iso, name]) => ({ iso, name, dt: new Date(iso + "T00:00:00") }))
      .filter(e => e.dt >= today && e.dt <= horizon)
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
    if (entries.length === 0) return null;
    // Group same-name consecutive runs starting from the earliest.
    const first = entries[0];
    const run = [first];
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const cur  = entries[i];
      const dayGap = Math.round((cur.dt.getTime() - prev.dt.getTime()) / 86400000);
      if (cur.name === first.name && dayGap === 1) run.push(cur);
      else break;
    }
    const start = run[0].dt;
    const end   = run[run.length - 1].dt;
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const fmtDay = (d: Date) => String(d.getDate());
    const fmtMY  = (d: Date) => d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const fmtFull = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const rangeLabel =
      run.length === 1 ? fmtFull(start) :
      sameMonth        ? `${fmtDay(start)}–${fmtDay(end)} ${fmtMY(end)}` :
                         `${fmtFull(start)} – ${fmtFull(end)}`;
    const srLabel =
      run.length === 1 ? fmtFull(start) : `${fmtFull(start)} to ${fmtFull(end)}`;
    const isToday = start.getTime() === today.getTime();
    return { name: first.name, rangeLabel, srLabel, isToday };
  })();
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [clockRec, setClockRec] = useState<ClockRecord | null>(null);
  const [workingSeconds, setWorkingSeconds] = useState(0);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [leavePolicies, setLeavePolicies] = useState(DEFAULT_LEAVE_POLICIES);

  useEffect(() => {
    getDoc(doc(db, "settings", "leavePolicies"))
      .then((snap) => {
        const list = snap.exists() ? (snap.data().list as { type: string; days: number }[]) : null;
        if (Array.isArray(list) && list.length) setLeavePolicies(list.map((p) => ({ type: p.type, days: Number(p.days) || 0 })));
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Real-time leave requests from Firestore
  useEffect(() => {
    if (!empId) return;
    const q = query(collection(db, "leaveRequests"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      setLeaveRequests(snap.docs.map(d => {
        const r = d.data();
        return { status: String(r.status ?? ""), leaveType: String(r.leaveType ?? ""), days: Number(r.days) || 0 };
      }));
    }, () => {});
    return () => unsub();
  }, [empId]);

  // Real-time today's clock record from Firestore
  useEffect(() => {
    if (!empId) return;
    const today = new Date().toISOString().slice(0, 10);
    const clockId = `${today}-${empId}`;
    const unsub = onSnapshot(doc(db, "clockRecords", clockId), (snap) => {
      if (snap.exists()) {
        const rec = snap.data() as ClockRecord;
        if (rec.date === today) { setClockRec(rec); return; }
      }
      setClockRec(null);
    }, () => {});
    return () => unsub();
  }, [empId]);

  // Real-time notifications from Firestore
  useEffect(() => {
    if (!empId) return;
    const q1 = query(
      collection(db, "notifications"),
      where("userId", "==", empId),
    );
    const q2 = query(
      collection(db, "notifications"),
      where("userId", "==", "all"),
    );
    let personal: AppNotification[] = [];
    let broadcast: AppNotification[] = [];

    function merge() {
      const combined = [...personal, ...broadcast]
        .filter(n => (n as unknown as Record<string, unknown>).category !== "helpQuery")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5);
      setNotifications(combined);
    }

    const unsub1 = onSnapshot(q1, (snap) => {
      personal = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return { id: d.id, type: String(r.type ?? "system"), title: String(r.title ?? ""), message: String(r.message ?? ""), createdAt: String(r.createdAt ?? ""), read: Boolean(r.read) };
      });
      merge();
    }, () => {});

    const unsub2 = onSnapshot(q2, (snap) => {
      broadcast = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return { id: d.id, type: String(r.type ?? "system"), title: String(r.title ?? ""), message: String(r.message ?? ""), createdAt: String(r.createdAt ?? ""), read: Boolean(r.read) };
      });
      merge();
    }, () => {});

    return () => { unsub1(); unsub2(); };
  }, [empId]);

  // Live clock + working-hours ticker
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }));
      setCurrentDate(now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
      if (clockRec?.status === "clocked-in" && clockRec.clockInTs) {
        setWorkingSeconds(Math.floor((now.getTime() - clockRec.clockInTs) / 1000));
      } else if (clockRec?.status === "clocked-out" && clockRec.totalSeconds != null) {
        setWorkingSeconds(clockRec.totalSeconds);
      } else {
        setWorkingSeconds(0);
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [clockRec]);

  const isClockedIn  = clockRec?.status === "clocked-in";
  const isClockedOut = clockRec?.status === "clocked-out";
  const clockInStr   = clockRec?.clockInStr ?? null;
  const clockOutStr  = clockRec?.clockOutStr ?? null;
  const todayStatus  = isClockedIn ? "Present" : isClockedOut ? "Clocked Out" : "Not Started";
  const statusColor  = isClockedIn ? "bg-green-100 text-green-700" : isClockedOut ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500";

  const pendingLeaves  = leaveRequests.filter(r => r.status === "Pending").length;
  const approvedLeaves = leaveRequests.filter(r => r.status === "Approved").length;

  // Leave balance: entitlement (policy) minus approved days used, per type.
  const leaveUsedByType: Record<string, number> = {};
  leaveRequests.filter(r => r.status === "Approved").forEach((r) => {
    leaveUsedByType[r.leaveType] = (leaveUsedByType[r.leaveType] ?? 0) + (Number(r.days) || 0);
  });
  const leaveBalances = leavePolicies.map((p) => ({
    type: p.type, total: p.days, remaining: Math.max(0, p.days - (leaveUsedByType[p.type] ?? 0)),
  }));
  const totalLeaveRemaining = leaveBalances.reduce((s, b) => s + b.remaining, 0);
  const totalLeaveEntitlement = leaveBalances.reduce((s, b) => s + b.total, 0);

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#4F3CC9]/20 border-t-[#4F3CC9] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back{empName ? `, ${empName.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-gray-500 text-sm mt-1">{currentDate}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3 text-right">
          <p className="text-xs text-gray-400 mb-0.5">Current Time</p>
          <p className="text-2xl font-bold text-[#4F3CC9] tabular-nums">{currentTime}</p>
        </div>
      </div>

      {/* Upcoming holiday banner — purely informational; role=status implies
          polite announcement so SR users hear it on initial focus. */}
      {upcomingHoliday && (
        <section
          role="status"
          aria-labelledby="holiday-banner-title"
          className="rounded-2xl border border-purple-200 bg-purple-50 px-5 py-4 flex items-start gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0" aria-hidden="true">
            <CalendarDays size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="holiday-banner-title" className="text-base font-bold text-purple-800">
              <span aria-hidden="true">🎉 </span>
              {upcomingHoliday.isToday ? "Today is a Holiday" : "Upcoming Holiday"}
            </h2>
            <p className="text-sm text-purple-800 mt-0.5">
              <strong>{upcomingHoliday.name}</strong>
              {" — "}
              <span aria-label={upcomingHoliday.srLabel}>{upcomingHoliday.rangeLabel}</span>
            </p>
            <p className="text-xs text-purple-700 mt-1 opacity-80">
              No work expected on these days. Your attendance will be marked as Holiday automatically.
            </p>
          </div>
        </section>
      )}

      {/* Portal Guide card — opens an on-demand "How to use" modal. Not a
          nested interactive: only the Open Guide button is clickable; the card
          wrapper is a plain section with a heading. */}
      <section
        aria-labelledby="portal-guide-card-title"
        className="rounded-2xl border border-[#4F3CC9]/20 bg-gradient-to-r from-[#F5F3FF] to-white px-5 py-4 flex items-start gap-4"
      >
        <div className="w-11 h-11 rounded-xl bg-[#4F3CC9] text-white flex items-center justify-center shrink-0" aria-hidden="true">
          <BookOpen size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="portal-guide-card-title" className="text-base font-bold text-gray-900">How to use the Portal</h2>
          <p className="text-sm text-gray-500 mt-0.5">Clock-in, leave, payslip, password — step-by-step quick guide.</p>
        </div>
        <button
          type="button"
          onClick={openGuide}
          className="shrink-0 inline-flex items-center gap-1.5 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-[#3d2fa8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F3CC9] focus-visible:ring-offset-2"
        >
          Open Guide
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </section>

      {/* Attendance Overview */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Attendance Overview</h2>
        <div className="grid grid-cols-3 gap-4">
          {/* Today's Status */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Today&apos;s Status</span>
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <CheckCircle size={18} className="text-green-600" />
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${statusColor}`}>
              <CheckCircle size={13} /> {todayStatus}
            </span>
            {clockRec?.isLate && (
              <p className="text-xs text-orange-500 mt-2">⚠ Marked late (after 10:00 AM)</p>
            )}
          </div>

          {/* Clock In / Out */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Clock In / Out</span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <Clock size={18} className="text-[#4F3CC9]" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-gray-400">In</p>
                <p className={`text-base font-bold ${clockInStr ? "text-gray-900" : "text-gray-300"}`}>
                  {clockInStr ?? "--:--"}
                </p>
              </div>
              <div className="w-px h-8 bg-gray-100" />
              <div>
                <p className="text-xs text-gray-400">Out</p>
                <p className={`text-base font-bold ${clockOutStr ? "text-gray-900" : "text-gray-300"}`}>
                  {isClockedIn
                    ? <span className="text-green-500 text-sm font-semibold animate-pulse">Ongoing</span>
                    : (clockOutStr ?? "--:--")}
                </p>
              </div>
            </div>
            {!clockInStr && (
              <p className="text-xs text-gray-400 mt-2">Go to Attendance to clock in</p>
            )}
          </div>

          {/* Total Working Hours */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Total Working Hours</span>
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <Clock size={18} className="text-blue-600" />
              </div>
            </div>
            <p className="text-xl font-bold text-gray-900 tabular-nums">
              {workingSeconds > 0 ? fmtDuration(workingSeconds) : "—"}
            </p>
            {isClockedIn && <p className="text-xs text-green-500 mt-1">● Live — updating every second</p>}
            {isClockedOut && <p className="text-xs text-gray-400 mt-1">Final for today</p>}
          </div>
        </div>
      </div>

      {/* Leave Overview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-700">Leave Overview</h2>
          <span className="text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{totalLeaveRemaining}</span> of {totalLeaveEntitlement} days remaining
          </span>
        </div>
        {/* Leave balance by type */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {leaveBalances.map((b) => (
            <div key={b.type} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500 truncate">{b.type}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{b.remaining}<span className="text-sm font-medium text-gray-400"> / {b.total}</span></p>
              <p className="text-[11px] text-gray-400 mt-0.5">days remaining</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Total Requests</span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <CalendarDays size={18} className="text-[#4F3CC9]" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{leaveRequests.length}</p>
            <p className="text-xs text-gray-400 mt-1">All submitted requests</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Pending</span>
              <div className="w-9 h-9 rounded-xl bg-yellow-50 flex items-center justify-center">
                <AlertCircle size={18} className="text-yellow-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{pendingLeaves}</p>
            <p className="text-xs text-gray-400 mt-1">Awaiting approval</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Approved</span>
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <CheckCircle size={18} className="text-green-600" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{approvedLeaves}</p>
            <p className="text-xs text-gray-400 mt-1">This year</p>
          </div>
        </div>
      </div>

      {/* Recent Notifications */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Recent Notifications</h2>
        {notifications.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <Bell size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No notifications yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => {
              const Icon = NOTIF_ICON[n.type] ?? Bell;
              const cls  = NOTIF_CLS[n.type]  ?? "bg-gray-50 text-gray-500";
              return (
                <div key={n.id} className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4 ${!n.read ? "border-l-4 border-l-[#4F3CC9]" : ""}`}>
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${cls}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-xs text-gray-400 mt-1.5">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-[#4F3CC9] shrink-0 mt-2" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* First-login modal — nudges new employees to change the temp password */}
      {showFirstLogin && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 motion-reduce:transition-none"
          onClick={() => closeFirstLogin(true)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-login-title"
          aria-describedby="first-login-desc"
          onKeyDown={(e) => { if (e.key === "Escape") closeFirstLogin(true); }}
        >
          <div ref={firstLoginDialogRef} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-[#F5F3FF] text-[#4F3CC9] flex items-center justify-center shrink-0" aria-hidden="true">
                <KeyRound size={20} />
              </div>
              <div>
                <h2 id="first-login-title" className="text-base font-bold text-gray-900">Welcome! Please change your password</h2>
                <p id="first-login-desc" className="text-sm text-gray-500 mt-1">
                  For security, change the temporary password HR shared with you. You can always update it later from <strong>Profile → Change Password</strong>.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => closeFirstLogin(true)}
                className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
                autoFocus
              >
                Later
              </button>
              <button
                type="button"
                onClick={openChangePassword}
                className="flex-1 bg-[#4F3CC9] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F3CC9] focus-visible:ring-offset-2"
              >
                Open Change Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portal Guide modal */}
      {showGuide && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 motion-reduce:transition-none"
          onClick={closeGuide}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-guide-title"
          aria-describedby="portal-guide-intro"
          onKeyDown={(e) => { if (e.key === "Escape") closeGuide(); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div>
                <h2 id="portal-guide-title" className="text-base font-bold text-gray-900">How to use the WoWays HR Portal</h2>
                <p id="portal-guide-intro" className="text-xs text-gray-500 mt-0.5">A quick, step-by-step guide. Jump to any section from the list below.</p>
              </div>
              <button type="button" onClick={closeGuide} aria-label="Close guide" className="text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Jump nav — labelled so it doesn't collide with page nav */}
              <nav aria-label="Guide sections" className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Jump to</p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {[
                    ["clock-in", "Clocking In"],
                    ["clock-out", "Clocking Out"],
                    ["late-login", "Late Login Request"],
                    ["correction", "Attendance Correction"],
                    ["leave", "Applying for Leave"],
                    ["payslip", "Viewing Your Payslip"],
                    ["goals", "Setting / Updating Goals"],
                    ["notifications", "Reading Notifications"],
                    ["password", "Changing Your Password"],
                  ].map(([id, label]) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => jumpToGuideSection(id)}
                        className="text-left text-[#4F3CC9] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F3CC9] rounded px-1"
                      >
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              {[
                {
                  id: "clock-in",
                  title: "Clocking In",
                  steps: [
                    "Open the Attendance page from the sidebar.",
                    "Tap the big purple Clock In circle at the top of the page.",
                    "Your Clock In time is recorded instantly. The status pill under the button turns green with 'Present'.",
                    "If you clock in after 10:30 AM, your day shows as 'Late' and a 'Raise Late Login Request' button appears.",
                  ],
                },
                {
                  id: "clock-out",
                  title: "Clocking Out",
                  steps: [
                    "Return to the Attendance page before 11:00 PM.",
                    "Tap the big red Clock Out circle.",
                    "Your total working hours are calculated automatically from first clock-in to last clock-out.",
                    "Clock Out is disabled after 11:00 PM — if you miss it, raise an Attendance Correction (see below).",
                  ],
                },
                {
                  id: "late-login",
                  title: "Raising a Late Login Request",
                  steps: [
                    "On the Attendance history row for the late day, click 'Raise Late Login Request'.",
                    "Fill in the reason (e.g. traffic, medical, metro delay).",
                    "Submit — the request goes to HR. Your row shows 'Pending Review'.",
                    "HR approves → the day is marked Present. HR rejects → the day stays 'Late'.",
                  ],
                },
                {
                  id: "correction",
                  title: "Raising an Attendance Correction (Absent / Incomplete / forgot clock-out)",
                  steps: [
                    "On any past Absent or Incomplete row, click 'Raise Request' or 'Add Clock-Out'.",
                    "Pick the date, enter the actual arrival or clock-out time, and describe the reason.",
                    "Submit — HR reviews and approves/rejects. On approval the day's status updates automatically.",
                  ],
                },
                {
                  id: "leave",
                  title: "Applying for Leave",
                  steps: [
                    "Open the Leaves page from the sidebar.",
                    "Click '+ Apply Leave', pick the dates and leave type (Casual / Sick / Earned).",
                    "Add a short reason and submit.",
                    "Track status (Pending / Approved / Rejected) on the same page. Approved leave is deducted from your balance.",
                  ],
                },
                {
                  id: "payslip",
                  title: "Viewing Your Payslip",
                  steps: [
                    "Open the Payslip page from the sidebar.",
                    "Pick the month from the dropdown.",
                    "Review the breakdown of earnings and deductions, and download the PDF if you need a copy.",
                  ],
                },
                {
                  id: "goals",
                  title: "Setting / Updating Goals",
                  steps: [
                    "Open the Goals page from the sidebar.",
                    "View the goals your manager has set for you.",
                    "Click a goal to update your progress percentage, add a note, or attach evidence.",
                    "Your updates are visible to your manager instantly.",
                  ],
                },
                {
                  id: "notifications",
                  title: "Reading Notifications",
                  steps: [
                    "Open Notifications from the sidebar (bell icon).",
                    "Click any card — the portal takes you straight to the relevant page (e.g. a leave decision → Leaves).",
                    "Use the 'Mark as Read' button on a card, or the × to dismiss it, without triggering navigation.",
                  ],
                },
                {
                  id: "password",
                  title: "Changing Your Password",
                  steps: [
                    "Open the Profile page from the sidebar.",
                    "Scroll down to 'Change Password'.",
                    "Enter your current password, a new password (at least 8 characters), confirm it, and click Change Password.",
                    "You stay signed in. The next time you sign in, use the new password.",
                  ],
                },
              ].map((s) => (
                <section
                  key={s.id}
                  aria-labelledby={`guide-${s.id}-title`}
                  tabIndex={-1}
                  ref={(el) => { guideSectionRefs.current[s.id] = el; }}
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F3CC9] rounded-xl p-4 border border-gray-100 bg-white"
                >
                  <h3 id={`guide-${s.id}-title`} className="text-base font-semibold text-gray-900 mb-2">{s.title}</h3>
                  <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
                    {s.steps.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </section>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={closeGuide}
                className="bg-[#4F3CC9] text-white py-2 px-5 rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4F3CC9] focus-visible:ring-offset-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
