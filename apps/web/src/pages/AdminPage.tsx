import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate } from "react-router-dom";
import { API_URL, apiRequest } from "../api/client";
import { clearSession, readSession } from "../auth/session";
import { AccessGate } from "../components/AccessGate";
import { MetricCard } from "../components/MetricCard";
import { formatWallHm12h } from "../lib/timeDisplay";
import type { AccessPolicy, AttendanceLogRow, AuthSession } from "../types";
import logoUrl from "../images/EduTech Logo.png";

interface AdminPageProps {
  onSessionChange: (session: AuthSession | null) => void;
}

type AdminView =
  | "overview"
  | "users"
  | "generator"
  | "credentials"
  | "shifts"
  | "attendance"
  | "manual-attendance";
type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri";
type WeekdaySchedule = {
  day: WeekdayKey;
  startTime: string;
  endTime: string;
};
type ScheduleMode = "all-days" | "custom";

const USER_ROLE_OPTIONS = [
  { value: "internee", label: "Internee" },
  { value: "faculty", label: "Faculty" },
  { value: "visiting faculty", label: "Visiting Faculty" },
  { value: "chief executive", label: "CEO" },
  { value: "employee", label: "Employee" },
  { value: "human resource", label: "HR Manager" },
  { value: "admin", label: "Admin" },
] as const;

const OVERVIEW_ROLE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All roles" },
  ...USER_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  { value: "Guest", label: "Guest" },
];

const MANUAL_ROLE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All roles" },
  ...USER_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

function formatOverviewPeriodSummary(
  mode: "today" | "yesterday" | "picked",
  datePick: string,
  roleValue: string,
  searchQuery: string,
): string {
  const shortDate: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  let period: string;
  if (mode === "picked" && datePick) {
    const d = new Date(`${datePick}T12:00:00`);
    period = d.toLocaleDateString(undefined, {
      weekday: "long",
      ...shortDate,
    });
  } else if (mode === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    period = `Yesterday · ${d.toLocaleDateString(undefined, shortDate)}`;
  } else {
    const d = new Date();
    period = `Today · ${d.toLocaleDateString(undefined, shortDate)}`;
  }
  const roleLabel =
    OVERVIEW_ROLE_FILTER_OPTIONS.find((o) => o.value === roleValue)?.label ??
    "All roles";
  let line = `Showing attendance for ${period} · ${roleLabel}`;
  if (searchQuery) line += ` · search “${searchQuery}”`;
  return line;
}

const WEEKDAY_OPTIONS: Array<{ value: WeekdayKey; label: string }> = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
];

const USER_PAGE_SIZE = 5;

const WEEKDAY_ORDER: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
};

function weekdaySortKey(day: string): number {
  return WEEKDAY_ORDER[day] ?? 99;
}

function isAdminRole(role: string): boolean {
  return role.trim().toLowerCase() === "admin";
}

function sortWeekdaySlots(slots: WeekdaySchedule[]): WeekdaySchedule[] {
  return [...slots].sort(
    (a, b) => weekdaySortKey(a.day) - weekdaySortKey(b.day),
  );
}

function deriveDetailEditScheduleState(row: UserDataRow): {
  scheduleMode: ScheduleMode;
  allDaysSchedule: { startTime: string; endTime: string };
  attendanceSchedule: WeekdaySchedule[];
} {
  const raw = row.attendanceSchedule?.length
    ? sortWeekdaySlots(row.attendanceSchedule)
    : WEEKDAY_OPTIONS.map((w) => ({
        day: w.value,
        startTime: "09:00",
        endTime: "17:00",
      }));

  const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const;
  const coversAll =
    raw.length === 5 && weekdays.every((d) => raw.some((s) => s.day === d));
  const first = raw[0];
  const uniform =
    coversAll &&
    first &&
    raw.every(
      (s) => s.startTime === first.startTime && s.endTime === first.endTime,
    );

  if (uniform && first) {
    return {
      scheduleMode: "all-days",
      allDaysSchedule: { startTime: first.startTime, endTime: first.endTime },
      attendanceSchedule: raw,
    };
  }

  return {
    scheduleMode: "custom",
    allDaysSchedule: { startTime: "09:00", endTime: "17:00" },
    attendanceSchedule: raw.length
      ? raw
      : [{ day: "mon", startTime: "09:00", endTime: "17:00" }],
  };
}

type BulkUserRow = {
  email: string;
  role: string;
  fullName: string;
  uniqueId?: string | null;
  generated?: boolean;
};

type BulkUserResult = {
  email: string;
  role: string;
  fullName: string;
  uniqueId: string | null;
  status: "created" | "updated" | "skipped";
  password?: string;
  reason?: string;
};

type UserDataRow = {
  email: string;
  generated: boolean;
  role: string;
  fullName: string;
  uniqueId: string;
  attendanceSchedule?: WeekdaySchedule[];
  isActive: boolean;
  createdAt: string;
};

type AddUserDataForm = {
  email: string;
  role: string;
  fullName: string;
  uniqueId: string;
  attendanceSchedule: WeekdaySchedule[];
};

type DetailUserEditState = {
  email: string;
  role: string;
  fullName: string;
  uniqueId: string;
  isActive: boolean;
  scheduleMode: ScheduleMode;
  allDaysSchedule: { startTime: string; endTime: string };
  attendanceSchedule: WeekdaySchedule[];
};

type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
};

type CredentialRow = {
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
  password: string;
  status: "created" | "updated";
  generatedAt: string;
  generatedBy: string;
};

type ShiftRow = {
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
  shiftStart: string;
  shiftEnd: string;
  timeInAt: string;
  timeOutAt: string;
  status: string;
};

type MonthlyAttendanceRow = {
  month: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
  totalWeekdays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  latePenaltyAbsents: number;
  effectivePresent: number;
  effectiveAbsent: number;
};

type ManualAttendanceRow = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
  attendance: "Present" | "Absent" | "Late";
  reason: string;
  attendanceLogId: string | null;
  markedByAdmin: boolean;
};

type ManualAttendanceEditState = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  uniqueId: string;
  date: string;
  attendance: "Present" | "Absent" | "Late";
  reason: string;
};

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAttendanceTypeBadgeClass(type: string): string {
  if (type === "Time In") return "badge green";
  if (type === "Time Out") return "badge indigo";
  if (type === "Manual Attendance") return "badge purple";
  return "badge amber";
}

function getAttendanceStatusBadgeClass(status: string): string {
  if (status === "Late" || status === "Absent") return "badge red";
  if (status === "Present" || status === "On Time") return "badge green";
  return "badge green";
}

export function AdminPage({ onSessionChange }: AdminPageProps) {
  const session = readSession();

  useEffect(() => {
    document.body.classList.add("admin-portal");
    return () => {
      document.body.classList.remove("admin-portal");
    };
  }, []);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AccessGate>
      {(access) => (
        <AdminContent
          session={session}
          access={access}
          onLogout={() => {
            clearSession();
            onSessionChange(null);
            window.location.assign("/login");
          }}
        />
      )}
    </AccessGate>
  );
}

