"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, updateDoc, doc, addDoc, getDocs, getDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { markHRNotifRead } from "@/lib/firebaseService";
import { Eye, Pencil, X, CheckCircle, XCircle, Wifi, Loader2, Clock, ChevronLeft, ChevronRight, Users, Trash2 } from "lucide-react";

type LeaveStatus = "Pending" | "Approved" | "Rejected";

interface LeaveRequest {
  id:            string;
  empId?:        string;
  empName?:      string;
  name?:         string;
  leaveType:     string;
  startDate:     string;
  endDate:       string;
  days:          number;
  reason:        string;
  status:        LeaveStatus;
  appliedOn:     string;
  hrComment?:    string;
  proofUrl?:     string;
  proofFileName?: string;
}

interface LeaveBalance {
  id:        string;
  name:      string;
  casual:    { used: number; total: number };
  sick:      { used: number; total: number };
  emergency: { used: number; total: number };
  paid:      { used: number; total: number };
}

function displayName(r: LeaveRequest) { return r.empName ?? r.name ?? "Unknown"; }

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

const statusColor: Record<LeaveStatus, string> = {
  Pending:  "bg-yellow-100 text-yellow-700",
  Approved: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
};

const typeColor: Record<string, string> = {
  "Casual Leave":    "bg-blue-100 text-blue-700",
  "Sick Leave":      "bg-orange-100 text-orange-700",
  "Emergency Leave": "bg-red-100 text-red-700",
  "Annual Leave":    "bg-purple-100 text-purple-700",
  "Maternity Leave": "bg-pink-100 text-pink-700",
  "Paternity Leave": "bg-cyan-100 text-cyan-700",
  "Unpaid Leave":    "bg-gray-100 text-gray-700",
  Casual:    "bg-blue-100 text-blue-700",
  Sick:      "bg-orange-100 text-orange-700",
  Emergency: "bg-red-100 text-red-700",
  Paid:      "bg-purple-100 text-purple-700",
};

const typeChipColor: Record<string, string> = {
  "Casual Leave":    "bg-blue-500",
  "Sick Leave":      "bg-orange-400",
  "Emergency Leave": "bg-red-500",
  "Annual Leave":    "bg-purple-500",
  "Maternity Leave": "bg-pink-500",
  "Paternity Leave": "bg-cyan-500",
  "Unpaid Leave":    "bg-gray-400",
  Casual:    "bg-blue-500",
  Sick:      "bg-orange-400",
  Emergency: "bg-red-500",
  Paid:      "bg-purple-500",
};

