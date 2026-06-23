/**
 * Rebuilds dynamic monthly_attendance_YYYY_MM tables from AttendanceLog.
 * Safe to re-run after accidental table drops (e.g. prisma db push drift).
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma.js";
import { formatDayKey } from "../src/lib/rules.js";
import { env } from "../src/config/env.js";

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
]) {
  loadEnv({ path: envPath, override: true });
}

const scheduleAuditAction = "USER_ATTENDANCE_SCHEDULE";

type ScheduleDay = "mon" | "tue" | "wed" | "thu" | "fri";

type AttendanceDayState = {
  hasTimeIn: boolean;
  hasTimeOut: boolean;
  timeInLate: boolean;
  manualStatus: "Present" | "Absent" | "Late" | null;
};

function weekdayKey(
  date: Date,
  timeZone: string,
): ScheduleDay | "sat" | "sun" {
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone })
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

function parseMonthParam(value: string): {
  year: number;
  month: number;
  label: string;
} | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month, label: `${match[1]}-${match[2]}` };
}

function listMonthDayKeys(params: {
  year: number;
  month: number;
  timeZone: string;
}): Array<{ dayKey: string; weekday: ReturnType<typeof weekdayKey> }> {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(params.year, params.month, 1, 0, 0, 0));
  const days: Array<{ dayKey: string; weekday: ReturnType<typeof weekdayKey> }> =
    [];
  for (
    let d = new Date(start);
    d < endExclusive;
    d = new Date(d.getTime() + 86400000)
  ) {
    days.push({ dayKey: formatDayKey(d), weekday: weekdayKey(d, params.timeZone) });
  }
  return days;
}

function monthlyTableName(monthLabel: string): string {
  return `monthly_attendance_${monthLabel.replace("-", "_")}`;
}

async function ensureMonthlyAttendanceTable(monthLabel: string) {
  const table = monthlyTableName(monthLabel);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      unique_id TEXT,
      total_weekdays INTEGER NOT NULL DEFAULT 0,
      present_days INTEGER NOT NULL DEFAULT 0,
      late_days INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function parseSchedulePayload(payload: unknown): {
  email: string;
  schedule: Array<{ day: ScheduleDay; startTime: string; endTime: string }>;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.email !== "string" || !Array.isArray(row.schedule)) return null;
  const validDays = new Set<ScheduleDay>(["mon", "tue", "wed", "thu", "fri"]);
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const schedule = row.schedule
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      day: String(item.day || "").toLowerCase() as ScheduleDay,
      startTime: String(item.startTime || ""),
      endTime: String(item.endTime || ""),
    }))
    .filter(
      (item) =>
        validDays.has(item.day) &&
        timeRegex.test(item.startTime) &&
        timeRegex.test(item.endTime),
    );
  return { email: row.email.trim().toLowerCase(), schedule };
}

function applyAttendanceLogToDayState(
  state: AttendanceDayState,
  log: { attendanceType: string; status: string },
): AttendanceDayState {
  if (log.attendanceType === "Manual Attendance") {
    return {
      hasTimeIn: false,
      hasTimeOut: false,
      timeInLate: false,
      manualStatus:
        log.status === "Present" || log.status === "Late"
          ? log.status
          : "Absent",
    };
  }
  if (state.manualStatus) return state;
  if (log.attendanceType === "Time In") {
    return {
      ...state,
      hasTimeIn: true,
      timeInLate: state.timeInLate || log.status === "Late",
    };
  }
  if (log.attendanceType === "Time Out") {
    return { ...state, hasTimeOut: true };
  }
  return state;
}

function dayCountsAsPresent(state: AttendanceDayState): boolean {
  if (state.manualStatus === "Present" || state.manualStatus === "Late") {
    return true;
  }
  if (state.manualStatus === "Absent") return false;
  return state.hasTimeIn && state.hasTimeOut;
}

function dayCountsAsLate(state: AttendanceDayState): boolean {
  if (state.manualStatus === "Late") return true;
  if (state.manualStatus) return false;
  return state.hasTimeIn && state.hasTimeOut && state.timeInLate;
}

async function rebuildUserMonth(params: {
  monthLabel: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    uniqueId: string | null;
  };
  scheduleByEmail: Map<
    string,
    Array<{ day: ScheduleDay; startTime: string; endTime: string }>
  >;
}) {
  const month = parseMonthParam(params.monthLabel);
  if (!month) return;

  const schedule =
    params.scheduleByEmail.get(params.user.email.trim().toLowerCase()) ?? [];
  const scheduleDays = new Set(
    (schedule.length > 0
      ? schedule
      : [
          { day: "mon" as const, startTime: "09:00", endTime: "17:00" },
          { day: "tue" as const, startTime: "09:00", endTime: "17:00" },
          { day: "wed" as const, startTime: "09:00", endTime: "17:00" },
          { day: "thu" as const, startTime: "09:00", endTime: "17:00" },
          { day: "fri" as const, startTime: "09:00", endTime: "17:00" },
        ]
    ).map((s) => s.day),
  );

  const totalWeekdays = listMonthDayKeys({
    year: month.year,
    month: month.month,
    timeZone: env.appTimezone,
  }).filter((day) => scheduleDays.has(day.weekday as ScheduleDay)).length;

  const monthStart = `${params.monthLabel}-01`;
  const monthEndExclusive = formatDayKey(
    new Date(Date.UTC(month.year, month.month, 1, 0, 0, 0)),
  );

  const monthLogs = await prisma.attendanceLog.findMany({
    where: {
      userId: params.user.id,
      attendanceType: { in: ["Time In", "Time Out", "Manual Attendance"] },
      attendanceDay: { gte: monthStart, lt: monthEndExclusive },
    },
    select: { attendanceDay: true, attendanceType: true, status: true },
  });

  const byDay = new Map<string, AttendanceDayState>();
  for (const log of monthLogs) {
    const existing = byDay.get(log.attendanceDay) ?? {
      hasTimeIn: false,
      hasTimeOut: false,
      timeInLate: false,
      manualStatus: null,
    };
    byDay.set(
      log.attendanceDay,
      applyAttendanceLogToDayState(existing, {
        attendanceType: log.attendanceType,
        status: log.status,
      }),
    );
  }

  const summaryDays = Array.from(byDay.values()).filter(dayCountsAsPresent);
  const presentDays = summaryDays.length;
  const lateDays = summaryDays.filter(dayCountsAsLate).length;
  const table = monthlyTableName(params.monthLabel);

  if (presentDays <= 0) return;

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "${table}" (user_id, email, full_name, role, unique_id, total_weekdays, present_days, late_days, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      unique_id = EXCLUDED.unique_id,
      total_weekdays = EXCLUDED.total_weekdays,
      present_days = EXCLUDED.present_days,
      late_days = EXCLUDED.late_days,
      updated_at = NOW();
    `,
    params.user.id,
    params.user.email,
    params.user.fullName,
    params.user.role,
    params.user.uniqueId,
    totalWeekdays,
    presentDays,
    lateDays,
  );
}

async function main() {
  const dayRows = await prisma.attendanceLog.findMany({
    where: { userId: { not: null } },
    select: { attendanceDay: true },
    distinct: ["attendanceDay"],
  });

  const monthLabels = [
    ...new Set(
      dayRows
        .map((row) => row.attendanceDay.match(/^(\d{4}-\d{2})-\d{2}$/)?.[1])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  if (monthLabels.length === 0) {
    console.log("No attendance months found to rebuild.");
    return;
  }

  console.log(`Rebuilding monthly tables for: ${monthLabels.join(", ")}`);

  for (const monthLabel of monthLabels) {
    await ensureMonthlyAttendanceTable(monthLabel);
    console.log(`  Created/verified table: ${monthlyTableName(monthLabel)}`);
  }

  const scheduleLogs = await prisma.auditLog.findMany({
    where: { action: scheduleAuditAction },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
    take: 5000,
  });
  const scheduleByEmail = new Map<
    string,
    Array<{ day: ScheduleDay; startTime: string; endTime: string }>
  >();
  for (const log of scheduleLogs) {
    const payload = parseSchedulePayload(log.payload);
    if (!payload) continue;
    if (!scheduleByEmail.has(payload.email)) {
      scheduleByEmail.set(payload.email, payload.schedule);
    }
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      uniqueId: true,
    },
  });

  let rebuilt = 0;
  for (const monthLabel of monthLabels) {
    for (const user of users) {
      await rebuildUserMonth({ monthLabel, user, scheduleByEmail });
      rebuilt += 1;
    }
  }

  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'monthly_attendance_%' ORDER BY tablename`,
  );

  console.log(`Processed ${rebuilt} user-month combinations.`);
  console.log("Monthly tables now in database:");
  for (const row of tables) {
    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${row.tablename}"`,
    );
    console.log(`  ${row.tablename}: ${countRows[0]?.count ?? 0} rows`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
