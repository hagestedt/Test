import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { AssistantMessage, Message, Part, ToolState } from "../api/types"
import { describeTool, shortPath } from "../state/reducer"
import { useFleet } from "../state/store"
import { DiffView } from "./DiffView"
import { Markdown } from "./Markdown"
import { PermissionCard, QuestionCard } from "./Requests"
import { AgentBadge, Icon, type IconName } from "./ui"

const EMPTY: Part[] = []

const TOOL_ICON: Record<string, IconName> = {
  bash: "terminal",
  write: "file",
  edit: "edit",
  apply_patch: "edit",
  read: "eye",
  glob: "search",
  grep: "search",
  todowrite: "check",
  task: "fork",
  question: "sparkle",
}

function duration(state: ToolState) {
  if (state.status !== "completed" && state.status !== "error") return ""
  const ms = state.time.end - state.time.start
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function ToolBody({ tool, state }: { tool: string; state: ToolState }) {
  const input = (state.input ?? {}) as Record<string, unknown>
  const output = state.status === "completed" ? state.output : state.status === "error" ? state.error : undefined
  if (tool === "edit" && typeof input.oldString === "string" && typeof input.newString === "string") {
    const patch = [
      "@@ -1 +1 @@",
      ...String(input.oldString)
        .split("\n")
        .map((l) => `-${l}`),
      ...String(input.newString)
        .split("\n")
        .map((l) => `+${l}`),
    ].join("\n")
    return (
      <DiffView
        diffs={[
          {
            file: shortPath(String(input.filePath ?? "")),
            patch,
            additions: String(input.newString).split("\n").length,
            deletions: String(input.oldString).split("\n").length,
          },
        ]}
      />
    )
  }
  if (tool === "write" && typeof input.content === "string") return <pre className="tool-pre">{input.content}</pre>
  if (tool === "todowrite" && Array.isArray(input.todos)) {
    return (
      <ul className="todo-inline">
        {(input.todos as { content: string; status: string }[]).map((t, i) => (
          <li key={i} className={`todo-${t.status}`}>
            <TodoMark status={t.status} /> {t.content}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      {tool === "bash" && typeof input.command === "string" ? (
        <pre className="tool-pre tool-cmd">$ {input.command}</pre>
      ) : (
        Object.keys(input).length > 0 && <pre className="tool-pre muted">{JSON.stringify(input, null, 2)}</pre>
      )}
      {output && (
        <pre className={`tool-pre ${state.status === "error" ? "tool-err" : ""}`}>
          {output.length > 6000 ? output.slice(0, 6000) + "\n…" : output}
        </pre>
      )}
    </>
  )
}

export function TodoMark({ status }: { status: string }) {
  if (status === "completed") return <Icon name="check" size={13} className="todo-mark done" />
  if (status === "in_progress") return <span className="todo-mark spin" />
  if (status === "cancelled") return <Icon name="x" size={13} className="todo-mark" />
  return <span className="todo-mark circle" />
}

const ToolCall = memo(function ToolCall({ part }: { part: Extract<Part, { type: "tool" }> }) {
  const [open, setOpen] = useState(false)
  const open_ = useFleet((s) => s.open)
  const st = part.state
  const title = st.status === "running" || st.status === "completed" ? st.title : undefined
  const childId = (st as { metadata?: { sessionId?: string } }).metadata?.sessionId
  return (
    <div className={`tool tool-${st.status}`} data-testid="tool-call" data-tool={part.tool}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-status">
          {st.status === "running" || st.status === "pending" ? (
            <span className="spinner" />
          ) : st.status === "error" ? (
            <Icon name="x" size={13} />
          ) : (
            <Icon name={TOOL_ICON[part.tool] ?? "bolt"} size={13} />
          )}
        </span>
        <span className="tool-name">{part.tool}</span>
        <span className="tool-desc">{describeTool(part.tool, st.input, title).replace(new RegExp(`^${part.tool}:? ?`), "")}</span>
        <span className="tool-dur muted">{duration(st)}</span>
        <Icon name="chevron" size={13} className={open ? "rot90" : ""} />
      </button>
      {childId && (
        <button className="link small tool-child" onClick={() => open_(childId)}>
          Open subagent →
        </button>
      )}
      {open && (
        <div className="tool-body">
          <ToolBody tool={part.tool} state={st} />
        </div>
      )}
    </div>
  )
})

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      if (part.synthetic || part.ignored || !part.text.trim()) return null
      return <Markdown text={part.text} />
    case "reasoning":
      if (!part.text.trim()) return null
      return (
        <details className="reasoning">
          <summary>Thinking{part.time.end ? "" : "…"}</summary>
          <Markdown text={part.text} className="muted" />
        </details>
      )
    case "tool":
      return <ToolCall part={part} />
    case "subtask":
      return (
        <div className="subtask">
          <Icon name="fork" size={13} /> Delegated to <AgentBadge name={part.agent} /> {part.description}
        </div>
      )
    case "file":
      return (
        <span className="chip">
          <Icon name="file" size={12} /> {part.filename ?? part.url}
        </span>
      )
    case "patch":
      return part.files.length ? (
        <div className="patch-note muted small">
          <Icon name="edit" size={12} /> Changed {part.files.map((f) => shortPath(f)).join(", ")}
        </div>
      ) : null
    case "retry":
      return (
        <div className="retry small">
          Retrying (attempt {part.attempt}): {part.error?.data?.message ?? part.error?.name}
        </div>
      )
    case "compaction":
      return <div className="muted small">— conversation compacted —</div>
  }
  return null
}

const MessageView = memo(function MessageView({ message, sessionID, onRevert }: { message: Message; sessionID: string; onRevert?: () => void }) {
  const parts = useFleet((s) => s.data.parts[message.id] ?? EMPTY)
  const fork = useFleet((s) => s.fork)
  if (message.role === "user") {
    const text = parts.filter((p) => p.type === "text" && !p.synthetic).map((p) => (p as { text: string }).text)
    return (
      <div className="msg msg-user" data-testid="user-message">
        <div className="msg-user-body">
          {text.map((t, i) => (
            <div key={i} className="pre-wrap">
              {t}
            </div>
          ))}
          {parts
            .filter((p) => p.type === "file")
            .map((p) => (
              <PartView key={p.id} part={p} />
            ))}
        </div>
        <div className="msg-actions">
          <AgentBadge name={message.agent} />
          {onRevert && (
            <button className="link small" onClick={onRevert} title="Undo this turn and everything after it">
              <Icon name="undo" size={12} /> Revert
            </button>
          )}
          <button className="link small" onClick={() => fork(sessionID, message.id)} title="Start a new agent from before this message">
            <Icon name="fork" size={12} /> Fork
          </button>
        </div>
      </div>
    )
  }
  const a = message as AssistantMessage
  return (
    <div className="msg msg-assistant" data-testid="assistant-message">
      {parts.map((p) => (
        <PartView key={p.id} part={p} />
      ))}
      {a.error && a.error.name !== "MessageAbortedError" && (
        <div className="msg-error">
          <strong>{a.error.name}</strong> {a.error.data?.message}
        </div>
      )}
      {a.error?.name === "MessageAbortedError" && <div className="muted small">Stopped.</div>}
    </div>
  )
})

export function Transcript({ sessionID, compact }: { sessionID: string; compact?: boolean }) {
  const messages = useFleet((s) => s.data.messages[sessionID])
  const loaded = useFleet((s) => s.loaded[sessionID])
  const session = useFleet((s) => s.data.sessions[sessionID])
  const status = useFleet((s) => s.data.status[sessionID])
  const permissions = useFleet((s) => s.data.permissions)
  const questions = useFleet((s) => s.data.questions)
  const revert = useFleet((s) => s.revert)
  const unrevert = useFleet((s) => s.unrevert)
  const ensure = useFleet((s) => s.ensureLoaded)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => void ensure(sessionID), [sessionID, ensure])

  const pendingP = useMemo(() => Object.values(permissions).filter((p) => p.sessionID === sessionID), [permissions, sessionID])
  const pendingQ = useMemo(() => Object.values(questions).filter((q) => q.sessionID === sessionID), [questions, sessionID])

  const revertAt = session?.revert?.messageID
  const visible = useMemo(() => (messages ?? []).filter((m) => !revertAt || m.id < revertAt), [messages, revertAt])
  const hidden = (messages?.length ?? 0) - visible.length

  const lastPartsLen = useFleet((s) => {
    const last = visible[visible.length - 1]
    if (!last) return 0
    const parts = s.data.parts[last.id] ?? EMPTY
    const tail = parts[parts.length - 1]
    return parts.length * 1e6 + (tail && "text" in tail ? (tail as { text: string }).text.length : 0)
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length, lastPartsLen, pendingP.length, pendingQ.length])

  return (
    <div
      ref={ref}
      className={`transcript ${compact ? "compact" : ""}`}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {!messages && loaded !== false && <div className="muted pad">Loading…</div>}
      {messages && !visible.length && !hidden && <div className="muted pad">No messages yet.</div>}
      {visible.map((m) => (
        <MessageView
          key={m.id}
          message={m}
          sessionID={sessionID}
          onRevert={m.role === "user" && !compact ? () => revert(sessionID, m.id) : undefined}
        />
      ))}
      {hidden > 0 && (
        <div className="reverted">
          {hidden} message{hidden === 1 ? "" : "s"} reverted.{" "}
          <button className="link" onClick={() => unrevert(sessionID)}>
            Restore
          </button>
        </div>
      )}
      {status && status.type === "retry" && <div className="retry small">Retrying: {status.message}</div>}
      {status && status.type !== "idle" && !pendingP.length && !pendingQ.length && (
        <div className="working">
          <span className="spinner" /> Working…
        </div>
      )}
      {pendingP.map((p) => (
        <PermissionCard key={p.id} request={p} />
      ))}
      {pendingQ.map((q) => (
        <QuestionCard key={q.id} request={q} />
      ))}
    </div>
  )
}
