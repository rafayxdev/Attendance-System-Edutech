import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { formatDayKey, formatWallHm12h } from "./rules.js";

export type ScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri";
export type DaySlot = { startTime: string; endTime: string };
export type WeeklyScheduleEntry = { day: ScheduleDay; startTime: string; endTime: string };

export const scheduleAuditAction = "USER_ATTENDANCE_SCHEDULE";
export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseAttendanceSchedule(
  value: unknown,
): WeeklyScheduleEntry[] {
  if (!Array.isArray(value)) return [];
  const validDays = new Set<ScheduleDay>(["mon", "tue", "wed", "thu", "fri"]);
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => ({
      day: String(row.day || "").toLowerCase() as ScheduleDay,
      startTime: String(row.startTime || ""),
      endTime: String(row.endTime || ""),
    }))
    .filter(
      (row) =>
        validDays.has(row.day) &&
        TIME_REGEX.test(row.startTime) &&
        TIME_REGEX.test(row.endTime),
    );
}

export async function getWeeklyScheduleByEmail(
  email: string,
): Promise<WeeklyScheduleEntry[]> {
  const logs = await prisma.auditLog.findMany({
    where: { action: scheduleAuditAction },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const emailKey = email.trim().toLowerCase();
  const latest = logs
    .map((log) => log.payload)
    .map((payload) => {
      if (!payload || typeof payload !== "object") return null;
      const row = payload as Record<string, unknown>;
      if (typeof row.email !== "string") return null;
      return {
        email: row.email.trim().toLowerCase(),
        schedule: parseAttendanceSchedule(row.schedule),
      };
    })
    .find((entry) => entry?.email === emailKey);
  return latest?.schedule ?? [];
}

export async function getDayScheduleOverride(
  userId: string,
  dayKey: string,
): Promise<DaySlot | null> {
  const row = await prisma.dayScheduleOverride.findUnique({
    where: {
      userId_overrideDate: {
        userId,
        overrideDate: dayKey,
      },
    },
    select: { startTime: true, endTime: true },
  });
  if (!row) return null;
  return { startTime: row.startTime, endTime: row.endTime };
}

export function getWeekdayKey(date: Date, timeZone: string): string {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  })
    .format(date)
    .toLowerCase();
  if (label.startsWith("mon")) return "mon";
  if (label.startsWith("tue")) return "tue";
  if (label.startsWith("wed")) return "wed";
  if (label.startsWith("thu")) return "thu";
  if (label.startsWith("fri")) return "fri";
  if (label.startsWith("sat")) return "sat";
  return "sun";
}

export function toMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  const hour = parts[0] ?? 0;
  const minute = parts[1] ?? 0;
  return hour * 60 + minute;
}

export function hhmmFromDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function hasInvalidTimeRange(startTime: string, endTime: string): boolean {
  return toMinutes(startTime) >= toMinutes(endTime);
}

export type EffectiveDaySchedule = {
  slot: DaySlot | null;
  source: "override" | "weekly" | "none";
  weeklySchedule: WeeklyScheduleEntry[];
  overrideActive: boolean;
};

export async function getEffectiveDaySchedule(params: {
  userId: string;
  email: string;
  now?: Date;
  dayKey?: string;
}): Promise<EffectiveDaySchedule> {
  const now = params.now ?? new Date();
  const dayKey = params.dayKey ?? formatDayKey(now);
  const weeklySchedule = await getWeeklyScheduleByEmail(params.email);
  const override = await getDayScheduleOverride(params.userId, dayKey);

  if (override) {
    return {
      slot: override,
      source: "override",
      weeklySchedule,
      overrideActive: true,
    };
  }

  const weekday = getWeekdayKey(now, env.appTimezone);
  if (!["mon", "tue", "wed", "thu", "fri"].includes(weekday)) {
    return {
      slot: null,
      source: "none",
      weeklySchedule,
      overrideActive: false,
    };
  }

  const todaySlot =
    weeklySchedule.find((row) => row.day === weekday) ?? null;
  if (!todaySlot) {
    return {
      slot: null,
      source: "none",
      weeklySchedule,
      overrideActive: false,
    };
  }

  return {
    slot: { startTime: todaySlot.startTime, endTime: todaySlot.endTime },
    source: "weekly",
    weeklySchedule,
    overrideActive: false,
  };
}

