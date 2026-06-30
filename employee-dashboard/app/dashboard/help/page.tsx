"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, where, getDocs, getDoc, doc,
  addDoc, onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  MessageSquare, Phone, AlertTriangle, X,
  CheckCircle, Clock, ChevronRight, Loader2, Wifi,
} from "lucide-react";

type QueryStatus = "Open" | "In Progress" | "Resolved";
type QueryType   = "query" | "report";

interface HelpQuery {
  id:          string;
  empId:       string;
  empName:     string;
  subject:     string;
  queryCategory: string;
  description: string;
  type:        QueryType;
  status:      QueryStatus;
  raisedOn:    string;
  hrResponse:  string;
  createdAt:   string;
}

interface CompanySettings {
  hrEmail: string;
  hrPhone: string;
  officeHours: string;
  address: string;
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ status }: { status: QueryStatus }) {
  if (status === "Resolved")    return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle size={11}/> Resolved</span>;
  if (status === "In Progress") return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"><Clock size={11}/> In Progress</span>;
  return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium"><ChevronRight size={11}/> Open</span>;
}

export default function HelpPage() {
  const [empId,      setEmpId]      = useState("");
  const [empName,    setEmpName]    = useState("");
  const [resolving,  setResolving]  = useState(true);
  const [liveReady,  setLiveReady]  = useState(false);
  const [queries,    setQueries]    = useState<HelpQuery[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);
  const [company,    setCompany]    = useState<CompanySettings | null>(null);

  type ModalType = "query" | "contact" | "report" | null;
  const [openModal,  setOpenModal]  = useState<ModalType>(null);
  const [queryForm,  setQueryForm]  = useState({ subject: "", category: "General", description: "" });
  const [reportForm, setReportForm] = useState({ subject: "", description: "" });

  // Resolve employee identity + load company settings
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setResolving(false); return; }
      let id = "", name = "";
      try {
        if (user.email) {
          const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!snap.empty) {
            const d = snap.docs[0].data() as Record<string, unknown>;
            id = snap.docs[0].id; name = String(d.name ?? "");
          }
        }
        if (!id) {
          const uSnap = await getDoc(doc(db, "users", user.uid));
          if (uSnap.exists()) {
            const ud = uSnap.data() as Record<string, unknown>;
            id = String(ud.employeeId ?? ""); name = String(ud.name ?? ud.displayName ?? "");
          }
        }
        if (!name) name = user.displayName ?? user.email?.split("@")[0] ?? "Employee";
        if (!id)   id   = user.uid;
      } catch { /* fallback */ }
      setEmpId(id); setEmpName(name); setResolving(false);

      // Load company contact info from settings
      try {
        const cSnap = await getDoc(doc(db, "settings", "company"));
        if (cSnap.exists()) {
          const c = cSnap.data() as Record<string, unknown>;
          setCompany({
            hrEmail:     String(c.email     ?? c.hrEmail     ?? ""),
            hrPhone:     String(c.phone     ?? c.hrPhone     ?? ""),
            officeHours: String(c.workHours ?? c.officeHours ?? ""),
            address:     String(c.address   ?? ""),
          });
        }
      } catch { /* settings not set yet */ }
    });
    return () => unsub();
  }, []);

  // Real-time listener for this employee's queries
  useEffect(() => {
    if (!empId) return;
    const q = query(collection(db, "helpQueries"), where("empId", "==", empId));
    const unsub = onSnapshot(q, (snap) => {
      const docs: HelpQuery[] = snap.docs
        .map(d => {
          const r = d.data() as Record<string, unknown>;
          return {
            id:            d.id,
            empId:         String(r.empId         ?? empId),
            empName:       String(r.empName       ?? empName),
            subject:       String(r.subject       ?? r.title ?? ""),
            queryCategory: String(r.queryCategory ?? "General"),
            description:   String(r.description   ?? r.message ?? ""),
            type:          (r.type ?? "query")    as QueryType,
            status:        (r.status ?? "Open")   as QueryStatus,
            raisedOn:      String(r.raisedOn      ?? r.createdAt ?? ""),
            hrResponse:    String(r.hrResponse    ?? ""),
            createdAt:     String(r.createdAt     ?? ""),
          };
        });
      setQueries(docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLiveReady(true);
    }, () => setLiveReady(true));
    return () => unsub();
  }, [empId, empName]);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleQuerySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const docRef = await addDoc(collection(db, "helpQueries"), {
        empId, empName,
        subject:       queryForm.subject.trim(),
        queryCategory: queryForm.category,
        description:   queryForm.description.trim(),
        title:         queryForm.subject.trim(),
        message:       queryForm.description.trim(),
        type:          "query",
        status:        "Open",
        raisedOn:      localDate(),
        hrResponse:    "",
        createdAt:     now,
        updatedAt:     now,
      });
      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        type:      "system",
        title:     `New Query — ${empName}`,
        message:   `[${queryForm.category}] ${queryForm.subject.trim()}`,
        read:      false,
        createdAt: now,
        refId:     docRef.id,
      });
      setOpenModal(null);
      setQueryForm({ subject: "", category: "General", description: "" });
      showToast("Query submitted! HR will respond shortly.");
    } catch {
      showToast("Failed to submit. Please check your connection.", false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId || submitting) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const docRef = await addDoc(collection(db, "helpQueries"), {
        empId, empName,
        subject:       reportForm.subject.trim(),
        queryCategory: "Issue Report",
        description:   reportForm.description.trim(),
        title:         reportForm.subject.trim(),
        message:       reportForm.description.trim(),
        type:          "report",
        status:        "Open",
        raisedOn:      localDate(),
        hrResponse:    "",
        createdAt:     now,
        updatedAt:     now,
      });
      await addDoc(collection(db, "notifications"), {
        userId:    "HR_PORTAL",
        type:      "system",
        title:     `Issue Reported — ${empName}`,
        message:   reportForm.subject.trim(),
        read:      false,
        createdAt: now,
        refId:     docRef.id,
      });
      setOpenModal(null);
      setReportForm({ subject: "", description: "" });
      showToast("Issue reported! HR will review it shortly.");
    } catch {
      showToast("Failed to submit. Please check your connection.", false);
    } finally {
      setSubmitting(false);
    }
  }

  const openCount       = queries.filter(q => q.status === "Open").length;
  const inProgressCount = queries.filter(q => q.status === "In Progress").length;
  const resolvedCount   = queries.filter(q => q.status === "Resolved").length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Help & Support</h1>
          <p className="text-gray-500 text-sm mt-1">Raise queries, contact HR, or report issues.</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium"><Wifi size={12}/> Live sync</span>
      </div>

      {!resolving && (
        <div className="flex gap-3 flex-wrap">
          <span className="px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">{openCount} Open</span>
          <span className="px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">{inProgressCount} In Progress</span>
          <span className="px-3 py-1.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">{resolvedCount} Resolved</span>
        </div>
      )}

      {/* Action Cards */}
      <div className="grid grid-cols-3 gap-4">
        <button onClick={() => setOpenModal("query")}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left hover:shadow-md transition-all hover:border-[#4F3CC9] group">
          <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center mb-4 group-hover:bg-[#EDE9FF]"><MessageSquare size={22} className="text-[#4F3CC9]"/></div>
          <h3 className="font-bold text-gray-900">Raise HR Query</h3>
          <p className="text-sm text-gray-500 mt-1">Submit a question or concern to the HR team.</p>
        </button>
        <button onClick={() => setOpenModal("contact")}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left hover:shadow-md transition-all hover:border-blue-400 group">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-50"><Phone size={22} className="text-blue-600"/></div>
          <h3 className="font-bold text-gray-900">Contact HR</h3>
          <p className="text-sm text-gray-500 mt-1">Get direct contact details for the HR department.</p>
        </button>
        <button onClick={() => setOpenModal("report")}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-left hover:shadow-md transition-all hover:border-orange-400 group">
          <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center mb-4 group-hover:bg-orange-50"><AlertTriangle size={22} className="text-orange-500"/></div>
          <h3 className="font-bold text-gray-900">Report Issue</h3>
          <p className="text-sm text-gray-500 mt-1">Report a technical or workplace issue.</p>
        </button>
      </div>

      {/* My Queries Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">My Queries & Reports</h2>
          <button onClick={() => setOpenModal("query")} className="text-sm text-[#4F3CC9] font-medium hover:underline">+ New Query</button>
        </div>
        {resolving || !liveReady ? (
          <div className="flex items-center justify-center py-14"><Loader2 size={22} className="animate-spin text-[#4F3CC9]"/></div>
        ) : queries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <MessageSquare size={32} className="text-gray-200 mb-3"/>
            <p className="text-sm text-gray-500 font-medium">No queries yet</p>
            <p className="text-xs text-gray-400 mt-1">Click &ldquo;Raise HR Query&rdquo; to submit your first one</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#F5F3FF]">
                  {["Subject","Category","Type","Status","Raised On","HR Response"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-6 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {queries.map(q => (
                  <tr key={q.id} className="hover:bg-[#F5F3FF] transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-[200px] truncate" title={q.subject}>{q.subject}</td>
                    <td className="px-6 py-4"><span className="inline-block px-2.5 py-0.5 rounded-full bg-[#EDE9FF] text-[#4F3CC9] text-xs font-medium">{q.queryCategory}</span></td>
                    <td className="px-6 py-4"><span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${q.type === "report" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>{q.type === "report" ? "Issue" : "Query"}</span></td>
                    <td className="px-6 py-4 whitespace-nowrap"><StatusBadge status={q.status}/></td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">{fmtDate(q.raisedOn)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[220px]">
                      {q.hrResponse ? <span className="text-gray-700">{q.hrResponse}</span> : <span className="text-gray-300 italic text-xs">Awaiting HR response</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Raise HR Query Modal */}
      {openModal === "query" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpenModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Raise HR Query</h2>
              <button onClick={() => setOpenModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleQuerySubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
                <input type="text" required placeholder="Enter subject..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                  value={queryForm.subject} onChange={e => setQueryForm(f => ({ ...f, subject: e.target.value }))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
                <select className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9]"
                  value={queryForm.category} onChange={e => setQueryForm(f => ({ ...f, category: e.target.value }))}>
                  <option>Leave</option><option>Payroll</option><option>Attendance</option>
                  <option>Goals</option><option>General</option><option>IT / Technical</option><option>Policy</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea required rows={4} placeholder="Describe your query in detail..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={queryForm.description} onChange={e => setQueryForm(f => ({ ...f, description: e.target.value }))}/>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setOpenModal(null)} className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin"/> Submitting…</> : "Submit Query"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contact HR Modal */}
      {openModal === "contact" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpenModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Contact HR</h2>
              <button onClick={() => setOpenModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="px-6 py-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg">HR</div>
                <div><p className="text-base font-bold text-gray-900">HR Department</p><p className="text-sm text-gray-500">HR Manager</p></div>
              </div>
              {company ? (
                <div className="space-y-3">
                  {[
                    { label: "Email",        value: company.hrEmail     || "—" },
                    { label: "Phone",        value: company.hrPhone     || "—" },
                    { label: "Office Hours", value: company.officeHours || "—" },
                    { label: "Location",     value: company.address     || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center gap-4 p-3 bg-[#F5F3FF] rounded-xl">
                      <span className="text-xs text-gray-400 w-24 shrink-0">{label}</span>
                      <span className="text-sm font-medium text-gray-900">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">Contact details not configured yet. Please check with your HR admin.</p>
              )}
              <button onClick={() => setOpenModal(null)} className="mt-5 w-full border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Report Issue Modal */}
      {openModal === "report" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setOpenModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Report Issue</h2>
              <button onClick={() => setOpenModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleReportSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Issue Subject</label>
                <input type="text" required placeholder="Briefly describe the issue..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                  value={reportForm.subject} onChange={e => setReportForm(f => ({ ...f, subject: e.target.value }))}/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <textarea required rows={5} placeholder="Provide detailed information about the issue..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 resize-none"
                  value={reportForm.description} onChange={e => setReportForm(f => ({ ...f, description: e.target.value }))}/>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setOpenModal(null)} className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 bg-orange-500 text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-orange-600 disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <><Loader2 size={14} className="animate-spin"/> Submitting…</> : "Submit Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
