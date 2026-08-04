"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, X, Check, Save, Loader2, CheckCircle, Mail, AlertCircle, KeyRound, Eye, EyeOff, Lock, ShieldCheck, UserPlus, Users } from "lucide-react";
import { getSettingsDoc, saveSettingsDoc } from "@/lib/firebaseService";
import { DEPARTMENTS } from "@/lib/constants";
import { auth, firebaseConfig } from "@/lib/firebase";
import { sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, getDocs, query, where, getFirestore } from "firebase/firestore";
import { db } from "@/lib/firebase";

type SettingsTab = "Company" | "Departments" | "Leave Policies" | "Work Timings" | "Attendance Rules" | "Holiday Calendar" | "Password Reset" | "HR Accounts";

const settingsTabs: SettingsTab[] = ["Company", "Departments", "Leave Policies", "Work Timings", "Attendance Rules", "Holiday Calendar", "Password Reset", "HR Accounts"];

// ── Default data (used only when Firebase has no data yet) ────────────────────
const DEFAULT_DEPTS = [...DEPARTMENTS];

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
const DEFAULT_ATT_RULES    = { minHours: "8", halfDayThreshold: "0", gracePeriod: "15", autoAbsentAfter: "30", autoMarkEnabled: false, lateNotif: true, absentNotif: true };
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

  // ── Password Management ───────────────────────────────────────────────────
  const [currentPw,     setCurrentPw]     = useState("");
  const [newPw,         setNewPw]         = useState("");
  const [confirmPw,     setConfirmPw]     = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw,     setShowNewPw]     = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving,      setPwSaving]      = useState(false);
  const [pwSuccess,     setPwSuccess]     = useState<string | null>(null);
  const [pwError,       setPwError]       = useState<string | null>(null);

  const [resetSending, setResetSending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError,   setResetError]   = useState<string | null>(null);

  // ── HR Accounts ───────────────────────────────────────────────────────────
  interface HRAccount { uid: string; email: string; name: string; createdAt: string; }
  const [hrAccounts,    setHrAccounts]    = useState<HRAccount[]>([]);
  const [hrLoading,     setHrLoading]     = useState(false);
  const [newHrEmail,    setNewHrEmail]    = useState("");
  const [newHrName,     setNewHrName]     = useState("");
  const [newHrPassword, setNewHrPassword] = useState("");
  const [showNewHrPw,   setShowNewHrPw]   = useState(false);
  const [hrCreating,    setHrCreating]    = useState(false);
  const [hrError,       setHrError]       = useState<string | null>(null);
  const [hrSuccess,     setHrSuccess]     = useState<string | null>(null);

  async function loadHrAccounts() {
    setHrLoading(true);
    try {
      const [snap1, snap2] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "admin"))),
        getDocs(query(collection(db, "users"), where("role", "==", "hr_admin"))),
      ]);
      const seen = new Set<string>();
      const accounts: { uid: string; email: string; name: string; createdAt: string }[] = [];
      [...snap1.docs, ...snap2.docs].forEach(d => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const data = d.data();
        accounts.push({ uid: d.id, email: data.email ?? "", name: data.name ?? data.displayName ?? "", createdAt: data.createdAt ?? "" });
      });
      setHrAccounts(accounts);
    } catch { /* ignore */ } finally {
      setHrLoading(false);
    }
  }

  async function createHrAccount() {
    setHrError(null); setHrSuccess(null);
    if (!newHrEmail.trim()) { setHrError("Email is required."); return; }
    if (!newHrPassword || newHrPassword.length < 6) { setHrError("Password must be at least 6 characters."); return; }
    if (!newHrName.trim()) { setHrError("Name is required."); return; }
    setHrCreating(true);
    // Use a secondary app instance so current HR session is not affected
    const secondaryAppName = "hr-create-temp";
    let secondaryApp;
    try {
      secondaryApp = getApps().find(a => a.name === secondaryAppName) ?? initializeApp(firebaseConfig, secondaryAppName);
      const secondaryAuth = getAuth(secondaryApp);
      const secondaryDb = getFirestore(secondaryApp);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, newHrEmail.trim(), newHrPassword);
      // Write the profile via the SECONDARY app's Firestore while the new user is
      // still signed in there — the users/{uid} rule requires request.auth.uid == uid,
      // so this must run as the new user (not the admin), before signing out.
      await setDoc(doc(secondaryDb, "users", cred.user.uid), {
        uid: cred.user.uid, email: newHrEmail.trim(), name: newHrName.trim(),
        role: "hr_admin", createdAt: new Date().toISOString(),
      });
      await secondaryAuth.signOut();
      setHrSuccess(`HR account created for ${newHrEmail.trim()}`);
      setNewHrEmail(""); setNewHrName(""); setNewHrPassword("");
      loadHrAccounts();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const msg = (err as { message?: string }).message ?? "";
      if (code === "auth/email-already-in-use") setHrError("This email is already registered.");
      else if (code === "auth/invalid-email")   setHrError("Invalid email address.");
      else if (code === "auth/weak-password")    setHrError("Password is too weak — use at least 6 characters.");
      else if (code === "permission-denied")     setHrError("Permission denied writing the account profile. Please sign out and sign in again.");
      else setHrError(`Failed to create account: ${msg || code || "unexpected error"}`);
    } finally {
      setHrCreating(false);
      if (secondaryApp) { try { await deleteApp(secondaryApp); } catch { /* ignore */ } }
    }
  }

  async function handleChangePassword() {
    setPwError(null);
    setPwSuccess(null);
    if (!currentPw) { setPwError("Please enter your current password."); return; }
    if (!newPw)     { setPwError("Please enter a new password."); return; }
    if (newPw.length < 6) { setPwError("New password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { setPwError("New passwords do not match."); return; }
    if (currentPw === newPw) { setPwError("New password must be different from current password."); return; }

    const user = auth.currentUser;
    if (!user || !user.email) { setPwError("Session expired. Please log in again."); return; }

    setPwSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      setPwSuccess("Password changed successfully!");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential")
        setPwError("Current password is incorrect.");
      else if (code === "auth/too-many-requests")
        setPwError("Too many attempts. Please wait a moment and try again.");
      else if (code === "auth/network-request-failed")
        setPwError("Network error. Please check your connection.");
      else
        setPwError("Failed to change password. Please try again.");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleForgotPassword() {
    setResetError(null);
    setResetSuccess(null);
    const email = auth.currentUser?.email;
    if (!email) { setResetError("Could not detect your email. Please log in again."); return; }
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSuccess(email);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/too-many-requests") setResetError("Too many requests. Please wait a moment.");
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
            // logoUrl intentionally ignored — company logo feature removed
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
        case "HR Accounts": {
          await loadHrAccounts();
          break;
        }
      }
    } catch { /* ignore */ } finally {
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

  // ── Save helpers ──────────────────────────────────────────────────────────
  async function saveToFirebase(docId: string, data: Record<string, unknown>, tab: SettingsTab) {
    // BUG-ATT-02: guard the Half-Day range so the thresholds the Attendance
    // module reads are always coherent — Half-Day start must sit below the
    // Full-Day (Present) cutoff, otherwise there's no valid Half-Day band.
    if (docId === "attendanceRules") {
      const mh = parseFloat(String((data as Record<string, unknown>).minHours));
      const hd = parseFloat(String((data as Record<string, unknown>).halfDayThreshold));
      if (isNaN(mh) || mh <= 0) { showToast("Full Day hours must be a positive number.", false); return; }
      if (isNaN(hd) || hd < 0) { showToast("Half Day hours must be zero or more.", false); return; }
      if (hd >= mh) { showToast("Half-Day start must be less than Full-Day hours (e.g. Half Day from 4, Full Day at 7).", false); return; }
    }
    setSavingTab(tab);
    try {
      await saveSettingsDoc(docId, data);
      showToast("Changes saved successfully");
    } catch (err) {
      showToast("Failed to save. Please try again.", false);
    } finally {
      setSavingTab(null);
    }
  }

  // ── Departments: immediate Firebase write on every change ─────────────────
  async function persistDepts(updated: string[], successMsg: string) {
    const prev = depts;
    setDepts(updated);
    try {
      await saveSettingsDoc("departments", { list: updated });
      showToast(successMsg);
    } catch {
      setDepts(prev);
      showToast("Failed to save department.", false);
    }
  }

  function addDept() {
    if (!newDept.trim()) return;
    const updated = [...depts, newDept.trim()];
    setNewDept(""); setAddingDept(false);
    persistDepts(updated, "Department added");
  }
  function removeDept(i: number) {
    persistDepts(depts.filter((_, idx) => idx !== i), "Department removed");
  }
  function startEditDept(i: number) { setEditDeptIdx(i); setEditDeptVal(depts[i]); }
  function saveEditDept() {
    if (editDeptIdx === null || !editDeptVal.trim()) return;
    const updated = [...depts]; updated[editDeptIdx] = editDeptVal.trim();
    setEditDeptIdx(null);
    persistDepts(updated, "Department updated");
  }

  // ── Leave Policies ────────────────────────────────────────────────────────
  function openEditPolicy(p: LeavePolicy) {
    setEditPolicy(p);
    setEditPolicyForm({ days: p.days, carryForward: p.carryForward, resetMonth: p.resetMonth });
  }
  async function saveEditPolicy() {
    if (!editPolicy) return;
    const prev = leavePolicies;
    const updated = leavePolicies.map((p) => p.id === editPolicy.id ? { ...p, ...editPolicyForm } : p);
    setLeavePolicies(updated);
    try {
      await saveSettingsDoc("leavePolicies", { list: updated });
      showToast("Leave policy updated");
      setEditPolicy(null);
    } catch {
      setLeavePolicies(prev);
      setEditPolicy(editPolicy);
      showToast("Failed to save leave policy.", false);
    }
  }

  // ── Holidays: immediate Firebase write on every change ────────────────────
  async function persistHolidays(updated: Holiday[]) {
    const prev = holidays;
    setHolidays(updated);
    try {
      await saveSettingsDoc("holidays", { list: updated });
    } catch {
      setHolidays(prev);
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
                  <SaveBtn tab="Company" docId="company" data={{ ...companyForm }} />
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
                  {/* Half-Day range (BUG-ATT-02): the two hour thresholds define
                      three worked-hours bands. Half-Day start is the lower bound;
                      Full-Day (Present) hours is the upper bound of the Half-Day
                      range. The Attendance module honors these exactly. */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                    <p className="text-sm font-medium text-gray-700">Working-Hours Thresholds</p>
                    <p className="text-xs text-gray-500">A day counts as <b>Half Day</b> when hours worked fall in the range below, <b>Present</b> at or above the Full-Day hours, and <b>Absent</b> under the Half-Day start.</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Half Day — from</label>
                        <div className="flex items-center gap-2">
                          <input value={attRules.halfDayThreshold} onChange={(e) => setAttRules({ ...attRules, halfDayThreshold: e.target.value })} className={inputCls} />
                          <span className="text-sm text-gray-500 shrink-0">hours</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">Lower bound — below this counts as Absent.</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Full Day — Present at</label>
                        <div className="flex items-center gap-2">
                          <input value={attRules.minHours} onChange={(e) => setAttRules({ ...attRules, minHours: e.target.value })} className={inputCls} />
                          <span className="text-sm text-gray-500 shrink-0">hours</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">Upper bound — at/above this counts as Present.</p>
                      </div>
                    </div>
                    {(() => {
                      const hd = parseFloat(attRules.halfDayThreshold);
                      const mh = parseFloat(attRules.minHours);
                      const valid = !isNaN(hd) && !isNaN(mh) && hd >= 0 && mh > 0 && hd < mh;
                      return valid ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                          <span className="text-gray-400">Resulting bands:</span>
                          <span className="px-2 py-1 rounded-lg bg-red-50 text-red-600 font-medium">Absent &lt; {hd}h</span>
                          <span className="px-2 py-1 rounded-lg bg-yellow-50 text-yellow-700 font-medium">Half Day {hd}h – {mh}h</span>
                          <span className="px-2 py-1 rounded-lg bg-green-50 text-green-700 font-medium">Present ≥ {mh}h</span>
                        </div>
                      ) : (
                        <p className="text-xs text-red-500 pt-1">Half-Day start must be below Full-Day hours — e.g. Half Day from 4, Full Day at 7.</p>
                      );
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {([
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

          {/* ── HR Accounts ── */}
          {activeTab === "HR Accounts" && (
            <div className="space-y-5">
              {/* Create new HR account */}
              <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                    <UserPlus size={18} className="text-[#4F3CC9]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Create HR Account</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Add a new HR admin who can access the HR dashboard</p>
                  </div>
                </div>

                {hrSuccess && (
                  <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                    <CheckCircle size={16} className="text-green-600 shrink-0" />
                    <p className="text-sm font-medium text-green-800">{hrSuccess}</p>
                  </div>
                )}
                {hrError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                    <p className="text-sm text-red-600">{hrError}</p>
                  </div>
                )}

                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">Full Name</label>
                    <input
                      value={newHrName}
                      onChange={(e) => { setNewHrName(e.target.value); setHrError(null); setHrSuccess(null); }}
                      placeholder="e.g. Ravi Kumar"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">Email Address</label>
                    <div className="relative">
                      <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={newHrEmail}
                        onChange={(e) => { setNewHrEmail(e.target.value); setHrError(null); setHrSuccess(null); }}
                        placeholder="e.g. hr2@woways.in"
                        className="pl-9 w-full py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">Password</label>
                    <div className="relative">
                      <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showNewHrPw ? "text" : "password"}
                        value={newHrPassword}
                        onChange={(e) => { setNewHrPassword(e.target.value); setHrError(null); setHrSuccess(null); }}
                        placeholder="Min. 6 characters"
                        className="pl-9 pr-10 w-full py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 font-mono"
                      />
                      <button type="button" onClick={() => setShowNewHrPw(!showNewHrPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showNewHrPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <button onClick={createHrAccount} disabled={hrCreating}
                    className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
                    {hrCreating ? <><Loader2 size={14} className="animate-spin" />Creating…</> : <><UserPlus size={14} />Create HR Account</>}
                  </button>
                </div>
              </div>

              {/* Existing HR accounts list */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-[#4F3CC9]" />
                    <h2 className="text-base font-semibold text-gray-900">Existing HR Accounts</h2>
                  </div>
                  <button onClick={loadHrAccounts} disabled={hrLoading}
                    className="text-xs text-[#4F3CC9] font-medium hover:underline disabled:opacity-50 flex items-center gap-1">
                    {hrLoading ? <Loader2 size={12} className="animate-spin" /> : null} Refresh
                  </button>
                </div>
                {hrLoading ? (
                  <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-[#4F3CC9]" /></div>
                ) : hrAccounts.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-8">No HR accounts found.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                        <th className="px-5 py-3 text-left">Name</th>
                        <th className="px-5 py-3 text-left">Email</th>
                        <th className="px-5 py-3 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {hrAccounts.map((acc) => (
                        <tr key={acc.uid} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-medium text-gray-900">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-bold text-xs shrink-0">
                                {(acc.name || acc.email).charAt(0).toUpperCase()}
                              </div>
                              {acc.name || "—"}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-600">{acc.email}</td>
                          <td className="px-5 py-3 text-gray-400 text-xs">
                            {acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── Password Management ── */}
          {activeTab === "Password Reset" && (
            <div className="space-y-5">

              {/* ── Change Password ── */}
              <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                    <Lock size={18} className="text-[#4F3CC9]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Change My Password</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Update your HR admin account password</p>
                  </div>
                </div>

                {pwSuccess && (
                  <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                    <CheckCircle size={16} className="text-green-600 shrink-0" />
                    <p className="text-sm font-medium text-green-800">{pwSuccess}</p>
                  </div>
                )}
                {pwError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                    <p className="text-sm text-red-600">{pwError}</p>
                  </div>
                )}

                <div className="space-y-4 max-w-md">
                  {/* Current password */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">Current Password</label>
                    <div className="relative">
                      <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type={showCurrentPw ? "text" : "password"} placeholder="Enter current password"
                        value={currentPw} onChange={(e) => { setCurrentPw(e.target.value); setPwError(null); setPwSuccess(null); }}
                        className="pl-9 pr-10 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 w-full font-mono" />
                      <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* New password */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">New Password</label>
                    <div className="relative">
                      <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type={showNewPw ? "text" : "password"} placeholder="Min. 6 characters"
                        value={newPw} onChange={(e) => { setNewPw(e.target.value); setPwError(null); setPwSuccess(null); }}
                        className="pl-9 pr-10 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 w-full font-mono" />
                      <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm new password */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1.5">Confirm New Password</label>
                    <div className="relative">
                      <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type={showConfirmPw ? "text" : "password"} placeholder="Re-enter new password"
                        value={confirmPw} onChange={(e) => { setConfirmPw(e.target.value); setPwError(null); setPwSuccess(null); }}
                        className={`pl-9 pr-10 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full font-mono ${
                          confirmPw && newPw !== confirmPw ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"
                        }`} />
                      <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {confirmPw && newPw !== confirmPw && (
                      <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                    )}
                  </div>

                  <button onClick={handleChangePassword} disabled={pwSaving}
                    className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
                    {pwSaving ? <><Loader2 size={14} className="animate-spin" />Updating…</> : <><Lock size={14} />Update Password</>}
                  </button>
                </div>
              </div>

              {/* ── Forgot / Reset via Email ── */}
              <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <ShieldCheck size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Forgot Password?</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Can&apos;t remember your current password? Send a reset link to your email</p>
                  </div>
                </div>

                {resetSuccess && (
                  <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                    <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-green-800">Reset email sent!</p>
                      <p className="text-xs text-green-700 mt-0.5">Check your inbox at <span className="font-semibold">{resetSuccess}</span> — click the link to set a new password. Expires in 1 hour.</p>
                    </div>
                  </div>
                )}
                {resetError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                    <p className="text-sm text-red-600">{resetError}</p>
                  </div>
                )}

                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 max-w-md">
                  <Mail size={14} className="text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-600 flex-1">{auth.currentUser?.email ?? "—"}</span>
                  <button onClick={handleForgotPassword} disabled={resetSending}
                    className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5 transition-colors shrink-0">
                    {resetSending ? <><Loader2 size={12} className="animate-spin" />Sending…</> : "Send Reset Link"}
                  </button>
                </div>
                <p className="text-xs text-gray-400 max-w-md">After clicking, check your inbox and spam folder. Click the link to set a new password, then log back in.</p>
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
