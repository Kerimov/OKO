import { Navigate, Route, Routes } from "react-router-dom";
import { PackageProvider } from "./context/PackageContext";
import { Layout } from "./components/Layout";
import { WelcomePage } from "./pages/WelcomePage";
import { PackagePage } from "./pages/PackagePage";
import { FormPage } from "./pages/FormPage";

export function App() {
  return (
    <PackageProvider>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route element={<Layout />}>
          <Route path="/package" element={<PackagePage />} />
          <Route path="/form/:instanceId" element={<FormPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PackageProvider>
  );
}
