import type { AuthSession } from "../types";

const KEY = "edutech_session";

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
  sessionStorage.setItem("et_token", session.token);
  sessionStorage.setItem("et_email", session.email);
  sessionStorage.setItem("et_name", session.name);
  sessionStorage.setItem("et_role", session.role);
  sessionStorage.setItem("et_uniqueId", session.uniqueId);
}

export function readSession(): AuthSession | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem("et_token");
  sessionStorage.removeItem("et_email");
  sessionStorage.removeItem("et_name");
  sessionStorage.removeItem("et_role");
  sessionStorage.removeItem("et_uniqueId");
}
