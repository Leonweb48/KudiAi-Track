// Returns the ISO date string for "exactly 18 years ago today"
// Use as max= on date inputs so pickers block under-18 dates
export function maxDobDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().split("T")[0];
}

// Returns true if the DOB string represents someone ≥18 years old.
// Null/empty returns true (field is optional).
// Edge cases: turning 18 exactly today passes; leap-year Feb 29 handled correctly.
export function isAtLeast18(dob) {
  if (!dob) return true;
  const birth = new Date(dob + "T00:00:00");
  if (isNaN(birth.getTime())) return false;
  const today  = new Date();
  const cutoff = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  return birth <= cutoff;
}

export const AGE_ERROR = "You must be at least 18 years old to use KudiAI Track.";
