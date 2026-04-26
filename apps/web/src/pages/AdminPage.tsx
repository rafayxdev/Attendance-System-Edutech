import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { API_URL, apiRequest } from "../api/client";
import { clearSession, readSession } from "../auth/session";
import { AccessGate } from "../components/AccessGate";
import { MetricCard } from "../components/MetricCard";
import type { AccessPolicy, AttendanceLogRow, AuthSession } from "../types";

interface AdminPageProps {
  onSessionChange: (session: AuthSession | null) => void;
}

type AdminView = "overview" | "users" | "generator" | "credentials";

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
  isActive: boolean;
  createdAt: string;
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

export function AdminPage({ onSessionChange }: AdminPageProps) {
  const session = readSession();

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

  const [stats, setStats] = useState({
    present: 0,
    late: 0,
    outside: 0,
    timeouts: 0,
  });
  const [logs, setLogs] = useState<AttendanceLogRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"today" | "yesterday" | "all">("today");
  const [date, setDate] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sheetInput, setSheetInput] = useState("");
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateMessage, setGenerateMessage] = useState("");
  const [generatedRows, setGeneratedRows] = useState<BulkUserResult[]>([]);

  const [usersSearch, setUsersSearch] = useState("");
  const [usersData, setUsersData] = useState<UserDataRow[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);

  const [credentialsSearch, setCredentialsSearch] = useState("");
  const [credentialsData, setCredentialsData] = useState<CredentialRow[]>([]);
  const [credentialsBusy, setCredentialsBusy] = useState(false);

  function parseSheetRows(rawText: string): BulkUserRow[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const firstCells = lines[0]!
      .split(/\t|,/)
      .map((cell) => cell.trim().toLowerCase());
    const hasHeader =
      firstCells.includes("gmail") || firstCells.includes("email");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines
      .map((line) => {
        const cells = line.includes("\t") ? line.split("\t") : line.split(",");
        const [
          email = "",
          generated = "TRUE",
          role = "",
          fullName = "",
          uniqueId = "",
        ] = cells.map((cell) => cell.trim());
        return {
          email,
          role,
          fullName,
          uniqueId: uniqueId || null,
          generated: ["true", "1", "yes"].includes(generated.toLowerCase()),
        };
      })
      .filter((row) => row.email && row.role && row.fullName);
  }

  async function loadOverview() {
    setBusy(true);
    try {
      const statsResult = await apiRequest<{
        present: number;
        late: number;
        outside: number;
        timeouts: number;
      }>("/admin/stats");
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (filter !== "all") query.set("filter", filter);
      if (date) query.set("date", date);
      const logsResult = await apiRequest<AttendanceLogRow[]>(
        `/admin/logs?${query.toString()}`,
      );
      setStats(statsResult);
      setLogs(logsResult);
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
      const rows = await apiRequest<UserDataRow[]>(
        `/admin/users-data?${query.toString()}`,
      );
      setUsersData(rows);
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
      const rows = await apiRequest<CredentialRow[]>(
        `/admin/users-credentials?${query.toString()}`,
      );
      setCredentialsData(rows);
    } catch (error) {
      console.error(error);
    } finally {
      setCredentialsBusy(false);
    }
  }

  async function handleBulkGenerate() {
    const rows = parseSheetRows(sheetInput);
    if (rows.length === 0) {
      setGenerateMessage(
        "Paste sheet rows first. Expected columns: Gmail, Generated, Role, Name, Unique ID.",
      );
      setGeneratedRows([]);
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

      setGeneratedRows(result.results);
      setGenerateMessage(
        `Processed ${result.processed} row(s). Credentials are also saved in User Credentials page.`,
      );
      await Promise.all([loadUsersData(), loadCredentials()]);
    } catch (error) {
      setGenerateMessage(
        error instanceof Error ? error.message : "Failed to generate users.",
      );
      setGeneratedRows([]);
    } finally {
      setGenerateBusy(false);
    }
  }

  useEffect(() => {
    if (view === "overview") {
      void loadOverview();
    }
  }, [view, filter, date]);

  const filteredCount = useMemo(() => logs.length, [logs]);

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

  async function exportCsv() {
    const token = sessionStorage.getItem("et_token") || "";
    const response = await fetch(`${API_URL}/admin/export-csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (!response.ok) {
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "attendance-logs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-shell admin-shell">
      <div className="page-bg admin-bg" />
      <main className="workspace-card glass-card">
        <header className="topbar">
          <div>
            <h1>Admin Dashboard</h1>
            <p>
              {session.name} · {session.email}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void exportCsv()}
            >
              Export CSV
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

        <section className="admin-nav-tabs role-tabs">
          <button
            type="button"
            className={view === "overview" ? "role-tab active" : "role-tab"}
            onClick={() => setView("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={view === "users" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("users");
              void loadUsersData();
            }}
          >
            Users Data
          </button>
          <button
            type="button"
            className={view === "generator" ? "role-tab active" : "role-tab"}
            onClick={() => setView("generator")}
          >
            Credentials Generation
          </button>
          <button
            type="button"
            className={view === "credentials" ? "role-tab active" : "role-tab"}
            onClick={() => {
              setView("credentials");
              void loadCredentials();
            }}
          >
            User Credentials
          </button>
        </section>

        {view === "overview" ? (
          <>
            <section className="stats-grid">
              <MetricCard
                label="Present Today"
                value={stats.present}
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
                label="Checked Out"
                value={stats.timeouts}
                accent="green"
                icon="✅"
              />
            </section>

            <section className="filters-bar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, category, status, IP..."
                className="search-input"
              />
              <div className="filter-row">
                <button
                  type="button"
                  className={filter === "today" ? "pill active" : "pill"}
                  onClick={() => setFilter("today")}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={filter === "yesterday" ? "pill active" : "pill"}
                  onClick={() => setFilter("yesterday")}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  className={filter === "all" ? "pill active" : "pill"}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
              </div>
              <input
                value={date}
                onChange={(event) => setDate(event.target.value)}
                type="date"
                className="date-input"
              />
              <button
                type="button"
                className="primary-btn slim"
                onClick={() => void loadOverview()}
                disabled={busy}
              >
                Search
              </button>
            </section>

            <section className="table-card">
              <div className="table-head">
                <h2>Attendance Logs</h2>
                <span>
                  {filteredCount} record{filteredCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>ID</th>
                      <th>Full Name</th>
                      <th>Category</th>
                      <th>Type</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>IP</th>
                      <th>Image</th>
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
                      logs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.timestamp.time}</td>
                          <td>{log.uniqueId}</td>
                          <td>
                            <strong>{log.fullName}</strong>
                            <small>{log.email}</small>
                          </td>
                          <td>{log.category}</td>
                          <td>
                            <span
                              className={
                                log.type === "Time In"
                                  ? "badge green"
                                  : "badge indigo"
                              }
                            >
                              {log.type}
                            </span>
                          </td>
                          <td>{log.location}</td>
                          <td>
                            <span
                              className={
                                log.status === "Late"
                                  ? "badge red"
                                  : "badge green"
                              }
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>
                            <code>{log.ip}</code>
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
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}

        {view === "users" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>Users Data</h2>
              <span>Gmail, Generated, Role, Name, Unique ID</span>
            </div>
            <div className="user-generator-body">
              <section className="filters-bar compact-filters">
                <input
                  value={usersSearch}
                  onChange={(event) => setUsersSearch(event.target.value)}
                  placeholder="Search users by name, role, id, email"
                  className="search-input"
                />
                <button
                  type="button"
                  className="primary-btn slim"
                  onClick={() => void loadUsersData()}
                  disabled={usersBusy}
                >
                  Search
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
                    </tr>
                  </thead>
                  <tbody>
                    {usersData.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      usersData.map((row) => (
                        <tr key={row.email}>
                          <td>{row.email}</td>
                          <td>{row.generated ? "TRUE" : "FALSE"}</td>
                          <td>{row.role}</td>
                          <td>{row.fullName}</td>
                          <td>{row.uniqueId}</td>
                          <td>{row.isActive ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {view === "generator" ? (
          <section className="table-card user-generator-card">
            <div className="table-head">
              <h2>User Credentials Generation</h2>
              <span>Paste rows from EmailsUser sheet</span>
            </div>
            <div className="user-generator-body">
              <label className="field-label">
                Sheet Rows (tab-separated or comma-separated)
                <textarea
                  className="sheet-input"
                  value={sheetInput}
                  onChange={(event) => setSheetInput(event.target.value)}
                  placeholder={
                    "Gmail\tGenerated\tRole\tName\tUnique ID\nuser@gmail.com\tTRUE\tStudent\tAsad Iqbal\tST-01"
                  }
                />
              </label>
              <div className="topbar-actions">
                <button
                  type="button"
                  className="primary-btn slim"
                  onClick={() => void handleBulkGenerate()}
                  disabled={generateBusy}
                >
                  {generateBusy
                    ? "Generating..."
                    : "Generate Users & Passwords"}
                </button>
              </div>
              {generateMessage ? (
                <div className="notice success">{generateMessage}</div>
              ) : null}
              {generatedRows.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Unique ID</th>
                        <th>Status</th>
                        <th>Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generatedRows.map((row, index) => (
                        <tr key={`${row.email}-${index}`}>
                          <td>{row.email}</td>
                          <td>{row.fullName}</td>
                          <td>{row.role}</td>
                          <td>{row.uniqueId || "N/A"}</td>
                          <td>{row.status}</td>
                          <td>{row.password || row.reason || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
              <section className="filters-bar compact-filters">
                <input
                  value={credentialsSearch}
                  onChange={(event) => setCredentialsSearch(event.target.value)}
                  placeholder="Search credentials by name, role, id, email"
                  className="search-input"
                />
                <button
                  type="button"
                  className="primary-btn slim"
                  onClick={() => void loadCredentials()}
                  disabled={credentialsBusy}
                >
                  Search
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
                    </tr>
                  </thead>
                  <tbody>
                    {credentialsData.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty-row">
                          No credentials found.
                        </td>
                      </tr>
                    ) : (
                      credentialsData.map((row, index) => (
                        <tr key={`${row.email}-${row.generatedAt}-${index}`}>
                          <td>{row.email}</td>
                          <td>{row.password}</td>
                          <td>{row.role}</td>
                          <td>{row.fullName}</td>
                          <td>{row.uniqueId}</td>
                          <td>{row.status}</td>
                          <td>{new Date(row.generatedAt).toLocaleString()}</td>
                          <td>{row.generatedBy}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </main>

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
    </div>
  );
}
