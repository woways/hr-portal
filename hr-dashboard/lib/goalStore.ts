export type GoalStatus = "Not Started" | "In Progress" | "Completed";

export interface Goal {
  id: string;
  name: string;
  assignedTo: string;
  empId: string;
  department: string;
  kpi: string;
  deadline: string;
  progress: number;
  status: GoalStatus;
  description: string;
  notes: string;
  feedback: string;
  assignedOn: string;
  lastUpdated?: string;
}

const store: Goal[] = [];

export function getAll(): Goal[] { return store; }

export function getByEmpId(empId: string): Goal[] {
  return store.filter((g) => g.empId === empId);
}

export function upsert(goal: Goal): void {
  const idx = store.findIndex((g) => g.id === goal.id);
  if (idx !== -1) store[idx] = goal;
  else store.push(goal);
}

export function patch(id: string, update: Partial<Goal>): boolean {
  const idx = store.findIndex((g) => g.id === id);
  if (idx === -1) return false;
  store[idx] = { ...store[idx], ...update };
  return true;
}

export function nextId(): string {
  const nums = store.map((g) => parseInt(g.id.replace("G", ""), 10)).filter((n) => !isNaN(n));
  return `G${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
}
