"use client";
import { useState } from "react";
import { X, Mail, CheckCircle, AlertCircle, Loader2, KeyRound } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { saveSettingsDoc } from "@/lib/firebaseService";

const roleCards = [
  { role: "Super Admin", border: "border-purple-400", bg: "bg-purple-50", text: "text-purple-700", desc: "Full access to all modules including settings, access control, payroll, and system configuration.", count: 1 },
  { role: "HR Admin",    border: "border-blue-400",   bg: "bg-blue-50",   text: "text-blue-700",   desc: "Access to Hiring, Employees, Attendance, Leave management, and Compensation modules.", count: 2 },
  { role: "Manager",     border: "border-green-400",  bg: "bg-green-50",  text: "text-green-700",  desc: "Access to Team Goals, Leave Approval, and Attendance Visibility for their direct reports.", count: 2 },
];

const permissionModules = [
  { module: "Employee Management", perms: ["View", "Edit", "Delete"] },
  { module: "Recruitment",          perms: ["View", "Edit"] },
  { module: "Attendance",           perms: ["View", "Approve"] },
  { module: "Leave",                perms: ["View", "Approve", "Override"] },
  { module: "Compensation",         perms: ["View", "Edit"] },
  { module: "Reports",              perms: ["View", "Download"] },
  { module: "Settings",             perms: ["View", "Edit"] },
  { module: "Notifications",        perms: ["Send"] },
];

export default function AccessPage() {
  const [showPerms, setShowPerms]     = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permsSaving, setPermsSaving] = useState(false);
  const [permsSaved,  setPermsSaved]  = useState(false);
  const [email, setEmail]             = useState("");
  const [sending, setSending]         = useState(false);
  const [success, setSuccess]         = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  async function handleSavePerms() {
    if (!showPerms) return;
    setPermsSaving(true);
    try {
      const rolePerms = Object.fromEntries(
        Object.entries(permissions).filter(([k]) => k.startsWith(showPerms + "-"))
      );
      await saveSettingsDoc(`permissions_${showPerms.replace(/\s+/g, "_")}`, rolePerms);
      setPermsSaved(true);
      setTimeout(() => { setPermsSaved(false); setShowPerms(null); }, 800);
    } catch {
      // Keep modal open so user can retry
    } finally {
      setPermsSaving(false);
    }
  }

  function togglePerm(key: string) {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSendReset() {
    setError(null);
    setSuccess(null);
    const trimmed = email.trim();
    if (!trimmed) { setError("Please enter an email address."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) { setError("Enter a valid email address (e.g. name@gmail.com)."); return; }

    setSending(true);
    try {
      await sendPasswordResetEmail(auth, trimmed);
      setSuccess(trimmed);
      setEmail("");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/user-not-found") {
        setError("No account found with this email address.");
      } else if (code === "auth/invalid-email") {
        setError("The email address is not valid.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a moment and try again.");
      } else {
        setError("Failed to send reset email. Please try again.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Access Control</h1>
        <p className="text-gray-500 text-sm mt-1">Manage roles, permissions and user access</p>
      </div>

      {/* Role Cards */}
      <div className="grid grid-cols-3 gap-4">
        {roleCards.map((r) => (
          <div key={r.role} className={`${r.bg} border-l-4 ${r.border} rounded-2xl p-5`}>
            <p className={`font-bold text-lg ${r.text}`}>{r.role}</p>
            <p className="text-xs text-gray-500 mt-1 mb-3">{r.desc}</p>
            <p className="text-xs text-gray-400">{r.count} user{r.count !== 1 ? "s" : ""} with this role</p>
            <button
              onClick={() => setShowPerms(r.role)}
              className="mt-3 px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 w-full"
            >
              Manage Permissions
            </button>
          </div>
        ))}
      </div>

      {/* Password Reset Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
            <KeyRound size={18} className="text-[#4F3CC9]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Password Reset</h2>
            <p className="text-xs text-gray-400">Send a password reset link to any employee's email address</p>
          </div>
        </div>

        <div className="mt-5 max-w-lg space-y-3">
          {success && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700">
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Reset email sent successfully</p>
                <p className="text-xs mt-0.5">A password reset link was delivered to <span className="font-semibold">{success}</span>. Ask the employee to check their inbox (and spam folder).</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600">
              <AlertCircle size={15} className="shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                placeholder="Enter employee email address…"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); setSuccess(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleSendReset()}
                className={`pl-9 pr-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full transition-all ${
                  error ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"
                }`}
              />
            </div>
            <button
              onClick={handleSendReset}
              disabled={sending}
              className="bg-[#4F3CC9] text-white rounded-xl px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa3] disabled:opacity-60 whitespace-nowrap flex items-center gap-2 transition-colors"
            >
              {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : "Send Reset Email"}
            </button>
          </div>

          <p className="text-xs text-gray-400">
            Firebase will send a secure reset link. The employee clicks the link to set a new password. The link expires in 1 hour.
          </p>
        </div>
      </div>

      {/* Manage Permissions Modal */}
      {showPerms && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowPerms(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Permissions — {showPerms}</h2>
              <button onClick={() => setShowPerms(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {permissionModules.map(({ module, perms }) => (
                <div key={module} className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-gray-800 mb-2">{module}</p>
                  <div className="flex gap-4 flex-wrap">
                    {perms.map((p) => {
                      const key = `${showPerms}-${module}-${p}`;
                      return (
                        <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={permissions[key] !== undefined ? permissions[key] : true}
                            onChange={() => togglePerm(key)}
                            className="rounded accent-[#4F3CC9]"
                          />
                          <span className="text-xs text-gray-600">{p}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={handleSavePerms}
                disabled={permsSaving || permsSaved}
                className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa3] transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {permsSaving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> :
                 permsSaved  ? <><CheckCircle size={16} /> Saved!</> :
                 "Save Permissions"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
