"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, Rocket, BarChart3, Wallet, ShieldCheck, Check } from "lucide-react";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/authService";

const FEATURES = [
  { Icon: Rocket,      text: "Embedded execution across Sales, Ops, Marketing & Tech" },
  { Icon: BarChart3,   text: "14–18 day pilots before scaling to full engagement" },
  { Icon: Wallet,      text: "Commission-based model — we win when you win" },
  { Icon: ShieldCheck, text: "Role-based portals for every stakeholder" },
];

type View = "login" | "forgot";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

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
      } else if (code === "auth/network-request-failed") {
        setError("Network error. Please check your connection and try again.");
      } else {
        setError(`Sign-in failed. Please try again. (${code})`);
      }
      setLoading(false);
      return;
    }

    try {
      const profile = await getUserProfile(uid);
      if (profile) {
        const isHR = profile.role === "admin" || profile.role === "hr_admin";
        window.location.href = isHR ? "/dashboard" : "/employee/dashboard";
      } else {
        const signedInEmail = email.trim().toLowerCase();
        const empSnap = await getDocs(
          query(collection(db, "employees"), where("email", "==", signedInEmail))
        );
        if (!empSnap.empty) {
          const empData = empSnap.docs[0].data() as Record<string, unknown>;
          setDoc(doc(db, "users", uid), {
            uid,
            email: signedInEmail,
            name:       String(empData.name       ?? ""),
            role:       "employee",
            employeeId: String(empData.employeeId ?? empSnap.docs[0].id),
            department: String(empData.department ?? ""),
            createdAt:  new Date().toISOString(),
          }).catch(() => {});
          window.location.href = "/employee/dashboard";
        } else {
          // No user profile and no employee record — account has been deleted
          await signOut(auth);
          setError("Your account has been removed. Please contact your HR administrator.");
          setLoading(false);
          return;
        }
      }
    } catch {
      window.location.href = "/employee/dashboard";
    }

    setLoading(false);
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setResetMsg("");
    setResetStatus("idle");
    const trimmed = resetEmail.trim();
    if (!trimmed) {
      setResetStatus("error");
      setResetMsg("Please enter your email address.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmed, {
        url: window.location.origin + "/",
        handleCodeInApp: false,
      });
      setResetStatus("sent");
      setResetMsg(trimmed);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
        setResetStatus("error");
        setResetMsg("No account found with that email address. Please check and try again.");
      } else if (code === "auth/invalid-email") {
        setResetStatus("error");
        setResetMsg("Please enter a valid email address.");
      } else if (code === "auth/too-many-requests") {
        setResetStatus("error");
        setResetMsg("Too many reset attempts. Please wait a few minutes and try again.");
      } else if (code === "auth/network-request-failed") {
        setResetStatus("error");
        setResetMsg("Network error. Please check your connection and try again.");
      } else {
        setResetStatus("error");
        setResetMsg(`Could not send reset email. (${code || "unknown error"}) — please try again or contact support.`);
      }
    } finally {
      setResetLoading(false);
    }
  }

  function openForgot() {
    setResetEmail(email);
    setResetStatus("idle");
    setResetMsg("");
    setView("forgot");
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel ── */}
      <div className="hidden lg:flex w-1/2 flex-col items-center justify-center p-14 relative overflow-hidden bg-gradient-to-br from-[#0A1622] via-[#0B1E2E] to-[#0C2A38]">
        {/* Decorative glows */}
        <div className="absolute top-[-120px] left-[-120px] w-[420px] h-[420px] rounded-full bg-[#0e3a4d] opacity-60 blur-[10px]" />
        <div className="absolute top-[-60px] right-[-80px] w-[280px] h-[280px] rounded-full bg-[#0a2a40] opacity-70 blur-[8px]" />
        <div className="absolute bottom-[-100px] left-[-40px] w-[300px] h-[300px] rounded-full bg-[#093040] opacity-50 blur-[10px]" />
        <div className="absolute bottom-[10%] right-[-60px] w-[220px] h-[220px] rounded-full bg-[#14B8A6] opacity-[0.06] blur-[20px]" />

        {/* Centered content */}
        <div className="relative z-10 flex flex-col items-center text-center w-full max-w-md">
          {/* Logo mark + wordmark */}
          <div className="flex items-center gap-3 mb-4">
            <svg width="76" height="48" viewBox="0 0 54 34" fill="none" className="shrink-0" style={{ filter: "drop-shadow(0 3px 9px rgba(0,194,168,0.4))" }}>
              <path d="M2 13 L11 30 L26 4" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M28 13 L37 30 L52 4" stroke="#00C2A8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-5xl font-black leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px", textShadow: "0 2px 10px rgba(0,0,0,0.45)" }}>
              <span className="text-white">WO</span>
              <span style={{ color: "#00C2A8" }}>WAYS</span>
            </div>
          </div>

          {/* Divider label */}
          <div className="flex items-center gap-3 w-full max-w-sm mb-14">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#14B8A6]/40" />
            <span className="text-[13px] font-semibold tracking-[0.28em] text-gray-400 uppercase whitespace-nowrap">
              Additional Execution Partner
            </span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#14B8A6]/40" />
          </div>

          {/* Features */}
          <div className="space-y-5 w-full max-w-md">
            {FEATURES.map(({ Icon, text }) => (
              <div key={text} className="flex items-center gap-4 text-left">
                <div className="w-12 h-12 rounded-xl bg-[#14B8A6]/10 border border-[#14B8A6]/20 flex items-center justify-center shrink-0">
                  <Icon size={22} className="text-[#2DD4BF]" />
                </div>
                <p className="text-gray-300 text-base font-normal leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 bg-white flex items-center justify-center pl-10 pr-28 py-10" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-2 mb-8">
            <svg width="58" height="36" viewBox="0 0 54 34" fill="none" className="shrink-0" style={{ filter: "drop-shadow(0 2px 6px rgba(0,194,168,0.35))" }}>
              <path d="M2 13 L11 30 L26 4" stroke="#0A2540" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M28 13 L37 30 L52 4" stroke="#00C2A8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="text-3xl font-black leading-none" style={{ fontFamily: "var(--font-inter), 'Inter', sans-serif", letterSpacing: "-0.6px" }}>
              <span style={{ color: "#0A2540" }}>WO</span>
              <span style={{ color: "#00C2A8" }}>WAYS</span>
            </div>
          </div>

          {/* ─── LOGIN VIEW ─── */}
          {view === "login" && (
            <>
              <p className="text-[#14B8A6] text-sm font-bold tracking-[0.28em] uppercase mb-3">Welcome</p>
              <h1 className="text-4xl font-bold text-[#0B1929] mb-2">Sign in to Woways</h1>
              <p className="text-gray-500 text-[15px] mb-8">Your execution portal, right where you left off.</p>

              <form onSubmit={handleSignIn} className="space-y-5">
                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 bg-gray-50/60 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:border-transparent focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="w-full pl-11 pr-11 py-3 rounded-xl border border-gray-200 bg-gray-50/60 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:border-transparent focus:bg-white transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Remember me + Forgot password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                        remember ? "bg-[#14B8A6] border-2 border-[#14B8A6]" : "bg-white border-2 border-gray-300"
                      }`}
                    >
                      {remember && <Check size={13} strokeWidth={3} className="text-white" />}
                    </span>
                    <span className="text-sm text-gray-600">Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={openForgot}
                    className="text-sm text-[#0EA5A4] hover:underline font-semibold"
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Error */}
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-xs">
                    {error}
                  </div>
                )}

                {/* Sign in button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#14B8A6] to-[#2563EB] hover:from-[#0EA5A4] hover:to-[#1d4ed8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#14B8A6]/25 hover:shadow-[#14B8A6]/40"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>Sign in <ArrowRight size={16} /></>
                  )}
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

              <div className="w-12 h-12 rounded-2xl bg-[#14B8A6]/10 flex items-center justify-center mb-5">
                <Mail size={22} className="text-[#14B8A6]" />
              </div>

              <h1 className="text-2xl font-bold text-[#0B1929] mb-1">Reset your password</h1>
              <p className="text-gray-500 text-sm mb-8">
                Enter the email address linked to your account and we&apos;ll send you a reset link.
              </p>

              {resetStatus === "sent" ? (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl leading-none">📬</span>
                      <div>
                        <p className="text-green-800 text-sm font-semibold mb-1">Reset link sent!</p>
                        <p className="text-green-700 text-xs leading-relaxed">
                          We&apos;ve sent a password reset link to <span className="font-semibold">{resetMsg}</span>.
                          Open that email and click the link to set a new password.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                    <p className="text-yellow-800 text-xs font-semibold mb-0.5">⚠️ Don't see the email?</p>
                    <ul className="text-yellow-700 text-xs space-y-0.5 list-disc list-inside">
                      <li>Check your <span className="font-medium">Spam / Junk</span> folder</li>
                      <li>The sender is <span className="font-mono">noreply@hrmanagement-6b903.firebaseapp.com</span></li>
                      <li>It may take 1–2 minutes to arrive</li>
                    </ul>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setResetStatus("idle"); setResetMsg(""); }}
                      className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      Resend link
                    </button>
                    <button
                      onClick={() => { setView("login"); setResetStatus("idle"); setResetMsg(""); }}
                      className="flex-1 bg-gradient-to-r from-[#14B8A6] to-[#2563EB] text-white py-2.5 rounded-lg text-sm font-semibold hover:from-[#0EA5A4] hover:to-[#1d4ed8] transition-all"
                    >
                      Back to sign in
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Email address
                    </label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@woways.in"
                      autoFocus
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:border-transparent"
                    />
                  </div>

                  {resetStatus === "error" && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-xs">
                      {resetMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full bg-gradient-to-r from-[#14B8A6] to-[#2563EB] hover:from-[#0EA5A4] hover:to-[#1d4ed8] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-all flex items-center justify-center gap-2"
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
