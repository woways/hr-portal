"use client";
import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, where, getDocs, getDoc,
  doc, setDoc, addDoc, updateDoc, onSnapshot,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { markEmpNotifRead } from "@/lib/firebaseService";
import {
  Plus, X, CheckCircle, Clock, XCircle, CalendarX,
  MessageSquare, Loader2, Wifi, FileText, Pencil,
} from "lucide-react";

const MEDICAL_LEAVE_TYPES = ["Sick Leave", "Emergency Leave", "Maternity Leave", "Paternity Leave"];

interface LeaveRequest {
  id:             string;
  empId:          string;
  empName:        string;
  leaveType:      string;
  startDate:      string;
  endDate:        string;
  days:           number;
  reason:         string;
  status:         "Pending" | "Approved" | "Rejected";
  appliedOn:      string;
  hrComment?:     string;
  proofUrl?:      string;
  proofFileName?: string;
  proofUrls?:     string[];
  proofFileNames?: string[];
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function calcDays(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Approved") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium whitespace-nowrap">
      <CheckCircle size={11} /> Approved
    </span>
  );
  if (status === "Rejected") return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium whitespace-nowrap">
      <XCircle size={11} /> Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium whitespace-nowrap">
      <Clock size={11} /> Pending
    </span>
  );
}

const LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Casual Leave", "Emergency Leave", "Maternity Leave", "Paternity Leave", "Unpaid Leave"];

