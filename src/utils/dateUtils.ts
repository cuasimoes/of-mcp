/**
 * Date formatting utilities with safe handling of invalid dates
 */

/**
 * Safely formats a date string to locale date string.
 * Returns null for invalid, null, or undefined date inputs.
 *
 * @param dateString - ISO date string, or null/undefined
 * @returns Formatted date string or null if invalid
 */
export function formatDateSafe(dateString: string | null | undefined): string | null {
  if (!dateString) return null;

  // Bare YYYY-MM-DD strings are parsed as UTC midnight by the Date constructor,
  // which makes toLocaleDateString() display one day early in UTC- timezones.
  // Use the local-time constructor for these so the displayed date stays correct.
  const bareDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (bareDate) {
    const [, y, m, d] = bareDate.map(Number);
    const date = new Date(y, m - 1, d);
    // new Date(y, m-1, d) silently rolls overflow forward (month 13 -> next year,
    // day 45 -> next month), so a well-shaped but invalid string like "2026-13-45"
    // would yield a bogus date that isNaN can't catch. Reject anything that doesn't
    // round-trip, matching the old new Date("2026-13-45") -> null behaviour.
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
      return null;
    }
    return date.toLocaleDateString();
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString();
}
