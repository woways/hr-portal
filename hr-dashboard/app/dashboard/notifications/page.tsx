"use client";
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, where, onSnapshot,
  updateDoc, writeBatch, addDoc, doc, getDocs, deleteDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getEmployees } from "@/lib/firebaseService";
import { DEPARTMENTS } from "@/lib/constants";
import {
  Plus, X, Bell, CalendarOff, Clock, IndianRupee,
  Megaphone, Target, CheckCheck, Wifi, Loader2, Search, User, Check, Building2, Users, Trash2,
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
  payroll:    IndianRupee,
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
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [form,        setForm]        = useState({ ...blankForm });
  const [sending,       setSending]       = useState(false);
  const [empList,       setEmpList]       = useState<EmpOption[]>([]);
  const [empSearch,     setEmpSearch]     = useState("");
  const [targetMode,    setTargetMode]    = useState<"all" | "department" | "employees">("all");
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedEmps,  setSelectedEmps]  = useState<EmpOption[]>([]);

  // ── Real-time listener: HR_PORTAL notifications (incoming from employees) ──
  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setReady(true); return; }

      const q = query(collection(db, "notifications"), where("userId", "==", "HR_PORTAL"));
      const snapUnsub = onSnapshot(q, async (snap) => {
        // Cross-reference with active employees to exclude notifications from deleted employees
        let activeEmpIds = new Set<string>();
        let activeEmpNames = new Set<string>();
        try {
          const empSnap = await getDocs(collection(db, "employees"));
          empSnap.docs.forEach(d => {
            const data = d.data();
            activeEmpIds.add(d.id);
            if (data.employeeId) activeEmpIds.add(String(data.employeeId));
            if (data.name) activeEmpNames.add(String(data.name).toLowerCase().trim());
          });
        } catch { /* ignore, show all if fetch fails */ }

        const docs: LiveNotif[] = snap.docs
          .filter(d => {
            const r = d.data() as Record<string, unknown>;
            if (r.category === "helpQuery") return false;
            // If fetch failed, show all
            if (activeEmpIds.size === 0) return true;
            // New notifications: has empId field — check directly
            if (r.empId) return activeEmpIds.has(String(r.empId));
            // Old notifications without empId: extract from message "(EMPXXX)" or name from title "— Name"
            const msg = String(r.message ?? "");
            const msgMatch = msg.match(/\(([A-Z0-9]+)\)/);
            if (msgMatch && activeEmpIds.has(msgMatch[1])) return true;
            if (msgMatch && !activeEmpIds.has(msgMatch[1])) return false;
            // Extract name after "— " in title
            const title = String(r.title ?? "");
            const nameAfterDash = title.split("—").pop()?.trim().toLowerCase() ?? "";
            if (nameAfterDash) return activeEmpNames.has(nameAfterDash);
            // System/announcement with no employee link — keep
            return true;
          })
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

  // ── Auto-mark visible notifications as read when tab is viewed ───────────
  const notifsRef = useRef<LiveNotif[]>([]);
  notifsRef.current = notifs;

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const toMark = notifsRef.current.filter(n => {
        if (n.read) return false;
        if (activeTab === "All")           return true;
        if (activeTab === "Announcements") return n.type === "system";
        return n.type === activeTab.toLowerCase();
      });
      if (!toMark.length) return;
      const batch = writeBatch(db);
      toMark.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
      batch.commit().catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [activeTab, ready]);

  // ── Mark one read ─────────────────────────────────────────────────────────
  async function markRead(id: string) {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch { /* ignore */ }
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Mark all read ─────────────────────────────────────────────────────────
  async function markAllRead() {
    const unreadList = notifs.filter(n => !n.read);
    if (!unreadList.length) return;
    try {
      const batch = writeBatch(db);
      unreadList.forEach(n => batch.update(doc(db, "notifications", n.id), { read: true }));
      await batch.commit();
      showToast(`${unreadList.length} notification${unreadList.length > 1 ? "s" : ""} marked as read.`);
    } catch (err) {
      showToast("Failed to mark all as read. Please try again.", false);
    }
  }

  // ── Dismiss (delete) notification ────────────────────────────────────────
  async function dismiss(id: string) {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch { /* ignore */ }
  }

  // ── Clear all visible notifications ──────────────────────────────────────
  async function clearAll() {
    const toClear = notifs.filter(n => {
      if (activeTab === "All")           return true;
      if (activeTab === "Announcements") return n.type === "system";
      return n.type === (activeTab.toLowerCase() as NotifType);
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

  // ── Derived ───────────────────────────────────────────────────────────────
  const allDepts = [...DEPARTMENTS];

  function recipientCount() {
    if (targetMode === "all")        return empList.length;
    if (targetMode === "department") return empList.filter(e => selectedDepts.includes(e.department)).length;
    return selectedEmps.length;
  }

  function isSendable() {
    if (!form.title.trim() || !form.message.trim()) return false;
    if (targetMode === "department") return selectedDepts.length > 0;
    if (targetMode === "employees")  return selectedEmps.length > 0;
    return true;
  }

  function closeCompose() {
    setShowCompose(false);
    setForm({ ...blankForm });
    setEmpSearch("");
    setTargetMode("all");
    setSelectedDepts([]);
    setSelectedEmps([]);
  }

  function toggleDept(dept: string) {
    setSelectedDepts(prev => prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]);
  }

  function toggleEmpAnn(emp: EmpOption) {
    setSelectedEmps(prev =>
      prev.some(e => e.empId === emp.empId)
        ? prev.filter(e => e.empId !== emp.empId)
        : [...prev, emp]
    );
  }

  // ── Send announcement ─────────────────────────────────────────────────────
  async function sendAnnouncement() {
    if (!isSendable() || sending) return;
    setSending(true);
    try {
      const base = {
        type:      form.type,
        title:     form.title.trim(),
        message:   form.message.trim(),
        read:      false,
        createdAt: new Date().toISOString(),
        sentBy:    "HR",
      };
      if (targetMode === "all") {
        await addDoc(collection(db, "notifications"), { ...base, userId: "all", target: "All Employees" });
      } else if (targetMode === "department") {
        const targets = empList.filter(e => selectedDepts.includes(e.department));
        await Promise.all(targets.map(e =>
          addDoc(collection(db, "notifications"), { ...base, userId: e.empId, target: e.name })
        ));
      } else {
        await Promise.all(selectedEmps.map(e =>
          addDoc(collection(db, "notifications"), { ...base, userId: e.empId, target: e.name })
        ));
      }
      closeCompose();
    } catch { /* ignore */ } finally {
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
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg flex items-center gap-2 ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.ok ? <CheckCheck size={15} /> : <Bell size={15} />}
          {toast.msg}
        </div>
      )}
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
      <div className="flex items-center gap-1 flex-wrap border-b border-gray-100">
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
        {notifs.length > 0 && (
          <button onClick={clearAll} className="ml-auto flex items-center gap-1.5 text-xs text-red-500 font-medium hover:underline px-2 py-1">
            <Trash2 size={13} /> Clear All
          </button>
        )}
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
                className={`bg-white rounded-2xl shadow-sm flex items-start gap-4 px-6 py-4 transition-all relative
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
                      <button onClick={() => dismiss(n.id)} title="Dismiss"
                        className="w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <X size={13} />
                      </button>
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeCompose}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Compose Announcement</h2>
                <p className="text-xs text-gray-400 mt-0.5">Send to all, by department, or select employees</p>
              </div>
              <button onClick={closeCompose}><X size={20} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Title */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Office closed on Friday"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>

              {/* Message */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Message</label>
                <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Write your announcement..."
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] h-24 resize-none" />
              </div>

              {/* Type */}
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

              {/* Target Mode Tabs */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">Send To</label>
                <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                  {([
                    { mode: "all",        label: "All Employees", icon: Megaphone },
                    { mode: "department", label: "By Department",  icon: Building2 },
                    { mode: "employees",  label: "Select People",  icon: Users     },
                  ] as const).map(({ mode, label, icon: Icon }) => (
                    <button key={mode} type="button"
                      onClick={() => { setTargetMode(mode); setEmpSearch(""); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                        targetMode === mode
                          ? "bg-white text-[#4F3CC9] shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Department mode */}
              {targetMode === "department" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600">
                      Select Departments
                      {selectedDepts.length > 0 && (
                        <span className="ml-1.5 bg-[#4F3CC9] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {selectedDepts.length} · {recipientCount()} employees
                        </span>
                      )}
                    </span>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setSelectedDepts([...allDepts])}
                        className="text-xs text-[#4F3CC9] font-medium hover:underline">Select All</button>
                      {selectedDepts.length > 0 && (
                        <button type="button" onClick={() => setSelectedDepts([])}
                          className="text-xs text-gray-400 hover:underline">Clear</button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {allDepts.map(dept => {
                      const count = empList.filter(e => e.department === dept).length;
                      const checked = selectedDepts.includes(dept);
                      return (
                        <label key={dept}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                            checked ? "border-[#4F3CC9] bg-[#FDFCFF]" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                          }`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleDept(dept)} className="accent-[#4F3CC9] w-4 h-4 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{dept}</p>
                            <p className="text-xs text-gray-400">{count} employee{count !== 1 ? "s" : ""}</p>
                          </div>
                          {checked && <Check size={13} className="text-[#4F3CC9] shrink-0" />}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Employees mode */}
              {targetMode === "employees" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                      Select Employees
                      {selectedEmps.length > 0 && (
                        <span className="bg-[#4F3CC9] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {selectedEmps.length} selected
                        </span>
                      )}
                    </span>
                    <div className="flex gap-3">
                      <button type="button"
                        onClick={() => {
                          const visible = empList.filter(e =>
                            !empSearch ||
                            e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                            e.empId.toLowerCase().includes(empSearch.toLowerCase()) ||
                            e.department.toLowerCase().includes(empSearch.toLowerCase())
                          );
                          setSelectedEmps(visible);
                        }}
                        className="text-xs text-[#4F3CC9] font-medium hover:underline">Select All</button>
                      {selectedEmps.length > 0 && (
                        <button type="button" onClick={() => setSelectedEmps([])}
                          className="text-xs text-gray-400 hover:underline">Clear</button>
                      )}
                    </div>
                  </div>

                  {/* Selected chips */}
                  {selectedEmps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selectedEmps.map(e => (
                        <span key={e.empId} className="flex items-center gap-1 bg-[#EDE9FF] text-[#4F3CC9] text-xs px-2 py-1 rounded-full font-medium">
                          {e.name}
                          <button onClick={() => toggleEmpAnn(e)} className="hover:text-red-500 ml-0.5"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative mb-2">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input value={empSearch} onChange={e => setEmpSearch(e.target.value)}
                      placeholder="Search by name, ID or department…"
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                  </div>

                  {/* List — only shows when user types */}
                  <div className="border border-gray-200 rounded-xl max-h-44 overflow-y-auto">
                    {!empSearch.trim() ? (
                      <div className="px-4 py-6 text-center text-xs text-gray-400">
                        Type a name or employee ID to search
                      </div>
                    ) : (() => {
                      const results = empList.filter(e =>
                        e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                        e.empId.toLowerCase().includes(empSearch.toLowerCase()) ||
                        e.department.toLowerCase().includes(empSearch.toLowerCase())
                      );
                      if (results.length === 0) return (
                        <div className="px-4 py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-1">
                          <User size={12} /> No employees found
                        </div>
                      );
                      return results.map(e => {
                        const checked = selectedEmps.some(s => s.empId === e.empId);
                        return (
                          <label key={e.empId}
                            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-colors ${checked ? "bg-[#FDFCFF]" : "hover:bg-gray-50"}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleEmpAnn(e)} className="accent-[#4F3CC9] w-4 h-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{e.name}</p>
                              <p className="text-xs text-gray-400 truncate">{e.empId} · {e.department}</p>
                            </div>
                            {checked && <Check size={13} className="text-[#4F3CC9] shrink-0" />}
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* Info banner */}
              <div className="bg-[#F5F3FF] rounded-xl px-4 py-3 text-xs text-[#4F3CC9] font-medium flex items-center gap-2">
                <Bell size={13} />
                {targetMode === "all" && "This announcement will appear in all employees' notification tabs instantly."}
                {targetMode === "department" && (
                  selectedDepts.length === 0
                    ? "Select one or more departments above."
                    : `Will be sent to ${recipientCount()} employee${recipientCount() !== 1 ? "s" : ""} in: ${selectedDepts.join(", ")}.`
                )}
                {targetMode === "employees" && (
                  selectedEmps.length === 0
                    ? "Select one or more employees above."
                    : `Will be sent to ${selectedEmps.length} selected employee${selectedEmps.length !== 1 ? "s" : ""}.`
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-0 flex gap-3 shrink-0">
              <button onClick={closeCompose}
                className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={sendAnnouncement} disabled={!isSendable() || sending}
                className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-50 flex items-center justify-center gap-2">
                {sending ? (
                  <><Loader2 size={14} className="animate-spin" /> Sending…</>
                ) : targetMode === "all" ? (
                  `Send to All Employees`
                ) : targetMode === "department" ? (
                  selectedDepts.length === 0 ? "Send Announcement" : `Send to ${recipientCount()} Employees`
                ) : (
                  selectedEmps.length === 0 ? "Send Announcement" : `Send to ${selectedEmps.length} Employee${selectedEmps.length !== 1 ? "s" : ""}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