export default function LeavePage() {
  const today = localDate();

  const [empId,     setEmpId]     = useState("");
  const [empName,   setEmpName]   = useState("");
  const [resolving, setResolving] = useState(true);

  const [requests,  setRequests]  = useState<LeaveRequest[]>([]);
  const [liveReady, setLiveReady] = useState(false);

  const [showModal,  setShowModal]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveForm,  setLeaveForm]  = useState({ leaveType: "Annual Leave", startDate: "", endDate: "", reason: "" });

  // File upload (new request) — multiple files
  const [proofFiles,     setProofFiles]     = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const proofInputRef = useRef<HTMLInputElement>(null);

  // Edit modal state
  const [editingReq,         setEditingReq]        = useState<LeaveRequest | null>(null);
  const [editForm,           setEditForm]           = useState({ leaveType: "Annual Leave", startDate: "", endDate: "", reason: "" });
  const [existingProofUrls,  setExistingProofUrls]  = useState<string[]>([]);
  const [existingProofNames, setExistingProofNames] = useState<string[]>([]);
  const [editProofFiles,     setEditProofFiles]     = useState<File[]>([]);
  const [editUploadProgress, setEditUploadProgress] = useState(0);
  const editProofInputRef = useRef<HTMLInputElement>(null);

  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, ok = true) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setResolving(false); return; }

      let id = "", name = "";

      try {
        // Primary: users/{uid}.employeeId — set explicitly by HR during account creation
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data() as Record<string, unknown>;
          id   = String(ud.employeeId ?? "");
          name = String(ud.name ?? ud.displayName ?? "");
          if (id && !name) {
            const eSnap = await getDoc(doc(db, "employees", id));
            if (eSnap.exists()) name = String((eSnap.data() as Record<string, unknown>).name ?? "");
          }
        }

        // Fallback: email lookup in employees collection (only if users doc has no employeeId)
        if (!id && user.email) {
          const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!snap.empty) {
            const d = snap.docs[0].data() as Record<string, unknown>;
            id   = snap.docs[0].id;
            name = name || String(d.name ?? "");
          }
        }

        if (!name) name = user.displayName ?? user.email?.split("@")[0] ?? "Employee";
      } catch { /* use whatever we have */ }

      setEmpId(id);
      setEmpName(name);
      setResolving(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => { if (empId) markEmpNotifRead("leave", empId); }, [empId]);

  useEffect(() => {
    if (!empId) return;

    const q = query(collection(db, "leaveRequests"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => {
        const r = d.data() as Record<string, unknown>;
        return {
          id:             d.id,
          empId:          String(r.empId ?? empId),
          empName:        String(r.empName ?? empName),
          leaveType:      String(r.leaveType ?? ""),
          startDate:      String(r.startDate ?? ""),
          endDate:        String(r.endDate ?? ""),
          days:           Number(r.days ?? 0),
          reason:         String(r.reason ?? ""),
          status:         (r.status ?? "Pending") as "Pending" | "Approved" | "Rejected",
          appliedOn:      String(r.appliedOn ?? ""),
          hrComment:      r.hrComment      ? String(r.hrComment)      : undefined,
          proofUrl:       r.proofUrl       ? String(r.proofUrl)       : undefined,
          proofFileName:  r.proofFileName  ? String(r.proofFileName)  : undefined,
          proofUrls:      Array.isArray(r.proofUrls)      ? r.proofUrls      as string[] : undefined,
          proofFileNames: Array.isArray(r.proofFileNames) ? r.proofFileNames as string[] : undefined,
        } as LeaveRequest;
      });
      // Extra guard: only show requests that truly belong to this employee
      setRequests(docs.filter(d => d.empId === empId).sort((a, b) => b.appliedOn.localeCompare(a.appliedOn)));
      setLiveReady(true);
    }, () => {
      setLiveReady(true);
    });

    return () => unsub();
  }, [empId, empName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()) return;
    if (leaveForm.endDate < leaveForm.startDate) {
      showToast("End date must be on or after start date.", false);
      return;
    }
    if (!empId) {
      showToast("Employee profile not loaded yet. Please wait.", false);
      return;
    }

    setSubmitting(true);
    const leaveId = `LR-${empId}-${Date.now()}`;
    const days    = calcDays(leaveForm.startDate, leaveForm.endDate);

    try {
      const proofUrls: string[]      = [];
      const proofFileNames: string[] = [];

      for (let i = 0; i < proofFiles.length; i++) {
        const f           = proofFiles[i];
        const ext         = f.name.split(".").pop() ?? "file";
        const storagePath = `leaveProofs/${empId}/${leaveId}_${i}.${ext}`;
        const storageRef  = ref(storage, storagePath);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef, f);
          task.on("state_changed",
            (snap) => setUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            async () => { proofUrls.push(await getDownloadURL(task.snapshot.ref)); resolve(); }
          );
        });
        proofFileNames.push(f.name);
        setUploadProgress(0);
      }

      const data = {
        id:        leaveId,
        empId,
        empName,
        leaveType:  leaveForm.leaveType,
        startDate:  leaveForm.startDate,
        endDate:    leaveForm.endDate,
        days,
        reason:     leaveForm.reason.trim(),
        status:     "Pending",
        appliedOn:  today,
        hrComment:  "",
        ...(proofUrls.length > 0 ? {
          proofUrl:      proofUrls[0],
          proofFileName: proofFileNames[0],
          proofUrls,
          proofFileNames,
        } : {}),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, "leaveRequests", leaveId), data);

      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        empId,
        type:      "leave",
        title:     `New Leave Request — ${empName}`,
        message:   `${empName} (${empId}) applied for ${leaveForm.leaveType} from ${leaveForm.startDate} to ${leaveForm.endDate}. Reason: "${leaveForm.reason.trim()}"${proofUrls.length > 0 ? ` [${proofUrls.length} document(s) attached]` : ""}`,
        read:      false,
        createdAt: new Date().toISOString(),
      });

      setShowModal(false);
      setLeaveForm({ leaveType: "Annual Leave", startDate: "", endDate: "", reason: "" });
      setProofFiles([]);
      showToast("Leave request submitted! HR will respond shortly.");
    } catch {
      showToast("Failed to submit. Please check your connection and try again.", false);
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
    const days = calcDays(editForm.startDate, editForm.endDate);

    try {
      const proofUrls      = [...existingProofUrls];
      const proofFileNames = [...existingProofNames];

      for (let i = 0; i < editProofFiles.length; i++) {
        const f           = editProofFiles[i];
        const ext         = f.name.split(".").pop() ?? "file";
        const storagePath = `leaveProofs/${empId}/${editingReq.id}_new_${i}.${ext}`;
        const storageRef  = ref(storage, storagePath);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef, f);
          task.on("state_changed",
            (snap) => setEditUploadProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            async () => { proofUrls.push(await getDownloadURL(task.snapshot.ref)); resolve(); }
          );
        });
        proofFileNames.push(f.name);
        setEditUploadProgress(0);
      }

      await updateDoc(doc(db, "leaveRequests", editingReq.id), {
        leaveType:      editForm.leaveType,
        startDate:      editForm.startDate,
        endDate:        editForm.endDate,
        days,
        reason:         editForm.reason.trim(),
        proofUrl:       proofUrls[0]      || "",
        proofFileName:  proofFileNames[0] || "",
        proofUrls,
        proofFileNames,
        updatedAt:      new Date().toISOString(),
      });

      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        empId,
        type:      "leave",
        title:     `Leave Request Updated — ${empName}`,
        message:   `${empName} (${empId}) updated their ${editForm.leaveType} request from ${editForm.startDate} to ${editForm.endDate}. Reason: "${editForm.reason.trim()}"`,
        read:      false,
        createdAt: new Date().toISOString(),
      });

      setEditingReq(null);
      setEditProofFiles([]);
      setExistingProofUrls([]);
      setExistingProofNames([]);
      showToast("Leave request updated! HR has been notified.");
    } catch {
      showToast("Failed to update. Please check your connection.", false);
    } finally {
      setSubmitting(false);
    }
  }

  const pending  = requests.filter(r => r.status === "Pending").length;
  const approved = requests.filter(r => r.status === "Approved").length;
  const rejected = requests.filter(r => r.status === "Rejected").length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg flex items-center gap-2 ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Leave</h1>
          <p className="text-gray-500 text-sm mt-1">Apply for leaves and track your requests.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={resolving || !empId}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Plus size={16} /> Apply Leave
        </button>
      </div>

      {/* Status chips */}
      <div className="flex gap-3 flex-wrap items-center">
        <span className="px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">{pending} Pending</span>
        <span className="px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">{approved} Approved</span>
        <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">{rejected} Rejected</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <Wifi size={12} /> Live sync
        </span>
      </div>

      {/* Leave Requests Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">My Leave Requests</h2>
          <span className="text-xs text-gray-400">{requests.length} total</span>
        </div>

        {(resolving || !liveReady) ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-[#4F3CC9]" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <CalendarX size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">No leave requests yet</p>
            <p className="text-xs mt-1">Click &ldquo;Apply Leave&rdquo; to submit your first request</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F5F3FF]">
                  {["Leave Type","From","To","Days","Reason","Documents","Status","Applied On","HR Comment","Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map((req) => {
                  const allUrls  = req.proofUrls      ?? (req.proofUrl      ? [req.proofUrl]      : []);
                  const allNames = req.proofFileNames ?? (req.proofFileName  ? [req.proofFileName] : []);
                  return (
                    <tr key={req.id} className={`hover:bg-[#F5F3FF] transition-colors ${req.status === "Approved" ? "bg-green-50/40" : req.status === "Rejected" ? "bg-red-50/30" : ""}`}>
                      <td className="px-5 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">{req.leaveType}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">{fmtDate(req.startDate)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700 whitespace-nowrap">{fmtDate(req.endDate)}</td>
                      <td className="px-5 py-4 text-sm text-gray-700">{req.days}</td>
                      <td className="px-5 py-4 text-sm text-gray-500 max-w-[180px] truncate" title={req.reason}>{req.reason}</td>
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
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-5 py-4"><StatusBadge status={req.status} /></td>
                      <td className="px-5 py-4 text-sm text-gray-500 whitespace-nowrap">{fmtDate(req.appliedOn)}</td>
                      <td className="px-5 py-4 text-sm text-gray-500 max-w-[160px]">
                        {req.hrComment
                          ? <span className="flex items-center gap-1 text-xs text-gray-700"><MessageSquare size={12} className="shrink-0 text-[#4F3CC9]" />{req.hrComment}</span>
                          : <span className="text-gray-300 text-xs">Awaiting HR response</span>
                        }
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setEditingReq(null); setEditProofFiles([]); setExistingProofUrls([]); setExistingProofNames([]); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Leave Request</h2>
                <p className="text-xs text-gray-400 mt-0.5">Only pending requests can be edited</p>
              </div>
              <button onClick={() => { setEditingReq(null); setEditProofFiles([]); setExistingProofUrls([]); setExistingProofNames([]); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={handleEditSubmit} className="px-6 py-5 space-y-4">
              {empName && (
                <div className="bg-[#F5F3FF] rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#4F3CC9] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {empName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <span className="text-sm font-medium text-gray-700">{empName}</span>
                  <span className="text-xs text-gray-400 ml-auto">{empId}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                  value={editForm.leaveType}
                  onChange={e => setEditForm({ ...editForm, leaveType: e.target.value })}
                >
                  {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input type="date" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                    value={editForm.startDate}
                    onChange={e => {
                      const v = e.target.value;
                      setEditForm(f => ({ ...f, startDate: v, endDate: f.endDate < v ? v : f.endDate }));
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input type="date" required min={editForm.startDate}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                    value={editForm.endDate}
                    onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>

              {editForm.startDate && editForm.endDate && (
                <p className="text-xs text-[#4F3CC9] font-medium bg-[#F5F3FF] px-3 py-1.5 rounded-lg">
                  Duration: {calcDays(editForm.startDate, editForm.endDate)} day(s)
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea required rows={3}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={editForm.reason}
                  onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              {/* Document upload — multi-file */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {MEDICAL_LEAVE_TYPES.includes(editForm.leaveType) ? "Medical Proof" : "Supporting Documents"}
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {MEDICAL_LEAVE_TYPES.includes(editForm.leaveType)
                    ? "Upload doctor's notes, hospital reports, or prescriptions."
                    : "Upload any supporting documents, approvals, or references (JPG, PNG, PDF)."}
                </p>

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
                        <FileText size={16} className="text-green-600 shrink-0" />
                        <span className="text-sm text-green-800 font-medium truncate flex-1">{f.name}</span>
                        <button type="button" onClick={() => setEditProofFiles(p => p.filter((_, idx) => idx !== i))}
                          className="text-green-600 hover:text-red-500 shrink-0"><X size={14} /></button>
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
                  <Plus size={15} />
                  {existingProofUrls.length + editProofFiles.length > 0 ? "Add More Documents" : "Attach Documents"}
                </button>

                {submitting && editProofFiles.length > 0 && editUploadProgress > 0 && editUploadProgress < 100 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F3CC9] transition-all" style={{ width: `${editUploadProgress}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Uploading… {editUploadProgress}%</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setEditingReq(null); setEditProofFiles([]); setExistingProofUrls([]); setExistingProofNames([]); }}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Apply for Leave</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {empName && (
                <div className="bg-[#F5F3FF] rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#4F3CC9] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {empName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <span className="text-sm font-medium text-gray-700">{empName}</span>
                  <span className="text-xs text-gray-400 ml-auto">{empId}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Leave Type</label>
                <select
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                  value={leaveForm.leaveType}
                  onChange={e => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                >
                  {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                  <input type="date" required min={today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.startDate}
                    onChange={e => {
                      const v = e.target.value;
                      setLeaveForm(f => ({ ...f, startDate: v, endDate: f.endDate < v ? v : f.endDate }));
                    }}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                  <input type="date" required min={leaveForm.startDate || today}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                    value={leaveForm.endDate}
                    onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>

              {leaveForm.startDate && leaveForm.endDate && (
                <p className="text-xs text-[#4F3CC9] font-medium bg-[#F5F3FF] px-3 py-1.5 rounded-lg">
                  Duration: {calcDays(leaveForm.startDate, leaveForm.endDate)} day(s)
                </p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <textarea required rows={3}
                  placeholder="Enter reason for leave..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={leaveForm.reason}
                  onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              {/* Supporting Document Upload — multi-file */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {MEDICAL_LEAVE_TYPES.includes(leaveForm.leaveType) ? "Medical Proof" : "Supporting Documents"}
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {MEDICAL_LEAVE_TYPES.includes(leaveForm.leaveType)
                    ? "Upload doctor's notes, hospital reports, or prescriptions."
                    : "Upload any supporting documents, approvals, or references (JPG, PNG, PDF)."}
                </p>

                {/* Selected files list */}
                {proofFiles.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {proofFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                        <FileText size={16} className="text-green-600 shrink-0" />
                        <span className="text-sm text-green-800 font-medium truncate flex-1">{f.name}</span>
                        <button type="button" onClick={() => setProofFiles(p => p.filter((_, idx) => idx !== i))}
                          className="text-green-600 hover:text-red-500 shrink-0"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}

                <input ref={proofInputRef} type="file" multiple
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
                  <Plus size={15} />
                  {proofFiles.length > 0 ? "Add More Documents" : "Attach Documents"}
                </button>

                {submitting && proofFiles.length > 0 && uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F3CC9] transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Uploading… {uploadProgress}%</p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
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
