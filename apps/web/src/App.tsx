import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { clearSession, readSession, saveSession } from "./auth/session";
import { HomeRedirect } from "./pages/HomeRedirect";
import { LoginPage } from "./pages/LoginPage";
import { AttendancePage } from "./pages/AttendancePage";
import { AdminPage } from "./pages/AdminPage";
import type { AuthSession } from "./types";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(readSession());
  const location = useLocation();

  useEffect(() => {
    const saved = readSession();
    setSession(saved);
  }, [location.pathname]);

  function updateSession(nextSession: AuthSession | null) {
    setSession(nextSession);
    if (nextSession) {
      saveSession(nextSession);
    } else {
      clearSession();
    }
  }

  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/login"
        element={<LoginPage onSessionChange={updateSession} />}
      />
      <Route
        path="/attendance"
        element={
          session ? (
            <AttendancePage onSessionChange={updateSession} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          session?.role.toLowerCase() === "admin" ? (
            <AdminPage onSessionChange={updateSession} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
