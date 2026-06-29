import { NextRequest, NextResponse } from "next/server";
import { getEmployees, upsertEmployee } from "@/lib/firebaseService";

export interface Employee {
  id: string; name: string; designation: string; department: string;
  workMode: string; employmentType: string; doj: string; status: string;
  email: string; phone: string; emergencyContact: string; emergencyName: string;
  reportingManager: string; gender: string; dob: string; bloodGroup: string;
  personalEmail: string; currentAddress: string; permanentAddress: string;
  nationality: string; maritalStatus: string; fatherSpouseName: string;
  alternatePhone: string; city: string; state: string; pinCode: string;
  branch: string; shift: string; ctc: string; noticePeriod: string;
  probationEndDate: string; panNumber: string; aadharNumber: string;
  pfNumber: string; uanNumber: string; bankName: string;
  accountHolderName: string; accountNumber: string; ifscCode: string;
  highestQualification: string; institution: string; yearOfPassing: string;
  specialization: string; skills: string;
  documents: { name: string; status: "Uploaded" | "Pending" }[];
}

export function toEmployee(d: Record<string, unknown>): Employee {
  return {
    id:                   (d.id ?? d.employeeId) as string,
    name:                 (d.name as string) ?? "",
    designation:          (d.designation as string) ?? "",
    department:           (d.department as string) ?? "",
    workMode:             (d.workMode as string) ?? "Remote",
    employmentType:       (d.employmentType as string) ?? "Full-Time",
    doj:                  (d.doj as string) ?? "",
    status:               (d.status as string) ?? "Active",
    email:                (d.email as string) ?? "",
    phone:                (d.phone as string) ?? "",
    emergencyContact:     (d.emergencyContact as string) ?? "",
    emergencyName:        (d.emergencyName as string) ?? "",
    reportingManager:     (d.reportingManager as string) ?? "",
    gender:               (d.gender as string) ?? "",
    dob:                  (d.dob as string) ?? "",
    bloodGroup:           (d.bloodGroup as string) ?? "",
    personalEmail:        (d.personalEmail as string) ?? "",
    currentAddress:       (d.currentAddress as string) ?? "",
    permanentAddress:     (d.permanentAddress as string) ?? "",
    nationality:          (d.nationality as string) ?? "Indian",
    maritalStatus:        (d.maritalStatus as string) ?? "Single",
    fatherSpouseName:     (d.fatherSpouseName as string) ?? "",
    alternatePhone:       (d.alternatePhone as string) ?? "",
    city:                 (d.city as string) ?? "",
    state:                (d.state as string) ?? "",
    pinCode:              (d.pinCode as string) ?? "",
    branch:               (d.branch as string) ?? "Bengaluru HQ",
    shift:                (d.shift as string) ?? "9AM–6PM",
    ctc:                  (d.ctc as string) ?? "",
    noticePeriod:         (d.noticePeriod as string) ?? "30 Days",
    probationEndDate:     (d.probationEndDate as string) ?? "",
    panNumber:            (d.panNumber as string) ?? "",
    aadharNumber:         (d.aadharNumber as string) ?? "",
    pfNumber:             (d.pfNumber as string) ?? "",
    uanNumber:            (d.uanNumber as string) ?? "",
    bankName:             (d.bankName as string) ?? "",
    accountHolderName:    (d.accountHolderName as string) ?? "",
    accountNumber:        (d.accountNumber as string) ?? "",
    ifscCode:             (d.ifscCode as string) ?? "",
    highestQualification: (d.highestQualification as string) ?? "",
    institution:          (d.institution as string) ?? "",
    yearOfPassing:        (d.yearOfPassing as string) ?? "",
    specialization:       (d.specialization as string) ?? "",
    skills:               (d.skills as string) ?? "",
    documents:            (d.documents as Employee["documents"]) ?? [],
  };
}

export async function GET() {
  const docs = await getEmployees();
  return NextResponse.json(docs.map(d => toEmployee(d as Record<string, unknown>)));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Employee;
  if (!body.id || !body.name) {
    return NextResponse.json({ error: "id and name are required" }, { status: 400 });
  }
  const { id, ...data } = body;
  // Store employeeId as a field so Firestore orderBy("employeeId") in getEmployees() can find it
  await upsertEmployee(id, { ...data, employeeId: id } as Record<string, unknown>);
  return NextResponse.json({ ok: true }, { status: 201 });
}
