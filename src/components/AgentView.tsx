import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { api } from "../api/client"
import type { FileDiff } from "../api/types"
import {
  childrenOf,
  diffStats,
  formatCost,
  formatTokens,
  lastAgent,
  lastModel,
  sessionChanges,
  sessionCost,
  timeAgo,
  todoProgress,
} from "../state/derive"
import { useFleet } from "../state/store"
import { Composer } from "./Composer"
import { DiffView } from "./DiffView"
import { TodoMark, Transcript } from "./Transcript"
import { AgentBadge, BranchBadge, Button, copy, DiffStat, Empty, Icon, ModelBadge, PHASE_LABEL, Progress, StatusDot, useNow, usePhase } from "./ui"

type Tab = "plan" | "changes" | "subagents" | "info"

export const SHIP_PROMPTS = [
  { label: "Commit changes", prompt: "Commit all of your changes on the current branch with a clear, conventional commit message. Do not push." },
  { label: "Run tests & fix", prompt: "Run the project's tests and linters. Fix anything that fails, then summarize what you changed." },
  {
    label: "Open a pull request",
    prompt: "Commit any outstanding changes, push this branch, and open a pull request with `gh pr create` describing the change.",
  },
  {
    label: "Self-review",
    prompt: "Review your own diff critically as a senior engineer. List bugs, risks and missing tests, then fix the important ones.",
  },
]

