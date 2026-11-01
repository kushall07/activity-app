/** "12/04/1996" (DD/MM/YYYY, how dates are written in India) -> "1996-04-12", or null. */
export function parseIndianDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** "1996-04-12" -> "12/04/1996". */
export function formatIndianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
