import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { clearSession, saveSession } from "../auth/session";
import type { AccessPolicy, AuthSession, RoleTab } from "../types";
import { AccessGate } from "../components/AccessGate";
import logoUrl from "../images/EduTech Logo.png";

interface LoginPageProps {
  onSessionChange: (session: AuthSession | null) => void;
}

type LoginResponse = {
  success: boolean;
  token: string;
  role: string;
  name: string;
  email: string;
  uniqueId?: string | null;
};

type GuestResponse = {
  success: boolean;
  message: string;
  attendanceId: string;
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3.5 6.5 20.5 17.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M2.5 12s3.5-7 9.5-7c2.1 0 4 0.8 5.6 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M21.5 12s-3.5 7-9.5 7c-2.2 0-4.2-0.9-5.9-2.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoginPage({ onSessionChange }: LoginPageProps) {
  return (
    <AccessGate>
      {(access) => (
        <LoginPageContent onSessionChange={onSessionChange} access={access} />
      )}
    </AccessGate>
  );
}

function LoginPageContent({
  onSessionChange,
  access,
}: LoginPageProps & {
  access: {
    clientIp: string;
    latitude: number | null;
    longitude: number | null;
    policy: AccessPolicy | null;
  };
}) {
  const navigate = useNavigate();
  const [role, setRole] = useState<RoleTab>("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPurpose, setGuestPurpose] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestType, setGuestType] = useState<"Time In" | "Time Out">("Time In");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState<
    "info" | "error" | "success" | ""
  >("");
  const [busy, setBusy] = useState(false);
  const isGuest = role === "guest";

  function showMessage(message: string, type: "info" | "error" | "success") {
    setStatusMessage(message);
    setStatusType(type);
  }

  async function handleGuestSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!guestType) {
      showMessage("Please select Time In or Time Out.", "error");
      return;
    }
    if (!guestName.trim() || !guestPurpose.trim()) {
      showMessage("Please fill out Name and Purpose.", "error");
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest<GuestResponse>("/attendance/guest", {
        method: "POST",
        body: JSON.stringify({
          name: guestName.trim(),
          purpose: guestPurpose.trim(),
          email: guestEmail.trim(),
          type: guestType,
          location:
            access.latitude !== null && access.longitude !== null
              ? "On Campus"
              : "Verified",
          clientIp: access.clientIp,
          latitude: access.latitude,
          longitude: access.longitude,
        }),
      });

      if (result.success) {
        showMessage("Guest attendance marked successfully.", "success");
        setGuestName("");
        setGuestPurpose("");
        setGuestEmail("");
        setGuestType("Time In");
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Guest submission failed.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginSubmit(event: React.FormEvent) {
    event.preventDefault();

    setBusy(true);
    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          role: role === "admin" ? "admin" : "user",
          clientIp: access.clientIp,
          latitude: access.latitude ?? undefined,
          longitude: access.longitude ?? undefined,
        }),
      });

      if (result.success) {
        const session: AuthSession = {
          token: result.token,
          role: result.role,
          name: result.name,
          email: result.email,
          uniqueId: result.uniqueId || "N/A",
        };
        saveSession(session);
        onSessionChange(session);
        showMessage("Login successful. Redirecting...", "success");
        setTimeout(() => {
          navigate(
            result.role.toLowerCase() === "admin" ? "/admin" : "/attendance",
            { replace: true },
          );
        }, 700);
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Login failed.",
        "error",
      );
      clearSession();
      onSessionChange(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="bg-blob blob-a" />
      <div className="bg-blob blob-b" />
      <main className="auth-card glass-card">
        <div className="brand-block login-brand-block">
          <img
            className="brand-logo login-brand-logo"
            src={logoUrl}
            alt="EduTech Solutions"
          />
          <h1 className="login-title">The EduTech Solutions</h1>
          <p className="login-subtitle">Secure Portal Login</p>
        </div>

        <div className="role-tabs login-role-tabs">
          {(["user", "guest", "admin"] as RoleTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={tab === role ? "role-tab active" : "role-tab"}
              onClick={() => {
                setRole(tab);
                setStatusMessage("");
                setStatusType("");
              }}
            >
              {tab === "user" ? "User" : tab === "guest" ? "Guest" : "Admin"}
            </button>
          ))}
        </div>

        <form
          onSubmit={isGuest ? handleGuestSubmit : handleLoginSubmit}
          className="auth-form"
        >
          <div className="auth-form-stage" key={role}>
            {!isGuest ? (
              <>
                <label className="field-label">
                  Gmail Address
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    placeholder="yourname@gmail.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label className="field-label">
                  Password
                  <div className="password-field">
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon open={!showPassword} />
                    </button>
                  </div>
                </label>
              </>
            ) : (
              <>
                <label className="field-label">
                  Full Name
                  <input
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    type="text"
                    placeholder="Visitor name"
                    required
                  />
                </label>
                <label className="field-label">
                  Purpose of Visit
                  <input
                    value={guestPurpose}
                    onChange={(event) => setGuestPurpose(event.target.value)}
                    type="text"
                    placeholder="Meeting, seminar, etc."
                    required
                  />
                </label>
                <label className="field-label">
                  Email for Receipt
                  <input
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    type="email"
                    placeholder="Optional"
                  />
                </label>
                <div className="type-panel">
                  <div className="type-label">Attendance Type</div>
                  <div className="type-row">
                    <button
                      type="button"
                      className={
                        guestType === "Time In" ? "pill active" : "pill"
                      }
                      onClick={() => setGuestType("Time In")}
                    >
                      Time In
                    </button>
                    <button
                      type="button"
                      className={
                        guestType === "Time Out" ? "pill active" : "pill"
                      }
                      onClick={() => setGuestType("Time Out")}
                    >
                      Time Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {statusMessage ? (
            <div className={`notice ${statusType}`}>{statusMessage}</div>
          ) : null}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "Processing..." : isGuest ? "Submit Attendance" : "Sign In"}
          </button>
        </form>
        {!isGuest ? (
          <p className="login-disclaimer">
            Access is restricted to authorized personnel.
            <br />
            Must be connected to University Wi‑Fi.
          </p>
        ) : null}
      </main>
    </div>
  );
}
