import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export type UserRole = "admin" | "employee";

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  employeeId?: string;
  department?: string;
  createdAt: string;
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data() as UserProfile;
}

export async function createUserProfile(profile: UserProfile): Promise<void> {
  await setDoc(doc(db, "users", profile.uid), profile);
}
