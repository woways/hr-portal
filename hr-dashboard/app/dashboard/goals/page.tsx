"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Eye, Pencil, Trash2, X, Check } from "lucide-react";
import { upsertGoal, updateGoal, deleteGoal as fsDeleteGoal, getEmployees, markHRNotifRead } from "@/lib/firebaseService";
import { cachedEmployees, invalidateGoals } from "@/lib/cachedService";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEPARTMENTS } from "@/lib/constants";
import { useDepartments } from "@/lib/useDepartments";
import { EmptyState } from "@/components/EmptyState";

type GoalStatus = "Not Started" | "In Progress" | "Completed";

interface Goal {
  id: string;
  name: string;
  assignedTo: string;
  empId: string;
  department: string;
  kpi: string;
  deadline: string;
  progress: number;
  status: GoalStatus;
  description: string;
  notes: string;
  feedback: string;
  assignedOn: string;
  lastUpdated?: string;
}

interface EmpOption { id: string; name: string; department: string; }
interface Assignee  { empId: string; name: string; department: string; }

const depts = DEPARTMENTS;

const statusColor: Record<GoalStatus, string> = {
  "Not Started": "bg-gray-100 text-gray-600",
  "In Progress":  "bg-blue-100 text-blue-700",
  Completed:      "bg-green-100 text-green-700",
};
const progressColor: Record<GoalStatus, string> = {
  "Not Started": "bg-gray-400",
  "In Progress":  "bg-[#4F3CC9]",
  Completed:      "bg-green-500",
};

const blankAssignee = (): Assignee => ({ empId: "", name: "", department: "" });
const blankAdd = { name: "", assignees: [blankAssignee()], kpi: "", deadline: "", description: "" };
const blankEdit = { name: "", assignedTo: "", empId: "", department: depts[0], kpi: "", deadline: "", description: "", feedback: "" };
const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]";

