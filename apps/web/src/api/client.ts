import type { AccessPolicy } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.message || response.statusText || "Request failed",
    );
  }
  return payload as T;
}

function getToken(): string {
  return sessionStorage.getItem("et_token") || "";
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
    });

    return parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof TypeError
        ? "Unable to reach the API server. Start it with npm run dev:api (port 4000)."
        : "Check internet connection.";
    throw new Error(message);
  }
}

export async function fetchAccessPolicy(): Promise<AccessPolicy> {
  return apiRequest<AccessPolicy>("/config/access-policy");
}

export async function fetchPublicIp(): Promise<string> {
  const response = await fetch("https://api.ipify.org?format=json");
  if (!response.ok) {
    throw new Error("Unable to determine public IP");
  }
  const data = (await response.json()) as { ip: string };
  return data.ip;
}

export async function fetchJson<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export { API_URL };
