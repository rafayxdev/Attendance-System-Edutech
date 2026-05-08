export type RoleTab = "user" | "guest" | "admin";

export interface AuthSession {
  token: string;
  role: string;
  name: string;
  email: string;
  uniqueId: string;
}

export interface AccessPolicy {
  accessProfile: string;
  accessGateEnforced: boolean;
  allowedIpPrefixes: string[];
  campusLat: number;
  campusLng: number;
  campusRadiusMeters: number;
  timezone: string;
  publicApiUrl: string;
  publicAppUrl: string;
}

export interface AttendanceLogRow {
  id: string;
  timestamp: { date: string; time: string };
  attendanceDay: string;
  uniqueId: string;
  fullName: string;
  category: string;
  purpose: string;
  type: string;
  location: string;
  email: string;
  status: string;
  ip: string;
  hasImage: boolean;
  imageUrl: string | null;
}
