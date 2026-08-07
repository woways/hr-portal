"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Eye, Pencil, Trash2, X, Plus, Search, Upload, Download, Rows3, Copy, CheckCircle2, FileText, Clock, CheckCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { firebaseConfig, db, storage } from "@/lib/firebase";
import { createUserProfile } from "@/lib/authService";
import { getEmployees, upsertEmployee, updateEmployee, deleteEmployee } from "@/lib/firebaseService";
import { invalidateEmployees } from "@/lib/cachedService";
import { computeNextEmployeeId } from "@/lib/employeeId";
import { isValidJobTitle } from "@/lib/jobTitle";
import { readCache, writeCache } from "@/lib/cache";
import { getDoc, doc as fsDoc } from "firebase/firestore";
import { DEPARTMENTS } from "@/lib/constants";
import { useDepartments } from "@/lib/useDepartments";
import { canonicalWorkMode, canonicalEmploymentType, canonicalDepartment, isKnownDepartment } from "@/lib/enums";
import { EmptyState } from "@/components/EmptyState";
import { uploadDocFile, saveDocMeta, loadDocMeta, StoredDoc } from "@/lib/documentService";
import { SkeletonTableRows } from "@/components/Skeleton";

function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "@#!";
  const all = upper + lower + digits + special;
  const rand = (s: string) => s[Math.floor(Math.random() * s.length)];
  const base = Array.from({ length: 6 }, () => rand(all)).join("");
  return rand(upper) + rand(digits) + rand(special) + base;
}

type EmployeeStatus = "Active" | "On Leave" | "Probation" | "Exited";
type WorkMode = "Remote" | "On-site" | "Hybrid";
type EmpType = "Full-Time" | "Intern" | "Contract";

const ROLES = ["Manager", "Executive", "Admin", "General Manager"] as const;

interface Employee {
  id: string;
  name: string;
  designation: string;
  department: string;
  role: string;
  workMode: WorkMode;
  employmentType: EmpType;
  doj: string;
  status: EmployeeStatus;
  email: string;
  phone: string;
  emergencyContact: string;
  emergencyName: string;
  reportingManager: string;
  gender: string;
  dob: string;
  bloodGroup: string;
  personalEmail: string;
  currentAddress: string;
  permanentAddress: string;
  documents: { name: string; status: "Uploaded" | "Pending" }[];
  // Extended fields
  nationality: string;
  maritalStatus: string;
  fatherSpouseName: string;
  alternatePhone: string;
  city: string;
  state: string;
  pinCode: string;
  branch: string;
  shift: string;
  ctc: string;
  noticePeriod: string;
  probationEndDate: string;
  panNumber: string;
  aadharNumber: string;
  pfNumber: string;
  uanNumber: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  highestQualification: string;
  institution: string;
  yearOfPassing: string;
  specialization: string;
  skills: string;
  photoURL?: string;
}

// Strict email format (NEW-003): local part and every domain label must start/end
// alphanumeric, the domain needs at least one dot, and the TLD must be 2+ letters.
// This rejects obviously-malformed values ("a@b", "a@b.c", "a@-b.com", "a@b..com",
// "a@b.c0m") that the old "@ + dot" check let through.
const EMAIL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

// Verify an email's domain can actually receive mail (has a real MX record), so
// structurally-valid but bogus domains like "hh@hghgh.com" — which publishes a
// "null MX" (RFC 7505) — are rejected. Fails OPEN on any DNS/network error.
async function emailDomainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return false;
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    if (!res.ok) return true; // network hiccup → don't block
    const data = await res.json();
    if (data.Status !== 0) return false; // NXDOMAIN etc. → domain doesn't exist
    const answers: { data?: string }[] = Array.isArray(data.Answer) ? data.Answer : [];
    if (answers.length === 0) return false; // no MX at all
    return answers.some((a) => {
      const target = String(a.data ?? "").trim().split(/\s+/).pop() ?? "";
      return target !== "." && target !== ""; // "." = null MX → refuses mail
    });
  } catch {
    return true; // DNS unreachable → don't block
  }
}

// Work emails must be on the company domain (rejects structurally-valid but bogus
// domains like "hh@hghgh.com" that a format regex alone can't catch — EMP-003).
const COMPANY_EMAIL_DOMAIN = "woways.in";
function validateWorkEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return "Please enter a valid work email address.";
  if (!email.endsWith("@" + COMPANY_EMAIL_DOMAIN)) return `Work email must be a company address ending in @${COMPANY_EMAIL_DOMAIN}.`;
  return null;
}

const empDefaults = {
  nationality: "Indian", maritalStatus: "Single", fatherSpouseName: "",
  alternatePhone: "", city: "", state: "", pinCode: "",
  branch: "Bengaluru HQ", shift: "9AM–6PM", ctc: "", noticePeriod: "30 Days", probationEndDate: "",
  panNumber: "", aadharNumber: "", pfNumber: "", uanNumber: "",
  bankName: "", accountHolderName: "", accountNumber: "", ifscCode: "",
  highestQualification: "Bachelor's", institution: "", yearOfPassing: "", specialization: "", skills: "",
};

const initialEmployees: Employee[] = [];

const managers: string[] = [];

const blankForm: Omit<Employee, "id"> = {
  name: "", designation: "", department: "", role: ROLES[0], reportingManager: "",
  workMode: "Remote", employmentType: "Full-Time", doj: "", status: "Active",
  email: "", phone: "", emergencyContact: "", emergencyName: "",
  nationality: "Indian", maritalStatus: "Single", fatherSpouseName: "",
  alternatePhone: "", city: "", state: "", pinCode: "",
  branch: "Bengaluru HQ", shift: "9AM–6PM", ctc: "", noticePeriod: "30 Days", probationEndDate: "",
  panNumber: "", aadharNumber: "", pfNumber: "", uanNumber: "",
  bankName: "", accountHolderName: "", accountNumber: "", ifscCode: "",
  highestQualification: "Bachelor's", institution: "", yearOfPassing: "", specialization: "", skills: "",
  gender: "Male", dob: "", bloodGroup: "B+", personalEmail: "",
  currentAddress: "", permanentAddress: "",
  documents: [
    { name: "Resume", status: "Pending" },
    { name: "Offer Letter", status: "Pending" },
    { name: "Aadhaar/PAN", status: "Pending" },
    { name: "Bank Details", status: "Pending" },
  ],
};

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function validatePhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null; // optional at this level — required check is separate
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2); // +91 country code
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);   // leading 0
  if (digits.length !== 10) return "Phone number must be exactly 10 digits.";
  if (/^[0-5]/.test(digits)) return "Indian phone numbers must start with 6, 7, 8 or 9.";
  return null;
}

// Normalize any common date string to strict ISO YYYY-MM-DD (BUG-EMP-01), so the
// Employees module never mixes formats (e.g. "01-27-2023" MM-DD-YYYY becomes
// "2023-01-27"). Unparseable values are returned unchanged.
function toISODate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const pad = (n: number | string) => String(n).padStart(2, "0");
  // Already year-first (YYYY-MM-DD / YYYY/MM/DD)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // Year-last (MM-DD-YYYY or DD-MM-YYYY, any of - / .)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    let month = a, day = b;
    if (a > 12) { day = a; month = b; }          // clearly DD-MM-YYYY
    else if (b > 12) { month = a; day = b; }     // clearly MM-DD-YYYY
    // else both ≤ 12 → ambiguous; assume MM-DD-YYYY (matches the observed data)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${y}-${pad(month)}-${pad(day)}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return s; // unparseable — leave as-is
}

function validateDob(dob: string): string | null {
  if (!dob) return null; // optional field — skip if blank
  const d = new Date(dob);
  if (isNaN(d.getTime())) return "Please enter a valid date of birth.";
  const today = new Date();
  today.setHours(23, 59, 59, 999); // allow today, reject anything after
  if (d > today) return "Date of birth cannot be in the future.";
  // Must be at least 18 years old: DOB on/before the date exactly 18 years ago.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  cutoff.setHours(23, 59, 59, 999);
  if (d > cutoff) return "Employee must be at least 18 years old.";
  return null;
}

// Latest allowable DOB (18 years ago today) — caps the date picker.
function maxDobStr(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().split("T")[0];
}

const statusColor: Record<EmployeeStatus, string> = {
  Active: "bg-green-100 text-green-700",
  "On Leave": "bg-yellow-100 text-yellow-700",
  Probation: "bg-orange-100 text-orange-700",
  Exited: "bg-red-100 text-red-700",
};

// Coerce an arbitrary CSV "status" value to a valid Employee status (EMP-009).
// Bulk-import rows sometimes carry a Recruitment candidate status like "applied"
// or free text; anything not recognised as a real employee state becomes "Active".
const EMPLOYEE_STATUSES: EmployeeStatus[] = ["Active", "On Leave", "Probation", "Exited"];
function normalizeEmployeeStatus(raw: unknown): EmployeeStatus {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[_\s-]+/g, " ");
  const map: Record<string, EmployeeStatus> = {
    // Active / working
    "active": "Active", "working": "Active", "employed": "Active",
    "confirmed": "Active", "permanent": "Active", "regular": "Active",
    "full time": "Active", "part time": "Active", "on notice": "Active",
    "notice period": "Active", "serving notice": "Active", "notice": "Active",
    // On leave (any kind of leave)
    "on leave": "On Leave", "onleave": "On Leave", "leave": "On Leave",
    "sabbatical": "On Leave", "maternity": "On Leave", "maternity leave": "On Leave",
    "paternity": "On Leave", "paternity leave": "On Leave",
    "medical leave": "On Leave", "sick leave": "On Leave", "on break": "On Leave",
    "suspended": "On Leave",
    // Probation / trainee
    "probation": "Probation", "probationary": "Probation",
    "probation period": "Probation", "trainee": "Probation",
    "intern": "Probation", "internship": "Probation", "apprentice": "Probation",
    // Exited / no longer employed
    "exited": "Exited", "exit": "Exited", "inactive": "Exited",
    "terminated": "Exited", "resigned": "Exited", "left": "Exited",
    "separated": "Exited", "relieved": "Exited", "retired": "Exited",
    "absconding": "Exited", "absconded": "Exited", "ex employee": "Exited",
    "former": "Exited", "dismissed": "Exited",
  };
  return map[v] ?? "Active";
}
const workModeColor: Record<WorkMode, string> = {
  Remote: "bg-blue-100 text-blue-700",
  "On-site": "bg-purple-100 text-purple-700",
  Hybrid: "bg-teal-100 text-teal-700",
};

