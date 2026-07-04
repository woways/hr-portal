"use client";
import { useState, useEffect } from "react";
import { Plus, Globe, Users, Star, BarChart2, Settings, X, Link2, Trash2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { getDocs, addDoc, deleteDoc, collection, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { JobPosting } from "@/lib/types";
import { DEPARTMENTS } from "@/lib/constants";

const sourcingChannels: { name: string; percentage: number; count: number; icon: typeof Link2; color: string; iconColor: string; barColor: string }[] = [];

function StatusBadge({ status }: { status: JobPosting["status"] }) {
  const map: Record<JobPosting["status"], string> = {
    Published: "bg-green-100 text-green-700",
    Draft: "bg-gray-100 text-gray-500",
    Closed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

const defaultForm = {
  title: "",
  department: "Sales",
  status: "Draft" as JobPosting["status"],
};

async function loadPostings(): Promise<JobPosting[]> {
  const snap = await getDocs(collection(db, "jobPostings"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobPosting));
}

export default function HiringPage() {
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setLoading(true);
        loadPostings()
          .then(setPostings)
          .finally(() => setLoading(false));
      } else {
        setPostings([]);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  async function handleAdd() {
    const newPosting: JobPosting = {
      id: String(Date.now()),
      title: form.title,
      department: form.department,
      datePosted: new Date().toISOString().split("T")[0],
      status: form.status,
      applicants: 0,
    };
    setPostings((prev) => [...prev, newPosting]);
    setForm(defaultForm);
    setShowModal(false);

    try {
      await addDoc(collection(db, "jobPostings"), {
        title: newPosting.title,
        department: newPosting.department,
        datePosted: newPosting.datePosted,
        status: newPosting.status,
        applicants: newPosting.applicants,
        createdAt: new Date().toISOString(),
      });
      const refreshed = await loadPostings();
      setPostings(refreshed);
    } catch (err) {
      console.error("Failed to save job posting:", err);
      setPostings((prev) => prev.filter((p) => p.id !== newPosting.id));
    }
  }

  async function handleDelete(id: string) {
    setPostings((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteDoc(doc(db, "jobPostings", id));
    } catch (err) {
      console.error("Failed to delete job posting:", err);
      const refreshed = await loadPostings();
      setPostings(refreshed);
    }
  }

  const totalApplicants = postings.reduce((s, p) => s + p.applicants, 0);
  const publishedCount = postings.filter((p) => p.status === "Published").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Hiring & Sourcing</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage job postings, sourcing channels, and hiring metrics.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa0] transition-colors"
        >
          <Plus size={16} />
          Create Job Posting
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Applicants</p>
          <p className="text-3xl font-bold text-gray-900">{totalApplicants}</p>
          <p className="text-xs text-gray-500 mt-1">Across all open roles</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Published Jobs</p>
          <p className="text-3xl font-bold text-gray-900">{publishedCount}</p>
          <p className="text-xs text-gray-500 mt-1">Currently active</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Postings</p>
          <p className="text-3xl font-bold text-gray-900">{postings.length}</p>
          <p className="text-xs text-gray-500 mt-1">All time</p>
        </div>
      </div>

      {/* Sourcing Channels */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Sourcing Channels Overview
        </h2>
        <div className="grid grid-cols-4 gap-4">
          {sourcingChannels.map(
            ({ name, percentage, count, icon: Icon, color, iconColor, barColor }) => (
              <div
                key={name}
                className="border border-gray-100 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center`}>
                    <Icon size={17} className={iconColor} />
                  </div>
                  <span className="text-lg font-bold text-gray-900">{percentage}%</span>
                </div>
                <p className="text-sm font-semibold text-gray-800">{name}</p>
                <p className="text-xs text-gray-400 mb-2">{count} applicants</p>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${barColor}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Job Requisitions Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Active Job Requisitions</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-[#F8F7FF]">
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Job Title
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Department
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Date Posted
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Status
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Applicants
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                  Loading job postings…
                </td>
              </tr>
            ) : postings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                  No job postings found.
                </td>
              </tr>
            ) : (
              postings.map((posting) => (
                <tr key={posting.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-medium text-gray-900">{posting.title}</p>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{posting.department}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{posting.datePosted}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={posting.status} />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <BarChart2 size={14} className="text-[#4F3CC9]" />
                      <span className="text-sm font-medium text-gray-800">
                        {posting.applicants}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F3CC9] bg-[#EDE9FF] rounded-lg hover:bg-[#DDD6FE] transition-colors">
                        <Settings size={12} />
                        Manage
                      </button>
                      <button
                        onClick={() => handleDelete(posting.id)}
                        className="flex items-center justify-center p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete posting"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Job Posting Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Create Job Posting</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Job Title</label>
                <textarea
                  placeholder="e.g. Senior Frontend Engineer"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/20 focus:border-[#4F3CC9] resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                <select
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/20 focus:border-[#4F3CC9] bg-white"
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as JobPosting["status"] })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/20 focus:border-[#4F3CC9] bg-white"
                >
                  {["Published", "Draft", "Closed"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!form.title}
                className="px-5 py-2.5 text-sm bg-[#4F3CC9] text-white rounded-full hover:bg-[#3d2fa0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Posting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
