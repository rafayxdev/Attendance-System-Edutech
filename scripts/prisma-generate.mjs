import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = resolve(root, "apps/api");
const clientMarker = resolve(root, "node_modules/.prisma/client/index.js");
const force =
  process.env.PRISMA_FORCE_GENERATE === "1" ||
  process.argv.includes("--force");
const maxAttempts = 5;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function runPrismaGenerate() {
  return spawnSync("npx", ["prisma", "generate"], {
    cwd: apiDir,
    encoding: "utf8",
    shell: true,
  });
}

async function main() {
  if (existsSync(clientMarker) && !force) {
    console.log("Prisma client already generated — skipping.");
    return;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runPrismaGenerate();
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (result.status === 0) {
      console.log("Prisma client generated successfully.");
      return;
    }

    const isLockError =
      output.includes("EPERM") ||
      output.includes("operation not permitted") ||
      output.includes("EBUSY");

    if (!isLockError || attempt === maxAttempts) {
      console.error(output.trim() || "Prisma generate failed.");
      if (isLockError) {
        console.error("");
        console.error(
          "Windows file lock detected. Stop all running dev servers first:",
        );
        console.error("  1. Close any terminal running npm run dev");
        console.error("  2. End leftover node.exe tasks in Task Manager");
        console.error("  3. Run: npm run prisma:generate");
        console.error("  4. Then run: npm run dev");
      }
      process.exit(result.status ?? 1);
    }

    console.warn(
      `Prisma generate locked (attempt ${attempt}/${maxAttempts}). Retrying…`,
    );
    await sleep(1200 * attempt);
  }
}

await main();
