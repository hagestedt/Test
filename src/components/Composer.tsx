import { useEffect, useMemo, useRef, useState } from "react"
import { api, type ModelRef } from "../api/client"
import { lastAgent, lastModel } from "../state/derive"
import { useFleet } from "../state/store"
import { agentColor, Button, Icon, Kbd } from "./ui"

export function usePrimaryAgents() {
  const agents = useFleet((s) => s.agents)
  return useMemo(() => {
    const list = agents.filter((a) => a.mode !== "subagent" && !a.hidden).map((a) => a.name)
    return list.length ? list : ["build", "plan"]
  }, [agents])
}

export function useModelOptions() {
  const providers = useFleet((s) => s.providers)
  return useMemo(
    () =>
      (providers?.providers ?? []).flatMap((p) =>
        Object.values(p.models).map((m) => ({ value: `${p.id}/${m.id}`, label: `${m.name ?? m.id}`, provider: p.name })),
      ),
    [providers],
  )
}

export function defaultModel(): string | undefined {
  const p = useFleet.getState().providers
  if (!p) return undefined
  const [pid, mid] = Object.entries(p.default)[0] ?? []
  return pid ? `${pid}/${mid}` : undefined
}

export function toRef(value: string): ModelRef {
  const i = value.indexOf("/")
  return { providerID: value.slice(0, i), modelID: value.slice(i + 1) }
}

export function Composer({ sessionID, autoFocus, compact }: { sessionID: string; autoFocus?: boolean; compact?: boolean }) {
  const session = useFleet((s) => s.data.sessions[sessionID])
  const busy = useFleet((s) => s.data.status[sessionID]?.type !== undefined && s.data.status[sessionID]?.type !== "idle")
  const usedAgent = useFleet((s) => lastAgent(s.data, sessionID))
  const usedModel = useFleet((s) => lastModel(s.data, sessionID))
  const commands = useFleet((s) => s.commands)
  const send = useFleet((s) => s.send)
  const abort = useFleet((s) => s.abort)
  const toast = useFleet((s) => s.toast)
  const agents = usePrimaryAgents()
  const models = useModelOptions()
  const [text, setText] = useState("")
  const [agent, setAgent] = useState<string>()
  const [model, setModel] = useState<string>()
  const ref = useRef<HTMLTextAreaElement>(null)

  const currentAgent = agent ?? usedAgent ?? agents[0]
  const currentModel = model ?? usedModel ?? defaultModel()

  useEffect(() => {
    setAgent(undefined)
    setModel(undefined)
    if (autoFocus) ref.current?.focus()
  }, [sessionID, autoFocus])

  const slash = text.startsWith("/") && !text.includes(" ") ? commands.filter((c) => c.name.startsWith(text.slice(1))).slice(0, 6) : []

  const submit = async () => {
    const value = text.trim()
    if (!value || !session) return
    setText("")
    try {
      if (value.startsWith("!")) {
        await api.shell(session, value.slice(1).trim(), currentAgent)
      } else if (value.startsWith("/")) {
        const [cmd, ...rest] = value.slice(1).split(" ")
        if (commands.some((c) => c.name === cmd)) await api.command(session, cmd, rest.join(" "), currentAgent)
        else await send(sessionID, value, { agent: currentAgent, model: currentModel ? toRef(currentModel) : undefined })
      } else {
        await send(sessionID, value, { agent: currentAgent, model: currentModel ? toRef(currentModel) : undefined })
      }
    } catch (e) {
      setText(value)
      toast(e instanceof Error ? e.message : String(e), "error")
    }
  }

  const cycleAgent = () => {
    const i = agents.indexOf(currentAgent)
    setAgent(agents[(i + 1) % agents.length])
  }

  return (
    <div className={`composer ${compact ? "compact" : ""}`} style={{ "--agent": agentColor(currentAgent) } as React.CSSProperties}>
      {slash.length > 0 && (
        <div className="slash-menu">
          {slash.map((c) => (
            <button key={c.name} onMouseDown={(e) => (e.preventDefault(), setText(`/${c.name} `))}>
              <span className="mono">/{c.name}</span> <span className="muted">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        data-testid="composer-input"
        value={text}
        rows={compact ? 1 : 2}
        placeholder={busy ? "Queue a follow-up…" : "Ask for a change, /command, or !shell"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          } else if (e.key === "Tab" && !e.shiftKey && !text) {
            e.preventDefault()
            cycleAgent()
          } else if (e.key === "Escape" && busy) {
            e.preventDefault()
            void abort(sessionID)
          }
        }}
      />
      <div className="composer-bar">
        <button className="agent-pill" onClick={cycleAgent} title="Switch agent (Tab in an empty prompt)">
          {currentAgent}
        </button>
        {!compact && (
          <select className="select" value={currentModel ?? ""} onChange={(e) => setModel(e.target.value)} title="Model for the next turn">
            {currentModel && !models.some((m) => m.value === currentModel) && <option value={currentModel}>{currentModel}</option>}
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.provider} · {m.label}
              </option>
            ))}
          </select>
        )}
        <span className="grow" />
        {!compact && (
          <span className="muted small hint">
            <Kbd>↵</Kbd> send <Kbd>⇧↵</Kbd> newline{" "}
            {busy && (
              <>
                <Kbd>esc</Kbd> stop
              </>
            )}
          </span>
        )}
        {busy && (
          <Button size="sm" variant="danger" icon="stop" onClick={() => abort(sessionID)} title="Stop (Esc)">
            {compact ? "" : "Stop"}
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!text.trim()} aria-label="Send">
          <Icon name="send" size={14} />
        </Button>
      </div>
    </div>
  )
}
