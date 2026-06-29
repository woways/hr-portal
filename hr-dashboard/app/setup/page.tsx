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
    password: "Woways@2026",
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
          label: acc.role === "admin" ? "HR Admin" : "Employee",
          email: acc.email.trim(),
          status: "success",
          message: "Account created & stored in Firebase",
        });
      } catch (err: unknown) {
        const code = (err as { code?: string }).code ?? "";
        const msg =
          code === "auth/email-already-in-use"
            ? "Email already registered in Firebase — account already exists"
            : code === "auth/weak-password"
            ? "Password must be at least 6 characters"
            : code === "auth/invalid-email"
            ? "Invalid email address"
            : "Failed to create account";
        out.push({
          label: acc.role === "admin" ? "HR Admin" : "Employee",
          email: acc.email.trim(),
          status: "error",
          message: msg,
        });
      }
    }

    setResults(out);
    setLoading(false);
    if (out.every((r) => r.status === "success" || r.message.includes("already exists"))) {
      setDone(true);
    }
  }

  const ROLE_LABELS = ["HR Admin"];
  const ROLE_COLORS = ["bg-purple-100 text-purple-700"];

  return (
    <div className="min-h-screen bg-[#F5F3FF] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img src="/woways-logo.svg" alt="Woways" className="h-10 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create Firebase Accounts</h1>
          <p className="text-gray-500 text-sm mt-1">
            One-time setup — creates HR Admin and Employee accounts in Firebase Auth + Firestore
          </p>
        </div>

        {!done ? (
          <div className="space-y-5">
            {accounts.map((acc, idx) => (
              <div key={idx} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${ROLE_COLORS[idx]}`}>
                    {ROLE_LABELS[idx]}
                  </span>
                  <span className="text-xs text-gray-400">Firebase Authentication + Firestore</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                    <input
                      value={acc.name}
                      onChange={(e) => update(idx, "name", e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Employee ID</label>
                    <input
                      value={acc.employeeId}
                      onChange={(e) => update(idx, "employeeId", e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Email Address</label>
                    <input
                      type="email"
                      value={acc.email}
                      onChange={(e) => update(idx, "email", e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                    <input
                      value={acc.department}
                      onChange={(e) => update(idx, "department", e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPw[idx] ? "text" : "password"}
                        value={acc.password}
                        onChange={(e) => update(idx, "password", e.target.value)}
                        className="w-full px-3 py-2.5 pr-10 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((prev) => prev.map((v, i) => i === idx ? !v : v))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPw[idx] ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Result badge for this account */}
                {results.find((r) => r.email === acc.email) && (() => {
                  const r = results.find((r) => r.email === acc.email)!;
                  return (
                    <div className={`mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs ${r.status === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {r.status === "success"
                        ? <CheckCircle size={14} className="shrink-0 mt-0.5" />
                        : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                      {r.message}
                    </div>
                  );
                })()}
              </div>
            ))}

            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Creating account in Firebase…
                </>
              ) : "Create HR Admin Account in Firebase"}
            </button>
          </div>
        ) : (
          /* ── Success state ── */
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={30} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Accounts ready!</h2>
            <p className="text-gray-500 text-sm mb-6">The HR Admin account is now live in Firebase Auth and stored in Firestore.</p>

            <div className="space-y-3 text-left mb-8">
              {accounts.map((acc, idx) => (
                <div key={idx} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[idx]}`}>
                      {ROLE_LABELS[idx]}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-800">{acc.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Email: <span className="font-mono text-gray-700">{acc.email}</span></p>
                  <p className="text-xs text-gray-500">Password: <span className="font-mono text-gray-700">{acc.password}</span></p>
                </div>
              ))}
            </div>

            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6">
              ⚠️ Save these credentials somewhere safe. Delete or protect this setup page before going to production.
            </p>

            <button
              onClick={() => { window.location.href = "/"; }}
              className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              Go to Sign In <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
