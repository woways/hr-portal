"use client";
import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { createUserProfile, UserProfile } from "@/lib/authService";
import { CheckCircle, AlertCircle, Eye, EyeOff, ArrowRight } from "lucide-react";

interface AccountConfig {
  email: string;
  password: string;
  name: string;
  role: "admin" | "employee";
  employeeId: string;
  department: string;
}

const DEFAULTS: AccountConfig[] = [
  {
    email: "hradmin@woways.in",
    password: "Woways@123",
    name: "HR Administrator",
    role: "admin",
    employeeId: "HR001",
    department: "Human Resources",
  },
];

interface Result {
  label: string;
  email: string;
  status: "success" | "error";
  message: string;
}

export default function SetupPage() {
  const [accounts, setAccounts] = useState<AccountConfig[]>(DEFAULTS);
  const [showPw, setShowPw] = useState([false, false]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);

  function update(idx: number, field: keyof AccountConfig, value: string) {
    setAccounts((prev) => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }

  async function handleCreate() {
    setLoading(true);
    setResults([]);
    const out: Result[] = [];

    for (const acc of accounts) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, acc.email.trim(), acc.password);
        const profile: UserProfile = {
          uid: cred.user.uid,
          email: acc.email.trim(),
          name: acc.name.trim(),
          role: acc.role,
          employeeId: acc.employeeId.trim(),
          department: acc.department.trim(),
          createdAt: new Date().toISOString(),
        };
        await createUserProfile(profile);
        out.push({
          label: "HR Admin",
          email: acc.email.trim(),
          status: "success",
          message: "Account created & stored in Firebase",
        });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code ?? "";
        const msg =
          code === "auth/email-already-in-use"
            ? "Account already exists — go to the login page and sign in directly."
            : code === "auth/weak-password"
            ? "Password must be at least 6 characters"
            : code === "auth/invalid-email"
            ? "Invalid email address"
            : code === "auth/network-request-failed"
            ? "Network error — please check your connection and try again"
            : code === "auth/operation-not-allowed"
            ? "Email/password sign-in not enabled in Firebase Console"
            : `Error: ${(err as { message?: string }).message ?? code}`;
        out.push({ label: "HR Admin", email: acc.email.trim(), status: "error", message: msg });
      }
    }

    setResults(out);
    setLoading(false);
    if (out.every((r) => r.status === "success")) setDone(true);
  }

  return (
    <div className="min-h-screen bg-[#F5F3FF] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img src="/woways-logo.svg" alt="Woways" className="h-10 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create Firebase Accounts</h1>
          <p className="text-gray-500 text-sm mt-1">
            One-time setup — creates HR Admin account in Firebase Auth + Firestore
          </p>
        </div>

        {!done ? (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">HR Admin</span>
                <span className="text-xs text-gray-400">Firebase Authentication + Firestore</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                  <input value={accounts[0].name} onChange={(e) => update(0, "name", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Employee ID</label>
                  <input value={accounts[0].employeeId} onChange={(e) => update(0, "employeeId", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
                  <input type="email" value={accounts[0].email} onChange={(e) => update(0, "email", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                  <input value={accounts[0].department} onChange={(e) => update(0, "department", e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                  <div className="relative">
                    <input type={showPw[0] ? "text" : "password"} value={accounts[0].password}
                      onChange={(e) => update(0, "password", e.target.value)}
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] font-mono" />
                    <button type="button" onClick={() => setShowPw((p) => [!p[0], p[1]])}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw[0] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              {results[0] && (
                <div className={`mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs ${results[0].status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {results[0].status === "success" ? <CheckCircle size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                  {results[0].message}
                </div>
              )}
            </div>

            <button onClick={handleCreate} disabled={loading}
              className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              {loading ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Creating account…</>) : "Create HR Admin Account in Firebase"}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={30} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Account ready!</h2>
            <p className="text-gray-500 text-sm mb-6">HR Admin account is live in Firebase.</p>
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-left mb-6">
              <p className="text-sm font-semibold text-gray-800">{accounts[0].name}</p>
              <p className="text-xs text-gray-500 mt-1">Email: <span className="font-mono text-gray-700">{accounts[0].email}</span></p>
              <p className="text-xs text-gray-500">Password: <span className="font-mono text-gray-700">{accounts[0].password}</span></p>
            </div>
            <button onClick={() => { window.location.href = "/"; }}
              className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
              Go to Sign In <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
