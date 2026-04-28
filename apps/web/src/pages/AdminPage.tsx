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

type AddUserDataForm = {
  email: string;
  role: string;
  fullName: string;
  uniqueId: string;
};

type EditUserDataForm = AddUserDataForm & {
  isActive: boolean;
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

  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateMessage, setGenerateMessage] = useState("");

  const [usersSearch, setUsersSearch] = useState("");
  const [usersData, setUsersData] = useState<UserDataRow[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [addUserMessage, setAddUserMessage] = useState("");
  const [addUserForm, setAddUserForm] = useState<AddUserDataForm>({
    email: "",
    role: "",
    fullName: "",
    uniqueId: "",
  });
  const [editUserBusy, setEditUserBusy] = useState(false);
  const [editUserMessage, setEditUserMessage] = useState("");
  const [editingUserEmail, setEditingUserEmail] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState<EditUserDataForm>({
    email: "",
    role: "",
    fullName: "",
    uniqueId: "",
    isActive: true,
  });

  const [credentialsSearch, setCredentialsSearch] = useState("");
  const [credentialsData, setCredentialsData] = useState<CredentialRow[]>([]);
  const [credentialsBusy, setCredentialsBusy] = useState(false);
  const [selectedCredentialEmail, setSelectedCredentialEmail] = useState<
    string | null
  >(null);
  const [newCredentialPassword, setNewCredentialPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");

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

  async function handleAddUserData(event: React.FormEvent) {
    event.preventDefault();

    setAddUserBusy(true);
    setAddUserMessage("");
    try {
      await apiRequest<{ success: boolean }>("/admin/users-data", {
        method: "POST",
        body: JSON.stringify({
          email: addUserForm.email.trim().toLowerCase(),
          role: addUserForm.role.trim(),
          fullName: addUserForm.fullName.trim(),
          uniqueId: addUserForm.uniqueId.trim() || null,
          isActive: true,
        }),
      });

      setAddUserMessage(
        "User added successfully. Credentials are pending generation.",
      );
      setAddUserForm({ email: "", role: "", fullName: "", uniqueId: "" });
      await loadUsersData();
    } catch (error) {
      setAddUserMessage(
        error instanceof Error ? error.message : "Failed to add user.",
      );
    } finally {
      setAddUserBusy(false);
    }
  }

  function startEditUser(row: UserDataRow) {
    setEditingUserEmail(row.email);
    setEditUserForm({
      email: row.email,
      role: row.role,
      fullName: row.fullName,
      uniqueId: row.uniqueId === "N/A" ? "" : row.uniqueId,
      isActive: row.isActive,
    });
    setEditUserMessage("");
  }

  async function handleEditUser(event: React.FormEvent) {
    event.preventDefault();
    if (!editingUserEmail) return;

    setEditUserBusy(true);
    setEditUserMessage("");
    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-data/${encodeURIComponent(editingUserEmail)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            email: editUserForm.email.trim().toLowerCase(),
            role: editUserForm.role.trim(),
            fullName: editUserForm.fullName.trim(),
            uniqueId: editUserForm.uniqueId.trim() || null,
            isActive: editUserForm.isActive,
          }),
        },
      );

      setEditUserMessage("User updated successfully.");
      setEditingUserEmail(null);
      await loadUsersData();
    } catch (error) {
      setEditUserMessage(
        error instanceof Error ? error.message : "Failed to update user.",
      );
    } finally {
      setEditUserBusy(false);
    }
  }

  async function handleDeleteUser(email: string) {
    const confirmDelete = window.confirm(
      `Delete ${email}? This will remove the user record.`,
    );
    if (!confirmDelete) return;

    try {
      await apiRequest<{ success: boolean }>(
        `/admin/users-data/${encodeURIComponent(email)}`,
        {
          method: "DELETE",
        },
      );
      if (editingUserEmail === email) {
        setEditingUserEmail(null);
      }
      await loadUsersData();
    } catch (error) {
      setEditUserMessage(
        error instanceof Error ? error.message : "Failed to delete user.",
      );
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

  useEffect(() => {
    if (view === "overview") {
      void loadOverview();
    }
  }, [view, filter, date]);

  const filteredCount = useMemo(() => logs.length, [logs]);
  const pendingUsers = useMemo(
    () => usersData.filter((row) => !row.generated),
    [usersData],
  );

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
            onClick={() => {
              setView("generator");
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
              {editingUserEmail ? (
                <form
                  className="users-add-form edit-form"
                  onSubmit={handleEditUser}
                >
                  <input
                    className="search-input"
                    placeholder="Gmail"
                    value={editUserForm.email}
                    onChange={(event) =>
                      setEditUserForm((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    type="email"
                    required
                  />
                  <input
                    className="search-input"
                    placeholder="Role"
                    value={editUserForm.role}
                    onChange={(event) =>
                      setEditUserForm((prev) => ({
                        ...prev,
                        role: event.target.value,
                      }))
                    }
                    required
                  />
                  <input
                    className="search-input"
                    placeholder="Name"
                    value={editUserForm.fullName}
                    onChange={(event) =>
                      setEditUserForm((prev) => ({
                        ...prev,
                        fullName: event.target.value,
                      }))
                    }
                    required
                  />
                  <input
                    className="search-input"
                    placeholder="Unique ID"
                    value={editUserForm.uniqueId}
                    onChange={(event) =>
                      setEditUserForm((prev) => ({
                        ...prev,
                        uniqueId: event.target.value,
                      }))
                    }
                  />
                  <label className="edit-active-toggle">
                    <input
                      type="checkbox"
                      checked={editUserForm.isActive}
                      onChange={(event) =>
                        setEditUserForm((prev) => ({
                          ...prev,
                          isActive: event.target.checked,
                        }))
                      }
                    />
                    Active
                  </label>
                  <button
                    type="submit"
                    className="primary-btn slim"
                    disabled={editUserBusy}
                  >
                    {editUserBusy ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setEditingUserEmail(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : null}
              {editUserMessage ? (
                <div className="notice success">{editUserMessage}</div>
              ) : null}
              <form className="users-add-form" onSubmit={handleAddUserData}>
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
                <input
                  className="search-input"
                  placeholder="Role"
                  value={addUserForm.role}
                  onChange={(event) =>
                    setAddUserForm((prev) => ({
                      ...prev,
                      role: event.target.value,
                    }))
                  }
                  required
                />
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
                <button
                  type="submit"
                  className="primary-btn slim"
                  disabled={addUserBusy}
                >
                  {addUserBusy ? "Adding..." : "Add User"}
                </button>
              </form>
              {addUserMessage ? (
                <div className="notice success">{addUserMessage}</div>
              ) : null}
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
                      usersData.map((row) => (
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
                                onClick={() => startEditUser(row)}
                              >
                                Edit
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
                      pendingUsers.map((row) => (
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
                          <td>
                            <button
                              type="button"
                              className="text-btn"
                              onClick={() => {
                                setSelectedCredentialEmail(row.email);
                                setNewCredentialPassword("");
                              }}
                            >
                              Change Password
                            </button>
                          </td>
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
