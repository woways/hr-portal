"use client";
import { useState, useEffect } from "react";
import {
  Clock, CheckCircle, CalendarDays, AlertCircle, XCircle,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const HR_BASE  = "http://localhost:3000";
const EMP_API  = `${HR_BASE}/api/employees`;
const CLK_API  = `${HR_BASE}/api/clock`;
const LVE_API  = `${HR_BASE}/api/leave-requests`;

interface EmpRecord {
  id: string; name: string; designation: string; department: string;
  employmentType: string; status: string; shift: string; reportingManager: string;
}

interface ClockRecord {
  clockIn?: string; clockOut?: string; workingHours?: string; status?: string;
}

interface LeaveRequest {
  status: "Pending" | "Approved" | "Rejected";
}

function fmt12(time24: string) {
  if (!time24) return "--:--";
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function DashboardPage() {
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  // Employee identity
  const [empName, setEmpName]   = useState("");
  const [empData, setEmpData]   = useState<EmpRecord | null>(null);

  // Today's clock
  const [clockIn, setClockIn]   = useState("");
  const [clockOut, setClockOut] = useState("");
  const [workHrs, setWorkHrs]   = useState("");
  const [attStatus, setAttStatus] = useState(""); // Present / Absent / Week Off

  // Leave stats
  const [pendingLeaves, setPendingLeaves]  = useState(0);
  const [approvedLeaves, setApprovedLeaves] = useState(0);
  const [rejectedLeaves, setRejectedLeaves] = useState(0);

  const [loading, setLoading] = useState(true);

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setCurrentDate(now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Load employee + attendance + leave data
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) { setLoading(false); return; }
        const eid = snap.data().employeeId as string;
        if (!eid) { setLoading(false); return; }

        // Fetch employee record
        const empRes = await fetch(EMP_API);
        if (empRes.ok) {
          const emps = await empRes.json() as EmpRecord[];
          const emp = emps.find((e) => e.id === eid);
          if (emp) { setEmpData(emp); setEmpName(emp.name); }
        }

        const today = new Date().toISOString().slice(0, 10);

        // Fetch today's clock record
        const clkRes = await fetch(`${CLK_API}/${eid}?date=${today}`);
        if (clkRes.ok) {
          const clk = await clkRes.json() as ClockRecord;
          setClockIn(clk.clockIn ?? "");
          setClockOut(clk.clockOut ?? "");
          setWorkHrs(clk.workingHours ?? "");
          setAttStatus(clk.clockIn ? "Present" : "Absent");
        }

        // Fetch leave stats
        const lveRes = await fetch(`${LVE_API}?empId=${eid}`);
        if (lveRes.ok) {
          const leaves = await lveRes.json() as LeaveRequest[];
          if (Array.isArray(leaves)) {
            setPendingLeaves(leaves.filter((l) => l.status === "Pending").length);
            setApprovedLeaves(leaves.filter((l) => l.status === "Approved").length);
            setRejectedLeaves(leaves.filter((l) => l.status === "Rejected").length);
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
    });
    return unsub;
  }, []);

  const firstName = empName.split(" ")[0] || "there";

  const statusColor =
    attStatus === "Present" ? "bg-green-100 text-green-700" :
    attStatus === "Week Off" ? "bg-purple-100 text-purple-700" :
    "bg-red-100 text-red-700";

  const statusIcon =
    attStatus === "Present" ? <CheckCircle size={13} /> :
    attStatus === "Week Off" ? <CalendarDays size={13} /> :
    <XCircle size={13} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {loading ? (
            <div className="h-8 w-48 bg-gray-100 animate-pulse rounded-xl" />
          ) : (
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome back, {firstName}!
            </h1>
          )}
          <p className="text-gray-500 text-sm mt-1">{currentDate}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3 text-right">
          <p className="text-xs text-gray-400 mb-0.5">Current Time</p>
          <p className="text-2xl font-bold text-[#4F3CC9] tabular-nums">{currentTime}</p>
        </div>
      </div>

      {/* Employee Info Strip */}
      {!loading && empData && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-gray-400">Employee ID</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.id}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Designation</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.designation || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Department</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.department || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Reporting Manager</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.reportingManager || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Shift</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.shift || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Employment Type</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{empData.employmentType || "—"}</p>
          </div>
        </div>
      )}

      {/* Attendance Overview */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Attendance Overview</h2>
        <div className="grid grid-cols-3 gap-4">
          {/* Today's Status */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Today&apos;s Status</span>
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <CheckCircle size={18} className="text-green-600" />
              </div>
            </div>
            {loading ? (
              <div className="h-6 w-24 bg-gray-100 animate-pulse rounded-full" />
            ) : (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${attStatus ? statusColor : "bg-gray-100 text-gray-500"}`}>
                {attStatus ? statusIcon : <Clock size={13} />}
                {attStatus || "Not clocked in"}
              </span>
            )}
          </div>

          {/* Clock In / Out */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Clock In / Out</span>
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                <Clock size={18} className="text-[#4F3CC9]" />
              </div>
            </div>
            {loading ? (
              <div className="h-7 w-32 bg-gray-100 animate-pulse rounded-lg" />
            ) : (
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-gray-400">In</p>
                  <p className="text-base font-bold text-gray-900">{fmt12(clockIn)}</p>
                </div>
                <div className="w-px h-8 bg-gray-100" />
                <div>
                  <p className="text-xs text-gray-400">Out</p>
                  <p className={`text-base font-bold ${clockOut ? "text-gray-900" : "text-gray-400"}`}>
                    {fmt12(clockOut)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Working Hours */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Total Working Hours</span>
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <Clock size={18} className="text-blue-600" />
              </div>
            </div>
            {loading ? (
              <div className="h-8 w-28 bg-gray-100 animate-pulse rounded-lg" />
            ) : workHrs ? (
              <p className="text-2xl font-bold text-gray-900">{workHrs}</p>
            ) : clockIn && !clockOut ? (
              <p className="text-base font-bold text-gray-900">Ongoing <span className="text-xs text-green-500 font-normal">(clocked in)</span></p>
            ) : (
              <p className="text-2xl font-bold text-gray-400">—</p>
            )}
          </div>
        </div>
      </div>

      {/* Leave Overview */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Leave Overview</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Approved Leaves</span>
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
                <CheckCircle size={18} className="text-green-600" />
              </div>
            </div>
            {loading ? <div className="h-8 w-12 bg-gray-100 animate-pulse rounded-lg" /> : (
              <>
                <p className="text-2xl font-bold text-gray-900">{approvedLeaves}</p>
                <p className="text-xs text-gray-400 mt-1">Total approved</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Pending Requests</span>
              <div className="w-9 h-9 rounded-xl bg-yellow-50 flex items-center justify-center">
                <AlertCircle size={18} className="text-yellow-500" />
              </div>
            </div>
            {loading ? <div className="h-8 w-12 bg-gray-100 animate-pulse rounded-lg" /> : (
              <>
                <p className="text-2xl font-bold text-gray-900">{pendingLeaves}</p>
                <p className="text-xs text-gray-400 mt-1">Awaiting approval</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Rejected Leaves</span>
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                <XCircle size={18} className="text-red-500" />
              </div>
            </div>
            {loading ? <div className="h-8 w-12 bg-gray-100 animate-pulse rounded-lg" /> : (
              <>
                <p className="text-2xl font-bold text-gray-900">{rejectedLeaves}</p>
                <p className="text-xs text-gray-400 mt-1">Not approved</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
