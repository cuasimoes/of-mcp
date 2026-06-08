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
 * NOTE: the OmniJS twin is NOT yet hardened (it rolls invalid dates forward and
 * would throw on null) — keep the two in sync when changing parsing rules; #133
 * tracks making the OmniJS side testable and hardened.
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
    // new Date(0..99, ...) maps to years 1900..1999; force the literal year so
    // dates in years 0-99 round-trip instead of being rejected by the guard below.
    if (y < 100) date.setFullYear(y);
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
 * Classify a (local-time) date relative to a reference time, by calendar day.
 *
 * Both `date` and `now` are reduced to their local calendar day before
 * comparison, so a task due today classifies as TODAY for the viewer's local day
 * regardless of timezone. TOMORROW uses calendar arithmetic (not a fixed +24h) so
 * it stays correct across DST transitions, where a local day is 23h or 25h long.
 * Parse bare `YYYY-MM-DD` keys with {@link parseLocalDate} (as the callers do) so
 * they land on local midnight.
 *
 * @param date - The date to classify (only its local calendar day matters)
 * @param now - Reference time (defaults to the current time)
 * @returns The forecast category
 */
export function classifyForecastDate(
  date: Date,
  now: Date = new Date()
): ForecastDateCategory {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1); // calendar arithmetic — DST-safe, unlike +24h

  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  if (day.getTime() === today.getTime()) return 'TODAY';
  if (day.getTime() === tomorrow.getTime()) return 'TOMORROW';
  if (day < today) return 'OVERDUE';
  return 'FUTURE';
}
