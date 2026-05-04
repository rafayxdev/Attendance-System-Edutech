/** Live clock in 12-hour form, aligned with a specific IANA time zone. */
export function formatInstant12hWithSeconds(
  date: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatInstantShortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Converts 24h wall clock "HH:mm" or "H:mm" to e.g. "9:05 AM". */
export function formatWallHm12h(hm: string): string {
  const trimmed = hm.trim();
  if (!trimmed || trimmed === "N/A") return hm;
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return hm;
  let hour = Number(match[1]);
  const minute = match[2];
  const minuteNum = Number(minute);
  if (hour > 23 || minuteNum > 59) return hm;
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${period}`;
}
