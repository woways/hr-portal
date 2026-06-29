"use client";
import { useState } from "react";
import { Eye, Pencil, Trash2, Star, Plus } from "lucide-react";
import { Goal, GoalStatus } from "@/lib/types";

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

const mockReviews: { id: string; employeeName: string; department: string; lastReviewDate: string; rating: number }[] = [];

type Tab = "goals" | "reviews";

export default function PerformancePage() {
  const [activeTab, setActiveTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<Goal[]>([]);

  function handleDeleteGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
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
        <button className="flex items-center gap-2 bg-[#4F3CC9] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-[#3d2fa0] transition-colors">
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
              {mockReviews.map((review) => (
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
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
