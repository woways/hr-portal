"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, CheckCircle, Clock, XCircle, Calendar, MessageSquare, FileText, Loader2, Pencil } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, getDocs, addDoc, updateDoc, collection, query, where } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { markEmpNotifRead } from "@/lib/firebaseService";

const MEDICAL_LEAVE_TYPES = ["Sick Leave", "Emergency Leave"];

interface LeaveRequest {
  id: string;
  empId: string;
  empName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
  appliedOn: string;
  hrComment?: string;
  proofUrl?: string;
  proofFileName?: string;
  proofUrls?: string[];
  proofFileNames?: string[];
}

const LEAVE_TYPES = ["Casual Leave", "Sick Leave", "Emergency Leave", "Paid Leave"];

const LEAVE_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  "Casual Leave":    { color: "#4F3CC9", bg: "bg-purple-50", text: "text-[#4F3CC9]" },
  "Sick Leave":      { color: "#10B981", bg: "bg-green-50",  text: "text-green-600" },
  "Emergency Leave": { color: "#EF4444", bg: "bg-red-50",    text: "text-red-600"   },
  "Paid Leave":      { color: "#F59E0B", bg: "bg-yellow-50", text: "text-yellow-600" },
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function calcWorkdays(start: string, end: string): number {
  if (!start || !end) return 1;
  let count = 0;
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, count);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Approved") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
      <CheckCircle size={11} /> Approved
    </span>
  );
  if (status === "Rejected") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
      <XCircle size={11} /> Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
      <Clock size={11} /> Pending
    </span>
  );
}

