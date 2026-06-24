import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

export type DayOverrideUpsertRow = {
  userId: string;
  overrideDate: string;
  startTime: string;
  endTime: string;
};

const CHUNK_SIZE = 200;

function generateRowId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(10).toString("hex");
  return `c${time}${rand}`.slice(0, 25);
}

export function expandOverrideRowsForRange(params: {
  dates: string[];
  entries: Array<{
    userId: string;
    startTime: string;
    endTime: string;
  }>;
}): DayOverrideUpsertRow[] {
  const rows: DayOverrideUpsertRow[] = [];
  for (const overrideDate of params.dates) {
    for (const entry of params.entries) {
      rows.push({
        userId: entry.userId,
        overrideDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
      });
    }
  }
  return rows;
}

/**
 * Bulk upsert without an interactive Prisma transaction.
 * Each chunk is a single INSERT … ON CONFLICT statement, which works reliably
 * with PgBouncer/pooler connections (avoids P2028 transaction timeouts).
 */
export async function bulkUpsertDayScheduleOverrides(
  rows: DayOverrideUpsertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  let written = 0;

  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    const params: string[] = [];
    const tuples: string[] = [];

    chunk.forEach((row, index) => {
      const base = index * 5;
      tuples.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, NOW(), NOW())`,
      );
      params.push(
        generateRowId(),
        row.userId,
        row.overrideDate,
        row.startTime,
        row.endTime,
      );
    });

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "DayScheduleOverride" (
        "id", "userId", "overrideDate", "startTime", "endTime", "createdAt", "updatedAt"
      )
      VALUES ${tuples.join(", ")}
      ON CONFLICT ("userId", "overrideDate")
      DO UPDATE SET
        "startTime" = EXCLUDED."startTime",
        "endTime" = EXCLUDED."endTime",
        "updatedAt" = NOW()
      `,
      ...params,
    );

    written += chunk.length;
  }

  return written;
}
