"use client";
import { useState, useEffect } from "react";
import { Plus, ClipboardList, TrendingUp, CheckCircle2, X } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { getDocs, addDoc, updateDoc, collection, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { OnboardingRecord } from "@/lib/types";

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function ChecklistModal({
  record,
  onClose,
  onSaved,
}: {
  record: OnboardingRecord;
  onClose: () => void;
  onSaved: (updated: OnboardingRecord) => void;
}) {
  const [tasks, setTasks] = useState(record.tasks);
  const [saving, setSaving] = useState(false);

  function toggleTask(id: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  }

  const completedCount = tasks.filter((t) => t.completed).length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  async function handleSave() {
    setSaving(true);
    try {
      await updateDoc(doc(db, "onboarding", record.id), { tasks });
      onSaved({ ...record, tasks, progress });
      onClose();
    } catch (err) {
      console.error("Failed to save progress:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Onboarding Checklist
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{record.employeeName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-500">
              {completedCount} of {tasks.length} tasks
            </span>
            <span className="text-xs font-semibold text-[#4F3CC9]">{progress}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-5">
            <div
              className="h-2 rounded-full bg-[#4F3CC9] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="space-y-2">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                  task.completed
                    ? "border-green-200 bg-green-50"
                    : "border-gray-100 hover:bg-gray-50"
                }`}
              >
                <CheckCircle2
                  size={18}
                  className={task.completed ? "text-green-500" : "text-gray-300"}
                />
                <span
                  className={`text-sm ${
                    task.completed
                      ? "text-green-700 line-through"
                      : "text-gray-700"
                  }`}
                >
                  {task.title}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-6 pb-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 text-sm bg-[#4F3CC9] text-white rounded-full hover:bg-[#3d2fa0] transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Progress"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StartOnboardingModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: "", empId: "", startDate: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.empId.trim() || !form.startDate) {
      setError("All fields are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await addDoc(collection(db, "onboarding"), {
        employeeName: form.name.trim(),
        empId: form.empId.trim(),
        startDate: form.startDate,
        status: "In Progress",
        tasks: [
          { id: "1", title: "Send welcome email", completed: false },
          { id: "2", title: "Set up workstation", completed: false },
          { id: "3", title: "Complete HR paperwork", completed: false },
          { id: "4", title: "Attend orientation", completed: false },
          { id: "5", title: "Meet the team", completed: false },
        ],
        createdAt: new Date().toISOString(),
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error("Failed to create onboarding record:", err);
      setError("Failed to create record. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Start Onboarding</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Employee Name
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Priya Sharma"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 focus:border-[#4F3CC9]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Employee ID
            </label>
            <input
              name="empId"
              value={form.empId}
              onChange={handleChange}
              placeholder="e.g. EMP-042"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 focus:border-[#4F3CC9]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Start Date
            </label>
            <input
              name="startDate"
              type="date"
              value={form.startDate}
              onChange={handleChange}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 focus:border-[#4F3CC9]"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-sm bg-[#4F3CC9] text-white rounded-full hover:bg-[#3d2fa0] transition-colors disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<OnboardingRecord | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadRecords() {
    try {
      const snap = await getDocs(collection(db, "onboarding"));
      const data: OnboardingRecord[] = snap.docs.map((d) => {
        const raw = d.data();
        const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
        const completedCount = tasks.filter((t: { completed: boolean }) => t.completed).length;
        const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
        return {
          id: d.id,
          employeeId: raw.empId ?? raw.employeeId ?? "",
          employeeName: raw.employeeName ?? "",
          role: raw.role ?? "",
          department: raw.department ?? "",
          startDate: raw.startDate ?? "",
          progress,
          tasks,
        };
      });
      setRecords(data);
    } catch (err) {
      console.error("Failed to load onboarding records:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        loadRecords();
      } else {
        setRecords([]);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  function handleRecordSaved(updated: OnboardingRecord) {
    setRecords((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r))
    );
  }

  const activeCount = records.length;
  const pendingTasks = records.reduce(
    (sum, r) => sum + r.tasks.filter((t) => !t.completed).length,
    0
  );

  const currentMonthLabel = new Date().toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const completedThisMonth = records.filter((r) => r.progress === 100).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Onboarding</h1>
          <p className="text-gray-500 text-sm mt-1">
            Streamline new hire onboarding and track progress.
          </p>
        </div>
        <button
          onClick={() => setShowStartModal(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa0] transition-colors"
        >
          <Plus size={16} />
          Start Onboarding
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
            +12%
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center mb-3">
            <TrendingUp size={20} className="text-[#4F3CC9]" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-sm font-medium text-gray-700 mt-1">Active Onboardings</p>
          <p className="text-xs text-gray-400 mt-0.5">Currently in progress</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 bg-yellow-100 text-yellow-700 text-xs font-medium px-2 py-0.5 rounded-full">
            Action required
          </div>
          <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center mb-3">
            <ClipboardList size={20} className="text-yellow-600" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{pendingTasks}</p>
          <p className="text-sm font-medium text-gray-700 mt-1">Pending Tasks</p>
          <p className="text-xs text-gray-400 mt-0.5">Across all onboardings</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">
            Successful hires
          </div>
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center mb-3">
            <CheckCircle2 size={20} className="text-green-600" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{completedThisMonth}</p>
          <p className="text-sm font-medium text-gray-700 mt-1">Completed This Month</p>
          <p className="text-xs text-gray-400 mt-0.5">{currentMonthLabel}</p>
        </div>
      </div>

      {/* Onboarding Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Active Onboardings</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-[#F8F7FF]">
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                New Hire
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Role & Department
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Start Date
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Onboarding Progress
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                  No onboarding records found.
                </td>
              </tr>
            ) : (
              records.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-sm">
                        {getInitials(record.employeeName)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{record.employeeName}</p>
                        <p className="text-xs text-gray-400">{record.employeeId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-gray-800">{record.role}</p>
                    <p className="text-xs text-gray-400">{record.department}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">
                    {record.startDate}
                  </td>
                  <td className="px-5 py-3 w-56">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-[#4F3CC9] transition-all"
                          style={{ width: `${record.progress}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 w-9 text-right">
                        {record.progress}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setSelectedRecord(record)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F3CC9] bg-[#EDE9FF] rounded-lg hover:bg-[#DDD6FE] transition-colors"
                    >
                      <ClipboardList size={13} />
                      Checklist
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedRecord && (
        <ChecklistModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onSaved={(updated) => {
            handleRecordSaved(updated);
            setSelectedRecord(null);
          }}
        />
      )}

      {showStartModal && (
        <StartOnboardingModal
          onClose={() => setShowStartModal(false)}
          onCreated={loadRecords}
        />
      )}
    </div>
  );
}
