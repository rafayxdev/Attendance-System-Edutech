import { prisma } from "./prisma.js";

const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

export async function deleteOldAttendanceImages(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ONE_WEEK_IN_MS);
  const result = await prisma.attendanceLog.updateMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ imageData: { not: null } }, { imageMimeType: { not: null } }],
    },
    data: {
      imageData: null,
      imageMimeType: null,
      imageFileName: null,
      imageSize: null,
    },
  });

  return result.count;
}
