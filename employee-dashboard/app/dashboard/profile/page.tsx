"use client";
import { useState, useRef, useEffect } from "react";
import { onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { doc as fsDoc, getDoc, getDocs, collection, query, where, updateDoc, setDoc, deleteField } from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { uploadDocFile, saveDocMeta, loadDocMeta } from "@/lib/documentService";
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

type ProfileTab = "Overview" | "Personal Details" | "Employment Details" | "Documents" | "Security";

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
const YEARS = Array.from({ length: 30 }, (_, i) => String(new Date().getFullYear() - i));

// ── Work Experience ──────────────────────────────────────────
interface WorkExp {
  id: string; company: string; role: string; empType: string;
  startMonth: string; startYear: string; endMonth: string; endYear: string;
  currentlyWorking: boolean; location: string; description: string;
}
const EMP_TYPES = ["Full-Time","Part-Time","Internship","Freelance","Contract"];

function WorkExperienceSection({ currentEmpId }: { currentEmpId?: string | null }) {
  const blank = (): WorkExp => ({ id: Date.now().toString(), company: "", role: "", empType: "Full-Time", startMonth: "", startYear: "", endMonth: "", endYear: "", currentlyWorking: false, location: "", description: "" });
  const [list, setList] = useState<WorkExp[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkExp | null>(null);

  useEffect(() => {
    if (!currentEmpId) return;
    getDoc(fsDoc(db, "employees", currentEmpId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.workExperience)) setList(data.workExperience as WorkExp[]);
      }
    }).catch(() => {});
  }, [currentEmpId]);

  function persistList(updated: WorkExp[]) {
    if (currentEmpId) {
      updateDoc(fsDoc(db, "employees", currentEmpId), { workExperience: updated }).catch(() => {});
    }
  }

  const inp = (f: keyof WorkExp) => <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={(draft![f] as string) ?? ""} onChange={(e) => setDraft({ ...draft!, [f]: e.target.value })} />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Briefcase size={16} className="text-[#4F3CC9]" /> Work Experience</h3>
        <button onClick={() => { const e = blank(); const updated = [...list, e]; setList(updated); setEditId(e.id); setDraft(e); }} className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium border border-[#4F3CC9] px-3 py-1.5 rounded-full hover:bg-[#EDE9FF]"><Plus size={13} /> Add Experience</button>
      </div>
      <div className="space-y-4">
        {list.map((w) => {
          const isEd = editId === w.id && draft;
          const d = isEd ? draft! : w;
          return (
            <div key={w.id} className="border border-gray-100 rounded-2xl p-5 relative">
              <div className="absolute top-4 right-4 flex gap-2">
                {!isEd ? (
                  <><button onClick={() => { setEditId(w.id); setDraft({ ...w }); }} className="p-1.5 rounded-lg hover:bg-[#EDE9FF] text-[#4F3CC9]"><Edit2 size={13} /></button><button onClick={() => { const updated = list.filter((x) => x.id !== w.id); setList(updated); persistList(updated); }} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 size={13} /></button></>
                ) : (
                  <><button onClick={() => { const updated = list.map((x) => x.id === d.id ? d : x); setList(updated); persistList(updated); setEditId(null); setDraft(null); }} className="flex items-center gap-1 text-xs bg-[#4F3CC9] text-white px-3 py-1.5 rounded-full"><Save size={12} /> Save</button><button onClick={() => { setEditId(null); setDraft(null); if (!w.company) { const updated = list.filter((x) => x.id !== w.id); setList(updated); persistList(updated); } }} className="text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full">Cancel</button></>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 pr-24">
                <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">Company / Organisation</p>{isEd ? inp("company") : <p className="text-sm font-semibold text-gray-900">{d.company || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Job Title / Role</p>{isEd ? inp("role") : <p className="text-sm font-medium text-gray-900">{d.role || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Employment Type</p>{isEd ? <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.empType} onChange={(e) => setDraft({ ...d, empType: e.target.value })}>{EMP_TYPES.map((t) => <option key={t}>{t}</option>)}</select> : <p className="text-sm font-medium text-gray-900">{d.empType}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Location</p>{isEd ? inp("location") : <p className="text-sm font-medium text-gray-900">{d.location || "—"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">I Currently Work Here</p>{isEd ? <div className="flex gap-2">{["Yes","No"].map((v) => <button key={v} onClick={() => setDraft({ ...d, currentlyWorking: v === "Yes" })} className={`px-4 py-1.5 rounded-xl text-sm font-semibold border ${(d.currentlyWorking ? "Yes" : "No") === v ? "bg-[#4F3CC9] text-white border-[#4F3CC9]" : "bg-white text-gray-500 border-gray-200"}`}>{v}</button>)}</div> : <p className="text-sm font-medium text-gray-900">{d.currentlyWorking ? "Yes" : "No"}</p>}</div>
                <div><p className="text-xs text-gray-400 mb-1">Start</p>{isEd ? <div className="flex gap-2"><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.startMonth} onChange={(e) => setDraft({ ...d, startMonth: e.target.value })}><option value="">Month</option>{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => <option key={m}>{m}</option>)}</select><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.startYear} onChange={(e) => setDraft({ ...d, startYear: e.target.value })}><option value="">Year</option>{Array.from({length:30},(_,i)=>String(new Date().getFullYear()-i)).map((y) => <option key={y}>{y}</option>)}</select></div> : <p className="text-sm font-medium text-gray-900">{d.startMonth} {d.startYear}</p>}</div>
                {!d.currentlyWorking && <div><p className="text-xs text-gray-400 mb-1">End</p>{isEd ? <div className="flex gap-2"><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.endMonth} onChange={(e) => setDraft({ ...d, endMonth: e.target.value })}><option value="">Month</option>{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => <option key={m}>{m}</option>)}</select><select className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={d.endYear} onChange={(e) => setDraft({ ...d, endYear: e.target.value })}><option value="">Year</option>{Array.from({length:30},(_,i)=>String(new Date().getFullYear()-i)).map((y) => <option key={y}>{y}</option>)}</select></div> : <p className="text-sm font-medium text-gray-900">{d.endMonth} {d.endYear}</p>}</div>}
                <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">Description / Key Responsibilities</p>{isEd ? <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9] resize-none" value={d.description} onChange={(e) => setDraft({ ...d, description: e.target.value })} /> : <p className="text-sm text-gray-700">{d.description || "—"}</p>}</div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No work experience added. Click &quot;Add Experience&quot; to get started.</p>}
      </div>
    </div>
  );
}

