"use client";
import { useState } from "react";
import { Plus, X, CheckCircle, Clock, XCircle, Calendar } from "lucide-react";

const leaveBalances = [
  { type: "Casual Leave", total: 0, used: 0, color: "#4F3CC9", bg: "bg-purple-50", text: "text-[#4F3CC9]" },
  { type: "Sick Leave", total: 0, used: 0, color: "#10B981", bg: "bg-green-50", text: "text-green-600" },
  { type: "Emergency Leave", total: 0, used: 0, color: "#EF4444", bg: "bg-red-50", text: "text-red-600" },
  { type: "Paid Leave", total: 0, used: 0, color: "#F59E0B", bg: "bg-yellow-50", text: "text-yellow-600" },
];

const initialLeaveRequests: { type: string; startDate: string; endDate: string; days: number; reason: string; status: string; manager: string }[] = [];

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

export default function LeavesPage() {
  const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

  const [showModal, setShowModal] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState(initialLeaveRequests);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "Casual Leave",
    startDate: "",
    endDate: "",
    reason: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const start = new Date(leaveForm.startDate);
    const end = new Date(leaveForm.endDate);
    const days =
      Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
      1;
    setLeaveRequests([
      {
        type: leaveForm.leaveType,
        startDate: start.toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        endDate: end.toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        days: isNaN(days) ? 1 : days,
        reason: leaveForm.reason,
        status: "Pending",
        manager: "",
      },
      ...leaveRequests,
    ]);
    setShowModal(false);
    setLeaveForm({
      leaveType: "Casual Leave",
      startDate: "",
      endDate: "",
      reason: "",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leaves</h1>
          <p className="text-gray-500 text-sm mt-1">
            Apply for leaves and track your requests.
          </p>
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
          const remaining = leave.total - leave.used;
          const pct = Math.round((remaining / leave.total) * 100);
          return (
            <div
              key={leave.type}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`w-8 h-8 rounded-lg ${leave.bg} flex items-center justify-center`}
                >
                  <Calendar size={15} style={{ color: leave.color }} />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {leave.type}
                </span>
              </div>
              <div className="flex items-end justify-between mb-2">
                <p className="text-2xl font-bold text-gray-900">{remaining}</p>
                <p className="text-xs text-gray-400 mb-1">
                  / {leave.total} days
                </p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-1.5">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: leave.color,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400">
                {leave.used} used · {remaining} remaining
              </p>
            </div>
          );
        })}
      </div>

      {/* Leave History Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Leave History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F5F3FF]">
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Leave Type
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Start Date
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  End Date
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Days
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Reason
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide">
                  Manager
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {leaveRequests.map((req, i) => (
                <tr key={i} className="hover:bg-[#F5F3FF] transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {req.type}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {req.startDate}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {req.endDate}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {req.days}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-[160px] truncate">
                    {req.reason}
                  </td>
                  <td className="px-6 py-4">{statusBadge(req.status)}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {req.manager}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Apply for Leave</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Leave Type
                </label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                  value={leaveForm.leaveType}
                  onChange={(e) =>
                    setLeaveForm({ ...leaveForm, leaveType: e.target.value })
                  }
                >
                  <option>Casual Leave</option>
                  <option>Sick Leave</option>
                  <option>Emergency Leave</option>
                  <option>Paid Leave</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    min={today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.startDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLeaveForm({
                        ...leaveForm,
                        startDate: val,
                        // reset end date if it's before the new start
                        endDate: leaveForm.endDate < val ? val : leaveForm.endDate,
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    required
                    min={leaveForm.startDate || today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.endDate}
                    onChange={(e) =>
                      setLeaveForm({ ...leaveForm, endDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Reason
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={leaveForm.reason}
                  onChange={(e) =>
                    setLeaveForm({ ...leaveForm, reason: e.target.value })
                  }
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3]"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
