"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Database,
  Download,
  Filter,
  Hammer,
  House,
  LayoutDashboard,
  Map,
  MapPin,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Project = {
  address: string;
  neighbourhood: string;
  category: string;
  event: string;
  date: string;
  confidence: number;
  units: number;
  value: string;
  pin: { x: number; y: number };
};

const projects: Project[] = [
  {
    address: "10524 75 Avenue NW",
    neighbourhood: "Queen Alexandra",
    category: "Semi-detached infill",
    event: "Building permit issued",
    date: "Today, 8:42 AM",
    confidence: 92,
    units: 4,
    value: "$1.18M",
    pin: { x: 61, y: 56 },
  },
  {
    address: "11437 78 Avenue NW",
    neighbourhood: "McKernan",
    category: "New detached infill",
    event: "Development permit approved",
    date: "Yesterday",
    confidence: 87,
    units: 2,
    value: "$740K",
    pin: { x: 41, y: 70 },
  },
  {
    address: "9332 86 Street NW",
    neighbourhood: "Bonnie Doon",
    category: "Garden suite",
    event: "New application received",
    date: "Jul 30",
    confidence: 81,
    units: 1,
    value: "$265K",
    pin: { x: 76, y: 42 },
  },
  {
    address: "10958 84 Avenue NW",
    neighbourhood: "Garneau",
    category: "Demolition only",
    event: "Demolition permit issued",
    date: "Jul 29",
    confidence: 68,
    units: 0,
    value: "$38K",
    pin: { x: 52, y: 35 },
  },
];

const stats = {
  "7 days": { development: 8, building: 5, occupancy: 2 },
  "30 days": { development: 31, building: 19, occupancy: 7 },
  "90 days": { development: 84, building: 51, occupancy: 18 },
} as const;

type Period = keyof typeof stats;
type PeriodStats = (typeof stats)[Period];

const navItems = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Explore projects", icon: Map },
  { label: "Saved alerts", icon: Bell, badge: "3" },
];

const categoryTone = (category: string) => {
  if (category.includes("Semi")) return "copper" as const;
  if (category.includes("Garden")) return "green" as const;
  if (category.includes("Demolition")) return "neutral" as const;
  return "teal" as const;
};

function ConfidenceRing({ value }: { value: number }) {
  const color = value >= 80 ? "var(--positive)" : "var(--copper)";
  return (
    <div
      className="confidence-ring"
      style={{
        background: `conic-gradient(${color} ${value * 3.6}deg, #E8ECE9 0deg)`,
      }}
      aria-label={`${value} percent confidence`}
    >
      <div>{value}</div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <div className="brand-name">Edmonton</div>
        <div className="brand-product">Infill Tracker</div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-label">Workspace</div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navItems.map(({ label, icon: Icon, active, badge }) => (
          <a
            href={label === "Overview" ? "/" : "#"}
            className={cn("nav-item", active && "active")}
            key={label}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
            {badge && <span className="nav-badge">{badge}</span>}
          </a>
        ))}
      </nav>

      <div className="sidebar-label admin-label">Administration</div>
      <nav className="sidebar-nav" aria-label="Administration navigation">
        <a href="/admin" className="nav-item">
          <Settings size={18} aria-hidden="true" />
          <span>Operations</span>
        </a>
      </nav>

      <div className="sidebar-watch">
        <div className="watch-icon">
          <Sparkles size={16} />
        </div>
        <strong>3 areas monitored</strong>
        <p>Queen Alexandra, McKernan, Bonnie Doon</p>
        <button type="button">
          Manage watchlist <ChevronRight size={14} />
        </button>
      </div>

      <div className="user-card">
        <div className="avatar">JT</div>
        <div className="user-meta">
          <strong>Local admin</strong>
          <span>Administrator</span>
        </div>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
    </aside>
  );
}

function MobileHeader({ openMenu }: { openMenu: () => void }) {
  return (
    <header className="mobile-header">
      <Brand />
      <Button variant="ghost" size="icon" aria-label="Open menu" onClick={openMenu}>
        <Menu size={21} />
      </Button>
    </header>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <div className="search-box">
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="Search by address or permit number"
          placeholder="Search address or permit number"
        />
        <kbd>⌘ K</kbd>
      </div>
      <div className="topbar-actions">
        <div className="sync-state">
          <span /> Sample data · Phase 3 preview
        </div>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Notifications"
          className="notification-button"
        >
          <Bell size={18} />
          <span className="notification-dot" />
        </Button>
      </div>
    </header>
  );
}

