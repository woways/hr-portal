"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Mail, ArrowLeft } from "lucide-react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/authService";

const FEATURES = [
  { icon: "🚀", text: "Manage employees, attendance & payroll seamlessly" },
  { icon: "📊", text: "Real-time analytics across teams and departments" },
  { icon: "🎯", text: "Goal tracking & performance management built-in" },
  { icon: "🔒", text: "Role-based portals for HR admins and employees" },
];

type View = "login" | "forgot";

export default function LoginPage() {
  // Login state
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  // Forgot password state
  const [view, setView]               = useState<View>("login");
  const [resetEmail, setResetEmail]   = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sent" | "error">("idle");
  const [resetMsg, setResetMsg]       = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);

    // Step 1: Firebase Authentication
    let uid: string;
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      uid = cred.user.uid;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Incorrect email or password. Please try again.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please wait a moment or reset your password.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setError("Incorrect email or password. Please try again.");
      }
      setLoading(false);
      return;
    }

    // Step 2: Determine destination — users doc role → employees collection → default employee
    try {
      const profile = await getUserProfile(uid);
      if (profile) {
        // Known role from users collection
        window.location.href = profile.role === "admin" ? "/dashboard" : "/employee/dashboard";
      } else {
        // No users doc (newly added employee) — check employees collection by email
        const signedInEmail = email.trim().toLowerCase();
        const empSnap = await getDocs(
          query(collection(db, "employees"), where("email", "==", signedInEmail))
        );
        if (!empSnap.empty) {
          // Self-heal: write the missing users doc so future logins skip this check
          const empData = empSnap.docs[0].data() as Record<string, unknown>;
          setDoc(doc(db, "users", uid), {
            uid,
            email: signedInEmail,
            name:       String(empData.name       ?? ""),
            role:       "employee",
            employeeId: String(empData.employeeId ?? empSnap.docs[0].id),
            department: String(empData.department ?? ""),
            createdAt:  new Date().toISOString(),
          }).catch(() => {}); // fire-and-forget, don't block navigation
          window.location.href = "/employee/dashboard";
        } else {
          // Unknown user — treat as employee
          window.location.href = "/employee/dashboard";
        }
      }
    } catch {
      // Firestore unavailable — default to employee portal
      window.location.href = "/employee/dashboard";
    }

    setLoading(false);
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setResetMsg("");
    setResetStatus("idle");
    if (!resetEmail.trim()) {
      setResetStatus("error");
      setResetMsg("Please enter your email address.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetStatus("sent");
      setResetMsg(`A password reset link has been sent to ${resetEmail.trim()}. Check your inbox (and spam folder).`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/user-not-found" || code === "auth/invalid-email") {
        setResetStatus("error");
        setResetMsg("No account found with this email address.");
      } else {
        setResetStatus("error");
        setResetMsg("Failed to send reset email. Please try again.");
      }
    } finally {
      setResetLoading(false);
    }
  }

  function openForgot() {
    setResetEmail(email); // pre-fill with whatever they typed on the login form
    setResetStatus("idle");
    setResetMsg("");
    setView("forgot");
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex w-[45%] bg-[#0D1B2A] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-[-80px] left-[-80px] w-[340px] h-[340px] rounded-full bg-[#1a2e45] opacity-60" />
        <div className="absolute bottom-[-60px] right-[-60px] w-[260px] h-[260px] rounded-full bg-[#0e2235] opacity-80" />
        <div className="absolute bottom-[120px] left-[40px] w-[140px] h-[140px] rounded-full bg-[#1a3a52] opacity-40" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <img src="/woways-logo-white.svg" alt="Woways" className="h-10 w-auto" />
          </div>
          <p className="text-gray-400 text-sm mt-1">Your People Operations Partner</p>
        </div>

        <div className="relative z-10 space-y-6">
          {FEATURES.map((f) => (
            <div key={f.text} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#1a2e45] flex items-center justify-center text-xl shrink-0">{f.icon}</div>
              <p className="text-gray-300 text-sm leading-relaxed pt-1.5">{f.text}</p>
            </div>
          ))}
        </div>

        <p className="relative z-10 text-gray-600 text-xs">© 2026 Woways · All rights reserved</p>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 bg-[#F5F3FF] flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center mb-8 justify-center">
            <img src="/woways-logo.svg" alt="Woways" className="h-9 w-auto" />
          </div>

          {/* ─── LOGIN VIEW ─── */}
          {view === "login" && (
            <>
              <h1 className="text-3xl font-bold text-gray-900 mb-1">Welcome back</h1>
              <p className="text-gray-500 text-sm mb-8">Sign in to your Woways portal</p>

              <form onSubmit={handleSignIn} className="space-y-5">
                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@woways.in"
                    autoComplete="email"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent"
                  />
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <button
                      type="button"
                      onClick={openForgot}
                      className="text-xs text-[#4F3CC9] hover:underline font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-xs">
                    {error}
                  </div>
                )}

                {/* Sign in */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Signing in…
                    </>
                  ) : "Sign in →"}
                </button>
              </form>
            </>
          )}

          {/* ─── FORGOT PASSWORD VIEW ─── */}
          {view === "forgot" && (
            <>
              <button
                onClick={() => { setView("login"); setResetStatus("idle"); }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
              >
                <ArrowLeft size={15} /> Back to sign in
              </button>

              <div className="w-12 h-12 rounded-2xl bg-[#EDE9FF] flex items-center justify-center mb-5">
                <Mail size={22} className="text-[#4F3CC9]" />
              </div>

              <h1 className="text-2xl font-bold text-gray-900 mb-1">Reset your password</h1>
              <p className="text-gray-500 text-sm mb-8">
                Enter the email address linked to your account and we&apos;ll send you a reset link.
              </p>

              {resetStatus === "sent" ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
                  <div className="text-3xl mb-3">📬</div>
                  <p className="text-green-700 text-sm font-semibold mb-1">Email sent!</p>
                  <p className="text-green-600 text-xs leading-relaxed">{resetMsg}</p>
                  <button
                    onClick={() => { setView("login"); setResetStatus("idle"); }}
                    className="mt-5 w-full bg-[#4F3CC9] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] transition-colors"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@woways.in"
                      autoFocus
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent"
                    />
                  </div>

                  {resetStatus === "error" && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-xs">
                      {resetMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {resetLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Sending…
                      </>
                    ) : "Send reset link"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
