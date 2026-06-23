import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { EntryPage } from "./pages/EntryPage";
import { FormPage } from "./pages/FormPage";
import { HomePage } from "./pages/HomePage";
import { MyFormsPage } from "./pages/MyFormsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";
import { ChecksEditorPage } from "./pages/ChecksEditorPage";
import { FormsEditorPage } from "./pages/FormsEditorPage";
import { SaldoEditorPage } from "./pages/SaldoEditorPage";
import { ExcelEditorPage } from "./pages/ExcelEditorPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { PackagePage } from "./pages/PackagePage";
import { RashEditorPage } from "./pages/RashEditorPage";
import { AggregationEditorPage } from "./pages/AggregationEditorPage";
import { PackagesDashboardPage } from "./pages/PackagesDashboardPage";
import { UsersAdminPage } from "./pages/UsersAdminPage";
import { InstructionsPage } from "./pages/InstructionsPage";
import { OfflineExportPage } from "./pages/OfflineExportPage";
import { isOfflineKitMode } from "./offlineMode";

export default function App() {
  const offlineKit = isOfflineKitMode();

  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<EntryPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route element={<Layout />}>
            <Route path="catalog" element={<HomePage />} />
            <Route path="my" element={<MyFormsPage />} />
            <Route path="my/:instanceId" element={<FormPage />} />
            {!offlineKit && <Route path="tools" element={<ToolsPage />} />}
            {!offlineKit && <Route path="package" element={<PackagePage />} />}
            <Route path="export" element={<OfflineExportPage />} />
            {!offlineKit && (
              <>
                <Route path="admin/checks" element={<ChecksEditorPage />} />
                <Route path="admin/forms" element={<FormsEditorPage />} />
                <Route path="admin/saldo" element={<SaldoEditorPage />} />
                <Route path="admin/excel" element={<ExcelEditorPage />} />
                <Route path="admin/rash" element={<RashEditorPage />} />
                <Route path="admin/aggregation" element={<AggregationEditorPage />} />
                <Route path="admin/packages" element={<PackagesDashboardPage />} />
                <Route path="admin/audit" element={<AuditLogPage />} />
                <Route path="admin/users" element={<UsersAdminPage />} />
              </>
            )}
            {!offlineKit && <Route path="settings" element={<SettingsPage />} />}
            {!offlineKit && <Route path="instructions" element={<InstructionsPage />} />}
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
