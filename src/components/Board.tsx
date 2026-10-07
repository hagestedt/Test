import { memo, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import type { Session } from "../api/types"
import {
  diffStats,
  lastAgent,
  lastModel,
  phaseOf,
  PHASES,
  sessionChanges,
  sessionCost,
  statusLine,
  timeAgo,
  todoProgress,
  type Phase,
} from "../state/derive"
import { useFleet } from "../state/store"
import { AgentBadge, BranchBadge, Button, DiffStat, Icon, Kbd, ModelBadge, Progress, StatusDot, useNow, usePhase, useRootSessions } from "./ui"

function groupHue(group: string) {
  let h = 0
  for (const c of group) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export const AgentCard = memo(function AgentCard({ session }: { session: Session }) {
  const id = session.id
  const phase = usePhase(id)
  const line = useFleet(useShallow((s) => statusLine(s.data, id)))
  const todos = useFleet((s) => s.data.todos[id])
  const model = useFleet((s) => lastModel(s.data, id))
  const agent = useFleet((s) => lastAgent(s.data, id))
  const permission = useFleet((s) => Object.values(s.data.permissions).find((p) => p.sessionID === id))
  const question = useFleet((s) => Object.values(s.data.questions).find((q) => q.sessionID === id))
  const picked = useFleet((s) => s.picked.includes(id))
  const { open, togglePick, abort, replyPermission } = useFleet.getState()
  const stats = useFleet(useShallow((s) => diffStats(sessionChanges(s.data, id), session)))
  const cost = useFleet(useShallow((s) => sessionCost(s.data, id)))
  const prog = todoProgress(todos)
  const fleet = session.metadata?.fleet

  return (
    <article
      className={`card card-${phase} ${picked ? "picked" : ""}`}
      data-testid="agent-card"
      data-phase={phase}
      onClick={() => open(id)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && open(id)}
    >
      <div className="card-top">
        <StatusDot phase={phase} />
        <span className="card-title" title={session.title}>
          {session.title || "Untitled agent"}
        </span>
        <input
          type="checkbox"
          className="pick"
          checked={picked}
          title="Select for tiles / broadcast"
          onClick={(e) => e.stopPropagation()}
          onChange={() => togglePick(id)}
        />
      </div>
      {fleet?.group && (
        <div className="card-group" style={{ "--hue": groupHue(fleet.group) } as React.CSSProperties}>
          attempt {fleet.attempt}/{fleet.attempts}
        </div>
      )}
      <div className={`card-activity ${line.kind}`}>
        {phase === "running" && <span className="spinner" />}
        <span className="ellipsis">{line.text}</span>
      </div>
      {permission && (
        <div className="card-req" onClick={(e) => e.stopPropagation()}>
          <code className="ellipsis">{String(permission.metadata?.command ?? permission.patterns.join(" ") ?? permission.permission)}</code>
          <div className="row gap">
            <Button size="sm" variant="primary" onClick={() => replyPermission(permission.id, "once")}>
              Allow
            </Button>
            <Button size="sm" variant="danger" onClick={() => replyPermission(permission.id, "reject")}>
              Deny
            </Button>
          </div>
        </div>
      )}
      {question && !permission && <div className="card-req muted small">❓ {question.questions[0]?.question}</div>}
      <div className="card-meta">
        <Progress {...prog} />
        <DiffStat additions={stats.additions} deletions={stats.deletions} />
      </div>
      <div className="card-foot">
        <AgentBadge name={agent} />
        <ModelBadge model={model} />
        <BranchBadge session={session} />
        <span className="grow" />
        <span className="muted small">{timeAgo(session.time.updated)}</span>
        {cost.cost > 0 && <span className="muted small">${cost.cost.toFixed(2)}</span>}
        {phase === "running" && (
          <button
            className="icon-btn"
            title="Stop"
            onClick={(e) => {
              e.stopPropagation()
              void abort(id)
            }}
          >
            <Icon name="stop" size={13} />
          </button>
        )}
      </div>
    </article>
  )
})

function Groups({ sessions }: { sessions: Session[] }) {
  const data = useFleet((s) => s.data)
  const seen = useFleet((s) => s.prefs.seenAt)
  const { setPicked, setView } = useFleet.getState()
  const groups = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of sessions) {
      const g = s.metadata?.fleet?.group
      if (g) m.set(g, [...(m.get(g) ?? []), s])
    }
    return [...m.entries()].filter(([, l]) => l.length > 1).slice(0, 6)
  }, [sessions])
  if (!groups.length) return null
  return (
    <div className="groups">
      {groups.map(([g, list]) => (
        <div key={g} className="group" style={{ "--hue": groupHue(g) } as React.CSSProperties} data-testid="group">
          <div className="group-title ellipsis" title={list[0].metadata?.fleet?.groupTitle}>
            <Icon name="compare" size={14} /> {list[0].metadata?.fleet?.groupTitle}
          </div>
          <div className="group-dots">
            {list
              .slice()
              .sort((a, b) => (a.metadata?.fleet?.attempt ?? 0) - (b.metadata?.fleet?.attempt ?? 0))
              .map((s) => (
                <StatusDot key={s.id} phase={phaseOf(data, s.id, seen[s.id])} title={`${s.title} · ${lastModel(data, s.id) ?? ""}`} />
              ))}
          </div>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              setPicked(list.map((s) => s.id))
              setView("tiles")
            }}
          >
            Compare {list.length}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function Board() {
  const sessions = useRootSessions()
  const data = useFleet((s) => s.data)
  const seen = useFleet((s) => s.prefs.seenAt)
  const setLauncher = useFleet((s) => s.setLauncher)
  useNow(10_000)

  const columns = useMemo(() => {
    const cols: Record<Phase, Session[]> = { attention: [], running: [], review: [], done: [] }
    for (const s of sessions) cols[phaseOf(data, s.id, seen[s.id])].push(s)
    return cols
  }, [sessions, data, seen])

  if (!sessions.length)
    return (
      <div className="hero">
        <div className="hero-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <h2>Run a fleet of OpenCode agents</h2>
        <p className="muted">
          Launch several agents in parallel — the same task across models for a best-of-N, or different tasks side by side. Each can get its own git
          worktree so they never trample each other. Approvals and questions from every agent land in one inbox.
        </p>
        <Button variant="primary" icon="plus" onClick={() => setLauncher(true)}>
          Launch agents <Kbd>N</Kbd>
        </Button>
      </div>
    )

  return (
    <div className="board-wrap">
      <Groups sessions={sessions} />
      <div className="board">
        {PHASES.map((p) => (
          <section key={p.id} className={`col col-${p.id}`} data-testid={`col-${p.id}`}>
            <header className="col-head" title={p.hint}>
              <StatusDot phase={p.id} />
              <span>{p.label}</span>
              <span className="count">{columns[p.id].length}</span>
            </header>
            <div className="col-body">
              {columns[p.id].map((s) => (
                <AgentCard key={s.id} session={s} />
              ))}
              {!columns[p.id].length && <div className="col-empty muted small">{p.id === "attention" ? "All clear" : "—"}</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
