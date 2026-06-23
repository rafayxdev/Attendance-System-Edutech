import { prisma } from "./prisma.js";

export function monthlyTableName(monthLabel: string): string {
  return `monthly_attendance_${monthLabel.replace("-", "_")}`;
}

export function parseMonthFromDayKey(dayKey: string): { label: string } | null {
  const match = String(dayKey)
    .trim()
    .match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return { label: `${match[1]}-${match[2]}` };
}

export async function monthlyTableExists(monthLabel: string): Promise<boolean> {
  const table = monthlyTableName(monthLabel);
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1
    ) AS exists;
    `,
    table,
  );
  return Boolean(rows[0]?.exists);
}

export async function ensureMonthlyAttendanceTable(monthLabel: string) {
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
