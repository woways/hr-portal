"use client";
import { useState, useRef, useEffect } from "react";
import { Plus, Search, X, Star, Download, Eye, Pencil, Upload, FileText, Loader2 } from "lucide-react";
import { collection, addDoc, getDocs } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

type CandidateStatus = "Applied" | "Screening" | "Shortlisted" | "Interview Scheduled" | "Interview Completed" | "Selected" | "Rejected" | "Offer Released" | "Joined";
type InterviewStatus = "Scheduled" | "Completed" | "Cancelled" | "Rescheduled";
type OfferStatus = "Pending" | "Accepted" | "Rejected" | "Expired";

interface Candidate {
  id: string;
  name: string;
  mobile: string;
  email: string;
  role: string;
  department: string;
  experience: string;
  college: string;
  linkedin: string;
  source: string;
  recruiter: string;
  status: CandidateStatus;
  notes: string;
  resumeUrl?: string;
  resumeName?: string;
}

interface Interview {
  id: string;
  candidateName: string;
  round: string;
  date: string;
  time: string;
  interviewer: string;
  meetingLink: string;
  rating: number;
  feedback: string;
  status: InterviewStatus;
  finalDecision: "Pending" | "Select" | "Reject" | "";
  reminderSent: boolean;
}

interface Offer {
  id: string;
  candidateName: string;
  role: string;
  salary: string;
  type: string;
  offerDate: string;
  status: OfferStatus;
  offerLetterUploaded: boolean;
}

interface OnboardingDoc { name: string; submitted: boolean; }
interface Onboarding {
  id: string;
  name: string;
  email: string;
  role: string;
  empId: string;
  doj: string;
  department: string;
  manager: string;
  workMode: string;
  docs: OnboardingDoc[];
  welcomeEmailSent: boolean;
  employeeCreated: boolean;
}

const initCandidates: Candidate[] = [];

const initInterviews: Interview[] = [];

const initOffers: Offer[] = [];

const defaultDocs = (): OnboardingDoc[] => [
  { name: "Offer Letter", submitted: false },
  { name: "Aadhaar / PAN Card", submitted: false },
  { name: "Bank Details", submitted: false },
  { name: "Emergency Contact Form", submitted: false },
  { name: "NDA / Agreement", submitted: false },
  { name: "Education Certificate", submitted: false },
  { name: "Experience Letter", submitted: false },
];

const initOnboarding: Onboarding[] = [];

const statusColorMap: Record<CandidateStatus, string> = {
  Applied: "bg-gray-100 text-gray-600",
  Screening: "bg-blue-100 text-blue-700",
  Shortlisted: "bg-purple-100 text-purple-700",
  "Interview Scheduled": "bg-orange-100 text-orange-700",
  "Interview Completed": "bg-yellow-100 text-yellow-700",
  Selected: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  "Offer Released": "bg-teal-100 text-teal-700",
  Joined: "bg-emerald-100 text-emerald-700",
};

const interviewStatusColor: Record<InterviewStatus, string> = {
  Scheduled: "bg-blue-100 text-blue-700",
  Completed: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  Rescheduled: "bg-orange-100 text-orange-700",
};

const offerStatusColor: Record<OfferStatus, string> = {
  Pending: "bg-yellow-100 text-yellow-700",
  Accepted: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Expired: "bg-gray-100 text-gray-600",
};

const blankCandidate = { name: "", mobile: "", email: "", role: "", department: "Engineering", experience: "Fresher", college: "", linkedin: "", source: "LinkedIn", recruiter: "", notes: "", resumeUrl: "", resumeName: "" };
const statusPipeline: CandidateStatus[] = ["Applied","Screening","Shortlisted","Interview Scheduled","Interview Completed","Selected","Rejected","Offer Released","Joined"];

function candidateInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}
const blankInterview = { candidateName: "", round: "Round 1", date: "", time: "", interviewer: "", meetingLink: "", feedback: "", rating: 0, finalDecision: "" as const, reminderSent: false };
const blankOffer = { candidateName: "", role: "", salary: "", type: "Full-Time", offerDate: "", status: "Pending" as OfferStatus, offerLetterUploaded: false };

