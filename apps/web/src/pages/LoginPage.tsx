import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { clearSession, saveSession } from "../auth/session";
import type { AccessPolicy, AuthSession, RoleTab } from "../types";
import { AccessGate } from "../components/AccessGate";
import { ImageCapture } from "../components/ImageCapture";

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

const USER_LOGIN_ROLES = [
  { value: "internee", label: "Internee" },
  { value: "student", label: "Student" },
  { value: "human resource", label: "HR Manager" },
  { value: "chief executive", label: "CEO" },
  { value: "employee", label: "Employee" },
  { value: "faculty member", label: "Faculty Member" },
  { value: "visiting faculty", label: "Visiting Faculty" },
] as const;

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
  const [selectedLoginRole, setSelectedLoginRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPurpose, setGuestPurpose] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestType, setGuestType] = useState<"Time In" | "Time Out">("Time In");
  const [guestImage, setGuestImage] = useState("");
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
          imageDataUrl: guestImage || null,
        }),
      });

      if (result.success) {
        showMessage("Guest attendance marked successfully.", "success");
        setGuestName("");
        setGuestPurpose("");
        setGuestEmail("");
        setGuestType("Time In");
        setGuestImage("");
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

    if (role === "user" && !selectedLoginRole) {
      showMessage("Please select your user role.", "error");
      return;
    }

    if (role === "admin" && selectedLoginRole !== "admin") {
      showMessage("Please select Admin role for admin login.", "error");
      return;
    }

    setBusy(true);
    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          role: role === "admin" ? "admin" : "user",
          selectedRole: role === "admin" ? "admin" : selectedLoginRole,
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
        <div className="brand-block">
          <div className="brand-mark">🎓</div>
          <div>
            <h1>EduTech Solutions</h1>
            <p>Secure Digital Attendance Portal</p>
          </div>
        </div>

        <div className="role-tabs">
          {(["user", "guest", "admin"] as RoleTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={tab === role ? "role-tab active" : "role-tab"}
              onClick={() => {
                setRole(tab);
                setSelectedLoginRole(tab === "admin" ? "admin" : "");
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
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </label>

                <label className="field-label">
                  {role === "admin" ? "Role" : "Select Your Role"}
                  <select
                    value={role === "admin" ? "admin" : selectedLoginRole}
                    onChange={(event) =>
                      setSelectedLoginRole(event.target.value)
                    }
                    required
                    disabled={role === "admin"}
                  >
                    {role === "admin" ? (
                      <option value="admin">Admin</option>
                    ) : (
                      <>
                        <option value="">Choose role</option>
                        {USER_LOGIN_ROLES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>

                <div className="type-panel login-mode-panel">
                  <div className="type-label">
                    {role === "admin" ? "Admin Access" : "User Access"}
                  </div>
                  <p className="mode-note">
                    {role === "admin"
                      ? "Use your admin credentials to manage users, credentials, and reports."
                      : "Use your assigned credentials to mark attendance and check status."}
                  </p>
                </div>
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
                <ImageCapture value={guestImage} onChange={setGuestImage} />
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

        <div className="auth-footer">
          <span>IP: {access.clientIp}</span>
          <span>
            {access.policy
              ? `${access.policy.accessProfile} profile`
              : "Access profile ready"}
          </span>
        </div>
      </main>
    </div>
  );
}