function LifecycleSummary({ period, values }: { period: Period; values: PeriodStats }) {
  const milestones = [
    {
      label: "Development permits",
      value: values.development,
      detail: "Planning approvals recorded by the City.",
      icon: MapPin,
      tone: "development",
    },
    {
      label: "Building permits",
      value: values.building,
      detail: "Building permits issued and recorded by the City.",
      icon: Building2,
      tone: "building",
    },
    {
      label: "Occupancy granted",
      value: values.occupancy,
      detail: "City records indicating occupancy was granted.",
      icon: CircleCheck,
      tone: "occupancy",
    },
  ] as const;

  return (
    <Card className="lifecycle-card" role="region" aria-labelledby="lifecycle-title">
      <div className="lifecycle-head">
        <div>
          <div className="eyebrow">Project lifecycle</div>
          <h2 id="lifecycle-title">From first approval to occupancy</h2>
          <p>New City-recorded milestones in your watchlist during the selected period.</p>
        </div>
        <span className="lifecycle-period">Past {period}</span>
      </div>

      <ol className="lifecycle-steps" aria-label={`Milestones recorded in the past ${period}`}>
        {milestones.map(({ label, value, detail, icon: Icon, tone }, index) => (
          <li className={cn("lifecycle-step", tone)} key={label}>
            <div className="milestone-head">
              <span className="milestone-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="milestone-order">0{index + 1}</span>
            </div>
            <div className="milestone-count">
              <strong>{value}</strong>
              <span>records</span>
            </div>
            <h3>{label}</h3>
            <p>{detail}</p>
          </li>
        ))}
      </ol>

      <div className="lifecycle-note">
        <Database size={17} aria-hidden="true" />
        <p>
          <strong>How to read this:</strong> These are City of Edmonton-recorded signals of project
          progress. “Occupancy granted” is not an independent safety, habitability, or permitted-use
          certification by Infill Tracker.
        </p>
      </div>
    </Card>
  );
}

