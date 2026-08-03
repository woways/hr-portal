// Standardized Incentive Type ENUM + Performance Basis validation (BUG-PAY-01).
// Incentive Type is chosen from a fixed dropdown so it can never be saved as a
// bare number ("899") or a single character ("c"); Performance Basis must be a
// meaningful justification, not placeholder junk ("bb") or blank.

export const INCENTIVE_TYPES = [
  "Sales Commission",
  "Performance Bonus",
  "Referral Bonus",
  "Retention Bonus",
  "Project Completion Bonus",
  "Spot Award",
  "Festival Bonus",
  "Overtime Incentive",
  "Other",
] as const;

export type IncentiveType = typeof INCENTIVE_TYPES[number];

// True when the value is one of the standardized incentive types.
export function isValidIncentiveType(raw: string): boolean {
  return (INCENTIVE_TYPES as readonly string[]).includes((raw ?? "").trim());
}

// Performance Basis must read as a real justification. Rejects: blank, too short,
// pure numeric/punctuation ("899"), single chars ("c"), and gibberish with no real
// word (needs both a vowel and a consonant, and can't be one repeated letter "bb").
export function isValidPerformanceBasis(raw: string): boolean {
  const t = (raw ?? "").trim();
  if (t.length < 5) return false;                       // too short to be meaningful
  if (/^[\d\s.,_\-/]+$/.test(t)) return false;          // pure numeric / punctuation
  const hasVowel = /[aeiou]/i.test(t);
  const hasConsonant = /[b-df-hj-np-tv-z]/i.test(t);
  if (!hasVowel || !hasConsonant) return false;         // needs real letters/words
  const letters = t.replace(/[^a-z]/gi, "");
  if (letters.length >= 2 && /^(.)\1+$/i.test(letters)) return false; // "bbbb"
  return true;
}
