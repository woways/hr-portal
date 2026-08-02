"use client";
import { useState, useRef, useEffect } from "react";
import {
  reauthenticateWithCredential, EmailAuthProvider,
  updatePassword, sendPasswordResetEmail, onAuthStateChanged,
} from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, query, where, getDocs, getDoc, doc as fsDocQ, updateDoc, deleteField } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getUserProfile } from "@/lib/authService";
import { uploadDocFile, saveDocMeta, loadDocMeta, deleteDocMeta, resetDocSlot } from "@/lib/documentService";
import {
  User,
  Building2,
  Briefcase,
  MapPin,
  FileText,
  CheckCircle,
  Clock,
  Edit2,
  Save,
  Upload,
  Download,
  Eye,
  EyeOff,
  Lock,
  X,
  AlertCircle,
  Trash2,
  GraduationCap,
  Plus,
} from "lucide-react";

type ProfileTab = "Overview" | "Personal Details" | "Employment Details" | "Documents" | "Settings";

interface EduEntry {
  id: string;
  degree: string;
  specialisation: string;
  isCurrentlyStudent: boolean;
  startDate: string;
  completionDate: string;
  institute: string;
  university: string;
  grade: string;
  state: string;
  country: string;
  certificateFile?: string;
  certificateName?: string;
}

const DEGREES = [
  "Secondary School (SSC / 10th)",
  "Higher Secondary (HSC / 12th)",
  "Diploma",
  "Bachelor of Technology - BTech",
  "Bachelor of Engineering - BE",
  "Bachelor of Science - BSc",
  "Bachelor of Commerce - BCom",
  "Bachelor of Arts - BA",
  "Bachelor of Business Administration - BBA",
  "Master of Technology - MTech",
  "Master of Engineering - ME",
  "Master of Science - MSc",
  "Master of Business Administration - MBA",
  "Master of Arts - MA",
  "Doctor of Philosophy - PhD",
  "Other",
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const YEARS = Array.from({ length: 30 }, (_, i) => String(2025 - i));

// ── Work Experience ──────────────────────────────────────────
interface WorkExp {
  id: string; company: string; role: string; empType: string;
  startMonth: string; startYear: string; endMonth: string; endYear: string;
  currentlyWorking: boolean; location: string; description: string;
}
const EMP_TYPES = ["Full-Time","Part-Time","Internship","Freelance","Contract"];

// Module-level so its identity is stable across renders. Defining this inside a
// render/map recreates the component every keystroke, which remounts the inputs
// and drops focus (PROF-002).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

function WorkExperienceSection({ empId }: { empId?: string | null }) {
  const blank = (): WorkExp => ({ id: Date.now().toString(), company: "", role: "", empType: "Full-Time", startMonth: "", startYear: "", endMonth: "", endYear: "", currentlyWorking: false, location: "", description: "" });
  const [list, setList] = useState<WorkExp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkExp | null>(null);
  const [error, setError] = useState("");

  // Validate the draft before saving so blank entries can't be added.
  function saveDraft(d: WorkExp) {
    if (!d.company.trim() || !d.role.trim()) {
      setError("Please enter at least the company and job title before saving.");
      return;
    }
    setError("");
    saveList(list.map((x) => x.id === d.id ? d : x));
  }

  // Load from Firestore on mount
  useEffect(() => {
    if (!empId) return;
    import("firebase/firestore").then(({ getDoc, doc: fsD }) =>
      import("@/lib/firebase").then(({ db }) =>
        getDoc(fsD(db, "employees", empId)).then((snap) => {
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            if (Array.isArray(d.workExperience)) setList(d.workExperience as WorkExp[]);
          }
        })
      )
    ).catch(() => {});
  }, [empId]);

  async function saveList(next: WorkExp[]) {
    setList(next); setEditId(null); setDraft(null);
    if (!empId) return;
    try {
      const { updateDoc: ud, doc: fsD } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      await ud(fsD(db, "employees", empId), { workExperience: next, updatedAt: new Date().toISOString() });
    } catch { /* ignore */ }
  }

  const inp = (f: keyof WorkExp) => <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={(draft![f] as string) ?? ""} onChange={(e) => setDraft({ ...draft!, [f]: e.target.value })} />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Briefcase size={16} className="text-[#4F3CC9]" /> Work Experience</h3>
        <button onClick={() => { const e = blank(); setList((p) => { const n = [...p, e]; return n; }); setEditId(e.id); setDraft(e); }} className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF]"><Plus size={13} /> Add Experience</button>
      </div>
      <div className="space-y-4">
        {list.map((w) => {
          const isEd = editId === w.id && draft;
          const d = isEd ? draft! : w;
          return (
            <div key={w.id} className="border border-gray-100 rounded-2xl p-5 relative">
              <div className="absolute top-4 right-4 flex gap-2">
                {!isEd ? (
                  <><button onClick={() => { setEditId(w.id); setDraft({ ...w }); }} className="p-1.5 rounded-lg hover:bg-[#EDE9FF] text-[#4F3CC9]"><Edit2 size={13} /></button><button onClick={() => saveList(list.filter((x) => x.id !== w.id))} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={13} /></button></>
                ) : (
                  <><button onClick={() => saveDraft(d)} className="flex items-center gap-1 text-xs bg-[#4F3CC9] text-white px-3 py-1.5 rounded-full"><Save size={12} /> Save</button><button onClick={() => { setEditId(null); setDraft(null); setError(""); if (!w.company) setList((p) => p.filter((x) => x.id !== w.id)); }} className="text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full">Cancel</button></>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 pr-24">
                <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">Company / Organisation</p>{isEd ? inp("company") : <p className="text-sm font-semibold text-gray-900">{d.company || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Job Title / Role</p>{isEd ? inp("role") : <p className="text-sm font-medium text-gray-900">{d.role || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Employment Type</p>{isEd ? <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.empType} onChange={(e) => setDraft({ ...d, empType: e.target.value })}>{EMP_TYPES.map((t) => <option key={t}>{t}</option>)}</select> : <p className="text-sm font-medium text-gray-900">{d.empType}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Location</p>{isEd ? inp("location") : <p className="text-sm font-medium text-gray-900">{d.location || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">I Currently Work Here</p>{isEd ? <div className="flex gap-2">{["Yes","No"].map((v) => <button key={v} onClick={() => setDraft({ ...d, currentlyWorking: v === "Yes" })} className={`px-4 py-1.5 rounded-xl text-sm font-semibold border ${(d.currentlyWorking ? "Yes" : "No") === v ? "bg-[#4F3CC9] text-white border-[#4F3CC9]" : "bg-white text-gray-500 border-gray-200"}`}>{v}</button>)}</div> : <p className="text-sm font-medium text-gray-900">{d.currentlyWorking ? "Yes" : "No"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Start</p>{isEd ? <div className="flex gap-2"><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.startMonth} onChange={(e) => setDraft({ ...d, startMonth: e.target.value })}><option value="">Month</option>{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => <option key={m}>{m}</option>)}</select><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.startYear} onChange={(e) => setDraft({ ...d, startYear: e.target.value })}><option value="">Year</option>{Array.from({length:30},(_,i)=>String(2025-i)).map((y) => <option key={y}>{y}</option>)}</select></div> : <p className="text-sm font-medium text-gray-900">{d.startMonth} {d.startYear}</p>}</div>
                {!d.currentlyWorking && <div><p className="text-xs text-gray-400 mb-1">End</p>{isEd ? <div className="flex gap-2"><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.endMonth} onChange={(e) => setDraft({ ...d, endMonth: e.target.value })}><option value="">Month</option>{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => <option key={m}>{m}</option>)}</select><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.endYear} onChange={(e) => setDraft({ ...d, endYear: e.target.value })}><option value="">Year</option>{Array.from({length:30},(_,i)=>String(2025-i)).map((y) => <option key={y}>{y}</option>)}</select></div> : <p className="text-sm font-medium text-gray-900">{d.endMonth} {d.endYear}</p>}</div>}
                <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">Description / Key Responsibilities</p>{isEd ? <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none" value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} /> : <p className="text-sm text-gray-700">{d.description || "—"}</p>}</div>
              </div>
              {isEd && error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No work experience added. Click &quot;Add Experience&quot; to get started.</p>}
      </div>
    </div>
  );
}

