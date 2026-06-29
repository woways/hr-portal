"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Pencil, Trash2, X, Check, Save, Loader2, CheckCircle, Upload, ImageIcon, Mail, AlertCircle, KeyRound } from "lucide-react";
import { getSettingsDoc, saveSettingsDoc } from "@/lib/firebaseService";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage, auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";

type SettingsTab = "Company" | "Departments" | "Leave Policies" | "Work Timings" | "Attendance Rules" | "Holiday Calendar" | "Password Reset";

const settingsTabs: SettingsTab[] = ["Company", "Departments", "Leave Policies", "Work Timings", "Attendance Rules", "Holiday Calendar", "Password Reset"];

// ── Default data (used only when Firebase has no data yet) ────────────────────
const DEFAULT_DEPTS = ["Engineering", "Marketing", "Sales", "HR", "Finance", "Operations", "Design"];

const DEFAULT_LEAVE_POLICIES = [
  { id: "1", type: "Casual Leave",    days: 12, carryForward: false, resetMonth: "January" },
  { id: "2", type: "Sick Leave",      days: 10, carryForward: false, resetMonth: "January" },
  { id: "3", type: "Emergency Leave", days: 3,  carryForward: false, resetMonth: "January" },
  { id: "4", type: "Paid Leave",      days: 15, carryForward: true,  resetMonth: "April"   },
];

const DEFAULT_HOLIDAYS = [
  { id: "1", name: "Republic Day",     date: "2026-01-26", type: "National"  },
  { id: "2", name: "Holi",             date: "2026-03-14", type: "National"  },
  { id: "3", name: "Ram Navami",       date: "2026-03-29", type: "Regional"  },
  { id: "4", name: "Good Friday",      date: "2026-04-03", type: "Optional"  },
  { id: "5", name: "Independence Day", date: "2026-08-15", type: "National"  },
  { id: "6", name: "Ganesh Chaturthi",date: "2026-08-25", type: "Regional"  },
  { id: "7", name: "Diwali",           date: "2026-10-19", type: "National"  },
  { id: "8", name: "Christmas",        date: "2026-12-25", type: "Optional"  },
];

const DEFAULT_WORK_TIMINGS = { start: "09:00", end: "18:00", lateThreshold: "09:30", weekOff: "Saturday & Sunday" };
const DEFAULT_ATT_RULES    = { minHours: "8", halfDayThreshold: "4", gracePeriod: "15", autoAbsentAfter: "30", autoMarkEnabled: false, lateNotif: true, absentNotif: true };
const DEFAULT_COMPANY      = { name: "", industry: "", website: "", address: "" };

const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]";

