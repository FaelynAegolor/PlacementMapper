import { useState } from "react";
import { AssignPlacements } from "./components/AssignPlacements";
import { LecturerAllocationView } from "./components/LecturerAllocationView";
import { LecturersTable } from "./components/LecturersTable";
import { OverviewMap } from "./components/OverviewMap";
import { PlacementsTable } from "./components/PlacementsTable";
import { Settings } from "./components/Settings";
import { StatusDashboard } from "./components/StatusDashboard";
import { StudentsTable } from "./components/StudentsTable";
import { ToastHost } from "./components/ToastHost";

const TABS = [
  { id: "status", label: "Status", render: () => <StatusDashboard /> },
  { id: "students", label: "Students", render: () => <StudentsTable /> },
  { id: "placements", label: "Placements", render: () => <PlacementsTable /> },
  { id: "lecturers", label: "Lecturers", render: () => <LecturersTable /> },
  { id: "map", label: "Overview Map", render: () => <OverviewMap /> },
  { id: "assign", label: "Assign Placements", render: () => <AssignPlacements /> },
  { id: "allocation", label: "Lecturer Allocation", render: () => <LecturerAllocationView /> },
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
