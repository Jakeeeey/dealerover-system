/**
 * Client-side date helpers for the Leaderboard module.
 *
 * Date ranges are always expressed as plain `YYYY-MM-DD` strings in Asia/Manila
 * (PHT) so they line up with the raw date strings stored by each dealer's
 * Directus — the same convention the API route uses for its default range.
 */

/** Formats a `Date` as `YYYY-MM-DD` in Philippine time. */
function toPhtDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

/**
 * The default leaderboard window: the last 30 days, in Philippine time.
 * @returns {{ from: string; to: string }} Inclusive `YYYY-MM-DD` bounds.
 */
export function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = toPhtDateString(now);
  const past = new Date(now);
  past.setDate(past.getDate() - 30);
  return { from: toPhtDateString(past), to };
}

/**
 * Renders a stored `YYYY-MM-DD` (or ISO) string as `MMM d, yyyy`.
 * @param {string} dateStr - Raw date string from the API.
 * @returns {string} Human display date, or the input unchanged if unparseable.
 */
export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const pureDate = dateStr.split("T")[0];
  const [yearStr, monthStr, dayStr] = pureDate.split("-");
  if (!yearStr || !monthStr || !dayStr) return dateStr;
  const d = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