export default function LeavesPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [empId, setEmpId]     = useState("");
  const [empName, setEmpName] = useState("");

  const [requests,   setRequests]   = useState<LeaveRequest[]>([]);
  const [showModal,  setShowModal]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const [leaveForm,  setLeaveForm]  = useState({ leaveType: "Casual Leave", startDate: "", endDate: "", reason: "" });

  // File upload (new request) — multiple files
  const [proofFiles,     setProofFiles]     = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const proofInputRef = useRef<HTMLInputElement>(null);

  // Edit modal state
  const [editingReq,         setEditingReq]        = useState<LeaveRequest | null>(null);
  const [editForm,           setEditForm]           = useState({ leaveType: "Casual Leave", startDate: "", endDate: "", reason: "" });
  const [existingProofUrls,  setExistingProofUrls]  = useState<string[]>([]);
  const [existingProofNames, setExistingProofNames] = useState<string[]>([]);
  const [editProofFiles,     setEditProofFiles]     = useState<File[]>([]);
  const [editUploadProgress, setEditUploadProgress] = useState(0);
  const editProofInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const loadRequests = useCallback(async (eid: string) => {
    if (!eid) return;
    try {
      const snap = await getDocs(query(collection(db, "leaveRequests"), where("empId", "==", eid)));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveRequest));
      setRequests(data.sort((a, b) => b.appliedOn.localeCompare(a.appliedOn)));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) return;
        const eid = String(userSnap.data().employeeId ?? "");
        if (!eid) return;
        const empDoc = await getDoc(doc(db, "employees", eid));
        const name = empDoc.exists() ? String(empDoc.data().name ?? "") : user.displayName ?? "";
        setEmpId(eid);
        setEmpName(name);
        await loadRequests(eid);
      } catch { /* ignore */ }
    });
    return unsub;
  }, [loadRequests]);

  useEffect(() => { if (empId) markEmpNotifRead("leave", empId); }, [empId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId) { showToast("Profile still loading, please wait.", false); return; }
    if (!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()) return;
    if (leaveForm.endDate < leaveForm.startDate) {
      showToast("End date must be on or after start date.", false);
      return;
    }
    setSubmitting(true);

    const days    = calcWorkdays(leaveForm.startDate, leaveForm.endDate);
    const leaveId = `LR-${empId}-${Date.now()}`;

    try {
      const proofUrls: string[]      = [];
      const proofFileNames: string[] = [];

      for (let i = 0; i < proofFiles.length; i++) {
        const f   = proofFiles[i];
        const ext = f.name.split(".").pop() ?? "file";
        const path = `leaveProofs/${empId}/${leaveId}_${i}.${ext}`;
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef(storage, path), f);
          task.on(
            "state_changed",
            (snap) => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            async () => { proofUrls.push(await getDownloadURL(task.snapshot.ref)); resolve(); },
          );
        });
        proofFileNames.push(f.name);
        setUploadProgress(0);
      }

      const payload = {
        empId,
        empName,
        leaveType: leaveForm.leaveType,
        startDate: leaveForm.startDate,
        endDate:   leaveForm.endDate,
        days,
        reason:    leaveForm.reason.trim(),
        status:    "Pending",
        appliedOn: today,
        ...(proofUrls.length > 0 ? {
          proofUrl:      proofUrls[0],
          proofFileName: proofFileNames[0],
          proofUrls,
          proofFileNames,
        } : {}),
        updatedAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, "leaveRequests"), payload);
      setRequests((prev) => [{ id: docRef.id, ...payload } as LeaveRequest, ...prev]);
      setShowModal(false);
      setLeaveForm({ leaveType: "Casual Leave", startDate: "", endDate: "", reason: "" });
      setProofFiles([]);
      showToast("Leave request submitted to HR!");
    } catch {
      showToast("Could not submit — check your connection.", false);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(req: LeaveRequest) {
    setEditingReq(req);
    setEditForm({ leaveType: req.leaveType, startDate: req.startDate, endDate: req.endDate, reason: req.reason });
    setEditProofFiles([]);
    const urls  = req.proofUrls      ?? (req.proofUrl      ? [req.proofUrl]      : []);
    const names = req.proofFileNames ?? (req.proofFileName  ? [req.proofFileName] : []);
    setExistingProofUrls(urls);
    setExistingProofNames(names);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingReq) return;
    if (editForm.endDate < editForm.startDate) {
      showToast("End date must be on or after start date.", false);
      return;
    }
    setSubmitting(true);
    const days = calcWorkdays(editForm.startDate, editForm.endDate);

    try {
      const proofUrls      = [...existingProofUrls];
      const proofFileNames = [...existingProofNames];

      for (let i = 0; i < editProofFiles.length; i++) {
        const f   = editProofFiles[i];
        const ext = f.name.split(".").pop() ?? "file";
        const path = `leaveProofs/${empId}/${editingReq.id}_new_${i}.${ext}`;
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef(storage, path), f);
          task.on(
            "state_changed",
            (snap) => setEditUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            async () => { proofUrls.push(await getDownloadURL(task.snapshot.ref)); resolve(); },
          );
        });
        proofFileNames.push(f.name);
        setEditUploadProgress(0);
      }

      await updateDoc(doc(db, "leaveRequests", editingReq.id), {
        leaveType:     editForm.leaveType,
        startDate:     editForm.startDate,
        endDate:       editForm.endDate,
        days,
        reason:        editForm.reason.trim(),
        proofUrl:      proofUrls[0]      || "",
        proofFileName: proofFileNames[0] || "",
        proofUrls,
        proofFileNames,
        updatedAt:     new Date().toISOString(),
      });

      setEditingReq(null);
      setEditProofFiles([]);
      setExistingProofUrls([]);
      setExistingProofNames([]);
      showToast("Leave request updated!");
      await loadRequests(empId);
    } catch {
      showToast("Could not update — check your connection.", false);
    } finally {
      setSubmitting(false);
    }
  }

  const leaveBalances = LEAVE_TYPES.map((type) => {
    const approved = requests.filter((r) => r.leaveType === type && r.status === "Approved");
    const used = approved.reduce((s, r) => s + (r.days ?? 0), 0);
    return { type, used };
  });

  const pending  = requests.filter((r) => r.status === "Pending").length;
  const approved = requests.filter((r) => r.status === "Approved").length;
  const rejected = requests.filter((r) => r.status === "Rejected").length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leaves</h1>
          <p className="text-gray-500 text-sm mt-1">Apply for leaves and track your requests.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={!empId}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors disabled:opacity-50"
        >
          <Plus size={16} /> Apply Leave
        </button>
      </div>

      {/* Status summary */}
      <div className="flex gap-3 flex-wrap">
        <span className="px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">{pending} Pending</span>
        <span className="px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">{approved} Approved</span>
        <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">{rejected} Rejected</span>
        <button onClick={() => loadRequests(empId)} className="ml-auto text-xs text-[#4F3CC9] hover:underline">Refresh</button>
      </div>

      {/* Leave Usage Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {leaveBalances.map(({ type, used }) => {
          const { color, bg, text } = LEAVE_COLORS[type] ?? { color: "#6B7280", bg: "bg-gray-50", text: "text-gray-600" };
          return (
            <div key={type} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
                  <Calendar size={15} style={{ color }} />
                </div>
                <span className="text-sm font-medium text-gray-700">{type}</span>
              </div>
              <p className={`text-2xl font-bold ${text}`}>{used}</p>
              <p className="text-xs text-gray-400 mt-1">days used</p>
            </div>
          );
        })}
      </div>

      {/* Leave History Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Leave History</h2>
          <span className="text-xs text-gray-400">{requests.length} total</span>
        </div>
        {requests.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">
            {empId ? "No leave requests yet." : "Loading…"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F5F3FF]">
                  {["Leave Type","Start Date","End Date","Days","Reason","Documents","Status","Applied On","HR Comment","Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map((req) => {
                  const allUrls  = req.proofUrls      ?? (req.proofUrl      ? [req.proofUrl]      : []);
                  const allNames = req.proofFileNames ?? (req.proofFileName  ? [req.proofFileName] : []);
                  return (
                    <tr key={req.id} className="hover:bg-[#F5F3FF] transition-colors">
                      <td className="px-5 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">{req.leaveType}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">{fmtDate(req.startDate)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">{fmtDate(req.endDate)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700">{req.days}</td>
                      <td className="px-5 py-4 text-sm text-gray-500 max-w-[150px] truncate">{req.reason}</td>
                      <td className="px-5 py-4">
                        {allUrls.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {allUrls.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[#4F3CC9] font-medium hover:underline">
                                <FileText size={12}/> {allNames[i] || `Doc ${i + 1}`}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4"><StatusBadge status={req.status} /></td>
                      <td className="px-5 py-4 text-sm text-gray-500 whitespace-nowrap">{fmtDate(req.appliedOn)}</td>
                      <td className="px-5 py-4 text-sm text-gray-500">
                        {req.hrComment
                          ? <span className="flex items-center gap-1 text-xs text-gray-600"><MessageSquare size={12} />{req.hrComment}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4">
                        {req.status === "Pending" && (
                          <button onClick={() => openEdit(req)}
                            className="inline-flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9] rounded-full px-3 py-1 hover:bg-[#EDE9FF] transition-colors whitespace-nowrap">
                            <Pencil size={11}/> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Leave Modal */}
      {editingReq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Leave Request</h2>
                <p className="text-xs text-gray-400 mt-0.5">Only pending requests can be edited</p>
              </div>
              <button onClick={() => { setEditingReq(null); setEditProofFiles([]); setExistingProofUrls([]); setExistingProofNames([]); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                  value={editForm.leaveType}
                  onChange={(e) => setEditForm({ ...editForm, leaveType: e.target.value })}
                >
                  {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input type="date" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={editForm.startDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditForm({ ...editForm, startDate: val, endDate: editForm.endDate < val ? val : editForm.endDate });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input type="date" required min={editForm.startDate}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={editForm.endDate}
                    onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea required rows={3}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                />
              </div>

              {/* Document upload section — multi-file */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {MEDICAL_LEAVE_TYPES.includes(editForm.leaveType) ? "Medical Proof" : "Supporting Documents"}
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>

                {/* Existing files */}
                {existingProofUrls.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {existingProofUrls.map((url, i) => (
                      <div key={i} className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
                        <FileText size={16} className="text-blue-600 shrink-0"/>
                        <a href={url} target="_blank" rel="noreferrer"
                          className="text-sm text-blue-700 font-medium truncate flex-1 hover:underline">
                          {existingProofNames[i] || `Document ${i + 1}`}
                        </a>
                        <button type="button"
                          onClick={() => {
                            setExistingProofUrls(p => p.filter((_, idx) => idx !== i));
                            setExistingProofNames(p => p.filter((_, idx) => idx !== i));
                          }}
                          className="text-blue-400 hover:text-red-500 shrink-0" title="Remove">
                          <X size={14}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Newly added files */}
                {editProofFiles.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {editProofFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                        <FileText size={16} className="text-green-600 shrink-0"/>
                        <span className="text-sm text-green-800 font-medium truncate flex-1">{f.name}</span>
                        <button type="button"
                          onClick={() => setEditProofFiles(p => p.filter((_, idx) => idx !== i))}
                          className="text-green-600 hover:text-red-500 shrink-0">
                          <X size={14}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input ref={editProofInputRef} type="file" multiple
                  accept="image/jpeg,image/png,image/jpg,application/pdf"
                  className="hidden"
                  onChange={e => {
                    const newFiles = Array.from(e.target.files ?? []);
                    if (newFiles.length > 0) setEditProofFiles(p => [...p, ...newFiles]);
                    if (editProofInputRef.current) editProofInputRef.current.value = "";
                  }}
                />
                <button type="button" onClick={() => editProofInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors flex items-center justify-center gap-2">
                  <Plus size={15}/>
                  {existingProofUrls.length + editProofFiles.length > 0 ? "Add More Documents" : "Attach Documents"}
                </button>

                {submitting && editProofFiles.length > 0 && editUploadProgress > 0 && editUploadProgress < 100 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F3CC9] transition-all" style={{ width: `${editUploadProgress}%` }}/>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Uploading… {editUploadProgress}%</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setEditingReq(null); setEditProofFiles([]); setExistingProofUrls([]); setExistingProofNames([]); }}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin"/> Saving…</> : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input type="date" required min={today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.startDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLeaveForm({ ...leaveForm, startDate: val, endDate: leaveForm.endDate < val ? val : leaveForm.endDate });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input type="date" required min={leaveForm.startDate || today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea required rows={3}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                />
              </div>

              {/* Supporting document upload — multi-file */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {MEDICAL_LEAVE_TYPES.includes(leaveForm.leaveType) ? "Medical Proof" : "Supporting Documents"}
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {MEDICAL_LEAVE_TYPES.includes(leaveForm.leaveType)
                    ? "Upload doctor's notes, prescriptions, or hospital reports."
                    : "Upload any supporting documents or references. Accepted: JPG, PNG, PDF."}
                </p>

                {/* Selected files list */}
                {proofFiles.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {proofFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                        <FileText size={16} className="text-green-600 shrink-0"/>
                        <span className="text-sm text-green-800 font-medium truncate flex-1">{f.name}</span>
                        <button type="button"
                          onClick={() => setProofFiles(p => p.filter((_, idx) => idx !== i))}
                          className="text-green-600 hover:text-red-500 shrink-0">
                          <X size={14}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={proofInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/jpg,application/pdf"
                  className="hidden"
                  onChange={e => {
                    const newFiles = Array.from(e.target.files ?? []);
                    if (newFiles.length > 0) setProofFiles(p => [...p, ...newFiles]);
                    if (proofInputRef.current) proofInputRef.current.value = "";
                  }}
                />
                <button type="button" onClick={() => proofInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors flex items-center justify-center gap-2">
                  <Plus size={15}/>
                  {proofFiles.length > 0 ? "Add More Documents" : "Attach Documents"}
                </button>

                {submitting && proofFiles.length > 0 && uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F3CC9] transition-all" style={{ width: `${uploadProgress}%` }}/>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Uploading… {uploadProgress}%</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setProofFiles([]); }}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin"/> Submitting…</> : "Submit Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
