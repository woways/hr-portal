import { NextRequest, NextResponse } from "next/server";
import { getGoals, upsertGoal } from "@/lib/firebaseService";
import { create } from "@/lib/notificationStore";

export type GoalStatus = "Not Started" | "In Progress" | "Completed";
export interface Goal {
  id: string; name: string; assignedTo: string; empId: string;
  department: string; kpi: string; deadline: string; progress: number;
  status: GoalStatus; description: string; notes: string; feedback: string;
  assignedOn: string; lastUpdated?: string;
}

function toGoal(d: Record<string, unknown>): Goal {
  return {
    id:          d.id as string,
    name:        d.name as string,
    assignedTo:  (d.assignedTo as string) ?? "",
    empId:       (d.empId as string) ?? "",
    department:  (d.department as string) ?? "",
    kpi:         (d.kpi as string) ?? "",
    deadline:    (d.deadline as string) ?? "",
    progress:    (d.progress as number) ?? 0,
    status:      (d.status as GoalStatus) ?? "Not Started",
    description: (d.description as string) ?? "",
    notes:       (d.notes as string) ?? "",
    feedback:    (d.feedback as string) ?? "",
    assignedOn:  (d.assignedOn as string) ?? "",
    lastUpdated: d.updatedAt as string | undefined,
  };
}

export async function GET(req: NextRequest) {
  const empId = req.nextUrl.searchParams.get("empId");
  const docs = await getGoals(empId ?? undefined);
  return NextResponse.json(docs.map(d => toGoal(d as Record<string, unknown>)));
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Goal>;
  const allGoals = await getGoals();
  const nums = allGoals
    .map((d) => parseInt((d.id as string).replace("G", ""), 10))
    .filter((n) => !isNaN(n));
  const id = `G${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
  const today = new Date().toISOString().slice(0, 10);

  const data = {
    name:        body.name ?? "",
    assignedTo:  body.assignedTo ?? "",
    empId:       body.empId ?? "",
    department:  body.department ?? "",
    kpi:         body.kpi ?? "",
    deadline:    body.deadline ?? "",
    progress:    0,
    status:      "Not Started",
    description: body.description ?? "",
    notes:       "",
    feedback:    "",
    assignedOn:  today,
  };
  await upsertGoal(id, data);

  if (body.empId) {
    await create({
      userId: body.empId,
      type: "goal",
      title: `New Goal Assigned — ${body.name}`,
      message: `HR has assigned you a new goal: "${body.name}". KPI: ${body.kpi}. Deadline: ${body.deadline}.`,
    });
  }
  return NextResponse.json(toGoal({ id, ...data }), { status: 201 });
}