// ── Skills & Languages ────────────────────────────────────────
function SkillsSection({ currentEmpId }: { currentEmpId?: string | null }) {
  const [skills, setSkills] = useState<string[]>([]);
  const [langs, setLangs] = useState<{lang:string;level:string}[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [newLang, setNewLang] = useState({lang:"",level:"Beginner"});
  const LEVELS = ["Beginner","Intermediate","Fluent","Native"];

  useEffect(() => {
    if (!currentEmpId) return;
    getDoc(fsDoc(db, "employees", currentEmpId)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.skills)) setSkills(data.skills as string[]);
        if (Array.isArray(data.languages)) setLangs(data.languages as {lang:string;level:string}[]);
      }
    }).catch(() => {});
  }, [currentEmpId]);

  function persistSkills(updatedSkills: string[], updatedLangs: {lang:string;level:string}[]) {
    if (currentEmpId) {
      updateDoc(fsDoc(db, "employees", currentEmpId), { skills: updatedSkills, languages: updatedLangs }).catch(() => {});
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4"><User size={16} className="text-[#4F3CC9]" /> Skills</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {skills.map((s) => <span key={s} className="flex items-center gap-1.5 px-3 py-1 bg-[#EDE9FF] text-[#4F3CC9] rounded-full text-sm font-medium">{s}<button onClick={() => { const updated = skills.filter((x) => x !== s); setSkills(updated); persistSkills(updated, langs); }} className="text-[#4F3CC9]/50 hover:text-[#4F3CC9]"><X size={12} /></button></span>)}
        </div>
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" placeholder="Add a skill..." value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newSkill.trim()) { const updated = [...skills, newSkill.trim()]; setSkills(updated); persistSkills(updated, langs); setNewSkill(""); }}} />
          <button onClick={() => { if (newSkill.trim()) { const updated = [...skills, newSkill.trim()]; setSkills(updated); persistSkills(updated, langs); setNewSkill(""); }}} className="px-4 py-2 bg-[#4F3CC9] text-white rounded-xl text-sm font-medium hover:bg-[#3d2fa3]"><Plus size={14} /></button>
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Languages Known</h3>
        <div className="space-y-2 mb-3">
          {langs.map((l, i) => <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl"><div><p className="text-sm font-medium text-gray-900">{l.lang}</p><p className="text-xs text-gray-400">{l.level}</p></div><button onClick={() => { const updated = langs.filter((_, idx) => idx !== i); setLangs(updated); persistSkills(skills, updated); }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></div>)}
        </div>
        <div className="flex gap-2">
          <input className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" placeholder="Language" value={newLang.lang} onChange={(e) => setNewLang({ ...newLang, lang: e.target.value })} />
          <select className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={newLang.level} onChange={(e) => setNewLang({ ...newLang, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          <button onClick={() => { if (newLang.lang.trim()) { const updated = [...langs, newLang]; setLangs(updated); persistSkills(skills, updated); setNewLang({ lang: "", level: "Beginner" }); }}} className="px-4 py-2 bg-[#4F3CC9] text-white rounded-xl text-sm font-medium hover:bg-[#3d2fa3]"><Plus size={14} /></button>
        </div>
      </div>
    </div>
  );
}

// ── Government IDs ────────────────────────────────────────────
interface GovtIdInit {
  aadhar?: string; pan?: string; passport?: string; drivingLicense?: string;
  dob?: string; bloodGroup?: string; gender?: string; maritalStatus?: string; nationality?: string;
}
// Fields set by HR — employee can view but not edit
const HR_LOCKED_FIELDS = new Set(["dob","gender","bloodGroup","maritalStatus","nationality","pan","aadhar"]);

function GovtIdSection({ initData = {}, currentEmpId }: { initData?: GovtIdInit; currentEmpId?: string | null }) {
  const [editing, setEditing] = useState(false);
  const blank = { aadhar: "", pan: "", passport: "", drivingLicense: "", dob: "", bloodGroup: "", gender: "", maritalStatus: "", nationality: "" };
  const [form, setForm] = useState({ ...blank, ...initData });
  const [draft, setDraft] = useState({ ...blank, ...initData });

  useEffect(() => {
    const filled = { ...blank, ...initData };
    setForm(filled);
    setDraft(filled);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData.dob, initData.gender, initData.bloodGroup, initData.nationality, initData.maritalStatus, initData.pan, initData.aadhar]);

  const inp = (f: keyof typeof draft, label: string) => {
    const isHrLocked = HR_LOCKED_FIELDS.has(f) && !!(initData as Record<string, string>)[f];
    return (
      <div key={f}>
        <div className="flex items-center gap-1 mb-1">
          <p className="text-xs text-gray-400">{label}</p>
          {isHrLocked && <span className="text-xs text-[#4F3CC9] bg-[#EDE9FF] px-1.5 py-0.5 rounded font-medium">By HR</span>}
        </div>
        {editing && !isHrLocked
          ? <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#4F3CC9]" value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
          : <p className="text-sm font-medium text-gray-900">{form[f] || "—"}</p>
        }
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Lock size={16} className="text-[#4F3CC9]" /> Personal & Government IDs</h3>
        {!editing
          ? <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm text-[#4F3CC9] font-medium hover:underline"><Edit2 size={14} /> Edit</button>
          : <div className="flex gap-2"><button onClick={() => { setDraft({ ...form }); setEditing(false); }} className="text-sm text-gray-500 font-medium">Cancel</button><button onClick={() => { setForm({ ...draft }); setEditing(false); if (currentEmpId) { updateDoc(fsDoc(db, "employees", currentEmpId), { ...draft }).catch(() => {}); } }} className="flex items-center gap-1 text-xs bg-[#4F3CC9] text-white px-4 py-1.5 rounded-full"><Save size={12} /> Save</button></div>
        }
      </div>
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
      {editing && (
        <p className="text-xs text-gray-400 mt-4 flex items-center gap-1">
          <Lock size={11} /> Fields marked <span className="text-[#4F3CC9] font-medium">By HR</span> are set by HR and cannot be edited.
        </p>
      )}
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
  { id: "pan-card",          name: "PAN Card",                 category: "Identity",     status: "Pending" },
  { id: "aadhar",            name: "Aadhar Card",              category: "Identity",     status: "Pending" },
  { id: "10th-memo",         name: "10th Marks Memo",          category: "Education",    status: "Pending" },
  { id: "inter-memo",        name: "Intermediate Memo (12th)", category: "Education",    status: "Pending" },
  { id: "degree",            name: "Degree Certificate",       category: "Education",    status: "Pending" },
  { id: "resume",            name: "Resume / CV",              category: "Professional", status: "Pending" },
  { id: "offer-letter",      name: "Offer Letter",             category: "Employment",   status: "Pending", hrOnly: true },
  { id: "internship-letter", name: "Internship Letter",        category: "Employment",   status: "Pending", hrOnly: true },
  { id: "bank-proof",        name: "Bank Passbook / Cheque",   category: "Financial",    status: "Pending" },
];

const DOC_STYLE: Record<string, { iconBg: string; icon: string; badge: string; badgeText: string }> = {
  Identity:     { iconBg: "bg-blue-50",   icon: "text-blue-500",   badge: "bg-blue-100",   badgeText: "text-blue-700"   },
  Education:    { iconBg: "bg-green-50",  icon: "text-green-500",  badge: "bg-green-100",  badgeText: "text-green-700"  },
  Professional: { iconBg: "bg-purple-50", icon: "text-[#4F3CC9]",  badge: "bg-purple-100", badgeText: "text-[#4F3CC9]"  },
  Employment:   { iconBg: "bg-orange-50", icon: "text-orange-500", badge: "bg-orange-100", badgeText: "text-orange-700" },
  Financial:    { iconBg: "bg-yellow-50", icon: "text-yellow-600", badge: "bg-yellow-100", badgeText: "text-yellow-700" },
  Other:        { iconBg: "bg-gray-100",  icon: "text-gray-400",   badge: "bg-gray-100",   badgeText: "text-gray-600"   },
};

interface EmpRecord {
  id: string; name: string; designation: string; department: string;
  email: string; phone: string; emergencyContact: string;
  reportingManager: string; gender: string; dob: string; bloodGroup: string;
  nationality: string; maritalStatus: string; workMode: string;
  employmentType: string; doj: string; status: string; branch: string;
  ctc: string; noticePeriod: string; shift: string;
  panNumber: string; aadharNumber: string;
  photoURL?: string;
}

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<ProfileTab>("Overview");
  const [empData, setEmpData] = useState<Partial<EmpRecord>>({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    emergencyContact: "",
    currentAddress: "",
    permanentAddress: "",
  });
  const [draft, setDraft] = useState({ ...form });

  // Load employee data from Firebase Auth → HR portal
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        // Try email lookup first — this finds the actual Firestore doc
        let empRecord: EmpRecord | null = null;
        if (user.email) {
          const emailSnap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
          if (!emailSnap.empty) {
            empRecord = { ...emailSnap.docs[0].data(), id: emailSnap.docs[0].id } as EmpRecord;
            setEmpDocId(emailSnap.docs[0].id);
          }
        }
        // Fallback: users/{uid}.employeeId
        const snap = await getDoc(fsDoc(db, "users", user.uid));
        const eid = snap.exists() ? (snap.data().employeeId as string ?? "") : "";
        if (eid) setCurrentEmpId(eid);
        if (!empRecord && eid) {
          const empDoc = await getDoc(fsDoc(db, "employees", eid));
          if (empDoc.exists()) {
            empRecord = { ...empDoc.data(), id: empDoc.id } as EmpRecord;
            setEmpDocId(empDoc.id);
          }
        }
        const emp = empRecord;
        if (emp) {
          setEmpData(emp);
          if (emp.photoURL) setProfilePhoto(emp.photoURL as string);
          const filled = {
            fullName: emp.name ?? "",
            email: emp.email ?? "",
            phone: emp.phone ?? "",
            emergencyContact: emp.emergencyContact ?? "",
            currentAddress: "",
            permanentAddress: "",
          };
          setForm(filled);
          setDraft(filled);
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, []);
  const [passwordForm, setPasswordForm] = useState({ current: "", newPw: "", confirm: "" });
  const [pwErrors, setPwErrors] = useState<{ current?: string; newPw?: string; confirm?: string }>({});
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });

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
    if (!user || !user.email) { setPwErrors({ current: "Session expired. Please log in again." }); return; }

    setPwSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, passwordForm.current);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passwordForm.newPw);
      setPwSuccess(true);
      setPasswordForm({ current: "", newPw: "", confirm: "" });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential")
        setPwErrors({ current: "Current password is incorrect." });
      else if (code === "auth/too-many-requests")
        setPwErrors({ current: "Too many attempts. Please wait and try again." });
      else
        setPwErrors({ current: "Failed to update password. Please try again." });
    } finally {
      setPwSaving(false);
    }
  }

  async function handleForgotPassword() {
    const user = auth.currentUser;
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 5000);
    } catch { /* silent */ }
  }
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoToast, setPhotoToast] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFileRef = useRef<File | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
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

  function saveEdu() {
    if (!eduDraft) return;
    setEducation((prev) => {
      const exists = prev.find((e) => e.id === eduDraft.id);
      return exists ? prev.map((e) => e.id === eduDraft.id ? eduDraft : e) : [...prev, eduDraft];
    });
    setEditEduId(null);
    setEduDraft(null);
    setEduToast("Education details saved.");
    setTimeout(() => setEduToast(null), 3000);
  }

  function deleteEdu(id: string) {
    setEducation((prev) => prev.filter((e) => e.id !== id));
  }

  function handleCertUpload(e: React.ChangeEvent<HTMLInputElement>, id: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (editEduId === id && eduDraft) {
      setEduDraft({ ...eduDraft, certificateFile: url, certificateName: file.name });
    }
    e.target.value = "";
  }

  // Documents state
  const [docs, setDocs] = useState<DocItem[]>(() => PREDEFINED_DOCS.map(d => ({ ...d })));
  const [viewDoc, setViewDoc] = useState<DocItem | null>(null);
  const [docToast, setDocToast] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const docSlotRefs = useRef<{ [id: string]: HTMLInputElement | null }>({});
  const [currentEmpId, setCurrentEmpId] = useState<string | null>(null);
  const [empDocId,     setEmpDocId]     = useState<string | null>(null); // actual Firestore doc ID

  // Load documents from Firestore when empId resolves
  useEffect(() => {
    if (!currentEmpId) return;
    loadDocMeta(currentEmpId).then((stored) => {
      setDocs(PREDEFINED_DOCS.map(d => {
        const s = stored[d.id];
        return s ? { ...d, ...s } : d;
      }).concat(
        Object.entries(stored)
          .filter(([, v]) => v.isExtra)
          .map(([k, v]) => ({ id: k, ...v } as DocItem))
      ));
    }).catch(() => {});
  }, [currentEmpId]);

  function showDocToast(msg: string) {
    setDocToast(msg);
    setTimeout(() => setDocToast(null), 3000);
  }

  async function handleSlotUpload(e: React.ChangeEvent<HTMLInputElement>, docId: string) {
    const file = e.target.files?.[0];
    if (!file || !currentEmpId) return;
    const ext = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
    const slotDef = PREDEFINED_DOCS.find(d => d.id === docId);
    setUploadingSlot(docId);
    setUploadProgress(0);
    try {
      const { url: fileUrl, path: storagePath } = await uploadDocFile(currentEmpId, docId, file, setUploadProgress);
      const meta: DocItem = {
        id: docId,
        name: slotDef?.name ?? file.name.replace(/\.[^.]+$/, ""),
        category: slotDef?.category ?? "Other",
        status: "Uploaded",
        fileUrl,
        fileName: file.name,
        fileExt: ext,
        fileSize: file.size,
        hrOnly: slotDef?.hrOnly,
      };
      await saveDocMeta(currentEmpId, docId, { ...meta, storagePath, uploadedBy: "employee" });
      setDocs(prev => prev.map(d => d.id === docId ? meta : d));
      showDocToast(`"${meta.name}" uploaded successfully!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showDocToast(`Upload failed: ${msg}`);
      console.error("[SlotUpload]", err);
    } finally {
      setUploadingSlot(null);
      e.target.value = "";
    }
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentEmpId) return;
    const ext = file.name.split(".").pop()?.toUpperCase() ?? "FILE";
    const slotId = `extra-${Date.now()}`;
    const docName = file.name.replace(/\.[^.]+$/, "");
    setUploadingSlot("extra");
    setUploadProgress(0);
    try {
      const { url: fileUrl, path: storagePath } = await uploadDocFile(currentEmpId, slotId, file, setUploadProgress);
      const newDoc: DocItem = {
        id: slotId,
        name: docName,
        category: "Other",
        status: "Uploaded",
        fileUrl,
        fileName: file.name,
        fileExt: ext,
        fileSize: file.size,
        isExtra: true,
      };
      await saveDocMeta(currentEmpId, slotId, { ...newDoc, storagePath, uploadedBy: "employee" });
      setDocs((prev) => [...prev, newDoc]);
      showDocToast(`"${docName}" uploaded successfully!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showDocToast(`Upload failed: ${msg}`);
      console.error("[DocUpload]", err);
    } finally {
      setUploadingSlot(null);
      e.target.value = "";
    }
  }

  function handleDownload(doc: DocItem) {
    if (doc.fileUrl) {
      const a = document.createElement("a");
      a.href = doc.fileUrl;
      a.download = doc.fileName ?? doc.name;
      a.click();
    } else {
      // Generate a simple mock PDF text blob for system docs
      const content = `Woways\n\nDocument: ${doc.name}\nDate: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}\n\nThis is an official document issued by Woways.\nPlease contact HR for queries.`;
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.name}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showDocToast(`"${doc.name}" downloaded.`);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    uploadFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewPhoto(ev.target?.result as string);
      setShowPhotoModal(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function confirmPhoto() {
    const file = uploadFileRef.current;
    if (!file || !previewPhoto) return;
    // Resolve doc ID — empDocId (email-lookup) is most reliable, fall back to users/{uid}.employeeId
    // If both are null, do a fresh email lookup right here as a safety net
    let docId: string | null = empDocId || currentEmpId;
    if (!docId && auth.currentUser?.email) {
      try {
        const s = await getDocs(query(collection(db, "employees"), where("email", "==", auth.currentUser.email)));
        if (!s.empty) { docId = s.docs[0].id; setEmpDocId(docId); }
      } catch { /* ignore */ }
    }
    if (!docId) return;
    setShowPhotoModal(false);
    setPhotoUploading(true);
    try {
      const sRef = storageRef(storage, `profile-photos/${docId}`);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      // setDoc with merge: safe even if doc structure has changed, never fails on missing field
      await setDoc(fsDoc(db, "employees", docId), { photoURL: url }, { merge: true });
      // Also update Firebase Auth user profile so sidebar can read it from auth.currentUser
      if (auth.currentUser) {
        try { await updateProfile(auth.currentUser, { photoURL: url }); } catch { /* ignore */ }
      }
      // Broadcast to sidebar and any other mounted components on the same page
      window.dispatchEvent(new CustomEvent("employeePhotoUpdated", { detail: { url } }));
      setProfilePhoto(url);
      setPhotoToast(true);
      setTimeout(() => setPhotoToast(false), 3000);
    } catch (err) {
      console.error("[PhotoUpload]", err);
    } finally {
      setPhotoUploading(false);
      setPreviewPhoto(null);
      uploadFileRef.current = null;
    }
  }

  async function removePhoto() {
    let docId: string | null = empDocId || currentEmpId;
    if (!docId && auth.currentUser?.email) {
      try {
        const s = await getDocs(query(collection(db, "employees"), where("email", "==", auth.currentUser.email)));
        if (!s.empty) docId = s.docs[0].id;
      } catch { /* ignore */ }
    }
    if (docId) {
      try {
        await deleteObject(storageRef(storage, `profile-photos/${docId}`));
      } catch { /* may not exist */ }
      try {
        await setDoc(fsDoc(db, "employees", docId), { photoURL: deleteField() }, { merge: true });
      } catch { /* ignore */ }
      if (auth.currentUser) {
        try { await updateProfile(auth.currentUser, { photoURL: "" }); } catch { /* ignore */ }
      }
      window.dispatchEvent(new CustomEvent("employeePhotoUpdated", { detail: { url: "" } }));
    }
    setProfilePhoto(null);
    setShowPhotoModal(false);
    setPreviewPhoto(null);
  }

  const tabs: ProfileTab[] = [
    "Overview",
    "Personal Details",
    "Employment Details",
    "Documents",
    "Security",
  ];

  const handleSave = async () => {
    if (currentEmpId) {
      try {
        await updateDoc(fsDoc(db, "employees", currentEmpId), {
          phone: draft.phone,
          emergencyContact: draft.emergencyContact,
          name: draft.fullName,
          currentAddress: draft.currentAddress,
          permanentAddress: draft.permanentAddress,
        });
      } catch { /* ignore — UI still updates */ }
    }
    setForm({ ...draft });
    setEditing(false);
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

      {/* Document View Modal */}
      {viewDoc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewDoc(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
                  <FileText size={16} className="text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{viewDoc.name}</p>
                  <p className="text-xs text-gray-400">{viewDoc.fileExt ?? viewDoc.category} · {viewDoc.fileName ?? "Document"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDownload(viewDoc)} className="flex items-center gap-1.5 text-xs bg-[#4F3CC9] text-white px-3 py-1.5 rounded-full font-medium hover:bg-[#3d2fa3]">
                  <Download size={12} /> Download
                </button>
                <button onClick={() => setViewDoc(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {viewDoc.fileUrl ? (
                viewDoc.fileExt === "PDF" || viewDoc.fileName?.endsWith(".pdf") ? (
                  <iframe src={viewDoc.fileUrl} className="w-full h-96 rounded-xl border border-gray-100" title={viewDoc.name} />
                ) : (viewDoc.fileExt ?? "").match(/^(PNG|JPG|JPEG|GIF|WEBP|SVG)$/) || viewDoc.fileName?.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ? (
                  <img src={viewDoc.fileUrl} alt={viewDoc.name} className="max-w-full mx-auto rounded-xl border border-gray-100" />
                ) : (
                  <div className="text-center py-12 text-gray-400 text-sm">Preview not available for this file type.<br />Please download to view.</div>
                )
              ) : (
                <div className="bg-[#F5F3FF] rounded-xl p-8 space-y-4 font-mono text-sm text-gray-700">
                  <p className="text-center font-bold text-base text-gray-900">Woways</p>
                  <hr className="border-[#4F3CC9]/20" />
                  <p><span className="text-gray-400">Document:</span> {viewDoc.name}</p>
                  <p><span className="text-gray-400">Employee:</span> —</p>
                  <p><span className="text-gray-400">Department:</span> —</p>
                  <p><span className="text-gray-400">Date Issued:</span> {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</p>
                  <hr className="border-[#4F3CC9]/20" />
                  <p className="text-gray-500 text-xs leading-relaxed">This is an official document issued by Woways to the above-named employee. This document is confidential and intended solely for the use of the individual named. For queries, please contact the HR department.</p>
                  <p className="text-center text-xs text-[#4F3CC9] font-semibold mt-4">✦ Verified & Sealed by Woways ✦</p>
                </div>
              )}
            </div>
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

      {/* Hidden file input for documents */}
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
        className="hidden"
        onChange={handleDocUpload}
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
              <button onClick={confirmPhoto} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3]">Save Photo</button>
            </div>
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
                  {(empData.name ?? form.fullName)?.[0]?.toUpperCase() ?? "?"}
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
            <h2 className="text-2xl font-bold text-gray-900">{empData.name || form.fullName || "—"}</h2>
            <p className="text-sm text-gray-500 mt-1">{empData.designation || "—"}</p>
            <p className="text-sm text-gray-400">{empData.department || "—"}</p>

            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <CheckCircle size={12} /> {empData.status || "Active"}
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                <Briefcase size={12} /> {empData.employmentType || "Full-Time"}
              </span>
            </div>

            <div className="w-full border-t border-gray-100 mt-6 pt-5 grid grid-cols-2 gap-4 text-left">
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">
                  {form.email}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">
                  {form.phone}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Employee ID</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData.id || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Date of Joining</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData.doj || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Reporting Manager</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData.reportingManager || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Work Mode</p>
                <p className="text-sm font-medium text-gray-900 mt-0.5">{empData.workMode || "—"}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => !photoUploading && fileInputRef.current?.click()}
                disabled={photoUploading}
                className="flex items-center gap-2 border border-gray-200 text-gray-700 px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Upload size={15} /> {photoUploading ? "Uploading…" : "Edit Profile Photo"}
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

                const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    {children}
                  </div>
                );

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
          <WorkExperienceSection currentEmpId={currentEmpId} />

          {/* Skills & Languages */}
          <SkillsSection currentEmpId={currentEmpId} />

          {/* Government IDs */}
          <GovtIdSection initData={{
            dob: empData.dob, gender: empData.gender,
            bloodGroup: empData.bloodGroup, maritalStatus: empData.maritalStatus,
            nationality: empData.nationality,
            pan: empData.panNumber, aadhar: empData.aadharNumber,
          }} currentEmpId={currentEmpId} />

          {/* Documents — View Only */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={16} className="text-[#4F3CC9]" />
                My Documents
              </h3>
              <span className="text-xs text-gray-400 italic">Manage in Documents tab</span>
            </div>
            {docs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No documents uploaded yet. Go to the Documents tab to upload.</p>
            ) : (
              <div className="space-y-3">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                        <FileText size={15} className="text-red-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                        <p className="text-xs text-gray-400">{doc.fileExt ?? doc.category}{doc.isExtra ? " · Uploaded by you" : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        doc.status === "Uploaded" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {doc.status === "Uploaded" ? <><CheckCircle size={10} /> Uploaded</> : <><Clock size={10} /> Pending</>}
                      </span>
                      {doc.status === "Uploaded" && (
                        <button onClick={() => setViewDoc(doc)} className="flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9]/30 px-3 py-1.5 rounded-full hover:bg-[#EDE9FF] transition-colors">
                          <Eye size={12} /> View
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                { label: "Employee ID",      value: empData.id },
                { label: "Designation",      value: empData.designation },
                { label: "Department",       value: empData.department },
                { label: "Employment Type",  value: empData.employmentType },
                { label: "Work Mode",        value: empData.workMode },
                { label: "Date of Joining",  value: empData.doj },
                { label: "Reporting Manager",value: empData.reportingManager },
                { label: "Location",         value: empData.branch },
                { label: "Shift",            value: empData.shift },
                { label: "Annual Payroll",     value: empData.ctc },
                { label: "Notice Period",    value: empData.noticePeriod },
                { label: "Status",           value: empData.status },
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
                <p className="text-sm font-medium text-gray-900">HR Pulse Technologies, 5th Floor, Tower B, Prestige Tech Park, Bengaluru — 560103</p>
              </div>
            </div>
          </div>

          {/* Work Role History */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <Briefcase size={16} className="text-[#4F3CC9]" />
              Work Role History
            </h3>
            {empData && Array.isArray((empData as Record<string, unknown>).roleHistory) && ((empData as Record<string, unknown>).roleHistory as unknown[]).length > 0 ? (
              <div className="space-y-3">
                {((empData as Record<string, unknown>).roleHistory as Record<string, string>[]).map((r, i) => (
                  <div key={i} className="flex items-start gap-3 border-l-2 border-[#4F3CC9] pl-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{r.role ?? r.designation ?? "—"}</p>
                      <p className="text-xs text-gray-400">{r.from ?? ""}{r.to ? ` — ${r.to}` : " — Present"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : empData ? (
              <div className="flex items-start gap-3 border-l-2 border-[#4F3CC9] pl-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{empData.designation || "—"}</p>
                  <p className="text-xs text-gray-400">{empData.doj ? `From ${empData.doj}` : ""} — Present</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No role history available.</p>
            )}
          </div>

          {/* Manager History */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-5">
              <User size={16} className="text-[#4F3CC9]" />
              Manager History
            </h3>
            {empData && Array.isArray((empData as Record<string, unknown>).managerHistory) && ((empData as Record<string, unknown>).managerHistory as unknown[]).length > 0 ? (
              <div className="space-y-3">
                {((empData as Record<string, unknown>).managerHistory as Record<string, string>[]).map((m, i) => (
                  <div key={i} className="flex items-start gap-3 border-l-2 border-[#4F3CC9] pl-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.manager ?? m.name ?? "—"}</p>
                      <p className="text-xs text-gray-400">{m.from ?? ""}{m.to ? ` — ${m.to}` : " — Present"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : empData?.reportingManager ? (
              <div className="flex items-start gap-3 border-l-2 border-[#4F3CC9] pl-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{empData.reportingManager}</p>
                  <p className="text-xs text-gray-400">{empData.doj ? `From ${empData.doj}` : ""} — Present</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No manager history available.</p>
            )}
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
                        <p className="text-sm font-semibold text-gray-900 truncate">{doc.name}</p>
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
                          {doc.hrOnly && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EDE9FF] text-[#4F3CC9] text-xs font-medium">
                              By HR
                            </span>
                          )}
                          <button
                            onClick={() => setViewDoc(doc)}
                            className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-[#4F3CC9] border border-gray-200 hover:border-[#4F3CC9] px-2.5 py-1 rounded-full transition-colors"
                          >
                            <Eye size={12} /> View
                          </button>
                          {!doc.hrOnly && (
                            <button
                              onClick={() => handleDownload(doc)}
                              className="flex items-center gap-1 text-xs text-white bg-[#4F3CC9] hover:bg-[#3d2fa3] px-2.5 py-1 rounded-full transition-colors"
                            >
                              <Download size={12} /> Download
                            </button>
                          )}
                          {!doc.hrOnly && (
                            <button
                              onClick={async () => {
                                if (!currentEmpId) return;
                                try {
                                  if (doc.isExtra) {
                                    await updateDoc(
                                      fsDoc(db, "employeeDocuments", currentEmpId),
                                      { [doc.id]: deleteField() }
                                    );
                                    setDocs(prev => prev.filter(d => d.id !== doc.id));
                                  } else {
                                    const slotDef = PREDEFINED_DOCS.find(pd => pd.id === doc.id);
                                    await updateDoc(
                                      fsDoc(db, "employeeDocuments", currentEmpId),
                                      { [doc.id]: { name: slotDef?.name ?? doc.name, category: slotDef?.category ?? "Other", status: "Pending", hrOnly: slotDef?.hrOnly ?? false } }
                                    );
                                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: "Pending", fileUrl: undefined, fileName: undefined, fileExt: undefined } : d));
                                  }
                                } catch {
                                  showDocToast("Delete failed. Please try again.");
                                }
                              }}
                              className="p-1.5 rounded-full text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Remove"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      ) : doc.hrOnly ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                          <Clock size={11} /> Awaiting HR
                        </span>
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
                          <button
                            onClick={() => docSlotRefs.current[doc.id]?.click()}
                            className="ml-auto flex items-center gap-1 text-xs text-[#4F3CC9] border border-[#4F3CC9] hover:bg-[#EDE9FF] px-2.5 py-1 rounded-full transition-colors font-medium"
                          >
                            <Upload size={12} /> Upload
                          </button>
                        </>
                      )}
                      {!doc.hrOnly && <input
                        type="file"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
                        className="hidden"
                        ref={el => { docSlotRefs.current[doc.id] = el; }}
                        onChange={e => handleSlotUpload(e, doc.id)}
                      />}
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
                onClick={() => docInputRef.current?.click()}
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

      {/* Security Tab */}
      {activeTab === "Security" && (
        <div className="space-y-5">

          {/* Change Password */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center shrink-0">
                <Lock size={18} className="text-[#4F3CC9]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Change Password</h2>
                <p className="text-xs text-gray-400 mt-0.5">Update your account password</p>
              </div>
            </div>

            {pwSuccess && (
              <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle size={16} className="text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-800">Password updated successfully!</p>
              </div>
            )}

            <div className="space-y-4 max-w-md">
              {/* Current password */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Current Password</label>
                <div className="relative">
                  <input type={showPw.current ? "text" : "password"} placeholder="Enter current password"
                    value={passwordForm.current}
                    onChange={(e) => { setPasswordForm({ ...passwordForm, current: e.target.value }); setPwErrors({}); setPwSuccess(false); }}
                    className={`pr-10 pl-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full font-mono ${pwErrors.current ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"}`} />
                  <button type="button" onClick={() => setShowPw({ ...showPw, current: !showPw.current })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.current ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pwErrors.current && <p className="text-xs text-red-500 mt-1">{pwErrors.current}</p>}
              </div>

              {/* New password */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">New Password</label>
                <div className="relative">
                  <input type={showPw.newPw ? "text" : "password"} placeholder="Min. 8 characters"
                    value={passwordForm.newPw}
                    onChange={(e) => { setPasswordForm({ ...passwordForm, newPw: e.target.value }); setPwErrors({}); setPwSuccess(false); }}
                    className={`pr-10 pl-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full font-mono ${pwErrors.newPw ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"}`} />
                  <button type="button" onClick={() => setShowPw({ ...showPw, newPw: !showPw.newPw })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.newPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pwErrors.newPw && <p className="text-xs text-red-500 mt-1">{pwErrors.newPw}</p>}
              </div>

              {/* Confirm password */}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input type={showPw.confirm ? "text" : "password"} placeholder="Re-enter new password"
                    value={passwordForm.confirm}
                    onChange={(e) => { setPasswordForm({ ...passwordForm, confirm: e.target.value }); setPwErrors({}); setPwSuccess(false); }}
                    className={`pr-10 pl-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 w-full font-mono ${pwErrors.confirm ? "border-red-300 focus:ring-red-200" : "border-gray-200 focus:ring-[#4F3CC9]/30"}`} />
                  <button type="button" onClick={() => setShowPw({ ...showPw, confirm: !showPw.confirm })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw.confirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pwErrors.confirm && <p className="text-xs text-red-500 mt-1">{pwErrors.confirm}</p>}
              </div>

              <button onClick={handlePasswordUpdate} disabled={pwSaving}
                className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa3] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors">
                {pwSaving ? <><AlertCircle size={14} className="animate-pulse" />Updating…</> : <><Lock size={14} />Update Password</>}
              </button>
            </div>
          </div>

          {/* Forgot Password */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <AlertCircle size={18} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Forgot Password?</h2>
                <p className="text-xs text-gray-400 mt-0.5">Can&apos;t remember your password? We&apos;ll send a reset link to your email</p>
              </div>
            </div>

            {resetSent && (
              <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800">Reset email sent!</p>
                  <p className="text-xs text-green-700 mt-0.5">Check your inbox at <span className="font-semibold">{auth.currentUser?.email}</span> — click the link to set a new password. Expires in 1 hour.</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 max-w-md">
              <span className="text-sm text-gray-600 flex-1">{auth.currentUser?.email ?? "—"}</span>
              <button onClick={handleForgotPassword}
                className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-blue-700 flex items-center gap-1.5 transition-colors shrink-0">
                Send Reset Link
              </button>
            </div>
            <p className="text-xs text-gray-400 max-w-md">After clicking, check your inbox and spam folder. Click the link to set a new password, then log back in.</p>
          </div>

        </div>
      )}
    </div>
  );
}
