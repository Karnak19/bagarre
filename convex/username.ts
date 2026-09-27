// Username rules, shared by the Convex functions and the client form.
// (No Convex functions in this file, it's a plain helper module.)

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;

/** Returns an error message, or null when the name is acceptable. */
export function usernameError(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(name)) return "Only letters, digits and _.";
  // "Guest-1234" can't be typed (no dash), but keep the prefix off-limits anyway
  // so an account never looks like a guest.
  if (/^guest/i.test(name)) return "Names starting with \"guest\" are reserved.";
  return null;
}

export const usernameKey = (name: string) => name.toLowerCase();
