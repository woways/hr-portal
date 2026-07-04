"use client";
import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Eye, EyeOff, Mail, ArrowLeft } from "lucide-react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getDoc, getDocs, doc, collection, query, where, setDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

type View = "login" | "forgot";

function LoginContent() {
  const params   = useSearchParams();
  const reason   = params.get("reason");
  const isRemoved = reason === "account-removed";

  const [view,         setView]         = useState<View>("login");

  // Login form
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPw,       setShowPw]       = useState(false);
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  // Forgot password
  const [resetEmail,   setResetEmail]   = useState("");
  const [resetStatus,  setResetStatus]  = useState<"idle" | "sent" | "error">("idle");
  const [resetMsg,     setResetMsg]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // If already logged in, verify the account still exists before redirecting
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          if (snap.exists()) {
            // users doc found — check employee record if we have an empId
            const empId = snap.data().employeeId as string | undefined;
            if (empId) {
              const eSnap = await getDoc(doc(db, "employees", empId));
              if (!eSnap.exists()) {
                await signOut(auth);
                setAuthChecking(false);
                return;
              }
            }
            window.location.href = "/dashboard";
          } else {
            // No users doc — fall back to email lookup in employees collection
            const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email ?? "")));
            if (!emailSnap.empty) {
              // Valid employee, just missing users doc — let them through
              window.location.href = "/dashboard";
            } else {
              // No employee record either — account was deleted
              await signOut(auth);
              setAuthChecking(false);
            }
          }
        } catch {
          // Network error — still redirect; Sidebar will gate access if needed
          window.location.href = "/dashboard";
        }
      } else {
        setAuthChecking(false);
      }
    });
    return unsub;
  }, []);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      // Verify the account still exists in Firestore (HR may have deleted this employee)
      const uSnap = await getDoc(doc(db, "users", cred.user.uid));
      if (uSnap.exists()) {
        // users doc found — check employee record if we have an empId
        const empId = uSnap.data().employeeId as string | undefined;
        if (empId) {
          const eSnap = await getDoc(doc(db, "employees", empId));
          if (!eSnap.exists()) {
            await signOut(auth);
            setError("Your account has been removed. Please contact your HR administrator.");
            setLoading(false);
            return;
          }
        }
        window.location.href = "/dashboard";
      } else {
        // No users doc — fall back to email lookup in employees collection
        const signedInEmail = email.trim().toLowerCase();
        const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", signedInEmail)));
        if (!emailSnap.empty) {
          // Valid employee, just missing users doc — create it and let them through
          const empData = emailSnap.docs[0].data() as Record<string, unknown>;
          setDoc(doc(db, "users", cred.user.uid), {
            uid:        cred.user.uid,
            email:      signedInEmail,
            name:       String(empData.name       ?? ""),
            role:       "employee",
            employeeId: String(empData.employeeId ?? emailSnap.docs[0].id),
            department: String(empData.department ?? ""),
            createdAt:  new Date().toISOString(),
          }).catch(() => {});
          window.location.href = "/dashboard";
        } else {
          // No employee record either — account was deleted
          await signOut(auth);
          setError("Your account has been removed. Please contact your HR administrator.");
          setLoading(false);
          return;
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Incorrect email or password. Please try again.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please wait a moment or reset your password.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/network-request-failed") {
        setError("Network error. Please check your connection.");
      } else {
        setError(`Sign-in failed. Please try again. (${code})`);
      }
      setLoading(false);
    }
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
        url: window.location.origin + "/login",
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
        setResetMsg(`Could not send reset email. (${code || "unknown error"})`);
      }
    } finally {
      setResetLoading(false);
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F5F3FF] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#4F3CC9]/30 border-t-[#4F3CC9] rounded-full animate-spin"/>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">

      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-[#0B1929] flex-col items-center justify-center p-14 relative overflow-hidden">
        <div className="absolute top-[-100px] left-[-100px] w-[380px] h-[380px] rounded-full bg-[#0d3349] opacity-70"/>
        <div className="absolute top-[-60px] right-[-60px] w-[260px] h-[260px] rounded-full bg-[#0a2a40] opacity-80"/>
        <div className="absolute bottom-[-80px] left-[-40px] w-[240px] h-[240px] rounded-full bg-[#093040] opacity-60"/>
        <div className="relative z-10 flex flex-col items-center text-center w-full max-w-sm">
          <div className="mb-3">
            <span className="text-5xl font-black text-white tracking-tight">WO</span>
            <span className="text-5xl font-black text-[#14B8A6] tracking-tight">WAYS</span>
          </div>
          <p className="text-gray-400 text-sm mb-12">Employee Self-Service Portal</p>
          <div className="space-y-5 w-full">
            {[
              { icon: "📋", text: "View your attendance, leaves and goals" },
              { icon: "💰", text: "Access payslips and compensation details" },
              { icon: "🔔", text: "Get real-time notifications from HR" },
              { icon: "🙋", text: "Raise queries and get support" },
            ].map(f => (
              <div key={f.text} className="flex items-center gap-4 text-left">
                <div className="w-10 h-10 rounded-xl bg-[#112233] flex items-center justify-center text-xl shrink-0">{f.icon}</div>
                <p className="text-gray-300 text-sm leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="absolute bottom-6 z-10 text-gray-600 text-xs">© 2026 Woways · All rights reserved</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 bg-white flex items-center justify-center p-10">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex lg:hidden justify-center mb-8">
            <span className="text-3xl font-black text-[#0B1929] tracking-tight">WO</span>
            <span className="text-3xl font-black text-[#14B8A6] tracking-tight">WAYS</span>
          </div>

          {/* Account removed banner */}
          {isRemoved && view === "login" && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-xs font-medium mb-6">
              Your account has been removed by HR. Contact your HR administrator for more information.
            </div>
          )}

          {/* ── LOGIN VIEW ── */}
          {view === "login" && (
            <>
              <h1 className="text-3xl font-bold text-[#0B1929] mb-1">Employee Portal</h1>
              <p className="text-gray-500 text-sm mb-8">Sign in with your work email and password</p>

              <form onSubmit={handleSignIn} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@woways.in"
                    autoComplete="email"
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent pr-11"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-xs">{error}</div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa3] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                  {loading
                    ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"/> Signing in…</>
                    : "Sign in →"}
                </button>

                <div className="flex justify-end">
                  <button type="button" onClick={() => { setResetEmail(email); setResetStatus("idle"); setResetMsg(""); setView("forgot"); }}
                    className="text-sm text-[#4F3CC9] hover:underline font-medium">
                    Forgot password?
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ── FORGOT PASSWORD VIEW ── */}
          {view === "forgot" && (
            <>
              <button onClick={() => { setView("login"); setResetStatus("idle"); setResetMsg(""); }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors">
                <ArrowLeft size={15}/> Back to sign in
              </button>

              <div className="w-12 h-12 rounded-2xl bg-[#EDE9FF] flex items-center justify-center mb-5">
                <Mail size={22} className="text-[#4F3CC9]"/>
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
                    <p className="text-yellow-800 text-xs font-semibold mb-0.5">⚠️ Don&apos;t see the email?</p>
                    <ul className="text-yellow-700 text-xs space-y-0.5 list-disc list-inside">
                      <li>Check your <span className="font-medium">Spam / Junk</span> folder</li>
                      <li>The sender is <span className="font-mono">noreply@hrmanagement-6b903.firebaseapp.com</span></li>
                      <li>It may take 1–2 minutes to arrive</li>
                    </ul>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setResetStatus("idle"); setResetMsg(""); }}
                      className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                      Resend link
                    </button>
                    <button onClick={() => { setView("login"); setResetStatus("idle"); setResetMsg(""); }}
                      className="flex-1 bg-[#4F3CC9] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#3d2fa3] transition-colors">
                      Back to sign in
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email address</label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      placeholder="you@woways.in"
                      autoFocus
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent"
                    />
                  </div>

                  {resetStatus === "error" && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-xs">{resetMsg}</div>
                  )}

                  <button type="submit" disabled={resetLoading}
                    className="w-full bg-[#4F3CC9] hover:bg-[#3d2fa3] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                    {resetLoading
                      ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"/> Sending…</>
                      : "Send reset link"}
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

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F5F3FF] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#4F3CC9]/30 border-t-[#4F3CC9] rounded-full animate-spin"/>
      </div>
    }>
      <LoginContent/>
    </Suspense>
  );
}
