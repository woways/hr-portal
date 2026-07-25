"use client";
import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/**
 * Session/back-button security guard for authenticated pages.
 *
 *  1. If there is no authenticated user, redirect to login (covers a fresh load
 *     of a protected page after logout).
 *  2. Route-level authorization: when `require="hr"`, verify the signed-in user
 *     is an HR admin before allowing the (admin) route to stay open — so an
 *     employee can't reach admin modules by editing the URL (SEC-003).
 *  3. bfcache buster: if the page is restored from the browser's back/forward
 *     cache, force a reload so the auth check re-runs against the REAL session —
 *     a frozen page would otherwise show stale, logged-in content (SEC-001).
 *  4. Pressing Back on an active session signs out and returns to login.
 */
export default function BackGuard({ loginPath = "/", require }: { loginPath?: string; require?: "hr" }) {
  useEffect(() => {
    const goLogin = () => window.location.replace(loginPath);

    // 1) Redirect whenever there is no authenticated user; 2) enforce role.
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { goLogin(); return; }
      if (require === "hr") {
        try {
          const snap = await getDoc(doc(db, "users", user.uid));
          const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
          const role = String(data.role ?? "");
          const isHR = role === "hr_admin" || role === "admin";
          const isEmployee = !!data.employeeId && !isHR;
          // Block users who are clearly employees from the HR admin area.
          if (isEmployee) { window.location.replace("/employee/dashboard"); return; }
        } catch { /* fail-open: don't lock out on a transient read error */ }
      }
    });

    // 2) Back/Forward-cache restore → reload so auth is re-validated fresh.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        if (!auth.currentUser) goLogin();
        else window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);

    // 3) Back button on an active session → sign out, then to login.
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      signOut(auth).catch(() => { /* ignore */ }).finally(goLogin);
    };
    window.addEventListener("popstate", onPop);

    return () => {
      unsub();
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPop);
    };
  }, [loginPath]);
  return null;
}
