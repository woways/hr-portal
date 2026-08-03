// Validate a job-title / role / designation string (BUG-REC-03).
// Accepts plausible titles — letters plus spaces and common title punctuation,
// and short all-caps acronyms (HR, IT, QA, R&D, CEO). Rejects pure-numeric
// values (e.g. 12345) and placeholder gibberish (e.g. www, frr, ee) by requiring
// a real word: either a recognised short acronym, or a mix of vowels + consonants.
export function isValidJobTitle(raw: string): boolean {
  const t = (raw ?? "").trim();
  if (t.length < 2) return false;                                   // too short
  if (!/[a-zA-Z]/.test(t)) return false;                            // must contain letters
  if (/^[\d\s]+$/.test(t)) return false;                            // pure numeric / spaces
  if (!/^[a-zA-Z0-9 /&.()+#,'’-]+$/.test(t)) return false;          // allowed character set
  // Short all-caps abbreviations are valid job/dept titles (HR, IT, QA, R&D, CEO).
  if (/^[A-Z][A-Z&.]{1,5}$/.test(t)) return true;
  // Otherwise a real title/word contains at least one vowel AND one consonant,
  // which rejects consonant-only ("www","frr") and vowel-only ("ee") placeholders.
  const hasVowel = /[aeiou]/i.test(t);
  const hasConsonant = /[b-df-hj-np-tv-z]/i.test(t);
  return hasVowel && hasConsonant;
}
