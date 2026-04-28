import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("Admin@12345", 10);

  await prisma.user.upsert({
    where: { email: "admin@edutech.com" },
    update: {
      passwordHash: hash,
      role: "admin",
      fullName: "EduTech Admin",
      uniqueId: "ADMIN-001",
      isActive: true,
    },
    create: {
      email: "admin@edutech.com",
      passwordHash: hash,
      role: "admin",
      fullName: "EduTech Admin",
      uniqueId: "ADMIN-001",
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "admin@gmail.com" },
    update: {
      passwordHash: hash,
      role: "admin",
      fullName: "Furqan",
      uniqueId: "AD-01",
      isActive: true,
    },
    create: {
      email: "admin@gmail.com",
      passwordHash: hash,
      role: "admin",
      fullName: "Furqan",
      uniqueId: "AD-01",
      isActive: true,
    },
  });

  console.log("Admin passwords reset successfully.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
