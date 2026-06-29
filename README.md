# HR Pulse — Enterprise HR Management System

Two connected Next.js dashboards powered by Firebase.

## Structure

```
hr-portal/
├── hr-dashboard/        → HR Admin dashboard (port 3000)
├── employee-dashboard/  → Employee self-service portal (port 3001)
├── firestore.rules      → Firebase security rules
└── README.md
```

## Quick Start

### 1. Setup Firebase
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Authentication** (Email/Password)
4. Enable **Firestore Database**
5. Copy your Web App config credentials

### 2. Configure Environment Variables
In both `hr-dashboard/.env.local` and `employee-dashboard/.env.local`, replace the placeholder values with your actual Firebase credentials:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_actual_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

> Both dashboards MUST use the same Firebase project to stay in sync.

### 3. Run Both Dashboards

**Terminal 1 — HR Dashboard:**
```bash
cd hr-dashboard
npm run dev
# Opens at http://localhost:3000
```

**Terminal 2 — Employee Dashboard:**
```bash
cd employee-dashboard
npm run dev -- -p 3001
# Opens at http://localhost:3001
```

## HR Dashboard Modules
| Module | Route | Description |
|--------|-------|-------------|
| Dashboard | `/dashboard` | KPI overview, charts, AI insights |
| Employee Directory | `/dashboard/employees` | Add/edit/delete employees |
| Attendance & Time | `/dashboard/attendance` | Live clock, attendance logs |
| Leave Management | `/dashboard/leave` | Approve/reject leave requests |
| Payroll | `/dashboard/payroll` | Run payroll, salary table |
| Recruitment & ATS | `/dashboard/recruitment` | Candidate pipeline |
| Performance & Goals | `/dashboard/performance` | Goals + performance reviews |
| Onboarding | `/dashboard/onboarding` | New hire checklists |
| Admin & Roles | `/dashboard/admin` | Role assignment |
| Hiring & Sourcing | `/dashboard/hiring` | Job postings, sourcing channels |

## Employee Dashboard Modules
| Module | Route | Description |
|--------|-------|-------------|
| Dashboard | `/dashboard` | Personal overview, today's status |
| My Profile | `/dashboard/profile` | View/edit personal info |
| My Attendance | `/dashboard/attendance` | Monthly attendance log |
| My Leave | `/dashboard/leave` | Apply for leave, track requests |
| My Payslip | `/dashboard/payslip` | View & download payslips |
| My Goals | `/dashboard/goals` | Track assigned goals |
| Notifications | `/dashboard/notifications` | Company announcements |

## Firebase Collections
- `employees` — Employee records
- `attendance` — Daily check-in/check-out
- `leaveRequests` — Leave applications (real-time sync)
- `candidates` — Recruitment pipeline
- `goals` — Employee goals (real-time sync)
- `payroll` — Monthly payroll records
- `notifications` — Announcements (real-time sync)
- `jobPostings` — Open positions

## Tech Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend/DB:** Firebase (Auth + Firestore + Storage)
- **Charts:** Recharts
- **Icons:** Lucide React