export default function LeavePage() {
  const now = new Date();

  const [ready,        setReady]        = useState(false);
  const [requests,     setRequests]     = useState<LeaveRequest[]>([]);
  const [balances,     setBalances]     = useState<LeaveBalance[]>([]);
  const [hrComments,   setHrComments]   = useState<Record<string, string>>({});
  const [actionToast,  setActionToast]  = useState<{ msg: string; ok: boolean } | null>(null);
  const [editBal,      setEditBal]      = useState<LeaveBalance | null>(null);
  const [editBalForm,  setEditBalForm]  = useState<LeaveBalance | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ employee: "", startDate: "", endDate: "", reason: "", approveImmediately: false });
  const [viewReq,      setViewReq]      = useState<LeaveRequest | null>(null);
  const [editReq,      setEditReq]      = useState<LeaveRequest | null>(null);
  const [editForm,     setEditForm]     = useState<{ status: LeaveStatus; hrComment: string }>({ status: "Pending", hrComment: "" });
  const [savingEdit,   setSavingEdit]   = useState(false);
  const [viewMonth,    setViewMonth]    = useState(now.getMonth());
  const [viewYear,     setViewYear]     = useState(now.getFullYear());
  const [selectedDay,  setSelectedDay]  = useState<number | null>(null);
  const [empDeptMap,   setEmpDeptMap]   = useState<Record<string, string>>({});
  const [clearedIds,   setClearedIds]   = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("hr_leave_cleared_ids") ?? "[]")); }
    catch { return new Set(); }
  });

  const TABS = ["Leave Requests", "Leave Balances", "Leave Calendar"] as const;
  type Tab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<Tab>("Leave Requests");

  // Auto-mark all unread leave notifications as read when HR opens this page
  useEffect(() => { const t = setTimeout(() => markHRNotifRead("leave"), 10000); return () => clearTimeout(t); }, []);

  // Real-time listener — replaces polling; HR sees employee submissions instantly
  useEffect(() => {
    let snapUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setReady(true); return; }

      snapUnsub = onSnapshot(collection(db, "leaveRequests"), (snap) => {
        // Cross-reference with active employees to exclude deleted employee data
        getDocs(collection(db, "employees")).then((empSnap) => {
          const activeEmpIds = new Set(empSnap.docs.flatMap(d => {
            const data = d.data();
            return [d.id, String(data.employeeId ?? "")].filter(Boolean);
          }));

          const allDocs: LeaveRequest[] = snap.docs.map(d => {
            const r = d.data() as Record<string, unknown>;
            return {
              id:        d.id,
              empId:     String(r.empId   ?? ""),
              empName:   String(r.empName ?? r.name ?? "Unknown"),
              leaveType: String(r.leaveType  ?? ""),
              startDate: String(r.startDate  ?? ""),
              endDate:   String(r.endDate    ?? ""),
              days:      Number(r.days ?? 0),
              reason:    String(r.reason     ?? ""),
              status:    (r.status ?? "Pending") as LeaveStatus,
              appliedOn: String(r.appliedOn  ?? ""),
              hrComment:     r.hrComment     ? String(r.hrComment)     : undefined,
              proofUrl:      r.proofUrl      ? String(r.proofUrl)      : undefined,
              proofFileName: r.proofFileName ? String(r.proofFileName) : undefined,
            };
          });

          // Only show requests from active (non-deleted) employees
          const docs = allDocs.filter(r => !r.empId || activeEmpIds.has(r.empId));
          setRequests(docs.sort((a, b) => b.appliedOn.localeCompare(a.appliedOn)));
          setReady(true);

        Promise.all([
          Promise.resolve(empSnap),
          getDoc(doc(db, "settings", "leavePolicies")),
        ]).then(([empSnap, policySnap]) => {
          const policyList: Array<{type: string; days: number}> = policySnap.exists() ? (policySnap.data().list ?? []) : [];
          const defaultDays: Record<string, number> = { "Casual Leave": 6, "Sick Leave": 10, "Emergency Leave": 2, "Paid Leave": 18, "Annual Leave": 18 };
          const getTotal = (type: string) => policyList.find(p => p.type === type)?.days ?? defaultDays[type] ?? 6;
          const typeToKey: Record<string, string> = { "Casual Leave": "casual", "Sick Leave": "sick", "Emergency Leave": "emergency", "Paid Leave": "paid", "Annual Leave": "paid" };
          const usedMap: Record<string, Record<string, number>> = {};
          docs.filter(r => r.status === "Approved").forEach(r => {
            if (!usedMap[r.empId!]) usedMap[r.empId!] = {};
            const key = typeToKey[r.leaveType] ?? "casual";
            usedMap[r.empId!][key] = (usedMap[r.empId!][key] ?? 0) + r.days;
          });
          const computed: LeaveBalance[] = empSnap.docs.map(d => {
            const used = usedMap[d.id] ?? {};
            return { id: d.id, name: (d.data().name as string) ?? "", casual: { used: used.casual ?? 0, total: getTotal("Casual Leave") }, sick: { used: used.sick ?? 0, total: getTotal("Sick Leave") }, emergency: { used: used.emergency ?? 0, total: getTotal("Emergency Leave") }, paid: { used: used.paid ?? 0, total: getTotal("Paid Leave") } };
          });
          setBalances(computed);
          const dm: Record<string, string> = {};
          empSnap.docs.forEach(d => { dm[d.id] = String(d.data().department ?? ""); });
          setEmpDeptMap(dm);
        }).catch(() => {});
        }).catch(() => {});
      }, () => setReady(true));
    });
    return () => { authUnsub(); snapUnsub?.(); };
  }, []);

  function showToast(msg: string, ok = true) {
    setActionToast({ msg, ok });
    setTimeout(() => setActionToast(null), 3500);
  }

  // Write approval/rejection directly to Firestore — employee sees it via onSnapshot immediately
  async function approve(id: string) {
    const comment = hrComments[id] ?? "";
    try {
      const req = requests.find(r => r.id === id);
      await updateDoc(doc(db, "leaveRequests", id), {
        status:    "Approved",
        hrComment: comment,
        updatedAt: new Date().toISOString(),
      });
      // Notify the employee — they'll see it instantly in their notifications tab
      if (req?.empId) {
        await addDoc(collection(db, "notifications"), {
          userId:    req.empId,
          type:      "leave",
          title:     `Leave Approved — ${req.leaveType}`,
          message:   `Your ${req.leaveType} from ${req.startDate} to ${req.endDate} has been approved by HR.${comment ? ` Comment: "${comment}"` : ""}`,
          read:      false,
          createdAt: new Date().toISOString(),
        });
      }
      // Clear the HR_PORTAL unread badge for this leave notification
      markHRNotifRead("leave", req?.empId, (msg) => msg.includes(req?.startDate ?? "") && msg.includes(req?.endDate ?? ""));
      setHrComments(p => { const n = { ...p }; delete n[id]; return n; });
      showToast("Approved — employee will see the update instantly.");
    } catch {
      showToast("Failed to approve. Please check your connection.", false);
    }
  }

  async function reject(id: string) {
    const comment = hrComments[id] ?? "";
    try {
      const req = requests.find(r => r.id === id);
      await updateDoc(doc(db, "leaveRequests", id), {
        status:    "Rejected",
        hrComment: comment,
        updatedAt: new Date().toISOString(),
      });
      // Notify the employee — they'll see it instantly in their notifications tab
      if (req?.empId) {
        await addDoc(collection(db, "notifications"), {
          userId:    req.empId,
          type:      "leave",
          title:     `Leave Rejected — ${req.leaveType}`,
          message:   `Your ${req.leaveType} from ${req.startDate} to ${req.endDate} has been rejected by HR.${comment ? ` Reason: "${comment}"` : ""}`,
          read:      false,
          createdAt: new Date().toISOString(),
        });
      }
      // Clear the HR_PORTAL unread badge for this leave notification
      markHRNotifRead("leave", req?.empId, (msg) => msg.includes(req?.startDate ?? "") && msg.includes(req?.endDate ?? ""));
      setHrComments(p => { const n = { ...p }; delete n[id]; return n; });
      showToast("Rejected — employee will see the update instantly.");
    } catch {
      showToast("Failed to reject. Please check your connection.", false);
    }
  }

  function openEditReq(r: LeaveRequest) {
    setEditReq(r);
    setEditForm({ status: r.status, hrComment: r.hrComment ?? "" });
  }

  async function saveEditReq() {
    if (!editReq) return;
    setSavingEdit(true);
    const prevStatus = editReq.status;
    try {
      await updateDoc(doc(db, "leaveRequests", editReq.id), {
        status:    editForm.status,
        hrComment: editForm.hrComment,
        updatedAt: new Date().toISOString(),
      });
      if (editReq.empId && editForm.status !== prevStatus) {
        const label = editForm.status === "Approved" ? "approved" : editForm.status === "Rejected" ? "rejected" : "set back to Pending";
        await addDoc(collection(db, "notifications"), {
          userId:    editReq.empId,
          type:      "leave",
          title:     `Leave ${editForm.status === "Pending" ? "Updated" : editForm.status} — ${editReq.leaveType}`,
          message:   `Your ${editReq.leaveType} from ${editReq.startDate} to ${editReq.endDate} has been ${label} by HR.${editForm.hrComment ? ` Comment: "${editForm.hrComment}"` : ""}`,
          read:      false,
          createdAt: new Date().toISOString(),
        });
        // If status is no longer Pending, clear the HR_PORTAL badge
        if (editForm.status !== "Pending") {
          markHRNotifRead("leave", editReq.empId, (msg) => msg.includes(editReq.startDate) && msg.includes(editReq.endDate));
        }
      }
      setEditReq(null);
      showToast("Leave request updated successfully.");
    } catch {
      showToast("Failed to update. Please check your connection.", false);
    } finally {
      setSavingEdit(false);
    }
  }

  function clearAll() {
    const allIds = requests.map(r => r.id);
    const next = new Set([...clearedIds, ...allIds]);
    setClearedIds(next);
    try { localStorage.setItem("hr_leave_cleared_ids", JSON.stringify([...next])); } catch { /* ignore */ }
    showToast("Leave requests cleared from HR view. Employee portal is unaffected.");
  }

  async function deleteRequest(id: string) {
    if (!window.confirm("Permanently delete this leave request from Firebase? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "leaveRequests", id));
      setRequests(prev => prev.filter(r => r.id !== id));
      showToast("Leave request permanently deleted.");
    } catch {
      showToast("Failed to delete. Please try again.", false);
    }
  }

  // Calendar — build per-day leave map for the viewed month
  const calDayMap: Record<number, LeaveRequest[]> = {};
  requests.filter(r => r.status === "Approved").forEach(r => {
    const start = new Date(r.startDate + "T00:00:00");
    const end   = new Date(r.endDate   + "T00:00:00");
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getMonth() === viewMonth && d.getFullYear() === viewYear) {
        const day = d.getDate();
        if (!calDayMap[day]) calDayMap[day] = [];
        calDayMap[day].push(r);
      }
    }
  });

  const calDaysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const calFirstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const calMonthLabel  = new Date(viewYear, viewMonth, 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" }).replace(",", "");
  const isCurrentMonth = viewMonth === now.getMonth() && viewYear === now.getFullYear();
  const isFutureMonth  = viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth > now.getMonth());

  function goPrevMonth() {
    setSelectedDay(null);
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function goNextMonth() {
    setSelectedDay(null);
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const visibleRequests = requests.filter(r => !clearedIds.has(r.id));
  const pending  = visibleRequests.filter(r => r.status === "Pending").length;
  const approved = visibleRequests.filter(r => r.status === "Approved").length;
  const rejected = visibleRequests.filter(r => r.status === "Rejected").length;

  function openEditBal(b: LeaveBalance) {
    setEditBal(b);
    setEditBalForm({ ...b, casual: { ...b.casual }, sick: { ...b.sick }, emergency: { ...b.emergency }, paid: { ...b.paid } });
  }
  async function saveEditBal() {
    if (!editBalForm) return;
    const previous = balances.find(b => b.id === editBalForm.id);
    setBalances(balances.map(b => b.id === editBalForm.id ? editBalForm : b));
    try {
      await updateDoc(doc(db, "leaveBalances", editBalForm.id), {
        casual:    editBalForm.casual,
        sick:      editBalForm.sick,
        emergency: editBalForm.emergency,
        paid:      editBalForm.paid,
        updatedAt: new Date().toISOString(),
      });
      setEditBal(null); setEditBalForm(null);
    } catch {
      if (previous) setBalances(balances.map(b => b.id === previous.id ? previous : b));
      showToast("Failed to save balance. Please try again.", false);
    }
  }

  async function handleEmergencyOverride() {
    if (!overrideForm.employee || !overrideForm.startDate || !overrideForm.endDate) {
      showToast("Please fill in employee name, start date and end date.", false);
      return;
    }
    const start = new Date(overrideForm.startDate + "T00:00:00");
    const end   = new Date(overrideForm.endDate   + "T00:00:00");
    if (end < start) { showToast("End date must be after start date.", false); return; }
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    try {
      const found = balances.find(b => b.name.toLowerCase().trim() === overrideForm.employee.toLowerCase().trim());
      const empId = found?.id ?? "";
      await addDoc(collection(db, "leaveRequests"), {
        empName:   overrideForm.employee,
        empId,
        leaveType: "Emergency Leave",
        startDate: overrideForm.startDate,
        endDate:   overrideForm.endDate,
        days,
        reason:    overrideForm.reason || "Emergency override by HR",
        status:    overrideForm.approveImmediately ? "Approved" : "Pending",
        appliedOn: new Date().toISOString().slice(0, 10),
        hrComment: "Created via Emergency Override",
        createdAt: new Date().toISOString(),
      });
      setShowOverride(false);
      setOverrideForm({ employee: "", startDate: "", endDate: "", reason: "", approveImmediately: false });
      showToast(`Emergency leave ${overrideForm.approveImmediately ? "approved" : "submitted"} for ${overrideForm.employee}.`);
    } catch {
      showToast("Failed to save override. Please try again.", false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {actionToast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg flex items-center gap-2 ${actionToast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {actionToast.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
          {actionToast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
          <p className="text-gray-500 text-sm mt-1">Manage leave requests and balances</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <Wifi size={12} /> Live sync
          </span>
          <button onClick={() => setShowOverride(true)} className="bg-red-500 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-red-600">
            Emergency Override
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Pending Requests", value: pending,         color: "bg-yellow-50 border border-yellow-100", text: "text-yellow-700" },
          { label: "Approved",         value: approved,        color: "bg-green-50 border border-green-100",   text: "text-green-700"  },
          { label: "Rejected",         value: rejected,        color: "bg-red-50 border border-red-100",       text: "text-red-700"    },
          { label: "Total Requests",   value: visibleRequests.length, color: "bg-purple-50 border border-purple-100", text: "text-purple-700" },
        ].map(c => (
          <div key={c.label} className={`${c.color} rounded-2xl p-5`}>
            <p className={`text-2xl font-bold ${c.text}`}>{c.value}</p>
            <p className="text-sm text-gray-600 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Tab Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center border-b border-gray-100">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap ${activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"}`}>
              {tab}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />}
            </button>
          ))}
          <div className="ml-auto px-4">
            {activeTab === "Leave Requests" && visibleRequests.length > 0 && (
              <button onClick={clearAll} className="text-xs font-medium text-red-400 hover:text-red-600">
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* ── Leave Requests ── */}
        {activeTab === "Leave Requests" && (
          <div>
            {!ready ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
              </div>
            ) : visibleRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Clock size={36} className="mb-3 text-gray-200" />
                <p className="text-sm font-medium text-gray-500">No leave requests yet</p>
                <p className="text-xs mt-1">Employee submissions will appear here in real time</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                      {["Employee","Leave Type","Start","End","Days","Reason","Status","Applied On","HR Comment","Actions"].map(h => (
                        <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visibleRequests.map(r => (
                      <tr key={r.id} className={`hover:bg-gray-50 ${r.status === "Approved" ? "bg-green-50/30" : r.status === "Rejected" ? "bg-red-50/20" : ""}`}>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{displayName(r)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColor[r.leaveType] ?? "bg-gray-100 text-gray-700"}`}>
                            {r.leaveType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.startDate}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.endDate}</td>
                        <td className="px-4 py-3 text-gray-600">{r.days}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[140px]">
                          <span className="truncate block" title={r.reason}>{r.reason}</span>
                          {r.proofUrl && (
                            <a href={r.proofUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-[#4F3CC9] font-medium hover:underline">
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              Supporting Doc
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[r.status]}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.appliedOn}</td>
                        <td className="px-4 py-3 min-w-[180px]">
                          {r.status === "Pending" ? (
                            <textarea
                              placeholder="Comment (optional)…"
                              value={hrComments[r.id] ?? ""}
                              onChange={e => setHrComments(p => ({ ...p, [r.id]: e.target.value }))}
                              rows={2}
                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#4F3CC9] resize-none"
                            />
                          ) : (
                            <span className="text-xs text-gray-500 whitespace-pre-wrap">{r.hrComment || "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.status === "Pending" ? (
                            <div className="flex gap-1 flex-wrap">
                              <button onClick={() => approve(r.id)} className="px-2 py-1 rounded-lg bg-green-100 text-green-700 text-xs font-medium hover:bg-green-200">Approve</button>
                              <button onClick={() => reject(r.id)}  className="px-2 py-1 rounded-lg bg-red-100 text-red-600 text-xs font-medium hover:bg-red-200">Reject</button>
                              <button onClick={() => openEditReq(r)} title="Edit" className="p-1.5 rounded-lg hover:bg-purple-50 text-[#4F3CC9]"><Pencil size={13} /></button>
                              <button onClick={() => deleteRequest(r.id)} title="Delete permanently" className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <button onClick={() => setViewReq(r)} title="View" className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"><Eye size={14} /></button>
                              <button onClick={() => openEditReq(r)} title="Edit" className="p-1.5 rounded-lg hover:bg-purple-50 text-[#4F3CC9]"><Pencil size={14} /></button>
                              <button onClick={() => deleteRequest(r.id)} title="Delete permanently" className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Leave Balances ── */}
        {activeTab === "Leave Balances" && (
          <div className="overflow-x-auto">
            {balances.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No leave balances configured.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    {["Employee","Casual (Used/Total)","Sick","Emergency","Paid","Actions"].map(h => (
                      <th key={h} className={`px-4 py-3 ${h === "Employee" || h === "Actions" ? "text-left" : "text-center"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {balances.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{b.name}</td>
                      {[b.casual, b.sick, b.emergency, b.paid].map((lb, i) => (
                        <td key={i} className="px-4 py-3 text-center text-gray-600 text-xs">{lb.used}/{lb.total}</td>
                      ))}
                      <td className="px-4 py-3">
                        <button onClick={() => openEditBal(b)} className="flex items-center gap-1 text-xs text-[#4F3CC9] hover:underline">
                          <Pencil size={11} /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Leave Calendar ── */}
        {activeTab === "Leave Calendar" && (
          <div className="p-6">
            {/* Header: month navigation + legend */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <button onClick={goPrevMonth} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                  <ChevronLeft size={16} />
                </button>
                <h2 className="text-base font-semibold text-gray-900 min-w-[160px] text-center">{calMonthLabel}</h2>
                <button onClick={goNextMonth} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                  <ChevronRight size={16} />
                </button>
                {!isCurrentMonth && (
                  <button onClick={() => { setViewMonth(now.getMonth()); setViewYear(now.getFullYear()); setSelectedDay(null); }}
                    className="text-xs text-[#4F3CC9] font-medium hover:underline ml-1">
                    Today
                  </button>
                )}
              </div>
              <div className="flex gap-4 flex-wrap">
                {["Casual Leave","Sick Leave","Emergency Leave","Annual Leave"].map(t => (
                  <span key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className={`w-2.5 h-2.5 rounded-full ${typeChipColor[t] ?? "bg-gray-400"}`} />
                    {t.replace(" Leave", "")}
                  </span>
                ))}
                {isCurrentMonth && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="w-4 h-4 rounded-md bg-[#4F3CC9] inline-block" />Today
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-4 h-4 rounded-md ring-2 ring-[#4F3CC9] inline-block" />Selected
                </span>
              </div>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <div key={d} className={`text-center text-xs font-semibold py-2 ${i === 0 || i === 6 ? "text-red-400" : "text-gray-500"}`}>{d}</div>
              ))}
            </div>

            {/* Calendar grid — each day is clickable */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: calFirstDay }).map((_, i) => (
                <div key={`e${i}`} className="min-h-[80px] rounded-xl bg-gray-50/50" />
              ))}
              {Array.from({ length: calDaysInMonth }).map((_, i) => {
                const day       = i + 1;
                const isToday   = isCurrentMonth && day === now.getDate();
                const isSelected = selectedDay === day;
                const dayLeaves = calDayMap[day] ?? [];
                const dayOfWeek = (calFirstDay + i) % 7;
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                return (
                  <div
                    key={day}
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className={`min-h-[80px] rounded-xl p-1.5 flex flex-col gap-1 border transition-all cursor-pointer
                      ${isSelected
                        ? "ring-2 ring-[#4F3CC9] border-[#4F3CC9] bg-[#EDE9FF]"
                        : isToday
                          ? "border-[#4F3CC9] bg-[#EDE9FF]"
                          : isWeekend
                            ? "bg-red-50/40 border-red-100 hover:border-red-300"
                            : "border-gray-100 bg-white hover:border-[#4F3CC9]/40 hover:bg-[#F5F3FF]/60"
                      }`}
                  >
                    <span className={`text-xs font-semibold self-end px-1 ${isSelected || isToday ? "text-[#4F3CC9]" : isWeekend ? "text-red-400" : "text-gray-500"}`}>
                      {day}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {dayLeaves.slice(0, 2).map((r, j) => (
                        <div key={j} title={`${displayName(r)} — ${r.leaveType}`}
                          className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-white text-[9px] font-medium truncate ${typeChipColor[r.leaveType] ?? "bg-gray-500"}`}>
                          <span className="shrink-0 w-3.5 h-3.5 rounded-full bg-white/30 flex items-center justify-center text-[8px] font-bold">
                            {initials(displayName(r))}
                          </span>
                          <span className="truncate">{displayName(r).split(" ")[0]}</span>
                        </div>
                      ))}
                      {dayLeaves.length > 2 && (
                        <div className="text-[9px] text-gray-400 pl-1">+{dayLeaves.length - 2} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer stats */}
            <div className="mt-4 flex items-center gap-6 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{Object.keys(calDayMap).length}</span> days with approved leaves
              </span>
              <span className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{requests.filter(r => r.status === "Approved").length}</span> total approved
              </span>
              {!isCurrentMonth && !isFutureMonth && (
                <span className="text-xs text-amber-600 font-medium">Viewing past month</span>
              )}
              {isFutureMonth && (
                <span className="text-xs text-blue-600 font-medium">Viewing future month</span>
              )}
            </div>

            {/* Selected day — absent employees table */}
            {selectedDay !== null && (() => {
              const dayLeaves = calDayMap[selectedDay] ?? [];
              const dateLabel = new Date(viewYear, viewMonth, selectedDay)
                .toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
              return (
                <div className="mt-5 border border-[#4F3CC9]/20 rounded-2xl overflow-hidden">
                  <div className="bg-[#F5F3FF] px-5 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users size={15} className="text-[#4F3CC9]" />
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{dateLabel}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {dayLeaves.length === 0
                            ? "No employees on approved leave"
                            : `${dayLeaves.length} employee${dayLeaves.length !== 1 ? "s" : ""} on approved leave`}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setSelectedDay(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white">
                      <X size={15} />
                    </button>
                  </div>

                  {dayLeaves.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 text-sm">
                      No approved leaves recorded for this date.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide border-b border-gray-100">
                            <th className="px-4 py-2.5 text-left w-8">#</th>
                            <th className="px-4 py-2.5 text-left">Employee</th>
                            <th className="px-4 py-2.5 text-left">Emp ID</th>
                            <th className="px-4 py-2.5 text-left">Department</th>
                            <th className="px-4 py-2.5 text-left">Leave Type</th>
                            <th className="px-4 py-2.5 text-left">Period</th>
                            <th className="px-4 py-2.5 text-left">Days</th>
                            <th className="px-4 py-2.5 text-left">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {dayLeaves.map((r, idx) => (
                            <tr key={r.id} className="hover:bg-[#F5F3FF]/60">
                              <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] text-[10px] font-bold shrink-0">
                                    {initials(displayName(r))}
                                  </div>
                                  <span className="font-medium text-gray-900">{displayName(r)}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs font-mono">{r.empId || "—"}</td>
                              <td className="px-4 py-3 text-gray-600 text-xs">{empDeptMap[r.empId ?? ""] || "—"}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColor[r.leaveType] ?? "bg-gray-100 text-gray-700"}`}>
                                  {r.leaveType}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                                {r.startDate} → {r.endDate}
                              </td>
                              <td className="px-4 py-3 text-gray-700 font-medium">{r.days}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs max-w-[180px]">
                                <span className="truncate block" title={r.reason}>{r.reason || "—"}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Edit Leave Balance Modal */}
      {editBal && editBalForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setEditBal(null); setEditBalForm(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Leave Balance</h2>
                <p className="text-xs text-gray-500 mt-0.5">{editBal.name}</p>
              </div>
              <button onClick={() => { setEditBal(null); setEditBalForm(null); }}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {([
                { key: "casual",    label: "Casual Leave",    color: "text-blue-600"   },
                { key: "sick",      label: "Sick Leave",      color: "text-orange-500" },
                { key: "emergency", label: "Emergency Leave", color: "text-red-600"    },
                { key: "paid",      label: "Paid Leave",      color: "text-purple-600" },
              ] as { key: keyof Omit<LeaveBalance, "id"|"name">; label: string; color: string }[]).map(({ key, label, color }) => (
                <div key={key} className="flex items-center justify-between gap-4 bg-gray-50 rounded-xl px-4 py-3">
                  <span className={`text-sm font-medium ${color} w-36`}>{label}</span>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <label className="text-[10px] text-gray-400">Used</label>
                      <input type="number" min={0}
                        value={editBalForm[key].used}
                        onChange={e => setEditBalForm({ ...editBalForm, [key]: { ...editBalForm[key], used: parseInt(e.target.value) || 0 } })}
                        className="w-14 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#4F3CC9]"
                      />
                    </div>
                    <span className="text-gray-300">/</span>
                    <div className="flex flex-col items-center gap-0.5">
                      <label className="text-[10px] text-gray-400">Total</label>
                      <input type="number" min={0}
                        value={editBalForm[key].total}
                        onChange={e => setEditBalForm({ ...editBalForm, [key]: { ...editBalForm[key], total: parseInt(e.target.value) || 0 } })}
                        className="w-14 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#4F3CC9]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => { setEditBal(null); setEditBalForm(null); }}
                className="flex-1 border border-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={saveEditBal}
                className="flex-1 bg-[#4F3CC9] text-white px-4 py-2 rounded-full text-sm hover:bg-[#3d2fa3]">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Override Modal */}
      {showOverride && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowOverride(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-base font-bold text-red-600">Emergency Leave Override</h2>
              <button onClick={() => setShowOverride(false)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Employee Name</label>
                <input placeholder="Enter employee name" value={overrideForm.employee}
                  onChange={e => setOverrideForm(f => ({ ...f, employee: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input type="date" value={overrideForm.startDate}
                    onChange={e => setOverrideForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input type="date" value={overrideForm.endDate}
                    onChange={e => setOverrideForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea rows={2} placeholder="Override reason..." value={overrideForm.reason}
                  onChange={e => setOverrideForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-500 resize-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={overrideForm.approveImmediately}
                  onChange={e => setOverrideForm(f => ({ ...f, approveImmediately: e.target.checked }))} className="rounded" />
                Auto-approve immediately
              </label>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => setShowOverride(false)}
                className="flex-1 border border-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleEmergencyOverride}
                className="flex-1 bg-red-500 text-white px-4 py-2 rounded-full text-sm hover:bg-red-600">Submit Override</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Request Modal */}
      {editReq && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditReq(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Leave Request</h2>
                <p className="text-xs text-gray-500 mt-0.5">{displayName(editReq)} — {editReq.leaveType}</p>
              </div>
              <button onClick={() => setEditReq(null)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Read-only summary */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <span className="text-gray-400 w-20 shrink-0">Dates</span>
                  <span className="text-gray-700">{editReq.startDate} → {editReq.endDate} <span className="text-gray-400">({editReq.days} day{editReq.days !== 1 ? "s" : ""})</span></span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-400 w-20 shrink-0">Reason</span>
                  <span className="text-gray-700">{editReq.reason}</span>
                </div>
                {editReq.proofUrl && (
                  <div className="flex gap-2">
                    <span className="text-gray-400 w-20 shrink-0">Proof</span>
                    <a href={editReq.proofUrl} target="_blank" rel="noopener noreferrer" className="text-[#4F3CC9] hover:underline text-xs font-medium">
                      {editReq.proofFileName || "View Proof"}
                    </a>
                  </div>
                )}
              </div>

              {/* Status selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {(["Pending", "Approved", "Rejected"] as LeaveStatus[]).map(s => (
                    <button key={s} onClick={() => setEditForm(f => ({ ...f, status: s }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                        editForm.status === s
                          ? s === "Approved" ? "bg-green-500 text-white border-green-500"
                            : s === "Rejected" ? "bg-red-500 text-white border-red-500"
                            : "bg-yellow-400 text-white border-yellow-400"
                          : "border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* HR Comment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">HR Comment</label>
                <textarea rows={3} placeholder="Add a comment for the employee…"
                  value={editForm.hrComment}
                  onChange={e => setEditForm(f => ({ ...f, hrComment: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none" />
              </div>
            </div>
            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => setEditReq(null)}
                className="flex-1 border border-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={saveEditReq} disabled={savingEdit}
                className="flex-1 bg-[#4F3CC9] text-white px-4 py-2 rounded-full text-sm hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                {savingEdit ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Request Modal */}
      {viewReq && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setViewReq(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-base font-bold text-gray-900">Leave Request Details</h2>
              <button onClick={() => setViewReq(null)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: "Employee",   value: displayName(viewReq)    },
                { label: "Leave Type", value: viewReq.leaveType       },
                { label: "From",       value: viewReq.startDate       },
                { label: "To",         value: viewReq.endDate         },
                { label: "Days",       value: String(viewReq.days)    },
                { label: "Reason",     value: viewReq.reason          },
                { label: "Applied On", value: viewReq.appliedOn       },
                { label: "Status",     value: viewReq.status          },
                { label: "HR Comment", value: viewReq.hrComment || "—"},
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">{label}</span>
                  <span className="text-sm text-gray-800 font-medium">{value}</span>
                </div>
              ))}

              {/* Supporting Doc */}
              <div className="flex gap-3 pt-1">
                <span className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">Supporting Doc</span>
                {viewReq.proofUrl ? (
                  <a
                    href={viewReq.proofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium hover:underline"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {viewReq.proofFileName || "View Proof"}
                  </a>
                ) : (
                  <span className="text-sm text-gray-400">No proof attached</span>
                )}
              </div>
            </div>
            <div className="p-5 pt-0">
              <button onClick={() => setViewReq(null)}
                className="w-full bg-[#4F3CC9] text-white px-4 py-2 rounded-full text-sm hover:bg-[#3d2fa3]">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
