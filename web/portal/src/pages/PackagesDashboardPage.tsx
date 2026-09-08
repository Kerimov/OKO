import { Navigate } from "react-router-dom";

/** Legacy admin matrix — merged into `/package` workspace. */
export function PackagesDashboardPage() {
  return <Navigate to="/package" replace />;
}
