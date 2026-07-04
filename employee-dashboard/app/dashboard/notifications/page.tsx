"use client";
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, writeBatch, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Bell, Calendar, Clock, Megaphone, CreditCard, CheckCheck, CheckCircle, Target, Info, X, Trash2,
} from "lucide-react";

type NotifType = "leave" | "attendance" | "goal" | "payroll" | "system";

interface Notification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  type: NotifType;
  read: boolean;
}

const typeConfig: Record<NotifType, { icon: React.ElementType; iconClass: string; bgClass: string; label: string }> = {
  leave:      { icon: Calendar,   iconClass: "text-purple-600", bgClass: "bg-purple-100", label: "Leave"      },
  attendance: { icon: Clock,      iconClass: "text-blue-600",   bgClass: "bg-blue-100",   label: "Attendance" },
  goal:       { icon: Target,     iconClass: "text-[#4F3CC9]",  bgClass: "bg-[#EDE9FF]",  label: "Goals"      },
  payroll:    { icon: CreditCard, iconClass: "text-green-600",  bgClass: "bg-green-100",  label: "Payroll"    },
  system:     { icon: Megaphone,  iconClass: "text-orange-600", bgClass: "bg-orange-100", label: "Announcement" },
};

type FilterTab = "All" | "Unread" | "Leave" | "Attendance" | "Goals" | "Payroll" | "Announcements";
const tabs: FilterTab[] = ["All", "Unread", "Leave", "Attendance", "Goals", "Payroll", "Announcements"];

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("All");
  const [loading, setLoading] = useState(true);
  const [empId, setEmpId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // Resolve empId from Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) setEmpId(snap.data().employeeId as string ?? null);
      } catch { /* ignore */ }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Real-time notifications listener
  useEffect(() => {
    if (!empId) return;
    const q = query(collection(db, "notifications"), where("userId", "in", [empId, "all"]));
    const unsub = onSnapshot(q, (snap) => {
      const data: Notification[] = snap.docs.map((d) => ({
        id:        d.id,
        title:     (d.data().title as string) ?? "",
        message:   (d.data().message as string) ?? "",
        createdAt: (d.data().createdAt as string) ?? "",
        type:      (d.data().type as NotifType) ?? "system",
        read:      (d.data().read as boolean) ?? false,
      }));
      // Sort newest first
      data.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setNotifications(data);
    });
    return unsub;
  }, [empId]);

  // ── Auto-mark visible notifications as read when tab is viewed ───────────
  const notificationsRef = useRef<Notification[]>([]);
  notificationsRef.current = notifications;

  useEffect(() => {
    if (loading) return;
    if (activeTab === "Unread") return; // skip — would instantly empty the tab
    const timer = setTimeout(() => {
      const toMark = notificationsRef.current.filter(n => {
        if (n.read) return false;
        if (activeTab === "All")           return true;
        if (activeTab === "Announcements") return n.type === "system";
        if (activeTab === "Goals")         return n.type === "goal";
        return n.type === activeTab.toLowerCase();
      });
      if (!toMark.length) return;
      const batch = writeBatch(db);
      toMark.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
      batch.commit().catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [activeTab, loading]);

  async function markAsRead(id: string) {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch {
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: false } : n));
    }
  }

  async function dismiss(id: string) {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch { /* ignore */ }
  }

  // ── Clear all visible notifications ──────────────────────────────────────
  async function clearAll() {
    const toClear = notifications.filter((n) => {
      if (activeTab === "All")           return true;
      if (activeTab === "Unread")        return !n.read;
      if (activeTab === "Leave")         return n.type === "leave";
      if (activeTab === "Attendance")    return n.type === "attendance";
      if (activeTab === "Goals")         return n.type === "goal";
      if (activeTab === "Payroll")       return n.type === "payroll";
      if (activeTab === "Announcements") return n.type === "system";
      return true;
    });
    if (!toClear.length) return;
    try {
      const batch = writeBatch(db);
      toClear.forEach(n => batch.delete(doc(db, "notifications", n.id)));
      await batch.commit();
      showToast(`${toClear.length} notification${toClear.length !== 1 ? "s" : ""} cleared.`);
    } catch {
      showToast("Failed to clear notifications.", false);
    }
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true }));
      await batch.commit();
    } catch {
      // revert optimistic update on failure
      setNotifications((prev) =>
        prev.map((n) => (unread.some((u) => u.id === n.id) ? { ...n, read: false } : n))
      );
    }
  }

  const filtered = notifications.filter((n) => {
    if (activeTab === "All")           return true;
    if (activeTab === "Unread")        return !n.read;
    if (activeTab === "Leave")         return n.type === "leave";
    if (activeTab === "Attendance")    return n.type === "attendance";
    if (activeTab === "Goals")         return n.type === "goal";
    if (activeTab === "Payroll")       return n.type === "payroll";
    if (activeTab === "Announcements") return n.type === "system";
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg flex items-center gap-2 ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.ok ? <CheckCheck size={15}/> : <Bell size={15}/>}
          {toast.msg}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-500 text-sm mt-1">Stay updated with approvals, feedback, and announcements.</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="flex items-center gap-2 text-sm text-[#4F3CC9] font-medium hover:underline">
            <CheckCheck size={16} /> Mark all as read
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab ? "bg-[#EDE9FF] text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab}
            {tab === "Unread" && unreadCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[#4F3CC9] text-white text-xs flex items-center justify-center font-bold">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        ))}
        {notifications.length > 0 && (
          <button onClick={clearAll}
            className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-red-500 font-medium hover:underline px-2 py-1">
            <Trash2 size={13} /> Clear All
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4 animate-pulse">
              <div className="w-11 h-11 rounded-full bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 bg-gray-100 rounded" />
                <div className="h-3 w-72 bg-gray-100 rounded" />
                <div className="h-3 w-20 bg-gray-100 rounded" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-14 text-center">
            <Bell size={38} className="text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">No notifications here yet.</p>
            <p className="text-gray-300 text-xs mt-1">You&apos;ll see leave approvals, goal updates, and more here.</p>
          </div>
        ) : (
          filtered.map((notif) => {
            const cfg = typeConfig[notif.type] ?? typeConfig.system;
            const Icon = cfg.icon;
            return (
              <div
                key={notif.id}
                className={`rounded-2xl border shadow-sm p-5 flex items-start gap-4 transition-all ${
                  !notif.read
                    ? "bg-white border-l-4 border-l-[#4F3CC9] border-gray-100"
                    : "bg-gray-50 border-gray-100"
                }`}
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${cfg.bgClass}`}>
                  <Icon size={19} className={cfg.iconClass} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold text-gray-900">{notif.title}</p>
                    {!notif.read && <span className="w-2 h-2 rounded-full bg-[#4F3CC9] shrink-0" />}
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${typeConfig[notif.type]?.bgClass ?? "bg-gray-100"} ${typeConfig[notif.type]?.iconClass ?? "text-gray-500"}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{notif.message}</p>
                  <p className="text-xs text-gray-400 mt-1.5">{formatTime(notif.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!notif.read ? (
                    <button
                      onClick={() => markAsRead(notif.id)}
                      className="text-xs text-[#4F3CC9] font-medium border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF] transition-colors whitespace-nowrap"
                    >
                      Mark as Read
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <CheckCircle size={13} className="text-green-400" /> Read
                    </span>
                  )}
                  <button onClick={() => dismiss(notif.id)} title="Dismiss"
                    className="w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && notifications.length > 0 && (
        <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
          <Info size={11} /> Notifications from leave approvals, goal feedback, and attendance updates appear here.
        </p>
      )}
    </div>
  );
}