export default function GoalsPage() {
  const departments = useDepartments();
  const [goals, setGoals]   = useState<Goal[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [toast, setToast]   = useState<string | null>(null);
  const [empList, setEmpList] = useState<EmpOption[]>([]);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ ...blankAdd, assignees: [blankAssignee()] });
  const [submitting, setSubmitting] = useState(false);
  const [empSearch, setEmpSearch]   = useState("");

  const [viewGoal, setViewGoal]   = useState<Goal | null>(null);
  const [detailProgress, setDetailProgress] = useState(0);
  const [detailNote, setDetailNote]         = useState("");
  const [detailFeedback, setDetailFeedback] = useState("");

  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editForm, setEditForm] = useState({ ...blankEdit });

  function showMsg(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  function parseGoalDoc(d: { data(): Record<string, unknown>; id: string }): Goal {
    const r = d.data();
    return {
      id: d.id,
      name: (r.name as string) ?? "",
      assignedTo: (r.assignedTo as string) ?? "",
      empId: (r.empId as string) ?? "",
      department: (r.department as string) ?? "",
      kpi: (r.kpi as string) ?? "",
      deadline: (r.deadline as string) ?? "",
      progress: Number(r.progress ?? 0),
      status: ((r.status as GoalStatus) ?? "Not Started"),
      description: (r.description as string) ?? "",
      notes: (r.notes as string) ?? "",
      feedback: (r.feedback as string) ?? "",
      assignedOn: (r.assignedOn as string) ?? "",
      lastUpdated: (r.lastUpdated as string) ?? undefined,
    };
  }

  const loadGoals = useCallback(async () => {
    // kept for explicit post-mutation refreshes; onSnapshot below handles real-time updates
  }, []);

  // Auto-mark all unread goal notifications as read when HR opens this page
  useEffect(() => { const t = setTimeout(() => markHRNotifRead("goal"), 10000); return () => clearTimeout(t); }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "goals"), (snap) => {
      setGoals(snap.docs.map(parseGoalDoc));
    }, () => {});
    return unsub;
  }, []);

  useEffect(() => {
    // Cache-first employee list — assignee picker renders instantly on repeat visits
    cachedEmployees((docs) => {
      const emps = docs.map((d) => { const r = d as Record<string, unknown>; return { id: (r.employeeId ?? r.id) as string, name: (r.name as string) ?? "", department: (r.department as string) ?? "" }; });
      setEmpList(emps);
    }).catch(() => {});
  }, []);

  // Deduplicate by id in case concurrent adds created duplicates in state
  const uniqueGoals = goals.filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i);
  const filtered = uniqueGoals.filter((g) => {
    const q = search.toLowerCase();
    const ms = g.name.toLowerCase().includes(q) || g.assignedTo.toLowerCase().includes(q) || g.empId.toLowerCase().includes(q);
    return ms && (statusFilter === "All" || g.status === statusFilter);
  });

  async function handleAdd() {
    const validAssignees = form.assignees.filter((a) => a.empId);
    if (!form.name.trim() || !form.deadline || validAssignees.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const base = Date.now();
      await Promise.all(
        validAssignees.map((a, i) =>
          upsertGoal(`goal-${base}-${i}-${a.empId}`, {
            name:        form.name,
            assignedTo:  a.name,
            empId:       a.empId,
            department:  a.department || depts[0],
            kpi:         form.kpi,
            deadline:    form.deadline,
            description: form.description,
            progress:    0,
            status:      "Not Started",
            notes:       "",
            feedback:    "",
            assignedOn:  new Date().toISOString().slice(0, 10),
          })
        )
      );
      invalidateGoals();
      await loadGoals();
      setForm({ ...blankAdd, assignees: [blankAssignee()] });
      setEmpSearch("");
      setShowAdd(false);
      showMsg(
        validAssignees.length === 1
          ? `Goal assigned to ${validAssignees[0].name}`
          : `Goal assigned to ${validAssignees.length} employees`
      );
    } catch {
      showMsg("Failed to save goal — check Firestore rules are deployed.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleEmpSelection(emp: EmpOption) {
    setForm((f) => {
      const isSelected = f.assignees.some((a) => a.empId === emp.id);
      if (isSelected) {
        const next = f.assignees.filter((a) => a.empId !== emp.id);
        return { ...f, assignees: next.length ? next : [blankAssignee()] };
      } else {
        const existing = f.assignees.filter((a) => a.empId);
        return { ...f, assignees: [...existing, { empId: emp.id, name: emp.name, department: emp.department }] };
      }
    });
  }

  function selectAllEmps(list: EmpOption[]) {
    setForm((f) => ({ ...f, assignees: list.map((e) => ({ empId: e.id, name: e.name, department: e.department })) }));
  }

  function openEdit(g: Goal) {
    setEditGoal(g);
    setEditForm({ name: g.name, assignedTo: g.assignedTo, empId: g.empId, department: g.department, kpi: g.kpi, deadline: g.deadline, description: g.description, feedback: g.feedback });
  }

  async function handleEditSave() {
    if (!editGoal) return;
    await updateGoal(editGoal.id, { ...editForm });
    setGoals((prev) => prev.map((g) => g.id === editGoal.id ? { ...g, ...editForm } : g));
    invalidateGoals();
    setEditGoal(null);
    showMsg("Goal updated");
  }

  function openDetail(g: Goal) {
    setViewGoal(g);
    setDetailProgress(g.progress);
    setDetailNote("");
    setDetailFeedback(g.feedback);
  }

  async function saveDetail() {
    if (!viewGoal) return;
    const newStatus: GoalStatus = detailProgress === 100 ? "Completed" : detailProgress > 0 ? "In Progress" : "Not Started";
    const newNotes = viewGoal.notes + (detailNote ? `\nHR updated to ${detailProgress}% on ${new Date().toLocaleDateString("en-IN")}` : "");
    await updateGoal(viewGoal.id, { progress: detailProgress, status: newStatus, notes: newNotes, feedback: detailFeedback });
    markHRNotifRead("goal", viewGoal.empId);
    setGoals((prev) => prev.map((g) => g.id === viewGoal.id ? { ...g, progress: detailProgress, status: newStatus, notes: newNotes, feedback: detailFeedback } : g));
    invalidateGoals();
    setViewGoal(null);
    showMsg("Goal progress saved");
  }

  async function deleteGoal(id: string) {
    try {
      await fsDeleteGoal(id);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      invalidateGoals();
      showMsg("Goal deleted");
    } catch {
      showMsg("Failed to delete goal. Please try again.");
    }
  }

  const notStarted = uniqueGoals.filter((g) => g.status === "Not Started").length;
  const inProgress  = uniqueGoals.filter((g) => g.status === "In Progress").length;
  const completed   = uniqueGoals.filter((g) => g.status === "Completed").length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-3 rounded-2xl shadow-lg text-sm font-medium">
          <Check size={15} /> {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Goals / KPIs</h1>
          <p className="text-gray-500 text-sm mt-1">Track employee goals and performance metrics</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa3]">
          <Plus size={16} /> Assign Goal
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Not Started", value: notStarted, color: "bg-gray-50 border border-gray-100",   text: "text-gray-700"  },
          { label: "In Progress",  value: inProgress,  color: "bg-blue-50 border border-blue-100",   text: "text-blue-700"  },
          { label: "Completed",   value: completed,   color: "bg-green-50 border border-green-100", text: "text-green-700" },
        ].map((c) => (
          <div key={c.label} className={`${c.color} rounded-2xl p-5`}>
            <p className={`text-3xl font-bold ${c.text}`}>{c.value}</p>
            <p className="text-sm text-gray-600 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input placeholder="Search goals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none w-48" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
          {["All","Not Started","In Progress","Completed"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-xs text-gray-400 self-center">Auto-refreshes every 8s</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                {["Goal Name","Emp ID","Assigned To","Department","KPI / Metric","Deadline","Progress","Status","Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-[#4F3CC9] font-semibold">{g.empId || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{g.assignedTo}</td>
                  <td className="px-4 py-3 text-gray-600">{g.department}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{g.kpi}</td>
                  <td className="px-4 py-3 text-gray-600">{g.deadline}</td>
                  <td className="px-4 py-3 w-36">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${progressColor[g.status]}`} style={{ width: `${g.progress}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8">{g.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[g.status]}`}>{g.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openDetail(g)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"><Eye size={14} /></button>
                      <button onClick={() => openEdit(g)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                      <button onClick={() => deleteGoal(g.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9}><EmptyState title="No goals found" subtitle="No goals match the current search or filter." /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign Goal Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setShowAdd(false); setEmpSearch(""); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b shrink-0">
              <div>
                <h2 className="text-lg font-bold">Assign Goal</h2>
                <p className="text-xs text-gray-400 mt-0.5">Assign the same goal to one or more employees</p>
              </div>
              <button onClick={() => { setShowAdd(false); setEmpSearch(""); }}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Goal Name */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Goal Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Launch Product v3.0" />
              </div>

              {/* Assignees — multi-select with checkboxes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                    Assign To *
                    {form.assignees.filter((a) => a.empId).length > 0 && (
                      <span className="bg-[#4F3CC9] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {form.assignees.filter((a) => a.empId).length} selected
                      </span>
                    )}
                  </label>
                  <div className="flex gap-3">
                    <button type="button"
                      onClick={() => {
                        const visible = empList.filter((e) =>
                          !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                          e.id.toLowerCase().includes(empSearch.toLowerCase()) ||
                          e.department.toLowerCase().includes(empSearch.toLowerCase())
                        );
                        selectAllEmps(visible);
                      }}
                      className="text-xs text-[#4F3CC9] font-medium hover:underline">
                      Select All
                    </button>
                    {form.assignees.some((a) => a.empId) && (
                      <button type="button"
                        onClick={() => setForm((f) => ({ ...f, assignees: [blankAssignee()] }))}
                        className="text-xs text-gray-400 hover:underline">
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Selected chips */}
                {form.assignees.filter((a) => a.empId).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.assignees.filter((a) => a.empId).map((a) => (
                      <span key={a.empId} className="flex items-center gap-1 bg-[#EDE9FF] text-[#4F3CC9] text-xs px-2 py-1 rounded-full font-medium">
                        {a.name}
                        <button
                          onClick={() => setForm((f) => {
                            const next = f.assignees.filter((x) => x.empId !== a.empId);
                            return { ...f, assignees: next.length ? next : [blankAssignee()] };
                          })}
                          className="hover:text-red-500 ml-0.5">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Search */}
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    placeholder="Search by name, ID or department…"
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                  />
                </div>

                {/* Scrollable checkbox list — only shown when user types */}
                <div className="border border-gray-200 rounded-xl max-h-44 overflow-y-auto">
                  {!empSearch.trim() ? (
                    <div className="px-4 py-6 text-center text-xs text-gray-400">
                      Type a name or employee ID to search
                    </div>
                  ) : (() => {
                    const results = empList.filter((e) =>
                      e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
                      e.id.toLowerCase().includes(empSearch.toLowerCase()) ||
                      e.department.toLowerCase().includes(empSearch.toLowerCase())
                    );
                    if (results.length === 0) return (
                      <div className="px-4 py-6 text-center text-xs text-gray-400">No employees found</div>
                    );
                    return results.map((emp) => {
                      const checked = form.assignees.some((a) => a.empId === emp.id);
                      return (
                        <label key={emp.id}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-50 last:border-0 transition-colors ${checked ? "bg-[#FDFCFF]" : "hover:bg-gray-50"}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEmpSelection(emp)}
                            className="accent-[#4F3CC9] w-4 h-4 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{emp.name}</p>
                            <p className="text-xs text-gray-400 truncate">{emp.id} · {emp.department}</p>
                          </div>
                          {checked && <Check size={13} className="text-[#4F3CC9] shrink-0" />}
                        </label>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${inputCls} h-20 resize-none`} placeholder="Describe the goal..." />
              </div>

              {/* KPI + Deadline */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">KPI / Success Metric</label>
                  <input value={form.kpi} onChange={(e) => setForm({ ...form, kpi: e.target.value })} className={inputCls} placeholder="e.g. Ship 3 features" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Deadline *</label>
                  <input type="date" value={form.deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>

            <div className="p-6 pt-0 shrink-0">
              <button
                onClick={handleAdd}
                disabled={!form.name.trim() || !form.deadline || form.assignees.every((a) => !a.empId) || submitting}
                className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold disabled:opacity-50 hover:bg-[#3d2fa3]"
              >
                {submitting
                  ? "Assigning…"
                  : form.assignees.filter((a) => a.empId).length > 1
                    ? `Assign to ${form.assignees.filter((a) => a.empId).length} Employees`
                    : "Assign Goal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editGoal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditGoal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div><h2 className="text-lg font-bold">Edit Goal</h2><p className="text-xs text-gray-400">{editGoal.id}</p></div>
              <button onClick={() => setEditGoal(null)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Goal Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Assigned Employee</label>
                  <select
                    value={empList.find((x) => x.name === editForm.assignedTo)?.id ?? ""}
                    onChange={(e) => {
                      const emp = empList.find((x) => x.id === e.target.value);
                      setEditForm({ ...editForm, assignedTo: emp?.name ?? editForm.assignedTo });
                    }}
                    className={inputCls}
                  >
                    <option value="">— Select Employee —</option>
                    {empList.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Department</label>
                  <select value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className={inputCls}>
                    {departments.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={`${inputCls} h-20 resize-none`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">KPI / Metric</label>
                  <input value={editForm.kpi} onChange={(e) => setEditForm({ ...editForm, kpi: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Deadline</label>
                  <input type="date" value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Manager Feedback</label>
                <textarea value={editForm.feedback} onChange={(e) => setEditForm({ ...editForm, feedback: e.target.value })} className={`${inputCls} h-16 resize-none`} placeholder="Feedback for the employee..." />
              </div>
              <button onClick={handleEditSave} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa3]">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Goal Detail Side Panel */}
      {viewGoal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-end" onClick={() => setViewGoal(null)}>
          <div className="bg-white w-[480px] h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-base font-bold">{viewGoal.name}</h2>
                <p className="text-xs text-gray-500">{viewGoal.assignedTo} · {viewGoal.department}</p>
              </div>
              <button onClick={() => setViewGoal(null)}><X size={20} /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-400 mb-0.5">KPI</p><p className="font-medium">{viewGoal.kpi}</p></div>
                <div><p className="text-xs text-gray-400 mb-0.5">Deadline</p><p className="font-medium">{viewGoal.deadline}</p></div>
                <div><p className="text-xs text-gray-400 mb-0.5">Assigned On</p><p className="font-medium">{viewGoal.assignedOn}</p></div>
                {viewGoal.lastUpdated && <div><p className="text-xs text-gray-400 mb-0.5">Last Updated</p><p className="font-medium">{viewGoal.lastUpdated}</p></div>}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</p>
                <p className="text-sm text-gray-700">{viewGoal.description}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Current Progress: <span className="text-[#4F3CC9]">{viewGoal.progress}%</span></p>
                <div className="bg-gray-100 rounded-full h-2 mb-3">
                  <div className={`h-2 rounded-full ${progressColor[viewGoal.status]}`} style={{ width: `${viewGoal.progress}%` }} />
                </div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Update Progress (HR Override)</p>
                <input type="range" min={0} max={100} value={detailProgress} onChange={(e) => setDetailProgress(Number(e.target.value))} className="w-full accent-[#4F3CC9]" />
                <p className="text-sm text-[#4F3CC9] font-semibold mt-1">{detailProgress}%</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Manager Feedback</p>
                <textarea value={detailFeedback} onChange={(e) => setDetailFeedback(e.target.value)} className="w-full border border-gray-200 rounded-xl p-3 text-sm h-20 resize-none focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" placeholder="Add feedback visible to the employee..." />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">HR Notes (internal)</p>
                <textarea value={detailNote} onChange={(e) => setDetailNote(e.target.value)} className="w-full border border-gray-200 rounded-xl p-3 text-sm h-16 resize-none focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" placeholder="Internal HR notes..." />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">History Log</p>
                <div className="space-y-1 text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
                  {viewGoal.notes ? viewGoal.notes.split("\n").filter(Boolean).map((n, i) => <p key={i}>• {n}</p>) : <p>No history yet.</p>}
                </div>
              </div>
              <button onClick={saveDetail} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa3]">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
