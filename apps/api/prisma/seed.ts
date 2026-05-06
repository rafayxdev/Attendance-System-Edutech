import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

async function main() {
  if (!env.allowDemoSeed) {
    console.log("Demo seed disabled.");
    return;
  }

  const adminPassword = await bcrypt.hash(env.demoAdminPassword, 10);

  await prisma.user.upsert({
    where: { email: env.demoAdminEmail.toLowerCase() },
    update: {
      passwordHash: adminPassword,
      role: "admin",
      fullName: "EduTech Admin",
      uniqueId: "ADMIN-001",
      isActive: true,
    },
    create: {
      email: env.demoAdminEmail.toLowerCase(),
      passwordHash: adminPassword,
      role: "admin",
      fullName: "EduTech Admin",
      uniqueId: "ADMIN-001",
      isActive: true,
    },
  });

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

  console.log("Demo seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
