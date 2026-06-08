/**
 * Date formatting utilities with safe handling of invalid dates
 */

/**
 * Parse a date string as local time.
 *
 * Bare `YYYY-MM-DD` strings are parsed as midnight UTC by the `Date`
 * constructor, which makes them render one day early in UTC- timezones. For
 * those we build the date from local-time components instead. Well-shaped but
 * invalid bare dates (e.g. "2026-13-45") are rejected rather than silently
 * rolled forward by the constructor. Any other input falls back to the native
 * `Date` constructor.
 *
 * This is the TypeScript-side parallel to `parseLocalDate()` in
 * `lib/sharedUtils.js` (the OmniJS helper, which is not importable from TS),
 * hardened to return `null` for unparseable input so callers can fail safely.
 *
 * @param dateString - ISO date string (YYYY-MM-DD or full ISO), or null/undefined
 * @returns A local-time Date, or null if the input is missing or invalid
 */
export function parseLocalDate(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

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
    return date;
  }

  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Safely formats a date string to locale date string.
 * Returns null for invalid, null, or undefined date inputs.
 *
 * @param dateString - ISO date string, or null/undefined
 * @returns Formatted date string or null if invalid
 */
export function formatDateSafe(dateString: string | null | undefined): string | null {
  const date = parseLocalDate(dateString);
  return date ? date.toLocaleDateString() : null;
}

/**
 * Forecast bucket for a task's date relative to "now".
 */
export type ForecastDateCategory = 'OVERDUE' | 'TODAY' | 'TOMORROW' | 'FUTURE';

/**
 * Classify a forecast date key (bare `YYYY-MM-DD`) relative to a reference time.
 *
 * The key is parsed as local time (via {@link parseLocalDate}) so that "today"
 * is judged against the viewer's local day, not UTC — otherwise a date due today
 * would classify as OVERDUE for UTC- viewers. Returns null if the key cannot be
 * parsed.
 *
 * @param dateString - Forecast date key in `YYYY-MM-DD` form
 * @param now - Reference time (defaults to the current time)
 * @returns The forecast category, or null if the key is invalid
 */
export function classifyForecastDate(
  dateString: string,
  now: Date = new Date()
): ForecastDateCategory | null {
  const date = parseLocalDate(dateString);
  if (!date) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) return 'TODAY';
  if (date.getTime() === today.getTime() + 24 * 60 * 60 * 1000) return 'TOMORROW';
  if (date < today) return 'OVERDUE';
  return 'FUTURE';
}
