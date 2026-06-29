import { NextRequest, NextResponse } from "next/server";
import { getGoals, updateGoal, deleteGoal } from "@/lib/firebaseService";
import { create } from "@/lib/notificationStore";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const allGoals = await getGoals();
  const existing = allGoals.find((d) => d.id === id) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ ok: false }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (body.progress    !== undefined) update.progress    = body.progress;
  if (body.status      !== undefined) update.status      = body.status;
  if (body.notes       !== undefined) update.notes       = body.notes;
  if (body.feedback    !== undefined) update.feedback    = body.feedback;
  if (body.deadline    !== undefined) update.deadline    = body.deadline;
  if (body.kpi         !== undefined) update.kpi         = body.kpi;

  await updateGoal(id, update);

  // Employee updated progress → notify HR
  if (body.progress !== undefined && body.feedback === undefined) {
    await create({
      userId: "HR",
      type: "goal",
      title: `Goal Progress Updated — ${existing.name}`,
      message: `${existing.assignedTo} updated "${existing.name}" to ${body.progress}%.${body.notes ? " Note: " + String(body.notes).split("\n").pop() : ""}`,
    });
  }
  // HR added feedback → notify employee
  if (body.feedback !== undefined && existing.empId) {
    await create({
      userId: String(existing.empId),
      type: "goal",
      title: `Manager Feedback — ${existing.name}`,
      message: `HR left feedback on your goal "${existing.name}": "${body.feedback}"`,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteGoal(id);
  return NextResponse.json({ ok: true });
}
