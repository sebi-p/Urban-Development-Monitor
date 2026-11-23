/** One CSV field: quoted, quotes doubled; a leading = + - @ is prefixed with ' so a spreadsheet
 * never runs it as a formula. */
export function csvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
