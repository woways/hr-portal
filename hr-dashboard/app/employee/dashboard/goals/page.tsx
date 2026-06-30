"use client";
import { useState, useEffect } from "react";
import { Target, CheckCircle, Clock, AlertCircle, X, ChevronRight, Check, MessageSquare, Loader2 } from "lucide-react";
import { collection, query, where, onSnapshot, updateDoc, addDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEmployeeProfile } from "@/lib/useEmployeeProfile";

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

const statusColor: Record<GoalStatus, string> = {
  "Not Started": "bg-gray-100 text-gray-600",
  "In Progress":  "bg-blue-100 text-blue-700",
  Completed:      "bg-green-100 text-green-700",
};
const progressColor: Record<GoalStatus, string> = {
  "Not Started": "bg-gray-300",
  "In Progress":  "bg-[#4F3CC9]",
  Completed:      "bg-green-500",
};
const statusIcon: Record<GoalStatus, React.ReactNode> = {
  "Not Started": <AlertCircle size={14} className="text-gray-400" />,
  "In Progress":  <Clock size={14} className="text-blue-500" />,
  Completed:      <CheckCircle size={14} className="text-green-500" />,
};

export default function EmployeeGoalsPage() {
  const { empId, empName, loading: profileLoading } = useEmployeeProfile();

  const [goals,       setGoals]       = useState<Goal[]>([]);
  const [liveReady,   setLiveReady]   = useState(false);
  const [toast,       setToast]       = useState<string | null>(null);
  const [selected,    setSelected]    = useState<Goal | null>(null);
  const [newProgress, setNewProgress] = useState(0);
  const [selfNote,    setSelfNote]    = useState("");
  const [saving,      setSaving]      = useState(false);

  function showMsg(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  // Real-time listener — reads directly from Firestore so auth is the logged-in employee
  useEffect(() => {
    if (!empId) return;

    const q = query(collection(db, "goals"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      const docs: Goal[] = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return {
          id:          d.id,
          name:        String(r.name        ?? r.goalName ?? ""),
          assignedTo:  String(r.assignedTo  ?? empName),
          empId:       String(r.empId       ?? empId),
          department:  String(r.department  ?? ""),
          kpi:         String(r.kpi         ?? ""),
          deadline:    String(r.deadline    ?? ""),
          progress:    Number(r.progress    ?? 0),
          status:      (r.status ?? "Not Started") as GoalStatus,
          description: String(r.description ?? ""),
          notes:       String(r.notes       ?? ""),
          feedback:    String(r.feedback    ?? ""),
          assignedOn:  String(r.assignedOn  ?? r.createdAt ?? ""),
          lastUpdated: String(r.lastUpdated ?? r.updatedAt ?? ""),
        };
      });
      setGoals(docs.sort((a, b) => b.assignedOn.localeCompare(a.assignedOn)));
      // Keep selected goal in sync if panel is open
      setSelected(prev => prev ? (docs.find(g => g.id === prev.id) ?? prev) : null);
      setLiveReady(true);
    }, () => setLiveReady(true));

    return () => unsub();
  }, [empId, empName]);

  function openGoal(g: Goal) {
    setSelected(g);
    setNewProgress(g.progress);
    setSelfNote("");
  }

  async function handleUpdateProgress() {
    if (!selected || !empId) return;
    setSaving(true);
    const newStatus: GoalStatus =
      newProgress === 100 ? "Completed" : newProgress > 0 ? "In Progress" : "Not Started";
    const note = selfNote.trim()
      ? `\nEmployee updated to ${newProgress}% on ${new Date().toLocaleDateString("en-IN")}: ${selfNote.trim()}`
      : "";
    const newNotes = selected.notes + note;

    try {
      await updateDoc(doc(db, "goals", selected.id), {
        progress:    newProgress,
        status:      newStatus,
        notes:       newNotes,
        lastUpdated: new Date().toISOString(),
      });
      // Notify HR
      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        type:      "goal",
        title:     `Goal Update — ${selected.name}`,
        message:   `${empName} updated progress to ${newProgress}% (${newStatus})${selfNote.trim() ? `: "${selfNote.trim()}"` : ""}`,
        read:      false,
        createdAt: new Date().toISOString(),
        refId:     selected.id,
        empId,
        empName,
      });
      showMsg("Progress updated — HR has been notified");
      setSelfNote("");
    } catch {
      showMsg("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const notStarted = goals.filter(g => g.status === "Not Started").length;
  const inProgress  = goals.filter(g => g.status === "In Progress").length;
  const completed   = goals.filter(g => g.status === "Completed").length;

  const isLoading = profileLoading || (!!empId && !liveReady);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-3 rounded-2xl shadow-lg text-sm font-medium">
          <Check size={15} /> {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Goals</h1>
          <p className="text-gray-500 text-sm mt-1">Goals assigned to you by HR — update your progress below.</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Live sync
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Not Started", value: notStarted, bg: "bg-gray-50",   border: "border-gray-100",  text: "text-gray-700"  },
          { label: "In Progress",  value: inProgress,  bg: "bg-blue-50",  border: "border-blue-100",  text: "text-blue-700"  },
          { label: "Completed",   value: completed,   bg: "bg-green-50", border: "border-green-100", text: "text-green-700" },
        ].map(c => (
          <div key={c.label} className={`${c.bg} border ${c.border} rounded-2xl p-5 flex items-center gap-4`}>
            <Target size={22} className={c.text} />
            <div>
              <p className={`text-2xl font-bold ${c.text}`}>{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Goals List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
          </div>
        ) : goals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <Target size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">No goals assigned yet</p>
            <p className="text-xs text-gray-400 mt-1">HR will assign goals to you — check back soon.</p>
          </div>
        ) : (
          goals.map(g => (
            <div key={g.id} onClick={() => openGoal(g)}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:border-[#4F3CC9]/30 hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon[g.status]}
                    <h3 className="font-semibold text-gray-900 text-sm truncate">{g.name}</h3>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">{g.kpi} · Deadline: {g.deadline}</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${progressColor[g.status]}`} style={{ width: `${g.progress}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-8">{g.progress}%</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[g.status]}`}>{g.status}</span>
                  {g.feedback && (
                    <span className="flex items-center gap-1 text-xs text-purple-500"><MessageSquare size={11} /> Feedback</span>
                  )}
                  <ChevronRight size={14} className="text-gray-300" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Goal Detail Side Panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-[480px] h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-base font-bold text-gray-900">{selected.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Assigned on {selected.assignedOn}</p>
              </div>
              <button onClick={() => setSelected(null)}><X size={20} className="text-gray-400" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "KPI / Metric",  value: selected.kpi         },
                  { label: "Deadline",       value: selected.deadline     },
                  { label: "Department",     value: selected.department   },
                  { label: "Status",         value: null                  },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                    {value !== null
                      ? <p className="font-medium text-gray-800">{value || "—"}</p>
                      : <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[selected.status]}`}>{selected.status}</span>
                    }
                  </div>
                ))}
              </div>

              {selected.description && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{selected.description}</p>
                </div>
              )}

              {selected.feedback && (
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-purple-700 uppercase mb-1 flex items-center gap-1">
                    <MessageSquare size={12} /> Manager Feedback
                  </p>
                  <p className="text-sm text-purple-900">{selected.feedback}</p>
                </div>
              )}

              <div className="bg-[#EDE9FF] rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-[#4F3CC9] uppercase">Update Your Progress</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={0} max={100} value={newProgress}
                    onChange={e => setNewProgress(Number(e.target.value))}
                    className="flex-1 accent-[#4F3CC9]"
                  />
                  <span className="text-lg font-bold text-[#4F3CC9] w-12 text-right">{newProgress}%</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2">
                  <div className="h-2 rounded-full bg-[#4F3CC9] transition-all" style={{ width: `${newProgress}%` }} />
                </div>
                <textarea
                  rows={2}
                  value={selfNote}
                  onChange={e => setSelfNote(e.target.value)}
                  placeholder="Optional: add a note about your progress..."
                  className="w-full bg-white border border-purple-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                />
                <button
                  onClick={handleUpdateProgress}
                  disabled={saving || newProgress === selected.progress}
                  className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-[#3d2fa3] transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Submit Progress Update"}
                </button>
                {newProgress === selected.progress && !saving && (
                  <p className="text-xs text-center text-gray-400">Move the slider to update progress</p>
                )}
              </div>

              {selected.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">History</p>
                  <div className="space-y-1.5 bg-gray-50 rounded-xl p-3">
                    {selected.notes.split("\n").filter(Boolean).map((n, i) => (
                      <p key={i} className="text-xs text-gray-500">• {n}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
