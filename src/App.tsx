import { useEffect } from "react"
import { AgentView } from "./components/AgentView"
import { Board } from "./components/Board"
import { Sidebar, Toasts, Topbar } from "./components/Chrome"
import { Inbox, useAttentionCount } from "./components/Inbox"
import { Launcher } from "./components/Launcher"
import { Palette } from "./components/Palette"
import { Tiles } from "./components/Tiles"
import { Button, useRootSessions } from "./components/ui"
import { useFleet } from "./state/store"

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return !!t?.closest("input, textarea, select, [contenteditable=true]")
}

function useShortcuts() {
  const sessions = useRootSessions()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useFleet.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        st.setPalette(!st.paletteOpen)
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || st.launcherOpen || st.paletteOpen) return
      const idx = sessions.findIndex((s) => s.id === st.selected)
      switch (e.key) {
        case "n":
        case "N":
          st.setLauncher(true)
          break
        case "b":
          st.setView("board")
          break
        case "t":
          st.setView("tiles")
          break
        case "i":
          st.setView("inbox")
          break
        case "]":
          if (sessions.length) st.open(sessions[(idx + 1) % sessions.length].id)
          break
        case "[":
          if (sessions.length) st.open(sessions[(idx - 1 + sessions.length) % sessions.length].id)
          break
        case "Escape":
          if (st.view === "agent") st.setView("board")
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [sessions])
}

function Offline() {
  const error = useFleet((s) => s.error)
  const init = useFleet((s) => s.init)
  return (
    <div className="offline">
      <h2>Can't reach the OpenCode server</h2>
      <p className="muted">{error}</p>
      <p>
        Start Fleet with <code>npx opencode-fleet</code> in your project (it launches <code>opencode serve</code> for you), or point it at a running
        server with <code>--opencode http://127.0.0.1:4096</code>.
      </p>
      <Button variant="primary" onClick={() => void init()}>
        Retry
      </Button>
    </div>
  )
}

export function App() {
  const view = useFleet((s) => s.view)
  const selected = useFleet((s) => s.selected)
  const root = useFleet((s) => s.root)
  const conn = useFleet((s) => s.conn)
  const attention = useAttentionCount()
  useShortcuts()

  useEffect(() => void useFleet.getState().init(), [])

  useEffect(() => {
    const name = root?.project.name ?? root?.directory.split("/").pop() ?? "OpenCode"
    document.title = `${attention ? `(${attention}) ` : ""}Fleet · ${name}`
  }, [attention, root])

  if (!root && conn === "offline") return <Offline />

  return (
    <div className="app">
      <Topbar />
      <div className="main">
        <Sidebar />
        <main className="content" data-view={view}>
          {view === "board" && <Board />}
          {view === "tiles" && <Tiles />}
          {view === "inbox" && <Inbox />}
          {view === "agent" && selected && <AgentView key={selected} sessionID={selected} />}
        </main>
      </div>
      {conn !== "online" && root && <div className="banner">Reconnecting to OpenCode…</div>}
      <Launcher />
      <Palette />
      <Toasts />
    </div>
  )
}
