"use client";
import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Session/back-button security guard for authenticated pages.
 *
 *  1. If there is no authenticated user, redirect to login (covers a fresh load
 *     of a protected page after logout).
 *  2. bfcache buster: if the page is restored from the browser's back/forward
 *     cache, force a reload so the auth check re-runs against the REAL session —
 *     a frozen page would otherwise show stale, logged-in content (SEC-001).
 *  3. Pressing Back on an active session signs out and returns to login.
 */
export default function BackGuard({ loginPath = "/login" }: { loginPath?: string }) {
  useEffect(() => {
    const goLogin = () => window.location.replace(loginPath);

    // 1) Redirect whenever there is no authenticated user.
    const unsub = onAuthStateChanged(auth, (user) => { if (!user) goLogin(); });

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
