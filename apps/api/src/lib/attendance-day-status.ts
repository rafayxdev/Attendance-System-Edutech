export type AttendanceDayState = {
  hasTimeIn: boolean;
  hasTimeOut: boolean;
  timeInLate: boolean;
  manualStatus: "Present" | "Absent" | "Late" | null;
};

export function isAttendanceTrackedRole(role: string): boolean {
  const key = role.trim().toLowerCase();
  return key !== "admin" && key !== "guest";
}

export function resolveDisplayAttendanceStatus(
  state: AttendanceDayState,
): "Present" | "Absent" | "Late" {
  if (state.manualStatus) {
    return state.manualStatus;
  }
  if (state.hasTimeIn && state.hasTimeOut) {
    return state.timeInLate ? "Late" : "Present";
  }
  if (state.hasTimeIn && state.timeInLate) {
    return "Late";
  }
  if (state.hasTimeIn) {
    return "Present";
  }
  return "Absent";
}

export function dayCountsAsPresent(state: AttendanceDayState): boolean {
  const status = resolveDisplayAttendanceStatus(state);
  return status === "Present" || status === "Late";
}

export function dayCountsAsLate(state: AttendanceDayState): boolean {
  return resolveDisplayAttendanceStatus(state) === "Late";
}

export function dayCountsAsExplicitAbsent(state: AttendanceDayState): boolean {
  return state.manualStatus === "Absent";
}
