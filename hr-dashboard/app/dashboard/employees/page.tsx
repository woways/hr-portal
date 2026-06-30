"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Eye, Pencil, Trash2, X, Plus, Search, Upload, Download, Rows3, Copy, CheckCircle2, FileText, Clock, CheckCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { firebaseConfig, db, storage } from "@/lib/firebase";
import { createUserProfile } from "@/lib/authService";
import { getEmployees, upsertEmployee, updateEmployee, deleteEmployee } from "@/lib/firebaseService";
import { uploadDocFile, saveDocMeta, loadDocMeta, StoredDoc } from "@/lib/documentService";

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

interface Employee {
  id: string;
  name: string;
  designation: string;
  department: string;
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

const empDefaults = {
  nationality: "Indian", maritalStatus: "Single", fatherSpouseName: "",
  alternatePhone: "", city: "", state: "", pinCode: "",
  branch: "Bengaluru HQ", shift: "9AM–6PM", ctc: "", noticePeriod: "30 Days", probationEndDate: "",
  panNumber: "", aadharNumber: "", pfNumber: "", uanNumber: "",
  bankName: "", accountHolderName: "", accountNumber: "", ifscCode: "",
  highestQualification: "Bachelor's", institution: "", yearOfPassing: "", specialization: "", skills: "",
};

const initialEmployees: Employee[] = [];

const depts = ["All", "Engineering", "Marketing", "Sales", "HR", "Finance", "Operations"];
const managers: string[] = [];

const blankForm: Omit<Employee, "id"> = {
  name: "", designation: "", department: "Engineering", reportingManager: "",
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

const statusColor: Record<EmployeeStatus, string> = {
  Active: "bg-green-100 text-green-700",
  "On Leave": "bg-yellow-100 text-yellow-700",
  Probation: "bg-orange-100 text-orange-700",
  Exited: "bg-red-100 text-red-700",
};
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
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

        {/* Form body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">

          {/* ── Basic Info ── */}
          {tab === "basic" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Employee ID</label>
                <input value={empId} readOnly className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-gray-50" />
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
                <input type="date" value={form.dob} onChange={(e) => f("dob", e.target.value)} className={inputCls} />
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
                <label className={labelCls}>Father's / Spouse's Name</label>
                <input value={form.fatherSpouseName} onChange={(e) => f("fatherSpouseName", e.target.value)} placeholder="Name" className={inputCls} />
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
                <input value={form.phone} onChange={(e) => f("phone", e.target.value)} placeholder="+91 9876543210" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Alternate Phone</label>
                <input value={form.alternatePhone} onChange={(e) => f("alternatePhone", e.target.value)} placeholder="+91 9800000000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Emergency Contact Name</label>
                <input value={form.emergencyName} onChange={(e) => f("emergencyName", e.target.value)} placeholder="Parent / Spouse name" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Emergency Contact Number *</label>
                <input value={form.emergencyContact} onChange={(e) => f("emergencyContact", e.target.value)} placeholder="+91 9876543200" className={inputCls} />
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
                <input value={form.designation} onChange={(e) => f("designation", e.target.value)} placeholder="e.g. Software Engineer" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <select value={form.department} onChange={(e) => f("department", e.target.value)} className={selectCls}>
                  {["Engineering","Marketing","Sales","HR","Finance","Operations"].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Reporting Manager</label>
                <input type="text" placeholder="Enter manager name" value={form.reportingManager} onChange={(e) => f("reportingManager", e.target.value)} className={inputCls} />
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
                <select value={form.status} onChange={(e) => f("status", e.target.value as EmployeeStatus)} className={selectCls}>
                  {["Active","On Leave","Probation","Exited"].map(s => <option key={s}>{s}</option>)}
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
                <label className={labelCls}>CTC (Annual)</label>
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
                <select value={form.highestQualification} onChange={(e) => f("highestQualification", e.target.value)} className={selectCls}>
                  {["High School","Diploma","Bachelor's","Master's","MBA","PhD","Other"].map(q => <option key={q}>{q}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Specialization / Stream</label>
                <input value={form.specialization} onChange={(e) => f("specialization", e.target.value)} placeholder="e.g. Computer Science" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Institution / University</label>
                <input value={form.institution} onChange={(e) => f("institution", e.target.value)} placeholder="e.g. IIT Bombay" className={inputCls} />
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
                <select value={form.bankName} onChange={(e) => f("bankName", e.target.value)} className={selectCls}>
                  {["","SBI","HDFC Bank","ICICI Bank","Axis Bank","Kotak Mahindra","Yes Bank","Bank of Baroda","Punjab National Bank","Other"].map(b => <option key={b}>{b}</option>)}
                </select>
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
  "name","email","phone","designation","department","workMode","employmentType",
  "doj","gender","dob","reportingManager","branch","shift","ctc","noticePeriod",
  "status","city","state","pinCode","skills",
] as const;
type CsvCol = typeof CSV_HEADERS[number];

type BulkRow = Record<CsvCol, string> & { _err?: string };

const BLANK_BULK_ROW = (): BulkRow =>
  Object.fromEntries(CSV_HEADERS.map((h) => [h, ""])) as BulkRow;

function parseCsv(text: string): BulkRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = BLANK_BULK_ROW();
    headers.forEach((h, i) => { if (h in row) (row as Record<string, string>)[h] = vals[i] ?? ""; });
    if (!row.name) row._err = "Name is required";
    else if (!row.email) row._err = "Email is required";
    return row;
  });
}

function rowToEmployee(row: BulkRow, id: string): Employee {
  return {
    ...empDefaults,
    id,
    name: row.name, email: row.email, phone: row.phone,
    designation: row.designation, department: row.department || "Engineering",
    workMode: (row.workMode as WorkMode) || "Remote",
    employmentType: (row.employmentType as EmpType) || "Full-Time",
    doj: row.doj, gender: row.gender || "Male", dob: row.dob,
    reportingManager: row.reportingManager || "",
    branch: row.branch || "Bengaluru HQ", shift: row.shift || "9AM–6PM",
    ctc: row.ctc, noticePeriod: row.noticePeriod || "30 Days",
    status: (row.status as EmployeeStatus) || "Active",
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

function BulkImportModal({ onImport, onClose, nextIdStart }: {
  onImport: (emps: Employee[]) => void;
  onClose: () => void;
  nextIdStart: number;
}) {
  const [mode, setMode] = useState<"multi" | "csv">("multi");
  const [rows, setRows] = useState<BulkRow[]>([BLANK_BULK_ROW(), BLANK_BULK_ROW(), BLANK_BULK_ROW()]);
  const [csvRows, setCsvRows] = useState<BulkRow[]>([]);
  const [csvName, setCsvName] = useState("");
  const [toast, setToast] = useState("");

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
    const valid = source.filter((r) => r.name.trim() && r.email.trim() && !r._err);
    if (valid.length === 0) { setToast("No valid rows to import."); setTimeout(() => setToast(""), 3000); return; }
    const emps = valid.map((r, i) =>
      rowToEmployee(r, `EMP${String(nextIdStart + i).padStart(3, "0")}`)
    );
    onImport(emps);
  }

  const previewRows = mode === "multi" ? rows : csvRows;
  const validCount = previewRows.filter((r) => r.name.trim() && r.email.trim() && !r._err).length;

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
                      <th className="px-2 py-2 text-left min-w-[90px]">Work Mode</th>
                      <th className="px-2 py-2 text-left min-w-[90px]">Type</th>
                      <th className="px-2 py-2 text-left min-w-[100px]">Date of Join</th>
                      <th className="px-2 py-2 text-left min-w-[80px]">Gender</th>
                      <th className="px-2 py-2 text-left min-w-[80px]">Status</th>
                      <th className="px-2 py-2 w-7"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row, i) => (
                      <tr key={i} className={row._err ? "bg-red-50" : "hover:bg-gray-50"}>
                        <td className="px-2 py-2 text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-2 py-2">
                          <input value={row.name} onChange={(e) => setCell(i, "name", e.target.value)} placeholder="Full Name" className={`${inputCls} ${row._err ? "border-red-300" : ""}`} />
                          {row._err && <p className="text-red-500 text-[10px] mt-0.5">{row._err}</p>}
                        </td>
                        <td className="px-2 py-2"><input value={row.email} onChange={(e) => setCell(i, "email", e.target.value)} placeholder="name@woways.in" className={inputCls} /></td>
                        <td className="px-2 py-2"><input value={row.phone} onChange={(e) => setCell(i, "phone", e.target.value)} placeholder="+91 98..." className={inputCls} /></td>
                        <td className="px-2 py-2"><input value={row.designation} onChange={(e) => setCell(i, "designation", e.target.value)} placeholder="Software Eng." className={inputCls} /></td>
                        <td className="px-2 py-2">
                          <select value={row.department || "Engineering"} onChange={(e) => setCell(i, "department", e.target.value)} className={selectCls}>
                            {["Engineering","Marketing","Sales","HR","Finance","Operations"].map(d => <option key={d}>{d}</option>)}
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
                          <select value={row.status || "Active"} onChange={(e) => setCell(i, "status", e.target.value)} className={selectCls}>
                            {["Active","Probation","Intern","On Leave"].map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-400 transition"><X size={14} /></button>
                        </td>
                      </tr>
                    ))}
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
                  <p className="text-xs font-medium text-gray-600 mb-2">{csvRows.length} rows detected — preview:</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#F5F3FF] text-gray-500 uppercase">
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Email</th>
                          <th className="px-3 py-2 text-left">Designation</th>
                          <th className="px-3 py-2 text-left">Department</th>
                          <th className="px-3 py-2 text-left">DOJ</th>
                          <th className="px-3 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {csvRows.map((r, i) => (
                          <tr key={i} className={r._err ? "bg-red-50" : ""}>
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 font-medium">{r.name || <span className="text-red-400">—</span>}</td>
                            <td className="px-3 py-2 text-gray-600">{r.email || <span className="text-red-400">—</span>}</td>
                            <td className="px-3 py-2 text-gray-600">{r.designation || "—"}</td>
                            <td className="px-3 py-2 text-gray-600">{r.department || "—"}</td>
                            <td className="px-3 py-2 text-gray-600">{r.doj || "—"}</td>
                            <td className="px-3 py-2">
                              {r._err
                                ? <span className="text-red-500">{r._err}</span>
                                : <span className="text-green-600">✓ Valid</span>
                              }
                            </td>
                          </tr>
                        ))}
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
          {!toast && <span className="text-xs text-gray-400 mr-auto">{validCount} valid employee{validCount !== 1 ? "s" : ""} ready to import</span>}
          <button onClick={onClose} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleImport}
            disabled={validCount === 0}
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
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
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
      const data: Employee[] = docs.map((d) => {
        const r = d as Record<string, unknown>;
        return {
          id: (r.employeeId ?? r.id) as string,
          name: (r.name as string) ?? "",
          designation: (r.designation as string) ?? "",
          department: (r.department as string) ?? "",
          workMode: ((r.workMode as WorkMode) ?? "Remote"),
          employmentType: ((r.employmentType as EmpType) ?? "Full-Time"),
          doj: (r.doj as string) ?? "",
          status: ((r.status as EmployeeStatus) ?? "Active"),
          email: (r.email as string) ?? "",
          phone: (r.phone as string) ?? "",
          emergencyContact: (r.emergencyContact as string) ?? "",
          emergencyName: (r.emergencyName as string) ?? "",
          reportingManager: (r.reportingManager as string) ?? "",
          gender: (r.gender as string) ?? "",
          dob: (r.dob as string) ?? "",
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
        };
      });
      setEmployees(data);
    } catch (err) {
      setAddToast({ msg: "Failed to load employees. Please refresh and try again.", ok: false });
      setTimeout(() => setAddToast(null), 5000);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

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
      setHrDocToast("Upload failed. Please try again.");
      setTimeout(() => setHrDocToast(null), 3000);
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
    if (!form.name.trim()) {
      setAddToast({ msg: "Employee name is required.", ok: false });
      setTimeout(() => setAddToast(null), 3500);
      return;
    }
    if (saving) return;
    setSaving(true);

    const nums = employees.map((e) => parseInt(e.id.replace("EMP", ""), 10)).filter((n) => !isNaN(n));
    const next = Math.max(0, ...nums) + 1;
    const newId = `EMP${String(next).padStart(3, "0")}`;
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

    // Reload from Firestore to confirm persistence
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
    const results = await Promise.allSettled(emps.map((emp) => {
      const { id, ...rest } = emp;
      return upsertEmployee(id, { ...rest, employeeId: id });
    }));
    const failed = results.filter(r => r.status === "rejected").length;
    const succeeded = emps.length - failed;
    if (failed > 0) showToast(succeeded + " imported, " + failed + " failed.", false);
    else showToast("All " + emps.length + " employees imported.");
    await loadEmployees();
    setShowBulk(false);
  }

  async function handleDelete() {
    if (!deleteEmp) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteEmployee(deleteEmp.id);
      setEmployees(employees.filter((e) => e.id !== deleteEmp.id));
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
    setEditForm({ ...rest });
  }

  async function handleEditSave() {
    if (!editForm || !editEmp) return;
    try {
      await updateEmployee(editEmp.id, { ...editForm, employeeId: editEmp.id });
      setEditEmp(null);
      setEditForm(null);
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
      "Date of Joining": e.doj,
      "Status": e.status,
      "Work Email": e.email,
      "Phone": e.phone,
      "Reporting Manager": e.reportingManager,
      "Branch": e.branch,
      "Shift": e.shift,
      "CTC": e.ctc,
      "Notice Period": e.noticePeriod,
      "Gender": e.gender,
      "Date of Birth": e.dob,
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

  const nums = employees.map((e) => parseInt(e.id.replace("EMP", ""), 10)).filter((n) => !isNaN(n));
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
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-[#3d2fa8] transition">
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
          {depts.map((d) => <option key={d}>{d}</option>)}
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
              {loading && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 text-sm">Loading employees...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 text-sm">No employees found.</td></tr>
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
                  <td className="px-4 py-3 text-gray-600">{emp.department}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${workModeColor[emp.workMode]}`}>{emp.workMode}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{emp.employmentType}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{emp.doj}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[emp.status]}`}>{emp.status}</span>
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
        />
      )}

      {/* Add Employee Modal */}
      {showAdd && (
        <FormModal
          title="Add New Employee"
          empId={nextAddId}
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
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
                ⚠️ The employee can change their password after logging in via "Forgot password?"
              </p>
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
                    <div><p className="text-xs text-gray-400">Date of Birth</p><p className="font-medium">{viewEmp.dob || "—"}</p></div>
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
                  <div><p className="text-xs text-gray-400">Date of Joining</p><p className="font-medium">{viewEmp.doj || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Reporting Manager</p><p className="font-medium">{viewEmp.reportingManager || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Status</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[viewEmp.status]}`}>{viewEmp.status}</span>
                  </div>
                  <div className="col-span-2 mt-2">
                    <p className="text-xs text-gray-500">• Joined as {viewEmp.designation || "employee"} on {viewEmp.doj || "N/A"}</p>
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
