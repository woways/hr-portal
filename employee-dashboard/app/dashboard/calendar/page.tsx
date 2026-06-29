"use client";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { getDocs, getDoc, doc, collection, query, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getHolidays, getMyAttendanceAll, getMyLeaves, Holiday, LeaveRequest } from "@/lib/firebaseService";

type DayType = "present" | "absent" | "late" | "leave" | "holiday" | "today" | "weekend" | "";

const dayTypeStyles: Record<DayType, string> = {
  present: "bg-green-100 text-green-700 font-semibold",
  absent:  "bg-red-100 text-red-700 font-semibold",
  late:    "bg-orange-100 text-orange-700 font-semibold",
  leave:   "bg-yellow-100 text-yellow-700 font-semibold",
  holiday: "bg-blue-100 text-blue-700 font-semibold",
  today:   "ring-2 ring-[#4F3CC9] bg-[#EDE9FF] text-[#4F3CC9] font-bold",
  weekend: "text-gray-300",
  "":      "text-gray-700 hover:bg-gray-50",
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${SHORT_MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

export default function CalendarPage() {
  const todayDate  = new Date();
  // Use local date parts — toISOString() is UTC and can give yesterday in IST
  const todayYear  = todayDate.getFullYear();
  const todayMon   = todayDate.getMonth();
  const todayDay   = todayDate.getDate();
  const todayKey   = `${todayYear}-${String(todayMon + 1).padStart(2, "0")}-${String(todayDay).padStart(2, "0")}`;

  const [currentYear,  setCurrentYear]  = useState(todayYear);
  const [currentMonth, setCurrentMonth] = useState(todayMon);

  const [empId,       setEmpId]       = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);

  // Firebase data
  const [holidays,    setHolidays]    = useState<Holiday[]>([]);
  const [attendance,  setAttendance]  = useState<Record<string, DayType>>({});
  const [leaves,      setLeaves]      = useState<LeaveRequest[]>([]);

  // ── Tooltip for clicked day ────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ day: number; type: DayType; info: string } | null>(null);

  // ── Resolve current employee ID then load all data ─────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }

      let resolvedEmpId: string | null = null;

      // Primary: find employee by email
      if (user.email) {
        const snap = await getDocs(query(collection(db, "employees"), where("email", "==", user.email)));
        if (!snap.empty) resolvedEmpId = snap.docs[0].id;
      }
      // Fallback: users/{uid}.employeeId
      if (!resolvedEmpId) {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) resolvedEmpId = (uSnap.data().employeeId as string) ?? null;
      }

      if (!resolvedEmpId) { setLoading(false); return; }
      setEmpId(resolvedEmpId);

      try {
        const [hols, attDocs, lvDocs] = await Promise.all([
          getHolidays(),
          getMyAttendanceAll(resolvedEmpId),
          getMyLeaves(resolvedEmpId),
        ]);

        setHolidays(hols);
        setLeaves(lvDocs);

        // Build attendance map: "YYYY-MM-DD" → DayType
        const attMap: Record<string, DayType> = {};
        attDocs.forEach((r) => {
          const dateKey = (r.date as string)?.slice(0, 10);
          if (!dateKey) return;
          const status = String(r.status ?? "").toLowerCase();
          if (status === "present") attMap[dateKey] = r.late ? "late" : "present";
          else if (status === "absent") attMap[dateKey] = "absent";
          else if (status === "half day") attMap[dateKey] = "late";
          else if (status === "leave") attMap[dateKey] = "leave";
        });

        // Overlay approved leaves (they override absent)
        lvDocs.filter(l => l.status === "Approved").forEach((l) => {
          const start = new Date(l.startDate + "T00:00:00");
          const end   = new Date(l.endDate   + "T00:00:00");
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = d.toISOString().slice(0, 10);
            attMap[key] = "leave";
          }
        });

        setAttendance(attMap);
      } catch (err) {
        console.error("[Calendar] load error:", err);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goToPrev() {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
    setTooltip(null);
  }
  function goToNext() {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
    setTooltip(null);
  }

  // ── Day type resolver ──────────────────────────────────────────────────────

  // Build a set of holiday dates for quick lookup
  const holidaySet = new Map<string, string>(); // date → name
  holidays.forEach(h => holidaySet.set(h.date, h.name));

  function getDayType(day: number): DayType {
    const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(currentYear, currentMonth, day).getDay();
    if (dow === 0 || dow === 6) return "weekend";
    if (holidaySet.has(dateKey)) return "holiday";
    // Today always gets the "today" ring regardless of attendance
    if (dateKey === todayKey) return "today";
    // Show attendance status only if a real record exists — never assume absent
    return attendance[dateKey] ?? "";
  }

  function getDayInfo(day: number, type: DayType): string {
    const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (type === "holiday") return `🎉 ${holidaySet.get(dateKey)}`;
    if (type === "today") return "Today";
    if (type === "leave") {
      const lv = leaves.find(l => l.startDate <= dateKey && l.endDate >= dateKey);
      return lv ? `${lv.leaveType} (${lv.status})` : "Leave";
    }
    if (type === "present") return "Present";
    if (type === "absent")  return "Absent";
    if (type === "late")    return "Late / Half Day";
    if (type === "weekend") return "Weekend";
    return "";
  }

  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth     = new Date(currentYear, currentMonth + 1, 0).getDate();

  // ── Sidebar: upcoming holidays (from today onwards) ────────────────────────
  const upcomingHols = holidays
    .filter(h => h.date >= todayKey)
    .slice(0, 5);

  // ── Sidebar: approved leaves ────────────────────────────────────────────────
  const approvedLeaves = leaves
    .filter(l => l.status === "Approved" && l.endDate >= todayKey)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // ── Month summary stats ───────────────────────────────────────────────────
  const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-`;
  const monthAttEntries = Object.entries(attendance).filter(([k]) => k.startsWith(monthPrefix));
  const presentDays = monthAttEntries.filter(([, v]) => v === "present" || v === "late").length;
  const absentDays  = monthAttEntries.filter(([, v]) => v === "absent").length;
  const leaveDays   = monthAttEntries.filter(([, v]) => v === "leave").length;
  const monthHols   = holidays.filter(h => h.date.startsWith(monthPrefix)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-500 text-sm mt-1">View your attendance, leaves, and upcoming events.</p>
        </div>
        <span className="bg-[#EDE9FF] text-[#4F3CC9] text-xs font-semibold px-3 py-1.5 rounded-xl mt-1">
          Today: {fmtDisplayDate(todayKey)}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[#4F3CC9]" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">

          {/* ── Main Calendar ── */}
          <div className="col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={goToPrev} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-[#F5F3FF] transition-colors">
                <ChevronLeft size={18} className="text-gray-600" />
              </button>
              <h2 className="text-lg font-bold text-gray-900">{MONTHS[currentMonth]} {currentYear}</h2>
              <button onClick={goToNext} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-[#F5F3FF] transition-colors">
                <ChevronRight size={18} className="text-gray-600" />
              </button>
            </div>

            {/* Month summary chips */}
            <div className="flex gap-3 mb-5 flex-wrap">
              {[
                { label: `${presentDays} Present`, cls: "bg-green-50 text-green-700" },
                { label: `${absentDays} Absent`,   cls: "bg-red-50 text-red-700"   },
                { label: `${leaveDays} Leave`,     cls: "bg-yellow-50 text-yellow-700" },
                { label: `${monthHols} Holiday`,   cls: "bg-blue-50 text-blue-700" },
              ].map(s => (
                <span key={s.label} className={`text-xs font-medium px-3 py-1 rounded-full ${s.cls}`}>{s.label}</span>
              ))}
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS_OF_WEEK.map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1" onClick={() => setTooltip(null)}>
              {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day   = i + 1;
                const dtype = getDayType(day);
                const isHol = dtype === "holiday";
                const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                return (
                  <div key={day} className="relative group">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const info = getDayInfo(day, dtype);
                        if (info) setTooltip(tooltip?.day === day ? null : { day, type: dtype, info });
                      }}
                      className={`aspect-square flex flex-col items-center justify-center rounded-xl text-sm cursor-pointer transition-all
                        ${dayTypeStyles[dtype]}
                        ${isHol ? "ring-1 ring-blue-300" : ""}`}
                    >
                      <span>{day}</span>
                      {isHol && <span className="text-[8px] leading-none mt-0.5 text-blue-500 font-medium">H</span>}
                    </div>
                    {/* Tooltip */}
                    {tooltip?.day === day && tooltip.info && (
                      <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1 w-max max-w-[150px] bg-gray-900 text-white text-xs rounded-lg px-2 py-1.5 shadow-lg text-center pointer-events-none">
                        <p>{fmtDisplayDate(dateKey)}</p>
                        <p className="font-medium">{tooltip.info}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap gap-4">
              {[
                { color: "bg-green-200",                         label: "Present"       },
                { color: "bg-orange-200",                        label: "Late / Half"   },
                { color: "bg-red-200",                           label: "Absent"        },
                { color: "bg-yellow-200",                        label: "Leave"         },
                { color: "bg-blue-200 ring-1 ring-blue-300",     label: "Holiday"       },
                { color: "ring-2 ring-[#4F3CC9] bg-[#EDE9FF]",  label: "Today"         },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-md ${item.color}`} />
                  <span className="text-xs text-gray-500">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-4">

            {/* Upcoming Holidays */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <CalendarDays size={16} className="text-blue-500" />
                Upcoming Holidays
              </h3>
              <div className="space-y-3">
                {upcomingHols.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No upcoming holidays</p>
                )}
                {upcomingHols.map(h => (
                  <div key={h.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{h.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{fmtDisplayDate(h.date)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                      ${h.type === "National" ? "bg-orange-100 text-orange-700"
                      : h.type === "Regional" ? "bg-blue-100 text-blue-600"
                      : "bg-gray-100 text-gray-600"}`}>
                      {h.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Approved Leaves */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <CalendarDays size={16} className="text-yellow-500" />
                Approved Leaves
              </h3>
              <div className="space-y-3">
                {approvedLeaves.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No approved leaves</p>
                )}
                {approvedLeaves.map(l => (
                  <div key={l.id} className="flex items-center justify-between p-3 bg-yellow-50 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {l.startDate === l.endDate
                          ? fmtDisplayDate(l.startDate)
                          : `${fmtDisplayDate(l.startDate)} – ${fmtDisplayDate(l.endDate)}`}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{l.leaveType} · {l.days} day{l.days !== 1 ? "s" : ""}</p>
                    </div>
                    <span className="text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">Approved</span>
                  </div>
                ))}
              </div>
            </div>

            {/* This month's holidays */}
            {holidays.filter(h => h.date.startsWith(monthPrefix)).length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                  <CalendarDays size={16} className="text-[#4F3CC9]" />
                  {MONTHS[currentMonth]} Holidays
                </h3>
                <div className="space-y-2">
                  {holidays.filter(h => h.date.startsWith(monthPrefix)).map(h => (
                    <div key={h.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-800 font-medium">{h.name}</span>
                      <span className="text-gray-500 text-xs">{fmtDisplayDate(h.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