function Changes({ sessionID }: { sessionID: string }) {
  const session = useFleet((s) => s.data.sessions[sessionID])
  const idle = useFleet((s) => s.data.status[sessionID]?.type !== "busy")
  const turn = useFleet((s) => sessionChanges(s.data, sessionID))
  const isWorktree = !!session?.metadata?.fleet?.worktree
  const [mode, setMode] = useState<"session" | "git" | "branch">("session")
  const [vcs, setVcs] = useState<FileDiff[]>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mode === "session" || !session) return
    let cancelled = false
    setLoading(true)
    api
      .vcsDiff(session.directory, mode)
      .then((d) => !cancelled && setVcs(d))
      .catch(() => !cancelled && setVcs([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [mode, session?.directory, idle, session])

  const diffs = mode === "session" ? turn : (vcs ?? [])
  const stats = diffStats(diffs)
  return (
    <div className="changes">
      <div className="seg">
        <button className={mode === "session" ? "on" : ""} onClick={() => setMode("session")} title="Edits this agent made, turn by turn">
          This agent
        </button>
        <button className={mode === "git" ? "on" : ""} onClick={() => setMode("git")} title="Uncommitted changes in the agent's directory">
          Working tree
        </button>
        {isWorktree && (
          <button
            className={mode === "branch" ? "on" : ""}
            onClick={() => setMode("branch")}
            title="Committed changes on the agent's branch vs. the default branch"
          >
            Branch
          </button>
        )}
      </div>
      <div className="changes-sum">
        <DiffStat {...stats} />
        {loading && <span className="spinner" />}
      </div>
      <DiffView diffs={diffs} empty={mode === "session" ? "This agent hasn't changed any files yet." : "Clean."} />
    </div>
  )
}

function Plan({ sessionID }: { sessionID: string }) {
  const todos = useFleet((s) => s.data.todos[sessionID])
  if (!todos?.length) return <Empty title="No plan yet">Agents publish their step list here as they work (todowrite).</Empty>
  const { done, total } = todoProgress(todos)
  return (
    <div className="plan">
      <Progress done={done} total={total} />
      <ul className="todos">
        {todos.map((t, i) => (
          <li key={t.id ?? i} className={`todo-${t.status}`}>
            <TodoMark status={t.status} />
            <span>{t.content}</span>
            {t.priority === "high" && t.status !== "completed" && <span className="badge pri">high</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Subagents({ sessionID }: { sessionID: string }) {
  const sessions = useFleet((s) => s.data.sessions)
  const status = useFleet((s) => s.data.status)
  const activity = useFleet((s) => s.data.activity)
  const open = useFleet((s) => s.open)
  const kids = useMemo(() => Object.values(sessions).filter((k) => k.parentID === sessionID), [sessions, sessionID])
  if (!kids.length) return <Empty title="No subagents">When this agent delegates with the task tool, its helpers appear here.</Empty>
  return (
    <ul className="kids">
      {kids.map((k) => (
        <li key={k.id}>
          <button className="kid" onClick={() => open(k.id)}>
            <StatusDot phase={status[k.id]?.type === "busy" ? "running" : "done"} />
            <span className="ellipsis">{k.title}</span>
            <span className="muted small">{activity[k.id]?.label}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Info({ sessionID }: { sessionID: string }) {
  const s = useFleet((st) => st.data.sessions[sessionID])
  const cost = useFleet(useShallow((st) => sessionCost(st.data, sessionID)))
  if (!s) return null
  const wt = s.metadata?.fleet?.worktree
  const rows: [string, React.ReactNode][] = [
    ["ID", <code>{s.id}</code>],
    ["Directory", <code className="break">{s.directory}</code>],
    ["Branch", wt?.branch ? <code>{wt.branch}</code> : "shared (project directory)"],
    ["Created", new Date(s.time.created).toLocaleString()],
    ["Tokens", formatTokens(cost.tokens)],
    ["Cost", formatCost(cost.cost)],
  ]
  return (
    <div className="info">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {wt?.branch && (
        <div className="info-actions">
          <Button size="sm" icon="copy" onClick={() => copy(`git merge ${wt.branch}`)}>
            Copy merge command
          </Button>
          <Button size="sm" icon="terminal" onClick={() => copy(`cd ${wt.directory}`)}>
            Copy cd command
          </Button>
        </div>
      )}
    </div>
  )
}

function Title({ sessionID }: { sessionID: string }) {
  const title = useFleet((s) => s.data.sessions[sessionID]?.title ?? "")
  const rename = useFleet((s) => s.rename)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  if (editing)
    return (
      <input
        className="title-input"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => (setEditing(false), value.trim() && value !== title && rename(sessionID, value.trim()))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") (setValue(title), setEditing(false))
        }}
      />
    )
  return (
    <h1 className="agent-title" onDoubleClick={() => (setValue(title), setEditing(true))} title="Double-click to rename">
      {title || "Untitled agent"}
    </h1>
  )
}

export function AgentView({ sessionID }: { sessionID: string }) {
  const session = useFleet((s) => s.data.sessions[sessionID])
  const phase = usePhase(sessionID)
  const activity = useFleet((s) => s.data.activity[sessionID])
  const model = useFleet((s) => lastModel(s.data, sessionID))
  const agent = useFleet((s) => lastAgent(s.data, sessionID))
  const todos = useFleet((s) => s.data.todos[sessionID])
  const parent = useFleet((s) => (session?.parentID ? s.data.sessions[session.parentID] : undefined))
  const { abort, fork, archive, remove, open, send, markSeen, setPicked, picked } = useFleet.getState()
  const [tab, setTab] = useState<Tab>("plan")
  const [ship, setShip] = useState(false)
  useNow(5000)

  const changes = useFleet((s) => sessionChanges(s.data, sessionID))
  const stats = diffStats(changes, session)
  const cost = useFleet(useShallow((s) => sessionCost(s.data, sessionID)))
  const kids = useFleet((s) => childrenOf(s.data, sessionID).length)
  const prog = todoProgress(todos)

  // Viewing an agent marks it reviewed, including output that streams in while open.
  const finished = useFleet((s) => s.data.finishedAt[sessionID])
  useEffect(() => markSeen(sessionID), [sessionID, finished, markSeen])

  if (!session) return <Empty title="Agent not found">It may have been deleted.</Empty>
  const wt = session.metadata?.fleet?.worktree
  const busy = phase === "running"

  return (
    <div className="agent-view">
      <header className="agent-head">
        <div className="agent-head-main">
          {parent && (
            <button className="link small crumb" onClick={() => open(parent.id)}>
              ← {parent.title}
            </button>
          )}
          <div className="row gap">
            <StatusDot phase={phase} />
            <Title sessionID={sessionID} />
          </div>
          <div className="row gap wrap meta">
            <span className={`phase phase-${phase}`}>{PHASE_LABEL[phase]}</span>
            <AgentBadge name={agent} />
            <ModelBadge model={model} />
            <BranchBadge session={session} />
            {session.metadata?.fleet?.attempts && session.metadata.fleet.attempts > 1 && (
              <span className="badge">
                attempt {session.metadata.fleet.attempt}/{session.metadata.fleet.attempts}
              </span>
            )}
            <DiffStat {...stats} />
            <span className="muted small">
              {formatTokens(cost.tokens)} tok · {formatCost(cost.cost)} · {timeAgo(session.time.updated)}
            </span>
          </div>
          {activity && busy && <div className="activity small">{activity.label}</div>}
        </div>
        <div className="agent-actions">
          {busy && (
            <Button variant="danger" icon="stop" onClick={() => abort(sessionID)}>
              Stop
            </Button>
          )}
          <div className="menu-wrap">
            <Button icon="ship" onClick={() => setShip(!ship)} aria-expanded={ship}>
              Ship
            </Button>
            {ship && (
              <div className="menu" onMouseLeave={() => setShip(false)}>
                {SHIP_PROMPTS.map((p) => (
                  <button key={p.label} onClick={() => (setShip(false), send(sessionID, p.prompt))}>
                    {p.label}
                  </button>
                ))}
                {wt?.branch && <button onClick={() => (setShip(false), copy(`git merge ${wt.branch}`))}>Copy `git merge {wt.branch}`</button>}
              </div>
            )}
          </div>
          <Button icon="tiles" title="Add to tiles" onClick={() => setPicked(picked.includes(sessionID) ? picked : [...picked, sessionID])} />
          <Button icon="fork" title="Fork into a new agent" onClick={() => fork(sessionID)} />
          <Button icon="archive" title="Archive" onClick={() => archive(sessionID, !session.time.archived)} />
          <Button
            icon="trash"
            variant="ghost"
            title="Delete"
            onClick={() => {
              if (!confirm("Delete this agent and its history?")) return
              const withWt = !!wt && confirm(`Also remove its git worktree (${wt.branch ?? wt.name})? Uncommitted work there will be lost.`)
              void remove(sessionID, { removeWorktree: withWt })
            }}
          />
        </div>
      </header>
      <div className="agent-body">
        <section className="agent-main">
          <Transcript sessionID={sessionID} />
          <Composer sessionID={sessionID} autoFocus />
        </section>
        <aside className="agent-side">
          <nav className="tabs" role="tablist">
            {(
              [
                ["plan", "Plan", prog.total ? `${prog.done}/${prog.total}` : ""],
                ["changes", "Changes", stats.files ? String(stats.files) : ""],
                ["subagents", "Subagents", kids ? String(kids) : ""],
                ["info", "Info", ""],
              ] as [Tab, string, string][]
            ).map(([id, label, count]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label} {count && <span className="count">{count}</span>}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === "plan" && <Plan sessionID={sessionID} />}
            {tab === "changes" && <Changes sessionID={sessionID} />}
            {tab === "subagents" && <Subagents sessionID={sessionID} />}
            {tab === "info" && <Info sessionID={sessionID} />}
          </div>
        </aside>
      </div>
      {wt && (
        <footer className="agent-foot muted small">
          <Icon name="branch" size={12} /> Isolated in worktree <code>{wt.directory}</code>
        </footer>
      )}
    </div>
  )
}