export default function RecruitmentPage() {
  const [activeTab, setActiveTab] = useState<"candidates" | "interviews" | "offers" | "onboarding">("candidates");
  const [candidates, setCandidates] = useState<Candidate[]>(initCandidates);
  const [interviews, setInterviews] = useState<Interview[]>(initInterviews);
  const [offers, setOffers] = useState<Offer[]>(initOffers);
  const [onboarding, setOnboarding] = useState<Onboarding[]>(initOnboarding);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showAddInterview, setShowAddInterview] = useState(false);
  const [editInterview, setEditInterview] = useState<Interview | null>(null);
  const [showAddOffer, setShowAddOffer] = useState(false);
  const [showDocModal, setShowDocModal] = useState<Onboarding | null>(null);
  const [showAddOnboarding, setShowAddOnboarding] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({ name: "", email: "", role: "", empId: "", doj: "", department: "Engineering", manager: "", workMode: "Remote" });
  const [onboardingToast, setOnboardingToast] = useState("");
  const [viewCandidate, setViewCandidate] = useState<Candidate | null>(null);
  const [editCandidate, setEditCandidate] = useState<Candidate | null>(null);
  const [editCandidateForm, setEditCandidateForm] = useState<Candidate | null>(null);
  const [candidateForm, setCandidateForm] = useState({ ...blankCandidate });
  const [interviewForm, setInterviewForm] = useState({ ...blankInterview });
  const [offerForm, setOfferForm] = useState({ ...blankOffer });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [candidateToast, setCandidateToast] = useState<string | null>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  function showCandidateToast(msg: string) { setCandidateToast(msg); setTimeout(() => setCandidateToast(null), 3500); }
  const [rescheduleInterview, setRescheduleInterview] = useState<Interview | null>(null);
  const [reminderToast, setReminderToast] = useState("");
  const [notePanel, setNotePanel] = useState<Candidate | null>(null);
  const [newNote, setNewNote] = useState("");

  // Load candidates from Firestore on mount
  useEffect(() => {
    getDocs(collection(db, "candidates")).then((snap) => {
      if (!snap.empty) {
        const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
        setCandidates(loaded);
      }
    }).catch(() => {});
  }, []);

  const tabs = [
    { id: "candidates", label: "Candidate Database" },
    { id: "interviews", label: "Interview Management" },
    { id: "offers", label: "Offer Management" },
    { id: "onboarding", label: "Onboarding" },
  ] as const;

  const filteredCandidates = candidates.filter((c) => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "All" || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleAddCandidate() {
    if (!candidateForm.name.trim()) { showCandidateToast("Candidate name is required."); return; }
    setAddingCandidate(true);
    try {
      let resumeUrl = "";
      let resumeName = "";

      // Upload resume if selected
      if (resumeFile) {
        setResumeUploading(true);
        const path = `resumes/${Date.now()}_${resumeFile.name.replace(/\s+/g, "_")}`;
        const sRef = storageRef(storage, path);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(sRef, resumeFile);
          task.on("state_changed", undefined, reject, () => resolve());
        });
        resumeUrl  = await getDownloadURL(sRef);
        resumeName = resumeFile.name;
        setResumeUploading(false);
      }

      const payload = {
        ...candidateForm,
        resumeUrl,
        resumeName,
        status: "Applied" as CandidateStatus,
        createdAt: new Date().toISOString(),
      };

      // Save to Firestore
      const docRef = await addDoc(collection(db, "candidates"), payload);
      const newCandidate: Candidate = { id: docRef.id, ...payload };
      setCandidates((prev) => [newCandidate, ...prev]);
      setCandidateForm({ ...blankCandidate });
      setResumeFile(null);
      setShowAddCandidate(false);
      showCandidateToast(`${candidateForm.name} added successfully`);
    } catch (err) {
      console.error("[AddCandidate]", err);
      showCandidateToast("Failed to add candidate. Please try again.");
      setResumeUploading(false);
    } finally {
      setAddingCandidate(false);
    }
  }

  function handleEditCandidateSave() {
    if (!editCandidateForm) return;
    setCandidates(candidates.map((c) => c.id === editCandidateForm.id ? editCandidateForm : c));
    setEditCandidate(null);
    setEditCandidateForm(null);
  }

  function handleAddInterview() {
    const newId = `INT00${interviews.length + 1}`;
    setInterviews([...interviews, { id: newId, status: "Scheduled", ...interviewForm }]);
    setInterviewForm({ ...blankInterview });
    setShowAddInterview(false);
  }

  function handleEditInterviewSave() {
    if (!editInterview) return;
    setInterviews(interviews.map((i) => i.id === editInterview.id ? editInterview : i));
    setEditInterview(null);
  }

  function setRating(id: string, rating: number) {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, rating } : i));
  }

  function sendReminder(id: string, name: string) {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, reminderSent: true } : i));
    setReminderToast(`Reminder sent to ${name}`);
    setTimeout(() => setReminderToast(""), 3000);
  }

  function setFinalDecision(id: string, decision: "Select" | "Reject") {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, finalDecision: decision, status: "Completed" } : i));
  }

  function updateOfferStatus(id: string, status: OfferStatus) {
    setOffers(offers.map((o) => o.id === id ? { ...o, status } : o));
  }

  function markOfferLetterUploaded(id: string) {
    setOffers(offers.map((o) => o.id === id ? { ...o, offerLetterUploaded: true } : o));
  }

  function handleAddOffer() {
    const newId = `OFF00${offers.length + 1}`;
    setOffers([...offers, { id: newId, ...offerForm }]);
    setOfferForm({ ...blankOffer });
    setShowAddOffer(false);
  }

  function sendWelcomeEmail(id: string, name: string) {
    setOnboarding(onboarding.map((o) => o.id === id ? { ...o, welcomeEmailSent: true } : o));
    setOnboardingToast(`Welcome email sent to ${name}`);
    setTimeout(() => setOnboardingToast(""), 3000);
  }

  function toggleDoc(onboardingId: string, docName: string) {
    setOnboarding(onboarding.map((o) => o.id === onboardingId
      ? { ...o, docs: o.docs.map((d) => d.name === docName ? { ...d, submitted: !d.submitted } : d) }
      : o
    ));
    setShowDocModal((prev) => prev ? { ...prev, docs: prev.docs.map((d) => d.name === docName ? { ...d, submitted: !d.submitted } : d) } : null);
  }

  function markEmployeeCreated(id: string) {
    setOnboarding(onboarding.map((o) => o.id === id ? { ...o, employeeCreated: true } : o));
  }

  function handleAddOnboarding() {
    const newId = String(onboarding.length + 1);
    setOnboarding([...onboarding, { id: newId, ...onboardingForm, docs: defaultDocs(), welcomeEmailSent: false, employeeCreated: false }]);
    setOnboardingForm({ name: "", email: "", role: "", empId: "", doj: "", department: "Engineering", manager: "", workMode: "Remote" });
    setShowAddOnboarding(false);
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {candidateToast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {candidateToast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recruitment</h1>
        <p className="text-gray-500 text-sm mt-1">Manage candidates, interviews, offers and onboarding</p>
      </div>

      <div className="flex gap-1 bg-white rounded-2xl shadow-sm p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === t.id ? "bg-[#4F3CC9] text-white" : "text-gray-500 hover:text-gray-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab A: Candidate Database */}
      {activeTab === "candidates" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div className="flex gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input placeholder="Search candidates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none w-48" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                <option value="All">All Statuses</option>
                {Object.keys(statusColorMap).map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={() => setShowAddCandidate(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
              <Plus size={16} /> Add Candidate
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Role Applied</th>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-left">Experience</th>
                    <th className="px-4 py-3 text-left">College</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Recruiter</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredCandidates.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{c.id}</td>
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.role}</td>
                      <td className="px-4 py-3 text-gray-600">{c.department}</td>
                      <td className="px-4 py-3 text-gray-600">{c.experience}</td>
                      <td className="px-4 py-3 text-gray-600">{c.college}</td>
                      <td className="px-4 py-3 text-gray-600">{c.source}</td>
                      <td className="px-4 py-3 text-gray-600">{c.recruiter}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColorMap[c.status]}`}>{c.status}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setViewCandidate(c)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500" title="View"><Eye size={14} /></button>
                          <button onClick={() => { setEditCandidate(c); setEditCandidateForm({ ...c }); }} className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500" title="Edit"><Pencil size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab B: Interview Management */}
      {activeTab === "interviews" && (
        <div className="space-y-4">
          {reminderToast && (
            <div className="fixed top-6 right-6 z-50 bg-green-600 text-white text-sm px-5 py-3 rounded-xl shadow-lg">
              ✓ {reminderToast}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setShowAddInterview(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
              <Plus size={16} /> Schedule Interview
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Candidate</th>
                    <th className="px-4 py-3 text-left">Round</th>
                    <th className="px-4 py-3 text-left">Date & Time</th>
                    <th className="px-4 py-3 text-left">Interviewer</th>
                    <th className="px-4 py-3 text-left">Rating</th>
                    <th className="px-4 py-3 text-left">Feedback</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Final Decision</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {interviews.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{i.candidateName}</td>
                      <td className="px-4 py-3 text-gray-600">{i.round}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        <p>{i.date}</p>
                        <p className="text-gray-400">{i.time}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{i.interviewer}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5">
                          {[1,2,3,4,5].map((s) => (
                            <button key={s} onClick={() => setRating(i.id, s)}>
                              <Star size={13} className={s <= i.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"} />
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs max-w-[140px] truncate">{i.feedback || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${interviewStatusColor[i.status]}`}>{i.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {i.finalDecision === "Select" && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Selected</span>}
                        {i.finalDecision === "Reject" && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Rejected</span>}
                        {(i.finalDecision === "Pending" || i.finalDecision === "") && i.status !== "Cancelled" && (
                          <div className="flex gap-1">
                            <button onClick={() => setFinalDecision(i.id, "Select")} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-lg hover:bg-green-200 font-medium">Select</button>
                            <button onClick={() => setFinalDecision(i.id, "Reject")} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-lg hover:bg-red-200 font-medium">Reject</button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => setEditInterview({ ...i })} title="Edit" className="p-1.5 rounded-lg hover:bg-yellow-50 text-yellow-500"><Pencil size={13} /></button>
                          <button onClick={() => setRescheduleInterview({ ...i, status: "Rescheduled" })} title="Reschedule" className="p-1.5 rounded-lg hover:bg-orange-50 text-orange-500 text-xs font-medium">↺</button>
                          <button
                            onClick={() => sendReminder(i.id, i.candidateName)}
                            disabled={i.reminderSent}
                            title={i.reminderSent ? "Reminder sent" : "Send reminder"}
                            className={`p-1.5 rounded-lg text-xs font-medium ${i.reminderSent ? "text-gray-300 cursor-not-allowed" : "hover:bg-blue-50 text-blue-500"}`}
                          >✉</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab C: Offer Management */}
      {activeTab === "offers" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Offers", val: offers.length, color: "bg-purple-50 text-purple-700" },
              { label: "Pending", val: offers.filter(o => o.status === "Pending").length, color: "bg-yellow-50 text-yellow-700" },
              { label: "Accepted", val: offers.filter(o => o.status === "Accepted").length, color: "bg-green-50 text-green-700" },
              { label: "Rejected / Expired", val: offers.filter(o => o.status === "Rejected" || o.status === "Expired").length, color: "bg-red-50 text-red-700" },
            ].map((c) => (
              <div key={c.label} className={`rounded-2xl p-4 ${c.color}`}>
                <p className="text-xs font-medium opacity-70">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.val}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setShowAddOffer(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
              <Plus size={16} /> Release Offer
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Candidate</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Salary/Stipend</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Offer Date</th>
                    <th className="px-4 py-3 text-left">Offer Letter</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Acceptance Tracking</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {offers.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{o.candidateName}</td>
                      <td className="px-4 py-3 text-gray-600">{o.role}</td>
                      <td className="px-4 py-3 font-semibold text-[#4F3CC9]">{o.salary}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${o.type === "Full-Time" ? "bg-blue-100 text-blue-700" : "bg-teal-100 text-teal-700"}`}>{o.type}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{o.offerDate}</td>
                      <td className="px-4 py-3">
                        {o.offerLetterUploaded ? (
                          <button onClick={() => {}} className="flex items-center gap-1 text-xs text-[#4F3CC9] hover:underline font-medium">
                            <Download size={12} /> Download
                          </button>
                        ) : (
                          <button onClick={() => markOfferLetterUploaded(o.id)} className="flex items-center gap-1 text-xs text-gray-500 border border-dashed border-gray-300 px-2 py-0.5 rounded-lg hover:border-[#4F3CC9] hover:text-[#4F3CC9]">
                            ↑ Upload
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${offerStatusColor[o.status]}`}>{o.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {o.status === "Pending" && (
                          <div className="flex gap-1">
                            <button onClick={() => updateOfferStatus(o.id, "Accepted")} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-lg hover:bg-green-200 font-medium">Accepted</button>
                            <button onClick={() => updateOfferStatus(o.id, "Rejected")} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-lg hover:bg-red-200 font-medium">Rejected</button>
                          </div>
                        )}
                        {o.status === "Accepted" && <span className="text-xs text-green-600 font-medium">✓ Offer Accepted</span>}
                        {o.status === "Rejected" && <span className="text-xs text-red-500 font-medium">✗ Offer Rejected</span>}
                        {o.status === "Expired" && (
                          <button onClick={() => updateOfferStatus(o.id, "Pending")} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg hover:bg-gray-200">Reopen</button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => updateOfferStatus(o.id, "Expired")} className="text-xs text-gray-400 hover:text-red-400 hover:underline">Expire</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab D: Onboarding */}
      {activeTab === "onboarding" && (
        <div className="space-y-4">
          {onboardingToast && (
            <div className="fixed top-6 right-6 z-50 bg-green-600 text-white text-sm px-5 py-3 rounded-xl shadow-lg">✓ {onboardingToast}</div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Onboarding", val: onboarding.length, color: "bg-purple-50 text-purple-700" },
              { label: "Docs Fully Submitted", val: onboarding.filter(o => o.docs.every(d => d.submitted)).length, color: "bg-green-50 text-green-700" },
              { label: "Welcome Email Sent", val: onboarding.filter(o => o.welcomeEmailSent).length, color: "bg-blue-50 text-blue-700" },
              { label: "Employee Created", val: onboarding.filter(o => o.employeeCreated).length, color: "bg-teal-50 text-teal-700" },
            ].map((c) => (
              <div key={c.label} className={`rounded-2xl p-4 ${c.color}`}>
                <p className="text-xs font-medium opacity-70">{c.label}</p>
                <p className="text-2xl font-bold mt-1">{c.val}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setShowAddOnboarding(true)} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
              <Plus size={16} /> Start Onboarding
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F5F3FF] text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Emp ID</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">DOJ</th>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-left">Manager</th>
                    <th className="px-4 py-3 text-left">Work Mode</th>
                    <th className="px-4 py-3 text-left">Doc Status</th>
                    <th className="px-4 py-3 text-left">Welcome Email</th>
                    <th className="px-4 py-3 text-left">Emp Created</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {onboarding.map((o) => {
                    const submitted = o.docs.filter(d => d.submitted).length;
                    const total = o.docs.length;
                    const pct = Math.round((submitted / total) * 100);
                    const allDone = submitted === total;
                    return (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium">{o.name}</p>
                          <p className="text-xs text-gray-400">{o.email}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.empId}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{o.role}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{o.doj}</td>
                        <td className="px-4 py-3 text-gray-600">{o.department}</td>
                        <td className="px-4 py-3 text-gray-600">{o.manager}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${o.workMode === "Remote" ? "bg-blue-100 text-blue-700" : o.workMode === "Hybrid" ? "bg-teal-100 text-teal-700" : "bg-purple-100 text-purple-700"}`}>{o.workMode}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${allDone ? "bg-green-500" : "bg-[#4F3CC9]"}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-600">{submitted}/{total}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {o.welcomeEmailSent
                            ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">✓ Sent</span>
                            : <button onClick={() => sendWelcomeEmail(o.id, o.name)} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg hover:bg-blue-200 font-medium">Send Email</button>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {o.employeeCreated
                            ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">✓ Created</span>
                            : <button onClick={() => markEmployeeCreated(o.id)} disabled={!allDone} title={!allDone ? "Submit all docs first" : "Create employee account"} className={`text-xs px-2 py-0.5 rounded-lg font-medium transition ${allDone ? "bg-[#4F3CC9] text-white hover:bg-[#3d2fa8]" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>Create</button>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setShowDocModal(o)} className="text-xs bg-[#EDE9FF] text-[#4F3CC9] px-3 py-1 rounded-lg hover:bg-[#d8d1ff] font-medium">Checklist</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Candidate Modal */}
      {showAddCandidate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddCandidate(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Add Candidate</h2>
              <button onClick={() => setShowAddCandidate(false)}><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[["Candidate Name","name","text"],["Mobile","mobile","text"],["Email","email","email"],["Role Applied","role","text"],["College Name","college","text"],["LinkedIn URL","","text"]].map(([label, field]) => (
                <div key={label}>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                  <input
                    value={field ? (candidateForm as Record<string, string>)[field] || "" : ""}
                    onChange={(e) => field && setCandidateForm({ ...candidateForm, [field]: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Department</label>
                <select value={candidateForm.department} onChange={(e) => setCandidateForm({ ...candidateForm, department: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm">
                  {["Engineering","Marketing","Sales","HR","Finance","Operations"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Experience Level</label>
                <select value={candidateForm.experience} onChange={(e) => setCandidateForm({ ...candidateForm, experience: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm">
                  {["Fresher","1-2yr","2-5yr","5+yr"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Source</label>
                <select value={candidateForm.source} onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm">
                  {["LinkedIn","Indeed","Referral","Direct","Campus"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Recruiter Assigned</label>
                <select value={candidateForm.recruiter} onChange={(e) => setCandidateForm({ ...candidateForm, recruiter: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm">
                  <option value="">—</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Resume Upload</label>
                <input
                  ref={resumeInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                />
                {resumeFile ? (
                  <div className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-4 py-3">
                    <FileText size={18} className="text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{resumeFile.name}</p>
                      <p className="text-xs text-gray-400">{(resumeFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button onClick={() => { setResumeFile(null); if (resumeInputRef.current) resumeInputRef.current.value = ""; }}
                      className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  </div>
                ) : (
                  <button onClick={() => resumeInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-400 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors flex items-center justify-center gap-2">
                    <Upload size={16} /> Click to upload resume (PDF/DOC)
                  </button>
                )}
              </div>
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={handleAddCandidate}
                disabled={addingCandidate}
                className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {addingCandidate
                  ? <><Loader2 size={16} className="animate-spin" />{resumeUploading ? "Uploading resume…" : "Saving…"}</>
                  : "Add Candidate"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Interview Modal */}
      {showAddInterview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddInterview(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Schedule Interview</h2>
              <button onClick={() => setShowAddInterview(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name</label>
                <input
                  value={interviewForm.candidateName}
                  onChange={(e) => setInterviewForm({ ...interviewForm, candidateName: e.target.value })}
                  placeholder="Enter candidate name"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interview Round</label>
                <select value={interviewForm.round} onChange={(e) => setInterviewForm({ ...interviewForm, round: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Round 1","Round 2","HR Round","Final"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                <select
                  defaultValue="Scheduled"
                  onChange={(e) => setInterviewForm({ ...interviewForm, round: interviewForm.round })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none bg-blue-50 text-blue-700"
                >
                  {["Scheduled","Rescheduled","Cancelled"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Date</label>
                <input type="date" value={interviewForm.date} onChange={(e) => setInterviewForm({ ...interviewForm, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Time</label>
                <input type="time" value={interviewForm.time} onChange={(e) => setInterviewForm({ ...interviewForm, time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interviewer Name</label>
                <input value={interviewForm.interviewer} onChange={(e) => setInterviewForm({ ...interviewForm, interviewer: e.target.value })} placeholder="Interviewer Name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Meeting Link</label>
                <input value={interviewForm.meetingLink} onChange={(e) => setInterviewForm({ ...interviewForm, meetingLink: e.target.value })} placeholder="https://meet.google.com/..." className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => { setShowAddInterview(false); setInterviewForm({ ...blankInterview }); }} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleAddInterview} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8] transition">Schedule Interview</button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Interview Modal */}
      {rescheduleInterview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setRescheduleInterview(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Reschedule Interview</h2>
                <p className="text-xs text-gray-400 mt-0.5">{rescheduleInterview.candidateName} · {rescheduleInterview.round}</p>
              </div>
              <button onClick={() => setRescheduleInterview(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">New Date</label>
                <input type="date" value={rescheduleInterview.date} onChange={(e) => setRescheduleInterview({ ...rescheduleInterview, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">New Time</label>
                <input type="time" value={rescheduleInterview.time} onChange={(e) => setRescheduleInterview({ ...rescheduleInterview, time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Updated Meeting Link</label>
                <input value={rescheduleInterview.meetingLink} onChange={(e) => setRescheduleInterview({ ...rescheduleInterview, meetingLink: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setRescheduleInterview(null)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setInterviews(interviews.map((i) => i.id === rescheduleInterview.id ? rescheduleInterview : i)); setRescheduleInterview(null); }} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8]">Confirm Reschedule</button>
            </div>
          </div>
        </div>
      )}

      {/* Release Offer Modal */}
      {showAddOffer && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddOffer(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold">Release Offer</h2>
              <button onClick={() => setShowAddOffer(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name</label>
                <input value={offerForm.candidateName} onChange={(e) => setOfferForm({ ...offerForm, candidateName: e.target.value })} placeholder="Enter candidate name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role</label>
                <input value={offerForm.role} onChange={(e) => setOfferForm({ ...offerForm, role: e.target.value })} placeholder="e.g. Backend Engineer" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Salary / Stipend (₹)</label>
                <input value={offerForm.salary} onChange={(e) => setOfferForm({ ...offerForm, salary: e.target.value })} placeholder="e.g. ₹75,000/mo" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employment Type</label>
                <select value={offerForm.type} onChange={(e) => setOfferForm({ ...offerForm, type: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Full-Time","Internship","Contract"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Offer Date</label>
                <input type="date" value={offerForm.offerDate} onChange={(e) => setOfferForm({ ...offerForm, offerDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Offer Status</label>
                <select value={offerForm.status} onChange={(e) => setOfferForm({ ...offerForm, status: e.target.value as OfferStatus })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Pending","Accepted","Rejected"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Upload Offer Letter</label>
                <div
                  onClick={() => setOfferForm({ ...offerForm, offerLetterUploaded: true })}
                  className={`border-2 border-dashed rounded-xl p-4 text-center text-sm cursor-pointer transition ${offerForm.offerLetterUploaded ? "border-green-400 bg-green-50 text-green-700" : "border-gray-200 text-gray-400 hover:border-[#4F3CC9]"}`}
                >
                  {offerForm.offerLetterUploaded ? "✓ Offer Letter Uploaded" : "Click to upload Offer Letter (PDF)"}
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => { setShowAddOffer(false); setOfferForm({ ...blankOffer }); }} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddOffer} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8]">Release Offer</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Interview Modal */}
      {editInterview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditInterview(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold">Edit Interview</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editInterview.id} · {editInterview.candidateName}</p>
              </div>
              <button onClick={() => setEditInterview(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name</label>
                <input
                  value={editInterview.candidateName}
                  onChange={(e) => setEditInterview({ ...editInterview, candidateName: e.target.value })}
                  placeholder="Enter candidate name"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interview Round</label>
                <select value={editInterview.round} onChange={(e) => setEditInterview({ ...editInterview, round: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Round 1","Round 2","HR Round","Final"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                <select value={editInterview.status} onChange={(e) => setEditInterview({ ...editInterview, status: e.target.value as InterviewStatus })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Scheduled","Completed","Cancelled","Rescheduled"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Date</label>
                <input type="date" value={editInterview.date} onChange={(e) => setEditInterview({ ...editInterview, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Time</label>
                <input type="time" value={editInterview.time} onChange={(e) => setEditInterview({ ...editInterview, time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interviewer Name</label>
                <input value={editInterview.interviewer} onChange={(e) => setEditInterview({ ...editInterview, interviewer: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Meeting Link</label>
                <input value={editInterview.meetingLink} onChange={(e) => setEditInterview({ ...editInterview, meetingLink: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Feedback</label>
                <textarea
                  value={editInterview.feedback}
                  onChange={(e) => setEditInterview({ ...editInterview, feedback: e.target.value })}
                  rows={2}
                  placeholder="Interview feedback notes..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Rating</label>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map((s) => (
                    <button key={s} onClick={() => setEditInterview({ ...editInterview, rating: s })}>
                      <Star size={20} className={s <= editInterview.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setEditInterview(null)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleEditInterviewSave} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8] transition">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Document Checklist Modal */}
      {showDocModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowDocModal(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Document Checklist</h2>
                <p className="text-xs text-gray-400 mt-0.5">{showDocModal.name} · {showDocModal.empId}</p>
              </div>
              <button onClick={() => setShowDocModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-2">
              {showDocModal.docs.map((doc) => (
                <div
                  key={doc.name}
                  onClick={() => toggleDoc(showDocModal.id, doc.name)}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition ${doc.submitted ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-transparent hover:border-gray-200"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${doc.submitted ? "bg-green-500 border-green-500" : "border-gray-300"}`}>
                      {doc.submitted && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                    <span className={`text-sm font-medium ${doc.submitted ? "text-green-800" : "text-gray-700"}`}>{doc.name}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${doc.submitted ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {doc.submitted ? "Submitted" : "Pending"}
                  </span>
                </div>
              ))}
              <div className="pt-3">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-500 font-medium">Completion</span>
                  <span className="font-semibold text-gray-700">{showDocModal.docs.filter(d => d.submitted).length}/{showDocModal.docs.length} documents</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div className={`h-2.5 rounded-full transition-all ${showDocModal.docs.every(d => d.submitted) ? "bg-green-500" : "bg-[#4F3CC9]"}`}
                    style={{ width: `${Math.round((showDocModal.docs.filter(d => d.submitted).length / showDocModal.docs.length) * 100)}%` }} />
                </div>
              </div>
              {showDocModal.docs.every(d => d.submitted) && !showDocModal.employeeCreated && (
                <div className="mt-3 p-3 bg-[#EDE9FF] rounded-xl text-center">
                  <p className="text-xs text-[#4F3CC9] font-medium mb-2">All documents submitted! Ready to create employee.</p>
                  <button onClick={() => { markEmployeeCreated(showDocModal.id); setShowDocModal(null); }} className="bg-[#4F3CC9] text-white text-xs px-4 py-2 rounded-xl font-semibold hover:bg-[#3d2fa8]">Create Employee Account</button>
                </div>
              )}
            </div>
            <p className="px-6 pb-4 text-xs text-gray-400">Click any document to toggle submitted status</p>
          </div>
        </div>
      )}

      {/* Add Onboarding Modal */}
      {showAddOnboarding && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddOnboarding(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Start Onboarding</h2>
                <p className="text-xs text-gray-400 mt-0.5">Add a new hire to the onboarding pipeline</p>
              </div>
              <button onClick={() => setShowAddOnboarding(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee Name *</label>
                <input value={onboardingForm.name} onChange={(e) => setOnboardingForm({ ...onboardingForm, name: e.target.value })} placeholder="Full name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Work Email *</label>
                <input type="email" value={onboardingForm.email} onChange={(e) => setOnboardingForm({ ...onboardingForm, email: e.target.value })} placeholder="name@woways.in" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role / Designation *</label>
                <input value={onboardingForm.role} onChange={(e) => setOnboardingForm({ ...onboardingForm, role: e.target.value })} placeholder="e.g. Software Engineer" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee ID *</label>
                <input value={onboardingForm.empId} onChange={(e) => setOnboardingForm({ ...onboardingForm, empId: e.target.value })} placeholder="e.g. EMP014" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Date of Joining *</label>
                <input type="date" value={onboardingForm.doj} onChange={(e) => setOnboardingForm({ ...onboardingForm, doj: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Department</label>
                <select value={onboardingForm.department} onChange={(e) => setOnboardingForm({ ...onboardingForm, department: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Engineering","Marketing","Sales","HR","Finance","Operations"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Reporting Manager</label>
                <select value={onboardingForm.manager} onChange={(e) => setOnboardingForm({ ...onboardingForm, manager: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  <option value="">—</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Work Mode</label>
                <select value={onboardingForm.workMode} onChange={(e) => setOnboardingForm({ ...onboardingForm, workMode: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Remote","On-site","Hybrid"].map((w) => <option key={w}>{w}</option>)}
                </select>
              </div>
              <div className="col-span-2 bg-[#F5F3FF] rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-[#4F3CC9] mb-1">Document Checklist</p>
                <p className="text-xs text-gray-500">The following 7 documents will be auto-created as pending and can be tracked via the Checklist button:</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {defaultDocs().map((d) => (
                    <span key={d.name} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-lg">{d.name}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setShowAddOnboarding(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddOnboarding} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8]">Start Onboarding</button>
            </div>
          </div>
        </div>
      )}

      {/* View Candidate Modal */}
      {viewCandidate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setViewCandidate(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b shrink-0">
              <h2 className="text-lg font-bold text-gray-900">Candidate Profile</h2>
              <button onClick={() => setViewCandidate(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Header */}
            <div className="px-6 py-4 flex items-center gap-4 border-b shrink-0">
              <div className="w-14 h-14 rounded-full bg-[#EDE9FF] text-[#4F3CC9] flex items-center justify-center font-bold text-lg shrink-0">
                {candidateInitials(viewCandidate.name)}
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold text-gray-900">{viewCandidate.name}</p>
                <p className="text-sm text-gray-500">{viewCandidate.role} · {viewCandidate.id}</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColorMap[viewCandidate.status]}`}>{viewCandidate.status}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{viewCandidate.experience}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{viewCandidate.source}</span>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* Status Pipeline */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Status Pipeline</p>
                <div className="flex items-center gap-0 overflow-x-auto pb-1">
                  {statusPipeline.map((stage, idx) => {
                    const currentIdx = statusPipeline.indexOf(viewCandidate.status);
                    const isPast = idx < currentIdx;
                    const isCurrent = idx === currentIdx;
                    return (
                      <div key={stage} className="flex items-center shrink-0">
                        <div className={`flex flex-col items-center`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${isCurrent ? "bg-[#4F3CC9] border-[#4F3CC9] text-white" : isPast ? "bg-green-500 border-green-500 text-white" : "bg-white border-gray-300 text-gray-400"}`}>
                            {isPast ? "✓" : idx + 1}
                          </div>
                          <p className={`text-[9px] mt-1 text-center w-14 leading-tight ${isCurrent ? "text-[#4F3CC9] font-semibold" : isPast ? "text-green-600" : "text-gray-400"}`}>{stage}</p>
                        </div>
                        {idx < statusPipeline.length - 1 && (
                          <div className={`h-0.5 w-4 mb-4 shrink-0 ${isPast ? "bg-green-400" : "bg-gray-200"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Contact Details */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Contact Details</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Mobile Number</p><p className="font-medium">{viewCandidate.mobile || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">Email ID</p><p className="font-medium text-xs break-all">{viewCandidate.email || "—"}</p></div>
                  <div><p className="text-xs text-gray-400">LinkedIn Profile</p>
                    {viewCandidate.linkedin ? (
                      <p className="font-medium text-[#4F3CC9] text-xs break-all">{viewCandidate.linkedin}</p>
                    ) : <p className="text-gray-400 text-xs">Not provided</p>}
                  </div>
                  <div><p className="text-xs text-gray-400">College / University</p><p className="font-medium">{viewCandidate.college || "—"}</p></div>
                </div>
              </div>

              {/* Job Details */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Job Details</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Role Applied</p><p className="font-medium">{viewCandidate.role}</p></div>
                  <div><p className="text-xs text-gray-400">Department</p><p className="font-medium">{viewCandidate.department}</p></div>
                  <div><p className="text-xs text-gray-400">Experience Level</p><p className="font-medium">{viewCandidate.experience}</p></div>
                  <div><p className="text-xs text-gray-400">Source of Hiring</p><p className="font-medium">{viewCandidate.source}</p></div>
                  <div><p className="text-xs text-gray-400">Recruiter Assigned</p><p className="font-medium">{viewCandidate.recruiter}</p></div>
                </div>
              </div>

              {/* Resume */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Resume</p>
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl">
                  <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-xs font-bold text-red-600">PDF</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{viewCandidate.name.replace(" ", "_")}_Resume.pdf</p>
                    <p className="text-xs text-gray-400">Uploaded during application</p>
                  </div>
                  <button className="flex items-center gap-1 text-xs text-[#4F3CC9] font-medium hover:underline"><Eye size={12} /> View</button>
                  <button className="flex items-center gap-1 text-xs text-gray-500 hover:underline"><Download size={12} /> Download</button>
                </div>
              </div>

              {/* Interview Feedback */}
              {interviews.filter((i) => i.candidateName === viewCandidate.name).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Interview Feedback</p>
                  <div className="space-y-2">
                    {interviews.filter((i) => i.candidateName === viewCandidate.name).map((iv) => (
                      <div key={iv.id} className="px-4 py-3 bg-[#F5F3FF] rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold text-[#4F3CC9]">{iv.round}</p>
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map((s) => (
                              <Star key={s} size={12} className={s <= iv.rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"} />
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-gray-500">Interviewer: {iv.interviewer} · {iv.date} {iv.time}</p>
                        {iv.feedback && <p className="text-xs text-gray-700 mt-1 italic">"{iv.feedback}"</p>}
                        <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${interviewStatusColor[iv.status]}`}>{iv.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Recruiter Notes</p>
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap min-h-[48px]">
                  {viewCandidate.notes || <span className="text-gray-400">No notes added yet.</span>}
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 pt-4 border-t shrink-0 flex gap-3">
              <button onClick={() => { setViewCandidate(null); setEditCandidate(viewCandidate); setEditCandidateForm({ ...viewCandidate }); }} className="flex-1 border border-[#4F3CC9] text-[#4F3CC9] rounded-xl py-2.5 text-sm font-medium hover:bg-[#EDE9FF] transition">Edit Candidate</button>
              <button onClick={() => setViewCandidate(null)} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3d2fa8] transition">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Candidate Modal */}
      {editCandidate && editCandidateForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setEditCandidate(null); setEditCandidateForm(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Candidate</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editCandidate.id} · {editCandidate.name}</p>
              </div>
              <button onClick={() => { setEditCandidate(null); setEditCandidateForm(null); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate ID</label>
                <input value={editCandidateForm.id} readOnly className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-gray-50" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name</label>
                <input value={editCandidateForm.name} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Mobile Number</label>
                <input value={editCandidateForm.mobile} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, mobile: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Email ID</label>
                <input type="email" value={editCandidateForm.email} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, email: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role Applied</label>
                <input value={editCandidateForm.role} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, role: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Department</label>
                <select value={editCandidateForm.department} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, department: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Engineering","Marketing","Sales","HR","Finance","Operations"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Experience Level</label>
                <select value={editCandidateForm.experience} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, experience: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Fresher","1-2yr","2-5yr","5+yr"].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">College Name</label>
                <input value={editCandidateForm.college} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, college: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">LinkedIn Profile</label>
                <input value={editCandidateForm.linkedin} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, linkedin: e.target.value })} placeholder="linkedin.com/in/username" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Source of Hiring</label>
                <select value={editCandidateForm.source} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, source: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["LinkedIn","Indeed","Referral","Direct","Campus"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Recruiter Assigned</label>
                <select value={editCandidateForm.recruiter} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, recruiter: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  <option value="">—</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                <select value={editCandidateForm.status} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, status: e.target.value as CandidateStatus })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {statusPipeline.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Recruiter Notes</label>
                <textarea value={editCandidateForm.notes} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, notes: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] resize-none" placeholder="Add notes about this candidate..." />
              </div>
            </div>
            <div className="px-6 pb-6 pt-4 border-t shrink-0 flex gap-3">
              <button onClick={() => { setEditCandidate(null); setEditCandidateForm(null); }} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleEditCandidateSave} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8] transition">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate Notes Side Panel */}
      {notePanel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-end" onClick={() => setNotePanel(null)}>
          <div className="bg-white w-96 h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-base font-bold">{notePanel.name}</h2>
                <p className="text-xs text-gray-500">{notePanel.role} · {notePanel.id}</p>
              </div>
              <button onClick={() => setNotePanel(null)}><X size={20} /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Status</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColorMap[notePanel.status]}`}>{notePanel.status}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3">{notePanel.notes || "No notes yet."}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Add Note</p>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9] h-24 resize-none"
                  placeholder="Type a note..."
                />
                <button
                  onClick={() => { setCandidates(candidates.map((c) => c.id === notePanel.id ? { ...c, notes: c.notes + "\n" + newNote } : c)); setNewNote(""); }}
                  className="mt-2 bg-[#4F3CC9] text-white px-4 py-2 rounded-xl text-sm font-medium w-full"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
