import { Employee, AttendanceRecord, LeaveRequest, Candidate, Goal, PayrollRecord, OnboardingRecord, JobPosting } from "./types";

export const mockEmployees: Employee[] = [];
export const mockAttendance: AttendanceRecord[] = [];
export const mockLeaveRequests: LeaveRequest[] = [];
export const mockCandidates: Candidate[] = [];
export const mockGoals: Goal[] = [];
export const mockPayroll: PayrollRecord[] = [];
export const mockOnboarding: OnboardingRecord[] = [];
export const mockJobPostings: JobPosting[] = [];

export const attendanceTrend = [
  { month: "Jan", present: 0, absent: 0, leave: 0 },
  { month: "Feb", present: 0, absent: 0, leave: 0 },
  { month: "Mar", present: 0, absent: 0, leave: 0 },
  { month: "Apr", present: 0, absent: 0, leave: 0 },
  { month: "May", present: 0, absent: 0, leave: 0 },
];

export const hiringFunnel = [
  { stage: "Applied", count: 0 },
  { stage: "Screening", count: 0 },
  { stage: "Interview", count: 0 },
  { stage: "Offer", count: 0 },
  { stage: "Hired", count: 0 },
];

export const departmentHeadcount: { dept: string; count: number }[] = [];
export const monthlyHiringTrend: { month: string; hired: number }[] = [];
export const attritionTrend: { month: string; rate: number }[] = [];
