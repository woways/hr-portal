"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, updateDoc, doc, addDoc, getDocs, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Eye, Pencil, X, CheckCircle, XCircle, Wifi, Loader2, Clock } from "lucide-react";

type LeaveStatus = "Pending" | "Approved" | "Rejected";

interface LeaveRequest {
  id:         string;
  empId?:     string;
  empName?:   string;
  name?:      string;
  leaveType:  string;
  startDate:  string;
  endDate:    string;
  days:       number;
  reason:     string;
  status:     LeaveStatus;
  appliedOn:  string;
  hrComment?: string;
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
  const now         = new Date();
  const thisMonth   = now.getMonth();
  const thisYear    = now.getFullYear();
  const daysInMonth = new Date(thisYear, thisMonth + 1, 0).getDate();
  const firstDay    = new Date(thisYear, thisMonth, 1).getDay();
  const monthLabel  = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }).replace(",", "");

  const [ready,       setReady]       = useState(false);
  const [requests,    setRequests]    = useState<LeaveRequest[]>([]);
  const [balances,    setBalances]    = useState<LeaveBalance[]>([]);
  const [hrComments,  setHrComments]  = useState<Record<string, string>>({});
  const [actionToast, setActionToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editBal,     setEditBal]     = useState<LeaveBalance | null>(null);
  const [editBalForm, setEditBalForm] = useState<LeaveBalance | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ employee: "", startDate: "", endDate: "", reason: "", approveImmediately: false });
  const [viewReq,     setViewReq]     = useState<LeaveRequest | null>(null);

  const TABS = ["Leave Requests", "Leave Balances", "Leave Calendar"] as const;
  type Tab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<Tab>("Leave Requests");

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
              hrComment: r.hrComment ? String(r.hrComment) : undefined,
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
      setHrComments(p => { const n = { ...p }; delete n[id]; return n; });
      showToast("Rejected — employee will see the update instantly.");
    } catch {
      showToast("Failed to reject. Please check your connection.", false);
    }
  }

  // Calendar — show approved leaves in the current month only
  const calendarLeaves: Record<number, { name: string; leaveType: string }[]> = {};
  requests.filter(r => r.status === "Approved").forEach(r => {
    const start = new Date(r.startDate + "T00:00:00");
    const end   = new Date(r.endDate   + "T00:00:00");
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
        const day = d.getDate();
        if (!calendarLeaves[day]) calendarLeaves[day] = [];
        calendarLeaves[day].push({ name: displayName(r), leaveType: r.leaveType });
      }
    }
  });

  const pending  = requests.filter(r => r.status === "Pending").length;
  const approved = requests.filter(r => r.status === "Approved").length;
  const rejected = requests.filter(r => r.status === "Rejected").length;

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
          { label: "Total Requests",   value: requests.length, color: "bg-purple-50 border border-purple-100", text: "text-purple-700" },
        ].map(c => (
          <div key={c.label} className={`${c.color} rounded-2xl p-5`}>
            <p className={`text-2xl font-bold ${c.text}`}>{c.value}</p>
            <p className="text-sm text-gray-600 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Tab Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap ${activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"}`}>
              {tab}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />}
            </button>
          ))}
        </div>

        {/* ── Leave Requests ── */}
        {activeTab === "Leave Requests" && (
          <div>
            {!ready ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
              </div>
            ) : requests.length === 0 ? (
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
                    {requests.map(r => (
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
                        <td className="px-4 py-3 text-gray-600 max-w-[140px] truncate" title={r.reason}>{r.reason}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[r.status]}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.appliedOn}</td>
                        <td className="px-4 py-3 min-w-[160px]">
                          {r.status === "Pending" ? (
                            <input
                              placeholder="Comment (optional)…"
                              value={hrComments[r.id] ?? ""}
                              onChange={e => setHrComments(p => ({ ...p, [r.id]: e.target.value }))}
                              className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#4F3CC9]"
                            />
                          ) : (
                            <span className="text-xs text-gray-500">{r.hrComment || "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.status === "Pending" ? (
                            <div className="flex gap-1">
                              <button onClick={() => approve(r.id)} className="px-2 py-1 rounded-lg bg-green-100 text-green-700 text-xs font-medium hover:bg-green-200">Approve</button>
                              <button onClick={() => reject(r.id)}  className="px-2 py-1 rounded-lg bg-red-100 text-red-600 text-xs font-medium hover:bg-red-200">Reject</button>
                            </div>
                          ) : (
                            <button onClick={() => setViewReq(r)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"><Eye size={14} /></button>
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
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900">Leave Calendar — {monthLabel}</h2>
              <div className="flex gap-4 flex-wrap">
                {["Casual Leave","Sick Leave","Emergency Leave","Annual Leave"].map(t => (
                  <span key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className={`w-2.5 h-2.5 rounded-full ${typeChipColor[t] ?? "bg-gray-400"}`} />
                    {t.replace(" Leave", "")}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-4 h-4 rounded-md bg-[#4F3CC9] inline-block" />Today
                </span>
              </div>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <div key={d} className={`text-center text-xs font-semibold py-2 ${i === 0 || i === 6 ? "text-red-400" : "text-gray-500"}`}>{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`e${i}`} className="min-h-[80px] rounded-xl bg-gray-50/50" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday   = day === now.getDate();
                const dayLeaves = calendarLeaves[day] ?? [];
                const dayOfWeek = (firstDay + i) % 7;
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                return (
                  <div key={day} className={`min-h-[80px] rounded-xl p-1.5 flex flex-col gap-1 border transition-all
                    ${isToday ? "border-[#4F3CC9] bg-[#EDE9FF]" : isWeekend ? "bg-red-50/40 border-red-100" : "border-gray-100 bg-white hover:border-[#4F3CC9]/30 hover:bg-[#F5F3FF]/60"}`}>
                    <span className={`text-xs font-semibold self-end px-1 ${isToday ? "text-[#4F3CC9]" : isWeekend ? "text-red-400" : "text-gray-500"}`}>
                      {day}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {dayLeaves.slice(0, 2).map((lv, j) => (
                        <div key={j} title={`${lv.name} — ${lv.leaveType}`}
                          className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-white text-[9px] font-medium truncate ${typeChipColor[lv.leaveType] ?? "bg-gray-500"}`}>
                          <span className="shrink-0 w-3.5 h-3.5 rounded-full bg-white/30 flex items-center justify-center text-[8px] font-bold">
                            {initials(lv.name)}
                          </span>
                          <span className="truncate">{lv.name.split(" ")[0]}</span>
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

            <div className="mt-4 flex items-center gap-6 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{Object.keys(calendarLeaves).length}</span> days with approved leaves this month
              </span>
              <span className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{approved}</span> total approved
              </span>
            </div>
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
