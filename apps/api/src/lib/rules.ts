import { env } from "../config/env.js";

const lateCutoffs: Record<string, number> = {
  employee: 915,
  faculty: 915,
  "faculty member": 915,
  "visiting faculty": 915,
  "human resource": 915,
  internee: 945,
};

const restrictedCheckoutRoles = new Set([
  "internee",
  "employee",
  "faculty",
  "faculty member",
  "visiting faculty",
  "human resource",
]);

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
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    date: dateFormatter.format(date),
    time: timeFormatter.format(date),
  };
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

export function getLateStatus(
  role: string,
  attendanceType: string,
  timestamp: Date,
): "Late" | "On Time" {
  if (attendanceType !== "Time In") return "On Time";
  const cutoff = lateCutoffs[normalizeKey(role)];
  if (!cutoff) return "On Time";
  return timeValue(timestamp) > cutoff ? "Late" : "On Time";
}

export function canTimeOut(role: string, timestamp: Date): boolean {
  if (!restrictedCheckoutRoles.has(normalizeKey(role))) return true;
  return timeValue(timestamp) >= 1430;
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
