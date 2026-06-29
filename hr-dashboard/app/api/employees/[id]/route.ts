import { NextRequest, NextResponse } from "next/server";
import { updateEmployee, deleteEmployee } from "@/lib/firebaseService";
import type { Employee } from "../route";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Employee>;
  const update: Record<string, unknown> = {};
  if (body.name              !== undefined) update.name                 = body.name;
  if (body.designation       !== undefined) update.designation          = body.designation;
  if (body.department        !== undefined) update.department           = body.department;
  if (body.workMode          !== undefined) update.workMode             = body.workMode;
  if (body.employmentType    !== undefined) update.employmentType       = body.employmentType;
  if (body.doj               !== undefined) update.doj                  = body.doj;
  if (body.status            !== undefined) update.status               = body.status;
  if (body.email             !== undefined) update.email                = body.email;
  if (body.phone             !== undefined) update.phone                = body.phone;
  if (body.emergencyContact  !== undefined) update.emergencyContact     = body.emergencyContact;
  if (body.emergencyName     !== undefined) update.emergencyName        = body.emergencyName;
  if (body.reportingManager  !== undefined) update.reportingManager     = body.reportingManager;
  if (body.gender            !== undefined) update.gender               = body.gender;
  if (body.dob               !== undefined) update.dob                  = body.dob;
  if (body.bloodGroup        !== undefined) update.bloodGroup           = body.bloodGroup;
  if (body.personalEmail     !== undefined) update.personalEmail        = body.personalEmail;
  if (body.currentAddress    !== undefined) update.currentAddress       = body.currentAddress;
  if (body.permanentAddress  !== undefined) update.permanentAddress     = body.permanentAddress;
  if (body.nationality       !== undefined) update.nationality          = body.nationality;
  if (body.maritalStatus     !== undefined) update.maritalStatus        = body.maritalStatus;
  if (body.fatherSpouseName  !== undefined) update.fatherSpouseName     = body.fatherSpouseName;
  if (body.alternatePhone    !== undefined) update.alternatePhone       = body.alternatePhone;
  if (body.city              !== undefined) update.city                 = body.city;
  if (body.state             !== undefined) update.state                = body.state;
  if (body.pinCode           !== undefined) update.pinCode              = body.pinCode;
  if (body.branch            !== undefined) update.branch               = body.branch;
  if (body.shift             !== undefined) update.shift                = body.shift;
  if (body.ctc               !== undefined) update.ctc                  = body.ctc;
  if (body.noticePeriod      !== undefined) update.noticePeriod         = body.noticePeriod;
  if (body.probationEndDate  !== undefined) update.probationEndDate     = body.probationEndDate;
  if (body.panNumber         !== undefined) update.panNumber            = body.panNumber;
  if (body.aadharNumber      !== undefined) update.aadharNumber         = body.aadharNumber;
  if (body.pfNumber          !== undefined) update.pfNumber             = body.pfNumber;
  if (body.uanNumber         !== undefined) update.uanNumber            = body.uanNumber;
  if (body.bankName          !== undefined) update.bankName             = body.bankName;
  if (body.accountHolderName !== undefined) update.accountHolderName    = body.accountHolderName;
  if (body.accountNumber     !== undefined) update.accountNumber        = body.accountNumber;
  if (body.ifscCode          !== undefined) update.ifscCode             = body.ifscCode;
  if (body.highestQualification !== undefined) update.highestQualification = body.highestQualification;
  if (body.institution       !== undefined) update.institution          = body.institution;
  if (body.yearOfPassing     !== undefined) update.yearOfPassing        = body.yearOfPassing;
  if (body.specialization    !== undefined) update.specialization       = body.specialization;
  if (body.skills            !== undefined) update.skills               = body.skills;
  if (body.documents         !== undefined) update.documents            = body.documents;

  update.employeeId = id; // ensure field stays in sync
  await updateEmployee(id, update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteEmployee(id);
  return NextResponse.json({ ok: true });
}