function AdminContent({
  session,
  access,
  onLogout,
}: {
  session: AuthSession;
  access: {
    clientIp: string;
    latitude: number | null;
    longitude: number | null;
    policy: AccessPolicy | null;
  };
  onLogout: () => void;
}) {
  const [view, setView] = useState<AdminView>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [stats, setStats] = useState({
    present: 0,
    presentExpected: 0,
    late: 0,
    outside: 0,
    timeouts: 0,
    checkedOutGuests: 0,
  });
  const [logs, setLogs] = useState<AttendanceLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [overviewDayMode, setOverviewDayMode] = useState<
    "today" | "yesterday" | "picked"
  >("today");
  const [overviewDatePick, setOverviewDatePick] = useState("");
  const [showOverviewDateInput, setShowOverviewDateInput] = useState(false);
  const [overviewRoleFilter, setOverviewRoleFilter] = useState("");
  const [overviewAppliedLine, setOverviewAppliedLine] = useState<string | null>(
    null,
  );
  const [exportingView, setExportingView] = useState<AdminView | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(
    null,
  );
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [logsListPage, setLogsListPage] = useState(1);

  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateMessage, setGenerateMessage] = useState("");

  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("");
  const [usersData, setUsersData] = useState<UserDataRow[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [addUserMessage, setAddUserMessage] = useState("");
  const [addUserMessageIsError, setAddUserMessageIsError] = useState(false);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("all-days");
  const [disableScheduleForAdmin, setDisableScheduleForAdmin] = useState(false);
  const [allDaysSchedule, setAllDaysSchedule] = useState({
    startTime: "09:00",
    endTime: "17:00",
  });
  const [addUserForm, setAddUserForm] = useState<AddUserDataForm>({
    email: "",
    role: "",
    fullName: "",
    uniqueId: "",
    attendanceSchedule: [{ day: "mon", startTime: "09:00", endTime: "17:00" }],
  });
  const [usersListPage, setUsersListPage] = useState(1);
  const [userDetailsRow, setUserDetailsRow] = useState<UserDataRow | null>(
    null,
  );
  const [userDetailsEditMode, setUserDetailsEditMode] = useState(false);
  const [detailOriginalEmail, setDetailOriginalEmail] = useState("");
  const [detailEditForm, setDetailEditForm] =
    useState<DetailUserEditState | null>(null);
  const [detailDisableScheduleForAdmin, setDetailDisableScheduleForAdmin] =
    useState(false);
  const [detailSaveBusy, setDetailSaveBusy] = useState(false);
  const [detailModalMessage, setDetailModalMessage] = useState("");
  const [detailModalMessageIsError, setDetailModalMessageIsError] =
    useState(false);

  const [credentialsSearch, setCredentialsSearch] = useState("");
  const [credentialsRoleFilter, setCredentialsRoleFilter] = useState("");
  const [credentialsData, setCredentialsData] = useState<CredentialRow[]>([]);
  const [credentialsBusy, setCredentialsBusy] = useState(false);
  const [credentialsListPage, setCredentialsListPage] = useState(1);
  const [selectedCredentialEmail, setSelectedCredentialEmail] = useState<
    string | null
  >(null);
  const [newCredentialPassword, setNewCredentialPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");

  const [shiftsSearch, setShiftsSearch] = useState("");
  const [shiftsRoleFilter, setShiftsRoleFilter] = useState("");
  const [shiftsData, setShiftsData] = useState<ShiftRow[]>([]);
  const [shiftsBusy, setShiftsBusy] = useState(false);
  const [shiftsListPage, setShiftsListPage] = useState(1);

  const [monthlyMonth, setMonthlyMonth] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });
  const [monthlyMonths, setMonthlyMonths] = useState<string[]>([]);
  const [monthlySearch, setMonthlySearch] = useState("");
  const [monthlyRoleFilter, setMonthlyRoleFilter] = useState("");
  const [monthlyData, setMonthlyData] = useState<MonthlyAttendanceRow[]>([]);
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [monthlyListPage, setMonthlyListPage] = useState(1);
  const [pendingUsersListPage, setPendingUsersListPage] = useState(1);

  const [manualDate, setManualDate] = useState(() => todayInputValue());
  const [manualRoleFilter, setManualRoleFilter] = useState("");
  const [manualSearch, setManualSearch] = useState("");
  const [manualData, setManualData] = useState<ManualAttendanceRow[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualListPage, setManualListPage] = useState(1);
  const [manualEditForm, setManualEditForm] =
    useState<ManualAttendanceEditState | null>(null);
  const [manualSaveBusy, setManualSaveBusy] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [manualMessageIsError, setManualMessageIsError] = useState(false);

  // Auto-dismiss transient admin messages after a short delay
  useEffect(() => {
    const timers: Array<number> = [];
    const clearAfter = (setter: (v: string) => void, value: string) => {
      if (!value) return;
      const id = window.setTimeout(() => setter(""), 4200);
      timers.push(id);
    };

    clearAfter(setManualMessage, manualMessage);
    clearAfter(setGenerateMessage, generateMessage);
    clearAfter(setAddUserMessage, addUserMessage);
    clearAfter(setDetailModalMessage, detailModalMessage);
    clearAfter(setPasswordMessage, passwordMessage);

    return () => timers.forEach((t) => clearTimeout(t));
  }, [
    manualMessage,
    generateMessage,
    addUserMessage,
    detailModalMessage,
    passwordMessage,
  ]);

  async function loadShifts() {
    setShiftsBusy(true);
    try {
      const query = new URLSearchParams();
      if (shiftsSearch.trim()) query.set("search", shiftsSearch.trim());
      if (shiftsRoleFilter.trim()) query.set("role", shiftsRoleFilter.trim());
      const rows = await apiRequest<ShiftRow[]>(
        `/admin/shifts-today?${query.toString()}`,
      );
      setShiftsData(rows);
      setShiftsListPage(1);
    } catch (error) {
      console.error(error);
    } finally {
      setShiftsBusy(false);
    }
  }

  async function loadMonthlyAttendance() {
    setMonthlyBusy(true);
    try {
      const query = new URLSearchParams();
      query.set("month", monthlyMonth);
      if (monthlySearch.trim()) query.set("search", monthlySearch.trim());
      if (monthlyRoleFilter.trim()) query.set("role", monthlyRoleFilter.trim());
      const rows = await apiRequest<MonthlyAttendanceRow[]>(
        `/admin/monthly-attendance?${query.toString()}`,
      );
      setMonthlyData(rows);
      setMonthlyListPage(1);
    } catch (error) {
      console.error(error);
    } finally {
      setMonthlyBusy(false);
    }
  }

  async function loadMonthlyMonths() {
    try {
      const months = await apiRequest<string[]>(
        "/admin/monthly-attendance/months",
      );
      setMonthlyMonths(months);
      if (months.length > 0 && !months.includes(monthlyMonth)) {
        const first = months[0];
        if (first !== undefined) setMonthlyMonth(first);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function loadManualAttendance() {
    setManualBusy(true);
    try {
      const query = new URLSearchParams();
      query.set("date", manualDate);
      if (manualRoleFilter.trim()) query.set("role", manualRoleFilter.trim());
      if (manualSearch.trim()) query.set("search", manualSearch.trim());
      const rows = await apiRequest<ManualAttendanceRow[]>(
        `/admin/manual-attendance?${query.toString()}`,
      );
      setManualData(rows);
      setManualListPage(1);
    } catch (error) {
      console.error(error);
    } finally {
      setManualBusy(false);
    }
  }

  function openManualEdit(row: ManualAttendanceRow) {
    setManualMessage("");
    setManualMessageIsError(false);
    setManualEditForm({
      userId: row.userId,
      fullName: row.fullName,
      email: row.email,
      role: row.role,
      uniqueId: row.uniqueId,
      date: manualDate,
      attendance: row.attendance,
      reason: row.reason,
    });
  }

  function closeManualEdit() {
    setManualEditForm(null);
    setManualSaveBusy(false);
  }

  async function handleManualSave(event: React.FormEvent) {
    event.preventDefault();
    if (!manualEditForm) return;

    setManualSaveBusy(true);
    setManualMessage("");
    setManualMessageIsError(false);
    try {
      await apiRequest<{ success: boolean }>(
        `/admin/manual-attendance/${encodeURIComponent(manualEditForm.userId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            date: manualEditForm.date,
            status: manualEditForm.attendance,
            reason: manualEditForm.reason.trim(),
          }),
        },
      );
      setManualMessage("Manual attendance saved successfully.");
      setManualMessageIsError(false);
      setManualEditForm(null);
      await Promise.all([
        loadManualAttendance(),
        loadMonthlyMonths(),
        loadMonthlyAttendance(),
      ]);
      if (view === "overview") {
        await loadOverview();
      }
    } catch (error) {
      setManualMessageIsError(true);
      setManualMessage(
        error instanceof Error
          ? error.message
          : "Failed to save manual attendance.",
      );
    } finally {
      setManualSaveBusy(false);
    }
  }

  function csvEscape(value: unknown): string {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsvFile(
    filename: string,
    header: string[],
    rows: string[][],
  ) {
    const lines = [header.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(row.map(csvEscape).join(","));
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function requestConfirmation(config: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmModal({
        title: config.title,
        message: config.message,
        confirmLabel: config.confirmLabel ?? "Confirm",
        cancelLabel: config.cancelLabel ?? "Cancel",
        danger: config.danger ?? false,
        resolve,
      });
    });
  }

  function closeConfirmModal(confirmed: boolean) {
    if (!confirmModal) return;
    confirmModal.resolve(confirmed);
    setConfirmModal(null);
  }

  async function handleExportCsv(
    target: Extract<
      AdminView,
      | "overview"
      | "users"
      | "credentials"
      | "shifts"
      | "attendance"
      | "manual-attendance"
    >,
  ) {
    if (exportingView) return;

    let filterSummary = "No extra filters";
    let count = 0;
    if (target === "overview") {
      const period =
        overviewDayMode === "picked" && overviewDatePick
          ? `Date: ${overviewDatePick}`
          : overviewDayMode === "yesterday"
            ? "Period: Yesterday"
            : "Period: Today";
      const role = overviewRoleFilter || "All roles";
      const query = search.trim() || "none";
      count = logs.length;
      filterSummary = `${period} | Role: ${role} | Search: ${query}`;
    } else if (target === "users") {
      count = usersData.length;
      filterSummary = `Role: ${usersRoleFilter || "All roles"} | Search: ${
        usersSearch.trim() || "none"
      }`;
    } else if (target === "credentials") {
      count = credentialsData.length;
      filterSummary = `Role: ${credentialsRoleFilter || "All roles"} | Search: ${
        credentialsSearch.trim() || "none"
      }`;
    } else if (target === "shifts") {
      count = shiftsData.length;
      filterSummary = `Role: ${shiftsRoleFilter || "All roles"} | Search: ${
        shiftsSearch.trim() || "none"
      }`;
    } else if (target === "attendance") {
      count = monthlyData.length;
      filterSummary = `Month: ${monthlyMonth} | Role: ${
        monthlyRoleFilter || "All roles"
      } | Search: ${monthlySearch.trim() || "none"}`;
    } else {
      count = manualData.length;
      filterSummary = `Date: ${manualDate} | Role: ${
        manualRoleFilter || "All roles"
      } | Search: ${manualSearch.trim() || "none"}`;
    }

    const confirmed = await requestConfirmation({
      title: `Export CSV for ${target.toUpperCase()}?`,
      message: `Selected filters:\n${filterSummary}\n\nRows to export: ${count}`,
      confirmLabel: "Confirm Export",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;

    setExportingView(target);
    try {
      if (target === "overview") {
        downloadCsvFile(
          "overview-attendance-logs.csv",
          ["Time", "Unique ID", "Name", "Role", "Type", "Status", "Image"],
          logs.map((row) => [
            row.timestamp.time,
            row.uniqueId,
            row.fullName,
            row.category,
            row.type,
            row.status,
            row.hasImage ? "Yes" : "No",
          ]),
        );
      } else if (target === "users") {
        downloadCsvFile(
          "users-data.csv",
          ["Gmail", "Generated", "Role", "Name", "Unique ID", "Active"],
          usersData.map((row) => [
            row.email,
            row.generated ? "TRUE" : "FALSE",
            row.role,
            row.fullName,
            row.uniqueId,
            row.isActive ? "Yes" : "No",
          ]),
        );
      } else if (target === "credentials") {
        downloadCsvFile(
          "user-credentials.csv",
          [
            "Gmail",
            "Password",
            "Role",
            "Name",
            "Unique ID",
            "Status",
            "Generated At",
            "Generated By",
          ],
          credentialsData.map((row) => [
            row.email,
            row.password,
            row.role,
            row.fullName,
            row.uniqueId,
            row.status,
            new Date(row.generatedAt).toLocaleString(),
            row.generatedBy,
          ]),
        );
      } else if (target === "shifts") {
        downloadCsvFile(
          "timing-shift.csv",
          [
            "Name",
            "Role",
            "Gmail",
            "Unique ID",
            "Shift In",
            "Shift Out",
            "Time In",
            "Time Out",
            "Status",
          ],
          shiftsData.map((row) => [
            row.fullName,
            row.role,
            row.email,
            row.uniqueId,
            formatWallHm12h(row.shiftStart),
            formatWallHm12h(row.shiftEnd),
            row.timeInAt,
            row.timeOutAt,
            row.status,
          ]),
        );
      } else if (target === "attendance") {
        downloadCsvFile(
          `monthly-attendance-${monthlyMonth}.csv`,
          [
            "Month",
            "Name",
            "Role",
            "Gmail",
            "Unique ID",
            "Total Weekdays",
            "Present",
            "Absent",
            "Late",
            "Late->Absent",
            "Effective Present",
            "Effective Absent",
          ],
          monthlyData.map((row) => [
            row.month,
            row.fullName,
            row.role,
            row.email,
            row.uniqueId,
            String(row.totalWeekdays),
            String(row.presentDays),
            String(row.absentDays),
            String(row.lateDays),
            String(row.latePenaltyAbsents),
            String(row.effectivePresent),
            String(row.effectiveAbsent),
          ]),
        );
      } else {
        downloadCsvFile(
          "manual-attendance.csv",
          [
            "Name",
            "Gmail",
            "Role",
            "Unique ID",
            "Attendance",
            "Reason",
            "Marked By Admin",
          ],
          manualData.map((row) => [
            row.fullName,
            row.email,
            row.role,
            row.uniqueId,
            row.attendance,
            row.reason || "",
            row.markedByAdmin ? "Yes" : "No",
          ]),
        );
      }
    } finally {
      setExportingView(null);
    }
  }

  async function loadOverview() {
    const dayMode = overviewDayMode;
    const datePick = overviewDatePick;
    const roleFilter = overviewRoleFilter;
    const searchQ = search.trim();

    setBusy(true);
    try {
      const statsResult = await apiRequest<{
        present: number;
        presentExpected: number;
        late: number;
        outside: number;
        timeouts: number;
        checkedOutGuests: number;
      }>("/admin/stats");
      const query = new URLSearchParams();
      if (searchQ) query.set("search", searchQ);
      if (dayMode === "picked" && datePick) {
        query.set("date", datePick);
      } else if (dayMode === "yesterday") {
        query.set("filter", "yesterday");
      } else {
        query.set("filter", "today");
      }
      if (roleFilter.trim()) {
        query.set("category", roleFilter.trim());
      }
      const logsResult = await apiRequest<AttendanceLogRow[]>(
        `/admin/logs?${query.toString()}`,
      );
      setStats(statsResult);
      setLogs(logsResult);
      setLogsListPage(1);
      setOverviewAppliedLine(
        formatOverviewPeriodSummary(dayMode, datePick, roleFilter, searchQ),
      );
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function loadUsersData() {
    setUsersBusy(true);
    try {
      const query = new URLSearchParams();
      if (usersSearch.trim()) query.set("search", usersSearch.trim());
      if (usersRoleFilter.trim()) query.set("role", usersRoleFilter.trim());
      const rows = await apiRequest<UserDataRow[]>(
        `/admin/users-data?${query.toString()}`,
      );
      setUsersData(rows);
      setUsersListPage(1);
    } catch (error) {
      console.error(error);
    } finally {
      setUsersBusy(false);
    }
  }

  async function loadCredentials() {
    setCredentialsBusy(true);
    try {
      const query = new URLSearchParams();
      if (credentialsSearch.trim())
        query.set("search", credentialsSearch.trim());
      if (credentialsRoleFilter.trim()) {
        query.set("role", credentialsRoleFilter.trim());
      }
      const rows = await apiRequest<CredentialRow[]>(
        `/admin/users-credentials?${query.toString()}`,
      );
      setCredentialsData(rows);
      setCredentialsListPage(1);
    } catch (error) {
      console.error(error);
    } finally {
      setCredentialsBusy(false);
    }
  }

  async function generateFromRows(rows: BulkUserRow[]) {
    if (rows.length === 0) {
      setGenerateMessage("No pending users found to generate credentials.");
      return;
    }

    setGenerateBusy(true);
    setGenerateMessage("");

    try {
      const result = await apiRequest<{
        success: boolean;
        processed: number;
        results: BulkUserResult[];
      }>("/admin/users/bulk-generate", {
        method: "POST",
        body: JSON.stringify({ rows, overwriteExisting: true }),
      });

      setGenerateMessage(
        `Processed ${result.processed} user(s). Generated users moved to User Credentials.`,
      );
      await Promise.all([loadUsersData(), loadCredentials()]);
    } catch (error) {
      setGenerateMessage(
        error instanceof Error ? error.message : "Failed to generate users.",
      );
    } finally {
      setGenerateBusy(false);
    }
  }

  async function handleGeneratePendingAll() {
    const pending = usersData
      .filter((row) => !row.generated)
      .map((row) => ({
        email: row.email,
        role: row.role,
        fullName: row.fullName,
        uniqueId: row.uniqueId === "N/A" ? null : row.uniqueId,
        generated: true,
      }));

    await generateFromRows(pending);
  }

  async function handleGenerateSingle(row: UserDataRow) {
    await generateFromRows([
      {
        email: row.email,
        role: row.role,
        fullName: row.fullName,
        uniqueId: row.uniqueId === "N/A" ? null : row.uniqueId,
        generated: true,
      },
    ]);
  }

  function updateAddUserSchedule(
    index: number,
    key: keyof WeekdaySchedule,
    value: string,
  ) {
    setAddUserForm((prev) => ({
      ...prev,
      attendanceSchedule: prev.attendanceSchedule.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, [key]: value } : slot,
      ),
    }));
  }

  function addScheduleSlot() {
    if (addUserForm.attendanceSchedule.length >= 5) {
      setAddUserMessageIsError(true);
      setAddUserMessage("You can add maximum 5 custom weekdays.");
      return;
    }
    setAddUserMessageIsError(false);
    setAddUserMessage("");
    setAddUserForm((prev) => ({
      ...prev,
      attendanceSchedule: [
        ...prev.attendanceSchedule,
        { day: "mon", startTime: "09:00", endTime: "17:00" },
      ],
    }));
  }

  function applyScheduleToAllWeekdays() {
    setScheduleMode("all-days");
    setAddUserMessageIsError(false);
    setAddUserMessage("");
  }

  function handleAddUserRoleChange(value: string) {
    setAddUserForm((prev) => ({
      ...prev,
      role: value,
    }));

    if (isAdminRole(value)) {
      setDisableScheduleForAdmin(true);
      setScheduleMode("all-days");
      setAddUserMessageIsError(false);
      setAddUserMessage("");
      return;
    }

    setDisableScheduleForAdmin(false);
  }

  function handleDetailRoleChange(value: string) {
    setDetailDisableScheduleForAdmin(isAdminRole(value));
    setDetailEditForm((prev) => {
      if (!prev) return prev;
      if (isAdminRole(value)) {
        return {
          ...prev,
          role: value,
          scheduleMode: "all-days",
          attendanceSchedule: [],
        };
      }
      return { ...prev, role: value };
    });
  }

  function removeScheduleSlot(index: number) {
    setAddUserForm((prev) => ({
      ...prev,
      attendanceSchedule: prev.attendanceSchedule.filter(
        (_slot, slotIndex) => slotIndex !== index,
      ),
    }));
  }

  async function handleAddUserData(event: React.FormEvent) {
    event.preventDefault();
    const role = addUserForm.role.trim();
    const schedulePayload =
      isAdminRole(role) && disableScheduleForAdmin
        ? []
        : scheduleMode === "all-days"
          ? WEEKDAY_OPTIONS.map((weekday) => ({
              day: weekday.value,
              startTime: allDaysSchedule.startTime,
              endTime: allDaysSchedule.endTime,
            }))
          : addUserForm.attendanceSchedule;
    if (!isAdminRole(role) && schedulePayload.length === 0) {
      setAddUserMessageIsError(true);
      setAddUserMessage("Add at least one weekday schedule.");
      return;
    }

    setAddUserBusy(true);
    setAddUserMessageIsError(false);
    setAddUserMessage("");
    try {
      await apiRequest<{ success: boolean }>("/admin/users-data", {
        method: "POST",
        body: JSON.stringify({
          email: addUserForm.email.trim().toLowerCase(),
          role,
          fullName: addUserForm.fullName.trim(),
          uniqueId: addUserForm.uniqueId.trim() || null,
          attendanceSchedule: schedulePayload,
          isActive: true,
        }),
      });

      setAddUserMessageIsError(false);
      setAddUserMessage(
        "User added successfully. Credentials are pending generation.",
      );
      setShowAddUserForm(false);
      setScheduleMode("all-days");
      setDisableScheduleForAdmin(false);
      setAllDaysSchedule({ startTime: "09:00", endTime: "17:00" });
      setAddUserForm({
        email: "",
        role: "",
        fullName: "",
        uniqueId: "",
        attendanceSchedule: [
          { day: "mon", startTime: "09:00", endTime: "17:00" },
        ],
      });
      await loadUsersData();
    } catch (error) {
      setAddUserMessageIsError(true);
      setAddUserMessage(
        error instanceof Error ? error.message : "Failed to add user.",
      );
    } finally {
      setAddUserBusy(false);
    }
  }

  function openUserDetails(row: UserDataRow) {
    setUserDetailsRow(row);
    setUserDetailsEditMode(false);
    setDetailOriginalEmail(row.email);
    setDetailEditForm(null);
    setDetailModalMessage("");
    setDetailModalMessageIsError(false);
  }

  function closeUserDetails() {
    setUserDetailsRow(null);
    setUserDetailsEditMode(false);
    setDetailEditForm(null);
    setDetailDisableScheduleForAdmin(false);
    setDetailModalMessage("");
    setDetailModalMessageIsError(false);
    setDetailSaveBusy(false);
  }

  function startEditInDetails() {
    if (!userDetailsRow) return;
    const sch = deriveDetailEditScheduleState(userDetailsRow);
    const adminRole = isAdminRole(userDetailsRow.role);
    setDetailEditForm({
      email: userDetailsRow.email,
      role: userDetailsRow.role,
      fullName: userDetailsRow.fullName,
      uniqueId:
        userDetailsRow.uniqueId === "N/A" ? "" : userDetailsRow.uniqueId,
      isActive: userDetailsRow.isActive,
      scheduleMode: sch.scheduleMode,
      allDaysSchedule: sch.allDaysSchedule,
      attendanceSchedule: adminRole ? [] : sch.attendanceSchedule,
    });
    setDetailDisableScheduleForAdmin(adminRole);
    setUserDetailsEditMode(true);
    setDetailModalMessage("");
    setDetailModalMessageIsError(false);
  }

  function cancelEditInDetails() {
    setUserDetailsEditMode(false);
    setDetailEditForm(null);
    setDetailDisableScheduleForAdmin(false);
    setDetailModalMessage("");
    setDetailModalMessageIsError(false);
  }

  function updateDetailScheduleSlot(
    index: number,
    key: keyof WeekdaySchedule,
    value: string,
  ) {
    setDetailEditForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        attendanceSchedule: prev.attendanceSchedule.map((slot, i) =>
          i === index ? { ...slot, [key]: value } : slot,
        ),
      };
    });
  }

  function detailAddScheduleSlot() {
    setDetailEditForm((prev) => {
      if (!prev) return prev;
      if (prev.attendanceSchedule.length >= 5) return prev;
      return {
        ...prev,
        attendanceSchedule: [
          ...prev.attendanceSchedule,
          { day: "mon", startTime: "09:00", endTime: "17:00" },
        ],
      };
    });
  }

  function detailRemoveScheduleSlot(index: number) {
    setDetailEditForm((prev) => {
      if (!prev) return prev;
      if (prev.attendanceSchedule.length <= 1) return prev;
      return {
        ...prev,
        attendanceSchedule: prev.attendanceSchedule.filter(
          (_slot, i) => i !== index,
        ),
      };
    });
  }

  async function handleDetailSave(event: React.FormEvent) {
    event.preventDefault();
    if (!detailEditForm) return;

    const role = detailEditForm.role.trim();
    const schedulePayload =
      isAdminRole(role) && detailDisableScheduleForAdmin
        ? []
        : detailEditForm.scheduleMode === "all-days"
          ? WEEKDAY_OPTIONS.map((weekday) => ({
              day: weekday.value,
              startTime: detailEditForm.allDaysSchedule.startTime,
              endTime: detailEditForm.allDaysSchedule.endTime,
            }))
          : detailEditForm.attendanceSchedule;

    if (!isAdminRole(role) && schedulePayload.length === 0) {
      setDetailModalMessageIsError(true);
      setDetailModalMessage("Add at least one weekday in the schedule.");
      return;
    }

    setDetailSaveBusy(true);
    setDetailModalMessage("");
    setDetailModalMessageIsError(false);
    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-data/${encodeURIComponent(detailOriginalEmail)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            email: detailEditForm.email.trim().toLowerCase(),
            role,
            fullName: detailEditForm.fullName.trim(),
            uniqueId: detailEditForm.uniqueId.trim() || null,
            isActive: detailEditForm.isActive,
            attendanceSchedule: schedulePayload,
          }),
        },
      );
      await loadUsersData();
      closeUserDetails();
    } catch (error) {
      setDetailModalMessageIsError(true);
      setDetailModalMessage(
        error instanceof Error ? error.message : "Failed to update user.",
      );
    } finally {
      setDetailSaveBusy(false);
    }
  }

  async function handleDeleteUser(email: string) {
    const confirmDelete = await requestConfirmation({
      title: `Delete user ${email}?`,
      message:
        "This removes the user account, all attendance logs, credential records, schedule history, and monthly summary rows for this user. This cannot be undone.",
      confirmLabel: "Delete User",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmDelete) return;

    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-data/${encodeURIComponent(email)}`,
        {
          method: "DELETE",
        },
      );
      if (userDetailsRow?.email === email) {
        closeUserDetails();
      }
      await loadUsersData();
    } catch (error) {
      await requestConfirmation({
        title: "Delete failed",
        message:
          error instanceof Error ? error.message : "Failed to delete user.",
        confirmLabel: "OK",
        cancelLabel: "",
      });
    }
  }

  async function handleChangePassword() {
    if (!selectedCredentialEmail) return;

    setPasswordBusy(true);
    setPasswordMessage("");
    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-credentials/${encodeURIComponent(selectedCredentialEmail)}/password`,
        {
          method: "PUT",
          body: JSON.stringify({ password: newCredentialPassword }),
        },
      );
      setPasswordMessage("Password updated successfully.");
      setSelectedCredentialEmail(null);
      setNewCredentialPassword("");
      await loadCredentials();
    } catch (error) {
      setPasswordMessage(
        error instanceof Error ? error.message : "Failed to change password.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDeleteCredential(email: string) {
    const confirmDelete = await requestConfirmation({
      title: `Delete credentials for ${email}?`,
      message: "This will remove the user login.",
      confirmLabel: "Delete Credentials",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmDelete) return;

    setPasswordBusy(true);
    setPasswordMessage("");
    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-credentials/${encodeURIComponent(email)}`,
        {
          method: "DELETE",
        },
      );
      if (selectedCredentialEmail === email) {
        setSelectedCredentialEmail(null);
        setNewCredentialPassword("");
      }
      setPasswordMessage(
        "Credentials removed. User profile and attendance data remain, and credentials can be generated again.",
      );
      await Promise.all([loadCredentials(), loadUsersData()]);
    } catch (error) {
      setPasswordMessage(
        error instanceof Error
          ? error.message
          : "Failed to delete credentials.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  useEffect(() => {
    if (view === "overview") {
      void loadOverview();
    }
  }, [view]);

  useEffect(() => {
    if (view === "manual-attendance") {
      void loadManualAttendance();
    }
  }, [view]);

  const filteredCount = useMemo(() => logs.length, [logs]);
  const pendingUsers = useMemo(
    () => usersData.filter((row) => !row.generated),
    [usersData],
  );
  const logsTotalPages = Math.max(1, Math.ceil(logs.length / USER_PAGE_SIZE));
  const logsPageClamped = Math.min(logsListPage, logsTotalPages);
  const logsPagedRows = useMemo(() => {
    const start = (logsPageClamped - 1) * USER_PAGE_SIZE;
    return logs.slice(start, start + USER_PAGE_SIZE);
  }, [logs, logsPageClamped]);
  const pendingUsersTotalPages = Math.max(
    1,
    Math.ceil(pendingUsers.length / USER_PAGE_SIZE),
  );
  const pendingUsersPageClamped = Math.min(
    pendingUsersListPage,
    pendingUsersTotalPages,
  );
  const pendingUsersPagedRows = useMemo(() => {
    const start = (pendingUsersPageClamped - 1) * USER_PAGE_SIZE;
    return pendingUsers.slice(start, start + USER_PAGE_SIZE);
  }, [pendingUsers, pendingUsersPageClamped]);
  const credentialsTotalPages = Math.max(
    1,
    Math.ceil(credentialsData.length / USER_PAGE_SIZE),
  );
  const credentialsPageClamped = Math.min(
    credentialsListPage,
    credentialsTotalPages,
  );
  const credentialsPagedRows = useMemo(() => {
    const start = (credentialsPageClamped - 1) * USER_PAGE_SIZE;
    return credentialsData.slice(start, start + USER_PAGE_SIZE);
  }, [credentialsData, credentialsPageClamped]);
  const shiftsTotalPages = Math.max(
    1,
    Math.ceil(shiftsData.length / USER_PAGE_SIZE),
  );
  const shiftsPageClamped = Math.min(shiftsListPage, shiftsTotalPages);
  const shiftsPagedRows = useMemo(() => {
    const start = (shiftsPageClamped - 1) * USER_PAGE_SIZE;
    return shiftsData.slice(start, start + USER_PAGE_SIZE);
  }, [shiftsData, shiftsPageClamped]);
  const monthlyTotalPages = Math.max(
    1,
    Math.ceil(monthlyData.length / USER_PAGE_SIZE),
  );
  const monthlyPageClamped = Math.min(monthlyListPage, monthlyTotalPages);
  const monthlyPagedRows = useMemo(() => {
    const start = (monthlyPageClamped - 1) * USER_PAGE_SIZE;
    return monthlyData.slice(start, start + USER_PAGE_SIZE);
  }, [monthlyData, monthlyPageClamped]);

  const manualTotalPages = Math.max(
    1,
    Math.ceil(manualData.length / USER_PAGE_SIZE),
  );
  const manualPageClamped = Math.min(manualListPage, manualTotalPages);
  const manualPagedRows = useMemo(() => {
    const start = (manualPageClamped - 1) * USER_PAGE_SIZE;
    return manualData.slice(start, start + USER_PAGE_SIZE);
  }, [manualData, manualPageClamped]);

  const usersTotalPages = Math.max(
    1,
    Math.ceil(usersData.length / USER_PAGE_SIZE),
  );
  const usersPageClamped = Math.min(usersListPage, usersTotalPages);
  const usersPagedRows = useMemo(() => {
    const page = Math.min(usersListPage, usersTotalPages);
    const start = (page - 1) * USER_PAGE_SIZE;
    return usersData.slice(start, start + USER_PAGE_SIZE);
  }, [usersData, usersListPage, usersTotalPages]);

  useEffect(() => {
    if (usersListPage > usersTotalPages) {
      setUsersListPage(usersTotalPages);
    }
  }, [usersListPage, usersTotalPages]);
  useEffect(() => {
    if (logsListPage > logsTotalPages) setLogsListPage(logsTotalPages);
  }, [logsListPage, logsTotalPages]);
  useEffect(() => {
    if (pendingUsersListPage > pendingUsersTotalPages) {
      setPendingUsersListPage(pendingUsersTotalPages);
    }
  }, [pendingUsersListPage, pendingUsersTotalPages]);
  useEffect(() => {
    if (credentialsListPage > credentialsTotalPages) {
      setCredentialsListPage(credentialsTotalPages);
    }
  }, [credentialsListPage, credentialsTotalPages]);
  useEffect(() => {
    if (shiftsListPage > shiftsTotalPages) setShiftsListPage(shiftsTotalPages);
  }, [shiftsListPage, shiftsTotalPages]);
  useEffect(() => {
    if (monthlyListPage > monthlyTotalPages) {
      setMonthlyListPage(monthlyTotalPages);
    }
  }, [monthlyListPage, monthlyTotalPages]);
  useEffect(() => {
    if (manualListPage > manualTotalPages) {
      setManualListPage(manualTotalPages);
    }
  }, [manualListPage, manualTotalPages]);

  useEffect(() => {
    if (!userDetailsRow) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [userDetailsRow]);

  function renderUserScheduleReadOnly(row: UserDataRow) {
    const slots = row.attendanceSchedule?.length
      ? sortWeekdaySlots(row.attendanceSchedule)
      : [];
    if (slots.length === 0) {
      return <p className="detail-muted">No schedule on file.</p>;
    }
    const weekdays = ["mon", "tue", "wed", "thu", "fri"] as const;
    const coversAll =
      slots.length === 5 &&
      weekdays.every((d) => slots.some((s) => s.day === d));
    const first = slots[0];
    const uniform =
      coversAll &&
      first &&
      slots.every(
        (s) => s.startTime === first.startTime && s.endTime === first.endTime,
      );

    if (uniform && first) {
      return (
        <div className="detail-schedule-summary">
          <div className="detail-schedule-row-head">Mon – Fri</div>
          <div className="detail-schedule-row-time">
            {formatWallHm12h(first.startTime)} –{" "}
            {formatWallHm12h(first.endTime)}
          </div>
        </div>
      );
    }

    return (
      <div className="detail-schedule-per-day">
        <table className="detail-mini-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Shift</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={`${s.day}-${s.startTime}-${s.endTime}`}>
                <td>
                  {WEEKDAY_OPTIONS.find((o) => o.value === s.day)?.label ??
                    s.day}
                </td>
                <td>
                  {formatWallHm12h(s.startTime)} – {formatWallHm12h(s.endTime)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  async function openImage(imagePath: string | null) {
    if (!imagePath) return;

    const token = sessionStorage.getItem("et_token") || "";
    const response = await fetch(`${API_URL}${imagePath}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      return;
    }
    const blob = await response.blob();
    setSelectedImage(URL.createObjectURL(blob));
  }

  async function handleDeleteAttendance(log: AttendanceLogRow) {
    if (deletingLogId) return;
    const ok = await requestConfirmation({
      title: `Delete ${log.type} record?`,
      message: `Record for ${log.fullName}. This cannot be undone.`,
      confirmLabel: "Delete Record",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;

    setDeletingLogId(log.id);
    try {
      await apiRequest<{ success: boolean }>(`/admin/logs/${log.id}`, {
        method: "DELETE",
      });
      await loadOverview();
    } catch (error) {
      await requestConfirmation({
        title: "Delete failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete attendance.",
        confirmLabel: "OK",
        cancelLabel: "",
      });
    } finally {
      setDeletingLogId(null);
    }
  }

  async function refreshCurrentAdminView() {
    if (refreshBusy) return;
    setRefreshBusy(true);
    try {
      switch (view) {
        case "overview":
          await loadOverview();
          break;
        case "users":
          await loadUsersData();
          break;
        case "generator":
          await loadUsersData();
          break;
        case "credentials":
          await loadCredentials();
          break;
        case "shifts":
          await loadShifts();
          break;
        case "attendance":
          await Promise.all([loadMonthlyMonths(), loadMonthlyAttendance()]);
          break;
        case "manual-attendance":
          await loadManualAttendance();
          break;
        default:
          break;
      }
    } finally {
      setRefreshBusy(false);
    }
  }

  return (
    <div className="page-shell admin-shell">
      <div className="page-bg admin-bg" />
      <main className="workspace-card glass-card admin-workspace">
        <header className="topbar admin-topbar">
          <div className="admin-brand">
            <img src={logoUrl} alt="EduTech Solutions" />
            <div>
              <h1>Admin Dashboard</h1>
              <p>
                {session.name} · {session.email}
              </p>
            </div>
          </div>
          <div className="topbar-actions admin-actions">
            <button
              type="button"
              className="ghost-btn mobile-nav-toggle"
              aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileNavOpen}
              aria-controls="admin-mobile-nav"
              onClick={() => setMobileNavOpen((prev) => !prev)}
            >
              <span className="hamburger" aria-hidden="true" />
              Menu
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={refreshBusy}
              onClick={() => void refreshCurrentAdminView()}
            >
              {refreshBusy ? (
                <span className="refresh-btn-content">
                  <span className="refresh-btn-spinner" aria-hidden="true" />
                  Refreshing...
                </span>
              ) : (
                "Refresh"
              )}
            </button>
            <button
              type="button"
              className="ghost-btn danger"
              onClick={onLogout}
            >
              Logout
            </button>
          </div>
        </header>

        <section
          id="admin-mobile-nav"
          className={`admin-nav-tabs role-tabs ${mobileNavOpen ? "is-open" : ""}`}
        >
          <button
            type="button"
            className={view === "overview" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("overview");
              setMobileNavOpen(false);
            }}
          >
            Overview
          </button>
          <button
            type="button"
            className={view === "users" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("users");
              setMobileNavOpen(false);
              void loadUsersData();
            }}
          >
            Users Data
          </button>
          <button
            type="button"
            className={view === "generator" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("generator");
              setMobileNavOpen(false);
              void loadUsersData();
            }}
          >
            Credentials Generation
          </button>
          <button
            type="button"
            className={view === "credentials" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("credentials");
              setMobileNavOpen(false);
              void loadCredentials();
            }}
          >
            User Credentials
          </button>
          <button
            type="button"
            className={view === "shifts" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("shifts");
              setMobileNavOpen(false);
              void loadShifts();
            }}
          >
            Timing / Shift
          </button>
          <button
            type="button"
            className={view === "attendance" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("attendance");
              setMobileNavOpen(false);
              void loadMonthlyMonths();
              void loadMonthlyAttendance();
            }}
          >
            Attendance
          </button>
          <button
            type="button"
            className={
              view === "manual-attendance" ? "role-tab active" : "role-tab"
            }
            onClick={() => {
              setView("manual-attendance");
              setMobileNavOpen(false);
              void loadManualAttendance();
            }}
          >
            Manual Attendance
          </button>
        </section>

        {view === "overview" ? (
          <>
            <section className="stats-grid">
              <MetricCard
                label="Present Today"
                value={`${stats.present} / ${stats.presentExpected}`}
                accent="blue"
                icon="👥"
              />
              <MetricCard
                label="Late Arrivals"
                value={stats.late}
                accent="red"
                icon="⏰"
              />
              <MetricCard
                label="Guests Today"
                value={stats.outside}
                accent="amber"
                icon="🧑‍🤝‍🧑"
              />
              <MetricCard
                label="Checked Out User"
                value={stats.timeouts}
                accent="green"
                icon="✅"
              />
              <MetricCard
                label="Checked Out Guest"
                value={stats.checkedOutGuests}
                accent="green"
                icon="🚪"
              />
            </section>

            <section className="filters-bar overview-filters-bar">
              <input
                id="overview-log-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, role, status…"
                className="search-input overview-search-compact"
              />
              <div
                className="overview-period-segmented"
                role="group"
                aria-label="Attendance date range"
              >
                <button
                  type="button"
                  className={`overview-seg-btn ${overviewDayMode === "today" ? "is-active" : ""}`}
                  aria-pressed={overviewDayMode === "today"}
                  onClick={() => {
                    setOverviewDayMode("today");
                    setOverviewDatePick("");
                    setShowOverviewDateInput(false);
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`overview-seg-btn ${overviewDayMode === "yesterday" ? "is-active" : ""}`}
                  aria-pressed={overviewDayMode === "yesterday"}
                  onClick={() => {
                    setOverviewDayMode("yesterday");
                    setOverviewDatePick("");
                    setShowOverviewDateInput(false);
                  }}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  className={`overview-seg-btn ${overviewDayMode === "picked" ? "is-active" : ""}`}
                  aria-pressed={overviewDayMode === "picked"}
                  onClick={() => setShowOverviewDateInput((prev) => !prev)}
                >
                  Date
                </button>
                {showOverviewDateInput ? (
                  <input
                    id="overview-date-pick"
                    value={overviewDayMode === "picked" ? overviewDatePick : ""}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!next) {
                        setOverviewDayMode("today");
                        setOverviewDatePick("");
                        setShowOverviewDateInput(false);
                        return;
                      }
                      setOverviewDayMode("picked");
                      setOverviewDatePick(next);
                    }}
                    type="date"
                    className="overview-date-input-visible"
                    aria-label="Pick attendance date"
                  />
                ) : null}
              </div>
              <select
                value={overviewRoleFilter}
                onChange={(event) => setOverviewRoleFilter(event.target.value)}
                className="overview-role-select"
                aria-label="Filter by role"
              >
                {OVERVIEW_ROLE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.value === "" ? "All roles" : opt.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary-btn slim overview-search-submit"
                onClick={() => void loadOverview()}
                disabled={busy}
              >
                {busy ? (
                  <span className="search-btn-content">
                    <span className="refresh-btn-spinner" aria-hidden="true" />
                    Searching…
                  </span>
                ) : (
                  "Search"
                )}
              </button>
              <button
                type="button"
                className="ghost-btn slim"
                onClick={() => void handleExportCsv("overview")}
                disabled={exportingView === "overview"}
              >
                {exportingView === "overview" ? "Exporting..." : "Export CSV"}
              </button>
              {overviewAppliedLine ? (
                <p className="overview-applied-line">{overviewAppliedLine}</p>
              ) : null}
            </section>

            <section className="table-card">
              <div className="table-head">
                <h2>Attendance Logs</h2>
                <span>
                  {filteredCount} record{filteredCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="table-wrap">
                <table className="overview-logs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Unique ID</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Purpose</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Image</th>
                      <th>Delete Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty-row">
                          No records found.
                        </td>
                      </tr>
                    ) : (
                      logsPagedRows.map((log) => (
                        <tr key={log.id}>
                          <td>{log.timestamp.time}</td>
                          <td>{log.uniqueId}</td>
                          <td>
                            <strong>{log.fullName}</strong>
                          </td>
                          <td>{log.category}</td>
                          <td>{log.purpose ?? "N/A"}</td>
                          <td>
                            <span
                              className={getAttendanceTypeBadgeClass(log.type)}
                            >
                              {log.type}
                            </span>
                          </td>
                          <td>
                            <span
                              className={getAttendanceStatusBadgeClass(
                                log.status,
                              )}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>
                            {log.hasImage ? (
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() => void openImage(log.imageUrl)}
                              >
                                View
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="text-btn danger"
                              disabled={deletingLogId === log.id}
                              onClick={() => void handleDeleteAttendance(log)}
                            >
                              {deletingLogId === log.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {logs.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {logsPageClamped} of {logsTotalPages} · {logs.length}{" "}
                    record
                    {logs.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={logsPageClamped <= 1}
                      onClick={() => setLogsListPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={logsPageClamped >= logsTotalPages}
                      onClick={() =>
                        setLogsListPage((p) => Math.min(logsTotalPages, p + 1))
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {view === "users" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>Users Data</h2>
            </div>
            <div className="user-generator-body">
              {!showAddUserForm ? (
                <div className="users-form-launch">
                  <button
                    type="button"
                    className="primary-btn slim"
                    onClick={() => {
                      setShowAddUserForm(true);
                      setScheduleMode("all-days");
                      setAddUserMessageIsError(false);
                      setAddUserMessage("");
                    }}
                  >
                    Add User
                  </button>
                </div>
              ) : (
                <form
                  className="users-add-form detailed"
                  onSubmit={handleAddUserData}
                >
                  <input
                    className="search-input"
                    placeholder="Gmail"
                    value={addUserForm.email}
                    onChange={(event) =>
                      setAddUserForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    type="email"
                    required
                  />
                  <select
                    className="search-input"
                    value={addUserForm.role}
                    onChange={(event) =>
                      handleAddUserRoleChange(event.target.value)
                    }
                    required
                  >
                    <option value="">Select role</option>
                    {USER_ROLE_OPTIONS.map((roleOption) => (
                      <option key={roleOption.value} value={roleOption.value}>
                        {roleOption.label}
                      </option>
                    ))}
                  </select>
                  {isAdminRole(addUserForm.role) ? (
                    <label className="admin-schedule-toggle">
                      <input
                        type="checkbox"
                        checked={disableScheduleForAdmin}
                        onChange={(event) =>
                          setDisableScheduleForAdmin(event.target.checked)
                        }
                      />
                      Disable attendance schedule for admin
                    </label>
                  ) : null}
                  <input
                    className="search-input"
                    placeholder="Name"
                    value={addUserForm.fullName}
                    onChange={(event) =>
                      setAddUserForm((prev) => ({
                        ...prev,
                        fullName: event.target.value,
                      }))
                    }
                    required
                  />
                  <input
                    className="search-input"
                    placeholder="Unique ID"
                    value={addUserForm.uniqueId}
                    onChange={(event) =>
                      setAddUserForm((prev) => ({
                        ...prev,
                        uniqueId: event.target.value,
                      }))
                    }
                  />
                  <div className="schedule-editor">
                    {isAdminRole(addUserForm.role) &&
                    disableScheduleForAdmin ? (
                      <div className="schedule-disabled-note">
                        Attendance schedule is disabled for admin users.
                      </div>
                    ) : (
                      <>
                        <div className="schedule-head">
                          <strong>Attendance Schedule (Mon-Fri)</strong>
                          <div className="schedule-head-actions">
                            <button
                              type="button"
                              className={
                                scheduleMode === "all-days"
                                  ? "ghost-btn active-schedule-mode"
                                  : "ghost-btn"
                              }
                              onClick={applyScheduleToAllWeekdays}
                            >
                              Apply to All Weekdays
                            </button>
                            <button
                              type="button"
                              className={
                                scheduleMode === "custom"
                                  ? "ghost-btn active-schedule-mode"
                                  : "ghost-btn"
                              }
                              onClick={() => {
                                setScheduleMode("custom");
                                if (
                                  addUserForm.attendanceSchedule.length === 0
                                ) {
                                  setAddUserForm((prev) => ({
                                    ...prev,
                                    attendanceSchedule: [
                                      {
                                        day: "mon",
                                        startTime: "09:00",
                                        endTime: "17:00",
                                      },
                                    ],
                                  }));
                                }
                              }}
                            >
                              Add Custom Day
                            </button>
                          </div>
                        </div>
                        {scheduleMode === "all-days" ? (
                          <div className="schedule-row all-days-row">
                            <div className="all-days-label">Mon - Fri</div>
                            <input
                              type="time"
                              value={allDaysSchedule.startTime}
                              onChange={(event) =>
                                setAllDaysSchedule((prev) => ({
                                  ...prev,
                                  startTime: event.target.value,
                                }))
                              }
                              required
                            />
                            <input
                              type="time"
                              value={allDaysSchedule.endTime}
                              onChange={(event) =>
                                setAllDaysSchedule((prev) => ({
                                  ...prev,
                                  endTime: event.target.value,
                                }))
                              }
                              required
                            />
                          </div>
                        ) : (
                          <>
                            {addUserForm.attendanceSchedule.map(
                              (slot, index) => (
                                <div
                                  className="schedule-row"
                                  key={`${slot.day}-${index}`}
                                >
                                  <select
                                    value={slot.day}
                                    onChange={(event) =>
                                      updateAddUserSchedule(
                                        index,
                                        "day",
                                        event.target.value,
                                      )
                                    }
                                  >
                                    {WEEKDAY_OPTIONS.map((weekdayOption) => (
                                      <option
                                        key={weekdayOption.value}
                                        value={weekdayOption.value}
                                      >
                                        {weekdayOption.label}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="time"
                                    value={slot.startTime}
                                    onChange={(event) =>
                                      updateAddUserSchedule(
                                        index,
                                        "startTime",
                                        event.target.value,
                                      )
                                    }
                                    required
                                  />
                                  <input
                                    type="time"
                                    value={slot.endTime}
                                    onChange={(event) =>
                                      updateAddUserSchedule(
                                        index,
                                        "endTime",
                                        event.target.value,
                                      )
                                    }
                                    required
                                  />
                                  <button
                                    type="button"
                                    className="ghost-btn danger"
                                    onClick={() => removeScheduleSlot(index)}
                                    disabled={
                                      addUserForm.attendanceSchedule.length ===
                                      1
                                    }
                                  >
                                    Remove
                                  </button>
                                </div>
                              ),
                            )}
                            <button
                              type="button"
                              className="ghost-btn add-custom-day-btn"
                              onClick={addScheduleSlot}
                              disabled={
                                addUserForm.attendanceSchedule.length >= 5
                              }
                            >
                              Add One More Day
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="users-add-actions">
                    <button
                      type="submit"
                      className="primary-btn slim"
                      disabled={addUserBusy}
                    >
                      {addUserBusy ? "Adding..." : "Create User"}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setShowAddUserForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {addUserMessage ? (
                <div
                  className={`notice ${addUserMessageIsError ? "error" : "success"}`}
                >
                  {addUserMessage}
                </div>
              ) : null}
              <section className="filters-bar compact-filters monthly-inline-filters">
                <input
                  value={usersSearch}
                  onChange={(event) => setUsersSearch(event.target.value)}
                  placeholder="Search users by name, role, id, email"
                  className="search-input"
                />
                <select
                  value={usersRoleFilter}
                  onChange={(event) => setUsersRoleFilter(event.target.value)}
                  className="search-input"
                  aria-label="Filter users by role"
                >
                  {OVERVIEW_ROLE_FILTER_OPTIONS.map((opt) => (
                    <option
                      key={`users-${opt.value || "all"}`}
                      value={opt.value}
                    >
                      {opt.value === "" ? "All roles" : opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-btn slim overview-search-submit"
                  onClick={() => void loadUsersData()}
                  disabled={usersBusy}
                >
                  {usersBusy ? (
                    <span className="search-btn-content">
                      <span
                        className="refresh-btn-spinner"
                        aria-hidden="true"
                      />
                      Searching…
                    </span>
                  ) : (
                    "Search"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-btn slim"
                  onClick={() => void handleExportCsv("users")}
                  disabled={exportingView === "users"}
                >
                  {exportingView === "users" ? "Exporting..." : "Export CSV"}
                </button>
              </section>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Gmail</th>
                      <th>Generated</th>
                      <th>Role</th>
                      <th>Name</th>
                      <th>Unique ID</th>
                      <th>Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersData.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-row">
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      usersPagedRows.map((row) => (
                        <tr key={row.email}>
                          <td>{row.email}</td>
                          <td>{row.generated ? "TRUE" : "FALSE"}</td>
                          <td>{row.role}</td>
                          <td>{row.fullName}</td>
                          <td>{row.uniqueId}</td>
                          <td>{row.isActive ? "Yes" : "No"}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() => openUserDetails(row)}
                              >
                                Details
                              </button>
                              <button
                                type="button"
                                className="text-btn danger-text"
                                onClick={() => void handleDeleteUser(row.email)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {usersData.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {usersPageClamped} of {usersTotalPages} ·{" "}
                    {usersData.length} user
                    {usersData.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={usersPageClamped <= 1}
                      onClick={() =>
                        setUsersListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={usersPageClamped >= usersTotalPages}
                      onClick={() =>
                        setUsersListPage((p) =>
                          Math.min(usersTotalPages, p + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}

              {userDetailsRow
                ? createPortal(
                    <div
                      className="admin-modal-backdrop"
                      role="presentation"
                      onClick={closeUserDetails}
                    >
                      <div
                        className="admin-modal-card"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="user-details-title"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="admin-modal-head">
                          <h3 id="user-details-title">User details</h3>
                          <button
                            type="button"
                            className="ghost-btn modal-close-btn"
                            onClick={closeUserDetails}
                            aria-label="Close"
                          >
                            ✕
                          </button>
                        </div>

                        {!userDetailsEditMode ? (
                          <div className="admin-modal-body">
                            <dl className="detail-dl">
                              <div>
                                <dt>Gmail</dt>
                                <dd>{userDetailsRow.email}</dd>
                              </div>
                              <div>
                                <dt>Generated</dt>
                                <dd>
                                  {userDetailsRow.generated ? "TRUE" : "FALSE"}
                                </dd>
                              </div>
                              <div>
                                <dt>Role</dt>
                                <dd>{userDetailsRow.role}</dd>
                              </div>
                              <div>
                                <dt>Name</dt>
                                <dd>{userDetailsRow.fullName}</dd>
                              </div>
                              <div>
                                <dt>Unique ID</dt>
                                <dd>{userDetailsRow.uniqueId}</dd>
                              </div>
                              <div>
                                <dt>Active</dt>
                                <dd>
                                  {userDetailsRow.isActive ? "Yes" : "No"}
                                </dd>
                              </div>
                              <div className="detail-dl-span">
                                <dt>Schedule</dt>
                                <dd>
                                  {renderUserScheduleReadOnly(userDetailsRow)}
                                </dd>
                              </div>
                            </dl>
                            <div className="admin-modal-actions">
                              <button
                                type="button"
                                className="primary-btn slim"
                                onClick={startEditInDetails}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="ghost-btn danger"
                                onClick={() =>
                                  void handleDeleteUser(userDetailsRow.email)
                                }
                              >
                                Delete user
                              </button>
                            </div>
                          </div>
                        ) : detailEditForm ? (
                          <form
                            className="admin-modal-body"
                            onSubmit={handleDetailSave}
                          >
                            <div className="users-add-form detailed modal-edit-form">
                              <input
                                className="search-input"
                                placeholder="Gmail"
                                value={detailEditForm.email}
                                onChange={(event) =>
                                  setDetailEditForm((prev) =>
                                    prev
                                      ? { ...prev, email: event.target.value }
                                      : prev,
                                  )
                                }
                                type="email"
                                required
                              />
                              <select
                                className="search-input"
                                value={detailEditForm.role}
                                onChange={(event) =>
                                  handleDetailRoleChange(event.target.value)
                                }
                                required
                              >
                                <option value="">Select role</option>
                                {USER_ROLE_OPTIONS.map((roleOption) => (
                                  <option
                                    key={roleOption.value}
                                    value={roleOption.value}
                                  >
                                    {roleOption.label}
                                  </option>
                                ))}
                              </select>
                              {isAdminRole(detailEditForm.role) ? (
                                <label className="admin-schedule-toggle">
                                  <input
                                    type="checkbox"
                                    checked={detailDisableScheduleForAdmin}
                                    onChange={(event) =>
                                      setDetailDisableScheduleForAdmin(
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  Disable attendance schedule for admin
                                </label>
                              ) : null}
                              <input
                                className="search-input"
                                placeholder="Name"
                                value={detailEditForm.fullName}
                                onChange={(event) =>
                                  setDetailEditForm((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          fullName: event.target.value,
                                        }
                                      : prev,
                                  )
                                }
                                required
                              />
                              <input
                                className="search-input"
                                placeholder="Unique ID"
                                value={detailEditForm.uniqueId}
                                onChange={(event) =>
                                  setDetailEditForm((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          uniqueId: event.target.value,
                                        }
                                      : prev,
                                  )
                                }
                              />
                              <label className="edit-active-toggle">
                                <input
                                  type="checkbox"
                                  checked={detailEditForm.isActive}
                                  onChange={(event) =>
                                    setDetailEditForm((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            isActive: event.target.checked,
                                          }
                                        : prev,
                                    )
                                  }
                                />
                                Active
                              </label>
                              <div className="schedule-editor">
                                <div className="schedule-head">
                                  <strong>Attendance schedule</strong>
                                  <div className="schedule-head-actions">
                                    <button
                                      type="button"
                                      className={
                                        detailEditForm.scheduleMode ===
                                        "all-days"
                                          ? "ghost-btn active-schedule-mode"
                                          : "ghost-btn"
                                      }
                                      onClick={() =>
                                        setDetailEditForm((prev) => {
                                          if (!prev) return prev;
                                          if (
                                            isAdminRole(prev.role) &&
                                            detailDisableScheduleForAdmin
                                          ) {
                                            return prev;
                                          }
                                          return {
                                            ...prev,
                                            scheduleMode: "all-days",
                                          };
                                        })
                                      }
                                      disabled={
                                        isAdminRole(detailEditForm.role) &&
                                        detailDisableScheduleForAdmin
                                      }
                                    >
                                      Apply to all weekdays
                                    </button>
                                    <button
                                      type="button"
                                      className={
                                        detailEditForm.scheduleMode === "custom"
                                          ? "ghost-btn active-schedule-mode"
                                          : "ghost-btn"
                                      }
                                      onClick={() =>
                                        setDetailEditForm((prev) => {
                                          if (!prev) return prev;
                                          if (
                                            isAdminRole(prev.role) &&
                                            detailDisableScheduleForAdmin
                                          ) {
                                            return prev;
                                          }
                                          if (
                                            prev.attendanceSchedule.length === 0
                                          ) {
                                            return {
                                              ...prev,
                                              scheduleMode: "custom",
                                              attendanceSchedule: [
                                                {
                                                  day: "mon",
                                                  startTime: "09:00",
                                                  endTime: "17:00",
                                                },
                                              ],
                                            };
                                          }
                                          return {
                                            ...prev,
                                            scheduleMode: "custom",
                                          };
                                        })
                                      }
                                      disabled={
                                        isAdminRole(detailEditForm.role) &&
                                        detailDisableScheduleForAdmin
                                      }
                                    >
                                      Custom by day
                                    </button>
                                  </div>
                                </div>
                                {isAdminRole(detailEditForm.role) &&
                                detailDisableScheduleForAdmin ? (
                                  <div className="schedule-disabled-note">
                                    Attendance schedule is disabled for admin
                                    users.
                                  </div>
                                ) : detailEditForm.scheduleMode ===
                                  "all-days" ? (
                                  <div className="schedule-row all-days-row">
                                    <div className="all-days-label">
                                      Mon - Fri
                                    </div>
                                    <input
                                      type="time"
                                      value={
                                        detailEditForm.allDaysSchedule.startTime
                                      }
                                      onChange={(event) =>
                                        setDetailEditForm((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                allDaysSchedule: {
                                                  ...prev.allDaysSchedule,
                                                  startTime: event.target.value,
                                                },
                                              }
                                            : prev,
                                        )
                                      }
                                      required
                                    />
                                    <input
                                      type="time"
                                      value={
                                        detailEditForm.allDaysSchedule.endTime
                                      }
                                      onChange={(event) =>
                                        setDetailEditForm((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                allDaysSchedule: {
                                                  ...prev.allDaysSchedule,
                                                  endTime: event.target.value,
                                                },
                                              }
                                            : prev,
                                        )
                                      }
                                      required
                                    />
                                  </div>
                                ) : (
                                  <>
                                    {detailEditForm.attendanceSchedule.map(
                                      (slot, index) => (
                                        <div
                                          className="schedule-row"
                                          key={`${slot.day}-${index}`}
                                        >
                                          <select
                                            value={slot.day}
                                            onChange={(event) =>
                                              updateDetailScheduleSlot(
                                                index,
                                                "day",
                                                event.target.value,
                                              )
                                            }
                                          >
                                            {WEEKDAY_OPTIONS.map(
                                              (weekdayOption) => (
                                                <option
                                                  key={weekdayOption.value}
                                                  value={weekdayOption.value}
                                                >
                                                  {weekdayOption.label}
                                                </option>
                                              ),
                                            )}
                                          </select>
                                          <input
                                            type="time"
                                            value={slot.startTime}
                                            onChange={(event) =>
                                              updateDetailScheduleSlot(
                                                index,
                                                "startTime",
                                                event.target.value,
                                              )
                                            }
                                            required
                                          />
                                          <input
                                            type="time"
                                            value={slot.endTime}
                                            onChange={(event) =>
                                              updateDetailScheduleSlot(
                                                index,
                                                "endTime",
                                                event.target.value,
                                              )
                                            }
                                            required
                                          />
                                          <button
                                            type="button"
                                            className="ghost-btn danger"
                                            onClick={() =>
                                              detailRemoveScheduleSlot(index)
                                            }
                                            disabled={
                                              detailEditForm.attendanceSchedule
                                                .length === 1
                                            }
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ),
                                    )}
                                    <button
                                      type="button"
                                      className="ghost-btn add-custom-day-btn"
                                      onClick={detailAddScheduleSlot}
                                      disabled={
                                        detailEditForm.attendanceSchedule
                                          .length >= 5
                                      }
                                    >
                                      Add day
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {detailModalMessage ? (
                              <div
                                className={`notice ${detailModalMessageIsError ? "error" : "success"} modal-notice`}
                              >
                                {detailModalMessage}
                              </div>
                            ) : null}
                            <div className="admin-modal-actions">
                              <button
                                type="submit"
                                className="primary-btn slim"
                                disabled={detailSaveBusy}
                              >
                                {detailSaveBusy ? "Saving…" : "Save changes"}
                              </button>
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={cancelEditInDetails}
                                disabled={detailSaveBusy}
                              >
                                Cancel edit
                              </button>
                            </div>
                          </form>
                        ) : null}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          </section>
        ) : null}

        {view === "generator" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>User Credentials Generation</h2>
              <span>Pending users (Generated = FALSE)</span>
            </div>
            <div className="user-generator-body">
              <div className="topbar-actions">
                <button
                  type="button"
                  className="primary-btn slim"
                  onClick={() => void handleGeneratePendingAll()}
                  disabled={generateBusy || pendingUsers.length === 0}
                >
                  {generateBusy ? "Generating..." : "Generate All Pending"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void loadUsersData()}
                >
                  Reload Pending
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Gmail</th>
                      <th>Role</th>
                      <th>Name</th>
                      <th>Unique ID</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-row">
                          No pending users. All credentials are generated.
                        </td>
                      </tr>
                    ) : (
                      pendingUsersPagedRows.map((row) => (
                        <tr key={row.email}>
                          <td>{row.email}</td>
                          <td>{row.role}</td>
                          <td>{row.fullName}</td>
                          <td>{row.uniqueId}</td>
                          <td>
                            <button
                              type="button"
                              className="primary-btn slim"
                              onClick={() => void handleGenerateSingle(row)}
                              disabled={generateBusy}
                            >
                              Generate Credentials
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {pendingUsers.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {pendingUsersPageClamped} of {pendingUsersTotalPages} ·{" "}
                    {pendingUsers.length} pending
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={pendingUsersPageClamped <= 1}
                      onClick={() =>
                        setPendingUsersListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={
                        pendingUsersPageClamped >= pendingUsersTotalPages
                      }
                      onClick={() =>
                        setPendingUsersListPage((p) =>
                          Math.min(pendingUsersTotalPages, p + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === "credentials" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>User Credentials</h2>
              <span>Generated credentials history</span>
            </div>
            <div className="user-generator-body">
              {selectedCredentialEmail ? (
                <div className="credential-password-panel">
                  <label className="field-label">
                    New Password for {selectedCredentialEmail}
                    <input
                      className="search-input"
                      value={newCredentialPassword}
                      onChange={(event) =>
                        setNewCredentialPassword(event.target.value)
                      }
                      type="text"
                      placeholder="Enter new password"
                    />
                  </label>
                  <div className="topbar-actions">
                    <button
                      type="button"
                      className="primary-btn slim"
                      onClick={() => void handleChangePassword()}
                      disabled={passwordBusy}
                    >
                      {passwordBusy ? "Updating..." : "Save Password"}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setSelectedCredentialEmail(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {passwordMessage ? (
                <div className="notice success">{passwordMessage}</div>
              ) : null}
              <section className="filters-bar compact-filters">
                <input
                  value={credentialsSearch}
                  onChange={(event) => setCredentialsSearch(event.target.value)}
                  placeholder="Search credentials by name, role, id, email"
                  className="search-input"
                />
                <select
                  value={credentialsRoleFilter}
                  onChange={(event) =>
                    setCredentialsRoleFilter(event.target.value)
                  }
                  className="search-input"
                  aria-label="Filter credentials by role"
                >
                  {OVERVIEW_ROLE_FILTER_OPTIONS.map((opt) => (
                    <option
                      key={`credentials-${opt.value || "all"}`}
                      value={opt.value}
                    >
                      {opt.value === "" ? "All roles" : opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-btn slim overview-search-submit"
                  onClick={() => void loadCredentials()}
                  disabled={credentialsBusy}
                >
                  {credentialsBusy ? (
                    <span className="search-btn-content">
                      <span
                        className="refresh-btn-spinner"
                        aria-hidden="true"
                      />
                      Searching…
                    </span>
                  ) : (
                    "Search"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-btn slim"
                  onClick={() => void handleExportCsv("credentials")}
                  disabled={exportingView === "credentials"}
                >
                  {exportingView === "credentials"
                    ? "Exporting..."
                    : "Export CSV"}
                </button>
              </section>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Gmail</th>
                      <th>Password</th>
                      <th>Role</th>
                      <th>Name</th>
                      <th>Unique ID</th>
                      <th>Status</th>
                      <th>Generated At</th>
                      <th>Generated By</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {credentialsData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty-row">
                          No credentials found.
                        </td>
                      </tr>
                    ) : (
                      credentialsPagedRows.map((row, index) => (
                        <tr key={`${row.email}-${row.generatedAt}-${index}`}>
                          <td>{row.email}</td>
                          <td>{row.password}</td>
                          <td>{row.role}</td>
                          <td>{row.fullName}</td>
                          <td>{row.uniqueId}</td>
                          <td>{row.status}</td>
                          <td>{new Date(row.generatedAt).toLocaleString()}</td>
                          <td>{row.generatedBy}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="text-btn action-btn"
                                onClick={() => {
                                  setSelectedCredentialEmail(row.email);
                                  setNewCredentialPassword("");
                                }}
                              >
                                Change Password
                              </button>
                              <button
                                type="button"
                                className="text-btn action-btn danger-text"
                                onClick={() =>
                                  void handleDeleteCredential(row.email)
                                }
                                disabled={passwordBusy}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {credentialsData.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {credentialsPageClamped} of {credentialsTotalPages} ·{" "}
                    {credentialsData.length} credential record
                    {credentialsData.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={credentialsPageClamped <= 1}
                      onClick={() =>
                        setCredentialsListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={credentialsPageClamped >= credentialsTotalPages}
                      onClick={() =>
                        setCredentialsListPage((p) =>
                          Math.min(credentialsTotalPages, p + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === "shifts" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>Timing / Shift (Today)</h2>
              <span>Schedule + marked attendance</span>
            </div>
            <div className="user-generator-body">
              <section className="filters-bar compact-filters monthly-inline-filters">
                <input
                  value={shiftsSearch}
                  onChange={(event) => setShiftsSearch(event.target.value)}
                  placeholder="Search users by name, role, id, email"
                  className="search-input"
                />
                <select
                  value={shiftsRoleFilter}
                  onChange={(event) => setShiftsRoleFilter(event.target.value)}
                  className="search-input"
                  aria-label="Filter shifts by role"
                >
                  {OVERVIEW_ROLE_FILTER_OPTIONS.map((opt) => (
                    <option
                      key={`shifts-${opt.value || "all"}`}
                      value={opt.value}
                    >
                      {opt.value === "" ? "All roles" : opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary-btn slim overview-search-submit"
                  onClick={() => void loadShifts()}
                  disabled={shiftsBusy}
                >
                  {shiftsBusy ? (
                    <span className="search-btn-content">
                      <span
                        className="refresh-btn-spinner"
                        aria-hidden="true"
                      />
                      Searching…
                    </span>
                  ) : (
                    "Search"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-btn slim"
                  onClick={() => void handleExportCsv("shifts")}
                  disabled={exportingView === "shifts"}
                >
                  {exportingView === "shifts" ? "Exporting..." : "Export CSV"}
                </button>
              </section>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Gmail</th>
                      <th>Unique ID</th>
                      <th>Shift In</th>
                      <th>Shift Out</th>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftsData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty-row">
                          No shift records found.
                        </td>
                      </tr>
                    ) : (
                      shiftsPagedRows.map((row) => (
                        <tr key={row.email}>
                          <td>
                            <strong>{row.fullName}</strong>
                            <small>{row.uniqueId}</small>
                          </td>
                          <td>{row.role}</td>
                          <td>{row.email}</td>
                          <td>{row.uniqueId}</td>
                          <td>{formatWallHm12h(row.shiftStart)}</td>
                          <td>{formatWallHm12h(row.shiftEnd)}</td>
                          <td>{row.timeInAt}</td>
                          <td>{row.timeOutAt}</td>
                          <td>
                            <span
                              className={
                                row.status.toLowerCase().includes("late")
                                  ? "badge red"
                                  : row.status.toLowerCase().includes("checked")
                                    ? "badge indigo"
                                    : row.status
                                          .toLowerCase()
                                          .includes("on time")
                                      ? "badge green"
                                      : "badge amber"
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {shiftsData.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {shiftsPageClamped} of {shiftsTotalPages} ·{" "}
                    {shiftsData.length} shift record
                    {shiftsData.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={shiftsPageClamped <= 1}
                      onClick={() =>
                        setShiftsListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={shiftsPageClamped >= shiftsTotalPages}
                      onClick={() =>
                        setShiftsListPage((p) =>
                          Math.min(shiftsTotalPages, p + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === "attendance" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>Monthly Attendance</h2>
              <span>{monthlyMonth}</span>
            </div>
            <div className="user-generator-body">
              <section className="filters-bar compact-filters">
                <input
                  value={monthlySearch}
                  onChange={(event) => setMonthlySearch(event.target.value)}
                  placeholder="Search users by name, role, id, email"
                  className="search-input"
                />
                <select
                  value={monthlyRoleFilter}
                  onChange={(event) => setMonthlyRoleFilter(event.target.value)}
                  className="search-input"
                  aria-label="Filter monthly attendance by role"
                >
                  {OVERVIEW_ROLE_FILTER_OPTIONS.map((opt) => (
                    <option
                      key={`monthly-${opt.value || "all"}`}
                      value={opt.value}
                    >
                      {opt.value === "" ? "All roles" : opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={monthlyMonth}
                  onChange={(event) => setMonthlyMonth(event.target.value)}
                  className="date-input"
                >
                  {monthlyMonths.length === 0 ? (
                    <option value={monthlyMonth}>{monthlyMonth}</option>
                  ) : (
                    monthlyMonths.map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="primary-btn slim overview-search-submit"
                  onClick={() => void loadMonthlyAttendance()}
                  disabled={monthlyBusy}
                >
                  {monthlyBusy ? (
                    <span className="search-btn-content">
                      <span
                        className="refresh-btn-spinner"
                        aria-hidden="true"
                      />
                      Searching…
                    </span>
                  ) : (
                    "Search"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void handleExportCsv("attendance")}
                  disabled={exportingView === "attendance"}
                >
                  {exportingView === "attendance"
                    ? "Exporting..."
                    : "Export CSV"}
                </button>
              </section>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Gmail</th>
                      <th>Total Weekdays</th>
                      <th>Present</th>
                      <th>Absent</th>
                      <th>Late</th>
                      <th>Late→Absent</th>
                      <th>Effective Present</th>
                      <th>Effective Absent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="empty-row">
                          No monthly attendance found.
                        </td>
                      </tr>
                    ) : (
                      monthlyPagedRows.map((row) => (
                        <tr key={`${row.month}-${row.email}`}>
                          <td>
                            <strong>{row.fullName}</strong>
                            <small>{row.uniqueId}</small>
                          </td>
                          <td>{row.role}</td>
                          <td>{row.email}</td>
                          <td>{row.totalWeekdays}</td>
                          <td>{row.presentDays}</td>
                          <td>{row.absentDays}</td>
                          <td>{row.lateDays}</td>
                          <td>{row.latePenaltyAbsents}</td>
                          <td>
                            <span className="badge green">
                              {row.effectivePresent}
                            </span>
                          </td>
                          <td>
                            <span className="badge amber">
                              {row.effectiveAbsent}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {monthlyData.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {monthlyPageClamped} of {monthlyTotalPages} ·{" "}
                    {monthlyData.length} monthly record
                    {monthlyData.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={monthlyPageClamped <= 1}
                      onClick={() =>
                        setMonthlyListPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={monthlyPageClamped >= monthlyTotalPages}
                      onClick={() =>
                        setMonthlyListPage((p) =>
                          Math.min(monthlyTotalPages, p + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="notice info">
                3 Late days are counted as 1 Absent day in Effective totals.
              </div>
            </div>
          </section>
        ) : null}

        {view === "manual-attendance" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>Manual Attendance</h2>
              <span>{manualDate}</span>
            </div>
            <div className="user-generator-body">
              <section className="filters-bar compact-filters monthly-inline-filters">
                <input
                  value={manualSearch}
                  onChange={(event) => setManualSearch(event.target.value)}
                  placeholder="Search users by name, role, id, email"
                  className="search-input"
                />
                <select
                  value={manualRoleFilter}
                  onChange={(event) => setManualRoleFilter(event.target.value)}
                  className="search-input"
                  aria-label="Filter manual attendance by role"
                >
                  {MANUAL_ROLE_FILTER_OPTIONS.map((opt) => (
                    <option key={`manual-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <input
                  value={manualDate}
                  onChange={(event) => setManualDate(event.target.value)}
                  type="date"
                  className="overview-date-input-visible"
                />
                <button
                  type="button"
                  className="primary-btn slim overview-search-submit"
                  onClick={() => void loadManualAttendance()}
                  disabled={manualBusy}
                >
                  {manualBusy ? (
                    <span className="search-btn-content">
                      <span
                        className="refresh-btn-spinner"
                        aria-hidden="true"
                      />
                      Searching…
                    </span>
                  ) : (
                    "Search"
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-btn slim"
                  onClick={() => void handleExportCsv("manual-attendance")}
                  disabled={exportingView === "manual-attendance"}
                >
                  {exportingView === "manual-attendance"
                    ? "Exporting..."
                    : "Export CSV"}
                </button>
              </section>

              {manualMessage ? (
                <div
                  className={`notice ${manualMessageIsError ? "error" : "success"}`}
                >
                  {manualMessage}
                </div>
              ) : null}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Unique ID</th>
                      <th>Role</th>
                      <th>Attendance</th>
                      <th>Reason</th>
                      <th>Marked By Admin</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualData.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-row">
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      manualPagedRows.map((row) => (
                        <tr key={row.userId}>
                          <td>
                            <strong>{row.fullName}</strong>
                            <small>{row.email}</small>
                          </td>
                          <td>{row.uniqueId}</td>
                          <td>{row.role}</td>
                          <td>
                            <span
                              className={
                                row.attendance === "Present"
                                  ? "badge green"
                                  : row.attendance === "Late"
                                    ? "badge amber"
                                    : "badge red"
                              }
                            >
                              {row.attendance}
                            </span>
                          </td>
                          <td>{row.reason || "—"}</td>
                          <td>
                            <span
                              className={
                                row.markedByAdmin
                                  ? "badge amber"
                                  : "badge green"
                              }
                            >
                              {row.markedByAdmin ? "Yes" : "No"}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="text-btn"
                                onClick={() => openManualEdit(row)}
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {manualData.length > 0 ? (
                <div className="users-pagination">
                  <span className="users-pagination-meta">
                    Page {manualPageClamped} of {manualTotalPages} ·{" "}
                    {manualData.length} user{manualData.length === 1 ? "" : "s"}
                  </span>
                  <div className="users-pagination-actions">
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={manualPageClamped <= 1}
                      onClick={() =>
                        setManualListPage((page) => Math.max(1, page - 1))
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ghost-btn slim"
                      disabled={manualPageClamped >= manualTotalPages}
                      onClick={() =>
                        setManualListPage((page) =>
                          Math.min(manualTotalPages, page + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="notice info">
                Manual save removes the selected day&apos;s auto Time In / Time
                Out logs and keeps only the admin-marked record.
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {manualEditForm
        ? createPortal(
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={closeManualEdit}
            >
              <div
                className="admin-modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-attendance-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="admin-modal-head">
                  <h3 id="manual-attendance-title">Manual Attendance</h3>
                  <button
                    type="button"
                    className="ghost-btn modal-close-btn"
                    onClick={closeManualEdit}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <form className="admin-modal-body" onSubmit={handleManualSave}>
                  <dl className="detail-dl">
                    <div>
                      <dt>Name</dt>
                      <dd>{manualEditForm.fullName}</dd>
                    </div>
                    <div>
                      <dt>Gmail</dt>
                      <dd>{manualEditForm.email}</dd>
                    </div>
                    <div>
                      <dt>Unique ID</dt>
                      <dd>{manualEditForm.uniqueId}</dd>
                    </div>
                    <div>
                      <dt>Role</dt>
                      <dd>{manualEditForm.role}</dd>
                    </div>
                  </dl>
                  <div className="users-add-form detailed modal-edit-form">
                    <input
                      className="search-input"
                      type="date"
                      value={manualEditForm.date}
                      disabled
                      required
                    />
                    <select
                      className="search-input"
                      value={manualEditForm.attendance}
                      onChange={(event) =>
                        setManualEditForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                attendance: event.target.value as
                                  | "Present"
                                  | "Absent"
                                  | "Late",
                              }
                            : prev,
                        )
                      }
                      required
                    >
                      <option value="Present">Present</option>
                      <option value="Absent">Absent</option>
                      <option value="Late">Late</option>
                    </select>
                    <label className="field-label">
                      Reason
                      <textarea
                        className="search-input"
                        rows={4}
                        value={manualEditForm.reason}
                        onChange={(event) =>
                          setManualEditForm((prev) =>
                            prev
                              ? { ...prev, reason: event.target.value }
                              : prev,
                          )
                        }
                        placeholder="Write the reason for this manual attendance update"
                        required
                      />
                    </label>
                  </div>
                  {manualMessage ? (
                    <div
                      className={`notice ${manualMessageIsError ? "error" : "success"}`}
                    >
                      {manualMessage}
                    </div>
                  ) : null}
                  <div className="admin-modal-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={closeManualEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="primary-btn slim"
                      disabled={manualSaveBusy}
                    >
                      {manualSaveBusy ? "Saving..." : "Save Attendance"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}

      {selectedImage ? (
        <div className="modal-backdrop" onClick={() => setSelectedImage(null)}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="close-btn"
              onClick={() => setSelectedImage(null)}
            >
              ×
            </button>
            <img src={selectedImage} alt="Attendance capture" />
          </div>
        </div>
      ) : null}

      {confirmModal ? (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => closeConfirmModal(false)}
        >
          <div
            className="admin-modal-card confirm-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-modal-head">
              <h3 id="confirm-modal-title">{confirmModal.title}</h3>
            </div>
            <div className="admin-modal-body confirm-modal-body">
              <p>{confirmModal.message}</p>
            </div>
            <div className="admin-modal-actions">
              {confirmModal.cancelLabel ? (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => closeConfirmModal(false)}
                >
                  {confirmModal.cancelLabel}
                </button>
              ) : null}
              <button
                type="button"
                className={
                  confirmModal.danger ? "ghost-btn danger" : "primary-btn slim"
                }
                onClick={() => closeConfirmModal(true)}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
