import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { formatWallHm12h } from "../lib/timeDisplay";

type OverrideMode = "same" | "custom";

export type DayOverrideRow = {
  id: string;
  userId: string;
  overrideDate: string;
  startTime: string;
  endTime: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
};

type SelectableUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
};

type UserDataApiRow = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  uniqueId: string;
};

type RoleFilterOption = { value: string; label: string };

interface DayScheduleOverridePanelProps {
  roleFilterOptions: RoleFilterOption[];
  onChanged?: () => void;
}

function todayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatOverrideDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DayScheduleOverridePanel({
  roleFilterOptions,
  onChanged,
}: DayScheduleOverridePanelProps) {
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [userPickerSearch, setUserPickerSearch] = useState("");
  const [userPickerRole, setUserPickerRole] = useState("");

  const [formDate, setFormDate] = useState(todayDateInputValue());
  const [mode, setMode] = useState<OverrideMode>("same");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [sameStartTime, setSameStartTime] = useState("09:00");
  const [sameEndTime, setSameEndTime] = useState("17:00");
  const [customTimings, setCustomTimings] = useState<
    Record<string, { startTime: string; endTime: string }>
  >({});

  const [listDate, setListDate] = useState(todayDateInputValue());
  const [listSearch, setListSearch] = useState("");
  const [listRole, setListRole] = useState("");
  const [overrides, setOverrides] = useState<DayOverrideRow[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("17:00");
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function loadUsers() {
    setUsersBusy(true);
    try {
      const rows = await apiRequest<UserDataApiRow[]>("/admin/users-data");
      setUsers(
        rows
          .filter((row) => row.role.trim().toLowerCase() !== "admin")
          .map((row) => ({
            id: row.userId,
            email: row.email,
            fullName: row.fullName,
            role: row.role,
            uniqueId: row.uniqueId,
          })),
      );
    } catch (error) {
      console.error(error);
      setMessageIsError(true);
      setMessage("Unable to load users for override selection.");
    } finally {
      setUsersBusy(false);
    }
  }

  async function loadOverrides() {
    setListBusy(true);
    try {
      const query = new URLSearchParams();
      if (listDate) query.set("date", listDate);
      if (listSearch.trim()) query.set("search", listSearch.trim());
      if (listRole.trim()) query.set("role", listRole.trim());
      const rows = await apiRequest<DayOverrideRow[]>(
        `/admin/day-schedule-overrides?${query.toString()}`,
      );
      setOverrides(rows);
    } catch (error) {
      console.error(error);
      setMessageIsError(true);
      setMessage("Unable to load day overrides.");
    } finally {
      setListBusy(false);
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadOverrides();
  }, []);

  const filteredPickerUsers = useMemo(() => {
    const search = userPickerSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (
        userPickerRole &&
        user.role.toLowerCase() !== userPickerRole.toLowerCase()
      ) {
        return false;
      }
      if (!search) return true;
      return (
        user.fullName.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search) ||
        user.role.toLowerCase().includes(search) ||
        user.uniqueId.toLowerCase().includes(search)
      );
    });
  }, [users, userPickerSearch, userPickerRole]);

  const selectedUsers = useMemo(
    () => users.filter((user) => selectedUserIds.includes(user.id)),
    [users, selectedUserIds],
  );

  function toggleUserSelection(userId: string) {
    setSelectedUserIds((prev) => {
      const exists = prev.includes(userId);
      const next = exists ? prev.filter((id) => id !== userId) : [...prev, userId];
      if (!exists) {
        setCustomTimings((timings) => ({
          ...timings,
          [userId]: timings[userId] ?? {
            startTime: sameStartTime,
            endTime: sameEndTime,
          },
        }));
      }
      return next;
    });
  }

  function selectAllVisibleUsers() {
    const ids = filteredPickerUsers.map((user) => user.id);
    setSelectedUserIds(ids);
    setCustomTimings((timings) => {
      const next = { ...timings };
      for (const user of filteredPickerUsers) {
        next[user.id] = next[user.id] ?? {
          startTime: sameStartTime,
          endTime: sameEndTime,
        };
      }
      return next;
    });
  }

  function clearUserSelection() {
    setSelectedUserIds([]);
  }

  async function handleSaveOverride() {
    if (!formDate) {
      setMessageIsError(true);
      setMessage("Select a date for the override.");
      return;
    }
    if (selectedUserIds.length === 0) {
      setMessageIsError(true);
      setMessage("Select at least one user.");
      return;
    }

    setSaveBusy(true);
    setMessage("");
    try {
      if (mode === "same") {
        await apiRequest("/admin/day-schedule-overrides", {
          method: "POST",
          body: JSON.stringify({
            date: formDate,
            mode: "same",
            userIds: selectedUserIds,
            startTime: sameStartTime,
            endTime: sameEndTime,
          }),
        });
      } else {
        await apiRequest("/admin/day-schedule-overrides", {
          method: "POST",
          body: JSON.stringify({
            date: formDate,
            mode: "custom",
            entries: selectedUserIds.map((userId) => ({
              userId,
              startTime: customTimings[userId]?.startTime ?? sameStartTime,
              endTime: customTimings[userId]?.endTime ?? sameEndTime,
            })),
          }),
        });
      }

      setMessageIsError(false);
      setMessage(
        `Override saved for ${selectedUserIds.length} user(s) on ${formatOverrideDateLabel(formDate)}.`,
      );
      setListDate(formDate);
      await loadOverrides();
      onChanged?.();
    } catch (error) {
      setMessageIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to save override.",
      );
    } finally {
      setSaveBusy(false);
    }
  }

  function startEdit(row: DayOverrideRow) {
    setEditingId(row.id);
    setEditStartTime(row.startTime);
    setEditEndTime(row.endTime);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleUpdateOverride(id: string) {
    setEditBusy(true);
    try {
      const result = await apiRequest<{ message: string }>(
        `/admin/day-schedule-overrides/${id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            startTime: editStartTime,
            endTime: editEndTime,
          }),
        },
      );
      setMessageIsError(false);
      setMessage(result.message);
      setEditingId(null);
      await loadOverrides();
      onChanged?.();
    } catch (error) {
      setMessageIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to update override.",
      );
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDeleteOverride(row: DayOverrideRow) {
    const confirmed = window.confirm(
      `Remove override for ${row.fullName} on ${formatOverrideDateLabel(row.overrideDate)}?`,
    );
    if (!confirmed) return;

    try {
      const result = await apiRequest<{ message: string }>(
        `/admin/day-schedule-overrides/${row.id}`,
        { method: "DELETE" },
      );
      setMessageIsError(false);
      setMessage(result.message);
      if (editingId === row.id) setEditingId(null);
      await loadOverrides();
      onChanged?.();
    } catch (error) {
      setMessageIsError(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to delete override.",
      );
    }
  }

  function loadExistingIntoForm(date: string) {
    const rowsForDate = overrides.filter((row) => row.overrideDate === date);
    if (rowsForDate.length === 0) return;

    setFormDate(date);
    setSelectedUserIds(rowsForDate.map((row) => row.userId));

    const first = rowsForDate[0];
    if (!first) return;

    const allSame = rowsForDate.every(
      (row) =>
        row.startTime === first.startTime && row.endTime === first.endTime,
    );

    if (allSame) {
      setMode("same");
      setSameStartTime(first.startTime);
      setSameEndTime(first.endTime);
    } else {
      setMode("custom");
      const timings: Record<string, { startTime: string; endTime: string }> =
        {};
      for (const row of rowsForDate) {
        timings[row.userId] = {
          startTime: row.startTime,
          endTime: row.endTime,
        };
      }
      setCustomTimings(timings);
    }
  }

  return (
    <section className="table-card user-generator-card day-override-card">
      <div className="table-head">
        <h2>Specific Day Timing Override</h2>
        <span>One-date shift timing without changing weekly schedule</span>
      </div>

      <div className="user-generator-body">
        {message ? (
          <p
            className={`notice ${messageIsError ? "error" : "success"}`}
            role="status"
          >
            {message}
          </p>
        ) : null}

        <div className="day-override-form-grid">
          <label className="field-block">
            <span>Override date</span>
            <input
              type="date"
              className="overview-date-input-visible admin-dark-picker"
              value={formDate}
              onChange={(event) => setFormDate(event.target.value)}
            />
          </label>

          <fieldset className="day-override-mode-fieldset">
            <legend>Timing mode</legend>
            <label className="radio-inline">
              <input
                type="radio"
                name="override-mode"
                checked={mode === "same"}
                onChange={() => setMode("same")}
              />
              Same timing for selected users
            </label>
            <label className="radio-inline">
              <input
                type="radio"
                name="override-mode"
                checked={mode === "custom"}
                onChange={() => setMode("custom")}
              />
              Custom timing per user
            </label>
          </fieldset>

          {mode === "same" ? (
            <div className="schedule-row day-override-same-row">
              <label>
                <span>Shift In (Time In start)</span>
                <input
                  type="time"
                  className="admin-dark-picker"
                  value={sameStartTime}
                  onChange={(event) => setSameStartTime(event.target.value)}
                />
              </label>
              <label>
                <span>Shift Out (Time Out after)</span>
                <input
                  type="time"
                  className="admin-dark-picker"
                  value={sameEndTime}
                  onChange={(event) => setSameEndTime(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="day-override-user-picker">
          <div className="schedule-head">
            <strong>Select users</strong>
            <div className="schedule-head-actions">
              <button
                type="button"
                className="ghost-btn slim"
                onClick={() => selectAllVisibleUsers()}
                disabled={usersBusy || filteredPickerUsers.length === 0}
              >
                Select visible
              </button>
              <button
                type="button"
                className="ghost-btn slim"
                onClick={clearUserSelection}
                disabled={selectedUserIds.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="filters-bar compact-filters">
            <input
              value={userPickerSearch}
              onChange={(event) => setUserPickerSearch(event.target.value)}
              placeholder="Search users"
              className="search-input"
            />
            <select
              value={userPickerRole}
              onChange={(event) => setUserPickerRole(event.target.value)}
              className="search-input"
              aria-label="Filter users by role"
            >
              {roleFilterOptions.map((opt) => (
                <option key={`override-pick-${opt.value || "all"}`} value={opt.value}>
                  {opt.value === "" ? "All roles" : opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="day-override-user-list">
            {usersBusy ? (
              <p className="muted-note">Loading users…</p>
            ) : filteredPickerUsers.length === 0 ? (
              <p className="muted-note">No users found.</p>
            ) : (
              filteredPickerUsers.map((user) => (
                <label key={user.id} className="day-override-user-item">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(user.id)}
                    onChange={() => toggleUserSelection(user.id)}
                  />
                  <span>
                    <strong>{user.fullName}</strong>
                    <small>
                      {user.role} · {user.email}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>

          {mode === "custom" && selectedUsers.length > 0 ? (
            <div className="day-override-custom-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Shift In</th>
                    <th>Shift Out</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.fullName}</strong>
                        <small>{user.email}</small>
                      </td>
                      <td>
                        <input
                          type="time"
                          className="admin-dark-picker"
                          value={
                            customTimings[user.id]?.startTime ?? sameStartTime
                          }
                          onChange={(event) =>
                            setCustomTimings((prev) => ({
                              ...prev,
                              [user.id]: {
                                startTime: event.target.value,
                                endTime:
                                  prev[user.id]?.endTime ?? sameEndTime,
                              },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          className="admin-dark-picker"
                          value={customTimings[user.id]?.endTime ?? sameEndTime}
                          onChange={(event) =>
                            setCustomTimings((prev) => ({
                              ...prev,
                              [user.id]: {
                                startTime:
                                  prev[user.id]?.startTime ?? sameStartTime,
                                endTime: event.target.value,
                              },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {selectedUserIds.length > 0 ? (
            <p className="muted-note">
              {selectedUserIds.length} user(s) selected for{" "}
              {formatOverrideDateLabel(formDate)}.
            </p>
          ) : null}
        </div>

        <div className="day-override-actions">
          <button
            type="button"
            className="primary-btn slim"
            onClick={() => void handleSaveOverride()}
            disabled={saveBusy}
          >
            {saveBusy ? "Saving…" : "Save override"}
          </button>
        </div>

        <hr className="day-override-divider" />

        <div className="schedule-head">
          <strong>Saved overrides</strong>
          <span className="muted-note">
            {overrides.length} record{overrides.length === 1 ? "" : "s"}
            {listDate ? ` · ${formatOverrideDateLabel(listDate)}` : ""}
          </span>
        </div>

        <div className="filters-bar compact-filters">
          <input
            type="date"
            className="overview-date-input-visible admin-dark-picker"
            value={listDate}
            onChange={(event) => setListDate(event.target.value)}
          />
          <input
            value={listSearch}
            onChange={(event) => setListSearch(event.target.value)}
            placeholder="Search saved overrides"
            className="search-input"
          />
          <select
            value={listRole}
            onChange={(event) => setListRole(event.target.value)}
            className="search-input"
            aria-label="Filter overrides by role"
          >
            {roleFilterOptions.map((opt) => (
              <option key={`override-list-${opt.value || "all"}`} value={opt.value}>
                {opt.value === "" ? "All roles" : opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-btn slim"
            onClick={() => void loadOverrides()}
            disabled={listBusy}
          >
            {listBusy ? "Loading…" : "Load overrides"}
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Role</th>
                <th>Shift In</th>
                <th>Shift Out</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {overrides.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-row">
                    No overrides for this filter.
                  </td>
                </tr>
              ) : (
                overrides.map((row) => (
                  <tr key={row.id}>
                    <td>{formatOverrideDateLabel(row.overrideDate)}</td>
                    <td>
                      <strong>{row.fullName}</strong>
                      <small>{row.email}</small>
                    </td>
                    <td>{row.role}</td>
                    <td>
                      {editingId === row.id ? (
                        <input
                          type="time"
                          className="admin-dark-picker"
                          value={editStartTime}
                          onChange={(event) =>
                            setEditStartTime(event.target.value)
                          }
                        />
                      ) : (
                        formatWallHm12h(row.startTime)
                      )}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <input
                          type="time"
                          className="admin-dark-picker"
                          value={editEndTime}
                          onChange={(event) => setEditEndTime(event.target.value)}
                        />
                      ) : (
                        formatWallHm12h(row.endTime)
                      )}
                    </td>
                    <td className="day-override-row-actions">
                      {editingId === row.id ? (
                        <>
                          <button
                            type="button"
                            className="ghost-btn slim"
                            disabled={editBusy}
                            onClick={() => void handleUpdateOverride(row.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="ghost-btn slim"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ghost-btn slim"
                            onClick={() => startEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-btn slim"
                            onClick={() => loadExistingIntoForm(row.overrideDate)}
                          >
                            Load in form
                          </button>
                          <button
                            type="button"
                            className="ghost-btn slim danger"
                            onClick={() => void handleDeleteOverride(row)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
