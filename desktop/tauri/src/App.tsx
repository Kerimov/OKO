import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { PackageProvider } from "./context/PackageContext";
import { CoordinatorProvider } from "./context/CoordinatorContext";
import { SyncStatusProvider } from "./context/SyncContext";
import { Layout } from "./components/Layout";
import { RequireAuth, RequireAdmin, LoginPage } from "./pages/LoginPage";
import { WelcomePage } from "./pages/WelcomePage";
import { PackagePage } from "./pages/PackagePage";
import { FormPage } from "./pages/FormPage";
import { AssignmentsPage } from "./pages/AssignmentsPage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  return (
    <AuthProvider>
      <PackageProvider>
        <CoordinatorProvider>
          <SyncStatusProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <WelcomePage />
                  </RequireAuth>
                }
              />
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/package" element={<PackagePage />} />
                <Route path="/assignments" element={<AssignmentsPage />} />
                <Route path="/form/:instanceId" element={<FormPage />} />
              </Route>
              <Route
                path="/admin"
                element={
                  <RequireAuth>
                    <RequireAdmin>
                      <AdminPage />
                    </RequireAdmin>
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SyncStatusProvider>
        </CoordinatorProvider>
      </PackageProvider>
    </AuthProvider>
  );
}
