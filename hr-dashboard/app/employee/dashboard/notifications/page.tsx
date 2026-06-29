"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, where, getDocs, getDoc, doc,
  onSnapshot, updateDoc, writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Bell, Calendar, Clock, Target, CheckCheck, Megaphone, DollarSign, Wifi, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type NotifType = "leave" | "attendance" | "goal" | "system" | "payroll";

interface AppNotification {
  id:        string;
  userId:    string;
  type:      NotifType;
  title:     string;
  message:   string;
  read:      boolean;
  createdAt: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const typeConfig: Record<string, { icon: React.FC<{ size: number; className?: string }>; bg: string; text: string }> = {
  leave:      { icon: Calendar,  bg: "bg-yellow-50",  text: "text-yellow-600" },
  attendance: { icon: Clock,     bg: "bg-orange-50",  text: "text-orange-600" },
  goal:       { icon: Target,    bg: "bg-purple-50",  text: "text-purple-600" },
  system:     { icon: Megaphone, bg: "bg-blue-50",    text: "text-blue-600"   },
  payroll:    { icon: DollarSign,bg: "bg-green-50",   text: "text-green-600"  },
};

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TABS = ["All", "Unread", "Leave", "Payroll", "Attendance", "Goal", "Announcements"] as const;
type Tab = typeof TABS[number];

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmployeeNotificationsPage() {
  const [notifs,    setNotifs]    = useState<AppNotification[]>([]);
  const [empId,     setEmpId]     = useState("");
  const [resolving, setResolving] = useState(true);
  const [liveReady, setLiveReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("All");

  // ── Step 1: resolve empId from auth ──────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setResolving(false); return; }

      let id = "";
      try {
        // Email → employees collection
        if (user.email) {
          const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!snap.empty) id = snap.docs[0].id;
        }
        // Fallback: users/{uid}.employeeId
        if (!id) {
          const uSnap = await getDoc(doc(db, "users", user.uid));
          if (uSnap.exists()) id = String((uSnap.data() as Record<string, unknown>).employeeId ?? "");
        }
        // Last resort: use Firebase Auth UID
        if (!id) id = user.uid;
      } catch { id = user.uid; }

      setEmpId(id);
      setResolving(false);
    });
    return () => unsub();
  }, []);

  // ── Step 2: real-time listener — personal + broadcast notifications ────────
  useEffect(() => {
    if (!empId) return;

    const col = collection(db, "notifications");
    // Personal notifications for this employee
    const q1 = query(col, where("userId", "==", empId));
    // Broadcast announcements sent to all employees
    const q2 = query(col, where("userId", "==", "all"));

    const seen = new Set<string>();
    let personal: AppNotification[]  = [];
    let broadcast: AppNotification[] = [];

    function merge() {
      seen.clear();
      const all: AppNotification[] = [];
      [...personal, ...broadcast].forEach(n => {
        if (!seen.has(n.id)) { seen.add(n.id); all.push(n); }
      });
      setNotifs(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLiveReady(true);
    }

    function toNotif(d: import("firebase/firestore").QueryDocumentSnapshot): AppNotification | null {
      const r = d.data() as Record<string, unknown>;
      // Exclude help query documents — they're shown in the Help & Support tab only
      if (r.category === "helpQuery") return null;
      return {
        id:        d.id,
        userId:    String(r.userId    ?? ""),
        type:      (r.type ?? "system") as NotifType,
        title:     String(r.title     ?? ""),
        message:   String(r.message   ?? ""),
        read:      Boolean(r.read),
        createdAt: String(r.createdAt ?? ""),
      };
    }

    const unsub1 = onSnapshot(q1, (snap) => { personal  = snap.docs.map(toNotif).filter(Boolean) as AppNotification[]; merge(); }, () => setLiveReady(true));
    const unsub2 = onSnapshot(q2, (snap) => { broadcast = snap.docs.map(toNotif).filter(Boolean) as AppNotification[]; merge(); }, () => setLiveReady(true));

    return () => { unsub1(); unsub2(); };
  }, [empId]);

  // ── Mark one as read ──────────────────────────────────────────────────────
  async function markRead(id: string) {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
      // onSnapshot will update UI — no manual setState needed
    } catch (err) {
      console.error("[Notifs] markRead error:", err);
    }
  }

  // ── Mark all as read ──────────────────────────────────────────────────────
  async function markAllRead() {
    const unread = notifs.filter(n => !n.read);
    if (!unread.length) return;
    try {
      const batch = writeBatch(db);
      unread.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
      await batch.commit();
    } catch (err) {
      console.error("[Notifs] markAllRead error:", err);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = notifs.filter(n => {
    if (activeTab === "All")           return true;
    if (activeTab === "Unread")        return !n.read;
    if (activeTab === "Announcements") return n.type === "system";
    if (activeTab === "Payroll")       return n.type === "payroll";
    return n.type === activeTab.toLowerCase();
  });

  const unread = notifs.filter(n => !n.read).length;

  function tabCount(tab: Tab) {
    if (tab === "All" || tab === "Unread") return unread;
    if (tab === "Announcements") return notifs.filter(n => n.type === "system" && !n.read).length;
    if (tab === "Payroll")       return notifs.filter(n => n.type === "payroll" && !n.read).length;
    return notifs.filter(n => n.type === tab.toLowerCase() && !n.read).length;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Notifications
            {unread > 0 && (
              <span className="bg-[#4F3CC9] text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread}</span>
            )}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Real-time updates on your requests and tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <Wifi size={12} /> Live sync
          </span>
          {unread > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium hover:underline">
              <CheckCheck size={15} /> Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-100">
        {TABS.map(tab => {
          const count = tabCount(tab);
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors relative ${activeTab === tab ? "bg-white border border-b-white border-gray-100 text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"}`}>
              {tab}
              {count > 0 && (
                <span className="ml-1.5 bg-[#4F3CC9] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Notification List */}
      <div className="space-y-3">
        {resolving || !liveReady ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Bell size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">No notifications yet</p>
            <p className="text-gray-300 text-xs mt-1">Leave approvals, announcements, and updates will appear here</p>
          </div>
        ) : (
          filtered.map(n => {
            const cfg = typeConfig[n.type] ?? typeConfig.system;
            const Icon = cfg.icon;
            return (
              <div key={n.id}
                className={`relative bg-white rounded-2xl shadow-sm flex items-start gap-4 px-6 py-4 transition-all
                  ${n.read ? "border border-gray-100" : "border border-gray-100 border-l-4 border-l-[#4F3CC9] bg-[#FDFCFF]"}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cfg.bg}`}>
                  <Icon size={18} className={cfg.text} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm font-semibold flex items-center gap-1.5 ${n.read ? "text-gray-700" : "text-gray-900"}`}>
                      {n.title}
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[#4F3CC9] inline-block shrink-0" />}
                    </p>
                    {n.read ? (
                      <span className="flex items-center gap-1 text-xs text-green-500 font-medium whitespace-nowrap shrink-0">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Read
                      </span>
                    ) : (
                      <button onClick={() => markRead(n.id)}
                        className="shrink-0 text-xs font-medium text-[#4F3CC9] border border-[#4F3CC9] rounded-full px-3 py-1 hover:bg-[#EDE9FF] transition-colors whitespace-nowrap">
                        Mark as Read
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                  <p className="text-xs text-gray-400 mt-1.5">{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
