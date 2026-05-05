import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { clearSession, readSession } from "../auth/session";
import { AccessGate } from "../components/AccessGate";
import { ImageCapture } from "../components/ImageCapture";
import {
  formatInstant12hWithSeconds,
  formatInstantShortDate,
} from "../lib/timeDisplay";
import type { AuthSession, AccessPolicy } from "../types";
import logoUrl from "../images/EduTech Logo.png";

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
  const [location] = useState("On Campus");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<
    "success" | "error" | "info" | ""
  >("");
  const [submitStatus, setSubmitStatus] = useState<
    "Late" | "On Time" | "Checked out" | ""
  >("");
  const [cameraAllowed, setCameraAllowed] = useState(true);
  const [windowMessage, setWindowMessage] = useState("");
  const [autoMessage, setAutoMessage] = useState("");
  const [liveNow, setLiveNow] = useState(() => new Date());

  const clockTimeZone =
    access.policy?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  async function loadWindow(selectedType: "Time In" | "Time Out") {
    try {
      const result = await apiRequest<{
        recommendedType?: "Time In" | "Time Out";
        allowed: boolean;
        message: string | null;
      }>(
        `/attendance/user-window?type=${encodeURIComponent(selectedType)}`,
      );
      setCameraAllowed(result.allowed);
      setWindowMessage(result.message ?? "");
      if (!result.allowed) {
        setImage("");
      }
    } catch {
      setCameraAllowed(true);
      setWindowMessage("");
    }
  }

  async function loadAutoType() {
    try {
      const result = await apiRequest<{
        recommendedType: "Time In" | "Time Out";
        allowed: boolean;
        message: string | null;
      }>(`/attendance/user-window`);
      setType(result.recommendedType);
      setCameraAllowed(result.allowed);
      const msg = result.message ?? "";
      setWindowMessage(msg);
      setAutoMessage(msg);
      if (!result.allowed) setImage("");
    } catch {
      setAutoMessage("");
    }
  }

  useEffect(() => {
    void loadAutoType();
  }, []);
  async function submitAttendance(event: React.FormEvent) {
    event.preventDefault();

    if (!cameraAllowed) {
      setNoticeType("error");
      setNotice(windowMessage || "Attendance capture is not allowed right now.");
      return;
    }

    if (!image) {
      setNoticeType("error");
      setNotice(
        "Please capture image from camera before submitting attendance.",
      );
      return;
    }

    setBusy(true);
    setNotice("");
    setSubmitStatus("");
    try {
      const result = await apiRequest<{
        success: boolean;
        message: string;
        status: "Late" | "On Time";
        email?: {
          attempted: boolean;
          sent: boolean;
          provider: string | null;
          reason: string | null;
        };
      }>("/attendance/user", {
        method: "POST",
        body: JSON.stringify({
          type,
          purpose: "N/A",
          location,
          clientIp: access.clientIp,
          latitude: access.latitude,
          longitude: access.longitude,
          imageDataUrl: image || null,
        }),
      });

      if (result.success) {
        const derivedStatus =
          type === "Time Out" ? "Checked out" : result.status;
        setSubmitStatus(derivedStatus);
        const emailSent = result.email?.sent;
        if (emailSent) {
          setNoticeType("success");
          setNotice(
            `Attendance submitted successfully. (${type} • ${derivedStatus}) Receipt email sent. Redirecting to login...`,
          );
        } else {
          setNoticeType("info");
          setNotice(
            `Attendance submitted successfully. (${type} • ${derivedStatus}) Receipt email not sent.${result.email?.reason ? ` ${result.email.reason}` : ""} Redirecting to login...`,
          );
        }
        setTimeout(() => {
          onLogout();
        }, 2400);
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
      <main className="workspace-card glass-card user-attendance-card">
        <header className="topbar attendance-topbar">
          <div>
            <div className="attendance-brand">
              <img src={logoUrl} alt="EduTech Solutions" />
              <div>
            <h1>Digital Attendance System</h1>
            <p>Welcome back, {session.name}</p>
              </div>
            </div>
          </div>
          <div className="topbar-actions attendance-actions">
            <div className="attendance-live-clock" aria-live="polite">
              <span className="attendance-live-clock-label">Current time</span>
              <time
                className="attendance-live-clock-value"
                dateTime={liveNow.toISOString()}
              >
                {formatInstantShortDate(liveNow, clockTimeZone)} ·{" "}
                {formatInstant12hWithSeconds(liveNow, clockTimeZone)}
              </time>
            </div>
            <button
              type="button"
              className="ghost-btn danger"
              onClick={onLogout}
            >
              Logout
            </button>
          </div>
        </header>

        <section className="profile-grid attendance-profile-grid">
          <div className="profile-card">
            <span>Full Name: </span>
            <strong>{session.name}</strong>
          </div>
          <div className="profile-card">
            <span>Unique ID: </span>
            <strong>{session.uniqueId}</strong>
          </div>
          <div className="profile-card">
            <span>Role: </span>
            <strong>{session.role}</strong>
          </div>
          <div className="profile-card">
            <span>Email: </span>
            <strong className="email-value">{session.email}</strong>
          </div>
        </section>

        <form onSubmit={submitAttendance} className="attendance-form">
          <div className="type-panel">
            <div className="type-label">Attendance Type</div>
            <div className="type-row">
              <div className="pill active" role="status" aria-live="polite">
                {type}
              </div>
              {submitStatus ? (
                <div
                  className={
                    submitStatus === "Late"
                      ? "badge red"
                      : submitStatus === "Checked out"
                        ? "badge indigo"
                        : "badge green"
                  }
                >
                  {submitStatus}
                </div>
              ) : null}
            </div>
          </div>

          <div className="location-verified-banner">
            <span>On Campus - Location verified</span>
          </div>

          {cameraAllowed ? (
            <div className="capture-guide">
              <strong>Camera Tips</strong>
              <span>
                Keep your face and upper body visible with proper lighting for a
                clearer attendance record.
              </span>
            </div>
          ) : null}

          {cameraAllowed ? (
            <ImageCapture value={image} onChange={setImage} cameraOnly required />
          ) : (
            <div className="notice info">
              {autoMessage ||
                windowMessage ||
                "You cannot capture image right now due to attendance time window."}
            </div>
          )}

          {notice ? (
            <div className={`notice ${noticeType}`}>{notice}</div>
          ) : null}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "Submitting..." : "Submit Attendance"}
          </button>
        </form>

        <footer className="auth-footer">
          <span>{session.role}</span>
        </footer>
      </main>
    </div>
  );
}
