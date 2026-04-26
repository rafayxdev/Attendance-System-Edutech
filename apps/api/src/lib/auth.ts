import { Request, Response, NextFunction } from "express";
import { verifyAuthToken } from "./jwt.js";
import { normalizeKey } from "./rules.js";

export interface AuthenticatedRequest extends Request {
  auth?: ReturnType<typeof verifyAuthToken>;
}

export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    request.auth = verifyAuthToken(token);
    next();
  } catch {
    response.status(401).json({ message: "Unauthorized" });
  }
}

export function requireAdmin(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const role = normalizeKey(request.auth?.role);
  if (role !== "admin") {
    response.status(403).json({ message: "Admin access required." });
    return;
  }
  next();
}
