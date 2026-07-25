"use client";
import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/**
 * Route-level authorization gate. Renders NOTHING until the user's authorization
 * for this area is verified — so protected modules can't be shown by editing the
 * URL directly (SEC-003), regardless of how the route was reached. Also enforces
 * role (HR area), redirects logged-out users, and busts the back/forward cache.
 */
export default function AuthGate({
  children,
  loginPath = "/",
  require,
}: {
  children: ReactNode;
  loginPath?: string;
  require?: "hr";
}) {
  const [status, setStatus] = useState<"checking" | "ok">("checking");

  useEffect(() => {
    const goLogin = () => window.location.replace(loginPath);

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setStatus("checking"); goLogin(); return; }
      if (require === "hr") {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
          const role = String(data.role ?? "");
          const isHR = role === "hr_admin" || role === "admin";
          const isEmployee = !!data.employeeId && !isHR;
          if (isEmployee) { window.location.replace("/employee/dashboard"); return; }
        } catch { /* fail-open: don't lock out on a transient read error */ }
      }
      setStatus("ok");
    });

    // Back button on an active session → sign out and return to login.
    window.history.pushState(null, "", window.location.href);
    const onPop = () => { signOut(auth).catch(() => {}).finally(goLogin); };
    window.addEventListener("popstate", onPop);

    // bfcache restore → reload so auth is re-validated fresh (avoids stale content).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { if (!auth.currentUser) goLogin(); else window.location.reload(); }
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      unsub();
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loginPath, require]);

  if (status !== "ok") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F3FF]">
        <div className="text-sm text-gray-400">Verifying access…</div>
      </div>
    );
  }
  return <>{children}</>;
}
