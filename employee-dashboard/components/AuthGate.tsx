"use client";
import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Route-level authorization gate. Renders NOTHING until the user is verified as
 * authenticated — so protected modules can't be shown by editing the URL directly
 * (SEC-003), regardless of how the route was reached. Also redirects logged-out
 * users and busts the browser back/forward cache.
 */
export default function AuthGate({
  children,
  loginPath = "/login",
}: {
  children: ReactNode;
  loginPath?: string;
}) {
  const [status, setStatus] = useState<"checking" | "ok">("checking");

  useEffect(() => {
    const goLogin = () => window.location.replace(loginPath);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) { setStatus("checking"); goLogin(); return; }
      setStatus("ok");
    });

    window.history.pushState(null, "", window.location.href);
    const onPop = () => { signOut(auth).catch(() => {}).finally(goLogin); };
    window.addEventListener("popstate", onPop);

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { if (!auth.currentUser) goLogin(); else window.location.reload(); }
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      unsub();
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loginPath]);

  if (status !== "ok") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F3FF]">
        <div className="text-sm text-gray-400">Verifying access…</div>
      </div>
    );
  }
  return <>{children}</>;
}
