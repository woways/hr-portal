"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Mail, Lock, ArrowRight, ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/authService";

const FEATURES: { icon: React.ReactNode; text: string }[] = [
  {
    icon: (
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c2.3 2.4 3.6 5.6 3.6 8.6 0 1.3-.3 2.6-.9 3.9H9.3c-.6-1.3-.9-2.6-.9-3.9C8.4 8.6 9.7 5.4 12 3Z" /><path d="M8.7 13.7 6.3 15.9v2.7l2.9-1.4" /><path d="m15.3 13.7 2.4 2.2v2.7l-2.9-1.4" /><circle cx="12" cy="9.6" r="1.5" /><path d="M10.4 18.5c.4 1 1.6 2.5 1.6 2.5s1.2-1.5 1.6-2.5" /></svg>
    ),
    text: "Embedded execution across Sales, Ops, Marketing & Tech",
  },
  {
    icon: (
      <svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="13" width="4.3" height="7" rx="1.3" fill="#6fe6da" /><rect x="9.85" y="8.5" width="4.3" height="11.5" rx="1.3" fill="#2fd6c9" /><rect x="15.7" y="5" width="4.3" height="15" rx="1.3" fill="#17a2a6" /></svg>
    ),
    text: "14–18 day pilots before scaling to full engagement",
  },
  {
    icon: (
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" /></svg>
    ),
    text: "Commission-based model — we win when you win",
  },
  {
    icon: (
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.6" y="10.4" width="14.8" height="10.6" rx="2.6" /><path d="M7.9 10.4V7.6a4.1 4.1 0 0 1 8.2 0v2.8" /><circle cx="12" cy="15" r="1.5" /><path d="M12 16.5v2" /></svg>
    ),
    text: "Role-based portals for every stakeholder",
  },
];

