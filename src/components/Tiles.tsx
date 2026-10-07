import { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { diffStats, displayTitle, formatCost, lastModel, sessionChanges, sessionCost, statusLine } from "../state/derive"
import { useFleet } from "../state/store"
import { Composer } from "./Composer"
import { DiffView } from "./DiffView"
import { Transcript } from "./Transcript"
import { BranchBadge, Button, DiffStat, Empty, Icon, ModelBadge, StatusDot, usePhase, useRootSessions } from "./ui"

function Tile({ id, mode }: { id: string; mode: "live" | "diff" }) {
  const session = useFleet((s) => s.data.sessions[id])
  const phase = usePhase(id)
  const model = useFleet((s) => lastModel(s.data, id))
  const line = useFleet(useShallow((s) => statusLine(s.data, id)))
  const changes = useFleet((s) => sessionChanges(s.data, id))
  const cost = useFleet(useShallow((s) => sessionCost(s.data, id)))
  const { open, togglePick, markSeen, keepWinner } = useFleet.getState()
  if (!session) return null
  const stats = diffStats(changes, session)
  return (
    <div className={`tile tile-${phase}`} data-testid="tile" onFocusCapture={() => markSeen(id)}>
      <header className="tile-head">
        <StatusDot phase={phase} />
        <button className="tile-title ellipsis link" onClick={() => open(id)} title="Open full view">
          {displayTitle(session)}
        </button>
        <span className="grow" />
        {mode === "diff" && session.metadata?.fleet?.group && (
          <Button size="sm" variant="subtle" icon="check" onClick={() => keepWinner(id)} title="Keep this attempt and archive its siblings">
            Keep this one
          </Button>
        )}
        <button className="icon-btn" title="Remove from tiles" onClick={() => togglePick(id)}>
          <Icon name="x" size={13} />
        </button>
      </header>
      <div className="tile-meta">
        <ModelBadge model={model} />
        <BranchBadge session={session} />
        <DiffStat {...stats} />
        {cost.cost > 0 && <span className="muted small">{formatCost(cost.cost)}</span>}
      </div>
      {(phase === "running" || phase === "attention") && <div className={`tile-activity small ellipsis ${line.kind}`}>{line.text}</div>}
      <div className="tile-body">{mode === "live" ? <Transcript sessionID={id} compact /> : <DiffView diffs={changes} />}</div>
      <Composer sessionID={id} compact />
    </div>
  )
}

function Picker() {
  const sessions = useRootSessions()
  const { setPicked } = useFleet.getState()
  const data = useFleet((s) => s.data)
  const running = sessions.filter((s) => data.status[s.id]?.type === "busy").map((s) => s.id)
  return (
    <Empty title="Pick agents to watch side by side">
      <p>Tick the checkbox on any board card, use “Compare” on a best-of-N group, or:</p>
      <div className="row gap center">
        <Button variant="primary" disabled={!running.length} onClick={() => setPicked(running.slice(0, 6))}>
          Watch all running ({running.length})
        </Button>
        <Button disabled={!sessions.length} onClick={() => setPicked(sessions.slice(0, 4).map((s) => s.id))}>
          Latest 4
        </Button>
      </div>
    </Empty>
  )
}

export function Tiles() {
  const picked = useFleet(useShallow((s) => s.picked.filter((id) => s.data.sessions[id])))
  const broadcast = useFleet((s) => s.broadcast)
  const setPicked = useFleet((s) => s.setPicked)
  const [mode, setMode] = useState<"live" | "diff">("live")
  const [text, setText] = useState("")

  if (!picked.length) return <Picker />
  const cols = picked.length <= 1 ? 1 : picked.length <= 4 ? 2 : 3

  const send = () => {
    if (!text.trim()) return
    void broadcast(picked, text.trim())
    setText("")
  }

  return (
    <div className="tiles-wrap">
      <div className="tiles-bar">
        <div className="seg">
          <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
            Live
          </button>
          <button className={mode === "diff" ? "on" : ""} onClick={() => setMode("diff")} data-testid="compare-diffs">
            Compare diffs
          </button>
        </div>
        <div className="broadcast">
          <Icon name="broadcast" size={16} />
          <input
            className="input"
            data-testid="broadcast-input"
            placeholder={`Broadcast a message to all ${picked.length} agents…`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <Button variant="primary" size="sm" disabled={!text.trim()} onClick={send}>
            Send to {picked.length}
          </Button>
        </div>
        <Button size="sm" onClick={() => setPicked([])}>
          Clear
        </Button>
      </div>
      <div className="tiles" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {picked.map((id) => (
          <Tile key={id} id={id} mode={mode} />
        ))}
      </div>
    </div>
  )
}
