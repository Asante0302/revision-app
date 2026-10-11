export function jourLocal(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const jourEnMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export function joursEntre(a, b) { return Math.round((jourEnMs(b) - jourEnMs(a)) / 86400000); }
export function ajouterJours(iso, n) { return new Date(jourEnMs(iso) + n * 86400000).toISOString().slice(0, 10); }
