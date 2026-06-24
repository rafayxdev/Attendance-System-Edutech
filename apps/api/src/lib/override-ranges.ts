export const RANGE_OVERRIDE_AUDIT_ACTION = "DAY_SCHEDULE_OVERRIDE_RANGE_SAVED";

export type OverrideRowShape = {
  id: string;
  userId: string;
  overrideDate: string;
  startTime: string;
  endTime: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
};

export type OverrideRangeGroup = {
  rangeKey: string;
  userId: string;
  fullName: string;
  email: string;
  role: string;
  uniqueId: string;
  rangeStart: string;
  rangeEnd: string;
  source: "saved" | "inferred";
  overrides: OverrideRowShape[];
};

function parseDateOnly(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

function diffDays(start: string, end: string): number {
  const ms = parseDateOnly(end).getTime() - parseDateOnly(start).getTime();
  return Math.round(ms / 86400000);
}

function rangeKey(userId: string, rangeStart: string, rangeEnd: string): string {
  return `${userId}:${rangeStart}:${rangeEnd}`;
}

function isDateWithinRange(
  date: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return date >= rangeStart && date <= rangeEnd;
}

export function enumerateDatesInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseDateOnly(start);
  const last = parseDateOnly(end);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  if (cursor > last) return dates;

  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function inferConsecutiveRanges(
  overrides: OverrideRowShape[],
): Array<{ userId: string; rangeStart: string; rangeEnd: string }> {
  const byUser = new Map<string, OverrideRowShape[]>();
  for (const row of overrides) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  const ranges: Array<{ userId: string; rangeStart: string; rangeEnd: string }> =
    [];

  for (const [userId, rows] of byUser) {
    const sorted = [...rows].sort((a, b) =>
      a.overrideDate.localeCompare(b.overrideDate),
    );
    if (sorted.length < 2) continue;

    let blockStart = sorted[0]?.overrideDate ?? "";
    let blockPrev = blockStart;

    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index]?.overrideDate ?? "";
      if (!blockStart || !blockPrev || !current) continue;

      if (diffDays(blockPrev, current) === 1) {
        blockPrev = current;
        continue;
      }

      if (diffDays(blockStart, blockPrev) >= 1) {
        ranges.push({
          userId,
          rangeStart: blockStart,
          rangeEnd: blockPrev,
        });
      }
      blockStart = current;
      blockPrev = current;
    }

    if (blockStart && blockPrev && diffDays(blockStart, blockPrev) >= 1) {
      ranges.push({ userId, rangeStart: blockStart, rangeEnd: blockPrev });
    }
  }

  return ranges;
}

type AuditRangePayload = {
  rangeStart?: string;
  rangeEnd?: string;
  userIds?: string[];
};

export function buildOverrideRangeGroups(params: {
  overrides: OverrideRowShape[];
  auditPayloads: AuditRangePayload[];
}): OverrideRangeGroup[] {
  const { overrides, auditPayloads } = params;
  const seen = new Set<string>();
  const groups: OverrideRangeGroup[] = [];

  const userById = new Map<string, OverrideRowShape>();
  for (const row of overrides) {
    userById.set(row.userId, row);
  }

  function pushGroup(
    userId: string,
    rangeStart: string,
    rangeEnd: string,
    source: "saved" | "inferred",
  ) {
    const key = rangeKey(userId, rangeStart, rangeEnd);
    if (seen.has(key)) return;
    seen.add(key);

    const sample = userById.get(userId);
    const rows = overrides
      .filter(
        (row) =>
          row.userId === userId &&
          isDateWithinRange(row.overrideDate, rangeStart, rangeEnd),
      )
      .sort((a, b) => a.overrideDate.localeCompare(b.overrideDate));

    if (rows.length < 2) return;

    groups.push({
      rangeKey: key,
      userId,
      fullName: sample?.fullName ?? "Unknown user",
      email: sample?.email ?? "",
      role: sample?.role ?? "",
      uniqueId: sample?.uniqueId ?? "N/A",
      rangeStart,
      rangeEnd,
      source,
      overrides: rows,
    });
  }

  for (const payload of auditPayloads) {
    const rangeStart = String(payload.rangeStart ?? "").trim();
    const rangeEnd = String(payload.rangeEnd ?? "").trim();
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) continue;
    for (const userId of payload.userIds ?? []) {
      pushGroup(userId, rangeStart, rangeEnd, "saved");
    }
  }

  for (const inferred of inferConsecutiveRanges(overrides)) {
    pushGroup(
      inferred.userId,
      inferred.rangeStart,
      inferred.rangeEnd,
      "inferred",
    );
  }

  return groups.sort((a, b) => {
    const byName = a.fullName.localeCompare(b.fullName);
    if (byName !== 0) return byName;
    return b.rangeStart.localeCompare(a.rangeStart);
  });
}
