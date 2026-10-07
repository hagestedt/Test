import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { formatCost, phaseOf, PHASES, sessionCost, statusLine, type Phase } from "../state/derive"
import { useFleet, type View } from "../state/store"
import { useAttentionCount } from "./Inbox"
import { Button, Icon, Kbd, StatusDot, useRootSessions, type IconName } from "./ui"

function FleetTotals() {
  const projectID = useFleet((s) => s.root?.project.id)
  const totals = useFleet(
    useShallow((s) => {
      let cost = 0
      let running = 0
      for (const sess of Object.values(s.data.sessions)) {
        if (sess.projectID !== projectID) continue
        cost += sessionCost(s.data, sess.id).cost
        if (!sess.parentID && s.data.status[sess.id]?.type === "busy") running++
      }
      return { cost, running }
    }),
  )
  return (
    <div className="totals">
      <span className={`chip ${totals.running ? "live" : ""}`} data-testid="running-count">
        {totals.running > 0 && <span className="spinner" />} {totals.running} running
      </span>
      <span className="chip" title="Total spend across this project's agents">
        {formatCost(totals.cost)}
      </span>
    </div>
  )
}

export function Topbar() {
  const view = useFleet((s) => s.view)
  const root = useFleet((s) => s.root)
  const conn = useFleet((s) => s.conn)
  const picked = useFleet((s) => s.picked.length)
  const attention = useAttentionCount()
  const { setView, setLauncher, setPalette } = useFleet.getState()
  const name = root?.project.name ?? root?.directory.split("/").pop()
  const tabs: [View, string, IconName, string, number][] = [
    ["board", "Board", "board", "B", 0],
    ["tiles", "Tiles", "tiles", "T", picked],
    ["inbox", "Inbox", "inbox", "I", attention],
  ]
  return (
    <header className="topbar">
      <div className="brand" onClick={() => setView("board")}>
        <span className="brand-mark">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">Fleet</span>
      </div>
      <div className="project" title={root?.directory}>
        <span className="project-name">{name ?? "…"}</span>
        {root?.vcs?.branch && (
          <span className="muted small">
            <Icon name="branch" size={12} /> {root.vcs.branch}
          </span>
        )}
      </div>
      <nav className="nav">
        {tabs.map(([id, label, icon, key, count]) => (
          <button key={id} className={view === id ? "on" : ""} onClick={() => setView(id)} title={`${label} (${key})`} data-testid={`nav-${id}`}>
            <Icon name={icon} size={15} />
            {label}
            {count > 0 && <span className={`count ${id === "inbox" ? "alert" : ""}`}>{count}</span>}
          </button>
        ))}
      </nav>
      <span className="grow" />
      <FleetTotals />
      <span className={`conn conn-${conn}`} title={conn === "online" ? `Connected to OpenCode ${root?.version ?? ""}` : conn} />
      <button className="search-btn" onClick={() => setPalette(true)}>
        <Icon name="search" size={14} /> <span>Search</span> <Kbd>⌘K</Kbd>
      </button>
      <Button variant="primary" icon="plus" onClick={() => setLauncher(true)} data-testid="new-agents">
        New <Kbd>N</Kbd>
      </Button>
    </header>
  )
}

export function Sidebar() {
  const sessions = useRootSessions()
  const data = useFleet((s) => s.data)
  const seen = useFleet((s) => s.prefs.seenAt)
  const selected = useFleet((s) => (s.view === "agent" ? s.selected : undefined))
  const filter = useFleet((s) => s.filter)
  const showArchived = useFleet((s) => s.showArchived)
  const { open, setFilter, setShowArchived } = useFleet.getState()

  const grouped = useMemo(() => {
    const g: Record<Phase, typeof sessions> = { attention: [], running: [], review: [], done: [] }
    for (const s of sessions) g[phaseOf(data, s.id, seen[s.id])].push(s)
    return g
  }, [sessions, data, seen])

  return (
    <aside className="sidebar">
      <div className="side-search">
        <Icon name="search" size={14} />
        <input placeholder="Filter agents" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter agents" />
      </div>
      <div className="side-list">
        {PHASES.map(
          (p) =>
            grouped[p.id].length > 0 && (
              <div key={p.id} className="side-group">
                <div className="side-label">
                  {p.label} <span className="muted">{grouped[p.id].length}</span>
                </div>
                {grouped[p.id].map((s) => (
                  <button key={s.id} className={`side-item ${selected === s.id ? "on" : ""}`} onClick={() => open(s.id)} data-testid="side-item">
                    <StatusDot phase={p.id} />
                    <span className="side-text">
                      <span className="ellipsis side-title">
                        {s.title || "Untitled agent"}
                        {s.metadata?.fleet?.group && <span className="muted"> #{s.metadata.fleet.attempt}</span>}
                      </span>
                      <span className={`ellipsis side-sub ${statusLine(data, s.id).kind}`}>{statusLine(data, s.id).text}</span>
                    </span>
                  </button>
                ))}
              </div>
            ),
        )}
        {!sessions.length && <div className="muted small pad">No agents yet.</div>}
      </div>
      <label className="side-foot check small">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
      </label>
    </aside>
  )
}

export function Toasts() {
  const toasts = useFleet((s) => s.toasts)
  const dismiss = useFleet((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="link"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