// ── Skills & Languages ────────────────────────────────────────
async function saveSkillsFirestore(empId: string, skills: string[], langs: {lang:string;level:string}[]) {
  try {
    const { updateDoc: ud, doc: fsD } = await import("firebase/firestore");
    const { db } = await import("@/lib/firebase");
    await ud(fsD(db, "employees", empId), { skills, languages: langs, updatedAt: new Date().toISOString() });
  } catch { /* ignore */ }
}

function SkillsSection({ empId }: { empId?: string | null }) {
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<{lang:string;level:string}[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [newLang, setNewLang] = useState({lang:"",level:"Beginner"});
  const LEVELS = ["Beginner","Intermediate","Fluent","Native"];

  useEffect(() => {
    if (!empId) return;
    import("firebase/firestore").then(({ getDoc, doc: fsD }) =>
      import("@/lib/firebase").then(({ db }) =>
        getDoc(fsD(db, "employees", empId)).then((snap) => {
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            if (Array.isArray(d.skills)) setSkills(d.skills as string[]);
            if (Array.isArray(d.languages)) setLangs(d.languages as {lang:string;level:string}[]);
          }
        })
      )
    ).catch(() => {});
  }, [empId]);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><User size={16} className="text-[#4F3CC9]" /> Skills</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {skills.map((s) => <span key={s} className="flex items-center gap-1.5 px-3 py-1 bg-[#EDE9FF] text-[#4F3CC9] rounded-full text-sm font-medium">{s}<button onClick={() => { const next = skills.filter((x) => x !== s); setSkills(next); if (empId) saveSkillsFirestore(empId, next, langs); }} className="text-[#4F3CC9]/50 hover:text-[#4F3CC9]"><X size={12} /></button></span>)}
        </div>
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" placeholder="Add a skill..." value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newSkill.trim()) { const next = [...skills, newSkill.trim()]; setSkills(next); setNewSkill(""); if (empId) saveSkillsFirestore(empId, next, langs); }}} />
          <button onClick={() => { if (newSkill.trim()) { const next = [...skills, newSkill.trim()]; setSkills(next); setNewSkill(""); if (empId) saveSkillsFirestore(empId, next, langs); }}} className="px-4 py-2 bg-[#4F3CC9] text-white rounded-xl text-sm font-medium hover:bg-[#3d2fa3]"><Plus size={14} /></button>
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Languages Known</h3>
        <div className="space-y-2 mb-3">
          {langs.map((l, i) => <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl"><div><p className="text-sm font-medium text-gray-900">{l.lang}</p><p className="text-xs text-gray-400">{l.level}</p></div><button onClick={() => { const next = langs.filter((_, idx) => idx !== i); setLangs(next); if (empId) saveSkillsFirestore(empId, skills, next); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></div>)}
        </div>
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" placeholder="Language" value={newLang.lang} onChange={(e) => setNewLang({ ...newLang, lang: e.target.value })} />
          <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={newLang.level} onChange={(e) => setNewLang({ ...newLang, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          <button onClick={() => { if (newLang.lang.trim()) { const next = [...langs, newLang]; setLangs(next); setNewLang({ lang: "", level: "Beginner" }); if (empId) saveSkillsFirestore(empId, skills, next); }}} className="px-4 py-2 bg-[#4F3CC9] text-white rounded-xl text-sm font-medium hover:bg-[#3d2fa3]"><Plus size={14} /></button>
        </div>
      </div>
    </div>
  );
}

// ── Government IDs ────────────────────────────────────────────
function GovtIdSection({ empId }: { empId?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ aadhar: "", pan: "", passport: "", drivingLicense: "", dob: "", bloodGroup: "", gender: "", maritalStatus: "", nationality: "" });
  const [draft, setDraft] = useState({ ...form });
  const [error, setError] = useState("");

  // Format checks for structured fields (each only enforced when non-empty).
  function validate(): string | null {
    const pan = draft.pan.trim().toUpperCase();
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return "PAN must be 10 characters in the format ABCDE1234F.";
    const aadhar = draft.aadhar.replace(/\s/g, "");
    if (aadhar && !/^\d{12}$/.test(aadhar)) return "Aadhar number must be exactly 12 digits.";
    const passport = draft.passport.trim().toUpperCase();
    if (passport && !/^[A-Z][0-9]{7}$/.test(passport)) return "Passport must be 1 letter followed by 7 digits (e.g. A1234567).";
    const bg = draft.bloodGroup.trim().toUpperCase();
    if (bg && !["A+","A-","B+","B-","O+","O-","AB+","AB-"].includes(bg)) return "Blood group must be one of A+, A-, B+, B-, O+, O-, AB+, AB-.";
    if (draft.dob) {
      const d = new Date(draft.dob);
      if (isNaN(d.getTime())) return "Please enter a valid date of birth (YYYY-MM-DD).";
      if (d > new Date()) return "Date of birth cannot be in the future.";
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    // Normalise the structured values before saving.
    const normalized = {
      ...draft,
      pan: draft.pan.trim().toUpperCase(),
      aadhar: draft.aadhar.replace(/\s/g, ""),
      passport: draft.passport.trim().toUpperCase(),
      bloodGroup: draft.bloodGroup.trim().toUpperCase(),
    };
    setForm(normalized); setDraft(normalized); setEditing(false);
    if (!empId) return;
    try {
      const { updateDoc: ud, doc: fsD } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      await ud(fsD(db, "employees", empId), {
        aadharNumber: normalized.aadhar, panNumber: normalized.pan, passport: normalized.passport,
        drivingLicense: normalized.drivingLicense, dob: normalized.dob, bloodGroup: normalized.bloodGroup,
        gender: normalized.gender, maritalStatus: normalized.maritalStatus, nationality: normalized.nationality,
        updatedAt: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!empId) return;
    import("firebase/firestore").then(({ getDoc, doc: fsD }) =>
      import("@/lib/firebase").then(({ db }) =>
        getDoc(fsD(db, "employees", empId)).then((snap) => {
          if (!snap.exists()) return;
          const d = snap.data() as Record<string, unknown>;
          const loaded = {
            aadhar:         String(d.aadharNumber ?? d.aadhar ?? ""),
            pan:            String(d.panNumber    ?? d.pan    ?? ""),
            passport:       String(d.passport       ?? ""),
            drivingLicense: String(d.drivingLicense ?? ""),
            dob:            String(d.dob ?? d.dateOfBirth ?? ""),
            bloodGroup:     String(d.bloodGroup      ?? ""),
            gender:         String(d.gender          ?? ""),
            maritalStatus:  String(d.maritalStatus   ?? ""),
            nationality:    String(d.nationality     ?? ""),
          };
          setForm(loaded); setDraft(loaded);
        })
      )
    ).catch(() => {});
  }, [empId]);
  const inp = (f: keyof typeof draft, label: string) => (
    <div key={f}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {editing ? <input type={f === "dob" ? "date" : "text"} max={f === "dob" ? new Date().toISOString().split("T")[0] : undefined} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} /> : <p className="text-sm font-medium text-gray-900">{form[f] || "—"}</p>}
    </div>
  );
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Lock size={16} className="text-[#4F3CC9]" /> Personal & Government IDs</h3>
        {!editing ? <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium hover:underline"><Edit2 size={14} /> Edit</button> : <div className="flex gap-2"><button onClick={() => { setEditing(false); setError(""); setDraft({ ...form }); }} className="text-sm text-gray-500 font-medium">Cancel</button><button onClick={handleSave} className="flex items-center gap-1 text-xs bg-[#4F3CC9] text-white px-4 py-1.5 rounded-full"><Save size={12} /> Save</button></div>}
      </div>
      {editing && error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        {inp("dob","Date of Birth")}
        {inp("gender","Gender")}
        {inp("bloodGroup","Blood Group")}
        {inp("maritalStatus","Marital Status")}
        {inp("nationality","Nationality")}
        {inp("aadhar","Aadhar Number")}
        {inp("pan","PAN Number")}
        {inp("passport","Passport Number")}
        {inp("drivingLicense","Driving License")}
      </div>
    </div>
  );
}

const INIT_EDUCATION: EduEntry[] = [];

interface DocItem {
  id: string;
  name: string;
  category: string;
  status: "Uploaded" | "Pending";
  fileUrl?: string;
  fileName?: string;
  fileExt?: string;
  fileSize?: number;
  storagePath?: string;
  isExtra?: boolean;
  hrOnly?: boolean;
}

const PREDEFINED_DOCS: DocItem[] = [
  { id: "pan-card",          name: "PAN Card",                 category: "Identity"    , status: "Pending" },
  { id: "aadhar",            name: "Aadhar Card",              category: "Identity"    , status: "Pending" },
  { id: "10th-memo",         name: "10th Marks Memo",          category: "Education"   , status: "Pending" },
  { id: "inter-memo",        name: "Intermediate Memo (12th)", category: "Education"   , status: "Pending" },
  { id: "degree",            name: "Degree Certificate",       category: "Education"   , status: "Pending" },
  { id: "resume",            name: "Resume / CV",              category: "Professional", status: "Pending" },
  { id: "offer-letter",      name: "Offer Letter",             category: "Employment"  , status: "Pending", hrOnly: true },
  { id: "internship-letter", name: "Internship Letter",        category: "Employment"  , status: "Pending", hrOnly: true },
  { id: "bank-proof",        name: "Bank Passbook / Cheque",   category: "Financial"   , status: "Pending" },
];

const DOC_STYLE: Record<string, { iconBg: string; icon: string; badge: string; badgeText: string }> = {
  Identity:     { iconBg: "bg-blue-50",   icon: "text-blue-500",   badge: "bg-blue-100",   badgeText: "text-blue-700"   },
  Education:    { iconBg: "bg-green-50",  icon: "text-green-500",  badge: "bg-green-100",  badgeText: "text-green-700"  },
  Professional: { iconBg: "bg-purple-50", icon: "text-[#4F3CC9]",  badge: "bg-purple-100", badgeText: "text-[#4F3CC9]"  },
  Employment:   { iconBg: "bg-orange-50", icon: "text-orange-500", badge: "bg-orange-100", badgeText: "text-orange-700" },
  Financial:    { iconBg: "bg-yellow-50", icon: "text-yellow-600", badge: "bg-yellow-100", badgeText: "text-yellow-700" },
  Other:        { iconBg: "bg-gray-100",  icon: "text-gray-400",   badge: "bg-gray-100",   badgeText: "text-gray-600"   },
};

interface EmployeeData {
  id: string;            // Firestore document ID = employee ID (EMP001 etc.)
  name: string; email: string; phone: string; designation: string;
  department: string; doj: string; branch: string; shift: string;
  reportingManager: string; emergencyContact: string; emergencyName: string;
  currentAddress: string; permanentAddress: string; bloodGroup: string;
  gender: string; dob: string; nationality: string; maritalStatus: string;
  workMode: string; employmentType: string; status: string;
  ctc: string; noticePeriod: string; probationEndDate: string;
  panNumber: string; aadharNumber: string;
}

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<ProfileTab>("Overview");
  const [editing, setEditing] = useState(false);
  const [empData, setEmpData] = useState<EmployeeData | null>(null);
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", emergencyContact: "",
    currentAddress: "", permanentAddress: "",
  });
  const [draft, setDraft] = useState({ ...form });
  const [passwordForm, setPasswordForm] = useState({ current: "", newPw: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<{ current?: string; newPw?: string; confirm?: string }>({});
  const [pwSuccess, setPwSuccess] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });
  const [resetSent,  setResetSent]  = useState(false);
  const [resetError, setResetError] = useState("");
  const [pwLoading,  setPwLoading]  = useState(false);

  // Load employee data directly from Firestore (no API round-trip)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      try {
        let empDoc: Record<string, unknown> | null = null;
        let empId = "";

        // Strategy 1: users/{uid}.employeeId — set explicitly by HR during account creation
        const profile = await getUserProfile(user.uid).catch(() => null);
        if (profile?.employeeId) {
          empId = profile.employeeId;
          const eSnap = await getDoc(fsDocQ(db, "employees", empId));
          if (eSnap.exists()) empDoc = { ...eSnap.data(), id: eSnap.id };
        }

        // Strategy 2: fallback — email lookup in employees collection
        if (!empId && user.email) {
          const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!snap.empty) {
            empDoc = { ...snap.docs[0].data(), id: snap.docs[0].id };
            empId  = snap.docs[0].id;
          }
        }

        if (empId) setCurrentEmpId(empId);

        if (empDoc) {
          const r = empDoc as Record<string, unknown>;
          const emp: EmployeeData = {
            id:               String(r.employeeId ?? r.id ?? empId),
            name:             String(r.name ?? ""),
            email:            String(r.email ?? user.email ?? ""),
            phone:            String(r.phone ?? ""),
            designation:      String(r.designation ?? ""),
            department:       String(r.department ?? ""),
            doj:              String(r.joiningDate ?? r.startDate ?? r.doj ?? ""),
            branch:           String(r.branch ?? r.location ?? ""),
            shift:            String(r.shift ?? ""),
            reportingManager: String(r.reportingManager ?? r.manager ?? ""),
            emergencyContact: String(r.emergencyContact ?? ""),
            emergencyName:    String(r.emergencyName ?? ""),
            currentAddress:   String(r.currentAddress ?? r.address ?? ""),
            permanentAddress: String(r.permanentAddress ?? ""),
            bloodGroup:       String(r.bloodGroup ?? ""),
            gender:           String(r.gender ?? ""),
            dob:              String(r.dob ?? r.dateOfBirth ?? ""),
            nationality:      String(r.nationality ?? ""),
            maritalStatus:    String(r.maritalStatus ?? ""),
            workMode:         String(r.workMode ?? ""),
            employmentType:   String(r.employmentType ?? r.empType ?? "Full-Time"),
            status:           String(r.status ?? "Active"),
            ctc:              String(r.ctc ?? r.salary ?? ""),
            noticePeriod:     String(r.noticePeriod ?? ""),
            probationEndDate: String(r.probationEndDate ?? ""),
            panNumber:        String(r.panNumber ?? ""),
            aadharNumber:     String(r.aadharNumber ?? ""),
          };
          setEmpData(emp);
          const f = {
            fullName:         emp.name,
            email:            emp.email,
            phone:            emp.phone,
            emergencyContact: emp.emergencyContact,
            currentAddress:   emp.currentAddress,
            permanentAddress: emp.permanentAddress,
          };
          setForm(f);
          setDraft(f);
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, []);

  function getStrength(pw: string) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  async function handlePasswordUpdate() {
    const errs: typeof pwErrors = {};
    if (!passwordForm.current) errs.current = "Please enter your current password.";
    if (!passwordForm.newPw) errs.newPw = "New password is required.";
    else if (passwordForm.newPw.length < 8) errs.newPw = "Password must be at least 8 characters.";
    else if (passwordForm.newPw === passwordForm.current) errs.newPw = "New password must differ from current password.";
    if (!passwordForm.confirm) errs.confirm = "Please confirm your new password.";
    else if (passwordForm.confirm !== passwordForm.newPw) errs.confirm = "Passwords do not match.";
    setPwErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const user = auth.currentUser;
    if (!user || !user.email) { setPwErrors({ current: "Not signed in." }); return; }
    setPwLoading(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, passwordForm.current);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passwordForm.newPw);
      setPwSuccess(true);
      setPasswordForm({ current: "", newPw: "", confirm: "" });
      setPwErrors({});
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setPwErrors({ current: "Current password is incorrect." });
      } else {
        setPwErrors({ current: "Failed to update password. Please try again." });
      }
    } finally {
      setPwLoading(false);
    }
  }

  async function handleSendReset() {
    const user = auth.currentUser;
    if (!user?.email) return;
    setResetError("");
    setResetSent(false);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 8000);
    } catch {
      setResetError("Failed to send reset email. Please try again.");
    }
  }
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoToast, setPhotoToast] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const pendingPhotoFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const certInputRef = useRef<{ [id: string]: HTMLInputElement | null }>({});

  // Education state
  const [education, setEducation] = useState<EduEntry[]>(INIT_EDUCATION);
  const [editEduId, setEditEduId] = useState<string | null>(null);
  const [eduDraft, setEduDraft] = useState<EduEntry | null>(null);
  const [eduToast, setEduToast] = useState<string | null>(null);


  const blankEdu = (): EduEntry => ({
    id: Date.now().toString(),
    degree: "",
    specialisation: "",
    isCurrentlyStudent: false,
    startDate: "",
    completionDate: "",
    institute: "",
    university: "",
    grade: "",
    state: "",
    country: "India",
    certificateFile: undefined,
    certificateName: undefined,
  });

  function startEditEdu(entry: EduEntry) {
    setEditEduId(entry.id);
    setEduDraft({ ...entry });
  }

  async function saveEdu() {
    if (!eduDraft) return;
    // Require at least a degree and institute so blank entries can't be saved.
    if (!eduDraft.degree.trim() || !eduDraft.institute.trim()) {
      setEduToast("Please enter at least a degree and institute before saving.");
      setTimeout(() => setEduToast(null), 3000);
      return;
    }
    // Grade / Percentage / CGPA must contain a numeric value when provided.
    if (eduDraft.grade.trim() && !/\d/.test(eduDraft.grade)) {
      setEduToast("Percentage / Grade / CGPA must be a number (e.g. 8.5 or 85%).");
      setTimeout(() => setEduToast(null), 3000);
      return;
    }
    const next = (() => {
      const prev = education;
      const exists = prev.find((e) => e.id === eduDraft.id);
      return exists ? prev.map((e) => e.id === eduDraft.id ? eduDraft : e) : [...prev, eduDraft];
    })();
    setEducation(next);
    setEditEduId(null);
    setEduDraft(null);
    setEduToast("Education details saved.");
    setTimeout(() => setEduToast(null), 3000);
    if (!currentEmpId) return;
    try {
      const { updateDoc: ud, doc: fsD } = await import("firebase/firestore");
      await ud(fsD(db, "employees", currentEmpId), {
        education: next.map(e => ({ ...e, certificateFile: e.certificateFile ?? null })),
        updatedAt: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }

  function deleteEdu(id: string) {
    setEducation((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleCertUpload(e: React.ChangeEvent<HTMLInputElement>, id: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (currentEmpId) {
      try {
        const path = `employeeCertificates/${currentEmpId}/${id}_${Date.now()}_${file.name}`;
        const snap = await uploadBytes(storageRef(storage, path), file);
        const downloadUrl = await getDownloadURL(snap.ref);
        if (editEduId === id && eduDraft) {
          setEduDraft({ ...eduDraft, certificateFile: downloadUrl, certificateName: file.name });
        }
      } catch {
        // fallback: blob URL (works this session only)
        const url = URL.createObjectURL(file);
        if (editEduId === id && eduDraft) {
          setEduDraft({ ...eduDraft, certificateFile: url, certificateName: file.name });
        }
      }
    } else {
      const url = URL.createObjectURL(file);
      if (editEduId === id && eduDraft) {
        setEduDraft({ ...eduDraft, certificateFile: url, certificateName: file.name });
      }
    }
  }

  // Documents state
  const [docs, setDocs] = useState<DocItem[]>(() => PREDEFINED_DOCS.map(d => ({ ...d })));
  const [viewDoc, setViewDoc] = useState<DocItem | null>(null);
  const [docToast, setDocToast] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadModal, setUploadModal] = useState<{ id: string; name: string; isExtra: boolean } | null>(null);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const modalFileInputRef = useRef<HTMLInputElement>(null);
  const [extraDocName, setExtraDocName] = useState("");
  const [extraDocCategory, setExtraDocCategory] = useState("Other");
  const [currentEmpId, setCurrentEmpId] = useState<string | null>(null);

  // Load education from Firestore when empId resolves
  useEffect(() => {
    if (!currentEmpId) return;
    import("firebase/firestore").then(({ getDoc, doc: fsD }) =>
      import("@/lib/firebase").then(({ db }) =>
        getDoc(fsD(db, "employees", currentEmpId)).then((snap) => {
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            if (Array.isArray(d.education) && d.education.length > 0)
              setEducation(d.education as EduEntry[]);
          }
        })
      )
    ).catch(() => {});
  }, [currentEmpId]);

  // Load profile photo from Firestore when empId resolves
  useEffect(() => {
    if (!currentEmpId) return;
    getDoc(fsDocQ(db, "employees", currentEmpId))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          const photo = d.photoURL ?? d.profilePhoto;
          if (photo) setProfilePhoto(String(photo));
        }
      })
      .catch(() => {});
  }, [currentEmpId]);

  // Load documents from Firestore — reads from `documents` collection,
  // falls back to old `employeeDocuments` and auto-migrates to `documents`.
  useEffect(() => {
    if (!currentEmpId) return;

    async function applyDocs(map: Record<string, import("@/lib/documentService").StoredDoc>) {
      setDocs(
        PREDEFINED_DOCS.map(d => {
          const s = map[d.id];
          return s ? { ...d, ...s } : d;
        }).concat(
          Object.entries(map)
            .filter(([, v]) => v.isExtra)
            .map(([k, v]) => ({ id: k, ...v } as DocItem))
        )
      );
    }

    async function migrateFromOldCollection(
      map: Record<string, import("@/lib/documentService").StoredDoc>
    ) {
      // Write each slot into the new `documents` collection so old data is migrated
      try {
        const { setDoc, doc: fsD } = await import("firebase/firestore");
        const { db: fdb } = await import("@/lib/firebase");
        await Promise.all(
          Object.entries(map).map(([slotId, rec]) =>
            setDoc(fsD(fdb, "documents", `${currentEmpId}_${slotId}`), {
              ...rec,
              slotId,
              docId: `${currentEmpId}_${slotId}`,
              empId: currentEmpId,
            })
          )
        );
      } catch { /* ignore */ }
    }

    async function readOldCollection(): Promise<Record<string, import("@/lib/documentService").StoredDoc>> {
      const { getDoc, doc: fsD } = await import("firebase/firestore");
      const { db: fdb } = await import("@/lib/firebase");
      const snap = await getDoc(fsD(fdb, "employeeDocuments", currentEmpId!));
      return (snap.exists() ? snap.data() : {}) as Record<string, import("@/lib/documentService").StoredDoc>;
    }

    loadDocMeta(currentEmpId)
      .then(async (stored) => {
        if (Object.keys(stored).length === 0) {
          // Nothing in new collection — read old collection and migrate
          const old = await readOldCollection();
          await applyDocs(old);
          if (Object.keys(old).length > 0) await migrateFromOldCollection(old);
        } else {
          await applyDocs(stored);
        }
      })
      .catch(async () => {
        const old = await readOldCollection().catch(() => ({}));
        await applyDocs(old);
      });
  }, [currentEmpId]);

  function showDocToast(msg: string) {
    setDocToast(msg);
    setTimeout(() => setDocToast(null), 3000);
  }

  // Upload via the drag-and-drop modal
  async function doModalUpload() {
    const file = pendingUploadFile;
    if (!file || !uploadModal) return;
    if (!currentEmpId) { showDocToast("Employee profile not loaded. Please refresh and try again."); return; }
    const ext = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
    let success = false;

    const empInfo = {
      id:          currentEmpId,
      name:        empData?.name ?? "",
      dept:        empData?.department ?? "",
      designation: empData?.designation ?? "",
    };

    if (uploadModal.isExtra) {
      const slotId = `extra-${Date.now()}`;
      const docName = extraDocName.trim() || file.name.replace(/\.[^.]+$/, "");
      const docCategory = extraDocCategory || "Other";
      setUploadingSlot("extra");
      setUploadProgress(0);
      try {
        const { url: fileUrl, path: storagePath } = await uploadDocFile(empInfo, slotId, file, setUploadProgress);
        const newDoc: DocItem = { id: slotId, name: docName, category: docCategory, status: "Uploaded", fileUrl, fileName: file.name, fileExt: ext, fileSize: file.size, isExtra: true };
        await saveDocMeta(empInfo, slotId, { ...newDoc, storagePath }, "employee");
        setDocs(prev => [...prev, newDoc]);
        showDocToast(`"${docName}" uploaded successfully!`);
        success = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showDocToast(`Upload failed: ${msg}`);
        console.error("[ExtraDocUpload]", err);
      } finally {
        setUploadingSlot(null);
      }
    } else {
      const docId = uploadModal.id;
      const slotDef = PREDEFINED_DOCS.find(d => d.id === docId);
      setUploadingSlot(docId);
      setUploadProgress(0);
      try {
        const { url: fileUrl, path: storagePath } = await uploadDocFile(empInfo, docId, file, setUploadProgress);
        const meta: DocItem = { id: docId, name: slotDef?.name ?? file.name.replace(/\.[^.]+$/, ""), category: slotDef?.category ?? "Other", status: "Uploaded", fileUrl, fileName: file.name, fileExt: ext, fileSize: file.size, hrOnly: slotDef?.hrOnly ?? false };
        await saveDocMeta(empInfo, docId, { ...meta, storagePath }, "employee");
        setDocs(prev => prev.map(d => d.id === docId ? meta : d));
        showDocToast(`"${meta.name}" uploaded successfully!`);
        success = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showDocToast(`Upload failed: ${msg}`);
        console.error("[SlotDocUpload]", err);
      } finally {
        setUploadingSlot(null);
      }
    }

    if (success) {
      setPendingUploadFile(null);
      setUploadModal(null);
      setExtraDocName("");
      setExtraDocCategory("Other");
    }
  }

  async function handleDownload(doc: DocItem) {
    if (doc.fileUrl) {
      try {
        // Fetch as blob so the download attribute works across origins (Firebase Storage URLs)
        const resp = await fetch(doc.fileUrl);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = doc.fileName ?? `${doc.name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
        showDocToast(`"${doc.name}" downloaded.`);
      } catch {
        // Fallback: open in new tab if fetch fails
        window.open(doc.fileUrl, "_blank");
      }
    } else {
      showDocToast("No file uploaded yet.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    pendingPhotoFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewPhoto(ev.target?.result as string);
      setShowPhotoModal(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function confirmPhoto() {
    const file = pendingPhotoFileRef.current;
    if (!previewPhoto) { setShowPhotoModal(false); return; }

    if (file && currentEmpId) {
      setPhotoUploading(true);
      try {
        const photoPath = `employeePhotos/${currentEmpId}/profile_${Date.now()}`;
        const snap = await uploadBytes(storageRef(storage, photoPath), file);
        const downloadUrl = await getDownloadURL(snap.ref);
        setProfilePhoto(downloadUrl);
        if (currentEmpId) await updateDoc(fsDocQ(db, "employees", currentEmpId), {
          photoURL: downloadUrl,
          profilePhoto: downloadUrl,
          updatedAt: new Date().toISOString(),
        });
        // Notify the sidebar (same-session instant update)
        window.dispatchEvent(new CustomEvent("employeePhotoUpdated", { detail: { url: downloadUrl } }));
      } catch {
        // fallback: keep in-memory preview so user at least sees it this session
        setProfilePhoto(previewPhoto);
      } finally {
        setPhotoUploading(false);
      }
    } else {
      setProfilePhoto(previewPhoto);
    }

    pendingPhotoFileRef.current = null;
    setPhotoToast(true);
    setTimeout(() => setPhotoToast(false), 3000);
    setShowPhotoModal(false);
    setPreviewPhoto(null);
  }

  function removePhoto() {
    setProfilePhoto(null);
    pendingPhotoFileRef.current = null;
    setShowPhotoModal(false);
    setPreviewPhoto(null);
    if (currentEmpId) {
      updateDoc(fsDocQ(db, "employees", currentEmpId), {
        photoURL: deleteField(),
        profilePhoto: deleteField(),
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
      window.dispatchEvent(new CustomEvent("employeePhotoUpdated", { detail: { url: "" } }));
    }
  }

  const tabs: ProfileTab[] = [
    "Overview",
    "Personal Details",
    "Employment Details",
    "Documents",
    "Settings",
  ];

  const handleSave = async () => {
    setForm({ ...draft });
    setEditing(false);
    if (!currentEmpId) return;
    try {
      const { updateDoc: ud, doc: fsD } = await import("firebase/firestore");
      await ud(fsD(db, "employees", currentEmpId), {
        name:             draft.fullName,
        phone:            draft.phone,
        emergencyContact: draft.emergencyContact,
        currentAddress:   draft.currentAddress,
        permanentAddress: draft.permanentAddress,
        updatedAt:        new Date().toISOString(),
      });
    } catch { /* ignore */ }
  };

  const handleCancel = () => {
    setDraft({ ...form });
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {photoToast && (
        <div className="fixed top-5 right-5 z-50 bg-green-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center gap-2">
          <CheckCircle size={16} /> Profile photo updated successfully!
        </div>
      )}

      {/* Doc toast */}
      {docToast && (
        <div className="fixed top-5 right-5 z-50 bg-[#4F3CC9] text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center gap-2">
          <CheckCircle size={16} /> {docToast}
        </div>
      )}

      {/* Document View — full-screen overlay */}
      {viewDoc && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
          {/* Top bar */}
          <div className="shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                <FileText size={16} className="text-red-500" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{viewDoc.name}</p>
                <p className="text-xs text-gray-400 truncate">{viewDoc.fileExt ?? viewDoc.category} · {viewDoc.fileName ?? "Document"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              {viewDoc.fileUrl && (
                <a
                  href={viewDoc.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors"
                >
                  <Eye size={12} /> Open in new tab
                </a>
              )}
              <button
                onClick={() => handleDownload(viewDoc)}
                className="flex items-center gap-1.5 text-xs bg-[#4F3CC9] text-white px-3 py-1.5 rounded-full font-medium hover:bg-[#3d2fa3] transition-colors"
              >
                <Download size={12} /> Download
              </button>
              <button
                onClick={() => setViewDoc(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Preview area */}
          <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-100 p-4">
            {viewDoc.fileUrl ? (
              viewDoc.fileExt === "PDF" || viewDoc.fileName?.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={viewDoc.fileUrl}
                  className="w-full h-full rounded-xl border border-gray-200 bg-white"
                  title={viewDoc.name}
                />
              ) : (viewDoc.fileExt ?? "").match(/^(PNG|JPG|JPEG|GIF|WEBP|SVG)$/i) || viewDoc.fileName?.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ? (
                <img
                  src={viewDoc.fileUrl}
                  alt={viewDoc.name}
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                />
              ) : (
                <div className="text-center text-white">
                  <FileText size={48} className="mx-auto mb-4 opacity-40" />
                  <p className="text-sm font-medium mb-1">Preview not available for {viewDoc.fileExt} files</p>
                  <p className="text-xs opacity-60 mb-4">Use Download to open this file</p>
                  <button
                    onClick={() => handleDownload(viewDoc)}
                    className="flex items-center gap-2 mx-auto bg-[#4F3CC9] text-white px-5 py-2 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
                  >
                    <Download size={14} /> Download File
                  </button>
                </div>
              )
            ) : (
              <div className="text-center text-white">
                <FileText size={48} className="mx-auto mb-4 opacity-40" />
                <p className="text-sm font-medium mb-1">No file uploaded yet</p>
                <p className="text-xs opacity-60">Upload a file to preview it here</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden file input for profile photo */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />


      {/* Photo preview modal */}
      {showPhotoModal && previewPhoto && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPhotoModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Preview Profile Photo</h3>
              <button onClick={() => setShowPhotoModal(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="flex flex-col items-center gap-4">
              <img src={previewPhoto} alt="Preview" className="w-32 h-32 rounded-full object-cover border-4 border-[#EDE9FF]" />
              <p className="text-sm text-gray-500">Does this look good?</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowPhotoModal(false); setPreviewPhoto(null); }} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={confirmPhoto} disabled={photoUploading} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3] disabled:opacity-60 disabled:cursor-not-allowed">
                {photoUploading ? "Uploading…" : "Save Photo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Upload Modal */}
      {uploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {uploadModal.isExtra ? "Upload Document" : `Upload — ${uploadModal.name}`}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Supported: PDF, DOC, PNG, JPG, TXT</p>
              </div>
              <button
                onClick={() => { setUploadModal(null); setPendingUploadFile(null); setDragOver(false); setExtraDocName(""); setExtraDocCategory("Other"); }}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Drop Zone */}
            {!pendingUploadFile ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) setPendingUploadFile(file);
                }}
                onClick={() => modalFileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl py-12 px-6 text-center cursor-pointer select-none transition-all ${
                  dragOver
                    ? "border-[#4F3CC9] bg-[#F5F3FF] scale-[1.01]"
                    : "border-gray-200 hover:border-[#4F3CC9] hover:bg-[#FAFAFF]"
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-colors ${dragOver ? "bg-[#EDE9FF]" : "bg-gray-100"}`}>
                  <Upload size={26} className={dragOver ? "text-[#4F3CC9]" : "text-gray-400"} />
                </div>
                <p className="text-sm font-semibold text-gray-800">
                  {dragOver ? "Drop to upload" : "Drag & drop your file here"}
                </p>
                <p className="text-xs text-gray-400 mt-1.5">or <span className="text-[#4F3CC9] font-medium underline underline-offset-2">click to browse</span></p>
                <p className="text-xs text-gray-300 mt-4">PDF · DOC · DOCX · PNG · JPG · TXT</p>
              </div>
            ) : (
              <div className="border-2 border-[#4F3CC9] bg-[#F5F3FF] rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                    <FileText size={20} className="text-[#4F3CC9]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{pendingUploadFile.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {pendingUploadFile.size < 1024 * 1024
                        ? `${(pendingUploadFile.size / 1024).toFixed(0)} KB`
                        : `${(pendingUploadFile.size / (1024 * 1024)).toFixed(1)} MB`}
                    </p>
                  </div>
                  <button
                    onClick={() => setPendingUploadFile(null)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Document details — only for Other Documents */}
            {uploadModal.isExtra && pendingUploadFile && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">
                    Document Name <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={extraDocName}
                    onChange={(e) => setExtraDocName(e.target.value)}
                    placeholder="e.g. Experience Letter, Bank Statement…"
                    rows={2}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Category</label>
                  <select
                    value={extraDocCategory}
                    onChange={(e) => setExtraDocCategory(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] focus:border-transparent bg-white"
                  >
                    {["Identity", "Employment", "Education", "Finance", "Other"].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Progress Bar */}
            {uploadingSlot && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Uploading…</span>
                  <span className="text-[#4F3CC9] font-medium">{uploadProgress}%</span>
                </div>
                <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[#4F3CC9] h-2 rounded-full transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setUploadModal(null); setPendingUploadFile(null); setDragOver(false); setExtraDocName(""); setExtraDocCategory("Other"); }}
                disabled={!!uploadingSlot}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doModalUpload}
                disabled={!pendingUploadFile || !!uploadingSlot || (uploadModal.isExtra && !extraDocName.trim())}
                className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadingSlot ? "Uploading…" : "Save"}
              </button>
            </div>

            <input
              ref={modalFileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPendingUploadFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 text-sm mt-1">
          Your personal and professional information.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 overflow-x-auto w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab
                ? "bg-[#EDE9FF] text-[#4F3CC9]"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "Overview" && (
        <div className="flex flex-col items-center gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-xl mx-auto flex flex-col items-center text-center">
            <div className="relative mb-4 group">
              {profilePhoto ? (
                <img src={profilePhoto} alt="Profile" className="w-24 h-24 rounded-full object-cover border-4 border-[#EDE9FF]" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] text-3xl font-bold">
                  {empData?.name ? empData.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "—"}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Change photo"
              >
                <Upload size={20} className="text-white" />
              </button>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">{empData?.name || form.fullName || "—"}</h2>
            <p className="text-sm text-gray-500 mt-1">{empData?.designation || "—"}</p>
            <p className="text-sm text-gray-400">{empData?.department || "—"}</p>

            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <CheckCircle size={12} /> {empData?.status || "Active"}
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                <Briefcase size={12} /> {empData?.employmentType || "Full-Time"}
              </span>
            </div>

            <div className="w-full border-t border-gray-100 mt-6 pt-5 grid grid-cols-2 gap-4 text-left">
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.email || form.email || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.phone || form.phone || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Employee ID</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.id || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Date of Joining</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.doj || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Department</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.department || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Reporting Manager</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData?.reportingManager || "—"}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 border border-gray-200 text-gray-700 px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <Upload size={15} /> Edit Profile Photo
              </button>
              {profilePhoto && (
                <button
                  onClick={removePhoto}
                  className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 font-medium"
                >
                  <X size={14} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Personal Details Tab */}
      {activeTab === "Personal Details" && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <User size={16} className="text-[#4F3CC9]" />
                Personal Information
              </h3>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium hover:underline"
                >
                  <Edit2 size={14} /> Edit Profile
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleCancel}
                    className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1.5 text-sm bg-[#4F3CC9] text-white px-4 py-1.5 rounded-full font-medium hover:bg-[#3d2fa3]"
                  >
                    <Save size={13} /> Save Changes
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-5">
              {[
                { label: "Full Name", key: "fullName" },
                { label: "Email ID", key: "email" },
                { label: "Phone Number", key: "phone" },
                { label: "Emergency Contact", key: "emergencyContact" },
              ].map(({ label, key }) => (
                <div key={key}>
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  {editing ? (
                    <input
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                      value={draft[key as keyof typeof draft]}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900">
                      {form[key as keyof typeof form]}
                    </p>
                  )}
                </div>
              ))}
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-1">Current Address</p>
                {editing ? (
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                    value={draft.currentAddress}
                    onChange={(e) =>
                      setDraft({ ...draft, currentAddress: e.target.value })
                    }
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-900">
                    {form.currentAddress}
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-1">Permanent Address</p>
                {editing ? (
                  <textarea
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                    value={draft.permanentAddress}
                    onChange={(e) =>
                      setDraft({ ...draft, permanentAddress: e.target.value })
                    }
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-900">
                    {form.permanentAddress}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Education Details */}
          {eduToast && (
            <div className="fixed top-5 right-5 z-50 bg-green-600 text-white px-5 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center gap-2">
              <CheckCircle size={16} /> {eduToast}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <GraduationCap size={16} className="text-[#4F3CC9]" />
                Education Details
              </h3>
              <button
                onClick={() => { const e = blankEdu(); setEducation((prev) => [...prev, e]); setEditEduId(e.id); setEduDraft(e); }}
                className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF] transition-colors"
              >
                <Plus size={13} /> Add Education
              </button>
            </div>

            <div className="space-y-5">
              {education.map((edu) => {
                const isEditing = editEduId === edu.id && eduDraft;
                const d = isEditing ? eduDraft! : edu;

                const inp = (field: keyof EduEntry) => (
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={(d[field] as string) ?? ""}
                    onChange={(e) => setEduDraft({ ...d, [field]: e.target.value })}
                  />
                );

                return (
                  <div key={edu.id} className="border border-gray-100 rounded-2xl p-5 relative">
                    {/* Action buttons */}
                    <div className="absolute top-4 right-4 flex gap-2">
                      {!isEditing ? (
                        <>
                          <button onClick={() => startEditEdu(edu)} className="p-1.5 rounded-lg hover:bg-[#EDE9FF] text-[#4F3CC9]"><Edit2 size={13} /></button>
                          <button onClick={() => deleteEdu(edu.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={saveEdu} className="flex items-center gap-1 text-xs bg-[#4F3CC9] text-white px-3 py-1.5 rounded-full font-medium">
                            <Save size={12} /> Save
                          </button>
                          <button onClick={() => { setEditEduId(null); setEduDraft(null); if (!edu.degree) deleteEdu(edu.id); }} className="text-xs text-gray-500 hover:text-gray-700 font-medium border border-gray-200 px-3 py-1.5 rounded-full">
                            Cancel
                          </button>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 pr-24">
                      {/* Degree */}
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 mb-1">Education Degree</p>
                        {isEditing ? (
                          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                            value={d.degree} onChange={(e) => setEduDraft({ ...d, degree: e.target.value })}>
                            <option value="">Select degree</option>
                            {DEGREES.map((deg) => <option key={deg}>{deg}</option>)}
                          </select>
                        ) : (
                          <p className="text-sm font-medium text-gray-900">{d.degree || "—"}</p>
                        )}
                      </div>

                      {/* Specialisation */}
                      <Field label="Field of Specialisation">
                        {isEditing ? inp("specialisation") : <p className="text-sm font-medium text-gray-900">{d.specialisation || "—"}</p>}
                      </Field>

                      {/* Institute */}
                      <Field label="Institute / School Name">
                        {isEditing ? inp("institute") : <p className="text-sm font-medium text-gray-900">{d.institute || "—"}</p>}
                      </Field>

                      {/* University */}
                      <Field label="University / Board">
                        {isEditing ? inp("university") : <p className="text-sm font-medium text-gray-900">{d.university || "—"}</p>}
                      </Field>

                      {/* Grade */}
                      <Field label="Percentage / Grade / CGPA">
                        {isEditing ? inp("grade") : <p className="text-sm font-medium text-gray-900">{d.grade || "—"}</p>}
                      </Field>

                      {/* Currently a Student */}
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 mb-1">I Am Currently A Student</p>
                        {isEditing ? (
                          <div className="flex gap-3">
                            {["Yes", "No"].map((v) => (
                              <button key={v} type="button"
                                onClick={() => setEduDraft({ ...d, isCurrentlyStudent: v === "Yes" })}
                                className={`px-5 py-2 rounded-xl text-sm font-semibold border transition-all ${
                                  (d.isCurrentlyStudent ? "Yes" : "No") === v
                                    ? "bg-[#4F3CC9] text-white border-[#4F3CC9]"
                                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                                }`}
                              >{v}</button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-gray-900">{d.isCurrentlyStudent ? "Yes" : "No"}</p>
                        )}
                      </div>

                      {/* Start Date */}
                      <Field label="Start Date">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                              value={d.startDate.split("-")[0] ?? ""}
                              onChange={(e) => setEduDraft({ ...d, startDate: `${e.target.value}-${d.startDate.split("-")[1] ?? ""}` })}>
                              <option value="">Month</option>
                              {MONTHS.map((m) => <option key={m}>{m}</option>)}
                            </select>
                            <select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                              value={d.startDate.split("-")[1] ?? ""}
                              onChange={(e) => setEduDraft({ ...d, startDate: `${d.startDate.split("-")[0] ?? ""}-${e.target.value}` })}>
                              <option value="">Year</option>
                              {YEARS.map((y) => <option key={y}>{y}</option>)}
                            </select>
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-gray-900">{d.startDate || "—"}</p>
                        )}
                      </Field>

                      {/* Completion Date */}
                      {!d.isCurrentlyStudent && (
                        <Field label="Completion Date">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                                value={d.completionDate.split("-")[0] ?? ""}
                                onChange={(e) => setEduDraft({ ...d, completionDate: `${e.target.value}-${d.completionDate.split("-")[1] ?? ""}` })}>
                                <option value="">Month</option>
                                {MONTHS.map((m) => <option key={m}>{m}</option>)}
                              </select>
                              <select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                                value={d.completionDate.split("-")[1] ?? ""}
                                onChange={(e) => setEduDraft({ ...d, completionDate: `${d.completionDate.split("-")[0] ?? ""}-${e.target.value}` })}>
                                <option value="">Year</option>
                                {YEARS.map((y) => <option key={y}>{y}</option>)}
                              </select>
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-gray-900">{d.completionDate || "—"}</p>
                          )}
                        </Field>
                      )}

                      {/* State */}
                      <Field label="State">
                        {isEditing ? inp("state") : <p className="text-sm font-medium text-gray-900">{d.state || "—"}</p>}
                      </Field>

                      {/* Country */}
                      <Field label="Country">
                        {isEditing ? (
                          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]"
                            value={d.country} onChange={(e) => setEduDraft({ ...d, country: e.target.value })}>
                            {["India","USA","UK","Canada","Australia","Germany","Singapore","UAE","Other"].map((c) => <option key={c}>{c}</option>)}
                          </select>
                        ) : (
                          <p className="text-sm font-medium text-gray-900">{d.country || "—"}</p>
                        )}
                      </Field>

                      {/* Certificate Upload */}
                      <div className="col-span-2">
                        <p className="text-xs text-gray-400 mb-1">Academic Certificate (Self Attested)</p>
                        {isEditing ? (
                          <div className="flex items-center gap-3">
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              ref={(el) => { certInputRef.current[edu.id] = el; }}
                              onChange={(e) => handleCertUpload(e, edu.id)}
                            />
                            <button
                              onClick={() => certInputRef.current[edu.id]?.click()}
                              className="flex items-center gap-2 border border-dashed border-[#4F3CC9] text-[#4F3CC9] px-4 py-2 rounded-xl text-sm hover:bg-[#EDE9FF] transition-colors"
                            >
                              <Upload size={14} /> Upload Certificate
                            </button>
                            {d.certificateName && <span className="text-xs text-gray-500 truncate max-w-[180px]">{d.certificateName}</span>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            {d.certificateFile ? (
                              <>
                                <span className="text-sm font-medium text-gray-900 truncate max-w-[220px]">{d.certificateName}</span>
                                <a href={d.certificateFile} download={d.certificateName} className="text-xs text-[#4F3CC9] underline">Download</a>
                              </>
                            ) : (
                              <p className="text-sm font-medium text-gray-900">N/A</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {education.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm">
                  No education details added yet. Click &quot;Add Education&quot; to get started.
                </div>
              )}
            </div>
          </div>

          {/* Work Experience */}
          <WorkExperienceSection empId={currentEmpId} />

          {/* Skills & Languages */}
          <SkillsSection empId={currentEmpId} />

          {/* Government IDs */}
          <GovtIdSection empId={currentEmpId} />


        </div>
      )}

      {/* Employment Details Tab */}
      {activeTab === "Employment Details" && (
        <div className="space-y-5">

          {/* Basic Info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <Building2 size={16} className="text-[#4F3CC9]" />
              Employment Details
            </h3>
            <div className="grid grid-cols-2 gap-6">
              {[
                { label: "Employee ID",      value: empData?.id },
                { label: "Designation",      value: empData?.designation },
                { label: "Department",       value: empData?.department },
                { label: "Employment Type",  value: empData?.employmentType },
                { label: "Work Mode",        value: empData?.workMode },
                { label: "Date of Joining",  value: empData?.doj },
                { label: "Reporting Manager",value: empData?.reportingManager },
                { label: "Location",         value: empData?.branch },
                { label: "Shift",            value: empData?.shift },
                { label: "Annual Payroll",     value: empData?.ctc },
                { label: "Notice Period",    value: empData?.noticePeriod },
                { label: "Status",           value: empData?.status },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className="text-sm font-semibold text-gray-900">{value || "—"}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-[#F5F3FF] rounded-xl flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#EDE9FF] flex items-center justify-center">
                <MapPin size={14} className="text-[#4F3CC9]" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Office Location</p>
                <p className="text-sm font-medium text-gray-900">Woways</p>
              </div>
            </div>
          </div>

          {/* Work Role History */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <Briefcase size={16} className="text-[#4F3CC9]" />
              Work Role History
            </h3>
            <p className="text-sm text-gray-400">No role history available.</p>
          </div>

          {/* Manager History */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <User size={16} className="text-[#4F3CC9]" />
              Manager History
            </h3>
            <p className="text-sm text-gray-400">No manager history available.</p>
          </div>

        </div>
      )}

      {/* Settings Tab */}
      {activeTab === "Settings" && (
        <div className="space-y-5 max-w-2xl">

          {/* Send Reset Link */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <AlertCircle size={20} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Forgot Password / Reset via Email</h3>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                  Click below to receive a password reset link at{" "}
                  <span className="font-medium text-gray-800">{empData?.email || auth.currentUser?.email || "your email"}</span>.
                  Open the link in that email to set a new password.
                </p>
                {resetSent && (
                  <div className="mt-3 flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm font-medium">
                    <CheckCircle size={15} /> Reset link sent! Check your inbox (and spam folder).
                  </div>
                )}
                {resetError && (
                  <div className="mt-3 flex items-center gap-2 text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm">
                    <X size={15} /> {resetError}
                  </div>
                )}
                <button
                  onClick={handleSendReset}
                  disabled={resetSent}
                  className="mt-4 flex items-center gap-2 border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 px-5 py-2.5 rounded-full text-sm font-medium transition-colors disabled:opacity-60"
                >
                  <AlertCircle size={14} />
                  {resetSent ? "Link Sent!" : "Send Reset Link to Email"}
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-100" />
            <span className="text-xs text-gray-400 font-medium">OR CHANGE PASSWORD DIRECTLY</span>
            <div className="flex-1 border-t border-gray-100" />
          </div>

          {/* Change Password Form */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                <Lock size={20} className="text-[#4F3CC9]" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Change Password</h3>
                <p className="text-sm text-gray-500">Enter your current password to set a new one.</p>
              </div>
            </div>

            {pwSuccess && (
              <div className="mb-5 flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm font-medium">
                <CheckCircle size={15} /> Password updated successfully!
              </div>
            )}

            <div className="space-y-4">
              {/* Current Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Current Password</label>
                <div className="relative">
                  <input
                    type={showPw.current ? "text" : "password"}
                    placeholder="Enter current password"
                    className={`w-full border rounded-xl px-4 py-3 text-sm pr-11 focus:outline-none focus:border-[#4F3CC9] transition-colors ${pwErrors.current ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                    value={passwordForm.current}
                    onChange={e => setPasswordForm(f => ({ ...f, current: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && handlePasswordUpdate()}
                  />
                  <button type="button" onClick={() => setShowPw(s => ({ ...s, current: !s.current }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.current ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {pwErrors.current && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertCircle size={11} /> {pwErrors.current}</p>}
              </div>

              {/* New Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPw.newPw ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    className={`w-full border rounded-xl px-4 py-3 text-sm pr-11 focus:outline-none focus:border-[#4F3CC9] transition-colors ${pwErrors.newPw ? "border-red-300 bg-red-50" : "border-gray-200"}`}
                    value={passwordForm.newPw}
                    onChange={e => setPasswordForm(f => ({ ...f, newPw: e.target.value }))}
                  />
                  <button type="button" onClick={() => setShowPw(s => ({ ...s, newPw: !s.newPw }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.newPw ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {pwErrors.newPw && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertCircle size={11} /> {pwErrors.newPw}</p>}
                {/* Strength bar */}
                {passwordForm.newPw && (() => {
                  const s = getStrength(passwordForm.newPw);
                  const labels = ["", "Weak", "Fair", "Good", "Strong"];
                  const colors = ["", "bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-green-500"];
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= s ? colors[s] : "bg-gray-100"}`} />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${s <= 1 ? "text-red-500" : s === 2 ? "text-orange-500" : s === 3 ? "text-yellow-600" : "text-green-600"}`}>
                        {labels[s]}
                      </p>
                    </div>
                  );
                })()}
                <ul className="mt-2 space-y-0.5 text-xs text-gray-400">
                  {[
                    [passwordForm.newPw.length >= 8, "At least 8 characters"],
                    [/[A-Z]/.test(passwordForm.newPw), "One uppercase letter"],
                    [/[0-9]/.test(passwordForm.newPw), "One number"],
                    [/[^A-Za-z0-9]/.test(passwordForm.newPw), "One special character"],
                  ].map(([ok, label], i) => (
                    <li key={i} className={`flex items-center gap-1.5 ${ok ? "text-green-600" : "text-gray-300"}`}>
                      <CheckCircle size={10} /> {label as string}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPw.confirm ? "text" : "password"}
                    placeholder="Re-enter new password"
                    className={`w-full border rounded-xl px-4 py-3 text-sm pr-11 focus:outline-none focus:border-[#4F3CC9] transition-colors ${pwErrors.confirm ? "border-red-300 bg-red-50" : passwordForm.confirm && passwordForm.confirm === passwordForm.newPw ? "border-green-300" : "border-gray-200"}`}
                    value={passwordForm.confirm}
                    onChange={e => setPasswordForm(f => ({ ...f, confirm: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && handlePasswordUpdate()}
                  />
                  <button type="button" onClick={() => setShowPw(s => ({ ...s, confirm: !s.confirm }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.confirm ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {pwErrors.confirm && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertCircle size={11} /> {pwErrors.confirm}</p>}
                {passwordForm.confirm && passwordForm.confirm === passwordForm.newPw && !pwErrors.confirm && (
                  <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1"><CheckCircle size={11} /> Passwords match</p>
                )}
              </div>

              <button
                onClick={handlePasswordUpdate}
                disabled={pwLoading}
                className="w-full bg-[#4F3CC9] text-white py-3 rounded-full text-sm font-semibold hover:bg-[#3d2fa3] transition-colors disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
              >
                {pwLoading ? (
                  <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Updating…</>
                ) : (
                  <><Lock size={15} /> Update Password</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === "Documents" && (
        <div className="space-y-6">
          {/* Required Documents */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <FileText size={16} className="text-[#4F3CC9]" />
              Required Documents
              <span className="ml-1 text-xs bg-[#EDE9FF] text-[#4F3CC9] px-2 py-0.5 rounded-full font-semibold">
                {docs.filter(d => !d.isExtra && d.status === "Uploaded").length}/{docs.filter(d => !d.isExtra).length}
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {docs.filter(d => !d.isExtra).map((doc) => {
                const style = DOC_STYLE[doc.category] ?? DOC_STYLE.Other;
                return (
                  <div key={doc.id} className="border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg ${style.iconBg} flex items-center justify-center shrink-0`}>
                        <FileText size={18} className={style.icon} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900 truncate">{doc.name}</p>
                          {doc.hrOnly && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[#EDE9FF] text-[#4F3CC9] font-medium shrink-0">HR Upload</span>
                          )}
                        </div>
                        <span className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${style.badge} ${style.badgeText}`}>
                          {doc.category}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.status === "Uploaded" ? (
                        <>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                            <CheckCircle size={11} /> Uploaded
                          </span>
                          <button
                            onClick={() => setViewDoc(doc)}
                            className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-[#4F3CC9] border border-gray-200 hover:border-[#4F3CC9] px-2.5 py-1 rounded-full transition-colors"
                          >
                            <Eye size={12} /> View
                          </button>
                          <button
                            onClick={() => handleDownload(doc)}
                            className="flex items-center gap-1 text-xs text-white bg-[#4F3CC9] hover:bg-[#3d2fa3] px-2.5 py-1 rounded-full transition-colors"
                          >
                            <Download size={12} /> Download
                          </button>
                          {/* Only allow delete for non-hrOnly docs */}
                          {!doc.hrOnly && (
                            <button
                              onClick={async () => {
                                if (doc.isExtra) {
                                  setDocs(prev => prev.filter(d => d.id !== doc.id));
                                  if (currentEmpId) await deleteDocMeta(currentEmpId, doc.id).catch(() => {});
                                } else {
                                  setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: "Pending", fileUrl: undefined, fileName: undefined, fileExt: undefined } : d));
                                  if (currentEmpId && empData) {
                                    const slotDef = PREDEFINED_DOCS.find(pd => pd.id === doc.id);
                                    await resetDocSlot(
                                      { id: currentEmpId, name: empData.name ?? "", dept: empData.department ?? "" },
                                      doc.id,
                                      slotDef?.name ?? doc.name,
                                      slotDef?.category ?? "Other",
                                      slotDef?.hrOnly ?? false
                                    ).catch(() => {});
                                  }
                                }
                              }}
                              className="p-1.5 rounded-full text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Remove"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      ) : uploadingSlot === doc.id ? (
                        <div className="ml-auto flex items-center gap-2 w-full">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                            <div className="bg-[#4F3CC9] h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                          </div>
                          <span className="text-xs text-[#4F3CC9] font-medium">{uploadProgress}%</span>
                        </div>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
                            <Clock size={11} /> Pending
                          </span>
                          {doc.hrOnly ? (
                            <span className="ml-auto text-xs text-[#4F3CC9] bg-[#EDE9FF] px-2.5 py-1 rounded-full font-medium">
                              Awaiting HR
                            </span>
                          ) : (
                            <button
                              onClick={() => setUploadModal({ id: doc.id, name: doc.name, isExtra: false })}
                              className="ml-auto flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9] hover:bg-[#EDE9FF] px-2.5 py-1 rounded-full transition-colors font-medium"
                            >
                              <Upload size={12} /> Upload
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {doc.fileName && (
                      <p className="text-xs text-gray-400 mt-2 truncate">{doc.fileName}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Other Documents */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={16} className="text-gray-400" />
                Other Documents
                {docs.filter(d => d.isExtra).length > 0 && (
                  <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-semibold">
                    {docs.filter(d => d.isExtra).length}
                  </span>
                )}
              </h3>
              <button
                onClick={() => setUploadModal({ id: "extra", name: "Other Document", isExtra: true })}
                className="flex items-center gap-2 bg-[#4F3CC9] text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
              >
                <Upload size={14} /> Upload
              </button>
            </div>
            {docs.filter(d => d.isExtra).length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <FileText size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No other documents uploaded yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {docs.filter(d => d.isExtra).map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                        <p className="text-xs text-gray-400">{doc.fileExt ?? "FILE"} · Uploaded by you</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                        <CheckCircle size={11} /> Uploaded
                      </span>
                      <button
                        onClick={() => setViewDoc(doc)}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#4F3CC9] font-medium border border-gray-200 px-3 py-1.5 rounded-full transition-colors hover:border-[#4F3CC9]"
                      >
                        <Eye size={13} /> View
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="flex items-center gap-1.5 text-xs text-white bg-[#4F3CC9] hover:bg-[#3d2fa3] font-medium px-3 py-1.5 rounded-full transition-colors"
                      >
                        <Download size={13} /> Download
                      </button>
                      <button
                        onClick={() => { setDocs((prev) => prev.filter((d) => d.id !== doc.id)); showDocToast(`"${doc.name}" deleted.`); }}
                        className="p-2 rounded-full text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-4">Accepted formats: PDF, DOC, DOCX, PNG, JPG, JPEG, TXT · Max size: 5 MB</p>
          </div>
        </div>
      )}
    </div>
  );
}
