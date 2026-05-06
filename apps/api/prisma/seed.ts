import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

async function main() {
  await prisma.accessPolicy.upsert({
    where: { environmentName: env.accessProfile },
    update: {
      allowedIpPrefixes: env.allowedIpPrefixes.join(","),
      campusLat: env.campusLat,
      campusLng: env.campusLng,
      radiusMeters: env.campusRadiusMeters,
      enforceGate: env.accessGateEnforced,
    },
    create: {
      environmentName: env.accessProfile,
      allowedIpPrefixes: env.allowedIpPrefixes.join(","),
      campusLat: env.campusLat,
      campusLng: env.campusLng,
      radiusMeters: env.campusRadiusMeters,
      enforceGate: env.accessGateEnforced,
    },
  });

  console.log("Seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