function ActivityMap({
  selected,
  setSelected,
}: {
  selected: number;
  setSelected: (value: number) => void;
}) {
  return (
    <Card className="map-card">
      <div className="section-head map-head">
        <div>
          <div className="eyebrow">Geographic signal</div>
          <h2>Activity in your watchlist</h2>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm">
            <Filter size={14} /> Filter
          </Button>
          <Button variant="ghost" size="sm">
            Open map <ArrowUpRight size={14} />
          </Button>
        </div>
      </div>
      <div className="map-shell">
        <div className="map-grid" aria-label="Map preview of monitored Edmonton neighbourhoods">
          <div className="river river-one" />
          <div className="river river-two" />
          <div className="road road-a" />
          <div className="road road-b" />
          <div className="road road-c" />
          <span className="map-label downtown">Downtown</span>
          <span className="map-label strathcona">Strathcona</span>
          <span className="map-label university">University</span>
          {projects.map((project, index) => (
            <button
              type="button"
              className={cn("map-pin", selected === index && "selected")}
              style={{ left: `${project.pin.x}%`, top: `${project.pin.y}%` }}
              onClick={() => setSelected(index)}
              aria-label={`View ${project.address}`}
              key={project.address}
            >
              <span>{project.confidence}</span>
            </button>
          ))}
          <div className="map-legend">
            <span />
            <strong>High confidence</strong>
            <span />
            <strong>Review</strong>
          </div>
        </div>
        <div className="map-project-panel">
          <div className="panel-kicker">Selected signal</div>
          <div className="panel-address">
            <div className="address-icon">
              <House size={18} />
            </div>
            <div>
              <strong>{projects[selected].address}</strong>
              <span>{projects[selected].neighbourhood}</span>
            </div>
          </div>
          <Badge tone={categoryTone(projects[selected].category)}>
            {projects[selected].category}
          </Badge>
          <div className="selected-score">
            <ConfidenceRing value={projects[selected].confidence} />
            <div>
              <strong>High confidence</strong>
              <span>Multiple permit signals match</span>
            </div>
          </div>
          <div className="selected-facts">
            <div>
              <span>Latest event</span>
              <strong>{projects[selected].event}</strong>
            </div>
            <div>
              <span>Estimated value</span>
              <strong>{projects[selected].value}</strong>
            </div>
            <div>
              <span>Estimated units</span>
              <strong>{projects[selected].units || "—"}</strong>
            </div>
          </div>
          <Button className="selected-button">
            View project timeline <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SignalList() {
  return (
    <Card className="signals-card">
      <div className="section-head">
        <div>
          <div className="eyebrow">Opportunity queue</div>
          <h2>High-confidence projects</h2>
        </div>
        <Button variant="ghost" size="sm">
          View all <ChevronRight size={14} />
        </Button>
      </div>
      <div className="project-list">
        {projects.slice(0, 3).map((project) => (
          <button className="project-row" type="button" key={project.address}>
            <ConfidenceRing value={project.confidence} />
            <div className="project-primary">
              <strong>{project.address}</strong>
              <span>
                <MapPin size={13} /> {project.neighbourhood}
              </span>
            </div>
            <div className="project-category">
              <Badge tone={categoryTone(project.category)}>{project.category}</Badge>
            </div>
            <div className="project-event">
              <strong>{project.event}</strong>
              <span>{project.date}</span>
            </div>
            <div className="project-value">
              <strong>{project.value}</strong>
              <span>
                {project.units} {project.units === 1 ? "unit" : "units"}
              </span>
            </div>
            <ChevronRight className="row-chevron" size={17} />
          </button>
        ))}
      </div>
    </Card>
  );
}

function NeighbourhoodSignals() {
  const areas = [
    { name: "Queen Alexandra", count: 11, delta: "+22%", width: 92 },
    { name: "McKernan", count: 8, delta: "+14%", width: 69 },
    { name: "Bonnie Doon", count: 6, delta: "+9%", width: 52 },
    { name: "Westmount", count: 4, delta: "—", width: 35 },
  ];
  return (
    <Card className="neighbourhood-card">
      <div className="section-head">
        <div>
          <div className="eyebrow">Last 30 days</div>
          <h2>Neighbourhood signals</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Download neighbourhood data">
          <Download size={16} />
        </button>
      </div>
      <div className="area-list">
        {areas.map((area, index) => (
          <div className="area-row" key={area.name}>
            <div className="area-rank">{String(index + 1).padStart(2, "0")}</div>
            <div className="area-main">
              <div>
                <strong>{area.name}</strong>
                <span>{area.count} projects</span>
              </div>
              <div className="area-track">
                <span style={{ width: `${area.width}%` }} />
              </div>
            </div>
            <Badge tone={area.delta === "—" ? "neutral" : "green"}>{area.delta}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ActivityFeed() {
  const events = [
    {
      icon: Hammer,
      tone: "copper",
      title: "Demolition permit issued",
      detail: "10958 84 Avenue NW · Garneau",
      time: "2h",
    },
    {
      icon: Building2,
      tone: "teal",
      title: "Building permit approved",
      detail: "10524 75 Avenue NW · Queen Alexandra",
      time: "5h",
    },
    {
      icon: CircleCheck,
      tone: "green",
      title: "Project confidence increased",
      detail: "11437 78 Avenue NW · 74 → 87",
      time: "1d",
    },
  ];
  return (
    <Card className="feed-card">
      <div className="section-head">
        <div>
          <div className="eyebrow">Permit timeline</div>
          <h2>Recent activity</h2>
        </div>
        <Button variant="ghost" size="sm">
          See history
        </Button>
      </div>
      <div className="feed-list">
        {events.map(({ icon: Icon, tone, title, detail, time }) => (
          <div className="feed-row" key={title}>
            <div className={cn("feed-icon", tone)}>
              <Icon size={16} />
            </div>
            <div>
              <strong>{title}</strong>
              <span>{detail}</span>
            </div>
            <time>{time}</time>
          </div>
        ))}
      </div>
      <div className="health-strip">
        <Database size={18} />
        <div>
          <strong>Importer implemented</strong>
          <span>Fixture records remain visible until the live dashboard connection.</span>
        </div>
        <Badge tone="neutral">Preview</Badge>
      </div>
    </Card>
  );
}

function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <a href="/" className="active">
        <LayoutDashboard size={20} />
        <span>Overview</span>
      </a>
      <a href="#">
        <Map size={20} />
        <span>Explore</span>
      </a>
      <a href="#">
        <Bell size={20} />
        <span>Alerts</span>
      </a>
      <a href="/admin">
        <Settings size={20} />
        <span>More</span>
      </a>
    </nav>
  );
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>("7 days");
  const [selected, setSelected] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentStats = useMemo(() => stats[period], [period]);

  return (
    <div className="app-shell">
      <Sidebar />
      <MobileHeader openMenu={() => setMenuOpen(true)} />
      {menuOpen && (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="drawer-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="drawer-panel">
            <div className="drawer-head">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </Button>
            </div>
            {navItems.map(({ label, icon: Icon, active }) => (
              <a
                key={label}
                className={cn("drawer-link", active && "active")}
                href={active ? "/" : "#"}
              >
                <Icon size={19} />
                {label}
              </a>
            ))}
            <a className="drawer-link" href="/admin">
              <ShieldCheck size={19} />
              Administration
            </a>
          </div>
        </div>
      )}
      <main className="main-shell">
        <Topbar />
        <div className="content">
          <section className="hero-row">
            <div>
              <div className="page-kicker">
                <span>Saturday, August 1</span>
                <span className="kicker-divider" />
                Overview
              </div>
              <h1>Follow infill projects from first approval to occupancy.</h1>
              <p>
                City-recorded permit milestones across your watchlist, organized into projects and
                ranked by evidence.
              </p>
            </div>
            <div className="hero-actions">
              <Button variant="secondary">
                <CalendarDays size={16} /> Aug 1, 2026
              </Button>
              <Button>
                <Plus size={16} /> Create alert
              </Button>
            </div>
          </section>

          <div className="period-control" role="group" aria-label="Reporting period">
            {(Object.keys(stats) as Period[]).map((item) => (
              <button
                type="button"
                key={item}
                className={period === item ? "active" : ""}
                onClick={() => setPeriod(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <LifecycleSummary period={period} values={currentStats} />

          <ActivityMap selected={selected} setSelected={setSelected} />
          <SignalList />

          <section className="lower-grid">
            <NeighbourhoodSignals />
            <ActivityFeed />
          </section>

          <section className="notice" aria-label="Data quality notice">
            <AlertTriangle size={18} />
            <div>
              <strong>Live overview connection is next.</strong>
              <span>
                Permit ingestion is ready; these overview cards still use staged sample data until
                Phase 4.
              </span>
            </div>
            <Button variant="ghost" size="sm">
              View details
            </Button>
          </section>
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