type FormState = Omit<Employee, "id">;

const FORM_TABS = ["basic", "contact", "employment", "education", "identity"] as const;
type FormTab = typeof FORM_TABS[number];
const FORM_TAB_LABELS: Record<FormTab, string> = {
  basic: "Basic Info",
  contact: "Contact & Address",
  employment: "Employment",
  education: "Education & Skills",
  identity: "Identity & Bank",
};

function FormModal({
  title, subtitle, empId, form, setForm, onSave, onClose, saveLabel, saving,
}: {
  title: string; subtitle?: string; empId: string;
  form: FormState; setForm: (f: FormState) => void;
  onSave: () => void; onClose: () => void; saveLabel: string; saving?: boolean;
}) {
  const [tab, setTab] = useState<FormTab>("basic");
  const departments = useDepartments();

  // Snapshot the form as it was when the modal opened, to detect unsaved edits.
  const initialSnapshot = useRef(JSON.stringify({ form, empId }));
  function attemptClose() {
    const dirty = JSON.stringify({ form, empId }) !== initialSnapshot.current;
    if (dirty && !window.confirm("You have unsaved changes. Discard them and close?")) return;
    onClose();
  }

  const f = (field: keyof FormState, val: string) => setForm({ ...form, [field]: val });

  const inputCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]";
  const selectCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] bg-white";
  const labelCls = "text-xs font-medium text-gray-600 block mb-1";
  const textAreaCls = "w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none";
  const sectionHead = "col-span-2 text-xs font-semibold text-[#4F3CC9] uppercase tracking-wide pt-2 border-t border-gray-100 mt-1";

  const tabIdx = FORM_TABS.indexOf(tab);
  const isLast = tabIdx === FORM_TABS.length - 1;
  const goNext = () => setTab(FORM_TABS[tabIdx + 1]);
  const goBack = () => setTab(FORM_TABS[tabIdx - 1]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={attemptClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={attemptClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 pt-4 shrink-0 overflow-x-auto">
          {FORM_TABS.map((t, i) => (
            <div key={t} className="flex items-center gap-0 shrink-0">
              <button
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
                  tab === t ? "bg-[#EDE9FF] text-[#4F3CC9]" : i < tabIdx ? "text-green-600" : "text-gray-400 hover:bg-gray-100"
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  tab === t ? "bg-[#4F3CC9] text-white" : i < tabIdx ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"
                }`}>{i < tabIdx ? "✓" : i + 1}</span>
                {FORM_TAB_LABELS[t]}
              </button>
              {i < FORM_TABS.length - 1 && <span className="w-5 h-px bg-gray-200 shrink-0" />}
            </div>
          ))}
        </div>

        {/* Completion percentage so HR can see how far the form has progressed.
            Counts COMPLETED steps (steps before the current one), so step 1 shows
            0% and it rises 20% per completed step. */}
        <div className="px-6 pt-1.5 shrink-0">
          <p className="text-xs font-medium text-[#4F3CC9]">
            {Math.round((tabIdx / FORM_TABS.length) * 100)}% complete
            <span className="text-gray-400 font-normal"> · Step {tabIdx + 1} of {FORM_TABS.length}</span>
          </p>
        </div>

        {/* Form body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* ── Basic Info ── */}
          {tab === "basic" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  Employee ID <span className="text-gray-400 font-normal">(auto-generated · read-only)</span>
                </label>
                <input
                  value={empId}
                  readOnly
                  aria-readonly="true"
                  tabIndex={-1}
                  title="Auto-generated sequentially — cannot be edited manually"
                  placeholder="EMP…"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-600 cursor-not-allowed focus:outline-none select-none"
                />
              </div>
              <div>
                <label className={labelCls}>Full Name *</label>
                <input value={form.name} onChange={(e) => f("name", e.target.value)} placeholder="Full Name" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Gender</label>
                <select value={form.gender} onChange={(e) => f("gender", e.target.value)} className={selectCls}>
                  {["Male","Female","Other"].map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date of Birth</label>
                <input type="date" max={maxDobStr()} value={form.dob} onChange={(e) => f("dob", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Marital Status</label>
                <select value={form.maritalStatus} onChange={(e) => f("maritalStatus", e.target.value)} className={selectCls}>
                  {["Single","Married","Divorced","Widowed"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Nationality</label>
                <input value={form.nationality} onChange={(e) => f("nationality", e.target.value)} placeholder="e.g. Indian" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Father&apos;s / Spouse&apos;s Name</label>
                <textarea value={form.fatherSpouseName} onChange={(e) => f("fatherSpouseName", e.target.value)} placeholder="Name" rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Blood Group</label>
                <select value={form.bloodGroup} onChange={(e) => f("bloodGroup", e.target.value)} className={selectCls}>
                  {["A+","A-","B+","B-","O+","O-","AB+","AB-"].map(bg => <option key={bg}>{bg}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Work Email *</label>
                <input type="email" value={form.email} onChange={(e) => f("email", e.target.value)} placeholder="name@woways.in" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Personal Email</label>
                <input type="email" value={form.personalEmail} onChange={(e) => f("personalEmail", e.target.value)} placeholder="personal@gmail.com" className={inputCls} />
              </div>
            </div>
          )}

          {/* ── Contact & Address ── */}
          {tab === "contact" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Phone Number *</label>
                <input
                  type="tel" inputMode="numeric" maxLength={10}
                  value={form.phone}
                  onChange={(e) => f("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="9876543210"
                  className={inputCls}
                />
                {form.phone && validatePhone(form.phone) && (
                  <p className="text-xs text-red-500 mt-1">{validatePhone(form.phone)}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Alternate Phone</label>
                <input
                  type="tel" inputMode="numeric" maxLength={10}
                  value={form.alternatePhone}
                  onChange={(e) => f("alternatePhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="9800000000"
                  className={inputCls}
                />
                {form.alternatePhone && validatePhone(form.alternatePhone) && (
                  <p className="text-xs text-red-500 mt-1">{validatePhone(form.alternatePhone)}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Emergency Contact Name</label>
                <textarea value={form.emergencyName} onChange={(e) => f("emergencyName", e.target.value)} placeholder="Parent / Spouse name" rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Emergency Contact Number *</label>
                <input
                  type="tel" inputMode="numeric" maxLength={10}
                  value={form.emergencyContact}
                  onChange={(e) => f("emergencyContact", e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="9876543200"
                  className={inputCls}
                />
                {form.emergencyContact && validatePhone(form.emergencyContact) && (
                  <p className="text-xs text-red-500 mt-1">{validatePhone(form.emergencyContact)}</p>
                )}
              </div>
              <p className={sectionHead}>Current Address</p>
              <div className="col-span-2">
                <label className={labelCls}>Street / Flat</label>
                <textarea value={form.currentAddress} onChange={(e) => f("currentAddress", e.target.value)} rows={2} placeholder="Flat No, Street, Locality" className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>City</label>
                <input value={form.city} onChange={(e) => f("city", e.target.value)} placeholder="Bengaluru" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <input value={form.state} onChange={(e) => f("state", e.target.value)} placeholder="Karnataka" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PIN Code</label>
                <input value={form.pinCode} onChange={(e) => f("pinCode", e.target.value)} placeholder="560001" className={inputCls} />
              </div>
              <p className={sectionHead}>Permanent Address</p>
              <div className="col-span-2">
                <label className={labelCls}>Permanent Address</label>
                <textarea value={form.permanentAddress} onChange={(e) => f("permanentAddress", e.target.value)} rows={2} placeholder="Flat No, Street, City, PIN" className={textAreaCls} />
              </div>
            </div>
          )}

          {/* ── Employment ── */}
          {tab === "employment" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Designation *</label>
                <textarea value={form.designation} onChange={(e) => f("designation", e.target.value)} placeholder="e.g. Software Engineer" rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Department *</label>
                <select value={form.department} onChange={(e) => f("department", e.target.value)} className={selectCls}>
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <select value={form.role} onChange={(e) => f("role", e.target.value)} className={selectCls}>
                  {ROLES.map(role => <option key={role}>{role}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Reporting Manager</label>
                <textarea placeholder="Enter manager name" value={form.reportingManager} onChange={(e) => f("reportingManager", e.target.value)} rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Branch / Location</label>
                <select value={form.branch} onChange={(e) => f("branch", e.target.value)} className={selectCls}>
                  {["Bengaluru HQ","Mumbai","Delhi","Hyderabad","Chennai","Remote"].map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Work Mode</label>
                <select value={form.workMode} onChange={(e) => f("workMode", e.target.value as WorkMode)} className={selectCls}>
                  {["Remote","On-site","Hybrid"].map(w => <option key={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Shift</label>
                <select value={form.shift} onChange={(e) => f("shift", e.target.value)} className={selectCls}>
                  {["9AM–6PM","10AM–7PM","8AM–5PM","Night Shift","Flexible"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Employment Type</label>
                <select value={form.employmentType} onChange={(e) => f("employmentType", e.target.value as EmpType)} className={selectCls}>
                  {["Full-Time","Intern","Contract"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={normalizeEmployeeStatus(form.status)} onChange={(e) => f("status", e.target.value as EmployeeStatus)} className={selectCls}>
                  {EMPLOYEE_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date of Joining</label>
                <input type="date" value={form.doj} onChange={(e) => f("doj", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Probation End Date</label>
                <input type="date" value={form.probationEndDate} onChange={(e) => f("probationEndDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Annual Payroll</label>
                <input value={form.ctc} onChange={(e) => f("ctc", e.target.value)} placeholder="e.g. ₹12,00,000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notice Period</label>
                <select value={form.noticePeriod} onChange={(e) => f("noticePeriod", e.target.value)} className={selectCls}>
                  {["15 Days","30 Days","45 Days","60 Days","90 Days","Immediate"].map(n => <option key={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── Education & Skills ── */}
          {tab === "education" && (
            <div className="grid grid-cols-2 gap-4">
              <p className={sectionHead}>Highest Education</p>
              <div>
                <label className={labelCls}>Qualification</label>
                <select
                  value={["High School","Diploma","Bachelor's","Master's","MBA","PhD"].includes(form.highestQualification) ? form.highestQualification : "Other"}
                  onChange={(e) => {
                    if (e.target.value === "Other") f("highestQualification", "");
                    else f("highestQualification", e.target.value);
                  }}
                  className={selectCls}
                >
                  {["High School","Diploma","Bachelor's","Master's","MBA","PhD","Other"].map(q => <option key={q}>{q}</option>)}
                </select>
                {!["High School","Diploma","Bachelor's","Master's","MBA","PhD"].includes(form.highestQualification) && (
                  <input
                    value={form.highestQualification}
                    onChange={(e) => f("highestQualification", e.target.value)}
                    placeholder="Enter qualification"
                    className={`${inputCls} mt-2`}
                    autoFocus
                  />
                )}
              </div>
              <div>
                <label className={labelCls}>Specialization / Stream</label>
                <textarea value={form.specialization} onChange={(e) => f("specialization", e.target.value)} placeholder="e.g. Computer Science" rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Institution / University</label>
                <textarea value={form.institution} onChange={(e) => f("institution", e.target.value)} placeholder="e.g. IIT Bombay" rows={2} className={textAreaCls} />
              </div>
              <div>
                <label className={labelCls}>Year of Passing</label>
                <input value={form.yearOfPassing} onChange={(e) => f("yearOfPassing", e.target.value)} placeholder="e.g. 2018" className={inputCls} />
              </div>
              <p className={sectionHead}>Skills</p>
              <div className="col-span-2">
                <label className={labelCls}>Key Skills (comma separated)</label>
                <textarea value={form.skills} onChange={(e) => f("skills", e.target.value)} rows={3} placeholder="e.g. React, Node.js, SQL, Leadership" className={textAreaCls} />
              </div>
            </div>
          )}

          {/* ── Identity & Bank ── */}
          {tab === "identity" && (
            <div className="grid grid-cols-2 gap-4">
              <p className={sectionHead}>Government IDs</p>
              <div>
                <label className={labelCls}>PAN Number</label>
                <input value={form.panNumber} onChange={(e) => f("panNumber", e.target.value)} placeholder="ABCDE1234F" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Aadhar Number</label>
                <input value={form.aadharNumber} onChange={(e) => f("aadharNumber", e.target.value)} placeholder="XXXX XXXX XXXX" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>PF Number</label>
                <input value={form.pfNumber} onChange={(e) => f("pfNumber", e.target.value)} placeholder="KN/BNG/123456" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>UAN Number</label>
                <input value={form.uanNumber} onChange={(e) => f("uanNumber", e.target.value)} placeholder="100XXXXXXXXX" className={inputCls} />
              </div>
              <p className={sectionHead}>Bank Details</p>
              <div>
                <label className={labelCls}>Bank Name</label>
                <input value={form.bankName} onChange={(e) => f("bankName", e.target.value)} placeholder="Enter bank name" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Account Holder Name</label>
                <input value={form.accountHolderName} onChange={(e) => f("accountHolderName", e.target.value)} placeholder="Full name as per bank" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Account Number</label>
                <input value={form.accountNumber} onChange={(e) => f("accountNumber", e.target.value)} placeholder="XXXXXXXXXXXXXXXX" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>IFSC Code</label>
                <input value={form.ifscCode} onChange={(e) => f("ifscCode", e.target.value)} placeholder="e.g. SBIN0001234" className={inputCls} />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-4 border-t shrink-0 flex items-center gap-3">
          <span className="text-xs text-gray-400 mr-auto">{tabIdx + 1} / {FORM_TABS.length}</span>
          {tabIdx > 0 && (
            <button onClick={goBack} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
              ← Back
            </button>
          )}
          {!isLast ? (
            <button onClick={goNext} className="px-6 py-2.5 bg-[#4F3CC9] text-white rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] transition">
              Next →
            </button>
          ) : (
            <button onClick={onSave} disabled={saving} className="px-6 py-2.5 bg-[#4F3CC9] text-white rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] transition disabled:opacity-60 flex items-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? "Saving…" : saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CSV columns (subset for bulk import) ──────────────────────────────────────
const CSV_HEADERS = [
  "name","email","phone","designation","department","role","workMode","employmentType",
  "doj","gender","dob","reportingManager","branch","shift","ctc","noticePeriod",
  "status","city","state","pinCode","skills",
] as const;
type CsvCol = typeof CSV_HEADERS[number];

type BulkRow = Record<CsvCol, string> & { _err?: string };

const BLANK_BULK_ROW = (): BulkRow =>
  Object.fromEntries(CSV_HEADERS.map((h) => [h, ""])) as BulkRow;

// Split a single CSV line, respecting double-quoted fields that may contain commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote ""
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsv(text: string): BulkRow[] {
  // Strip a leading UTF-8 BOM (Excel / Google Sheets add one) so the first
  // header isn't read as "﻿name" and silently unmatched.
  const clean = text.replace(/^﻿/, "").trim();
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  // Map each incoming header to the canonical column key, case-insensitively, and
  // accept common human-readable header names (e.g. "Full Name", "Work Email") so
  // CSVs authored by hand — not just the template — still import.
  const canonical = new Map(CSV_HEADERS.map((h) => [h.toLowerCase(), h] as const));
  const aliases: Record<string, CsvCol> = {
    "full name": "name", "employee name": "name",
    "work email": "email", "email id": "email", "e-mail": "email", "mail": "email",
    "phone number": "phone", "mobile": "phone", "mobile number": "phone", "contact": "phone", "contact number": "phone",
    "job title": "designation", "title": "designation", "role applied": "designation",
    "dept": "department",
    "work location": "branch", "location": "branch",
    "employment type": "employmentType", "type": "employmentType",
    "work mode": "workMode",
    "date of joining": "doj", "joining date": "doj", "date of join": "doj",
    "date of birth": "dob",
    "reporting manager": "reportingManager", "manager": "reportingManager",
    "notice period": "noticePeriod",
    "pin code": "pinCode", "pin": "pinCode", "zip": "pinCode", "postal code": "pinCode",
    "salary": "ctc", "annual ctc": "ctc", "payroll": "ctc", "payroll (₹)": "ctc",
    "salary (₹)": "ctc", "ctc (₹)": "ctc", "monthly salary": "ctc",
    "mobile no": "phone", "mobile no.": "phone",
  };
  const headers = splitCsvLine(lines[0]).map((h) => {
    const key = h.toLowerCase().replace(/\*/g, "").trim();
    return canonical.get(key) ?? aliases[key] ?? "";
  });
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const row = BLANK_BULK_ROW();
    headers.forEach((h, i) => { if (h && h in row) (row as Record<string, string>)[h] = vals[i] ?? ""; });
    const err = validateBulkRow(row);
    if (err) row._err = err;
    return row;
  });
}

// A row where every column is blank — an unused manual-entry line, not an error.
function isEmptyBulkRow(row: BulkRow): boolean {
  return CSV_HEADERS.every((h) => !row[h]?.trim());
}

// Validate one bulk-import row BEFORE it can be imported (EMP-001 retest):
// required identity fields plus number-format checks on phone, salary and PIN.
function validateBulkRow(row: BulkRow): string | null {
  if (!row.name?.trim()) return "Name is required";
  const email = row.email?.trim() ?? "";
  if (!email) return "Email is required";
  if (!EMAIL_RE.test(email)) return "Invalid email format";
  // Phone is required and must be a valid 10-digit number (matches the single
  // Add-Employee form). Rejects letters, wrong length and invalid prefixes.
  if (!row.phone?.trim()) return "Phone number is required";
  const phoneErr = validatePhone(row.phone);
  if (phoneErr) return `Phone: ${phoneErr}`;
  // Designation and Date of Joining are mandatory (BUG-EMP-02) — no Active
  // employee record may be created with these blank.
  if (!row.designation?.trim()) return "Designation is required";
  if (!isValidJobTitle(row.designation)) return "Designation must be a valid job title";
  if (!row.doj?.trim()) return "Date of Joining is required";
  // Salary / CTC is optional, but if given it must be a positive number
  // (accepts formatted values like "₹8,50,000"; rejects text, 0 and negatives).
  if (row.ctc?.trim()) {
    const raw = row.ctc.trim();
    const cleaned = raw.replace(/[^\d.]/g, "");
    const n = parseFloat(cleaned);
    // Reject negatives too — stripping non-digits would otherwise turn "-5000" into 5000.
    if (raw.includes("-") || !cleaned || isNaN(n) || n <= 0) return "Payroll amount must be a valid positive number";
  }
  if (row.pinCode?.trim() && !/^\d{6}$/.test(row.pinCode.trim())) return "PIN code must be 6 digits";
  return null;
}

// Context needed to detect duplicates across the whole import (BUG-IMP-01):
// the set of emails/IDs already in the system, plus how many times each email
// appears within the file being imported.
interface DupContext {
  existingEmails: Set<string>;   // lower-cased emails already in Firestore
  batchEmailCounts: Map<string, number>; // occurrences of each email in this file
}

function buildDupContext(existingEmails: Set<string>, rows: BulkRow[]): DupContext {
  const batchEmailCounts = new Map<string, number>();
  for (const r of rows) {
    if (isEmptyBulkRow(r)) continue;
    const e = (r.email || "").trim().toLowerCase();
    if (e) batchEmailCounts.set(e, (batchEmailCounts.get(e) ?? 0) + 1);
  }
  return { existingEmails, batchEmailCounts };
}

// Full per-row verdict for the import preview: field-level validation FIRST
// (required/format/number), then duplicate detection against the system and
// within the file. Returns null when the row is clean and safe to write.
function bulkRowError(row: BulkRow, ctx: DupContext): string | null {
  const base = validateBulkRow(row);
  if (base) return base;
  const email = (row.email || "").trim().toLowerCase();
  if (email) {
    if (ctx.existingEmails.has(email)) return "Duplicate: this email already exists in the system";
    if ((ctx.batchEmailCounts.get(email) ?? 0) > 1) return "Duplicate: this email appears more than once in the file";
  }
  return null;
}

function rowToEmployee(row: BulkRow, id: string): Employee {
  return {
    ...empDefaults,
    id,
    name: row.name, email: row.email, phone: row.phone,
    designation: row.designation, department: canonicalDepartment(row.department || DEPARTMENTS[0], DEPARTMENTS), role: row.role || "",
    workMode: canonicalWorkMode(row.workMode) as WorkMode,
    employmentType: canonicalEmploymentType(row.employmentType) as EmpType,
    doj: toISODate(row.doj), gender: row.gender || "Male", dob: toISODate(row.dob),
    reportingManager: row.reportingManager || "",
    branch: row.branch || "Bengaluru HQ", shift: row.shift || "9AM–6PM",
    ctc: row.ctc, noticePeriod: row.noticePeriod || "30 Days",
    status: normalizeEmployeeStatus(row.status),
    city: row.city, state: row.state, pinCode: row.pinCode,
    skills: row.skills,
    bloodGroup: "B+", personalEmail: "", currentAddress: "", permanentAddress: "",
    emergencyContact: "", emergencyName: "",
    documents: [
      { name: "Resume", status: "Pending" }, { name: "Offer Letter", status: "Pending" },
      { name: "Aadhaar/PAN", status: "Pending" }, { name: "Bank Details", status: "Pending" },
    ],
  };
}

function BulkImportModal({ onImport, onClose, nextIdStart, existingEmails }: {
  onImport: (emps: Employee[]) => void;
  onClose: () => void;
  nextIdStart: number;
  existingEmails: Set<string>;
}) {
  const departments = useDepartments();
  const [mode, setMode] = useState<"multi" | "csv">("multi");
  const [rows, setRows] = useState<BulkRow[]>([BLANK_BULK_ROW(), BLANK_BULK_ROW(), BLANK_BULK_ROW()]);
  const [csvRows, setCsvRows] = useState<BulkRow[]>([]);
  const [csvName, setCsvName] = useState("");
  const [toast, setToast] = useState("");

  // Live duplicate context over whatever rows are currently in view, so the
  // preview flags duplicate emails (against the system and within the file)
  // the moment they appear — not silently at write time (BUG-IMP-01).
  const activeSource = mode === "multi" ? rows : csvRows;
  const dupCtx = buildDupContext(existingEmails, activeSource);
  // Single source of truth for a row's verdict — field validation + duplicates.
  const errorFor = (r: BulkRow): string | null => isEmptyBulkRow(r) ? null : bulkRowError(r, dupCtx);

  const inputCls = "w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-[#4F3CC9]";
  const selectCls = "w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-[#4F3CC9] bg-white";

  function setCell(idx: number, col: CsvCol, val: string) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [col]: val, _err: undefined } : r));
  }

  function addRow() { setRows((p) => [...p, BLANK_BULK_ROW()]); }
  function removeRow(i: number) { setRows((p) => p.filter((_, idx) => idx !== i)); }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvRows(parseCsv(text));
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const header = CSV_HEADERS.join(",");
    const blob = new Blob([header + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "employee_template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const source = mode === "multi" ? rows : csvRows;
    const ctx = buildDupContext(existingEmails, source);
    // Re-validate every non-empty row at import time (edits clear _err), so bad
    // phone numbers / salaries / emails / DUPLICATES can never slip through
    // (EMP-001 + BUG-IMP-01: validate & de-dupe prior to import, not after).
    const annotated = source.map((r) =>
      isEmptyBulkRow(r) ? { ...r, _err: undefined } : { ...r, _err: bulkRowError(r, ctx) ?? undefined }
    );
    const valid = annotated.filter((r) => !isEmptyBulkRow(r) && !r._err);
    const invalid = annotated.filter((r) => !isEmptyBulkRow(r) && r._err).length;
    // Surface the errors on the preview rows so it's clear why a row was rejected.
    if (mode === "multi") setRows(annotated); else setCsvRows(annotated);
    // Block the entire import until every row passes validation AND has no
    // duplicate email — don't silently skip bad/duplicate rows.
    if (invalid > 0) {
      setToast(`${invalid} row${invalid !== 1 ? "s" : ""} have invalid or duplicate data. Fix or remove the highlighted rows before importing.`);
      setTimeout(() => setToast(""), 5000);
      return;
    }
    if (valid.length === 0) {
      setToast("No valid rows to import.");
      setTimeout(() => setToast(""), 3500);
      return;
    }
    const emps = valid.map((r, i) =>
      rowToEmployee(r, `EMP${String(nextIdStart + i).padStart(3, "0")}`)
    );
    onImport(emps);
  }

  const previewRows = mode === "multi" ? rows : csvRows;
  const validCount = previewRows.filter((r) => !isEmptyBulkRow(r) && !errorFor(r)).length;
  const invalidCount = previewRows.filter((r) => !isEmptyBulkRow(r) && !!errorFor(r)).length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Bulk Import Employees</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add multiple employees at once — fill rows manually or upload a CSV</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 px-6 pt-4 shrink-0">
          <button
            onClick={() => setMode("multi")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${mode === "multi" ? "bg-[#EDE9FF] text-[#4F3CC9]" : "text-gray-500 hover:bg-gray-100"}`}
          >
            <Rows3 size={14} /> Fill Multiple Rows
          </button>
          <button
            onClick={() => setMode("csv")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${mode === "csv" ? "bg-[#EDE9FF] text-[#4F3CC9]" : "text-gray-500 hover:bg-gray-100"}`}
          >
            <Upload size={14} /> Upload CSV
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto flex-1 px-6 py-4">

          {mode === "multi" && (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-[#F5F3FF] text-gray-500 uppercase tracking-wide">
                      <th className="px-2 py-2 text-left w-8">#</th>
                      <th className="px-2 py-2 text-left min-w-[130px]">Full Name *</th>
                      <th className="px-2 py-2 text-left min-w-[160px]">Work Email *</th>
                      <th className="px-2 py-2 text-left min-w-[110px]">Phone</th>
                      <th className="px-2 py-2 text-left min-w-[130px]">Designation</th>
                      <th className="px-2 py-2 text-left min-w-[110px]">Department</th>
                      <th className="px-2 py-2 text-left min-w-[100px]">Role</th>
                      <th className="px-2 py-2 text-left min-w-[90px]">Work Mode</th>
                      <th className="px-2 py-2 text-left min-w-[90px]">Type</th>
                      <th className="px-2 py-2 text-left min-w-[100px]">Date of Join</th>
                      <th className="px-2 py-2 text-left min-w-[80px]">Gender</th>
                      <th className="px-2 py-2 text-left min-w-[80px]">Status</th>
                      <th className="px-2 py-2 w-7"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row, i) => {
                      const rowErr = errorFor(row);
                      const isDup = !!rowErr && rowErr.startsWith("Duplicate");
                      return (
                      <tr key={i} className={rowErr ? "bg-red-50" : "hover:bg-gray-50"}>
                        <td className="px-2 py-2 text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-2 py-2">
                          <input value={row.name} onChange={(e) => setCell(i, "name", e.target.value)} placeholder="Full Name" className={`${inputCls} ${rowErr ? "border-red-300" : ""}`} />
                          {rowErr && <p className="text-red-500 text-[10px] mt-0.5">{rowErr}</p>}
                        </td>
                        <td className="px-2 py-2"><input value={row.email} onChange={(e) => setCell(i, "email", e.target.value)} placeholder="name@woways.in" className={`${inputCls} ${isDup ? "border-red-300" : ""}`} /></td>
                        <td className="px-2 py-2">
                          <input
                            type="tel" inputMode="numeric" maxLength={10}
                            value={row.phone}
                            onChange={(e) => setCell(i, "phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                            placeholder="98XXXXXXXX"
                            className={inputCls}
                          />
                          {row.phone && validatePhone(row.phone) && (
                            <p className="text-red-500 text-[10px] mt-0.5">{validatePhone(row.phone)}</p>
                          )}
                        </td>
                        <td className="px-2 py-2"><input value={row.designation} onChange={(e) => setCell(i, "designation", e.target.value)} placeholder="Software Eng." className={inputCls} /></td>
                        <td className="px-2 py-2">
                          <select value={row.department || "Sales"} onChange={(e) => setCell(i, "department", e.target.value)} className={selectCls}>
                            {departments.map(d => <option key={d}>{d}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={row.role || ROLES[0]} onChange={(e) => setCell(i, "role", e.target.value)} className={selectCls}>
                            {ROLES.map(r => <option key={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={row.workMode || "Remote"} onChange={(e) => setCell(i, "workMode", e.target.value)} className={selectCls}>
                            {["Remote","On-site","Hybrid"].map(w => <option key={w}>{w}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={row.employmentType || "Full-Time"} onChange={(e) => setCell(i, "employmentType", e.target.value)} className={selectCls}>
                            {["Full-Time","Intern","Contract"].map(t => <option key={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2"><input type="date" value={row.doj} onChange={(e) => setCell(i, "doj", e.target.value)} className={inputCls} /></td>
                        <td className="px-2 py-2">
                          <select value={row.gender || "Male"} onChange={(e) => setCell(i, "gender", e.target.value)} className={selectCls}>
                            {["Male","Female","Other"].map(g => <option key={g}>{g}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select value={normalizeEmployeeStatus(row.status)} onChange={(e) => setCell(i, "status", e.target.value)} className={selectCls}>
                            {EMPLOYEE_STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-400 transition"><X size={14} /></button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button onClick={addRow} className="mt-3 flex items-center gap-1.5 text-xs text-[#4F3CC9] hover:text-[#3d2fa8] font-medium transition">
                <Plus size={14} /> Add Row
              </button>
            </div>
          )}

          {mode === "csv" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2 border border-[#4F3CC9] text-[#4F3CC9] rounded-xl text-sm font-medium hover:bg-[#EDE9FF] transition">
                  <Download size={14} /> Download Template
                </button>
                <span className="text-xs text-gray-400">Fill in the template and upload below</span>
              </div>
              <label className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-2xl py-10 cursor-pointer hover:border-[#4F3CC9] hover:bg-[#F5F3FF] transition">
                <Upload size={28} className="text-gray-300 mb-2" />
                <span className="text-sm font-medium text-gray-600">Click to upload CSV file</span>
                <span className="text-xs text-gray-400 mt-1">{csvName || "employee_template.csv"}</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
              {csvRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">{csvRows.length} rows detected — preview <span className="text-gray-400 font-normal">(values shown are normalized to standard enums &amp; ISO dates before import)</span>:</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#F5F3FF] text-gray-500 uppercase">
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Email</th>
                          <th className="px-3 py-2 text-left">Phone</th>
                          <th className="px-3 py-2 text-left">Work Mode</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Payroll (₹)</th>
                          <th className="px-3 py-2 text-left">DOJ</th>
                          <th className="px-3 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {csvRows.map((r, i) => {
                          const err = errorFor(r);
                          const isDup = !!err && err.startsWith("Duplicate");
                          const badPhone = !r.phone?.trim() || !!validatePhone(r.phone);
                          const badSalary = !!r.ctc?.trim() && (r.ctc.includes("-") || !(parseFloat(r.ctc.replace(/[^\d.]/g, "")) > 0));
                          // Show the NORMALIZED value the pipeline will actually write, and
                          // mark it when it differs from the raw CSV cell so the fix is visible.
                          const normMode = canonicalWorkMode(r.workMode);
                          const normType = canonicalEmploymentType(r.employmentType);
                          const modeChanged = !!r.workMode?.trim() && normMode !== r.workMode.trim();
                          const typeChanged = !!r.employmentType?.trim() && normType !== r.employmentType.trim();
                          return (
                          <tr key={i} className={err ? "bg-red-50" : ""}>
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 font-medium">{r.name || <span className="text-red-400">—</span>}</td>
                            <td className={`px-3 py-2 ${isDup ? "text-red-500 font-medium" : "text-gray-600"}`}>{r.email || <span className="text-red-400">—</span>}</td>
                            <td className={`px-3 py-2 ${badPhone ? "text-red-500 font-medium" : "text-gray-600"}`}>{r.phone || "—"}</td>
                            <td className="px-3 py-2 text-gray-600" title={modeChanged ? `raw: "${r.workMode}"` : undefined}>{r.workMode?.trim() ? normMode : "—"}{modeChanged && <span className="ml-1 text-[10px] text-amber-600">✎</span>}</td>
                            <td className="px-3 py-2 text-gray-600" title={typeChanged ? `raw: "${r.employmentType}"` : undefined}>{r.employmentType?.trim() ? normType : "—"}{typeChanged && <span className="ml-1 text-[10px] text-amber-600">✎</span>}</td>
                            <td className={`px-3 py-2 ${badSalary ? "text-red-500 font-medium" : "text-gray-600"}`}>{r.ctc || "—"}</td>
                            <td className="px-3 py-2 text-gray-600">{toISODate(r.doj) || "—"}</td>
                            <td className="px-3 py-2">
                              {err
                                ? <span className="text-red-500">{err}</span>
                                : <span className="text-green-600">✓ Valid</span>
                              }
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-4 border-t shrink-0 flex items-center gap-3">
          {toast && <span className="text-xs text-red-500 mr-auto">{toast}</span>}
          {!toast && invalidCount > 0 && <span className="text-xs text-red-500 mr-auto font-medium">⚠ {invalidCount} row{invalidCount !== 1 ? "s" : ""} with invalid phone/salary/email — fix before importing</span>}
          {!toast && invalidCount === 0 && <span className="text-xs text-gray-400 mr-auto">{validCount} valid employee{validCount !== 1 ? "s" : ""} ready to import</span>}
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleImport}
            disabled={validCount === 0 || invalidCount > 0}
            title={invalidCount > 0 ? "Fix the highlighted invalid rows first" : undefined}
            className="px-6 py-2.5 bg-[#4F3CC9] text-white rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {validCount > 0 ? `${validCount} Employee${validCount !== 1 ? "s" : ""}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreatedCreds { name: string; email: string; password: string; empId: string; }

export default function EmployeesPage() {
  const departmentList = useDepartments();
  const departmentOptions = ["All", ...departmentList];
  // Latest department list, readable inside loadEmployees (which is memoized with
  // no deps) so department normalization uses the configured set as it updates.
  const departmentListRef = useRef<string[]>(departmentList);
  departmentListRef.current = departmentList;
  const canonDeptSet = Array.from(new Set([...DEPARTMENTS, ...departmentList]));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const EMP_CACHE = "hr_employees_v2";
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [addEmpId, setAddEmpId] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [viewEmp, setViewEmp] = useState<Employee | null>(null);
  const [viewTab, setViewTab] = useState<"info" | "employment" | "documents">("info");
  const [hrDocs, setHrDocs] = useState<Record<string, StoredDoc>>({});
  const [hrUploadingSlot, setHrUploadingSlot] = useState<string | null>(null);
  const [hrUploadProgress, setHrUploadProgress] = useState(0);
  const [hrDocToast, setHrDocToast] = useState<string | null>(null);
  const hrFileInputRef = useRef<HTMLInputElement>(null);
  const [hrPendingSlot, setHrPendingSlot] = useState<string | null>(null);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [deleteEmp, setDeleteEmp] = useState<Employee | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>({ ...blankForm });
  const [addToast, setAddToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [createdCreds, setCreatedCreds] = useState<CreatedCreds | null>(null);
  const [copiedField, setCopiedField] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const loadEmployees = useCallback(async () => {
    try {
      const docs = await getEmployees();
      const statusFixes: { docId: string; status: EmployeeStatus }[] = [];
      const dateFixes: { docId: string; data: Record<string, string> }[] = [];
      const enumFixes: { docId: string; data: Record<string, string> }[] = [];
      // Canonical department set = configured/settings list ∪ built-in defaults.
      const canonDepts = Array.from(new Set([...DEPARTMENTS, ...departmentListRef.current]));
      const data: Employee[] = docs.map((d) => {
        const r = d as Record<string, unknown>;
        const normStatus = normalizeEmployeeStatus(r.status);
        // Self-heal (EMP-009): a stored status that isn't a valid employee status
        // (e.g. an imported Recruitment "applied") is corrected in Firestore, not
        // just masked on display — so every other screen reading it sees a valid value.
        if (typeof r.status === "string" && r.status.trim() && !EMPLOYEE_STATUSES.includes(r.status.trim() as EmployeeStatus)) {
          statusFixes.push({ docId: r.id as string, status: normStatus });
        }
        // Normalize date fields to strict ISO (BUG-EMP-01) and persist the fix so the
        // stored data — not just the display — is consistent and correctly sortable.
        const isoDoj = toISODate(r.doj);
        const isoDob = toISODate(r.dob);
        const dfix: Record<string, string> = {};
        if (typeof r.doj === "string" && r.doj.trim() && isoDoj !== r.doj) dfix.doj = isoDoj;
        if (typeof r.dob === "string" && r.dob.trim() && isoDob !== r.dob) dfix.dob = isoDob;
        if (Object.keys(dfix).length) dateFixes.push({ docId: r.id as string, data: dfix });
        // Normalize categorical values to strict enum casing (BUG-EMP-03) and
        // persist the fix so mixed-case / placeholder values ("remote", "hybrid",
        // "intern") are cleaned at the source, not just masked on display.
        const wm = canonicalWorkMode(r.workMode);
        const et = canonicalEmploymentType(r.employmentType);
        const dept = canonicalDepartment(r.department, canonDepts);
        const efix: Record<string, string> = {};
        if (typeof r.workMode === "string" && r.workMode.trim() && wm !== r.workMode) efix.workMode = wm;
        if (typeof r.employmentType === "string" && r.employmentType.trim() && et !== r.employmentType) efix.employmentType = et;
        if (typeof r.department === "string" && r.department.trim() && dept !== r.department) efix.department = dept;
        if (Object.keys(efix).length) enumFixes.push({ docId: r.id as string, data: efix });
        return {
          id: (r.employeeId ?? r.id) as string,
          name: (r.name as string) ?? "",
          designation: (r.designation as string) ?? "",
          department: dept,
          role: (r.role as string) ?? "",
          workMode: (wm as WorkMode),
          employmentType: (et as EmpType),
          doj: toISODate(r.doj),
          status: normStatus,
          email: (r.email as string) ?? "",
          phone: (r.phone as string) ?? "",
          emergencyContact: (r.emergencyContact as string) ?? "",
          emergencyName: (r.emergencyName as string) ?? "",
          reportingManager: (r.reportingManager as string) ?? "",
          gender: (r.gender as string) ?? "",
          dob: toISODate(r.dob),
          bloodGroup: (r.bloodGroup as string) ?? "",
          personalEmail: (r.personalEmail as string) ?? "",
          currentAddress: (r.currentAddress as string) ?? "",
          permanentAddress: (r.permanentAddress as string) ?? "",
          nationality: (r.nationality as string) ?? "Indian",
          maritalStatus: (r.maritalStatus as string) ?? "Single",
          fatherSpouseName: (r.fatherSpouseName as string) ?? "",
          alternatePhone: (r.alternatePhone as string) ?? "",
          city: (r.city as string) ?? "",
          state: (r.state as string) ?? "",
          pinCode: (r.pinCode as string) ?? "",
          branch: (r.branch as string) ?? "Bengaluru HQ",
          shift: (r.shift as string) ?? "9AM–6PM",
          ctc: (r.ctc as string) ?? "",
          noticePeriod: (r.noticePeriod as string) ?? "30 Days",
          probationEndDate: (r.probationEndDate as string) ?? "",
          panNumber: (r.panNumber as string) ?? "",
          aadharNumber: (r.aadharNumber as string) ?? "",
          pfNumber: (r.pfNumber as string) ?? "",
          uanNumber: (r.uanNumber as string) ?? "",
          bankName: (r.bankName as string) ?? "",
          accountHolderName: (r.accountHolderName as string) ?? "",
          accountNumber: (r.accountNumber as string) ?? "",
          ifscCode: (r.ifscCode as string) ?? "",
          highestQualification: (r.highestQualification as string) ?? "",
          institution: (r.institution as string) ?? "",
          yearOfPassing: (r.yearOfPassing as string) ?? "",
          specialization: (r.specialization as string) ?? "",
          skills: (r.skills as string) ?? "",
          documents: (r.documents as Employee["documents"]) ?? [],
          photoURL: (r.photoURL as string) || (r.profilePhoto as string) || undefined,
        };
      });
      setEmployees(data);
      // Cache the fresh list so the next visit renders instantly
      writeCache(EMP_CACHE, data);
      // Persist any status corrections back to Firestore so stale/invalid values
      // (from imports before EMP-009 was fixed) are cleaned up at the source.
      for (const fix of statusFixes) {
        updateEmployee(fix.docId, { status: fix.status }).catch(() => {});
      }
      // Persist normalized ISO dates so the stored data is consistent (BUG-EMP-01).
      for (const fix of dateFixes) {
        updateEmployee(fix.docId, fix.data).catch(() => {});
      }
      // Persist normalized categorical enums (BUG-EMP-03) so Work Mode / Employment
      // Type / Department casing is standardized at the source for every screen.
      for (const fix of enumFixes) {
        updateEmployee(fix.docId, fix.data).catch(() => {});
      }
    } catch (err) {
      setAddToast({ msg: "Failed to load employees. Please refresh and try again.", ok: false });
      setTimeout(() => setAddToast(null), 5000);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Show cached employees immediately, then refresh from Firestore in the background
    const cached = readCache<Employee[]>(EMP_CACHE);
    if (cached && cached.length) {
      setEmployees(cached);
      setLoading(false);
    }
    loadEmployees();
  }, [loadEmployees]);

  // Load HR-uploaded docs when viewing an employee
  useEffect(() => {
    if (!viewEmp) { setHrDocs({}); return; }
    loadDocMeta(viewEmp.id).then(setHrDocs).catch(() => {});
  }, [viewEmp]);

  async function handleHrUpload(slot: { id: string; name: string }, file: File) {
    if (!viewEmp) return;
    const empInfo = { id: viewEmp.id, name: viewEmp.name, dept: viewEmp.department, designation: viewEmp.designation };
    setHrUploadingSlot(slot.id);
    setHrUploadProgress(0);
    try {
      const { url: fileUrl, path: storagePath } = await uploadDocFile(empInfo, slot.id, file, setHrUploadProgress);
      const ext = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
      const meta: StoredDoc = { name: slot.name, category: "Employment", status: "Uploaded", fileUrl, fileName: file.name, fileExt: ext, fileSize: file.size, storagePath, hrOnly: true };
      await saveDocMeta(empInfo, slot.id, meta, "hr");
      setHrDocs(prev => ({ ...prev, [slot.id]: meta }));
      setHrDocToast(`"${slot.name}" uploaded successfully!`);
      setTimeout(() => setHrDocToast(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHrDocToast(`Upload failed: ${msg}`);
      setTimeout(() => setHrDocToast(null), 5000);
      console.error("[HRDocUpload]", err);
    } finally {
      setHrUploadingSlot(null);
      setHrPendingSlot(null);
    }
  }

  const filtered = employees.filter((e) => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === "All" || e.department === deptFilter;
    return matchSearch && matchDept;
  });

  async function handleAdd() {
    // Mandatory fields — mirror the "*" markers shown in the Add Employee form.
    const requiredFields: [keyof typeof form, string][] = [
      ["name", "Employee name"],
      ["email", "Work email"],
      ["phone", "Phone number"],
      ["emergencyContact", "Emergency contact number"],
      ["designation", "Designation"],
      ["department", "Department"],
      ["doj", "Date of Joining"],
    ];
    for (const [key, label] of requiredFields) {
      if (!String(form[key] ?? "").trim()) {
        setAddToast({ msg: `${label} is required.`, ok: false });
        setTimeout(() => setAddToast(null), 3500);
        return;
      }
    }
    // Designation must be a real job title, not numbers/placeholder text (BUG-REC-03).
    if (!isValidJobTitle(form.designation)) {
      setAddToast({ msg: "Please enter a valid Designation (letters — not numbers or placeholder text).", ok: false });
      setTimeout(() => setAddToast(null), 3500);
      return;
    }
    // Work-email format + company-domain check.
    const emailErr = validateWorkEmail(form.email);
    if (emailErr) {
      setAddToast({ msg: emailErr, ok: false });
      setTimeout(() => setAddToast(null), 3500);
      return;
    }
    // Personal email (optional) — validate format + deliverable domain when provided.
    const personal = form.personalEmail?.trim();
    if (personal) {
      if (!EMAIL_RE.test(personal)) {
        setAddToast({ msg: "Please enter a valid personal email address.", ok: false });
        setTimeout(() => setAddToast(null), 3500);
        return;
      }
      if (!(await emailDomainAcceptsMail(personal))) {
        setAddToast({ msg: "That personal email domain doesn't accept mail — please check the address.", ok: false });
        setTimeout(() => setAddToast(null), 4000);
        return;
      }
    }
    const dobErr = validateDob(form.dob);
    if (dobErr) {
      setAddToast({ msg: dobErr, ok: false });
      setTimeout(() => setAddToast(null), 4000);
      return;
    }
    const phoneErr = validatePhone(form.phone);
    if (phoneErr) {
      setAddToast({ msg: phoneErr, ok: false });
      setTimeout(() => setAddToast(null), 4000);
      return;
    }
    const altPhoneErr = validatePhone(form.alternatePhone);
    if (altPhoneErr) {
      setAddToast({ msg: `Alternate phone: ${altPhoneErr}`, ok: false });
      setTimeout(() => setAddToast(null), 4000);
      return;
    }
    const emergencyPhoneErr = validatePhone(form.emergencyContact);
    if (emergencyPhoneErr) {
      setAddToast({ msg: `Emergency contact: ${emergencyPhoneErr}`, ok: false });
      setTimeout(() => setAddToast(null), 4000);
      return;
    }
    if (saving) return;

    // Employee ID is always the next sequential auto ID, computed from the SAME
    // source as the Onboarding form (employees + reserved onboarding IDs) so the
    // two forms never disagree (BUG-REC-02 + cross-form consistency). Read-only +
    // recomputed here, so no arbitrary / out-of-sequence value can be stored.
    const newId = await computeNextEmployeeId();

    setSaving(true);

    // Check Firestore directly — guarantee no duplicate ID regardless of local state
    try {
      const existing = await getDoc(fsDoc(db, "employees", newId));
      if (existing.exists()) {
        setAddToast({ msg: `Employee ID "${newId}" already exists. Please use a different ID.`, ok: false });
        setTimeout(() => setAddToast(null), 5000);
        setSaving(false);
        return;
      }
    } catch {
      // Network error — fall through and let upsert handle it
    }
    const emp: Employee = { id: newId, ...form };

    // Snapshot form values before async operations reset the form
    const savedName  = form.name.trim();
    const savedEmail = form.email.trim();
    const savedDept  = form.department;

    // Save employee record to Firestore
    try {
      const { id, ...rest } = emp;
      await upsertEmployee(id, { ...rest, employeeId: id });
    } catch (err) {
      const msg = (err as { code?: string }).code === "permission-denied"
        ? "Permission denied — please sign in and try again."
        : "Failed to save employee. Please try again.";
      setAddToast({ msg, ok: false });
      setTimeout(() => setAddToast(null), 5000);
      setSaving(false);
      return;
    }

    // Close modal and optimistically add to list (no waiting for reload)
    setShowAdd(false);
    setForm({ ...blankForm });
    setEmployees((prev) => [...prev, emp]);

    // Reload from Firestore to confirm persistence + bust shared caches so
    // other pages (dashboard, attendance, reports) re-fetch on next visit.
    invalidateEmployees();
    loadEmployees();

    // Create Firebase Auth login if email was provided
    const tempPassword = savedEmail ? generateTempPassword() : "—";
    let authCreated = false;
    if (savedEmail) {
      try {
        const secondaryApp = initializeApp(firebaseConfig, `emp-create-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, savedEmail, tempPassword);
        authCreated = true;
        await createUserProfile({
          uid: cred.user.uid,
          email: savedEmail,
          name: savedName,
          role: "employee",
          employeeId: newId,
          department: savedDept,
          createdAt: new Date().toISOString(),
        });
        await secondaryAuth.signOut();
        await deleteApp(secondaryApp);
      } catch {
        // Account may already exist — employee record was still saved to Firestore
      }
    }

    // Always show the credentials popup after a successful save
    setCreatedCreds({ name: savedName, email: savedEmail, password: (savedEmail && authCreated) ? tempPassword : "— (use Password Reset to set credentials)", empId: newId });
    setSaving(false);
  }

  function showToast(msg: string, ok = true) {
    setAddToast({ msg, ok });
    setTimeout(() => setAddToast(null), 4000);
  }

  async function handleBulkImport(emps: Employee[]) {
    // De-duplicate against existing employees AND within the batch, keyed on work
    // email (the natural unique identifier). Re-importing the same file must not
    // create duplicate records (EMP-001) — matching rows are skipped, not re-added.
    const seen = new Set<string>();
    for (const e of employees) {
      const k = (e.email || "").trim().toLowerCase();
      if (k) seen.add(k);
    }
    const toImport: Employee[] = [];
    let duplicates = 0;
    for (const emp of emps) {
      const key = (emp.email || "").trim().toLowerCase();
      if (key && seen.has(key)) { duplicates++; continue; }
      if (key) seen.add(key);
      toImport.push(emp);
    }

    const dupNote = duplicates > 0 ? ` ${duplicates} duplicate${duplicates !== 1 ? "s" : ""} skipped.` : "";
    if (toImport.length === 0) {
      showToast(`No new employees to import — all ${emps.length} row${emps.length !== 1 ? "s" : ""} already exist.`, false);
      setShowBulk(false);
      return;
    }

    const results = await Promise.allSettled(toImport.map((emp) => {
      const { id, ...rest } = emp;
      return upsertEmployee(id, { ...rest, employeeId: id });
    }));
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const succeeded = toImport.length - rejected.length;
    if (rejected.length > 0) {
      const reason = rejected[0].reason as { code?: string; message?: string };
      const detail = reason?.code === "permission-denied"
        ? "permission denied — please sign out and sign in again"
        : (reason?.message || reason?.code || "unknown error");
      showToast(`${succeeded} imported, ${rejected.length} failed: ${detail}.${dupNote}`, false);
    } else {
      showToast(`${succeeded} employee${succeeded !== 1 ? "s" : ""} imported.${dupNote}`);
    }
    invalidateEmployees();
    await loadEmployees();
    setShowBulk(false);
  }

  async function handleDelete() {
    if (!deleteEmp) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteEmployee(deleteEmp.id);
      const next = employees.filter((e) => e.id !== deleteEmp.id);
      setEmployees(next);
      writeCache(EMP_CACHE, next);
      invalidateEmployees();
      setDeleteEmp(null);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "permission-denied")
        setDeleteError("Permission denied. Please sign out and sign in again.");
      else
        setDeleteError("Failed to delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(emp: Employee) {
    const { id, ...rest } = emp;
    void id;
    setEditEmp(emp);
    // Normalize the status so it always matches a real <select> option (EMP-010).
    // A stored value the dropdown can't match (e.g. an "applied" status from a bad
    // import) makes the native select silently fall back to its first option
    // ("Active") without firing onChange — so a later "select Active" is a no-op and
    // the invalid value gets written straight back. Seeding a valid status fixes that.
    setEditForm({ ...rest, status: normalizeEmployeeStatus(rest.status) });
  }

  async function handleEditSave() {
    if (!editForm || !editEmp) return;
    // Mandatory fields — cannot blank out required data on edit either.
    const requiredFields: [keyof typeof editForm, string][] = [
      ["name", "Employee name"],
      ["email", "Work email"],
      ["phone", "Phone number"],
      ["emergencyContact", "Emergency contact number"],
      ["designation", "Designation"],
      ["department", "Department"],
      ["doj", "Date of Joining"],
    ];
    for (const [key, label] of requiredFields) {
      if (!String(editForm[key] ?? "").trim()) {
        setAddToast({ msg: `${label} is required.`, ok: false });
        setTimeout(() => setAddToast(null), 3500);
        return;
      }
    }
    if (!isValidJobTitle(editForm.designation)) {
      setAddToast({ msg: "Please enter a valid Designation (letters — not numbers or placeholder text).", ok: false });
      setTimeout(() => setAddToast(null), 3500);
      return;
    }
    const emailErr = validateWorkEmail(editForm.email);
    if (emailErr) {
      setAddToast({ msg: emailErr, ok: false });
      setTimeout(() => setAddToast(null), 3500);
      return;
    }
    const editPersonal = editForm.personalEmail?.trim();
    if (editPersonal) {
      if (!EMAIL_RE.test(editPersonal)) {
        setAddToast({ msg: "Please enter a valid personal email address.", ok: false });
        setTimeout(() => setAddToast(null), 3500);
        return;
      }
      if (!(await emailDomainAcceptsMail(editPersonal))) {
        setAddToast({ msg: "That personal email domain doesn't accept mail — please check the address.", ok: false });
        setTimeout(() => setAddToast(null), 4000);
        return;
      }
    }
    const dobErr = validateDob(editForm.dob);
    if (dobErr) {
      setAddToast({ msg: dobErr, ok: false });
      setTimeout(() => setAddToast(null), 4000);
      return;
    }
    const phoneErr = validatePhone(editForm.phone);
    if (phoneErr) { setAddToast({ msg: phoneErr, ok: false }); setTimeout(() => setAddToast(null), 4000); return; }
    const altPhoneErr = validatePhone(editForm.alternatePhone);
    if (altPhoneErr) { setAddToast({ msg: `Alternate phone: ${altPhoneErr}`, ok: false }); setTimeout(() => setAddToast(null), 4000); return; }
    const emergencyPhoneErr = validatePhone(editForm.emergencyContact);
    if (emergencyPhoneErr) { setAddToast({ msg: `Emergency contact: ${emergencyPhoneErr}`, ok: false }); setTimeout(() => setAddToast(null), 4000); return; }
    try {
      await updateEmployee(editEmp.id, { ...editForm, employeeId: editEmp.id });
      setEditEmp(null);
      setEditForm(null);
      invalidateEmployees();
      await loadEmployees();
    } catch (err) {
      setAddToast({ msg: "Failed to save changes. Please try again.", ok: false });
      setTimeout(() => setAddToast(null), 4000);
    }
  }

  function openView(emp: Employee) {
    setViewEmp(emp);
    setViewTab("info");
  }

  function exportEmployees() {
    const data = filtered.map((e) => ({
      "Emp ID": e.id,
      "Name": e.name,
      "Designation": e.designation,
      "Department": e.department,
      "Work Mode": e.workMode,
      "Employment Type": e.employmentType,
      "Date of Joining": toISODate(e.doj),
      "Status": e.status,
      "Work Email": e.email,
      "Phone": e.phone,
      "Reporting Manager": e.reportingManager,
      "Branch": e.branch,
      "Shift": e.shift,
      "CTC": e.ctc,
      "Notice Period": e.noticePeriod,
      "Gender": e.gender,
      "Date of Birth": toISODate(e.dob),
      "Blood Group": e.bloodGroup,
      "City": e.city,
      "State": e.state,
      "PIN Code": e.pinCode,
      "Skills": e.skills,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const colWidths = [
      { wch: 8 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 11 }, { wch: 16 },
      { wch: 14 }, { wch: 10 }, { wch: 26 }, { wch: 16 }, { wch: 20 },
      { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 28 },
    ];
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    XLSX.writeFile(wb, `employees_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const nums = employees.map((e) => parseInt(String(e.id).replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
  const nextAddId = `EMP${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;

  return (
    <div className="space-y-6">
      {addToast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-white text-sm font-medium shadow-lg ${addToast.ok ? "bg-green-500" : "bg-red-500"}`}>
          {addToast.msg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 text-sm mt-1">Manage all employee records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportEmployees} className="flex items-center gap-2 border border-gray-200 text-gray-600 rounded-xl px-4 py-2 text-sm font-medium hover:bg-gray-50 transition">
            <Download size={16} /> Export Excel
          </button>
          <button onClick={() => setShowBulk(true)} className="flex items-center gap-2 border border-[#4F3CC9] text-[#4F3CC9] rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#EDE9FF] transition">
            <Upload size={16} /> Bulk Import
          </button>
          <button onClick={async () => { setAddEmpId(nextAddId); setShowAdd(true); const id = await computeNextEmployeeId(); setAddEmpId(id); }} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa8] transition">
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] w-56"
          />
        </div>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
          {departmentOptions.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Emp ID</th>
                <th className="px-4 py-3 text-left">Profile</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Designation</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Work Mode</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">DOJ</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && <SkeletonTableRows rows={6} cols={10} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10}><EmptyState title="No employees found" subtitle={employees.length === 0 ? "Add your first employee to get started." : "No employees match the current search or filter."} /></td></tr>
              )}
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{emp.id}</td>
                  <td className="px-4 py-3">
                    {emp.photoURL ? (
                      <img src={emp.photoURL} alt={emp.name} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center font-semibold text-xs">
                        {initials(emp.name)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.designation}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {emp.department || "—"}
                    {emp.department?.trim() && !isKnownDepartment(emp.department, canonDeptSet) && (
                      <span title="Non-standard department — not in the configured department list. Edit to choose a standard department." className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 align-middle">⚠ non-standard</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${workModeColor[emp.workMode] ?? "bg-gray-100 text-gray-600"}`}>{emp.workMode}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{emp.employmentType}</td>
                  <td className={`px-4 py-3 text-xs ${!emp.doj?.trim() ? "text-red-500 font-medium" : "text-gray-600"}`}>{toISODate(emp.doj) || "⚠ missing"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[emp.status]}`}>{emp.status}</span>
                    {(!emp.designation?.trim() || !emp.doj?.trim()) && (
                      <span title="Incomplete profile — Designation and/or Date of Joining is missing. Edit to complete." className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 align-middle">⚠ Incomplete</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openView(emp)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500"><Eye size={14} /></button>
                      <button onClick={() => openEdit(emp)} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteEmp(emp)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {showBulk && (
        <BulkImportModal
          onImport={handleBulkImport}
          onClose={() => setShowBulk(false)}
          nextIdStart={Math.max(0, ...employees.map((e) => parseInt(e.id.replace("EMP", ""), 10)).filter((n) => !isNaN(n))) + 1}
          existingEmails={new Set(employees.map((e) => (e.email || "").trim().toLowerCase()).filter(Boolean))}
        />
      )}

      {/* Add Employee Modal */}
      {showAdd && (
        <FormModal
          title="Add New Employee"
          empId={addEmpId}
          form={form}
          setForm={setForm}
          onSave={handleAdd}
          onClose={() => { setShowAdd(false); setForm({ ...blankForm }); }}
          saveLabel="Add Employee"
          saving={saving}
        />
      )}

      {/* Edit Employee Modal */}
      {editEmp && editForm && (
        <FormModal
          title="Edit Employee"
          subtitle={`${editEmp.id} · ${editEmp.name}`}
          empId={editEmp.id}
          form={editForm}
          setForm={setEditForm as (f: FormState) => void}
          onSave={handleEditSave}
          onClose={() => { setEditEmp(null); setEditForm(null); }}
          saveLabel="Save Changes"
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteEmp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { if (!deleting) { setDeleteEmp(null); setDeleteError(null); } }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Delete Employee</h2>
                <p className="text-xs text-gray-400">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <span className="font-semibold text-gray-900">{deleteEmp.name}</span> ({deleteEmp.id})? All their data will be permanently removed.
            </p>
            {deleteError && (
              <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setDeleteEmp(null); setDeleteError(null); }} disabled={deleting} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-red-600 transition disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Deleting…</> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Employee Login Credentials Modal ── */}
      {createdCreds && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Employee Added Successfully</h2>
                <p className="text-xs text-gray-400">{createdCreds.email ? "Share these login details with the employee" : "Employee saved to Firebase"}</p>
              </div>
            </div>

            <div className="bg-[#F5F3FF] rounded-xl p-4 space-y-3 mb-4">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Name</p>
                <p className="text-sm font-semibold text-gray-900">{createdCreds.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Employee ID</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-mono text-gray-800">{createdCreds.empId}</p>
                  <button onClick={() => { navigator.clipboard.writeText(createdCreds.empId); setCopiedField("empId"); setTimeout(() => setCopiedField(""), 2000); }} className="shrink-0 text-xs text-[#4F3CC9] flex items-center gap-1 hover:underline">
                    {copiedField === "empId" ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
                    {copiedField === "empId" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              {createdCreds.email && [
                { label: "Email", value: createdCreds.email, key: "email" },
                { label: "Password", value: createdCreds.password, key: "password" },
              ].map(({ label, value, key }) => (
                <div key={key}>
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-mono text-gray-800">{value}</p>
                    <button
                      onClick={() => { navigator.clipboard.writeText(value); setCopiedField(key); setTimeout(() => setCopiedField(""), 2000); }}
                      className="shrink-0 text-xs text-[#4F3CC9] flex items-center gap-1 hover:underline"
                    >
                      {copiedField === key ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
                      {copiedField === key ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ))}
              {!createdCreds.email && (
                <p className="text-xs text-gray-500">No email provided — employee cannot log in to the portal. You can add an email by editing this employee.</p>
              )}
            </div>

            {createdCreds.email && (
              <>
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                  ⚠️ The employee can change their password after logging in via &quot;Forgot password?&quot;
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`Email: ${createdCreds.email}\nPassword: ${createdCreds.password}`);
                    setCopiedField("all");
                    setTimeout(() => setCopiedField(""), 2000);
                  }}
                  className="w-full mb-3 border border-[#4F3CC9] text-[#4F3CC9] py-2.5 rounded-xl text-sm font-semibold hover:bg-[#F5F3FF] transition flex items-center justify-center gap-2"
                >
                  {copiedField === "all" ? <CheckCircle2 size={15} className="text-green-500" /> : <Copy size={15} />}
                  {copiedField === "all" ? "Copied!" : "Copy Email & Password"}
                </button>
              </>
            )}

            <button
              onClick={() => setCreatedCreds(null)}
              className="w-full bg-[#4F3CC9] text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-[#3d2fa8] transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* View Profile Modal */}
      {viewEmp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setViewEmp(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b shrink-0">
              <h2 className="text-lg font-bold text-gray-900">Employee Profile</h2>
              <button onClick={() => setViewEmp(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Profile header */}
            <div className="px-6 py-4 flex items-center gap-4 border-b shrink-0">
              {viewEmp.photoURL ? (
                <img src={viewEmp.photoURL} alt={viewEmp.name} className="w-16 h-16 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center font-bold text-xl shrink-0">
                  {initials(viewEmp.name)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-lg font-bold text-gray-900">{viewEmp.name}</p>
                <p className="text-sm text-gray-500">{viewEmp.designation} · {viewEmp.id}</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[viewEmp.status]}`}>{viewEmp.status}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${workModeColor[viewEmp.workMode]}`}>{viewEmp.workMode}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">{viewEmp.employmentType}</span>
                </div>
              </div>
            </div>

            {/* Inner tabs */}
            <div className="flex gap-1 px-6 pt-3 shrink-0">
              {(["info", "employment", "documents"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setViewTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition capitalize ${viewTab === t ? "bg-[#EDE9FF] text-[#4F3CC9]" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  {t === "info" ? "Personal Info" : t === "employment" ? "Employment" : "Documents"}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              {viewTab === "info" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-gray-400">Full Name</p><p className="font-medium">{viewEmp.name || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Gender</p><p className="font-medium">{viewEmp.gender || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Date of Birth</p><p className="font-medium">{toISODate(viewEmp.dob) || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Blood Group</p><p className="font-medium">{viewEmp.bloodGroup || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Work Email</p><p className="font-medium text-xs break-all">{viewEmp.email || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Personal Email</p><p className="font-medium text-xs break-all">{viewEmp.personalEmail || "—"}</p></div>
                    <div><p className="text-xs text-gray-400">Phone Number</p><p className="font-medium">{viewEmp.phone || "—"}</p></div>
                    <div>
                      <p className="text-xs text-gray-400">Emergency Contact</p>
                      <p className="font-medium">{viewEmp.emergencyName || "—"}</p>
                      <p className="text-xs text-gray-500">{viewEmp.emergencyContact || ""}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Current Address</p>
                    <p className="text-sm font-medium bg-gray-50 rounded-xl px-3 py-2">{viewEmp.currentAddress || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Permanent Address</p>
                    <p className="text-sm font-medium bg-gray-50 rounded-xl px-3 py-2">{viewEmp.permanentAddress || "—"}</p>
                  </div>
                </div>
              )}

              {viewTab === "employment" && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Employee ID</p><p className="font-mono font-medium">{viewEmp.id}</p></div>
                  <div><p className="text-xs text-gray-400">Designation</p><p className="font-medium">{viewEmp.designation || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Department</p><p className="font-medium">{viewEmp.department}</p></div>
                  <div><p className="text-xs text-gray-400">Employment Type</p><p className="font-medium">{viewEmp.employmentType}</p></div>
                  <div><p className="text-xs text-gray-400">Work Mode</p><p className="font-medium">{viewEmp.workMode}</p></div>
                  <div><p className="text-xs text-gray-400">Date of Joining</p><p className="font-medium">{toISODate(viewEmp.doj) || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Reporting Manager</p><p className="font-medium">{viewEmp.reportingManager || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Status</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[viewEmp.status]}`}>{viewEmp.status}</span>
                  </div>
                  <div className="col-span-2 mt-2">
                    <p className="text-xs text-gray-500">• Joined as {viewEmp.designation || "employee"} on {toISODate(viewEmp.doj) || "N/A"}</p>
                  </div>
                </div>
              )}

              {viewTab === "documents" && (
                <div className="space-y-4">
                  {/* HR-managed documents */}
                  <div>
                    <p className="text-xs font-semibold text-[#4F3CC9] uppercase tracking-wide mb-2">HR Documents</p>
                    {[
                      { id: "offer-letter",      name: "Offer Letter"      },
                      { id: "internship-letter", name: "Internship Letter" },
                    ].map((slot) => {
                      const stored = hrDocs[slot.id];
                      const isUploading = hrUploadingSlot === slot.id;
                      return (
                        <div key={slot.id} className="flex items-center justify-between px-3 py-3 rounded-xl bg-gray-50 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[#EDE9FF] flex items-center justify-center shrink-0">
                              <FileText size={14} className="text-[#4F3CC9]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{slot.name}</p>
                              {stored?.fileName && (
                                <p className="text-xs text-gray-400 truncate">{stored.fileName}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {isUploading ? (
                              <div className="flex items-center gap-2 w-28">
                                <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                                  <div className="bg-[#4F3CC9] h-1.5 rounded-full transition-all" style={{ width: `${hrUploadProgress}%` }} />
                                </div>
                                <span className="text-xs text-[#4F3CC9] font-medium">{hrUploadProgress}%</span>
                              </div>
                            ) : stored?.status === "Uploaded" ? (
                              <>
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                                  <CheckCircle size={10} /> Uploaded
                                </span>
                                {stored.fileUrl && (
                                  <a href={stored.fileUrl} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-1 text-xs text-white bg-[#4F3CC9] hover:bg-[#3d2fa3] px-2.5 py-1 rounded-full transition-colors">
                                    <Eye size={11} /> View
                                  </a>
                                )}
                                <button
                                  onClick={() => { setHrPendingSlot(slot.id); hrFileInputRef.current?.click(); }}
                                  className="text-xs text-gray-500 border border-gray-200 hover:border-[#4F3CC9] hover:text-[#4F3CC9] px-2.5 py-1 rounded-full transition-colors"
                                >
                                  Replace
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                                  <Clock size={10} /> Pending
                                </span>
                                <button
                                  onClick={() => { setHrPendingSlot(slot.id); hrFileInputRef.current?.click(); }}
                                  className="flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9] hover:bg-[#EDE9FF] px-2.5 py-1 rounded-full transition-colors font-medium"
                                >
                                  <Upload size={11} /> Upload
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Employee-submitted documents */}
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Employee Documents</p>
                    {viewEmp.documents.filter(d => d.name !== "Offer Letter" && d.name !== "Internship Letter").map((doc) => (
                      <div key={doc.name} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 mb-2">
                        <span className="text-sm text-gray-700 font-medium">{doc.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${doc.status === "Uploaded" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                          {doc.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Toast */}
                  {hrDocToast && (
                    <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
                      {hrDocToast}
                    </div>
                  )}

                  {/* Hidden file input for HR uploads */}
                  <input
                    ref={hrFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      const slot = [
                        { id: "offer-letter", name: "Offer Letter" },
                        { id: "internship-letter", name: "Internship Letter" },
                      ].find(s => s.id === hrPendingSlot);
                      if (file && slot) handleHrUpload(slot, file);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
