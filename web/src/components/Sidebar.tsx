import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard", icon: "◆", end: true },
  { to: "/builder", label: "Builder", icon: "⚙" },
  { to: "/runs", label: "Runs", icon: "▶" },
];

export function Sidebar({ crewaiVersion }: { crewaiVersion?: string }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-elevated">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-bold text-white">CF</div>
        <div>
          <div className="font-semibold leading-tight text-ink">CrewForge</div>
          <div className="text-[11px] text-muted">no-code CrewAI</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1 px-2 py-2">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? "bg-brand-soft text-ink" : "text-muted hover:bg-elevated2 hover:text-ink"
              }`
            }
          >
            <span className="w-4 text-center">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-4 py-3 text-[11px] text-muted">
        {crewaiVersion ? <>crewai <span className="text-ink">{crewaiVersion}</span></> : "connecting…"}
      </div>
    </aside>
  );
}
