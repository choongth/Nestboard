// How dates read everywhere in the app: day, month, year ("04 Sep 2025").
// Month names are spelled out here rather than taken from Intl, whose English
// short months differ between browsers ("Sep" vs "Sept").

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "27 Oct 2026", in the viewer's time zone. */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "27 Oct 2026, 10:15 AM", in the viewer's time zone. */
export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const hours = d.getHours() % 12 || 12;
  return `${formatDate(d)}, ${hours}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
