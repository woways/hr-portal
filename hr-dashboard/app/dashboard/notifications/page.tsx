"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, where, onSnapshot,
  updateDoc, writeBatch, addDoc, doc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getEmployees } from "@/lib/firebaseService";
import {
  Plus, X, Bell, CalendarOff, Clock, DollarSign,
  Megaphone, Target, CheckCheck, Wifi, Loader2, Search, User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type NotifType = "leave" | "attendance" | "goal" | "system" | "payroll";

interface LiveNotif {
  id:        string;
  userId:    string;
  type:      NotifType;
  title:     string;
  message:   string;
  read:      boolean;
  createdAt: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const typeIcon: Record<string, React.FC<{ size: number; className?: string }>> = {
  leave:      CalendarOff,
  attendance: Clock,
  goal:       Target,
  system:     Megaphone,
  payroll:    DollarSign,
};
const typeBg: Record<string, string> = {
  leave:      "bg-yellow-50 text-yellow-600",
  attendance: "bg-orange-50 text-orange-600",
  goal:       "bg-purple-50 text-purple-600",
  system:     "bg-blue-50 text-blue-600",
  payroll:    "bg-green-50 text-green-600",
};

const TABS = ["All", "Leave", "Attendance", "Goal", "Announcements", "Payroll"] as const;
type Tab = typeof TABS[number];

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

const blankForm = { title: "", message: "", type: "leave" as NotifType, target: "all" };

interface EmpOption { empId: string; name: string; email: string; department: string; }

// ── Component ─────────────────────────────────────────────────────────────────

export default function HRNotificationsPage() {
  const [notifs,      setNotifs]      = useState<LiveNotif[]>([]);
  const [ready,       setReady]       = useState(false);
  const [activeTab,   setActiveTab]   = useState<Tab>("All");
  const [showCompose, setShowCompose] = useState(false);
  const [form,        setForm]        = useState({ ...blankForm });
  const [sending,     setSending]     = useState(false);
  const [empList,     setEmpList]     = useState<EmpOption[]>([]);
  const [empSearch,   setEmpSearch]   = useState("");
  const [selectedEmp, setSelectedEmp] = useState<EmpOption | null>(null);
  const [showEmpDrop, setShowEmpDrop] = useState(false);

  // ── Real-time listener: HR_PORTAL notifications (incoming from employees) ──
  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setReady(true); return; }

      const q = query(collection(db, "notifications"), where("userId", "==", "HR_PORTAL"));
      const snapUnsub = onSnapshot(q, (snap) => {
        const docs: LiveNotif[] = snap.docs
          .filter(d => (d.data() as Record<string, unknown>).category !== "helpQuery") // help queries shown in Help & Support tab
          .map(d => {
            const r = d.data() as Record<string, unknown>;
            return {
              id:        d.id,
              userId:    String(r.userId    ?? ""),
              type:      (r.type ?? "system") as NotifType,
              title:     String(r.title     ?? ""),
              message:   String(r.message   ?? ""),
              read:      Boolean(r.read),
              createdAt: String(r.createdAt ?? ""),
            };
          });
        setNotifs(docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setReady(true);
      }, () => setReady(true));

      return snapUnsub;
    });
    return () => authUnsub();
  }, []);

  // ── Load employees for targeting ─────────────────────────────────────────
  useEffect(() => {
    getEmployees().then(docs => {
      const list = (docs as Record<string, unknown>[]).map(d => ({
        empId:      String(d.employeeId ?? d.id ?? ""),
        name:       String(d.name ?? ""),
        email:      String(d.email ?? ""),
        department: String(d.department ?? ""),
      }));
      setEmpList(list);
    }).catch(() => {});
  }, []);

  // ── Mark one read ─────────────────────────────────────────────────────────
  async function markRead(id: string) {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch (err) { console.error("[HR Notifs] markRead:", err); }
  }

  // ── Mark all read ─────────────────────────────────────────────────────────
  async function markAllRead() {
    const unreadList = notifs.filter(n => !n.read);
    if (!unreadList.length) return;
    try {
      const batch = writeBatch(db);
      unreadList.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
      await batch.commit();
    } catch (err) { console.error("[HR Notifs] markAllRead:", err); }
  }

  // ── Send announcement ─────────────────────────────────────────────────────
  async function sendAnnouncement() {
    if (!form.title.trim() || !form.message.trim()) return;
    setSending(true);
    try {
      const userId = selectedEmp ? selectedEmp.email : "all";
      await addDoc(collection(db, "notifications"), {
        userId,
        type:      form.type,
        title:     form.title.trim(),
        message:   form.message.trim(),
        read:      false,
        createdAt: new Date().toISOString(),
        sentBy:    "HR",
        target:    selectedEmp ? selectedEmp.name : "All Employees",
      });
      setShowCompose(false);
      setForm({ ...blankForm });
      setSelectedEmp(null);
      setEmpSearch("");
    } catch (err) {
      console.error("[HR Notifs] sendAnnouncement:", err);
    } finally {
      setSending(false);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = notifs.filter(n => {
    if (activeTab === "All")           return true;
    if (activeTab === "Announcements") return n.type === "system";
    return n.type === activeTab.toLowerCase();
  });

  const unread = notifs.filter(n => !n.read).length;

  function tabCount(tab: Tab) {
    if (tab === "All") return unread;
    if (tab === "Announcements") return notifs.filter(n => n.type === "system" && !n.read).length;
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
            {unread > 0 && <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread}</span>}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Incoming employee requests and actions requiring your attention</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <Wifi size={12} /> Live sync
          </span>
          {unread > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-[#4F3CC9] font-medium hover:underline">
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
          <button onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa3]">
            <Plus size={16} /> Compose Announcement
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 flex-wrap items-center">
        {[
          { label: "Total Incoming", value: notifs.length, cls: "bg-gray-100 text-gray-700" },
          { label: "Unread",         value: unread,         cls: "bg-red-100 text-red-700"   },
          { label: "Leave Requests", value: notifs.filter(n => n.type === "leave").length,      cls: "bg-yellow-100 text-yellow-700" },
          { label: "Goals",          value: notifs.filter(n => n.type === "goal").length,       cls: "bg-purple-100 text-purple-700" },
          { label: "Attendance",     value: notifs.filter(n => n.type === "attendance").length, cls: "bg-orange-100 text-orange-700" },
        ].map(c => (
          <span key={c.label} className={`px-3 py-1.5 rounded-full text-xs font-medium ${c.cls}`}>
            {c.value} {c.label}
          </span>
        ))}
      </div>

      {/* Filter Tabs */}
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
        {!ready ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Bell size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">No incoming requests yet</p>
            <p className="text-gray-300 text-xs mt-1">Leave requests, goal updates, and attendance alerts will appear here instantly</p>
          </div>
        ) : (
          filtered.map(n => {
            const Icon = typeIcon[n.type] ?? Bell;
            const cls  = typeBg[n.type]   ?? "bg-gray-50 text-gray-500";
            return (
              <div key={n.id}
                className={`bg-white rounded-2xl shadow-sm flex items-start gap-4 px-6 py-4 transition-all
                  ${n.read ? "border border-gray-100" : "border border-gray-100 border-l-4 border-l-[#4F3CC9] bg-[#FDFCFF]"}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cls}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm font-semibold flex items-center gap-1.5 ${n.read ? "text-gray-700" : "text-gray-900"}`}>
                      {n.title}
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[#4F3CC9] inline-block shrink-0" />}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-400">{timeAgo(n.createdAt)}</span>
                      {!n.read && (
                        <button onClick={() => markRead(n.id)}
                          className="text-xs font-medium text-[#4F3CC9] border border-[#4F3CC9] rounded-full px-2.5 py-0.5 hover:bg-[#EDE9FF] transition-colors">
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose Announcement Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCompose(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Compose Announcement</h2>
              <button onClick={() => setShowCompose(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Office closed on Friday"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Message</label>
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Write your announcement..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] h-28 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1.5">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as NotifType }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-[#4F3CC9]">
                    <option value="system">Announcement</option>
                    <option value="leave">Leave</option>
                    <option value="attendance">Attendance</option>
                    <option value="payroll">Payroll</option>
                    <option value="goal">Goal</option>
                  </select>
                </div>
                <div className="relative">
                  <label className="text-xs font-medium text-gray-600 block mb-1.5">Target</label>
                  {selectedEmp ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#4F3CC9] bg-[#F5F3FF]">
                      <div className="w-6 h-6 rounded-full bg-[#4F3CC9] text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {selectedEmp.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{selectedEmp.name}</p>
                        <p className="text-xs text-gray-400 truncate">{selectedEmp.empId} · {selectedEmp.department}</p>
                      </div>
                      <button onClick={() => { setSelectedEmp(null); setEmpSearch(""); }} className="text-gray-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={empSearch}
                        onChange={e => { setEmpSearch(e.target.value); setShowEmpDrop(true); }}
                        onFocus={() => setShowEmpDrop(true)}
                        placeholder="Search employee or leave blank for all…"
                        className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-[#4F3CC9]"
                      />
                      {showEmpDrop && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                          <div
                            className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100"
                            onMouseDown={() => { setSelectedEmp(null); setEmpSearch(""); setShowEmpDrop(false); }}
                          >
                            <Megaphone size={14} className="text-[#4F3CC9]" />
                            <span className="text-sm font-medium text-[#4F3CC9]">All Employees</span>
                          </div>
                          {empList
                            .filter(e => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) || e.empId.toLowerCase().includes(empSearch.toLowerCase()) || e.department.toLowerCase().includes(empSearch.toLowerCase()))
                            .map(e => (
                              <div
                                key={e.empId}
                                className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                                onMouseDown={() => { setSelectedEmp(e); setEmpSearch(""); setShowEmpDrop(false); }}
                              >
                                <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold shrink-0">
                                  {e.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800 truncate">{e.name}</p>
                                  <p className="text-xs text-gray-400 truncate">{e.empId} · {e.department}</p>
                                </div>
                              </div>
                            ))
                          }
                          {empList.filter(e => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) || e.empId.toLowerCase().includes(empSearch.toLowerCase())).length === 0 && (
                            <div className="px-3 py-3 text-xs text-gray-400 text-center flex items-center justify-center gap-1">
                              <User size={12} /> No employee found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-[#F5F3FF] rounded-xl px-4 py-3 text-xs text-[#4F3CC9] font-medium flex items-center gap-2">
                <Bell size={13} />
                {selectedEmp
                  ? `This notification will be sent only to ${selectedEmp.name}.`
                  : "This announcement will appear in all employees' notification tabs instantly."}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowCompose(false); setSelectedEmp(null); setEmpSearch(""); }}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={sendAnnouncement} disabled={sending || !form.title.trim() || !form.message.trim()}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                  {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : selectedEmp ? `Send to ${selectedEmp.name}` : "Send to All Employees"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
