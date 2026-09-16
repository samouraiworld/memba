/**
 * CSV cell encoding shared by client-side exports.
 *
 * Exported files are opened in spreadsheet applications, which evaluate a cell
 * whose text starts with "=", "+", "-" or "@" (and, in some, a leading tab or
 * carriage return) as a formula. Text that comes from on-chain or user input
 * is therefore prefixed with a single quote so it is shown as plain text, and
 * every cell is wrapped in double quotes (embedded quotes doubled) so commas
 * and newlines stay inside the cell.
 */

const FORMULA_LEADING = /^[=+\-@\t\r]/

/** Encode one text value as a quoted, formula-neutralized CSV cell. */
export function csvCell(value: string): string {
    const text = FORMULA_LEADING.test(value) ? `'${value}` : value
    return `"${text.replace(/"/g, '""')}"`
}
