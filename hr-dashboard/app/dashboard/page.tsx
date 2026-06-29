"use client";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import { getEmployees, getAttendance, getLeaveRequests, getGoals } from "@/lib/firebaseService";

interface Employee {
  id: string; status: string; employmentType: string; department: string;
  doj: string;
}
interface AttRecord { status: string; late: boolean; workingHours: string; }
interface LeaveRequest { status: string; leaveType: string; startDate: string; }
interface Goal { status: string; }

function parseWorkingHours(s: string): number {
  if (!s || s === "-" || s === "—") return 0;
  const m = s.match(/(\d+)h\s*(\d*)m?/);
  if (m) return Number(m[1]) + Number(m[2] || 0) / 60;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const TODAY = new Date().toISOString().slice(0, 10);

function getMonthLabel(daysBack: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - daysBack);
  return d.toLocaleString("en-IN", { month: "short" });
}

export default function DashboardPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attRecords, setAttRecords] = useState<AttRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getEmployees().catch(() => []),
      getAttendance(TODAY).catch(() => []),
      getLeaveRequests().catch(() => []),
      getGoals().catch(() => []),
    ]).then(([emps, att, leaves, gs]) => {
      setEmployees((emps as Record<string, unknown>[]).map(d => ({
        id: (d.employeeId ?? d.id) as string,
        status: (d.status as string) ?? "Active",
        employmentType: (d.employmentType as string) ?? "Full-Time",
        department: (d.department as string) ?? "",
        doj: (d.doj as string) ?? "",
      })));
      setAttRecords((att as Record<string, unknown>[]).map(d => ({
        status: (d.status as string) ?? "",
        late: Boolean(d.late),
        workingHours: (d.workingHours as string) ?? "",
      })));
      setLeaveRequests((leaves as Record<string, unknown>[]).map(d => ({
        status: (d.status as string) ?? "",
        leaveType: (d.leaveType as string) ?? "",
        startDate: (d.startDate as string) ?? "",
      })));
      setGoals((gs as Record<string, unknown>[]).map(d => ({
        status: (d.status as string) ?? "",
      })));
      setLoading(false);
    });
  }, []);

  // ── Employee overview ─────────────────────────────────────────────────────
  const totalEmp       = employees.length;
  const totalInterns   = employees.filter(e => e.employmentType === "Intern").length;
  const activeEmp      = employees.filter(e => e.status === "Active").length;
  const onProbation    = employees.filter(e => e.status === "Probation").length;
  const onLeave        = employees.filter(e => e.status === "On Leave").length;
  const exited         = employees.filter(e => e.status === "Exited").length;

  const employeeOverview = [
    { label: "Total Employees",  value: totalEmp,     color: "bg-purple-100", text: "text-purple-700" },
    { label: "Total Interns",    value: totalInterns, color: "bg-blue-100",   text: "text-blue-700"   },
    { label: "Active Employees", value: activeEmp,    color: "bg-green-100",  text: "text-green-700"  },
    { label: "On Probation",     value: onProbation,  color: "bg-orange-100", text: "text-orange-700" },
    { label: "On Leave",         value: onLeave,      color: "bg-yellow-100", text: "text-yellow-700" },
    { label: "Exited",           value: exited,       color: "bg-red-100",    text: "text-red-700"    },
  ];

  // ── Attendance overview ───────────────────────────────────────────────────
  const presentCount  = attRecords.filter(r => r.status === "Present").length;
  const absentCount   = attRecords.filter(r => r.status === "Absent").length;
  const lateCount     = attRecords.filter(r => r.late).length;
  const halfDayCount  = attRecords.filter(r => r.status === "Half Day").length;
  const hoursArr      = attRecords.map(r => parseWorkingHours(r.workingHours)).filter(h => h > 0);
  const avgHours      = hoursArr.length ? (hoursArr.reduce((s, h) => s + h, 0) / hoursArr.length).toFixed(1) + "h" : "—";

  const attendanceOverview = [
    { label: "Present Today",     value: presentCount, color: "bg-green-100",  text: "text-green-700"  },
    { label: "Absent Today",      value: absentCount,  color: "bg-red-100",    text: "text-red-700"    },
    { label: "Late Logins",       value: lateCount,    color: "bg-orange-100", text: "text-orange-700" },
    { label: "Half-Day",          value: halfDayCount, color: "bg-yellow-100", text: "text-yellow-700" },
    { label: "Avg Working Hours", value: avgHours,     color: "bg-blue-100",   text: "text-blue-700"   },
  ];

  // ── Leave summary ─────────────────────────────────────────────────────────
  const pendingLeaves  = leaveRequests.filter(r => r.status === "Pending").length;
  const approvedLeaves = leaveRequests.filter(r => r.status === "Approved").length;
  const rejectedLeaves = leaveRequests.filter(r => r.status === "Rejected").length;

  const leaveCards = [
    { label: "Pending Requests", value: pendingLeaves,  color: "bg-yellow-50 border border-yellow-100", text: "text-yellow-700" },
    { label: "Approved",         value: approvedLeaves, color: "bg-green-50 border border-green-100",   text: "text-green-700"  },
    { label: "Rejected",         value: rejectedLeaves, color: "bg-red-50 border border-red-100",       text: "text-red-700"    },
  ];

  // ── Goal completion ───────────────────────────────────────────────────────
  const totalGoals     = goals.length || 1;
  const notStarted     = goals.filter(g => g.status === "Not Started").length;
  const inProgress     = goals.filter(g => g.status === "In Progress" || g.status === "On Track" || g.status === "At Risk" || g.status === "Behind").length;
  const completed      = goals.filter(g => g.status === "Completed").length;

  const realTotal = goals.length;
  const goalCompletion = [
    { label: "Not Started", count: notStarted, pct: Math.round((notStarted / totalGoals) * 100), color: "bg-gray-400"  },
    { label: "In Progress", count: inProgress, pct: Math.round((inProgress / totalGoals) * 100), color: "bg-[#4F3CC9]" },
    { label: "Completed",   count: completed,  pct: Math.round((completed  / totalGoals) * 100), color: "bg-green-500" },
  ];

  // ── Dept-wise employee count ───────────────────────────────────────────────
  const deptMap: Record<string, number> = {};
  employees.forEach(e => { deptMap[e.department] = (deptMap[e.department] ?? 0) + 1; });
  const deptEmployeeCount = Object.entries(deptMap)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => ({ dept, count }));

  // ── Leave trends (last 6 months) ──────────────────────────────────────────
  const leaveTrends = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-IN", { month: "short" });
    const monthLeaves = leaveRequests.filter(r => r.startDate?.startsWith(ym));
    return {
      month: label,
      Casual:    monthLeaves.filter(r => r.leaveType === "Casual").length,
      Sick:      monthLeaves.filter(r => r.leaveType === "Sick").length,
      Emergency: monthLeaves.filter(r => r.leaveType === "Emergency").length,
    };
  });

  // ── Monthly hiring trend (joining date) ───────────────────────────────────
  const monthlyHiringTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = getMonthLabel(5 - i);
    const hired = employees.filter(e => e.doj?.startsWith(ym)).length;
    return { month: label, hired };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back! Here&apos;s your HR overview for today.</p>
      </div>

      {/* Employee Overview */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Employee Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {employeeOverview.map((c) => (
            <div key={c.label} className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
              <div className={`w-8 h-8 rounded-lg ${c.color} flex items-center justify-center`}>
                <span className={`text-xs font-bold ${c.text}`}>{typeof c.value === "number" ? c.value : "~"}</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Attendance Overview */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Attendance Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {attendanceOverview.map((c) => (
            <div key={c.label} className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
              <div className={`w-8 h-8 rounded-lg ${c.color} flex items-center justify-center`}>
                <span className={`text-xs font-bold ${c.text}`}>A</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Leave + Goal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Leave Summary</h2>
          <div className="grid grid-cols-3 gap-3">
            {leaveCards.map((c) => (
              <div key={c.label} className={`${c.color} rounded-2xl p-4`}>
                <p className="text-2xl font-bold text-gray-900">{c.value}</p>
                <p className={`text-xs font-medium mt-1 ${c.text}`}>{c.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Goal Status Breakdown</h2>
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            {goals.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">No goals yet</p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">Total goals: <span className="font-semibold text-gray-700">{realTotal}</span></p>
                {goalCompletion.map((g) => (
                  <div key={g.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">{g.label}</span>
                      <span className="font-semibold text-gray-800">{g.count} goal{g.count !== 1 ? "s" : ""} &nbsp;<span className="text-gray-400 font-normal">({g.pct}%)</span></span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${g.color}`} style={{ width: `${g.pct}%` }} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Dept-wise Employee Count */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Department-wise Employee Count</h2>
          {deptEmployeeCount.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No employee data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deptEmployeeCount} layout="vertical" barSize={10}>
                <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="dept" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={{ borderRadius: "10px", border: "none", fontSize: "12px" }} />
                <Bar dataKey="count" name="Employees" fill="#4F3CC9" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly Hiring Trend */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Monthly Hiring Trend (by Join Date)</h2>
          {monthlyHiringTrend.every(m => m.hired === 0) ? (
            <p className="text-sm text-gray-400 text-center py-10">No hiring data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={monthlyHiringTrend}>
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "12px" }} />
                <Line type="monotone" dataKey="hired" stroke="#4F3CC9" strokeWidth={2.5} dot={{ fill: "#4F3CC9", r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leave Trends */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Leave Trends (6 Months)</h2>
          {leaveRequests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No leave data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={leaveTrends}>
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "none", fontSize: "12px" }} />
                <Bar dataKey="Casual"    fill="#4F3CC9" radius={[4, 4, 0, 0]} name="Casual"    />
                <Bar dataKey="Sick"      fill="#F59E0B" radius={[4, 4, 0, 0]} name="Sick"      />
                <Bar dataKey="Emergency" fill="#EF4444" radius={[4, 4, 0, 0]} name="Emergency" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Goal Summary */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Goal Breakdown</h2>
          {goals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No goals yet</p>
          ) : (
            <div className="space-y-4">
              {goalCompletion.map((g) => (
                <div key={g.label}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-gray-600 font-medium">{g.label}</span>
                    <span className="font-bold text-gray-800">{g.pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div className={`h-3 rounded-full ${g.color} transition-all`} style={{ width: `${g.pct}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">Based on {goals.length} total goal{goals.length !== 1 ? "s" : ""}</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
