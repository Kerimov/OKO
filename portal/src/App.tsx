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
import { RefsAdminPage } from "./pages/RefsAdminPage";
import { InstructionsPage } from "./pages/InstructionsPage";
import { BpMonitorPage } from "./pages/BpMonitorPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { CollectionUnitsPage } from "./pages/CollectionUnitsPage";
import { PsdReportsPage } from "./pages/PsdReportsPage";
import { CheckExplanationsPage } from "./pages/CheckExplanationsPage";

export default function App() {
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
            <Route path="tools" element={<ToolsPage />} />
            <Route path="package" element={<PackagePage />} />
            <Route path="bp" element={<BpMonitorPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="collection-units" element={<CollectionUnitsPage />} />
            <Route path="psd-reports" element={<PsdReportsPage />} />
            <Route path="check-explanations" element={<CheckExplanationsPage />} />
            <Route path="admin/checks" element={<ChecksEditorPage />} />
            <Route path="admin/forms" element={<FormsEditorPage />} />
            <Route path="admin/saldo" element={<SaldoEditorPage />} />
            <Route path="admin/excel" element={<ExcelEditorPage />} />
            <Route path="admin/rash" element={<RashEditorPage />} />
            <Route path="admin/refs" element={<RefsAdminPage />} />
            <Route path="admin/kontr" element={<Navigate to="/admin/refs?kind=Контрагент" replace />} />
            <Route path="admin/aggregation" element={<AggregationEditorPage />} />
            <Route path="admin/packages" element={<PackagesDashboardPage />} />
            <Route path="admin/audit" element={<AuditLogPage />} />
            <Route path="admin/users" element={<UsersAdminPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="instructions" element={<InstructionsPage />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
