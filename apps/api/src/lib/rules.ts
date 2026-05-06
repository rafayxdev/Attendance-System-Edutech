import { env } from "../config/env.js";

export function normalizeValue(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function normalizeKey(value: string | null | undefined): string {
  return normalizeValue(value).toLowerCase();
}

export function formatDayKey(date: Date, timeZone = env.appTimezone): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

export function formatDisplayDateTime(
  date: Date,
  timeZone = env.appTimezone,
): { date: string; time: string } {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    date: dateFormatter.format(date),
    time: timeFormatter.format(date),
  };
}

/** Converts 24h wall clock "HH:mm" or "H:mm" to e.g. "9:05 AM". */
export function formatWallHm12h(hm: string): string {
  const trimmed = String(hm ?? "").trim();
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

export function timeValue(date: Date, timeZone = env.appTimezone): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  return hour * 100 + minute;
}

export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadius = 6371000;
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const deltaLat = toRad(lat2 - lat1);
  const deltaLng = toRad(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldEnforceAccessGate(): boolean {
  return env.accessGateEnforced;
}

export function allowedPrefixMatch(clientIp: string): boolean {
  return env.allowedIpPrefixes.some((prefix) => clientIp.startsWith(prefix));
}

export function imageBufferFromDataUrl(
  dataUrl: string,
): { buffer: Buffer; mimeType: string } | null {
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) return null;

  const mimeType = match[1];
  const base64 = match[2];
  if (!mimeType || !base64) return null;

  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}
