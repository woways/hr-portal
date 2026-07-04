"use client";
import { useState, useEffect } from "react";
import { Eye, Pencil, Trash2, Star, Plus, X } from "lucide-react";
import { Goal, GoalStatus } from "@/lib/types";
import { onAuthStateChanged } from "firebase/auth";
import {
  getDocs,
  addDoc,
  deleteDoc,
  collection,
  doc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const map: Record<GoalStatus, string> = {
    "Not Started": "bg-gray-100 text-gray-500",
    "In Progress": "bg-blue-100 text-blue-700",
    Completed: "bg-green-100 text-green-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={14}
          className={star <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200 fill-gray-200"}
        />
      ))}
    </div>
  );
}

interface PerformanceReview {
  id: string;
  employeeName: string;
  department: string;
  lastReviewDate: string;
  rating: number;
}

type Tab = "goals" | "reviews";

const DEFAULT_GOAL_FORM = {
  employeeId: "",
  title: "",
  description: "",
  deadline: "",
  category: "",
  status: "Not Started" as GoalStatus,
};

const DEFAULT_REVIEW_FORM = {
  employeeName: "",
  department: "",
  rating: 3,
  reviewDate: "",
};

export default function PerformancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalForm, setGoalForm] = useState(DEFAULT_GOAL_FORM);
  const [goalSubmitting, setGoalSubmitting] = useState(false);

  const [showAddReview, setShowAddReview] = useState(false);
  const [reviewForm, setReviewForm] = useState(DEFAULT_REVIEW_FORM);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  async function loadGoals() {
    const snap = await getDocs(collection(db, "personalGoals"));
    const data: Goal[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Goal, "id">) }));
    setGoals(data);
  }

  async function loadReviews() {
    const snap = await getDocs(collection(db, "performanceReviews"));
    const data: PerformanceReview[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<PerformanceReview, "id">),
    }));
    setReviews(data);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setLoading(true);
        await Promise.all([loadGoals(), loadReviews()]);
        setLoading(false);
      } else {
        setGoals([]);
        setReviews([]);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  async function handleDeleteGoal(id: string) {
    const prev = goals;
    setGoals((g) => g.filter((goal) => goal.id !== id));
    try {
      await deleteDoc(doc(db, "personalGoals", id));
    } catch {
      setGoals(prev);
    }
  }

  async function handleAddGoal(e: React.FormEvent) {
    e.preventDefault();
    setGoalSubmitting(true);
    try {
      await addDoc(collection(db, "personalGoals"), {
        employeeId: goalForm.employeeId,
        employeeName: goalForm.title,
        department: goalForm.category,
        goalName: goalForm.title,
        description: goalForm.description,
        kpi: "",
        deadline: goalForm.deadline,
        progress: 0,
        status: goalForm.status,
        createdAt: new Date().toISOString(),
      });
      await loadGoals();
      setGoalForm(DEFAULT_GOAL_FORM);
      setShowAddGoal(false);
    } finally {
      setGoalSubmitting(false);
    }
  }

  async function handleAddReview(e: React.FormEvent) {
    e.preventDefault();
    setReviewSubmitting(true);
    try {
      await addDoc(collection(db, "performanceReviews"), {
        employeeName: reviewForm.employeeName,
        department: reviewForm.department,
        rating: reviewForm.rating,
        lastReviewDate: reviewForm.reviewDate,
        createdAt: new Date().toISOString(),
      });
      await loadReviews();
      setReviewForm(DEFAULT_REVIEW_FORM);
      setShowAddReview(false);
    } finally {
      setReviewSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Performance & Goals</h1>
          <p className="text-gray-500 text-sm mt-1">
            Track employee goals, performance reviews, and development.
          </p>
        </div>
        <button
          onClick={() => activeTab === "goals" ? setShowAddGoal(true) : setShowAddReview(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa0] transition-colors"
        >
          <Plus size={16} />
          {activeTab === "goals" ? "Add Goal" : "Add Review"}
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-5">
          <div className="flex gap-0">
            {(
              [
                { key: "goals", label: "Goals Management" },
                { key: "reviews", label: "Performance Reviews" },
              ] as { key: Tab; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-5 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-[#4F3CC9] text-[#4F3CC9]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <>
            {activeTab === "goals" && (
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8F7FF]">
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Employee
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Department
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Goal
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Deadline
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Status
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {goals.map((goal) => (
                    <tr key={goal.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs">
                            {getInitials(goal.employeeName)}
                          </div>
                          <p className="text-sm font-medium text-gray-900">{goal.employeeName}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">{goal.department}</td>
                      <td className="px-5 py-3 max-w-[220px]">
                        <p className="text-sm font-medium text-gray-800">{goal.goalName}</p>
                        <p className="text-xs text-gray-400 truncate">{goal.description}</p>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">{goal.deadline}</td>
                      <td className="px-5 py-3">
                        <GoalStatusBadge status={goal.status} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button className="p-1.5 rounded-lg hover:bg-[#EDE9FF] text-[#4F3CC9] transition-colors">
                            <Eye size={14} />
                          </button>
                          <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteGoal(goal.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {goals.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                        No goals found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === "reviews" && (
              <table className="w-full">
                <thead>
                  <tr className="bg-[#F8F7FF]">
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Employee
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Department
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Last Review Date
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Rating
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reviews.map((review) => (
                    <tr key={review.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs">
                            {getInitials(review.employeeName)}
                          </div>
                          <p className="text-sm font-medium text-gray-900">{review.employeeName}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">{review.department}</td>
                      <td className="px-5 py-3 text-sm text-gray-600">{review.lastReviewDate}</td>
                      <td className="px-5 py-3">
                        <StarRating rating={review.rating} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F3CC9] bg-[#EDE9FF] rounded-lg hover:bg-[#DDD6FE] transition-colors">
                            <Eye size={12} />
                            View Feedback
                          </button>
                          <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {reviews.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">
                        No reviews found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Add Goal Modal */}
      {showAddGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Add Goal</h2>
              <button onClick={() => setShowAddGoal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAddGoal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee ID</label>
                <input
                  type="text"
                  value={goalForm.employeeId}
                  onChange={(e) => setGoalForm((f) => ({ ...f, employeeId: e.target.value }))}
                  placeholder="e.g. EMP001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <textarea
                  value={goalForm.title}
                  onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Goal title"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  value={goalForm.description}
                  onChange={(e) => setGoalForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe the goal"
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Deadline</label>
                <input
                  type="date"
                  value={goalForm.deadline}
                  onChange={(e) => setGoalForm((f) => ({ ...f, deadline: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <textarea
                  value={goalForm.category}
                  onChange={(e) => setGoalForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Engineering"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select
                  value={goalForm.status}
                  onChange={(e) => setGoalForm((f) => ({ ...f, status: e.target.value as GoalStatus }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddGoal(false)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={goalSubmitting}
                  className="flex-1 bg-[#4F3CC9] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#3d2fa0] transition-colors disabled:opacity-60"
                >
                  {goalSubmitting ? "Saving..." : "Add Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Review Modal */}
      {showAddReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Add Review</h2>
              <button onClick={() => setShowAddReview(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAddReview} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee Name</label>
                <textarea
                  value={reviewForm.employeeName}
                  onChange={(e) => setReviewForm((f) => ({ ...f, employeeName: e.target.value }))}
                  placeholder="Full name"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                <textarea
                  value={reviewForm.department}
                  onChange={(e) => setReviewForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder="e.g. Engineering"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30 resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rating (1–5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={reviewForm.rating}
                  onChange={(e) => setReviewForm((f) => ({ ...f, rating: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Review Date</label>
                <input
                  type="date"
                  value={reviewForm.reviewDate}
                  onChange={(e) => setReviewForm((f) => ({ ...f, reviewDate: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/30"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddReview(false)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reviewSubmitting}
                  className="flex-1 bg-[#4F3CC9] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#3d2fa0] transition-colors disabled:opacity-60"
                >
                  {reviewSubmitting ? "Saving..." : "Add Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
