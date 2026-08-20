import { useState } from "react";
import { MatchExplorer } from "./components/MatchExplorer";
import { OverviewMap } from "./components/OverviewMap";
import { PlacementsTable } from "./components/PlacementsTable";
import { Settings } from "./components/Settings";
import { StatusDashboard } from "./components/StatusDashboard";
import { StudentsTable } from "./components/StudentsTable";
import { SuggestAndAssign } from "./components/SuggestAndAssign";
import { ToastHost } from "./components/ToastHost";

const TABS = [
  { id: "status", label: "Status", render: () => <StatusDashboard /> },
  { id: "students", label: "Students", render: () => <StudentsTable /> },
  { id: "placements", label: "Placements", render: () => <PlacementsTable /> },
  { id: "map", label: "Overview Map", render: () => <OverviewMap /> },
  { id: "suggest", label: "Suggest & Assign", render: () => <SuggestAndAssign /> },
  { id: "match", label: "Match & Assign", render: () => <MatchExplorer /> },
  { id: "settings", label: "Settings", render: () => <Settings /> },
] as const;

function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("status");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Placement Mapper</h1>
        <p className="hint">All data stays in this browser — nothing is stored on any server.</p>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>{active.render()}</main>
      <ToastHost />
    </div>
  );
}

export default App;
