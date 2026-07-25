"use client";
import { useState, useEffect, useRef } from "react";
import { loadAllDocuments, DocRecord, uploadDocFile, saveDocMeta } from "@/lib/documentService";
import { getEmployees } from "@/lib/firebaseService";
import { cachedEmployees } from "@/lib/cachedService";
import { SkeletonTableRows } from "@/components/Skeleton";
import { ref as storageRef, getBlob } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  FileText, Download, Eye, Search, Filter,
  CheckCircle, Clock, User, Building2, X, Upload, Plus, Loader2, ChevronRight,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

const CATEGORIES    = ["All", "Identity", "Employment", "Education", "Finance", "Other"];
const UPLOADERS     = ["All", "employee", "hr"];
const DOC_CATEGORIES = ["Employment", "Identity", "Education", "Finance", "Other"];

interface EmpOption { id: string; empId: string; name: string; dept: string; designation: string; }

interface EmpGroup {
  empId:   string;
  empName: string;
  empDept: string;
  docs:    DocRecord[];
}

function formatBytes(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const CAT_COLORS: Record<string, string> = {
  Identity:   "bg-blue-100 text-blue-700",
  Employment: "bg-purple-100 text-purple-700",
  Education:  "bg-green-100 text-green-700",
  Finance:    "bg-yellow-100 text-yellow-700",
  Other:      "bg-gray-100 text-gray-600",
};

async function downloadDoc(doc: DocRecord) {
  const fileName = doc.fileName || doc.name || "document";
  try {
    if (doc.storagePath) {
      const blob = await getBlob(storageRef(storage, doc.storagePath));
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (doc.fileUrl) {
      window.open(doc.fileUrl, "_blank");
    }
  } catch {
    if (doc.fileUrl) window.open(doc.fileUrl, "_blank");
  }
}

export default function DocumentsPage() {
  const [docs, setDocs]         = useState<DocRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [catFilter, setCat]     = useState("All");
  const [uploaderFilter, setUp] = useState("All");
  const [viewDoc, setViewDoc]   = useState<DocRecord | null>(null);

  // Employee documents panel
  const [expandedEmp, setExpandedEmp] = useState<EmpGroup | null>(null);

  // Upload modal
  const [showUpload, setShowUpload]   = useState(false);
  const [empList, setEmpList]         = useState<EmpOption[]>([]);
  const [empSearch, setEmpSearch]     = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmpOption | null>(null);
  const [uploadForm, setUploadForm]   = useState({ category: "Employment" });
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadPct, setUploadPct]     = useState(0);
  const [uploading, setUploading]     = useState(false);
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [empError, setEmpError]       = useState(false);
  const fileRef                       = useRef<HTMLInputElement>(null);

  function showMsg(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); }

  useEffect(() => {
    Promise.all([loadAllDocuments(), getEmployees()])
      .then(([allDocs, emps]) => {
        const activeIds = new Set(
          (emps as Record<string, unknown>[]).flatMap(e => [
            String(e.id ?? ""), String(e.employeeId ?? "")
          ]).filter(Boolean)
        );
        const filtered = activeIds.size > 0
          ? allDocs.filter(d => !d.empId || activeIds.has(d.empId))
          : allDocs;
        setDocs(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Cache-first: employee dropdown shows instantly, refreshes on network
    cachedEmployees((docs) => {
      setEmpList(docs.map((d) => ({
        id:          String(d.id ?? d.employeeId ?? ""),
        empId:       String(d.employeeId ?? d.id ?? ""),
        name:        String(d.name ?? ""),
        dept:        String(d.department ?? ""),
        designation: String(d.designation ?? ""),
      })));
    }).catch(() => {});
  }, []);

  async function handleUpload() {
    if (!selectedEmp) { setEmpError(true); showMsg("Please select an employee first.", false); return; }
    if (uploadFiles.length === 0) { showMsg("Please select at least one file.", false); return; }
    setEmpError(false);
    setUploading(true);
    setUploadPct(0);
    try {
      const emp = { id: selectedEmp.id, name: selectedEmp.name, dept: selectedEmp.dept, designation: selectedEmp.designation };
      for (let i = 0; i < uploadFiles.length; i++) {
        const f      = uploadFiles[i];
        const slotId = `hr_${uploadForm.category.toLowerCase()}_${Date.now()}_${i}`;
        const docName = f.name.replace(/\.[^.]+$/, ""); // filename without extension
        const { url, path } = await uploadDocFile(emp, slotId, f, (pct) => setUploadPct(pct));
        await saveDocMeta(emp, slotId, {
          name:        docName,
          category:    uploadForm.category,
          status:      "Uploaded",
          fileUrl:     url,
          fileName:    f.name,
          fileExt:     f.name.split(".").pop()?.toUpperCase() ?? "",
          fileSize:    f.size,
          storagePath: path,
          hrOnly:      false,
          isExtra:     true,
        }, "hr");
      }
      const updated = await loadAllDocuments();
      setDocs(updated);
      showMsg(`${uploadFiles.length} document(s) uploaded for ${selectedEmp.name}`);
      setShowUpload(false);
      setSelectedEmp(null);
      setUploadFiles([]);
      setUploadForm({ category: "Employment" });
      setEmpSearch("");
      setUploadPct(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMsg(`Upload failed: ${msg}`, false);
    } finally {
      setUploading(false);
    }
  }

  // ── Filter docs ───────────────────────────────────────────────────────────
  const filtered = docs.filter((d) => {
    const q           = search.toLowerCase();
    const matchSearch = !q ||
      d.empName?.toLowerCase().includes(q) ||
      d.empId?.toLowerCase().includes(q) ||
      d.name?.toLowerCase().includes(q) ||
      d.fileName?.toLowerCase().includes(q) ||
      d.empDept?.toLowerCase().includes(q);
    const matchCat      = catFilter === "All" || d.category === catFilter;
    const matchUploader = uploaderFilter === "All" || d.uploadedBy === uploaderFilter;
    return matchSearch && matchCat && matchUploader;
  });

  // ── Group by employee ─────────────────────────────────────────────────────
  const empGroups: EmpGroup[] = (() => {
    const map = new Map<string, EmpGroup>();
    for (const d of filtered) {
      const key = d.empId || "__unknown__";
      if (!map.has(key)) {
        map.set(key, { empId: d.empId || "—", empName: d.empName || "Unknown", empDept: d.empDept || "—", docs: [] });
      }
      map.get(key)!.docs.push(d);
    }
    // Sort groups by employee name
    return Array.from(map.values()).sort((a, b) => a.empName.localeCompare(b.empName));
  })();

  const totalDocs  = filtered.length;
  const uploaded   = filtered.filter(d => d.status === "Uploaded").length;

  const filteredEmps = empList.filter(e =>
    !empSearch ||
    e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.empId.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.dept.toLowerCase().includes(empSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg ${toast.ok ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-gray-500 text-sm mt-1">All employee documents stored in Firebase Storage</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
        >
          <Plus size={16} /> Upload Document
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Documents",  value: totalDocs,              color: "text-[#4F3CC9]"  },
          { label: "Uploaded",         value: uploaded,               color: "text-green-600"  },
          { label: "Employees",        value: empGroups.length,       color: "text-blue-600"   },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by employee, ID, document name…"
            className="w-full pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select value={catFilter} onChange={(e) => setCat(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={uploaderFilter} onChange={(e) => setUp(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]">
            {UPLOADERS.map((u) => (
              <option key={u} value={u}>
                {u === "All" ? "All Uploaders" : u === "hr" ? "Uploaded by HR" : "Uploaded by Employee"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grouped Employee Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <table className="w-full">
            <tbody>
              <SkeletonTableRows rows={6} cols={5} />
            </tbody>
          </table>
        ) : empGroups.length === 0 ? (
          <EmptyState icon={FileText} title="No documents found" subtitle="Upload a document using the button above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["Employee", "Documents", "Categories", "Recent Documents", "Latest Upload", "Actions"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {empGroups.map((group) => {
                  const uniqueCats = [...new Set(group.docs.map(d => d.category).filter(Boolean))];
                  const recentDocs = [...group.docs]
                    .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))
                    .slice(0, 2);
                  const latestDate = recentDocs[0]?.uploadedAt;
                  return (
                    <tr key={group.empId} className="hover:bg-[#FAFAFF] transition-colors">
                      {/* Employee */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-bold text-sm shrink-0">
                            {group.empName?.charAt(0).toUpperCase() || <User size={14} />}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{group.empName}</p>
                            <p className="text-xs text-gray-400">{group.empId} · {group.empDept}</p>
                          </div>
                        </div>
                      </td>

                      {/* Document count */}
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#EDE9FF] text-[#4F3CC9] font-bold text-sm">
                          {group.docs.length}
                        </span>
                      </td>

                      {/* Categories */}
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          {uniqueCats.slice(0, 3).map(cat => (
                            <span key={cat} className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAT_COLORS[cat ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                              {cat}
                            </span>
                          ))}
                          {uniqueCats.length > 3 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                              +{uniqueCats.length - 3}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Recent document names */}
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          {recentDocs.map(d => (
                            <div key={d.docId} className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded bg-[#EDE9FF] flex items-center justify-center shrink-0">
                                <FileText size={10} className="text-[#4F3CC9]" />
                              </div>
                              <span className="text-xs text-gray-700 truncate max-w-[160px]">{d.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${d.status === "Uploaded" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                                {d.status === "Uploaded" ? <CheckCircle size={8} className="inline mr-0.5" /> : <Clock size={8} className="inline mr-0.5" />}
                                {d.status}
                              </span>
                            </div>
                          ))}
                          {group.docs.length > 2 && (
                            <span className="text-xs text-gray-400">+{group.docs.length - 2} more</span>
                          )}
                        </div>
                      </td>

                      {/* Latest upload date */}
                      <td className="px-4 py-4 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(latestDate)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-4">
                        <button
                          onClick={() => setExpandedEmp(group)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4F3CC9] border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF] transition-colors whitespace-nowrap"
                        >
                          View All <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employee Documents Panel (modal) */}
      {expandedEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setExpandedEmp(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-bold text-base">
                  {expandedEmp.empName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-lg">{expandedEmp.empName}</h3>
                  <p className="text-xs text-gray-400">{expandedEmp.empId} · {expandedEmp.empDept}</p>
                </div>
                <span className="ml-2 px-3 py-1 rounded-full bg-[#EDE9FF] text-[#4F3CC9] text-xs font-bold">
                  {expandedEmp.docs.length} document{expandedEmp.docs.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button onClick={() => setExpandedEmp(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Documents table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="border-b border-gray-100">
                    {["Document", "Category", "File", "Size", "Uploaded By", "Date", "Actions"].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {expandedEmp.docs
                    .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))
                    .map((d) => (
                    <tr key={d.docId} className="hover:bg-[#FAFAFF] transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#EDE9FF] flex items-center justify-center shrink-0">
                            <FileText size={14} className="text-[#4F3CC9]" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 max-w-[160px] truncate">{d.name}</p>
                            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${d.status === "Uploaded" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                              {d.status === "Uploaded" ? <CheckCircle size={8} /> : <Clock size={8} />}
                              {d.status}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 ${CAT_COLORS[d.category ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                          <Building2 size={10} /> {d.category || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-gray-700 truncate max-w-[140px]" title={d.fileName}>{d.fileName || "—"}</p>
                        <p className="text-xs text-gray-400">{d.fileExt || "—"}</p>
                      </td>
                      <td className="px-5 py-4 text-gray-500 whitespace-nowrap">{formatBytes(d.fileSize)}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${d.uploadedBy === "hr" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                          {d.uploadedBy === "hr" ? "HR" : "Employee"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">{formatDate(d.uploadedAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          {d.fileUrl && (
                            <>
                              <button onClick={() => setViewDoc(d)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-[#4F3CC9] hover:bg-[#EDE9FF] transition-colors" title="Preview">
                                <Eye size={14} />
                              </button>
                              <button onClick={() => downloadDoc(d)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors" title="Download">
                                <Download size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!uploading) { setShowUpload(false); setEmpError(false); } }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Upload Document</h3>
                <p className="text-xs text-gray-400 mt-0.5">Upload a document for a specific employee</p>
              </div>
              {!uploading && (
                <button onClick={() => { setShowUpload(false); setEmpError(false); }} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <X size={16} className="text-gray-400" />
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              {/* Employee picker */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Employee <span className="text-red-400">*</span></label>
                {selectedEmp ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[#4F3CC9] bg-[#F5F3FF]">
                    <div className="w-7 h-7 rounded-full bg-[#4F3CC9] text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {selectedEmp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{selectedEmp.name}</p>
                      <p className="text-xs text-gray-400">{selectedEmp.empId} · {selectedEmp.dept}</p>
                    </div>
                    <button onClick={() => { setSelectedEmp(null); setEmpSearch(""); setEmpError(false); }} className="text-gray-400 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={empSearch}
                      onChange={(e) => { setEmpSearch(e.target.value); setShowEmpDrop(true); setEmpError(false); }}
                      onFocus={() => setShowEmpDrop(true)}
                      onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}
                      placeholder="Search employee by name, ID or department…"
                      className={`w-full pl-8 pr-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] ${empError ? "border-red-400 bg-red-50" : "border-gray-200"}`}
                    />
                    {empError && <p className="text-xs text-red-500 mt-1">Please select an employee first</p>}
                    {showEmpDrop && filteredEmps.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                        {filteredEmps.map((e) => (
                          <div key={e.id} className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                            onMouseDown={() => { setSelectedEmp(e); setEmpSearch(""); setShowEmpDrop(false); }}>
                            <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-xs font-bold shrink-0">
                              {e.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{e.name}</p>
                              <p className="text-xs text-gray-400">{e.empId} · {e.dept}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Category</label>
                <select value={uploadForm.category}
                  onChange={(e) => setUploadForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]">
                  {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>

              {/* File picker — multiple files */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">
                  Files <span className="text-red-400">*</span>
                  {uploadFiles.length > 0 && <span className="ml-1 text-[#4F3CC9] font-semibold">{uploadFiles.length} selected</span>}
                </label>
                <input ref={fileRef} type="file" multiple className="hidden"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => {
                    const newFiles = Array.from(e.target.files ?? []);
                    if (newFiles.length > 0) setUploadFiles(prev => [...prev, ...newFiles]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                />

                {/* Selected files list */}
                {uploadFiles.length > 0 && (
                  <div className="space-y-1.5 mb-2 max-h-44 overflow-y-auto">
                    {uploadFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-200 bg-green-50">
                        <FileText size={15} className="text-green-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                          <p className="text-xs text-gray-400">{formatBytes(f.size)}</p>
                        </div>
                        <button onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-gray-400 hover:text-red-500 shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 flex flex-col items-center gap-2 text-gray-400 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors">
                  <Upload size={20} />
                  <span className="text-sm font-medium">{uploadFiles.length > 0 ? "Add More Documents" : "Click to Choose Files"}</span>
                  <span className="text-xs">PDF, DOC, PNG, JPG supported · Multiple files allowed</span>
                </button>
              </div>

              {/* Progress */}
              {uploading && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Uploading…</span><span>{uploadPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-[#4F3CC9] h-2 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowUpload(false); setEmpError(false); }} disabled={uploading}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleUpload}
                  disabled={uploading}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Upload {uploadFiles.length > 1 ? `${uploadFiles.length} Files` : "File"}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {viewDoc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">{viewDoc.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{viewDoc.empName} · {viewDoc.empId} · {viewDoc.empDept}</p>
              </div>
              <button onClick={() => setViewDoc(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {viewDoc.fileUrl ? (
                viewDoc.fileExt && ["PNG", "JPG", "JPEG", "WEBP", "GIF"].includes(viewDoc.fileExt) ? (
                  <img src={viewDoc.fileUrl} alt={viewDoc.name} className="max-w-full mx-auto rounded-xl" />
                ) : viewDoc.fileExt === "PDF" ? (
                  <iframe src={viewDoc.fileUrl} className="w-full h-[60vh] rounded-xl border border-gray-100" title={viewDoc.name} />
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <FileText size={40} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Preview not available for {viewDoc.fileExt} files</p>
                    <p className="text-xs mt-1">Use the Download button to open</p>
                  </div>
                )
              ) : (
                <div className="text-center py-12 text-gray-400 text-sm">No file URL available</div>
              )}
            </div>
            <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 rounded-b-2xl flex items-center justify-between gap-4">
              <div className="grid grid-cols-4 gap-4 flex-1">
                {[
                  { label: "File",     value: viewDoc.fileName ?? "—" },
                  { label: "Size",     value: formatBytes(viewDoc.fileSize) },
                  { label: "Uploaded", value: formatDate(viewDoc.uploadedAt) },
                  { label: "By",       value: viewDoc.uploadedBy === "hr" ? "HR Admin" : "Employee" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-xs font-medium text-gray-700 truncate">{value}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => downloadDoc(viewDoc)}
                className="flex items-center gap-1.5 text-xs font-medium text-[#4F3CC9] border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF] transition-colors shrink-0">
                <Download size={12} /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
