/**
 * newsDate — the long calendar date News shows for a `YYYY-MM-DD` value
 * (articles, changelog groups), shared by the classic pages and the Memba OS
 * News window.
 *
 * @module lib/newsDate
 */

/** "July 8, 2026". Parsed as local midnight, so the day never shifts with the viewer's timezone. */
export function formatNewsDate(date: string): string {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
    })
}
