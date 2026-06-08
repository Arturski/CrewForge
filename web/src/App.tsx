import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { Builder } from "./pages/Builder";
import { Runs } from "./pages/Runs";
import { Tools } from "./pages/Tools";
import { Settings } from "./pages/Settings";
import { Code } from "./pages/Code";
import { ToastProvider } from "./lib/toast";
import { api } from "./lib/api";

export default function App() {
  const [crewaiVersion, setCrewaiVersion] = useState<string>();
  useEffect(() => {
    api.health().then((h) => setCrewaiVersion(h.crewai_version)).catch(() => {});
  }, []);

  return (
    <ToastProvider>
      <div className="flex h-full">
        <Sidebar crewaiVersion={crewaiVersion} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-8 py-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/builder" element={<Builder />} />
              <Route path="/tools" element={<Tools />} />
              <Route path="/models" element={<Settings />} />
              <Route path="/code" element={<Code />} />
              <Route path="/runs" element={<Runs />} />
            </Routes>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
