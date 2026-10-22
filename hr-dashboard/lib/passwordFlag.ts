"use client";
import { doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/**
 * Shared helpers for the "passwordChanged" flag on users/{uid}.
 *
 * The flag is false the moment HR creates an employee (both single-add and bulk
 * import) so the first-login prompt knows to fire. On a successful Change
 * Password (HR Settings OR Employee Profile), we flip it to true so the prompt
 * never fires again for that user.
 *
 * For employees whose user doc pre-dates this flag, we fall back to a time-
 * tolerance check against Firebase Auth metadata (creationTime vs
 * lastSignInTime) — if the delta is < 60s, we treat it as a first sign-in.
 */

export async function markPasswordChanged(uid?: string | null): Promise<void> {
  const u = uid || auth.currentUser?.uid;
  if (!u) return;
  try {
    await setDoc(doc(db, "users", u), { passwordChanged: true }, { merge: true });
    // Clear any session-level dismissal so the prompt never shows again.
    try { sessionStorage.removeItem("firstLoginPromptDismissed"); } catch { /* ignore */ }
  } catch (err) {
    console.error("markPasswordChanged failed", err);
  }
}

/**
 * True ⇔ the signed-in user has NOT changed their temporary password yet AND
 * is on their first (or near-first) sign-in. Returns false on any uncertainty
 * so the prompt errs on the side of silence rather than nagging the user.
 */
export async function shouldPromptPasswordChange(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  // 1. users/{uid} doc authoritative when present:
  //    passwordChanged === true  → never prompt (user has set their own pw)
  //    passwordChanged === false → prompt (seeded false by HR at account create)
  //    doc exists but field absent → likely a legacy employee who was never
  //    seeded; fall through to the metadata heuristic below.
  //
  // 2. users/{uid} doc MISSING → treat as a freshly-created account the HR
  //    import didn't fully provision yet; prompt so the new hire still gets
  //    the nudge. (Writing the doc would need the user to have create perms
  //    on their own users/{uid} — rules already allow that.)
  let docExists = false;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      docExists = true;
      const data = snap.data() as Record<string, unknown>;
      if (data.passwordChanged === true) return false;
      if (data.passwordChanged === false) return true;
    }
  } catch (err) {
    console.error("shouldPromptPasswordChange: user doc read failed", err);
    return false;
  }
  if (!docExists) return true;
  // 3. Legacy employee with doc-no-field — show only on a near-first sign-in
  //    (delta < 24h) so established users aren't repeatedly nagged.
  const meta = user.metadata;
  if (meta.creationTime && meta.lastSignInTime) {
    const created = Date.parse(meta.creationTime);
    const signed  = Date.parse(meta.lastSignInTime);
    if (!isNaN(created) && !isNaN(signed) && Math.abs(signed - created) < 24 * 60 * 60 * 1000) {
      return true;
    }
  }
  return false;
}

/**
 * One-shot helper HR calls when creating an employee account so the flag is
 * initialised to false. Lookups the user doc by email because HR knows the
 * email, not the newly-created Firebase Auth UID (that would require admin SDK).
 */
export async function initPasswordChangedFlag(email: string): Promise<void> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return;
  try {
    const snap = await getDocs(query(collection(db, "users"), where("email", "==", e)));
    await Promise.all(snap.docs.map((d) =>
      setDoc(doc(db, "users", d.id), { passwordChanged: false }, { merge: true })
    ));
  } catch (err) {
    console.error("initPasswordChangedFlag failed", err);
  }
}
