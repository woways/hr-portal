export type EmployeeStatus = "Active" | "On Leave" | "Probation" | "Exited" | "Inactive";
export type WorkMode = "Remote" | "Hybrid" | "On-site";
export type EmploymentType = "Full-Time" | "Part-Time" | "Intern" | "Contract";

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  reportingManager: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  doj: string;
  status: EmployeeStatus;
  emergencyContact?: string;
  photoURL?: string;
  salary?: number;
  createdAt?: string;
}

export type AttendanceStatus = "Present" | "Absent" | "Half Day" | "Leave" | "Week Off";

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn: string;
  checkOut: string;
  workingHours: string;
  status: AttendanceStatus;
}

export type LeaveStatus = "Pending" | "Approved" | "Rejected";
export type LeaveType = "Sick Leave" | "Casual Leave" | "Annual Leave" | "Emergency Leave" | "Maternity Leave" | "Paternity Leave";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  approvedBy?: string;
  requestDate: string;
}

export type CandidateStatus = "Applied" | "Screening" | "Shortlisted" | "Interview Scheduled" | "Interview Completed" | "Selected" | "Rejected" | "Offer Released" | "Joined";

export interface Candidate {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  experience: string;
  college?: string;
  linkedIn?: string;
  source: string;
  recruiter?: string;
  status: CandidateStatus;
  resumeURL?: string;
  notes?: string;
  createdAt?: string;
}

export type GoalStatus = "Not Started" | "In Progress" | "Completed";

export interface Goal {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  goalName: string;
  description: string;
  kpi: string;
  deadline: string;
  progress: number;
  status: GoalStatus;
  feedback?: string;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  month: string;
  basic: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  paymentStatus: "Paid" | "Pending";
  paymentDate?: string;
}

export interface OnboardingRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  role: string;
  department: string;
  startDate: string;
  progress: number;
  tasks: OnboardingTask[];
}

export interface OnboardingTask {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "leave" | "attendance" | "payroll" | "announcement" | "interview";
  read: boolean;
  createdAt: string;
  targetRole?: "all" | "employee" | "hr";
}

export interface JobPosting {
  id: string;
  title: string;
  department: string;
  datePosted: string;
  status: "Published" | "Draft" | "Closed";
  applicants: number;
  description?: string;
}
