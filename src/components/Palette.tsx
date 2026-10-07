import { useEffect, useMemo, useRef, useState } from "react"
import { phaseOf } from "../state/derive"
import { useFleet } from "../state/store"
import { Icon, Kbd, StatusDot, useRootSessions, type IconName } from "./ui"

interface Item {
  id: string
  label: string
  hint?: string
  icon?: IconName
  session?: string
  run: () => void
}

/** Subsequence match score; lower is better, -1 for no match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx >= 0) return idx
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const next = t.indexOf(ch, ti)
    if (next < 0) return -1
    gaps += next - ti
    ti = next + 1
  }
  return 100 + gaps
}

export function Palette() {
  const open = useFleet((s) => s.paletteOpen)
  const setOpen = useFleet((s) => s.setPalette)
  const sessions = useRootSessions()
  const data = useFleet((s) => s.data)
  const seen = useFleet((s) => s.prefs.seenAt)
  const [q, setQ] = useState("")
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ("")
      setCursor(0)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const st = useFleet.getState()
    const running = sessions.filter((s) => data.status[s.id]?.type === "busy")
    const actions: Item[] = [
      { id: "new", label: "Launch agents…", hint: "N", icon: "plus", run: () => st.setLauncher(true) },
      { id: "board", label: "Go to board", hint: "B", icon: "board", run: () => st.setView("board") },
      { id: "tiles", label: "Go to tiles", hint: "T", icon: "tiles", run: () => st.setView("tiles") },
      { id: "inbox", label: "Go to inbox", hint: "I", icon: "inbox", run: () => st.setView("inbox") },
      {
        id: "watch",
        label: `Watch all running agents (${running.length})`,
        icon: "eye",
        run: () => (st.setPicked(running.slice(0, 9).map((s) => s.id)), st.setView("tiles")),
      },
      { id: "stopall", label: `Stop all running agents (${running.length})`, icon: "stop", run: () => running.forEach((s) => void st.abort(s.id)) },
      {
        id: "allow",
        label: `Allow all pending permissions once (${Object.keys(data.permissions).length})`,
        icon: "check",
        run: () => Object.keys(data.permissions).forEach((id) => void st.replyPermission(id, "once")),
      },
      {
        id: "archived",
        label: st.showArchived ? "Hide archived agents" : "Show archived agents",
        icon: "archive",
        run: () => st.setShowArchived(!st.showArchived),
      },
      {
        id: "notify",
        label: st.prefs.notify ? "Turn off desktop notifications" : "Turn on desktop notifications",
        icon: "bell",
        run: () => st.setNotify(!st.prefs.notify),
      },
      { id: "refresh", label: "Resync with OpenCode server", icon: "undo", run: () => void st.refresh() },
    ]
    const agents: Item[] = sessions.map((s) => ({
      id: s.id,
      label: s.title || "Untitled agent",
      hint: s.metadata?.fleet?.worktree?.branch,
      session: s.id,
      run: () => st.open(s.id),
    }))
    const all = [...actions, ...agents]
    if (!q) return all
    return all
      .map((it) => ({ it, score: fuzzy(q, `${it.label} ${it.hint ?? ""}`) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.it)
  }, [sessions, data.status, data.permissions, q])

  useEffect(() => {
    listRef.current?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  if (!open) return null
  const choose = (it?: Item) => {
    if (!it) return
    setOpen(false)
    it.run()
  }
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal palette" role="dialog" aria-label="Command palette">
        <div className="pal-input">
          <Icon name="search" />
          <input
            autoFocus
            data-testid="palette-input"
            placeholder="Search agents and actions…"
            value={q}
            onChange={(e) => (setQ(e.target.value), setCursor(0))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(c + 1, items.length - 1)))
              else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)))
              else if (e.key === "Enter") (e.preventDefault(), choose(items[cursor]))
              else if (e.key === "Escape") setOpen(false)
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="pal-list" ref={listRef}>
          {items.map((it, i) => (
            <button key={it.id} className={`pal-item ${i === cursor ? "on" : ""}`} onMouseMove={() => setCursor(i)} onClick={() => choose(it)}>
              {it.session ? <StatusDot phase={phaseOf(data, it.session, seen[it.session])} /> : <Icon name={it.icon ?? "bolt"} size={14} />}
              <span className="ellipsis">{it.label}</span>
              <span className="grow" />
              {it.hint && (it.session ? <span className="muted small">{it.hint}</span> : <Kbd>{it.hint}</Kbd>)}
            </button>
          ))}
          {!items.length && <div className="muted pad">No matches</div>}
        </div>
      </div>
    </div>
  )
}
