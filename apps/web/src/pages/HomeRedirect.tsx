import { Navigate } from "react-router-dom";
import { readSession } from "../auth/session";

export function HomeRedirect() {
  const session = readSession();
  if (!session) return <Navigate to="/login" replace />;
  return (
    <Navigate
      to={session.role.toLowerCase() === "admin" ? "/admin" : "/attendance"}
      replace
    />
  );
}
