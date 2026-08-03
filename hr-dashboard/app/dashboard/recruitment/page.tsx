"use client";
import { useState, useRef, useEffect } from "react";
import { Plus, Search, X, Star, Download, Eye, Pencil, Upload, FileText, Loader2 } from "lucide-react";
import { collection, addDoc, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { computeNextEmployeeId } from "@/lib/employeeId";
import { isValidJobTitle } from "@/lib/jobTitle";
import { invalidateEmployees } from "@/lib/cachedService";
import { DEPARTMENTS } from "@/lib/constants";
import { useDepartments } from "@/lib/useDepartments";
import { EmptyState } from "@/components/EmptyState";
import { readCache, writeCache } from "@/lib/cache";

type CandidateStatus = "Applied" | "Screening" | "Shortlisted" | "Interview Scheduled" | "Interview Completed" | "Selected" | "Rejected" | "Offer Released" | "Joined";
type InterviewStatus = "Scheduled" | "Completed" | "Cancelled" | "Rescheduled";
type OfferStatus = "Pending" | "Accepted" | "Rejected" | "Expired";

interface Candidate {
  id: string;
  candidateId?: string;   // human-readable auto-incrementing ID (CAND-#####), not the doc key
  createdAt?: string;
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
  offerLetterUrl?: string;
  offerLetterName?: string;
}

interface OnboardingDoc { name: string; submitted: boolean; }
interface Onboarding {
  id: string;
  name: string;
  email: string;
  mobile: string;
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

const blankCandidate = { name: "", mobile: "", email: "", role: "", department: DEPARTMENTS[0], experience: "Fresher", college: "", linkedin: "", source: "LinkedIn", recruiter: "", notes: "", resumeUrl: "", resumeName: "" };
const statusPipeline: CandidateStatus[] = ["Applied","Screening","Shortlisted","Interview Scheduled","Interview Completed","Selected","Rejected","Offer Released","Joined"];

function candidateInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

// Today's date as a local YYYY-MM-DD string — used to block past interview dates.
function todayLocalStr(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split("T")[0];
}

// Accepts http(s) URLs (with or without protocol). Empty is allowed (optional field).
function isValidMeetingLink(link: string): boolean {
  const v = link.trim();
  if (!v) return true;
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(v);
}

// Strict email format (NEW-003): local part and every domain label must start/end
// alphanumeric, the domain needs at least one dot, and the TLD must be 2+ letters.
const EMAIL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

// Verify an email's domain can actually receive mail (has a real MX record), so
// structurally-valid but bogus domains like "hh@hghgh.com" are rejected. Fails
// OPEN on any network/DNS error so a transient issue never blocks a real candidate.
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
    // Reject "null MX" (RFC 7505): an MX target of "." means the domain refuses mail.
    return answers.some((a) => {
      const target = String(a.data ?? "").trim().split(/\s+/).pop() ?? "";
      return target !== "." && target !== "";
    });
  } catch {
    return true; // DNS unreachable → don't block
  }
}
const blankInterview = { candidateName: "", round: "Round 1", date: "", time: "", interviewer: "", meetingLink: "", feedback: "", rating: 0, finalDecision: "" as const, reminderSent: false };
const blankOffer = { candidateName: "", role: "", salary: "", type: "Full-Time", offerDate: "", status: "Pending" as OfferStatus, offerLetterUploaded: false, offerLetterUrl: "", offerLetterName: "" };

