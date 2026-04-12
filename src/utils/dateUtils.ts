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
  // which causes toLocaleDateString() to display one day early in UTC- timezones.
  // Use the local-time constructor form for these to keep the displayed date correct.
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.exec(dateString);
  const date = bareDate
    ? new Date(Number(bareDate[0].slice(0, 4)), Number(bareDate[0].slice(5, 7)) - 1, Number(bareDate[0].slice(8, 10)))
    : new Date(dateString);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString();
}
