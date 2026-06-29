"use client";
import { useState } from "react";
import { Target, CheckCircle, Clock, X, Plus } from "lucide-react";

type GoalStatus = "In Progress" | "Completed" | "Not Started";
type GoalCategory = "Daily" | "Weekly" | "Monthly";

interface Goal {
  id: number;
  title: string;
  description: string;
  category: GoalCategory;
  deadline: string;
  progress: number;
  status: GoalStatus;
  selfNotes: string;
  managerFeedback?: string;
}

const initialGoals: Goal[] = [];

const categoryColors: Record<
  GoalCategory,
  { bg: string; text: string; border: string }
> = {
  Daily: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  Weekly: {
    bg: "bg-purple-50",
    text: "text-[#4F3CC9]",
    border: "border-purple-200",
  },
  Monthly: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
  },
};

const statusBadge = (status: GoalStatus) => {
  switch (status) {
    case "Completed":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
          <CheckCircle size={11} /> Completed
        </span>
      );
    case "In Progress":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
          <Clock size={11} /> In Progress
        </span>
      );
    case "Not Started":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
          Not Started
        </span>
      );
  }
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [activeTab, setActiveTab] = useState<GoalCategory>("Daily");
  const [progressModal, setProgressModal] = useState<Goal | null>(null);
  const [progressInput, setProgressInput] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGoal, setNewGoal] = useState({
    title: "",
    description: "",
    category: "Daily" as GoalCategory,
    deadline: "",
  });

  const tabs: GoalCategory[] = ["Daily", "Weekly", "Monthly"];

  const filteredGoals = goals.filter((g) => g.category === activeTab);

  const openProgressModal = (goal: Goal) => {
    setProgressModal(goal);
    setProgressInput(goal.progress);
  };

  const handleUpdateProgress = () => {
    if (!progressModal) return;
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id === progressModal.id) {
          const newStatus: GoalStatus =
            progressInput === 100
              ? "Completed"
              : progressInput === 0
              ? "Not Started"
              : "In Progress";
          return { ...g, progress: progressInput, status: newStatus };
        }
        return g;
      })
    );
    setProgressModal(null);
  };

  const handleAddGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = Math.max(...goals.map((g) => g.id)) + 1;
    setGoals([
      ...goals,
      {
        id: newId,
        title: newGoal.title,
        description: newGoal.description,
        category: newGoal.category,
        deadline: newGoal.deadline
          ? new Date(newGoal.deadline).toLocaleDateString("en-IN", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "",
        progress: 0,
        status: "Not Started",
        selfNotes: "",
      },
    ]);
    setShowAddModal(false);
    setNewGoal({ title: "", description: "", category: "Daily", deadline: "" });
    setActiveTab(newGoal.category);
  };

  const updateNotes = (id: number, notes: string) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, selfNotes: notes } : g))
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Goals</h1>
          <p className="text-gray-500 text-sm mt-1">
            Track your daily, weekly, and monthly objectives.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-[#4F3CC9] text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3] transition-colors"
        >
          <Plus size={16} /> Add Goal
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-1.5 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-[#EDE9FF] text-[#4F3CC9]"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab}
            <span className="ml-1.5 text-xs opacity-70">
              ({goals.filter((g) => g.category === tab).length})
            </span>
          </button>
        ))}
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-2 gap-4">
        {filteredGoals.map((goal) => {
          const catColor = categoryColors[goal.category];
          return (
            <div
              key={goal.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4"
            >
              {/* Title & Status */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${catColor.bg} ${catColor.text} ${catColor.border}`}
                    >
                      {goal.category}
                    </span>
                    {statusBadge(goal.status)}
                  </div>
                  <h3 className="font-bold text-gray-900 mt-2">{goal.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {goal.description}
                  </p>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Deadline: {goal.deadline}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500">Progress</span>
                  <span className="text-sm font-bold text-[#4F3CC9]">
                    {goal.progress}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full bg-[#4F3CC9] transition-all duration-500"
                    style={{ width: `${goal.progress}%` }}
                  />
                </div>
              </div>

              {/* Self Performance Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Self Performance Notes
                </label>
                <textarea
                  rows={2}
                  value={goal.selfNotes}
                  onChange={(e) => updateNotes(goal.id, e.target.value)}
                  placeholder="Add your performance notes..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                />
              </div>

              {/* Manager Feedback */}
              {goal.managerFeedback && (
                <div className="bg-[#EDE9FF] rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-[#4F3CC9] mb-1">
                    Manager Feedback
                  </p>
                  <p className="text-sm text-gray-700 italic">
                    &ldquo;{goal.managerFeedback}&rdquo;
                  </p>
                </div>
              )}

              {/* Update Progress Button */}
              <button
                onClick={() => openProgressModal(goal)}
                className="mt-auto flex items-center justify-center gap-1.5 bg-[#4F3CC9] text-white px-4 py-2 rounded-full text-xs font-medium hover:bg-[#3d2fa3] transition-colors"
              >
                <Target size={13} /> Update Progress
              </button>
            </div>
          );
        })}
      </div>

      {filteredGoals.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <Target size={36} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            No {activeTab.toLowerCase()} goals yet.
          </p>
        </div>
      )}

      {/* Update Progress Modal */}
      {progressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Update Progress
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {progressModal.title}
                </p>
              </div>
              <button
                onClick={() => setProgressModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-medium text-gray-700">
                    Progress: {progressInput}%
                  </label>
                  <span className="text-xs text-[#4F3CC9] font-semibold">
                    {progressInput === 100
                      ? "Completed!"
                      : progressInput === 0
                      ? "Not Started"
                      : "In Progress"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progressInput}
                  onChange={(e) => setProgressInput(Number(e.target.value))}
                  className="w-full accent-[#4F3CC9] h-2 rounded-lg"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-[#4F3CC9] transition-all duration-300"
                  style={{ width: `${progressInput}%` }}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setProgressModal(null)}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateProgress}
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3]"
                >
                  Save Progress
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Goal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Add New Goal</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddGoal} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Goal Title
                </label>
                <input
                  required
                  type="text"
                  placeholder="Enter goal title"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                  value={newGoal.title}
                  onChange={(e) =>
                    setNewGoal({ ...newGoal, title: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the goal..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9] resize-none"
                  value={newGoal.description}
                  onChange={(e) =>
                    setNewGoal({ ...newGoal, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Category
                  </label>
                  <select
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={newGoal.category}
                    onChange={(e) =>
                      setNewGoal({
                        ...newGoal,
                        category: e.target.value as GoalCategory,
                      })
                    }
                  >
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Deadline
                  </label>
                  <input
                    type="date"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#4F3CC9]"
                    value={newGoal.deadline}
                    onChange={(e) =>
                      setNewGoal({ ...newGoal, deadline: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-full text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-[#4F3CC9] text-white px-4 py-2.5 rounded-full text-sm font-medium hover:bg-[#3d2fa3]"
                >
                  Add Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