export default function RecruitmentPage() {
  const departments = useDepartments();
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
  const [onboardingForm, setOnboardingForm] = useState({ name: "", email: "", mobile: "", role: "", empId: "", doj: "", department: DEPARTMENTS[0], manager: "", workMode: "Remote" });
  const [onboardingToast, setOnboardingToast] = useState("");
  const [viewCandidate, setViewCandidate] = useState<Candidate | null>(null);
  const [editCandidate, setEditCandidate] = useState<Candidate | null>(null);
  const [editCandidateForm, setEditCandidateForm] = useState<Candidate | null>(null);
  const [candidateForm, setCandidateForm] = useState({ ...blankCandidate });
  const [interviewForm, setInterviewForm] = useState({ ...blankInterview });
  const [offerForm, setOfferForm] = useState({ ...blankOffer });
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [candidateToast, setCandidateToast] = useState<string | null>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  // Offer-letter upload (OFFER-002): file input + which offer row is uploading.
  const offerLetterInputRef = useRef<HTMLInputElement>(null);
  const pendingOfferIdRef = useRef<string | null>(null);
  const [offerLetterUploadingId, setOfferLetterUploadingId] = useState<string | null>(null);
  const [offerModalLetterUploading, setOfferModalLetterUploading] = useState(false);

  function showCandidateToast(msg: string) { setCandidateToast(msg); setTimeout(() => setCandidateToast(null), 3500); }
  const [rescheduleInterview, setRescheduleInterview] = useState<Interview | null>(null);
  const [reminderToast, setReminderToast] = useState("");
  const [notePanel, setNotePanel] = useState<Candidate | null>(null);
  const [newNote, setNewNote] = useState("");

  // Load candidates: session cache first for instant render, then refresh
  useEffect(() => {
    const CACHE = "hr_candidates_v1";
    const cached = readCache<Candidate[]>(CACHE);
    if (cached && cached.length) setCandidates(cached);
    getDocs(collection(db, "candidates")).then((snap) => {
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Candidate));
      // Assign a human-readable, auto-incrementing candidate ID (CAND-#####) to any
      // record that lacks one, and persist it — so the ID column never shows the raw
      // Firebase document key (BUG-REC-04). Numbering continues from the highest.
      let maxNum = Math.max(0, ...loaded.map((c) => parseInt(String(c.candidateId ?? "").replace(/\D/g, ""), 10)).filter((n) => !isNaN(n)));
      loaded
        .filter((c) => !c.candidateId)
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
        .forEach((c) => { maxNum += 1; c.candidateId = `CAND-${String(maxNum).padStart(5, "0")}`; setDoc(doc(db, "candidates", c.id), { candidateId: c.candidateId }, { merge: true }).catch(() => {}); });
      setCandidates(loaded);
      writeCache(CACHE, loaded);
    }).catch(() => {});
  }, []);

  // Next human-readable candidate ID from the highest existing CAND number + 1.
  function nextCandidateId(list: Candidate[]): string {
    const max = Math.max(0, ...list.map((c) => parseInt(String(c.candidateId ?? "").replace(/\D/g, ""), 10)).filter((n) => !isNaN(n)));
    return `CAND-${String(max + 1).padStart(5, "0")}`;
  }

  // Load Interview / Offer / Onboarding records from Firestore so data entered
  // in these three sub-modules survives a page refresh (NEW-002). The seed
  // arrays act only as placeholders until real records exist in Firestore.
  useEffect(() => {
    getDocs(collection(db, "interviews")).then((snap) => {
      if (!snap.empty) setInterviews(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Interview)));
    }).catch(() => {});
    getDocs(collection(db, "offers")).then((snap) => {
      if (snap.empty) return;
      // Skip legacy/junk offers with no recipient or terms (OFFER-001) so meaningless
      // rows created before validation existed never render as real offers.
      const loaded = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Offer))
        .filter((o) => o.candidateName?.trim() && o.role?.trim() && o.salary?.trim());
      setOffers(loaded);
    }).catch(() => {});
    getDocs(collection(db, "onboarding")).then((snap) => {
      if (!snap.empty) setOnboarding(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Onboarding)));
    }).catch(() => {});
  }, []);

  // Persist helpers (merge writes keyed by the record id). Fire-and-forget:
  // the UI updates optimistically; a failed write is silently retried on next edit.
  const saveInterview = (id: string, data: Partial<Interview>) => { setDoc(doc(db, "interviews", id), data, { merge: true }).catch(() => {}); };
  const saveOffer = (id: string, data: Partial<Offer>) => { setDoc(doc(db, "offers", id), data, { merge: true }).catch(() => {}); };
  const saveOnboarding = (id: string, data: Partial<Onboarding>) => { setDoc(doc(db, "onboarding", id), data, { merge: true }).catch(() => {}); };

  const tabs = [
    { id: "candidates", label: "Candidate Database" },
    { id: "interviews", label: "Interview Management" },
    { id: "offers", label: "Offer Management" },
    { id: "onboarding", label: "Onboarding" },
  ] as const;

  // Sort candidates by their sequential candidate ID (CAND-#####) so the list is
  // always shown in a consistent, ascending order.
  const candidateNum = (c: Candidate) => {
    const n = parseInt(String(c.candidateId ?? "").replace(/\D/g, ""), 10);
    return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  const filteredCandidates = candidates
    .filter((c) => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "All" || c.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => candidateNum(a) - candidateNum(b));

  async function handleAddCandidate() {
    if (!candidateForm.name.trim()) { showCandidateToast("Candidate name is required."); return; }
    const email = candidateForm.email.trim();
    if (!email || !EMAIL_RE.test(email)) {
      showCandidateToast("Please enter a valid email address.");
      return;
    }
    if (!(await emailDomainAcceptsMail(email))) {
      showCandidateToast("That email domain doesn't accept mail — please check the address.");
      return;
    }
    const mobileDigits = candidateForm.mobile.replace(/\D/g, "");
    if (mobileDigits.length !== 10 || /^[0-5]/.test(mobileDigits)) {
      showCandidateToast("Please enter a valid 10-digit phone number starting with 6, 7, 8 or 9.");
      return;
    }
    if (!candidateForm.role.trim()) { showCandidateToast("Role applied is required."); return; }
    if (!isValidJobTitle(candidateForm.role)) { showCandidateToast("Please enter a valid role/designation (letters — not numbers or placeholder text)."); return; }
    if (!candidateForm.department.trim()) { showCandidateToast("Department is required."); return; }
    const linkedin = candidateForm.linkedin.trim();
    if (linkedin && !/^(https?:\/\/)?([\w-]+\.)*linkedin\.com\/.+/i.test(linkedin)) {
      showCandidateToast("LinkedIn must be a valid URL (e.g. https://linkedin.com/in/username).");
      return;
    }
    setAddingCandidate(true);
    try {
      let resumeUrl = "";
      let resumeName = "";
      const resumeUrls: string[] = [];
      const resumeNames: string[] = [];

      // Upload resume files if selected
      if (resumeFiles.length > 0) {
        setResumeUploading(true);
        for (const f of resumeFiles) {
          const path = `resumes/${Date.now()}_${f.name.replace(/\s+/g, "_")}`;
          const sRef = storageRef(storage, path);
          // Store with an "attachment" disposition so the Download link saves the
          // file to disk (instead of opening it) even when bucket CORS isn't set.
          const metadata = {
            contentType: f.type || "application/octet-stream",
            contentDisposition: `attachment; filename="${f.name.replace(/[\r\n"]/g, "")}"`,
          };
          await new Promise<void>((resolve, reject) => {
            const task = uploadBytesResumable(sRef, f, metadata);
            task.on("state_changed", undefined, reject, () => resolve());
          });
          const url = await getDownloadURL(sRef);
          resumeUrls.push(url);
          resumeNames.push(f.name);
        }
        resumeUrl  = resumeUrls[0];
        resumeName = resumeNames[0];
        setResumeUploading(false);
      }

      const payload = {
        ...candidateForm,
        candidateId: nextCandidateId(candidates),
        resumeUrl,
        resumeName,
        resumeUrls,
        resumeNames,
        status: "Applied" as CandidateStatus,
        createdAt: new Date().toISOString(),
      };

      // Save to Firestore
      const docRef = await addDoc(collection(db, "candidates"), payload);
      const newCandidate: Candidate = { id: docRef.id, ...payload };
      setCandidates((prev) => [newCandidate, ...prev]);
      setCandidateForm({ ...blankCandidate });
      setResumeFiles([]);
      setShowAddCandidate(false);
      showCandidateToast(`${candidateForm.name} added successfully`);
    } catch {
      showCandidateToast("Failed to add candidate. Please try again.");
      setResumeUploading(false);
    } finally {
      setAddingCandidate(false);
    }
  }

  // Force a real file download. The HTML `download` attribute is ignored for
  // cross-origin URLs (Firebase Storage), so fetch the file as a blob and save
  // it; fall back to opening in a new tab if the fetch is blocked.
  async function downloadResume(url: string, name?: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name || "resume";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      // No CORS: link straight to the file. Resumes are stored with an
      // "attachment" content-disposition, so the browser downloads it.
      const a = document.createElement("a");
      a.href = url;
      a.download = name || "";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  // Preview a resume inline. Tries an in-browser blob view (needs CORS); if that
  // fails, falls back to Google's document viewer (works without CORS).
  async function viewResume(url: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch {
      window.open(`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=false`, "_blank", "noopener");
    }
  }

  async function handleEditCandidateSave() {
    if (!editCandidateForm) return;
    // Re-validate on edit so a candidate can't be saved with an invalid email/mobile.
    if (!editCandidateForm.name.trim()) { showCandidateToast("Candidate name is required."); return; }
    if (!EMAIL_RE.test(editCandidateForm.email.trim())) { showCandidateToast("Please enter a valid email address."); return; }
    if (!(await emailDomainAcceptsMail(editCandidateForm.email.trim()))) { showCandidateToast("That email domain doesn't accept mail — please check the address."); return; }
    const mobileDigits = editCandidateForm.mobile.replace(/\D/g, "");
    if (mobileDigits.length !== 10 || /^[0-5]/.test(mobileDigits)) { showCandidateToast("Please enter a valid 10-digit phone number starting with 6, 7, 8 or 9."); return; }
    const saved = editCandidateForm;
    const { id, ...rest } = saved;
    // Optimistic UI update
    setCandidates(candidates.map((c) => c.id === id ? saved : c));
    setEditCandidate(null);
    setEditCandidateForm(null);
    // Persist to Firestore so the change survives navigating away and back.
    try {
      await setDoc(doc(db, "candidates", id), { ...rest, updatedAt: new Date().toISOString() }, { merge: true });
    } catch {
      showCandidateToast("Failed to save changes. Please try again.");
    }
  }

  function handleAddInterview() {
    // Require the core fields needed to actually run the interview (NEW-001).
    if (!interviewForm.candidateName.trim()) { showCandidateToast("Please enter the candidate name."); return; }
    if (!interviewForm.round?.trim()) { showCandidateToast("Please select the interview round."); return; }
    if (!interviewForm.date) { showCandidateToast("Please select an interview date."); return; }
    if (interviewForm.date < todayLocalStr()) { showCandidateToast("Interview date cannot be in the past."); return; }
    if (!interviewForm.time) { showCandidateToast("Please select an interview time."); return; }
    if (!interviewForm.interviewer.trim()) { showCandidateToast("Please assign an interviewer."); return; }
    if (!interviewForm.meetingLink.trim()) { showCandidateToast("Please provide a meeting link or location for the interview."); return; }
    if (!isValidMeetingLink(interviewForm.meetingLink)) { showCandidateToast("Please enter a valid meeting link URL (e.g. https://meet.google.com/...)."); return; }
    const newId = `INT${Date.now()}`;
    const newInterview: Interview = { id: newId, status: "Scheduled", ...interviewForm };
    setInterviews([...interviews, newInterview]);
    saveInterview(newId, newInterview);
    setInterviewForm({ ...blankInterview });
    setShowAddInterview(false);
  }

  function handleEditInterviewSave() {
    if (!editInterview) return;
    if (editInterview.date && editInterview.date < todayLocalStr()) { showCandidateToast("Interview date cannot be in the past."); return; }
    if (!isValidMeetingLink(editInterview.meetingLink)) { showCandidateToast("Please enter a valid meeting link URL (e.g. https://meet.google.com/...)."); return; }
    setInterviews(interviews.map((i) => i.id === editInterview.id ? editInterview : i));
    saveInterview(editInterview.id, editInterview);
    setEditInterview(null);
  }

  function setRating(id: string, rating: number) {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, rating } : i));
    saveInterview(id, { rating });
  }

  function sendReminder(id: string, name: string) {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, reminderSent: true } : i));
    saveInterview(id, { reminderSent: true });
    setReminderToast(`Reminder sent to ${name}`);
    setTimeout(() => setReminderToast(""), 3000);
  }

  function setFinalDecision(id: string, decision: "Select" | "Reject") {
    setInterviews(interviews.map((i) => i.id === id ? { ...i, finalDecision: decision, status: "Completed" } : i));
    saveInterview(id, { finalDecision: decision, status: "Completed" });
  }

  // Rescheduling starts a fresh interview round, so the previous round's outcome
  // must be cleared — status back to "Scheduled" and the final decision, rating,
  // feedback and reminder reset (BUG-01). Also persists to Firestore (NEW-002).
  function handleConfirmReschedule() {
    if (!rescheduleInterview) return;
    if (rescheduleInterview.date && rescheduleInterview.date < todayLocalStr()) { showCandidateToast("Interview date cannot be in the past."); return; }
    if (!rescheduleInterview.time) { showCandidateToast("Please select a new interview time."); return; }
    if (!isValidMeetingLink(rescheduleInterview.meetingLink)) { showCandidateToast("Please enter a valid meeting link URL (e.g. https://meet.google.com/...)."); return; }
    const reset = {
      status: "Scheduled" as InterviewStatus,
      finalDecision: "" as const,
      rating: 0,
      feedback: "",
      reminderSent: false,
    };
    const rescheduled: Interview = { ...rescheduleInterview, ...reset };
    setInterviews(interviews.map((i) => i.id === rescheduled.id ? rescheduled : i));
    saveInterview(rescheduled.id, rescheduled);
    setRescheduleInterview(null);
    showCandidateToast(`Interview with ${rescheduled.candidateName} rescheduled — status reset to Scheduled.`);
  }

  function updateOfferStatus(id: string, status: OfferStatus) {
    setOffers(offers.map((o) => o.id === id ? { ...o, status } : o));
    saveOffer(id, { status });
  }

  // Upload an offer-letter file to Storage and return its download URL + name.
  async function uploadOfferLetter(file: File): Promise<{ url: string; name: string }> {
    const path = `offerLetters/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const sRef = storageRef(storage, path);
    const metadata = {
      contentType: file.type || "application/octet-stream",
      contentDisposition: `attachment; filename="${file.name.replace(/[\r\n"]/g, "")}"`,
    };
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(sRef, file, metadata);
      task.on("state_changed", undefined, reject, () => resolve());
    });
    const url = await getDownloadURL(sRef);
    return { url, name: file.name };
  }

  // Open the file picker for a specific offer row (OFFER-002).
  function pickOfferLetter(offerId: string) {
    pendingOfferIdRef.current = offerId;
    offerLetterInputRef.current?.click();
  }

  // Handle the chosen offer-letter file: upload it, then persist the URL on the offer.
  async function handleOfferLetterSelected(file: File) {
    const offerId = pendingOfferIdRef.current;
    pendingOfferIdRef.current = null;
    if (!offerId) return;
    setOfferLetterUploadingId(offerId);
    try {
      const { url, name } = await uploadOfferLetter(file);
      setOffers((prev) => prev.map((o) => o.id === offerId ? { ...o, offerLetterUploaded: true, offerLetterUrl: url, offerLetterName: name } : o));
      saveOffer(offerId, { offerLetterUploaded: true, offerLetterUrl: url, offerLetterName: name });
    } catch {
      showCandidateToast("Failed to upload the offer letter. Please try again.");
    } finally {
      setOfferLetterUploadingId(null);
    }
  }

  // Download a previously-uploaded offer letter (reuses the blob-download helper).
  function downloadOfferLetter(o: Offer) {
    if (!o.offerLetterUrl) { showCandidateToast("No offer letter file is available to download."); return; }
    downloadResume(o.offerLetterUrl, o.offerLetterName || `${o.candidateName}-offer-letter`);
  }

  function handleAddOffer() {
    // Require a real recipient and terms — a blank offer is meaningless (OFFER-001).
    if (!offerForm.candidateName.trim()) { showCandidateToast("Please enter the candidate name."); return; }
    if (!offerForm.role.trim()) { showCandidateToast("Please enter the role for this offer."); return; }
    if (!isValidJobTitle(offerForm.role)) { showCandidateToast("Please enter a valid role/designation (letters — not numbers or placeholder text)."); return; }
    const salaryDigits = offerForm.salary.replace(/[^\d.]/g, "");
    if (!offerForm.salary.trim() || offerForm.salary.includes("-") || !(parseFloat(salaryDigits) > 0)) { showCandidateToast("Please enter a valid payroll/stipend amount."); return; }
    if (!offerForm.offerDate) { showCandidateToast("Please select an offer date."); return; }
    const newId = `OFF${Date.now()}`;
    const newOffer: Offer = { id: newId, ...offerForm };
    setOffers([...offers, newOffer]);
    saveOffer(newId, newOffer);
    setOfferForm({ ...blankOffer });
    setShowAddOffer(false);
  }

  function sendWelcomeEmail(id: string, name: string) {
    setOnboarding(onboarding.map((o) => o.id === id ? { ...o, welcomeEmailSent: true } : o));
    saveOnboarding(id, { welcomeEmailSent: true });
    setOnboardingToast(`Welcome email sent to ${name}`);
    setTimeout(() => setOnboardingToast(""), 3000);
  }

  function toggleDoc(onboardingId: string, docName: string) {
    const updatedDocs = onboarding.find((o) => o.id === onboardingId)?.docs.map((d) => d.name === docName ? { ...d, submitted: !d.submitted } : d);
    setOnboarding(onboarding.map((o) => o.id === onboardingId
      ? { ...o, docs: o.docs.map((d) => d.name === docName ? { ...d, submitted: !d.submitted } : d) }
      : o
    ));
    if (updatedDocs) saveOnboarding(onboardingId, { docs: updatedDocs });
    setShowDocModal((prev) => prev ? { ...prev, docs: prev.docs.map((d) => d.name === docName ? { ...d, submitted: !d.submitted } : d) } : null);
  }

  // Actually create the employee record in the Employees module from an onboarding
  // row and mark it done — previously this only flipped a flag and never synced the
  // person to Employees (BUG-03). The Employees list picks it up on its next load.
  async function createEmployeeFromOnboarding(o: Onboarding) {
    const show = (m: string) => { setOnboardingToast(m); setTimeout(() => setOnboardingToast(""), 3500); };
    if (!o.empId?.trim()) { show("This candidate has no Employee ID assigned."); return; }
    if (o.employeeCreated) { show(`${o.name} is already in Employees.`); return; }
    try {
      // Don't overwrite an existing employee that happens to share this ID.
      const existing = await getDoc(doc(db, "employees", o.empId));
      if (existing.exists()) { show(`An employee with ID ${o.empId} already exists — cannot create a duplicate.`); return; }
      await setDoc(doc(db, "employees", o.empId), {
        employeeId: o.empId,
        name: o.name,
        email: o.email,
        phone: o.mobile.replace(/\D/g, ""),
        designation: o.role,
        role: "Employee",
        department: o.department,
        reportingManager: o.manager || "",
        workMode: o.workMode || "Remote",
        employmentType: "Full-Time",
        doj: o.doj,
        status: "Active",
        source: "Onboarding",
        createdAt: new Date().toISOString(),
      }, { merge: true });
      invalidateEmployees();
      setOnboarding(onboarding.map((x) => x.id === o.id ? { ...x, employeeCreated: true } : x));
      saveOnboarding(o.id, { employeeCreated: true });
      show(`${o.name} added to the Employees module (${o.empId}).`);
    } catch {
      show("Failed to create the employee record. Please try again.");
    }
  }

  // Is this Employee ID already taken — by a real employee OR another onboarding
  // record? The check is CASE-INSENSITIVE (emp013 == EMP013 == Emp013), so no two
  // people can share an ID under any casing (BUG-02 / BUG-REC-01). Firestore queries
  // are case-sensitive, so we load the employees and compare in code.
  async function isEmployeeIdTaken(rawId: string): Promise<boolean> {
    const clash = rawId.trim().toUpperCase();
    if (!clash) return false;
    if (onboarding.some((o) => o.empId.trim().toUpperCase() === clash)) return true;
    try {
      const snap = await getDocs(collection(db, "employees"));
      return snap.docs.some((d) => {
        const data = d.data() as Record<string, unknown>;
        const eid = String((data.employeeId as string) ?? d.id).trim().toUpperCase();
        return eid === clash;
      });
    } catch { /* network issue — fall through, don't block on read failure */ }
    return false;
  }

  // Next free EMP0xx id — shared with the Add-Employee form so both always agree.
  // Includes in-memory onboarding rows too (in case any aren't yet in Firestore).
  async function suggestNextEmpId(): Promise<string> {
    return computeNextEmployeeId(onboarding.map((o) => o.empId));
  }

  async function handleAddOnboarding() {
    const show = (m: string) => { setOnboardingToast(m); setTimeout(() => setOnboardingToast(""), 3500); };
    if (!onboardingForm.name.trim()) { show("Candidate name is required."); return; }
    const email = onboardingForm.email.trim();
    if (!email || !EMAIL_RE.test(email)) { show("A valid email address is required."); return; }
    if (!(await emailDomainAcceptsMail(email))) { show("That email domain doesn't accept mail — please check the address."); return; }
    const mobileDigits = onboardingForm.mobile.replace(/\D/g, "");
    if (mobileDigits.length !== 10 || /^[0-5]/.test(mobileDigits)) { show("A valid 10-digit contact number (starting 6-9) is required."); return; }
    if (!onboardingForm.role.trim()) { show("Role is required."); return; }
    if (!isValidJobTitle(onboardingForm.role)) { show("Please enter a valid Role/Designation (letters — not numbers or placeholder text)."); return; }
    if (!onboardingForm.empId.trim()) { show("Employee ID is required."); return; }
    // Bounds-enforce the auto-generated ID even if the read-only field is tampered
    // with: it must be a well-formed EMP#### and must equal the next sequential ID
    // (no arbitrary / out-of-sequence values) — BUG-REC-02.
    const expectedId = await suggestNextEmpId();
    if (!/^EMP\d{1,6}$/i.test(onboardingForm.empId.trim()) || onboardingForm.empId.trim().toUpperCase() !== expectedId.toUpperCase()) {
      show(`Employee ID is auto-generated. The next available ID is ${expectedId}.`);
      setOnboardingForm((f) => ({ ...f, empId: expectedId }));
      return;
    }
    // Enforce Employee ID uniqueness at assignment time (BUG-02).
    if (await isEmployeeIdTaken(onboardingForm.empId)) {
      const suggestion = await suggestNextEmpId();
      show(`Employee ID "${onboardingForm.empId.trim()}" is already assigned. Try ${suggestion}.`);
      return;
    }
    if (!onboardingForm.doj) { show("Date of joining is required."); return; }
    if (!onboardingForm.department.trim()) { show("Department is required."); return; }
    const newId = `ONB${Date.now()}`;
    const newOnboarding: Onboarding = { id: newId, ...onboardingForm, docs: defaultDocs(), welcomeEmailSent: false, employeeCreated: false };
    setOnboarding([...onboarding, newOnboarding]);
    saveOnboarding(newId, newOnboarding);
    setOnboardingForm({ name: "", email: "", mobile: "", role: "", empId: "", doj: "", department: DEPARTMENTS[0], manager: "", workMode: "Remote" });
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
                      <td className="px-4 py-3 font-mono text-xs">{c.candidateId || "…"}</td>
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
                  {filteredCandidates.length === 0 && (
                    <tr><td colSpan={10}><EmptyState title="No candidates found" subtitle={candidates.length === 0 ? "Add your first candidate to get started." : "No candidates match the current search or filter."} /></td></tr>
                  )}
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
                          <button onClick={() => setRescheduleInterview({ ...i, status: "Scheduled", finalDecision: "", rating: 0, feedback: "", reminderSent: false, date: "", time: "" })} title="Reschedule" className="p-1.5 rounded-lg hover:bg-orange-50 text-orange-500 text-xs font-medium">↺</button>
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
                  {interviews.length === 0 && (
                    <tr><td colSpan={9}><EmptyState title="No interviews scheduled" subtitle="Schedule an interview to see it listed here." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab C: Offer Management */}
      {activeTab === "offers" && (
        <div className="space-y-4">
          {/* Hidden input used by every offer row's Upload/Replace button (OFFER-002). */}
          <input
            ref={offerLetterInputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOfferLetterSelected(f); e.target.value = ""; }}
          />
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
                    <th className="px-4 py-3 text-left">Payroll/Stipend</th>
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
                        {offerLetterUploadingId === o.id ? (
                          <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> Uploading…</span>
                        ) : o.offerLetterUploaded && o.offerLetterUrl ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => downloadOfferLetter(o)} className="flex items-center gap-1 text-xs text-[#4F3CC9] hover:underline font-medium">
                              <Download size={12} /> Download
                            </button>
                            <button onClick={() => pickOfferLetter(o.id)} title="Replace offer letter" className="text-xs text-gray-400 hover:text-[#4F3CC9]">Replace</button>
                          </div>
                        ) : (
                          <button onClick={() => pickOfferLetter(o.id)} className="flex items-center gap-1 text-xs text-gray-500 border border-dashed border-gray-300 px-2 py-0.5 rounded-lg hover:border-[#4F3CC9] hover:text-[#4F3CC9]">
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
                  {offers.length === 0 && (
                    <tr><td colSpan={9}><EmptyState title="No offers released" subtitle="Release an offer to track its status here." /></td></tr>
                  )}
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
            <button onClick={async () => { setShowAddOnboarding(true); const id = await suggestNextEmpId(); setOnboardingForm((f) => ({ ...f, empId: id })); }} className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-xl px-4 py-2 text-sm font-medium">
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
                            : <button
                                onClick={() => { if (allDone || window.confirm(`${submitted}/${total} documents submitted for ${o.name}. Create the employee record now anyway?`)) createEmployeeFromOnboarding(o); }}
                                title={allDone ? "Create employee account in the Employees module" : "Documents still pending — you can still create the employee"}
                                className="text-xs px-2 py-0.5 rounded-lg font-medium transition bg-[#4F3CC9] text-white hover:bg-[#3d2fa8]"
                              >Create</button>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setShowDocModal(o)} className="text-xs bg-[#EDE9FF] text-[#4F3CC9] px-3 py-1 rounded-lg hover:bg-[#d8d1ff] font-medium">Checklist</button>
                        </td>
                      </tr>
                    );
                  })}
                  {onboarding.length === 0 && (
                    <tr><td colSpan={11}><EmptyState title="No onboarding in progress" subtitle="Start onboarding a candidate to see them here." /></td></tr>
                  )}
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
              {[["Candidate Name *","name","text"],["Mobile *","mobile","text"],["Email *","email","email"],["Role Applied *","role","text"],["College Name","college","text"],["LinkedIn URL","linkedin","text"]].map(([label, field, type]) => (
                <div key={label}>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                  <input
                    type={type}
                    placeholder={field === "linkedin" ? "https://linkedin.com/in/username" : ""}
                    value={field ? (candidateForm as Record<string, string>)[field] || "" : ""}
                    onChange={(e) => field && setCandidateForm({ ...candidateForm, [field]: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Department *</label>
                <select value={candidateForm.department} onChange={(e) => setCandidateForm({ ...candidateForm, department: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm">
                  {departments.map((d) => <option key={d}>{d}</option>)}
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
                <select
                  value={["LinkedIn","Indeed","Referral","Direct","Campus"].includes(candidateForm.source) ? candidateForm.source : "Other"}
                  onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value === "Other" ? "" : e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9]"
                >
                  {["LinkedIn","Indeed","Referral","Direct","Campus","Other"].map((s) => <option key={s}>{s}</option>)}
                </select>
                {!["LinkedIn","Indeed","Referral","Direct","Campus"].includes(candidateForm.source) && (
                  <input
                    value={candidateForm.source}
                    onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })}
                    placeholder="Enter source name"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9] mt-2"
                    autoFocus
                  />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Recruiter Assigned</label>
                <input value={candidateForm.recruiter} onChange={(e) => setCandidateForm({ ...candidateForm, recruiter: e.target.value })} placeholder="Recruiter name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9]" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Resume & Documents
                  {resumeFiles.length > 0 && <span className="ml-1 text-[#4F3CC9] font-semibold">{resumeFiles.length} file(s)</span>}
                </label>
                <input
                  ref={resumeInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    const allowedExt = ["pdf", "doc", "docx"];
                    const valid: File[] = [];
                    const rejected: string[] = [];
                    for (const f of picked) {
                      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
                      if (allowedExt.includes(ext)) valid.push(f);
                      else rejected.push(f.name);
                    }
                    if (rejected.length > 0) showCandidateToast(`Only PDF, DOC or DOCX files are allowed. Rejected: ${rejected.join(", ")}`);
                    if (valid.length > 0) setResumeFiles(prev => [...prev, ...valid]);
                    if (resumeInputRef.current) resumeInputRef.current.value = "";
                  }}
                />
                {resumeFiles.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {resumeFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-4 py-2.5">
                        <FileText size={16} className="text-green-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                          <p className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button onClick={() => setResumeFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => resumeInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-400 hover:border-[#4F3CC9] hover:text-[#4F3CC9] transition-colors flex items-center justify-center gap-2">
                  <Upload size={16} /> {resumeFiles.length > 0 ? "Add More Documents" : "Click to upload resume (PDF, DOC, DOCX)"}
                </button>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={handleAddCandidate}
                disabled={addingCandidate}
                className="w-full bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {addingCandidate
                  ? <><Loader2 size={16} className="animate-spin" />{resumeUploading ? "Uploading files…" : "Saving…"}</>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name *</label>
                <input
                  value={interviewForm.candidateName}
                  onChange={(e) => setInterviewForm({ ...interviewForm, candidateName: e.target.value })}
                  placeholder="Enter candidate name"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interview Round *</label>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Date *</label>
                <input type="date" min={todayLocalStr()} value={interviewForm.date} onChange={(e) => setInterviewForm({ ...interviewForm, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Time *</label>
                <input type="time" value={interviewForm.time} onChange={(e) => setInterviewForm({ ...interviewForm, time: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Interviewer Name *</label>
                <input value={interviewForm.interviewer} onChange={(e) => setInterviewForm({ ...interviewForm, interviewer: e.target.value })} placeholder="Interviewer Name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Meeting Link *</label>
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
                <input type="date" min={todayLocalStr()} value={rescheduleInterview.date} onChange={(e) => setRescheduleInterview({ ...rescheduleInterview, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
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
              <button onClick={handleConfirmReschedule} className="flex-1 bg-[#4F3CC9] text-white rounded-xl py-2.5 font-semibold hover:bg-[#3d2fa8]">Confirm Reschedule</button>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Candidate Name *</label>
                <input value={offerForm.candidateName} onChange={(e) => setOfferForm({ ...offerForm, candidateName: e.target.value })} placeholder="Enter candidate name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role *</label>
                <input value={offerForm.role} onChange={(e) => setOfferForm({ ...offerForm, role: e.target.value })} placeholder="e.g. Backend Engineer" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Payroll / Stipend (₹) *</label>
                <input value={offerForm.salary} onChange={(e) => setOfferForm({ ...offerForm, salary: e.target.value })} placeholder="e.g. ₹75,000/mo" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employment Type</label>
                <select value={offerForm.type} onChange={(e) => setOfferForm({ ...offerForm, type: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {["Full-Time","Internship","Contract"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Offer Date *</label>
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
                <label
                  className={`border-2 border-dashed rounded-xl p-4 text-center text-sm cursor-pointer transition block ${offerForm.offerLetterUploaded ? "border-green-400 bg-green-50 text-green-700" : "border-gray-200 text-gray-400 hover:border-[#4F3CC9]"}`}
                >
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="hidden"
                    disabled={offerModalLetterUploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setOfferModalLetterUploading(true);
                      try {
                        const { url, name } = await uploadOfferLetter(f);
                        setOfferForm((prev) => ({ ...prev, offerLetterUploaded: true, offerLetterUrl: url, offerLetterName: name }));
                      } catch {
                        showCandidateToast("Failed to upload the offer letter. Please try again.");
                      } finally {
                        setOfferModalLetterUploading(false);
                      }
                    }}
                  />
                  {offerModalLetterUploading
                    ? "Uploading…"
                    : offerForm.offerLetterUploaded
                      ? `✓ ${offerForm.offerLetterName || "Offer Letter Uploaded"}`
                      : "Click to upload Offer Letter (PDF, DOC, DOCX)"}
                </label>
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
                <input type="date" min={todayLocalStr()} value={editInterview.date} onChange={(e) => setEditInterview({ ...editInterview, date: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
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
              {!showDocModal.employeeCreated && (
                <div className="mt-3 p-3 bg-[#EDE9FF] rounded-xl text-center">
                  <p className="text-xs text-[#4F3CC9] font-medium mb-2">
                    {showDocModal.docs.every(d => d.submitted)
                      ? "All documents submitted! Ready to create the employee record."
                      : "You can create the employee record now, or after all documents are submitted."}
                  </p>
                  <button onClick={() => { const o = showDocModal; setShowDocModal(null); createEmployeeFromOnboarding(o); }} className="bg-[#4F3CC9] text-white text-xs px-4 py-2 rounded-xl font-semibold hover:bg-[#3d2fa8]">Create Employee Account</button>
                </div>
              )}
              {showDocModal.employeeCreated && (
                <p className="mt-3 p-3 bg-teal-50 rounded-xl text-center text-xs text-teal-700 font-medium">✓ Employee record created in the Employees module.</p>
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
                <label className="text-xs font-medium text-gray-600 block mb-1">Contact Number *</label>
                <input value={onboardingForm.mobile} onChange={(e) => setOnboardingForm({ ...onboardingForm, mobile: e.target.value })} placeholder="10-digit mobile number" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Role / Designation *</label>
                <input value={onboardingForm.role} onChange={(e) => setOnboardingForm({ ...onboardingForm, role: e.target.value })} placeholder="e.g. Software Engineer" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Employee ID * <span className="text-gray-400 font-normal">(auto-generated · read-only)</span></label>
                <div className="flex gap-2">
                  <input value={onboardingForm.empId} readOnly aria-readonly="true" tabIndex={-1} title="Auto-generated sequentially — cannot be edited manually" placeholder="EMP…" className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-600 cursor-not-allowed focus:outline-none select-none" />
                  <button type="button" onClick={async () => { const id = await suggestNextEmpId(); setOnboardingForm((f) => ({ ...f, empId: id })); }} title="Regenerate the next available ID" className="shrink-0 px-3 rounded-xl border border-gray-200 text-xs font-medium text-[#4F3CC9] hover:bg-[#F5F3FF]">↻</button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Date of Joining *</label>
                <input type="date" value={onboardingForm.doj} onChange={(e) => setOnboardingForm({ ...onboardingForm, doj: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Department</label>
                <select value={onboardingForm.department} onChange={(e) => setOnboardingForm({ ...onboardingForm, department: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none">
                  {departments.map((d) => <option key={d}>{d}</option>)}
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
                {viewCandidate.resumeUrl ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl">
                    <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-xs font-bold text-red-600">
                      {(viewCandidate.resumeName?.split(".").pop() || "PDF").slice(0, 4).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{viewCandidate.resumeName || "Resume"}</p>
                      <p className="text-xs text-gray-400">Uploaded during application</p>
                    </div>
                    <button onClick={() => viewResume(viewCandidate.resumeUrl!)} className="flex items-center gap-1 text-xs text-[#4F3CC9] font-medium hover:underline"><Eye size={12} /> View</button>
                    <button onClick={() => downloadResume(viewCandidate.resumeUrl!, viewCandidate.resumeName)} className="flex items-center gap-1 text-xs text-gray-500 hover:underline"><Download size={12} /> Download</button>
                  </div>
                ) : (
                  <div className="px-4 py-3 bg-gray-50 rounded-xl text-sm text-gray-400">No resume uploaded.</div>
                )}
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
                        {iv.feedback && <p className="text-xs text-gray-700 mt-1 italic">&quot;{iv.feedback}&quot;</p>}
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
                  {departments.map((d) => <option key={d}>{d}</option>)}
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
                <select
                  value={["LinkedIn","Indeed","Referral","Direct","Campus"].includes(editCandidateForm.source) ? editCandidateForm.source : "Other"}
                  onChange={(e) => setEditCandidateForm({ ...editCandidateForm, source: e.target.value === "Other" ? "" : e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9]"
                >
                  {["LinkedIn","Indeed","Referral","Direct","Campus","Other"].map((s) => <option key={s}>{s}</option>)}
                </select>
                {!["LinkedIn","Indeed","Referral","Direct","Campus"].includes(editCandidateForm.source) && (
                  <input
                    value={editCandidateForm.source}
                    onChange={(e) => setEditCandidateForm({ ...editCandidateForm, source: e.target.value })}
                    placeholder="Enter source name"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9] mt-2"
                  />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Recruiter Assigned</label>
                <input value={editCandidateForm.recruiter} onChange={(e) => setEditCandidateForm({ ...editCandidateForm, recruiter: e.target.value })} placeholder="Recruiter name" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4F3CC9]" />
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