export function evaluateScheduleWindowForSlot(params: {
  slot: DaySlot;
  type: "Time In" | "Time Out";
  now: Date;
}): { allowed: boolean; status: "On Time" | "Late"; message: string | null } {
  const nowMinutes = toMinutes(hhmmFromDate(params.now, env.appTimezone));
  const startMinutes = toMinutes(params.slot.startTime);
  const endMinutes = toMinutes(params.slot.endTime);

  if (params.type === "Time In") {
    const earliestMinutes = Math.max(0, startMinutes - 60);
    if (nowMinutes < earliestMinutes) {
      return {
        allowed: false,
        status: "On Time",
        message: `Time In starts at ${formatWallHm12h(params.slot.startTime)}.`,
      };
    }
    if (nowMinutes > endMinutes) {
      return {
        allowed: false,
        status: "Late",
        message: `Time In closed at ${formatWallHm12h(params.slot.endTime)}.`,
      };
    }
    return {
      allowed: true,
      status: nowMinutes > startMinutes + 15 ? "Late" : "On Time",
      message: null,
    };
  }

  if (nowMinutes < endMinutes) {
    return {
      allowed: false,
      status: "On Time",
      message: `Time Out is after ${formatWallHm12h(params.slot.endTime)}.`,
    };
  }
  if (nowMinutes > endMinutes + 60) {
    return {
      allowed: false,
      status: "On Time",
      message: `Time Out closed 1 hour after ${formatWallHm12h(params.slot.endTime)}.`,
    };
  }
  return { allowed: true, status: "On Time", message: null };
}

export function evaluateDayScheduleForEffective(params: {
  effective: EffectiveDaySchedule;
  now: Date;
}): {
  dayOk: boolean;
  slot: DaySlot | null;
  nowMinutes: number;
  startMinutes: number | null;
  endMinutes: number | null;
  messageIfInvalid: string | null;
} {
  const nowMinutes = toMinutes(hhmmFromDate(params.now, env.appTimezone));

  if (params.effective.overrideActive && params.effective.slot) {
    const startMinutes = toMinutes(params.effective.slot.startTime);
    const endMinutes = toMinutes(params.effective.slot.endTime);
    return {
      dayOk: true,
      slot: params.effective.slot,
      nowMinutes,
      startMinutes,
      endMinutes,
      messageIfInvalid: null,
    };
  }

  const weekday = getWeekdayKey(params.now, env.appTimezone);
  if (!["mon", "tue", "wed", "thu", "fri"].includes(weekday)) {
    return {
      dayOk: false,
      slot: null,
      nowMinutes,
      startMinutes: null,
      endMinutes: null,
      messageIfInvalid: "Attendance is only available Monday to Friday.",
    };
  }

  if (!params.effective.slot) {
    return {
      dayOk: false,
      slot: null,
      nowMinutes,
      startMinutes: null,
      endMinutes: null,
      messageIfInvalid:
        params.effective.weeklySchedule.length === 0
          ? "Your attendance schedule is not configured. Please contact admin."
          : "Attendance is not configured for today. Please contact admin.",
    };
  }

  const startMinutes = toMinutes(params.effective.slot.startTime);
  const endMinutes = toMinutes(params.effective.slot.endTime);
  return {
    dayOk: true,
    slot: params.effective.slot,
    nowMinutes,
    startMinutes,
    endMinutes,
    messageIfInvalid: null,
  };
}

export function evaluateScheduleWindowForEffective(params: {
  effective: EffectiveDaySchedule;
  type: "Time In" | "Time Out";
  now: Date;
}): { allowed: boolean; status: "On Time" | "Late"; message: string | null } {
  const evalDay = evaluateDayScheduleForEffective({
    effective: params.effective,
    now: params.now,
  });

  if (!evalDay.dayOk || !evalDay.slot) {
    return {
      allowed: false,
      status: "On Time",
      message: evalDay.messageIfInvalid ?? "Not allowed.",
    };
  }

  return evaluateScheduleWindowForSlot({
    slot: evalDay.slot,
    type: params.type,
    now: params.now,
  });
}
