// Canonical categorical values for employee records (BUG-EMP-03). Single source
// of truth so every surface — Employees list, Add/Edit forms, Bulk import,
// Reports charts — shows the same strict enum values instead of mixed casing
// ("Remote" vs "remote", "Hybrid" vs "hybrid", "intern") or placeholder junk.

export const WORK_MODES = ["Remote", "On-site", "Hybrid"] as const;
export const EMPLOYMENT_TYPES = ["Full-Time", "Intern", "Contract"] as const;

// Normalize any stored/imported Work Mode value to a strict enum value.
// WFH / work-from-home collapse to Remote; office / onsite variants to On-site.
export function canonicalWorkMode(raw: unknown): string {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "On-site";
  if (["remote", "wfh", "w.f.h", "w.f.h.", "work from home", "work-from-home", "wfh only", "remote only", "fully remote"].includes(v)) return "Remote";
  if (["on-site", "onsite", "on site", "office", "in-office", "in office", "onsite only", "in office only", "on premise", "on-premise"].includes(v)) return "On-site";
  if (["hybrid", "hybrid mode", "flexible", "flex"].includes(v)) return "Hybrid";
  // Unknown variant — Title Case it so at least the casing is consistent.
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normalize any stored/imported Employment Type value to a strict enum value.
export function canonicalEmploymentType(raw: unknown): string {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "Full-Time";
  if (["full-time", "fulltime", "full time", "permanent", "regular", "ft"].includes(v)) return "Full-Time";
  if (["intern", "interns", "internship", "trainee", "apprentice"].includes(v)) return "Intern";
  if (["contract", "contractor", "contractual", "temporary", "temp", "consultant", "freelance", "freelancer"].includes(v)) return "Contract";
  // Unknown variant — Title Case each token so at least the casing is consistent.
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normalize a Department against the canonical list (case-insensitive), so
// "technology" / "TECHNOLOGY" collapse to the configured "Technology". Values
// not in the canonical list are returned trimmed but otherwise unchanged — they
// are non-standard / placeholder data a human must reassign (see isKnownDepartment).
export function canonicalDepartment(raw: unknown, canonical: string[]): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const match = canonical.find((d) => d.trim().toLowerCase() === v.toLowerCase());
  return match ?? v;
}

// True when a department matches one of the configured/standard values.
export function isKnownDepartment(raw: unknown, canonical: string[]): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return false;
  return canonical.some((d) => d.trim().toLowerCase() === v);
}
