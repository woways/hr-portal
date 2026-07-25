"use client";
import { useState, useEffect } from "react";
import {
  Clock, CheckCircle, CalendarDays, Bell, AlertCircle,
  CalendarOff, Target, IndianRupee, Megaphone,
} from "lucide-react";
import { useEmployeeProfile } from "@/lib/useEmployeeProfile";
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
    </div>
  );
}
