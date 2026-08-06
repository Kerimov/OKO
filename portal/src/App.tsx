import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { Layout } from "./components/Layout";
import { EntryPage } from "./pages/EntryPage";
import { FormPage } from "./pages/FormPage";
import { HomePage } from "./pages/HomePage";
import { MyFormsPage } from "./pages/MyFormsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InstructionsPage } from "./pages/InstructionsPage";

const ToolsPage = lazy(() =>
  import("./pages/ToolsPage").then((m) => ({ default: m.ToolsPage }))
);
const PackagePage = lazy(() =>
  import("./pages/PackagePage").then((m) => ({ default: m.PackagePage }))
);
const ChecksEditorPage = lazy(() =>
  import("./pages/ChecksEditorPage").then((m) => ({ default: m.ChecksEditorPage }))
);
const FormsEditorPage = lazy(() =>
  import("./pages/FormsEditorPage").then((m) => ({ default: m.FormsEditorPage }))
);
const SaldoEditorPage = lazy(() =>
  import("./pages/SaldoEditorPage").then((m) => ({ default: m.SaldoEditorPage }))
);
const ExcelEditorPage = lazy(() =>
  import("./pages/ExcelEditorPage").then((m) => ({ default: m.ExcelEditorPage }))
);
const AuditLogPage = lazy(() =>
  import("./pages/AuditLogPage").then((m) => ({ default: m.AuditLogPage }))
);
const RashEditorPage = lazy(() =>
  import("./pages/RashEditorPage").then((m) => ({ default: m.RashEditorPage }))
);
const AggregationEditorPage = lazy(() =>
  import("./pages/AggregationEditorPage").then((m) => ({
    default: m.AggregationEditorPage,
  }))
);
const PackagesDashboardPage = lazy(() =>
  import("./pages/PackagesDashboardPage").then((m) => ({
    default: m.PackagesDashboardPage,
  }))
);
const UsersAdminPage = lazy(() =>
  import("./pages/UsersAdminPage").then((m) => ({ default: m.UsersAdminPage }))
);
const RefsAdminPage = lazy(() =>
  import("./pages/RefsAdminPage").then((m) => ({ default: m.RefsAdminPage }))
);
const BpMonitorPage = lazy(() =>
  import("./pages/BpMonitorPage").then((m) => ({ default: m.BpMonitorPage }))
);
const IntegrationsPage = lazy(() =>
  import("./pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage }))
);
const CollectionUnitsPage = lazy(() =>
  import("./pages/CollectionUnitsPage").then((m) => ({
    default: m.CollectionUnitsPage,
  }))
);
const PsdReportsPage = lazy(() =>
  import("./pages/PsdReportsPage").then((m) => ({ default: m.PsdReportsPage }))
);
const CheckExplanationsPage = lazy(() =>
  import("./pages/CheckExplanationsPage").then((m) => ({
    default: m.CheckExplanationsPage,
  }))
);
const PerimeterPage = lazy(() =>
  import("./pages/PerimeterPage").then((m) => ({ default: m.PerimeterPage }))
);

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="loading">Загрузка…</div>}>{children}</Suspense>
  );
}

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
            <Route path="tools" element={<Lazy><ToolsPage /></Lazy>} />
            <Route path="package" element={<Lazy><PackagePage /></Lazy>} />
            <Route path="bp" element={<Lazy><BpMonitorPage /></Lazy>} />
            <Route path="integrations" element={<Lazy><IntegrationsPage /></Lazy>} />
            <Route
              path="collection-units"
              element={<Lazy><CollectionUnitsPage /></Lazy>}
            />
            <Route path="perimeter" element={<Lazy><PerimeterPage /></Lazy>} />
            <Route path="psd-reports" element={<Lazy><PsdReportsPage /></Lazy>} />
            <Route
              path="check-explanations"
              element={<Lazy><CheckExplanationsPage /></Lazy>}
            />
            <Route path="admin/checks" element={<Lazy><ChecksEditorPage /></Lazy>} />
            <Route path="admin/forms" element={<Lazy><FormsEditorPage /></Lazy>} />
            <Route path="admin/saldo" element={<Lazy><SaldoEditorPage /></Lazy>} />
            <Route path="admin/excel" element={<Lazy><ExcelEditorPage /></Lazy>} />
            <Route path="admin/rash" element={<Lazy><RashEditorPage /></Lazy>} />
            <Route path="admin/refs" element={<Lazy><RefsAdminPage /></Lazy>} />
            <Route
              path="admin/kontr"
              element={<Navigate to="/admin/refs?kind=Контрагент" replace />}
            />
            <Route
              path="admin/aggregation"
              element={<Lazy><AggregationEditorPage /></Lazy>}
            />
            <Route
              path="admin/packages"
              element={<Lazy><PackagesDashboardPage /></Lazy>}
            />
            <Route path="admin/audit" element={<Lazy><AuditLogPage /></Lazy>} />
            <Route path="admin/users" element={<Lazy><UsersAdminPage /></Lazy>} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="instructions" element={<InstructionsPage />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
