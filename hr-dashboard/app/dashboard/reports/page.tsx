"use client";
import { useState, useCallback, useEffect } from "react";
import {
  Users, Briefcase, Clock, CalendarOff, IndianRupee, Target,
  GraduationCap, Download, CheckCircle, Loader2, X, FileSpreadsheet,
  TrendingUp, BarChart2,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  getEmployees, getCandidates, getAttendance, getLeaveRequests,
  getPayroll, getGoals, getCompensation,
} from "@/lib/firebaseService";

// ── Types ─────────────────────────────────────────────────────────────────────
type ReportId = "employee" | "hiring" | "attendance" | "leave" | "payroll" | "goal" | "internship";

interface ReportData {
  headers: string[];
  rows: (string | number)[][];
  summary?: { label: string; value: string | number }[];
}

function getToday() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d: string) { return d ? d.slice(0, 10) : "—"; }
function fmtINR(n: number | string) {
  const num = typeof n === "string" ? parseFloat(n) : n;
  return isNaN(num) ? "—" : `₹${num.toLocaleString("en-IN")}`;
}

// ── Firebase fetchers per report ───────────────────────────────────────────────
async function fetchReportData(id: ReportId): Promise<ReportData> {
  switch (id) {
    // ── Employee ───────────────────────────────────────────────────────────────
    case "employee": {
      const docs = await getEmployees();
      const rows = docs.map((d) => {
        const r = d as Record<string, unknown>;
        return [
          (r.name as string) ?? "—",
          (r.employeeId ?? r.id) as string,
          (r.department as string) ?? "—",
          (r.email as string) ?? "—",
          (r.phone as string) ?? "—",
          (r.designation as string) ?? "—",
          (r.employmentType as string) ?? "—",
          (r.workMode as string) ?? "—",
          (r.status as string) ?? "Active",
          fmtDate((r.joiningDate as string) ?? ""),
        ];
      });
      return {
        headers: ["Name", "Emp ID", "Department", "Email", "Phone", "Designation", "Type", "Work Mode", "Status", "Joining Date"],
        rows,
        summary: [
          { label: "Total Employees", value: rows.length },
          { label: "Active", value: rows.filter(r => r[8] !== "Inactive").length },
          { label: "Remote", value: rows.filter(r => r[7] === "Remote").length },
          { label: "Hybrid", value: rows.filter(r => r[7] === "Hybrid").length },
        ],
      };
    }

    // ── Hiring ─────────────────────────────────────────────────────────────────
    case "hiring": {
      const docs = await getCandidates().catch(() => []);
      const rows = docs.map((d) => {
        const r = d as Record<string, unknown>;
        return [
          (r.name as string) ?? "—",
          String(r.role ?? r.position ?? "—"),
          String(r.stage ?? r.status ?? "—"),
          fmtDate(String(r.appliedDate ?? r.createdAt ?? "")),
          (r.status as string) ?? "—",
          (r.email as string) ?? "—",
        ] as (string | number)[];
      });
      return {
        headers: ["Candidate", "Role", "Stage", "Applied On", "Status", "Email"],
        rows,
        summary: [
          { label: "Total Candidates", value: rows.length },
          { label: "Shortlisted", value: rows.filter(r => String(r[2]).toLowerCase().includes("shortlist") || String(r[4]).toLowerCase().includes("shortlist")).length },
          { label: "Hired", value: rows.filter(r => String(r[4]).toLowerCase() === "hired").length },
          { label: "Rejected", value: rows.filter(r => String(r[4]).toLowerCase() === "rejected").length },
        ],
      };
    }

    // ── Attendance ─────────────────────────────────────────────────────────────
    case "attendance": {
      const [empDocs, attDocs] = await Promise.all([getEmployees(), getAttendance()]);
      const empMap = new Map<string, string>();
      (empDocs as Record<string, unknown>[]).forEach(d => {
        const id = (d.empId ?? d.employeeId) as string;
        if (id) empMap.set(id, (d.name as string) ?? id);
      });
      const rows = (attDocs as Record<string, unknown>[]).map((d) => {
        const r = d as Record<string, unknown>;
        return [
          (r.name as string) ?? empMap.get(r.empId as string) ?? "—",
          (r.empId as string) ?? "—",
          (r.dept as string) ?? "—",
          fmtDate((r.date as string) ?? ""),
          (r.clockIn as string) || "—",
          (r.clockOut as string) || "—",
          (r.workingHours as string) || "—",
          (r.status as string) ?? "—",
          (r.location as string) ?? "—",
          r.late ? "Yes" : "No",
        ];
      });
      const present = rows.filter(r => r[7] === "Present").length;
      const absent  = rows.filter(r => r[7] === "Absent").length;
      return {
        headers: ["Name", "Emp ID", "Dept", "Date", "Clock In", "Clock Out", "Hours", "Status", "Location", "Late"],
        rows,
        summary: [
          { label: "Total Records", value: rows.length },
          { label: "Present", value: present },
          { label: "Absent", value: absent },
          { label: "Present %", value: rows.length ? `${Math.round(present / rows.length * 100)}%` : "0%" },
        ],
      };
    }

    // ── Leave ──────────────────────────────────────────────────────────────────
    case "leave": {
      const docs = await getLeaveRequests();
      const rows = (docs as Record<string, unknown>[]).map((d) => [
        String(d.empName ?? d.name ?? "—"),
        (d.empId as string) ?? "—",
        String(d.type ?? d.leaveType ?? "—"),
        fmtDate(String(d.startDate ?? d.from ?? "")),
        fmtDate(String(d.endDate ?? d.to ?? "")),
        (d.days as string | number) ?? "—",
        (d.reason as string) ?? "—",
        (d.status as string) ?? "Pending",
        fmtDate(String(d.appliedAt ?? d.createdAt ?? "")),
      ] as (string | number)[]);
      return {
        headers: ["Employee", "Emp ID", "Leave Type", "From", "To", "Days", "Reason", "Status", "Applied On"],
        rows,
        summary: [
          { label: "Total Requests", value: rows.length },
          { label: "Approved", value: rows.filter(r => r[7] === "Approved").length },
          { label: "Pending", value: rows.filter(r => r[7] === "Pending").length },
          { label: "Rejected", value: rows.filter(r => r[7] === "Rejected").length },
        ],
      };
    }

    // ── Payroll ────────────────────────────────────────────────────────────────
    case "payroll": {
      const [payDocs, compDocs] = await Promise.all([
        getPayroll().catch(() => []),
        getCompensation().catch(() => []),
      ]);

      if ((payDocs as unknown[]).length > 0) {
        const rows = (payDocs as Record<string, unknown>[]).map((d) => [
          String(d.empName ?? d.name ?? "—"),
          (d.empId as string) ?? "—",
          (d.period as string) ?? "—",
          fmtINR((d.basicSalary ?? d.salary) as number),
          fmtINR((d.incentive ?? d.bonus) as number ?? 0),
          fmtINR((d.deductions as number) ?? 0),
          fmtINR((d.netPay as number) ?? 0),
          (d.status as string) ?? "Pending",
          fmtDate(String(d.paymentDate ?? "")),
        ] as (string | number)[]);
        return {
          headers: ["Employee", "Emp ID", "Pay Month", "Basic Salary", "Incentive", "Deductions", "Net Pay", "Status", "Payment Date"],
          rows,
          summary: [
            { label: "Records", value: rows.length },
            { label: "Paid", value: rows.filter(r => String(r[7]).toLowerCase() === "paid").length },
            { label: "Total Payroll", value: fmtINR(
              (payDocs as Record<string, unknown>[]).reduce((s, d) => s + (parseFloat(String(d.netPay ?? 0)) || 0), 0)
            )},
          ],
        };
      }

      // Fall back to compensation collection
      const rows = (compDocs as Record<string, unknown>[]).map((d) => [
        String(d.empName ?? d.name ?? "—"),
        (d.empId as string) ?? "—",
        (d.period as string) ?? "—",
        fmtINR((d.basicSalary ?? d.ctc) as number ?? 0),
        fmtINR((d.hra ?? 0) as number),
        fmtINR((d.deductions ?? 0) as number),
        fmtINR((d.netPay ?? d.net) as number ?? 0),
        (d.status as string) ?? "—",
      ] as (string | number)[]);
      return {
        headers: ["Employee", "Emp ID", "Pay Month", "CTC", "HRA", "Deductions", "Net Pay", "Status"],
        rows,
        summary: [
          { label: "Records", value: rows.length },
          { label: "Paid", value: rows.filter(r => String(r[7]).toLowerCase() === "paid").length },
        ],
      };
    }

    // ── Goal Performance ───────────────────────────────────────────────────────
    case "goal": {
      const docs = await getGoals();
      const rows = (docs as Record<string, unknown>[]).map((d) => [
        (d.title as string) ?? "—",
        String(d.empName ?? d.assignedTo ?? "—"),
        (d.empId as string) ?? "—",
        (d.department as string) ?? "—",
        `${d.progress ?? 0}%`,
        fmtDate((d.dueDate as string) ?? ""),
        (d.status as string) ?? "Not Started",
        (d.notes as string) ?? "—",
      ] as (string | number)[]);
      const completed = rows.filter(r => String(r[6]).toLowerCase() === "completed").length;
      const avgProgress = rows.length
        ? Math.round(rows.reduce((s, r) => s + parseFloat(String(r[4])), 0) / rows.length)
        : 0;
      return {
        headers: ["Goal Title", "Assigned To", "Emp ID", "Department", "Progress", "Due Date", "Status", "Notes"],
        rows,
        summary: [
          { label: "Total Goals", value: rows.length },
          { label: "Completed", value: completed },
          { label: "In Progress", value: rows.filter(r => String(r[6]).toLowerCase() === "in progress").length },
          { label: "Avg Progress", value: `${avgProgress}%` },
        ],
      };
    }

    // ── Internship Conversion ──────────────────────────────────────────────────
    case "internship": {
      const docs = await getEmployees();
      const interns = (docs as Record<string, unknown>[]).filter(d =>
        String(d.employmentType ?? "").toLowerCase().includes("intern")
      );
      const rows = interns.map((d) => [
        (d.name as string) ?? "—",
        (d.employeeId ?? d.id) as string,
        (d.department as string) ?? "—",
        (d.designation as string) ?? "—",
        fmtDate((d.joiningDate as string) ?? ""),
        (d.status as string) ?? "Active",
        (d.convertedTo as string) ?? "—",
        (d.convertedDate as string) ? fmtDate(d.convertedDate as string) : "—",
      ]);
      return {
        headers: ["Name", "Emp ID", "Department", "Designation", "Start Date", "Status", "Converted To", "Conversion Date"],
        rows,
        summary: [
          { label: "Total Interns", value: rows.length },
          { label: "Active", value: rows.filter(r => String(r[5]) === "Active").length },
          { label: "Converted", value: rows.filter(r => String(r[6]) !== "—").length },
        ],
      };
    }
  }
}

