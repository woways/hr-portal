"use client";
import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getSettingsDoc } from "@/lib/firebaseService";

type DayType = "present" | "absent" | "late" | "leave" | "holiday" | "today" | "weekend" | "";

interface Holiday { id: string; name: string; date: string; type: string; }
interface LeaveRow { id: string; startDate: string; endDate: string; leaveType: string; days: number; status: string; }

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

const DAYS_OF_WEEK = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Always use local date — never toISOString() which is UTC
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${SHORT_MONTHS[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`;
}

export default function CalendarPage() {
  const todayKey = localToday();
  const todayYear  = parseInt(todayKey.slice(0,4), 10);
  const todayMonth = parseInt(todayKey.slice(5,7), 10) - 1; // 0-indexed

  const [currentYear,  setCurrentYear]  = useState(todayYear);
  const [currentMonth, setCurrentMonth] = useState(todayMonth);
  const [loading,  setLoading]  = useState(true);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [attMap,   setAttMap]   = useState<Record<string, DayType>>({});
  const [leaves,   setLeaves]   = useState<LeaveRow[]>([]);
  const [tooltip,  setTooltip]  = useState<{day:number; label:string} | null>(null);

  // ── Load holidays (global — no empId needed) ──────────────────────────────
  const loadHolidays = useCallback(async () => {
    try {
      const holSnap = await getSettingsDoc("holidays");
      const holList: Holiday[] = ((holSnap?.list as Holiday[]) ?? []).sort((a,b)=>a.date.localeCompare(b.date));
      setHolidays(holList);
    } catch(err) {
      console.error("[Calendar] holiday load error:", err);
    }
  }, []);

  // ── Load attendance + leaves for a specific employee ──────────────────────
  const loadEmpData = useCallback(async (resolvedEmpId: string) => {
    try {
      const buildAttMap = (docs: {date?: string; status?: string; late?: boolean}[]): Record<string, DayType> => {
        const map: Record<string, DayType> = {};
        docs.forEach(r => {
          const dk = (r.date ?? "").slice(0,10);
          if (!dk) return;
          const s = String(r.status ?? "").toLowerCase();
          if (s === "present")  map[dk] = r.late ? "late" : "present";
          else if (s === "absent")   map[dk] = "absent";
          else if (s === "half day") map[dk] = "late";
          else if (s === "leave")    map[dk] = "leave";
        });
        return map;
      };

      // Attendance — try empId field, fall back to employeeId
      let attDocs: {date?:string; status?:string; late?:boolean}[] = [];
      const q1 = query(collection(db,"attendance"), where("empId","==",resolvedEmpId));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        attDocs = s1.docs.map(d => d.data() as {date?:string;status?:string;late?:boolean});
      } else {
        const q2 = query(collection(db,"attendance"), where("employeeId","==",resolvedEmpId));
        const s2 = await getDocs(q2);
        attDocs = s2.docs.map(d => d.data() as {date?:string;status?:string;late?:boolean});
      }
      const newAttMap = buildAttMap(attDocs);

      // Leave requests — try empId then employeeId field
      let lvSnap = await getDocs(query(collection(db,"leaveRequests"), where("empId","==",resolvedEmpId)));
      if (lvSnap.empty) {
        lvSnap = await getDocs(query(collection(db,"leaveRequests"), where("employeeId","==",resolvedEmpId)));
      }
      const lvRows: LeaveRow[] = lvSnap.docs.map(d => {
        const r = d.data() as Record<string,unknown>;
        return {
          id:        d.id,
          startDate: (r.startDate ?? r.from ?? "") as string,
          endDate:   (r.endDate   ?? r.to   ?? "") as string,
          leaveType: (r.type ?? r.leaveType ?? "Leave") as string,
          days:      (r.days as number) ?? 1,
          status:    (r.status ?? "Pending") as string,
        };
      });

      // Approved leaves override the attendance map
      lvRows.filter(l => l.status === "Approved").forEach(l => {
        const start = new Date(l.startDate + "T00:00:00");
        const end   = new Date(l.endDate   + "T00:00:00");
        for (const d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          newAttMap[k] = "leave";
        }
      });

      setAttMap(newAttMap);
      setLeaves(lvRows);
    } catch(err) {
      console.error("[Calendar] emp data load error:", err);
    }
  }, []);

  // ── Resolve employee and load ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setLoading(false); return; }

      // Always load holidays (global, only needs auth)
      await loadHolidays();

      // Resolve employee ID
      let resolvedId = "";
      if (user.email) {
        const snap = await getDocs(query(collection(db,"employees"), where("email","==",user.email)));
        if (!snap.empty) resolvedId = snap.docs[0].id;
      }
      if (!resolvedId) {
        const uSnap = await getDoc(doc(db,"users",user.uid));
        if (uSnap.exists()) resolvedId = (uSnap.data().employeeId as string) ?? "";
      }

      if (resolvedId) await loadEmpData(resolvedId);
      setLoading(false);
    });
    return () => unsub();
  }, [loadHolidays, loadEmpData]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goToPrev() {
    setTooltip(null);
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y-1); }
    else setCurrentMonth(m => m-1);
  }
  function goToNext() {
    setTooltip(null);
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y+1); }
    else setCurrentMonth(m => m+1);
  }

  // ── Holiday lookup map ─────────────────────────────────────────────────────
  const holidayMap = new Map<string, Holiday>();
  holidays.forEach(h => holidayMap.set(h.date, h));

  // ── Day type logic ─────────────────────────────────────────────────────────
  function getDayKey(day: number) {
    return `${currentYear}-${String(currentMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }

  function getDayType(day: number): DayType {
    const dk = getDayKey(day);
    const dow = new Date(currentYear, currentMonth, day).getDay();
    if (dow === 0 || dow === 6) return "weekend";
    if (holidayMap.has(dk)) return "holiday";
    // Attendance status takes priority — "today" is only a fallback when no record exists
    if (attMap[dk]) return attMap[dk];
    if (dk === todayKey) return "today";
    return "";
  }

  function getDayLabel(day: number, type: DayType): string {
    const dk  = getDayKey(day);
    const isTd = dk === todayKey;
    if (type === "holiday") return `${holidayMap.get(dk)?.name} (${holidayMap.get(dk)?.type})`;
    if (type === "today")   return "Today · Not marked yet";
    const prefix = isTd ? "Today · " : "";
    if (type === "leave") {
      const lv = leaves.find(l => l.startDate <= dk && l.endDate >= dk);
      return prefix + (lv ? `${lv.leaveType} · ${lv.status}` : "Leave");
    }
    if (type === "present") return prefix + "Present";
    if (type === "absent")  return prefix + "Absent";
    if (type === "late")    return prefix + "Late / Half Day";
    return "";
  }

  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth     = new Date(currentYear, currentMonth+1, 0).getDate();
  const monthPrefix     = `${currentYear}-${String(currentMonth+1).padStart(2,"0")}-`;

  // Month summary
  const monthAtt  = Object.entries(attMap).filter(([k]) => k.startsWith(monthPrefix));
  const presentCt = monthAtt.filter(([,v]) => v==="present"||v==="late").length;
  const absentCt  = monthAtt.filter(([,v]) => v==="absent").length;
  const leaveCt   = monthAtt.filter(([,v]) => v==="leave").length;
  const holCt     = holidays.filter(h => h.date.startsWith(monthPrefix)).length;

  // Sidebar
  const upcomingHols    = holidays.filter(h => h.date >= todayKey).slice(0,5);
  // Show all leave requests sorted newest first
  const allLeaveRequests = [...leaves].sort((a,b) => b.startDate.localeCompare(a.startDate));
  const thisMonthHols   = holidays.filter(h => h.date.startsWith(monthPrefix));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <p className="text-gray-500 text-sm mt-1">View your attendance, leaves, and upcoming events.</p>
        </div>
        <span className="bg-[#EDE9FF] text-[#4F3CC9] text-xs font-semibold px-3 py-1.5 rounded-xl mt-1 shrink-0">
          Today: {fmtDate(todayKey)}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={30} className="animate-spin text-[#4F3CC9]" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-6">

          {/* ── Main Calendar ── */}
          <div className="col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {/* Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={goToPrev} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-[#F5F3FF] transition">
                <ChevronLeft size={18} className="text-gray-600" />
              </button>
              <h2 className="text-lg font-bold text-gray-900">{MONTHS[currentMonth]} {currentYear}</h2>
              <button onClick={goToNext} className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-[#F5F3FF] transition">
                <ChevronRight size={18} className="text-gray-600" />
              </button>
            </div>

            {/* Month summary chips */}
            <div className="flex flex-wrap gap-2 mb-5">
              {[
                { label:`${presentCt} Present`, cls:"bg-green-50 text-green-700"   },
                { label:`${absentCt} Absent`,   cls:"bg-red-50 text-red-700"     },
                { label:`${leaveCt} Leave`,     cls:"bg-yellow-50 text-yellow-700" },
                { label:`${holCt} Holiday`,     cls:"bg-blue-50 text-blue-700"   },
              ].map(s=>(
                <span key={s.label} className={`text-xs font-medium px-3 py-1 rounded-full ${s.cls}`}>{s.label}</span>
              ))}
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS_OF_WEEK.map(d=>(
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-7 gap-1" onClick={()=>setTooltip(null)}>
              {Array.from({length:firstDayOfMonth}).map((_,i)=><div key={`e-${i}`}/>)}
              {Array.from({length:daysInMonth}).map((_,i)=>{
                const day    = i+1;
                const dk     = getDayKey(day);
                const dtype  = getDayType(day);
                const label  = getDayLabel(day, dtype);
                const isHol  = dtype === "holiday";
                const isToday = dk === todayKey;
                // Today always gets the purple ring; attendance color fills the background
                const todayRing = (isToday && dtype !== "today" && !isHol) ? "ring-2 ring-[#4F3CC9]" : "";
                return (
                  <div key={day} className="relative">
                    <div
                      onClick={e => {
                        e.stopPropagation();
                        if (label) setTooltip(tooltip?.day===day ? null : {day, label});
                      }}
                      className={`aspect-square flex flex-col items-center justify-center rounded-xl text-sm cursor-pointer transition-all
                        ${dayTypeStyles[dtype]} ${todayRing} ${isHol ? "ring-1 ring-blue-200" : ""}`}
                    >
                      <span>{day}</span>
                      {isHol && <span className="text-[8px] leading-none text-blue-500 font-bold mt-0.5">H</span>}
                    </div>
                    {tooltip?.day===day && (
                      <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[160px] bg-gray-900 text-white text-xs rounded-xl px-3 py-2 shadow-xl text-center pointer-events-none">
                        <p className="font-semibold">{fmtDate(getDayKey(day))}</p>
                        <p className="mt-0.5 text-gray-300">{label}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap gap-4">
              {[
                {color:"bg-green-200",                       label:"Present"},
                {color:"bg-orange-200",                      label:"Late/Half"},
                {color:"bg-red-200",                         label:"Absent"},
                {color:"bg-yellow-200",                      label:"Leave"},
                {color:"bg-blue-200 ring-1 ring-blue-300",   label:"Holiday"},
                {color:"ring-2 ring-[#4F3CC9] bg-[#EDE9FF]",label:"Today"},
              ].map(item=>(
                <div key={item.label} className="flex items-center gap-1.5">
                  <div className={`w-4 h-4 rounded-md ${item.color}`}/>
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
                <CalendarDays size={16} className="text-blue-500"/>
                Upcoming Holidays
              </h3>
              <div className="space-y-2">
                {upcomingHols.length===0 && <p className="text-sm text-gray-400 text-center py-3">No upcoming holidays</p>}
                {upcomingHols.map(h=>(
                  <div key={h.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{h.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{fmtDate(h.date)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                      ${h.type==="National" ? "bg-orange-100 text-orange-700"
                      : h.type==="Regional" ? "bg-blue-100 text-blue-600"
                      : "bg-gray-100 text-gray-600"}`}>
                      {h.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave Requests — all statuses */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <CalendarDays size={16} className="text-yellow-500"/>
                Leave Requests
              </h3>
              <div className="space-y-2">
                {allLeaveRequests.length===0 && (
                  <p className="text-sm text-gray-400 text-center py-3">No leave requests</p>
                )}
                {allLeaveRequests.map(l => {
                  const statusCfg = l.status === "Approved"
                    ? { bg: "bg-green-50",  badge: "bg-green-100 text-green-700",  label: "Approved" }
                    : l.status === "Rejected"
                    ? { bg: "bg-red-50",    badge: "bg-red-100 text-red-600",     label: "Rejected" }
                    : { bg: "bg-yellow-50", badge: "bg-yellow-100 text-yellow-700", label: "Pending" };
                  return (
                    <div key={l.id} className={`p-3 rounded-xl ${statusCfg.bg}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {l.startDate === l.endDate
                              ? fmtDate(l.startDate)
                              : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {l.leaveType} · {l.days} day{l.days !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusCfg.badge}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* This month's holidays */}
            {thisMonthHols.length>0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                  <CalendarDays size={16} className="text-[#4F3CC9]"/>
                  {MONTHS[currentMonth]} Holidays
                </h3>
                <div className="space-y-2">
                  {thisMonthHols.map(h=>(
                    <div key={h.id} className="flex items-center justify-between text-sm py-1">
                      <span className="text-gray-800 font-medium">{h.name}</span>
                      <span className="text-gray-500 text-xs">{fmtDate(h.date)}</span>
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
