import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signAuthToken, verifyAuthToken } from "../lib/jwt.js";
import { normalizeKey, shouldEnforceAccessGate } from "../lib/rules.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  role: z.enum(["user", "admin"]),
  selectedRole: z.string().optional(),
  clientIp: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const userAllowedRoles = new Set([
  "student",
  "internee",
  "faculty member",
  "faculty",
  "visiting faculty",
  "human resource",
  "chief executive",
  "employee",
]);

const roleAliases: Record<string, string> = {
  "human resourse": "human resource",
  "human resources": "human resource",
  "hr manager": "human resource",
  hr: "human resource",
  ceo: "chief executive",
  "chief excutive": "chief executive",
};

function canonicalRole(value: string | null | undefined): string {
  const normalized = normalizeKey(value);
  return roleAliases[normalized] ?? normalized;
}

authRouter.post("/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid login payload", errors: parsed.error.flatten() });
    return;
  }

  const { email, password, role, selectedRole } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    response
      .status(404)
      .json({ message: "Email not registered in the system." });
    return;
  }

  if (!user.isActive) {
    response.status(403).json({ message: "Account deactivated." });
    return;
  }

  const userRole = canonicalRole(user.role);
  const selectedRoleKey = canonicalRole(selectedRole) || userRole;

  if (role === "admin" && userRole !== "admin") {
    response.status(403).json({ message: "You do not have admin access." });
    return;
  }

  if (role === "admin" && selectedRoleKey !== "admin") {
    response
      .status(400)
      .json({ message: "Please use valid admin credentials to sign in." });
    return;
  }

  if (role === "user") {
    if (!userAllowedRoles.has(userRole)) {
      if (userRole === "admin") {
        response
          .status(403)
          .json({ message: "Please use the Admin tab to log in." });
        return;
      }
      response
        .status(403)
        .json({ message: "Role not recognized for User login." });
      return;
    }

    if (!userAllowedRoles.has(selectedRoleKey)) {
      response
        .status(400)
        .json({ message: "Please select a valid user role." });
      return;
    }

    if (selectedRoleKey !== userRole) {
      response
        .status(403)
        .json({ message: "Selected role does not match your account role." });
      return;
    }
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    response.status(401).json({ message: "Incorrect password." });
    return;
  }

  if (shouldEnforceAccessGate()) {
    const clientIp = parsed.data.clientIp?.trim();
    if (!clientIp) {
      response
        .status(400)
        .json({ message: "Client IP is required for access validation." });
      return;
    }
  }

  const token = signAuthToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
    uniqueId: user.uniqueId ?? null,
  });

  response.json({
    success: true,
    token,
    role: userRole,
    name: user.fullName,
    email: user.email,
    uniqueId: user.uniqueId,
  });
});

authRouter.get("/me", async (request, response) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = verifyAuthToken(token);
    response.json({ success: true, user: payload });
  } catch {
    response.status(401).json({ message: "Unauthorized" });
  }
});