// ── Report Preview Modal ───────────────────────────────────────────────────────
function ReportModal({
  reportName, reportId, data, onClose,
}: {
  reportName: string;
  reportId: ReportId;
  data: ReportData;
  onClose: () => void;
}) {
  function downloadExcel() {
    const ws = XLSX.utils.aoa_to_sheet([data.headers, ...data.rows.map(row => row.map(String))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, reportName.slice(0, 30));
    XLSX.writeFile(wb, `${reportName.replace(/\s+/g, "_")}_${getToday()}.xlsx`);
  }

  const statusColors: Record<string, string> = {
    Active: "bg-green-100 text-green-700",
    Present: "bg-green-100 text-green-700",
    Approved: "bg-green-100 text-green-700",
    Completed: "bg-green-100 text-green-700",
    Hired: "bg-green-100 text-green-700",
    Paid: "bg-green-100 text-green-700",
    Pending: "bg-yellow-100 text-yellow-700",
    "In Progress": "bg-blue-100 text-blue-700",
    Absent: "bg-red-100 text-red-700",
    Rejected: "bg-red-100 text-red-700",
    Inactive: "bg-gray-100 text-gray-500",
    "Not Started": "bg-gray-100 text-gray-500",
  };

  const STATUS_COLS: Partial<Record<ReportId, number>> = {
    employee: 8, hiring: 4, attendance: 7, leave: 7,
    payroll: 7, goal: 6, internship: 5,
  };
  const statusCol = STATUS_COLS[reportId];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-[#F5F3FF] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#4F3CC9] flex items-center justify-center">
            <FileSpreadsheet size={18} className="text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">{reportName}</h2>
            <p className="text-xs text-gray-500">Generated on {getToday()} · {data.rows.length} records</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadExcel}
            className="flex items-center gap-1.5 bg-[#4F3CC9] text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-[#3d2fa8] transition"
          >
            <Download size={14} /> Download Excel
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-200 text-gray-500 transition">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data.summary && data.summary.length > 0 && (
        <div className="flex gap-4 px-6 py-4 bg-white border-b shrink-0 overflow-x-auto">
          {data.summary.map((s) => (
            <div key={s.label} className="bg-[#F5F3FF] rounded-xl px-5 py-3 shrink-0 text-center min-w-[110px]">
              <p className="text-xl font-bold text-[#4F3CC9]">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {data.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-20">
            <div className="w-14 h-14 rounded-2xl bg-[#F5F3FF] flex items-center justify-center">
              <FileSpreadsheet size={28} className="text-[#4F3CC9]" />
            </div>
            <p className="text-gray-500 text-sm">No data found for this report.</p>
            <p className="text-gray-400 text-xs">Records will appear here once data is added to the system.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                {data.headers.map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide bg-[#FAFAFA] border-b border-gray-100 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-white hover:bg-[#F5F3FF]/40" : "bg-gray-50/60 hover:bg-[#F5F3FF]/40"}>
                  {row.map((cell, ci) => {
                    const isStatus = ci === statusCol;
                    const cellStr = String(cell);
                    const statusCls = isStatus ? (statusColors[cellStr] ?? "bg-gray-100 text-gray-600") : "";
                    return (
                      <td key={ci} className="px-4 py-2.5 text-gray-700 whitespace-nowrap border-b border-gray-50">
                        {isStatus ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}`}>{cellStr}</span>
                        ) : (
                          cellStr || "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t bg-gray-50 shrink-0 flex items-center justify-between text-xs text-gray-400">
        <span>{data.rows.length} records · {data.headers.length} columns</span>
        <span>HR Portal · {getToday()}</span>
      </div>
    </div>
  );
}

// ── Report Cards config ────────────────────────────────────────────────────────
const reportCards: { id: ReportId; name: string; desc: string; icon: React.FC<{ size: number; className?: string }> }[] = [
  { id: "employee",   name: "Employee Report",              desc: "Full employee directory with status, dept, work mode",  icon: Users         },
  { id: "hiring",     name: "Hiring Report",                desc: "Recruitment pipeline and hiring metrics",               icon: Briefcase     },
  { id: "attendance", name: "Attendance Report",            desc: "Daily and monthly attendance summary",                  icon: Clock         },
  { id: "leave",      name: "Leave Report",                 desc: "Leave requests, approvals and balance summary",         icon: CalendarOff   },
  { id: "payroll",    name: "Payroll Report",               desc: "Monthly payroll, incentives and payment status",        icon: IndianRupee    },
  { id: "goal",       name: "Goal Performance Report",      desc: "Goal completion rates and KPI metrics",                 icon: Target        },
  { id: "internship", name: "Internship Conversion Report", desc: "Interns converted to full-time employees",             icon: GraduationCap },
];

const PIE_COLORS = ["#4F3CC9", "#7C5CFC", "#A78BFA", "#C4B5FD", "#DDD6FE", "#6366F1"];

interface AnalyticsData {
  deptCount:    { dept: string; count: number }[];
  hiringFunnel: { stage: string; count: number }[];
  leaveStatus:  { status: string; count: number }[];
  goalStatus:   { status: string; count: number }[];
  payrollTrend: { month: string; total: number }[];
  workMode:     { mode: string; count: number }[];
  stats: { totalEmp: number; pendingLeaves: number; totalGoals: number; monthlyPayroll: number };
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [lastGenDates, setLastGenDates] = useState<Record<string, string>>(
    Object.fromEntries(reportCards.map((r) => [r.id, ""]))
  );
  const [generating, setGenerating] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<{ id: ReportId; name: string; data: ReportData } | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<"Reports" | "Analytics">("Reports");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    if (activeTab !== "Analytics" || analytics) return;
    setAnalyticsLoading(true);
    Promise.all([
      getEmployees().catch(() => []),
      getCandidates().catch(() => []),
      getLeaveRequests().catch(() => []),
      getGoals().catch(() => []),
      getPayroll().catch(() => []),
      getCompensation().catch(() => []),
    ]).then(([emps, cands, leaves, goals, payroll, comp]) => {
      // Dept count
      const deptMap: Record<string, number> = {};
      (emps as Record<string, unknown>[]).forEach(e => { const d = String(e.department ?? "Other"); deptMap[d] = (deptMap[d] ?? 0) + 1; });
      const deptCount = Object.entries(deptMap).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count);

      // Work mode
      const modeMap: Record<string, number> = {};
      (emps as Record<string, unknown>[]).forEach(e => { const m = String(e.workMode ?? "Office"); modeMap[m] = (modeMap[m] ?? 0) + 1; });
      const workMode = Object.entries(modeMap).map(([mode, count]) => ({ mode, count }));

      // Hiring funnel
      const stageMap: Record<string, number> = {};
      (cands as Record<string, unknown>[]).forEach(c => { const s = String(c.stage ?? c.status ?? "Applied"); stageMap[s] = (stageMap[s] ?? 0) + 1; });
      const hiringFunnel = Object.entries(stageMap).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count);

      // Leave status
      const leaveMap: Record<string, number> = { Pending: 0, Approved: 0, Rejected: 0 };
      (leaves as Record<string, unknown>[]).forEach(l => { const s = String(l.status ?? "Pending"); leaveMap[s] = (leaveMap[s] ?? 0) + 1; });
      const leaveStatus = Object.entries(leaveMap).map(([status, count]) => ({ status, count }));

      // Goal status
      const goalMap: Record<string, number> = { "Not Started": 0, "In Progress": 0, "Completed": 0 };
      (goals as Record<string, unknown>[]).forEach(g => { const s = String(g.status ?? "Not Started"); goalMap[s] = (goalMap[s] ?? 0) + 1; });
      const goalStatus = Object.entries(goalMap).map(([status, count]) => ({ status, count }));

      // Payroll trend by month
      const allPay = [...(payroll as Record<string, unknown>[]), ...(comp as Record<string, unknown>[])];
      const payMap: Record<string, number> = {};
      allPay.forEach(p => {
        const month = String(p.period ?? p.month ?? "").slice(0, 7);
        if (month) payMap[month] = (payMap[month] ?? 0) + (parseFloat(String(p.netPay ?? p.net ?? 0)) || 0);
      });
      const payrollTrend = Object.entries(payMap).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
        .map(([month, total]) => ({ month, total: Math.round(total) }));

      const pendingLeaves = (leaves as Record<string, unknown>[]).filter(l => l.status === "Pending").length;
      const monthlyPayroll = allPay.reduce((s, p) => s + (parseFloat(String(p.netPay ?? p.net ?? 0)) || 0), 0);

      setAnalytics({
        deptCount, hiringFunnel, leaveStatus, goalStatus, payrollTrend, workMode,
        stats: { totalEmp: (emps as unknown[]).length, pendingLeaves, totalGoals: (goals as unknown[]).length, monthlyPayroll: Math.round(monthlyPayroll) },
      });
    }).catch(() => { setAnalyticsError(true); }).finally(() => setAnalyticsLoading(false));
  }, [activeTab, analytics]);

  const handleGenerate = useCallback(async (id: ReportId, name: string) => {
    setGenerating(id);
    try {
      const data = await fetchReportData(id);
      setLastGenDates((prev) => ({ ...prev, [id]: getToday() }));
      setActiveModal({ id, name, data });
      showToast(`${name} generated — ${data.rows.length} records`);
    } catch {
      showToast(`Failed to generate ${name}. Check your connection.`, false);
    } finally {
      setGenerating(null);
    }
  }, []);

  const handleDownload = useCallback(async (id: ReportId, name: string) => {
    setDownloading(id);
    try {
      const data = await fetchReportData(id);
      setLastGenDates((prev) => ({ ...prev, [id]: getToday() }));
      const ws = XLSX.utils.aoa_to_sheet([data.headers, ...data.rows.map(r => r.map(String))]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30));
      XLSX.writeFile(wb, `${name.replace(/\s+/g, "_")}_${getToday()}.xlsx`);
      showToast(`${name} downloaded`);
    } catch {
      showToast(`Download failed. Please try again.`, false);
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
        <p className="text-gray-500 text-sm mt-1">Generate and download comprehensive HR reports</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        {/* Tab Bar */}
        <div className="flex border-b border-gray-100">
          {(["Reports", "Analytics"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3.5 text-sm font-medium transition-all relative whitespace-nowrap ${
                activeTab === tab ? "text-[#4F3CC9]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4F3CC9] rounded-t-full" />}
            </button>
          ))}
        </div>

        {/* ── Reports Tab ── */}
        {activeTab === "Reports" && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {reportCards.map((r) => {
                const IconComp = r.icon;
                const isGen  = generating  === r.id;
                const isDl   = downloading === r.id;
                const isToday = lastGenDates[r.id] === getToday();
                return (
                  <div key={r.id} className={`bg-gray-50 rounded-2xl p-5 flex flex-col gap-4 transition-all ${(isGen || isDl) ? "ring-2 ring-[#4F3CC9]/30" : ""}`}>
                    <div className="w-10 h-10 rounded-xl bg-[#EDE9FF] flex items-center justify-center">
                      <IconComp size={20} className="text-[#4F3CC9]" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 text-sm">{r.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{r.desc}</p>
                      <div className="flex items-center gap-1.5 mt-2">
                        {isToday && <CheckCircle size={11} className="text-green-500 shrink-0" />}
                        <p className={`text-xs ${isToday ? "text-green-600 font-medium" : "text-gray-400"}`}>
                          {lastGenDates[r.id] ? `Last generated: ${lastGenDates[r.id]}` : "Not yet generated"}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleGenerate(r.id, r.name)}
                        disabled={isGen || isDl}
                        className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-all
                          ${isGen ? "bg-[#4F3CC9]/70 text-white cursor-not-allowed" : "bg-[#4F3CC9] text-white hover:bg-[#3d2fa8]"}`}
                      >
                        {isGen ? <><Loader2 size={12} className="animate-spin" /> Generating…</> : "Generate"}
                      </button>
                      <button
                        onClick={() => handleDownload(r.id, r.name)}
                        disabled={isGen || isDl}
                        className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors disabled:opacity-50"
                        title={`Download ${r.name} as Excel`}
                      >
                        {isDl ? <Loader2 size={14} className="animate-spin text-[#4F3CC9]" /> : <Download size={14} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {activeTab === "Analytics" && (
          <div className="p-6 space-y-5">
            {analyticsError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                <X size={16} className="shrink-0" />
                Failed to load analytics data. Please check your connection and try again.
              </div>
            )}
            {analyticsLoading ? (
              <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
                <Loader2 size={22} className="animate-spin text-[#4F3CC9]" />
                <span className="text-sm">Loading analytics…</span>
              </div>
            ) : analytics ? (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Total Employees",  value: analytics.stats.totalEmp,                     icon: Users,       color: "bg-purple-50 text-[#4F3CC9]" },
                    { label: "Pending Leaves",   value: analytics.stats.pendingLeaves,                icon: CalendarOff, color: "bg-yellow-50 text-yellow-600" },
                    { label: "Active Goals",     value: analytics.stats.totalGoals,                   icon: Target,      color: "bg-blue-50 text-blue-600"     },
                    { label: "Total Payroll",    value: fmtINR(analytics.stats.monthlyPayroll),       icon: IndianRupee,  color: "bg-green-50 text-green-600"   },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{label}</p>
                        <p className="text-lg font-bold text-gray-900">{value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Row 1: Department headcount + Work Mode */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <BarChart2 size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Department Headcount</h2>
                    </div>
                    {analytics.deptCount.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-10">No employee data</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={analytics.deptCount} margin={{ left: 0, right: 8 }}>
                          <XAxis dataKey="dept" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                          <Bar dataKey="count" name="Employees" fill="#4F3CC9" radius={[5, 5, 0, 0]} barSize={32} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Users size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Work Mode Distribution</h2>
                    </div>
                    {analytics.workMode.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-10">No employee data</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={analytics.workMode} dataKey="count" nameKey="mode" cx="50%" cy="50%" outerRadius={80} label={(props) => { const p = props as unknown as { mode: string; percent?: number }; return `${p.mode} ${((p.percent ?? 0) * 100).toFixed(0)}%`; }} labelLine={false}>
                            {analytics.workMode.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Row 2: Hiring Funnel + Leave Status */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Briefcase size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Hiring Pipeline</h2>
                    </div>
                    {analytics.hiringFunnel.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-10">No candidates in the system</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={analytics.hiringFunnel} layout="vertical" margin={{ left: 8, right: 16 }}>
                          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} width={90} />
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                          <Bar dataKey="count" name="Candidates" fill="#7C5CFC" radius={[0, 5, 5, 0]} barSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <CalendarOff size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Leave Request Status</h2>
                    </div>
                    {analytics.leaveStatus.every(l => l.count === 0) ? (
                      <p className="text-center text-xs text-gray-400 py-10">No leave requests yet</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={analytics.leaveStatus.filter(l => l.count > 0)} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={(props) => { const p = props as unknown as { status: string; count: number }; return `${p.status}: ${p.count}`; }} labelLine={false}>
                            {analytics.leaveStatus.filter(l => l.count > 0).map((l) => (
                              <Cell key={l.status} fill={l.status === "Approved" ? "#22c55e" : l.status === "Rejected" ? "#ef4444" : "#f59e0b"} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Row 3: Payroll Trend + Goal Status */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Payroll Trend</h2>
                    </div>
                    {analytics.payrollTrend.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-10">No payroll records yet</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={analytics.payrollTrend} margin={{ left: 8, right: 16 }}>
                          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} formatter={(v: unknown) => [`₹${Number(v).toLocaleString("en-IN")}`, "Net Payroll"]} />
                          <Line type="monotone" dataKey="total" stroke="#4F3CC9" strokeWidth={2.5} dot={{ fill: "#4F3CC9", r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Target size={16} className="text-[#4F3CC9]" />
                      <h2 className="text-sm font-semibold text-gray-900">Goal Status Breakdown</h2>
                    </div>
                    {analytics.goalStatus.every(g => g.count === 0) ? (
                      <p className="text-center text-xs text-gray-400 py-10">No goals created yet</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={analytics.goalStatus} margin={{ left: 0, right: 8 }}>
                          <XAxis dataKey="status" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" }} />
                          <Bar dataKey="count" name="Goals" radius={[5, 5, 0, 0]} barSize={40}>
                            {analytics.goalStatus.map((g) => (
                              <Cell key={g.status} fill={g.status === "Completed" ? "#22c55e" : g.status === "In Progress" ? "#4F3CC9" : "#9CA3AF"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Full-screen Report Modal ── */}
      {activeModal && (
        <ReportModal
          reportName={activeModal.name}
          reportId={activeModal.id}
          data={activeModal.data}
          onClose={() => setActiveModal(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2 text-white text-sm px-4 py-3 rounded-2xl shadow-xl transition-all ${toast.ok ? "bg-gray-900" : "bg-red-600"}`}>
          {toast.ok
            ? <CheckCircle size={16} className="text-green-400 shrink-0" />
            : <X size={16} className="shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
