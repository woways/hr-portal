"use client";
import { useState, useEffect } from "react";
import { Plus, X, CheckCircle, Clock, XCircle, CalendarX, Loader2 } from "lucide-react";
import { collection, query, where, getDocs, addDoc, getDoc, doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { SkeletonListRow } from "@/components/Skeleton";

const LEAVE_TYPE_COLORS: Record<string, string> = {
  "Annual Leave":    "#4F3CC9",
  "Sick Leave":      "#10B981",
  "Casual Leave":    "#F59E0B",
  "Emergency Leave": "#EF4444",
  "Paid Leave":      "#4F3CC9",
};
const DEFAULT_COLOR = "#6B7280";

interface LeavePolicy { id: string; type: string; days: number; carryForward: boolean; resetMonth: string; }

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  appliedOn: string;
  empId: string;
}

const statusBadge = (status: string) => {
  switch (status) {
    case "Approved":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
          <CheckCircle size={11} /> Approved
        </span>
      );
    case "Pending":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
          <Clock size={11} /> Pending
        </span>
      );
    case "Rejected":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
          <XCircle size={11} /> Rejected
        </span>
      );
    default:
      return null;
  }
};

export default function LeavePage() {
  const [showModal, setShowModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ leaveType: "", startDate: "", endDate: "", reason: "" });
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<LeavePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [empId, setEmpId] = useState<string | null>(null);
  const [empName, setEmpName] = useState("");

  useEffect(() => {
    let reqUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        // Resolve empId: users/{uid}.employeeId first, employees email lookup as fallback
        let id = "";
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          id = String(uSnap.data().employeeId ?? "");
        }
        if (!id && user.email) {
          const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!emailSnap.empty) id = emailSnap.docs[0].id;
        }
        if (!id) { setLoading(false); return; }
        setEmpId(id);

        // Load employee name + leave policies in parallel
        const [empSnap, policySnap] = await Promise.all([
          getDoc(doc(db, "employees", id)).catch(() => null),
          getDoc(doc(db, "settings", "leavePolicies")).catch(() => null),
        ]);

        if (empSnap?.exists()) {
          setEmpName((empSnap.data().name as string) ?? "");
        }

        if (policySnap?.exists() && policySnap.data().list) {
          const policies = policySnap.data().list as LeavePolicy[];
          setLeavePolicies(policies);
          setLeaveForm((f) => ({ ...f, leaveType: policies[0]?.type ?? "" }));
        } else {
          const defaults: LeavePolicy[] = [
            { id: "1", type: "Annual Leave",    days: 18, carryForward: false, resetMonth: "January" },
            { id: "2", type: "Sick Leave",      days: 10, carryForward: false, resetMonth: "January" },
            { id: "3", type: "Casual Leave",    days: 6,  carryForward: false, resetMonth: "January" },
            { id: "4", type: "Emergency Leave", days: 2,  carryForward: false, resetMonth: "January" },
          ];
          setLeavePolicies(defaults);
          setLeaveForm((f) => ({ ...f, leaveType: defaults[0].type }));
        }

        // Real-time listener for this employee's leave requests — updates instantly when HR approves/rejects
        reqUnsub = onSnapshot(
          query(collection(db, "leaveRequests"), where("empId", "==", id)),
          (snap) => {
            const loaded = snap.docs.map((d) => {
              const r = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                empId: String(r.empId ?? ""),
                leaveType: String(r.leaveType ?? r.type ?? ""),
                startDate: String(r.startDate ?? r.from ?? ""),
                endDate: String(r.endDate ?? r.to ?? ""),
                days: Number(r.days ?? 0),
                reason: String(r.reason ?? ""),
                status: String(r.status ?? "Pending"),
                appliedOn: String(r.appliedOn ?? ""),
              } as LeaveRequest;
            });
            loaded.sort((a, b) => b.appliedOn.localeCompare(a.appliedOn));
            setRequests(loaded);
            setLoading(false);
          },
          () => setLoading(false)
        );
      } catch { setLoading(false); }
    });
    return () => { authUnsub(); reqUnsub?.(); };
  }, []);

  // Compute remaining days per leave type from approved requests
  const usedByType: Record<string, number> = {};
  for (const req of requests) {
    if (req.status === "Approved") {
      usedByType[req.leaveType] = (usedByType[req.leaveType] ?? 0) + (req.days ?? 0);
    }
  }
  const leaveBalances = leavePolicies.map((p) => {
    const used = usedByType[p.type] ?? 0;
    return { type: p.type, total: p.days, remaining: Math.max(0, p.days - used), color: LEAVE_TYPE_COLORS[p.type] ?? DEFAULT_COLOR };
  });

  function countWorkdays(start: Date, end: Date): number {
    let count = 0;
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return Math.max(1, count);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId || submitting) return;
    setFormError("");
    const start = new Date(leaveForm.startDate);
    const end = new Date(leaveForm.endDate);
    if (end < start) {
      setFormError("End date cannot be before the start date.");
      return;
    }
    setSubmitting(true);
    try {
      const days = countWorkdays(start, end);
      const appliedOn = new Date().toISOString().split("T")[0];
      const payload = {
        empId,
        empName,
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        days,
        reason: leaveForm.reason,
        status: "Pending",
        appliedOn,
      };
      const ref = await addDoc(collection(db, "leaveRequests"), payload);
      setRequests((prev) => [{ id: ref.id, ...payload }, ...prev]);
      setShowModal(false);
      setLeaveForm({ leaveType: "Annual Leave", startDate: "", endDate: "", reason: "" });
    } catch { /* ignore */ } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leave</h1>
          <p className="text-gray-500 text-sm mt-1">Apply for leaves and track your requests.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
        >
          <Plus size={16} /> Apply Leave
        </button>
      </div>

      {/* Leave Balance Cards */}
      <div className="grid grid-cols-4 gap-4">
        {leaveBalances.map((leave) => {
          const pct = Math.round((leave.remaining / leave.total) * 100);
          return (
            <div key={leave.type} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <CalendarX size={16} style={{ color: leave.color }} />
                <span className="text-sm font-medium text-gray-700">{leave.type}</span>
              </div>
              <div className="flex items-end justify-between mb-2">
                <p className="text-2xl font-bold text-gray-900">{leave.remaining}</p>
                <p className="text-xs text-gray-400 mb-1">/ {leave.total} days</p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: leave.color }} />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">{leave.remaining} remaining</p>
            </div>
          );
        })}
      </div>

      {/* Leave Requests Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Leave Requests</h2>
        </div>
        {loading ? (
          <div>
            {Array.from({ length: 4 }, (_, i) => <SkeletonListRow key={i} withAvatar={false} />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="py-14 text-center text-gray-400 text-sm">No leave requests yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F5F3FF]">
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">Leave Type</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">From</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">To</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">Days</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">Reason</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">Applied On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-[#F5F3FF] transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{req.leaveType}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{req.startDate}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{req.endDate}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{req.days}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[160px] truncate">{req.reason}</td>
                    <td className="px-6 py-4">{statusBadge(req.status)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{req.appliedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Apply for Leave</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                >
                  {leavePolicies.map((p) => <option key={p.type}>{p.type}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.startDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input
                    type="date"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{formError}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setFormError(""); }}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {submitting ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : "Submit Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
