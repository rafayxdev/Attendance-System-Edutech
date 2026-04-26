import { useState } from "react";
import { Navigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { clearSession, readSession } from "../auth/session";
import { AccessGate } from "../components/AccessGate";
import { ImageCapture } from "../components/ImageCapture";
import type { AuthSession, AccessPolicy } from "../types";

interface AttendancePageProps {
  onSessionChange: (session: AuthSession | null) => void;
}

export function AttendancePage({ onSessionChange }: AttendancePageProps) {
  const session = readSession();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AccessGate>
      {(access) => (
        <AttendanceContent
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

function AttendanceContent({
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
  const [type, setType] = useState<"Time In" | "Time Out">("Time In");
  const [purpose, setPurpose] = useState("");
  const [location] = useState("On Campus");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"success" | "error" | "">("");
  async function submitAttendance(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await apiRequest<{ success: boolean; message: string }>(
        "/attendance/user",
        {
          method: "POST",
          body: JSON.stringify({
            type,
            purpose: purpose.trim() || "N/A",
            location,
            clientIp: access.clientIp,
            latitude: access.latitude,
            longitude: access.longitude,
            imageDataUrl: image || null,
          }),
        },
      );

      if (result.success) {
        setNoticeType("success");
        setNotice("Attendance marked successfully. Redirecting to login...");
        setTimeout(() => {
          onLogout();
        }, 1800);
      }
    } catch (error) {
      setNoticeType("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Attendance submission failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-bg" />
      <main className="workspace-card glass-card">
        <header className="topbar">
          <div>
            <h1>Attendance Entry</h1>
            <p>Welcome back, {session.name}</p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => window.location.assign("/admin")}
            >
              Admin
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

        <section className="profile-grid">
          <div className="profile-card">
            <span>Full Name</span>
            <strong>{session.name}</strong>
          </div>
          <div className="profile-card">
            <span>Unique ID</span>
            <strong>{session.uniqueId}</strong>
          </div>
          <div className="profile-card">
            <span>Role</span>
            <strong>{session.role}</strong>
          </div>
          <div className="profile-card">
            <span>Email</span>
            <strong>{session.email}</strong>
          </div>
        </section>

        <form onSubmit={submitAttendance} className="attendance-form">
          <div className="type-panel">
            <div className="type-label">Attendance Type</div>
            <div className="type-row">
              <button
                type="button"
                className={type === "Time In" ? "pill active" : "pill"}
                onClick={() => setType("Time In")}
              >
                Time In
              </button>
              <button
                type="button"
                className={type === "Time Out" ? "pill active" : "pill"}
                onClick={() => setType("Time Out")}
              >
                Time Out
              </button>
            </div>
          </div>

          <label className="field-label">
            Purpose
            <input
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              type="text"
              placeholder="Optional purpose or note"
            />
          </label>

          <ImageCapture value={image} onChange={setImage} />

          {notice ? (
            <div className={`notice ${noticeType}`}>{notice}</div>
          ) : null}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "Submitting..." : "Submit Attendance"}
          </button>
        </form>

        <footer className="auth-footer">
          <span>IP: {access.clientIp}</span>
          <span>{session.role}</span>
        </footer>
      </main>
    </div>
  );
}
