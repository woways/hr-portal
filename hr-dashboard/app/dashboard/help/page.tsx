"use client";
import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, query, onSnapshot, updateDoc, doc, addDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  MessageSquare, AlertTriangle, CheckCircle, Clock,
  ChevronRight, Wifi, Loader2, X, Send,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type QueryStatus = "Open" | "In Progress" | "Resolved";
type QueryType   = "query" | "report";

interface HelpQuery {
  id:          string;
  empId:       string;
  empName:     string;
  subject:     string;
  category:    string;
  description: string;
  type:        QueryType;
  status:      QueryStatus;
  raisedOn:    string;
  hrResponse:  string;
  updatedAt:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
}

function StatusBadge({ status }: { status: QueryStatus }) {
  if (status === "Resolved")    return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium"><CheckCircle size={11}/> Resolved</span>;
  if (status === "In Progress") return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"><Clock size={11}/> In Progress</span>;
  return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium"><ChevronRight size={11}/> Open</span>;
}

const TABS = ["All", "Open", "In Progress", "Resolved"] as const;
type Tab = typeof TABS[number];

// ── Component ─────────────────────────────────────────────────────────────────

export default function HRHelpPage() {
  const [ready,       setReady]       = useState(false);
  const [queries,     setQueries]     = useState<HelpQuery[]>([]);
  const [activeTab,   setActiveTab]   = useState<Tab>("All");
  const [responses,   setResponses]   = useState<Record<string, string>>({});
  const [statuses,    setStatuses]    = useState<Record<string, QueryStatus>>({});
  const [submitting,  setSubmitting]  = useState<Record<string, boolean>>({});
  const [viewQuery,   setViewQuery]   = useState<HelpQuery | null>(null);
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Real-time listener — ALL help queries ─────────────────────────────────
  useEffect(() => {
    const authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setReady(true); return; }

      const q = query(collection(db, "helpQueries"));
      const snapUnsub = onSnapshot(q, (snap) => {
        const docs: HelpQuery[] = snap.docs.map(d => {
          const r = d.data() as Record<string, unknown>;
          return {
            id:          d.id,
            empId:       String(r.empId         ?? ""),
            empName:     String(r.empName       ?? "Unknown"),
            subject:     String(r.subject       ?? r.title ?? ""),
            category:    String(r.queryCategory ?? r.category ?? ""),
            description: String(r.description   ?? r.message ?? ""),
            type:        (r.type ?? "query")    as QueryType,
            status:      (r.status ?? "Open")   as QueryStatus,
            raisedOn:    String(r.raisedOn      ?? r.createdAt ?? ""),
            hrResponse:  String(r.hrResponse    ?? ""),
            updatedAt:   String(r.updatedAt     ?? r.createdAt ?? ""),
          };
        });
        setQueries(docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setReady(true);
      }, () => setReady(true));

      return snapUnsub;
    });
    return () => authUnsub();
  }, []);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Submit HR response ────────────────────────────────────────────────────
  async function respondToQuery(q: HelpQuery) {
    const response = (responses[q.id] ?? "").trim();
    const newStatus: QueryStatus = statuses[q.id] ?? (response ? "Resolved" : "Open");
    if (!response && newStatus === q.status) return;

    setSubmitting(s => ({ ...s, [q.id]: true }));
    try {
      // Update the help query document
      await updateDoc(doc(db, "helpQueries", q.id), {
        hrResponse: response || q.hrResponse,
        status:     newStatus,
        updatedAt:  new Date().toISOString(),
      });
      // Notify the employee about the HR response
      await addDoc(collection(db, "notifications"), {
        userId:    q.empId,
        type:      "system",
        title:     `HR Response — ${q.subject}`,
        message:   response || `Your query status has been updated to: ${newStatus}`,
        read:      false,
        createdAt: new Date().toISOString(),
        refId:     q.id,
      });
      // Clear local inputs for this query
      setResponses(r => { const n = { ...r }; delete n[q.id]; return n; });
      setStatuses(s => { const n = { ...s }; delete n[q.id]; return n; });
      if (viewQuery?.id === q.id) setViewQuery(null);
      showToast(`Response sent to ${q.empName}.`);
    } catch {
      showToast("Failed to send response. Check your connection.", false);
    } finally {
      setSubmitting(s => ({ ...s, [q.id]: false }));
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = queries.filter(q => {
    if (activeTab === "All") return true;
    return q.status === activeTab;
  });

  const openCount       = queries.filter(q => q.status === "Open").length;
  const inProgressCount = queries.filter(q => q.status === "In Progress").length;
  const resolvedCount   = queries.filter(q => q.status === "Resolved").length;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg flex items-center gap-2 ${toast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {toast.ok ? <CheckCircle size={15}/> : <X size={15}/>}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Help & Support</h1>
          <p className="text-gray-500 text-sm mt-1">Review and respond to employee queries and issue reports</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <Wifi size={12}/> Live sync
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Queries",  value: queries.length, color: "bg-purple-50 border-purple-100 text-purple-700" },
          { label: "Open",           value: openCount,       color: "bg-yellow-50 border-yellow-100 text-yellow-700" },
          { label: "In Progress",    value: inProgressCount, color: "bg-blue-50 border-blue-100 text-blue-700"       },
          { label: "Resolved",       value: resolvedCount,   color: "bg-green-50 border-green-100 text-green-700"    },
        ].map(c => (
          <div key={c.label} className={`rounded-2xl p-5 border ${c.color}`}>
            <p className="text-2xl font-bold">{c.value}</p>
            <p className="text-sm mt-1 opacity-80">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-sm font-medium transition-all relative whitespace-nowrap ${activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"}`}>
            {tab}
            {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full"/>}
          </button>
        ))}
      </div>

      {/* Queries Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {!ready ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-[#4F3CC9]"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <MessageSquare size={36} className="mb-3 text-gray-200"/>
            <p className="text-sm font-medium text-gray-500">No queries in this category</p>
            <p className="text-xs mt-1 text-gray-400">Employee queries will appear here in real time</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5F3FF]">
                  {["Employee","Subject","Category","Type","Status","Raised On","Response / Action"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 px-5 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(q => (
                  <tr key={q.id} className={`hover:bg-[#F5F3FF]/50 transition-colors ${q.status === "Open" && !q.hrResponse ? "bg-yellow-50/30" : ""}`}>
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{q.empName}</p>
                        <p className="text-xs text-gray-400">{q.empId}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 max-w-[180px]">
                      <button onClick={() => setViewQuery(q)} className="text-sm font-medium text-[#4F3CC9] hover:underline text-left truncate block max-w-[180px]" title={q.subject}>
                        {q.subject}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#EDE9FF] text-[#4F3CC9] text-xs font-medium whitespace-nowrap">{q.category}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${q.type === "report" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                        {q.type === "report" ? <span className="flex items-center gap-1"><AlertTriangle size={10}/> Issue</span> : <span className="flex items-center gap-1"><MessageSquare size={10}/> Query</span>}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {q.status === "Open" ? (
                        <select
                          value={statuses[q.id] ?? q.status}
                          onChange={e => setStatuses(s => ({ ...s, [q.id]: e.target.value as QueryStatus }))}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-[#4F3CC9]">
                          <option value="Open">Open</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Resolved">Resolved</option>
                        </select>
                      ) : (
                        <StatusBadge status={q.status}/>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(q.raisedOn)}</td>
                    <td className="px-5 py-4 min-w-[260px]">
                      {q.status === "Resolved" ? (
                        <span className="text-xs text-gray-600">{q.hrResponse || "—"}</span>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <input
                            placeholder={q.hrResponse ? "Update response…" : "Type your response…"}
                            value={responses[q.id] ?? ""}
                            onChange={e => setResponses(r => ({ ...r, [q.id]: e.target.value }))}
                            className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#4F3CC9] min-w-[140px]"
                            onKeyDown={e => { if (e.key === "Enter") respondToQuery(q); }}
                          />
                          <button
                            onClick={() => respondToQuery(q)}
                            disabled={submitting[q.id]}
                            title="Send response"
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#4F3CC9] text-white text-xs font-medium rounded-lg hover:bg-[#3d2fa3] disabled:opacity-60 shrink-0">
                            {submitting[q.id] ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>}
                            Send
                          </button>
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

      {/* View Query Detail Modal */}
      {viewQuery && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setViewQuery(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                {viewQuery.type === "report"
                  ? <AlertTriangle size={18} className="text-orange-500"/>
                  : <MessageSquare size={18} className="text-[#4F3CC9]"/>}
                <h2 className="text-base font-bold text-gray-900">{viewQuery.subject}</h2>
              </div>
              <button onClick={() => setViewQuery(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Employee", value: viewQuery.empName   },
                  { label: "Emp ID",   value: viewQuery.empId     },
                  { label: "Category", value: viewQuery.category  },
                  { label: "Raised",   value: fmtDate(viewQuery.raisedOn) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                    <p className="text-sm font-medium text-gray-800">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Description</p>
                <div className="bg-[#F5F3FF] rounded-xl px-4 py-3 text-sm text-gray-700 leading-relaxed">
                  {viewQuery.description || "No description provided."}
                </div>
              </div>
              {viewQuery.hrResponse && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Previous HR Response</p>
                  <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-gray-700">
                    {viewQuery.hrResponse}
                  </div>
                </div>
              )}
              {viewQuery.status !== "Resolved" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-600">Your Response</p>
                    <select
                      value={statuses[viewQuery.id] ?? viewQuery.status}
                      onChange={e => setStatuses(s => ({ ...s, [viewQuery.id]: e.target.value as QueryStatus }))}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-[#4F3CC9]">
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Resolved">Resolved</option>
                    </select>
                  </div>
                  <textarea rows={3} placeholder="Type your response..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none"
                    value={responses[viewQuery.id] ?? ""}
                    onChange={e => setResponses(r => ({ ...r, [viewQuery.id]: e.target.value }))} />
                  <button
                    onClick={() => respondToQuery(viewQuery)}
                    disabled={submitting[viewQuery.id]}
                    className="w-full bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2">
                    {submitting[viewQuery.id] ? <><Loader2 size={14} className="animate-spin"/> Sending…</> : <><Send size={14}/> Send Response</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
