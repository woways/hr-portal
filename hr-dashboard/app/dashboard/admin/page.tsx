"use client";
import { useState } from "react";

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

const ROLES = [
  "HR Manager",
  "Product Designer",
  "Marketing Lead",
  "Sales Rep",
  "Frontend Engineer",
  "Backend Engineer",
  "Finance Analyst",
  "CEO",
  "Manager",
];

const ROLE_BADGE_COLORS: Record<string, string> = {
  "HR Manager": "bg-purple-100 text-purple-700",
  "Product Designer": "bg-pink-100 text-pink-700",
  "Marketing Lead": "bg-orange-100 text-orange-700",
  "Sales Rep": "bg-yellow-100 text-yellow-700",
  "Frontend Engineer": "bg-blue-100 text-blue-700",
  "Backend Engineer": "bg-indigo-100 text-indigo-700",
  "Finance Analyst": "bg-green-100 text-green-700",
  CEO: "bg-red-100 text-red-700",
  Manager: "bg-teal-100 text-teal-700",
};

function RoleBadge({ role }: { role: string }) {
  const colorClass = ROLE_BADGE_COLORS[role] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {role}
    </span>
  );
}

export default function AdminPage() {
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const [saved, setSaved] = useState<Record<string, boolean>>({});

  function handleRoleChange(id: string, role: string) {
    setAssignments((prev) => ({ ...prev, [id]: role }));
    setSaved((prev) => ({ ...prev, [id]: false }));
  }

  function handleSave(id: string) {
    setSaved((prev) => ({ ...prev, [id]: true }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin & Roles</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage system settings, roles, and permissions.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Users</p>
          <p className="text-3xl font-bold text-gray-900">—</p>
          <p className="text-xs text-gray-500 mt-1">Active system accounts</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Role Types</p>
          <p className="text-3xl font-bold text-gray-900">{ROLES.length}</p>
          <p className="text-xs text-gray-500 mt-1">Available roles</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Departments</p>
          <p className="text-3xl font-bold text-gray-900">—</p>
          <p className="text-xs text-gray-500 mt-1">Active departments</p>
        </div>
      </div>

      {/* Role Management Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">User Role Management</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Assign or update roles for team members
          </p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-[#F8F7FF]">
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Employee
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Employee ID
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Department
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Current Role
              </th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                Assign New Role
              </th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {([] as { id: string; name: string; email: string; employeeId: string; department: string; designation: string }[]).map((emp) => (
              <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#EDE9FF] flex items-center justify-center text-[#4F3CC9] font-semibold text-xs">
                      {getInitials(emp.name)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                      <p className="text-xs text-gray-400">{emp.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-sm text-gray-600">{emp.employeeId}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{emp.department}</td>
                <td className="px-5 py-3">
                  <RoleBadge role={assignments[emp.id] || emp.designation} />
                </td>
                <td className="px-5 py-3">
                  <select
                    value={assignments[emp.id] || emp.designation}
                    onChange={(e) => handleRoleChange(emp.id, e.target.value)}
                    className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4F3CC9]/20 focus:border-[#4F3CC9] bg-white min-w-[180px]"
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => handleSave(emp.id)}
                    className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      saved[emp.id]
                        ? "bg-green-100 text-green-700"
                        : "bg-[#4F3CC9] text-white hover:bg-[#3d2fa0]"
                    }`}
                  >
                    {saved[emp.id] ? "Saved ✓" : "Save"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
