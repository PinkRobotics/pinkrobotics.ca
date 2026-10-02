/* America/Vancouver dates, the one clock-adjacent thing the guard needs.
 *
 * The no-fleet window and every status day are Vancouver calendar dates, and the browser
 * may be anywhere, so "what day is this view" is never the visitor's local date. The
 * conversion itself is environment work (Intl with a named zone), which is why it lives in
 * app/ and not in sim/guard.js: the model takes dates as strings and stays clock-free.
 */

/** An instant's calendar date in America/Vancouver, as YYYY-MM-DD. */
export function vancouverDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/** An instant as Vancouver local time, "H:MM on 8 August 2026", for the record sentences. */
export function vancouverClock(ms) {
  const t = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(ms));
  return `${t} on ${d}`;
}
