import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

// Single source of truth for the next Employee ID, used by BOTH the Add-Employee
// form and the Onboarding form so they never show different IDs. The next ID is
// max(existing index) + 1 across BOTH real employees AND in-progress onboarding
// rows (whose IDs are already reserved), zero-padded to EMP###.
export async function computeNextEmployeeId(extraReserved: string[] = []): Promise<string> {
  const nums: number[] = [];
  const add = (raw: unknown) => {
    const n = parseInt(String(raw ?? "").replace(/\D/g, ""), 10);
    if (!isNaN(n)) nums.push(n);
  };
  extraReserved.forEach(add);
  try {
    const [emps, onb] = await Promise.all([
      getDocs(collection(db, "employees")),
      getDocs(collection(db, "onboarding")),
    ]);
    emps.docs.forEach((d) => add((d.data() as Record<string, unknown>).employeeId ?? d.id));
    onb.docs.forEach((d) => add((d.data() as Record<string, unknown>).empId));
  } catch { /* network issue — fall back to whatever we have */ }
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `EMP${String(next).padStart(3, "0")}`;
}