type View = "login" | "forgot";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState<View>("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sent" | "error">("idle");
  const [resetMsg, setResetMsg] = useState("");
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
            name: String(empData.name ?? ""),
            role: "employee",
            employeeId: String(empData.employeeId ?? empSnap.docs[0].id),
            department: String(empData.department ?? ""),
            createdAt: new Date().toISOString(),
          }).catch(() => {});
          window.location.href = "/employee/dashboard";
        } else {
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

  const emailInvalid = !!error;
  const passwordInvalid = !!error;

  return (
    <>
      <style jsx global>{`
        @keyframes wowRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes wowShimmer { 0% { left: -60%; } 100% { left: 130%; } }
        .wow-rise { animation: wowRise .8s .05s both; }
        .wow-rise-1 { animation: wowRise .7s .28s both; }
        .wow-rise-2 { animation: wowRise .7s .38s both; }
        .wow-rise-3 { animation: wowRise .7s .48s both; }
        .wow-rise-4 { animation: wowRise .7s .58s both; }
        .wow-btn { position: relative; overflow: hidden; }
        .wow-btn::after { content: ""; position: absolute; top: 0; left: -60%; width: 40%; height: 100%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent); transition: left .5s; }
        .wow-btn:hover::after { animation: wowShimmer .55s forwards; }
        @media (prefers-reduced-motion: reduce) { .wow-rise, .wow-rise-1, .wow-rise-2, .wow-rise-3, .wow-rise-4 { animation: none !important; } .wow-btn::after { display: none; } }
      `}</style>

      <main
        className="min-h-screen flex bg-white text-[#0d1b33]"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" }}
      >
        {/* ── Left stage panel ── */}
        <aside className="relative hidden lg:flex w-1/2 overflow-hidden items-center justify-center p-14 bg-[#0B1929]" aria-hidden="true">
          <div className="pointer-events-none absolute rounded-full" style={{ width: 620, height: 620, top: "-15%", right: "-12%", background: "rgba(255,255,255,0.038)" }} />
          <div className="pointer-events-none absolute rounded-full" style={{ width: 540, height: 540, bottom: "-18%", left: "-14%", background: "rgba(0,194,168,0.07)" }} />
          <div className="pointer-events-none absolute rounded-full" style={{ width: 440, height: 440, top: "54%", left: "44%", transform: "translate(-50%,-50%)", background: "rgba(0,194,168,0.035)" }} />

          <div className="relative z-10 w-full max-w-[470px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/woways-logo.png"
              alt=""
              className="wow-rise block mx-auto h-auto"
              style={{ width: 340, maxWidth: "82%", filter: "drop-shadow(0 6px 24px rgba(23,162,166,.5))" }}
            />

            <div className="wow-rise flex items-center gap-4 mt-5 text-white/55 text-[11px] font-semibold tracking-[4px]" style={{ animationDelay: "0.15s" }}>
              <span className="flex-1 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(23,162,166,.7))" }} />
              <span>ADDITIONAL EXECUTION PARTNER</span>
              <span className="flex-1 h-px" style={{ background: "linear-gradient(90deg,rgba(23,162,166,.7),transparent)" }} />
            </div>

            <div className="mt-[52px] mx-auto flex flex-col gap-5 max-w-[530px]">
              {FEATURES.map(({ icon, text }, i) => (
                <div key={text} className={`flex items-center gap-[18px] wow-rise-${i + 1}`}>
                  <div
                    className="flex items-center justify-center shrink-0 text-[#35e0d0]"
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 17,
                      background: "linear-gradient(150deg,rgba(32,58,84,.55),rgba(11,25,41,.65))",
                      border: "1px solid rgba(45,214,201,.3)",
                      boxShadow: "0 6px 18px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06), 0 0 22px rgba(23,162,166,.14)",
                    }}
                  >
                    <span style={{ filter: "drop-shadow(0 0 6px rgba(53,224,208,.6))" }}>{icon}</span>
                  </div>
                  <p className="text-white/85 text-[14px] font-medium leading-[1.42]">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Right form panel ── */}
        <section className="flex-1 flex items-center justify-center px-6 py-10 lg:pl-[52px] lg:pr-[124px]" aria-labelledby="login-heading">
          <div className="w-full max-w-[388px] wow-rise" style={{ animationDelay: "0.1s" }}>
            {/* Mobile brand block */}
            <div
              className="flex lg:hidden justify-center mx-auto mb-6 py-4 px-5 rounded-2xl"
              style={{
                background: "radial-gradient(120% 130% at 50% 25%, #12304a, #0a1b2c)",
                boxShadow: "0 8px 22px rgba(8,18,34,.35)",
                border: "1px solid rgba(45,214,201,.16)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/woways-logo.png"
                alt="WOWAYS"
                style={{ width: 240, maxWidth: "82%", height: "auto", filter: "drop-shadow(0 4px 14px rgba(23,162,166,.4))" }}
              />
            </div>

            {view === "login" && (
              <>
                <p className="text-[20px] font-extrabold uppercase text-[#17a2a6]" style={{ letterSpacing: "3px" }}>
                  Welcome
                </p>
                <h1 id="login-heading" className="mt-2 text-[33px] font-extrabold text-[#0d1b33]" style={{ letterSpacing: "-0.6px" }}>
                  Sign in to Woways
                </h1>
                <p className="mt-2 text-[14.5px] text-[#6b7a99]">Your execution portal, right where you left off.</p>

                <form onSubmit={handleSignIn} className="mt-2" noValidate>
                  {/* Email */}
                  <label htmlFor="email" className="block mt-[22px] mb-2 text-[12.5px] font-semibold text-[#33415c]">
                    Email address
                  </label>
                  <div className="relative flex items-center rounded-xl bg-[#f8fbff] border-[1.5px] border-[#e7eef8] transition focus-within:border-[#0B7377] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(11,115,119,0.18)]">
                    <span className="absolute left-[15px] text-[#93a2bd] pointer-events-none" aria-hidden="true">
                      <Mail size={18} />
                    </span>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      aria-invalid={emailInvalid || undefined}
                      aria-describedby={error ? "login-error" : undefined}
                      className="flex-1 border-0 bg-transparent outline-none py-3.5 pl-[46px] pr-4 text-[14.5px] text-[#0d1b33]"
                    />
                  </div>

                  {/* Password */}
                  <label htmlFor="password" className="block mt-[22px] mb-2 text-[12.5px] font-semibold text-[#33415c]">
                    Password
                  </label>
                  <div className="relative flex items-center rounded-xl bg-[#f8fbff] border-[1.5px] border-[#e7eef8] transition focus-within:border-[#0B7377] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(11,115,119,0.18)]">
                    <span className="absolute left-[15px] text-[#93a2bd] pointer-events-none" aria-hidden="true">
                      <Lock size={18} />
                    </span>
                    <input
                      id="password"
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      aria-invalid={passwordInvalid || undefined}
                      aria-describedby={error ? "login-error" : undefined}
                      className="flex-1 border-0 bg-transparent outline-none py-3.5 pl-[46px] pr-11 text-[14.5px] text-[#0d1b33]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      aria-pressed={showPw}
                      className="absolute right-3 p-1 rounded-md text-[#93a2bd] hover:text-[#0B7377] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B7377]"
                    >
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  {/* Remember + Forgot */}
                  <div className="flex items-center justify-between mt-4">
                    <label className="flex items-center gap-[9px] cursor-pointer select-none text-[13.5px] text-[#33415c]">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-[#0B7377] ${
                          remember ? "bg-[#0B7377] text-white" : "bg-white border-2 border-gray-400 text-transparent"
                        }`}
                        style={{ width: 19, height: 19, borderRadius: 6 }}
                      >
                        {remember && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span>Remember me</span>
                    </label>
                    <button
                      type="button"
                      onClick={openForgot}
                      className="text-[13px] font-semibold text-[#1e6fcc] hover:underline focus:outline-none focus-visible:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  {error && (
                    <div
                      id="login-error"
                      role="alert"
                      aria-live="assertive"
                      className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-xs"
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="wow-btn w-full mt-[26px] rounded-xl py-4 text-[15px] font-bold text-white flex items-center justify-center gap-2.5 transition disabled:opacity-60 disabled:cursor-not-allowed hover:-translate-y-[1px] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0B7377]"
                    style={{
                      background: "linear-gradient(135deg,#1e6fcc 0%,#3b8ee8 100%)",
                      boxShadow: "0 12px 26px rgba(30,111,204,.38)",
                      letterSpacing: "0.2px",
                    }}
                  >
                    {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        <span>Signing in…</span>
                      </>
                    ) : (
                      <>Sign in <ArrowRight size={16} aria-hidden="true" /></>
                    )}
                  </button>

                  <p className="mt-5 flex items-center justify-center gap-[7px] text-[#6b7a99] text-xs">
                    <ShieldCheck size={14} aria-hidden="true" /> SSL secure connection
                  </p>
                </form>
              </>
            )}

            {view === "forgot" && (
              <>
                <button
                  type="button"
                  onClick={() => { setView("login"); setResetStatus("idle"); }}
                  className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-6 transition-colors focus:outline-none focus-visible:underline"
                >
                  <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
                </button>

                <div className="w-12 h-12 rounded-2xl bg-[#0B7377]/10 flex items-center justify-center mb-5" aria-hidden="true">
                  <Mail size={22} className="text-[#0B7377]" />
                </div>

                <h1 id="login-heading" className="text-2xl font-bold text-[#0d1b33] mb-1">Reset your password</h1>
                <p className="text-gray-600 text-sm mb-8">
                  Enter the email address linked to your account and we&apos;ll send you a reset link.
                </p>

                {resetStatus === "sent" ? (
                  <div className="space-y-4" role="status" aria-live="polite">
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
                      <p className="text-green-800 text-sm font-semibold mb-1">Reset link sent</p>
                      <p className="text-green-700 text-xs leading-relaxed">
                        We&apos;ve sent a password reset link to <span className="font-semibold">{resetMsg}</span>. Open that email and click the link to set a new password.
                      </p>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                      <p className="text-yellow-800 text-xs font-semibold mb-0.5">Don&apos;t see the email?</p>
                      <ul className="text-yellow-800 text-xs space-y-0.5 list-disc list-inside">
                        <li>Check your <span className="font-medium">Spam / Junk</span> folder</li>
                        <li>The sender is <span className="font-mono">noreply@hrmanagement-6b903.firebaseapp.com</span></li>
                        <li>It may take 1–2 minutes to arrive</li>
                      </ul>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setResetStatus("idle"); setResetMsg(""); }}
                        className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B7377]"
                      >
                        Resend link
                      </button>
                      <button
                        type="button"
                        onClick={() => { setView("login"); setResetStatus("idle"); setResetMsg(""); }}
                        className="flex-1 text-white py-2.5 rounded-lg text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0B7377]"
                        style={{ background: "linear-gradient(135deg,#1e6fcc 0%,#3b8ee8 100%)" }}
                      >
                        Back to sign in
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-5" noValidate>
                    <div>
                      <label htmlFor="resetEmail" className="block text-sm font-semibold text-gray-800 mb-1.5">
                        Email address
                      </label>
                      <input
                        id="resetEmail"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="you@woways.in"
                        autoFocus
                        autoComplete="email"
                        aria-invalid={resetStatus === "error" || undefined}
                        aria-describedby={resetStatus === "error" ? "reset-error" : undefined}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7377] focus:border-transparent"
                      />
                    </div>

                    {resetStatus === "error" && (
                      <div id="reset-error" role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-xs">
                        {resetMsg}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="wow-btn w-full text-white font-semibold py-3 rounded-lg text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0B7377]"
                      style={{
                        background: "linear-gradient(135deg,#1e6fcc 0%,#3b8ee8 100%)",
                        boxShadow: "0 8px 20px rgba(30,111,204,.35)",
                      }}
                    >
                      {resetLoading ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                          <span>Sending…</span>
                        </>
                      ) : "Send reset link"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
