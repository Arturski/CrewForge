import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider } from "./lib/toast";
import { api } from "./lib/api";

// Route-level code splitting keeps the initial bundle (and heavy deps like
// XyFlow) off the critical path until a route needs them.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Builder = lazy(() => import("./pages/Builder").then((m) => ({ default: m.Builder })));
const Runs = lazy(() => import("./pages/Runs").then((m) => ({ default: m.Runs })));
const Tools = lazy(() => import("./pages/Tools").then((m) => ({ default: m.Tools })));
const Knowledge = lazy(() => import("./pages/Knowledge").then((m) => ({ default: m.Knowledge })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Code = lazy(() => import("./pages/Code").then((m) => ({ default: m.Code })));

function Loading() {
  return <div className="grid h-[50vh] place-items-center text-sm text-muted">Loading…</div>;
}

export default function App() {
  const [crewaiVersion, setCrewaiVersion] = useState<string>();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    api.health().then((h) => setCrewaiVersion(h.crewai_version)).catch(() => {});
  }, []);

  return (
    <ToastProvider>
      <div className="flex h-full">
        {/* Sidebar: static on md+, off-canvas drawer on small screens */}
        <div className={`fixed inset-y-0 left-0 z-40 transition-transform md:static md:z-auto md:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <Sidebar crewaiVersion={crewaiVersion} onNavigate={() => setNavOpen(false)} />
        </div>
        {navOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}

        <main className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2 md:hidden">
            <button onClick={() => setNavOpen(true)} aria-label="Open menu" className="text-muted hover:text-ink"><Menu className="h-5 w-5" /></button>
            <span className="font-semibold text-ink">CrewForge</span>
          </div>
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/builder" element={<Builder />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/tools" element={<Tools />} />
              <Route path="/knowledge" element={<Knowledge />} />
                <Route path="/skills" element={<Navigate to="/tools" replace />} />
                <Route path="/mcp" element={<Navigate to="/tools?tab=integrations" replace />} />
                <Route path="/models" element={<Settings />} />
                <Route path="/code" element={<Code />} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