// Auto-derive day name from a date string
function dayName(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

type LeavePolicy = typeof DEFAULT_LEAVE_POLICIES[0];
type Holiday     = { id: string; name: string; date: string; type: string };

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Company");
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Per-tab loading/saving states ─────────────────────────────────────────
  const [loadingTab, setLoadingTab] = useState<SettingsTab | null>(null);
  const [savingTab,  setSavingTab]  = useState<SettingsTab | null>(null);

  // ── Company ───────────────────────────────────────────────────────────────
  const [companyForm, setCompanyForm] = useState(DEFAULT_COMPANY);
  const [logoUrl,    setLogoUrl]    = useState<string>("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Password Reset ────────────────────────────────────────────────────────
  const [resetEmail,   setResetEmail]   = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError,   setResetError]   = useState<string | null>(null);

  async function handlePasswordReset() {
    setResetError(null);
    setResetSuccess(null);
    const trimmed = resetEmail.trim();
    if (!trimmed) { setResetError("Please enter an email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setResetError("Enter a valid email address (e.g. name@gmail.com)."); return; }
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setResetSuccess(trimmed);
      setResetEmail("");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/user-not-found")     setResetError("No account found with this email address.");
      else if (code === "auth/invalid-email") setResetError("The email address is not valid.");
      else if (code === "auth/too-many-requests") setResetError("Too many requests. Please wait a moment and try again.");
      else setResetError("Failed to send reset email. Please try again.");
    } finally {
      setResetSending(false);
    }
  }

  // ── Departments ───────────────────────────────────────────────────────────
  const [depts,        setDepts]        = useState(DEFAULT_DEPTS);
  const [addingDept,   setAddingDept]   = useState(false);
  const [newDept,      setNewDept]      = useState("");
  const [editDeptIdx,  setEditDeptIdx]  = useState<number | null>(null);
  const [editDeptVal,  setEditDeptVal]  = useState("");

  // ── Leave Policies ────────────────────────────────────────────────────────
  const [leavePolicies,  setLeavePolicies]  = useState<LeavePolicy[]>(DEFAULT_LEAVE_POLICIES);
  const [editPolicy,     setEditPolicy]     = useState<LeavePolicy | null>(null);
  const [editPolicyForm, setEditPolicyForm] = useState({ days: 0, carryForward: false, resetMonth: "January" });

  // ── Work Timings ──────────────────────────────────────────────────────────
  const [workTimings, setWorkTimings] = useState(DEFAULT_WORK_TIMINGS);

  // ── Attendance Rules ──────────────────────────────────────────────────────
  const [attRules, setAttRules] = useState(DEFAULT_ATT_RULES);

  // ── Holidays ──────────────────────────────────────────────────────────────
  const [holidays,       setHolidays]       = useState<Holiday[]>(DEFAULT_HOLIDAYS);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [holidayForm,    setHolidayForm]    = useState({ name: "", date: "", type: "National" });

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Load data from Firebase for a given tab ───────────────────────────────
  const loadTab = useCallback(async (tab: SettingsTab) => {
    setLoadingTab(tab);
    try {
      switch (tab) {
        case "Company": {
          const data = await getSettingsDoc("company");
          if (data) {
            setCompanyForm({
              name:     (data.name     as string) ?? "",
              industry: (data.industry as string) ?? "",
              website:  (data.website  as string) ?? "",
              address:  (data.address  as string) ?? "",
            });
            if (data.logoUrl) setLogoUrl(data.logoUrl as string);
          }
          break;
        }
        case "Departments": {
          const data = await getSettingsDoc("departments");
          if (data?.list) setDepts(data.list as string[]);
          break;
        }
        case "Leave Policies": {
          const data = await getSettingsDoc("leavePolicies");
          if (data?.list) setLeavePolicies(data.list as LeavePolicy[]);
          break;
        }
        case "Work Timings": {
          const data = await getSettingsDoc("workTimings");
          if (data) setWorkTimings({
            start:          (data.start          as string) ?? DEFAULT_WORK_TIMINGS.start,
            end:            (data.end            as string) ?? DEFAULT_WORK_TIMINGS.end,
            lateThreshold:  (data.lateThreshold  as string) ?? DEFAULT_WORK_TIMINGS.lateThreshold,
            weekOff:        (data.weekOff        as string) ?? DEFAULT_WORK_TIMINGS.weekOff,
          });
          break;
        }
        case "Attendance Rules": {
          const data = await getSettingsDoc("attendanceRules");
          if (data) setAttRules({
            minHours:         (data.minHours         as string)  ?? DEFAULT_ATT_RULES.minHours,
            halfDayThreshold: (data.halfDayThreshold as string)  ?? DEFAULT_ATT_RULES.halfDayThreshold,
            gracePeriod:      (data.gracePeriod      as string)  ?? DEFAULT_ATT_RULES.gracePeriod,
            autoAbsentAfter:  (data.autoAbsentAfter  as string)  ?? DEFAULT_ATT_RULES.autoAbsentAfter,
            autoMarkEnabled:  Boolean(data.autoMarkEnabled),
            lateNotif:        data.lateNotif  !== undefined ? Boolean(data.lateNotif)  : true,
            absentNotif:      data.absentNotif !== undefined ? Boolean(data.absentNotif) : true,
          });
          break;
        }
        case "Holiday Calendar": {
          const data = await getSettingsDoc("holidays");
          if (data?.list) setHolidays(data.list as Holiday[]);
          break;
        }
      }
    } catch (err) {
      console.error("[Settings] load error:", err);
    } finally {
      setLoadingTab(null);
    }
  }, []);

  // Load the initial tab on mount
  useEffect(() => { loadTab("Company"); }, [loadTab]);

  // Load tab data whenever user switches tabs
  function handleTabClick(tab: SettingsTab) {
    setActiveTab(tab);
    loadTab(tab);
  }

  // ── Logo upload ───────────────────────────────────────────────────────────
  async function handleLogoUpload(file: File) {
    setLogoUploading(true);
    try {
      const path = `company/logo_${Date.now()}.${file.name.split(".").pop()}`;
      const sRef = storageRef(storage, path);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(sRef, file);
        task.on("state_changed", undefined, reject, () => resolve());
      });
      const url = await getDownloadURL(sRef);
      setLogoUrl(url);
      await saveSettingsDoc("company", { ...companyForm, logoUrl: url });
      showToast("Logo uploaded and saved");
    } catch (err) {
      console.error("[Logo upload]", err);
      showToast("Logo upload failed. Check storage rules.", false);
    } finally {
      setLogoUploading(false);
    }
  }

  // ── Save helpers ──────────────────────────────────────────────────────────
  async function saveToFirebase(docId: string, data: Record<string, unknown>, tab: SettingsTab) {
    setSavingTab(tab);
    try {
      await saveSettingsDoc(docId, data);
      showToast("Changes saved successfully");
    } catch (err) {
      console.error("[Settings] save error:", err);
      showToast("Failed to save. Please try again.", false);
    } finally {
      setSavingTab(null);
    }
  }

  // ── Departments: immediate Firebase write on every change ─────────────────
  async function persistDepts(updated: string[]) {
    setDepts(updated);
    try {
      await saveSettingsDoc("departments", { list: updated });
    } catch (err) {
      console.error("[Settings] dept save error:", err);
      showToast("Failed to save department.", false);
    }
  }

  function addDept() {
    if (!newDept.trim()) return;
    persistDepts([...depts, newDept.trim()]);
    setNewDept(""); setAddingDept(false);
    showToast("Department added");
  }
  function removeDept(i: number) {
    persistDepts(depts.filter((_, idx) => idx !== i));
    showToast("Department removed");
  }
  function startEditDept(i: number) { setEditDeptIdx(i); setEditDeptVal(depts[i]); }
  function saveEditDept() {
    if (editDeptIdx === null || !editDeptVal.trim()) return;
    const updated = [...depts]; updated[editDeptIdx] = editDeptVal.trim();
    persistDepts(updated);
    setEditDeptIdx(null);
    showToast("Department updated");
  }

  // ── Leave Policies ────────────────────────────────────────────────────────
  function openEditPolicy(p: LeavePolicy) {
    setEditPolicy(p);
    setEditPolicyForm({ days: p.days, carryForward: p.carryForward, resetMonth: p.resetMonth });
  }
  async function saveEditPolicy() {
    if (!editPolicy) return;
    const updated = leavePolicies.map((p) => p.id === editPolicy.id ? { ...p, ...editPolicyForm } : p);
    setLeavePolicies(updated);
    setEditPolicy(null);
    try {
      await saveSettingsDoc("leavePolicies", { list: updated });
      showToast("Leave policy updated");
    } catch {
      showToast("Failed to save leave policy.", false);
    }
  }

  // ── Holidays: immediate Firebase write on every change ────────────────────
  async function persistHolidays(updated: Holiday[]) {
    setHolidays(updated);
    try {
      await saveSettingsDoc("holidays", { list: updated });
    } catch (err) {
      console.error("[Settings] holiday save error:", err);
      showToast("Failed to save holiday.", false);
    }
  }

  function addHoliday() {
    if (!holidayForm.name.trim() || !holidayForm.date) {
      showToast("Please fill in holiday name and date.", false);
      return;
    }
    const newH: Holiday = {
      id:   Date.now().toString(),
      name: holidayForm.name.trim(),
      date: holidayForm.date,
      type: holidayForm.type,
    };
    persistHolidays([...holidays, newH]);
    setHolidayForm({ name: "", date: "", type: "National" });
    setShowAddHoliday(false);
    showToast(`${newH.name} added to holiday calendar`);
  }

  function removeHoliday(id: string) {
    persistHolidays(holidays.filter((h) => h.id !== id));
    showToast("Holiday removed");
  }

  const isSaving = (tab: SettingsTab) => savingTab === tab;

  function SaveBtn({ tab, docId, data }: { tab: SettingsTab; docId: string; data: Record<string, unknown> }) {
    const busy = isSaving(tab);
    return (
      <button
        onClick={() => saveToFirebase(docId, data, tab)}
        disabled={busy}
        className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-6 py-2 text-sm font-medium disabled:opacity-60 transition"
      >
        {busy ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save Changes</>}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Configure company, policies and attendance rules</p>
      </div>

      <div className="flex gap-4">
        {/* Left sidebar */}
        <div className="w-56 flex-shrink-0">
          <div className="bg-white rounded-2xl shadow-sm p-2 space-y-1">
            {settingsTabs.map((t) => (
              <button key={t} onClick={() => handleTabClick(t)}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-between
                  ${activeTab === t ? "bg-[#EDE9FF] text-[#4F3CC9]" : "text-gray-600 hover:bg-gray-50"}`}>
                {t}
                {loadingTab === t && <Loader2 size={12} className="animate-spin text-[#4F3CC9]" />}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">

          {/* ── Company ── */}
          {activeTab === "Company" && (
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
              <h2 className="text-base font-semibold text-gray-900">Company Settings</h2>
              {loadingTab === "Company" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {(["name","industry","website","address"] as const).map((k) => (
                      <div key={k}>
                        <label className="text-xs font-medium text-gray-600 block mb-1 capitalize">
                          {k === "name" ? "Company Name" : k.charAt(0).toUpperCase() + k.slice(1)}
                        </label>
                        <input
                          value={companyForm[k]}
                          onChange={(e) => setCompanyForm({ ...companyForm, [k]: e.target.value })}
                          className={inputCls}
                          placeholder={k === "name" ? "e.g. Acme Corp" : k === "website" ? "https://example.com" : ""}
                        />
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Company Logo</label>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }}
                    />
                    {logoUrl ? (
                      <div className="border border-gray-200 rounded-xl p-4 flex items-center gap-4">
                        <img src={logoUrl} alt="Company Logo" className="h-16 w-auto object-contain rounded-lg border border-gray-100" />
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-gray-500">Logo uploaded successfully</p>
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            disabled={logoUploading}
                            className="flex items-center gap-1.5 text-xs text-[#4F3CC9] font-medium hover:underline disabled:opacity-50"
                          >
                            <Upload size={12} /> {logoUploading ? "Uploading…" : "Replace logo"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => logoInputRef.current?.click()}
                        disabled={logoUploading}
                        className="w-full border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center gap-2 text-gray-400 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {logoUploading
                          ? <><Loader2 size={22} className="animate-spin" /><span className="text-sm">Uploading…</span></>
                          : <><ImageIcon size={22} /><span className="text-sm font-medium">Click to upload company logo</span><span className="text-xs">PNG, JPG, SVG supported</span></>
                        }
                      </button>
                    )}
                  </div>
                  <SaveBtn tab="Company" docId="company" data={{ ...companyForm, logoUrl }} />
                </>
              )}
            </div>
          )}

          {/* ── Departments ── */}
          {activeTab === "Departments" && (
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">Departments</h2>
                <button onClick={() => setAddingDept(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
                  <Plus size={14} /> Add Department
                </button>
              </div>
              {loadingTab === "Departments" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <>
                  {addingDept && (
                    <div className="flex gap-2">
                      <input
                        value={newDept}
                        onChange={(e) => setNewDept(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addDept()}
                        placeholder="Department name…"
                        autoFocus
                        className={`flex-1 ${inputCls}`}
                      />
                      <button onClick={addDept} className="bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">Add</button>
                      <button onClick={() => { setAddingDept(false); setNewDept(""); }} className="border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-500">Cancel</button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {depts.map((d, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50">
                        {editDeptIdx === i ? (
                          <div className="flex items-center gap-2 flex-1 mr-2">
                            <input
                              value={editDeptVal}
                              onChange={(e) => setEditDeptVal(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && saveEditDept()}
                              autoFocus
                              className="flex-1 px-3 py-1.5 rounded-xl border border-[#4F3CC9] text-sm focus:outline-none"
                            />
                            <button onClick={saveEditDept} className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200"><Check size={14} /></button>
                            <button onClick={() => setEditDeptIdx(null)} className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200"><X size={14} /></button>
                          </div>
                        ) : (
                          <span className="font-medium text-gray-800">{d}</span>
                        )}
                        {editDeptIdx !== i && (
                          <div className="flex gap-2">
                            <button onClick={() => startEditDept(i)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                            <button onClick={() => removeDept(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                    ))}
                    {depts.length === 0 && <p className="text-center text-sm text-gray-400 py-6">No departments yet. Add one above.</p>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Leave Policies ── */}
          {activeTab === "Leave Policies" && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b">
                <h2 className="text-base font-semibold text-gray-900">Leave Policies</h2>
              </div>
              {loadingTab === "Leave Policies" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left">Leave Type</th>
                      <th className="px-4 py-3 text-center">Allowed Days</th>
                      <th className="px-4 py-3 text-center">Carry Forward</th>
                      <th className="px-4 py-3 text-center">Reset Month</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {leavePolicies.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{p.type}</td>
                        <td className="px-4 py-3 text-center">{p.days}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.carryForward ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.carryForward ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">{p.resetMonth}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => openEditPolicy(p)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Work Timings ── */}
          {activeTab === "Work Timings" && (
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
              <h2 className="text-base font-semibold text-gray-900">Work Timings</h2>
              {loadingTab === "Work Timings" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Office Start Time</label>
                      <input type="time" value={workTimings.start} onChange={(e) => setWorkTimings({ ...workTimings, start: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Office End Time</label>
                      <input type="time" value={workTimings.end} onChange={(e) => setWorkTimings({ ...workTimings, end: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Late Login Threshold</label>
                      <input type="time" value={workTimings.lateThreshold} onChange={(e) => setWorkTimings({ ...workTimings, lateThreshold: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Week Off</label>
                      <input value={workTimings.weekOff} onChange={(e) => setWorkTimings({ ...workTimings, weekOff: e.target.value })} className={inputCls} placeholder="e.g. Saturday & Sunday" />
                    </div>
                  </div>
                  <SaveBtn tab="Work Timings" docId="workTimings" data={workTimings} />
                </>
              )}
            </div>
          )}

          {/* ── Attendance Rules ── */}
          {activeTab === "Attendance Rules" && (
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
              <h2 className="text-base font-semibold text-gray-900">Attendance Rules</h2>
              {loadingTab === "Attendance Rules" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {([
                      { label: "Min Working Hours",      key: "minHours"         as const, unit: "hours" },
                      { label: "Half Day Threshold",     key: "halfDayThreshold" as const, unit: "hours" },
                      { label: "Grace Period",           key: "gracePeriod"      as const, unit: "mins"  },
                      { label: "Auto Mark Absent After", key: "autoAbsentAfter"  as const, unit: "mins"  },
                    ]).map(({ label, key, unit }) => (
                      <div key={key}>
                        <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                        <div className="flex items-center gap-2">
                          <input value={attRules[key]} onChange={(e) => setAttRules({ ...attRules, [key]: e.target.value })} className={inputCls} />
                          <span className="text-sm text-gray-500 shrink-0">{unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3 pt-2">
                    {([
                      { label: "Auto attendance marking", key: "autoMarkEnabled" as const },
                      { label: "Late login notifications",  key: "lateNotif"       as const },
                      { label: "Absent notifications",      key: "absentNotif"     as const },
                    ]).map(({ label, key }) => (
                      <label key={key} className="flex items-center gap-3 cursor-pointer">
                        <div
                          className={`w-10 h-6 rounded-full relative transition-colors ${attRules[key] ? "bg-[#4F3CC9]" : "bg-gray-200"}`}
                          onClick={() => setAttRules({ ...attRules, [key]: !attRules[key] })}
                        >
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${attRules[key] ? "left-5" : "left-1"}`} />
                        </div>
                        <span className="text-sm text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                  <SaveBtn tab="Attendance Rules" docId="attendanceRules" data={attRules} />
                </>
              )}
            </div>
          )}

          {/* ── Holiday Calendar ── */}
          {activeTab === "Holiday Calendar" && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h2 className="text-base font-semibold text-gray-900">Holiday Calendar 2026</h2>
                <button onClick={() => setShowAddHoliday(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
                  <Plus size={14} /> Add Holiday
                </button>
              </div>
              {loadingTab === "Holiday Calendar" ? (
                <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left">Holiday Name</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Day</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {holidays
                      .slice()
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((h) => (
                        <tr key={h.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{h.name}</td>
                          <td className="px-4 py-3 text-gray-600">{h.date}</td>
                          <td className="px-4 py-3 text-gray-600">{dayName(h.date)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                              ${h.type === "National" ? "bg-orange-100 text-orange-700"
                              : h.type === "Regional" ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"}`}>
                              {h.type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => removeHoliday(h.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                    ))}
                    {holidays.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No holidays added yet.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Password Reset ── */}
          {activeTab === "Password Reset" && (
            <div className="bg-white rounded-2xl shadow-sm p-6 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                  <KeyRound size={20} className="text-[#4F3CC9]" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Password Reset</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Send a secure password reset link to any employee&apos;s email</p>
                </div>
              </div>

              <div className="max-w-lg space-y-4">
                {resetSuccess && (
                  <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                    <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-green-800">Reset email sent successfully</p>
                      <p className="text-xs text-green-700 mt-0.5">A password reset link was delivered to <span className="font-semibold">{resetSuccess}</span>. Ask the employee to check their inbox and spam folder.</p>
                    </div>
                  </div>
                )}

                {resetError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                    <p className="text-sm text-red-600">{resetError}</p>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1.5">Employee Email Address</label>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        placeholder="e.g. employee@woways.in"
                        value={resetEmail}
                        onChange={(e) => { setResetEmail(e.target.value); setResetError(null); setResetSuccess(null); }}
                        onKeyDown={(e) => e.key === "Enter" && handlePasswordReset()}
                        className={`pl-9 pr-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full transition-all ${
                          resetError ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"
                        }`}
                      />
                    </div>
                    <button
                      onClick={handlePasswordReset}
                      disabled={resetSending}
                      className="bg-[#4F3CC9] text-white rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 whitespace-nowrap flex items-center gap-2 transition-colors"
                    >
                      {resetSending
                        ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                        : "Send Reset Email"
                      }
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Firebase will send a secure link. The employee clicks it to set a new password. The link expires in 1 hour.</p>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">How it works</p>
                  {[
                    "Enter the employee's registered email address above",
                    'Click "Send Reset Email" - Firebase sends a secure link instantly',
                    "Employee clicks the link in their inbox to set a new password",
                    "The reset link expires automatically after 1 hour for security",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#4F3CC9] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <p className="text-xs text-gray-500">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Leave Policy Modal ── */}
      {editPolicy && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditPolicy(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Leave Policy</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editPolicy.type}</p>
              </div>
              <button onClick={() => setEditPolicy(null)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Allowed Days</label>
                <input
                  type="number" min={1}
                  value={editPolicyForm.days}
                  onChange={(e) => setEditPolicyForm({ ...editPolicyForm, days: Number(e.target.value) })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Reset Month</label>
                <select
                  value={editPolicyForm.resetMonth}
                  onChange={(e) => setEditPolicyForm({ ...editPolicyForm, resetMonth: e.target.value })}
                  className={inputCls}
                >
                  {months.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">Carry Forward</label>
                <div className="flex gap-3">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      onClick={() => setEditPolicyForm({ ...editPolicyForm, carryForward: v })}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all
                        ${editPolicyForm.carryForward === v
                          ? v ? "bg-green-500 text-white border-green-500" : "bg-gray-400 text-white border-gray-400"
                          : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"}`}
                    >
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={saveEditPolicy} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold text-sm">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Holiday Modal ── */}
      {showAddHoliday && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddHoliday(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Add Holiday</h2>
              <button onClick={() => setShowAddHoliday(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Holiday Name *</label>
                <input
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  placeholder="e.g. Diwali"
                  autoFocus
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Date *</label>
                <input
                  type="date"
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  className={inputCls}
                />
                {holidayForm.date && (
                  <p className="text-xs text-gray-400 mt-1">Day: {dayName(holidayForm.date)}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Type</label>
                <select
                  value={holidayForm.type}
                  onChange={(e) => setHolidayForm({ ...holidayForm, type: e.target.value })}
                  className={inputCls}
                >
                  {["National","Regional","Optional"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <button onClick={addHoliday} className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold">
                Add Holiday
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 text-sm px-4 py-3 rounded-2xl shadow-xl text-white ${toast.ok ? "bg-gray-900" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle size={16} className="text-green-400 shrink-0" /> : <X size={16} className="shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
