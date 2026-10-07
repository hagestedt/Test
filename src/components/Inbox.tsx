import { useEffect, useMemo, useState } from "react"
import { displayTitle } from "../state/derive"
import { useFleet } from "../state/store"
import { PermissionCard, QuestionCard } from "./Requests"
import { Button, Empty, Kbd } from "./ui"

export function useAttentionCount() {
  return useFleet((s) => {
    const errored = Object.keys(s.data.errors).filter((id) => s.data.errors[id] && s.data.sessions[id] && !s.data.sessions[id].parentID).length
    return Object.keys(s.data.permissions).length + Object.keys(s.data.questions).length + errored
  })
}

export function Inbox() {
  const permissions = useFleet((s) => s.data.permissions)
  const questions = useFleet((s) => s.data.questions)
  const errors = useFleet((s) => s.data.errors)
  const sessions = useFleet((s) => s.data.sessions)
  const { replyPermission, open, send } = useFleet.getState()
  const [cursor, setCursor] = useState(0)

  const perms = useMemo(() => Object.values(permissions).sort((a, b) => (a.id < b.id ? -1 : 1)), [permissions])
  const qs = useMemo(() => Object.values(questions).sort((a, b) => (a.id < b.id ? -1 : 1)), [questions])
  const errs = useMemo(
    () => Object.entries(errors).filter(([id, e]) => e && sessions[id] && !sessions[id].parentID) as [string, NonNullable<(typeof errors)[string]>][],
    [errors, sessions],
  )

  useEffect(() => setCursor((c) => Math.min(c, Math.max(0, perms.length - 1))), [perms.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return
      const p = perms[cursor]
      if (e.key === "j" || e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, perms.length - 1))
      else if (e.key === "k" || e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0))
      else if (p && e.key === "a") void replyPermission(p.id, "once")
      else if (p && e.key === "A") void replyPermission(p.id, "always")
      else if (p && e.key === "d") void replyPermission(p.id, "reject")
      else if (p && e.key === "o") open(p.sessionID)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [perms, cursor, replyPermission, open])

  if (!perms.length && !qs.length && !errs.length)
    return (
      <Empty title="Inbox zero">
        Approvals, questions and errors from every agent show up here, so you can unblock the whole fleet from one place.
      </Empty>
    )

  return (
    <div className="inbox">
      <div className="inbox-head">
        <h2>Needs you</h2>
        <span className="muted small">
          <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>a</Kbd> allow · <Kbd>⇧A</Kbd> always · <Kbd>d</Kbd> deny · <Kbd>o</Kbd> open agent
        </span>
        <span className="grow" />
        {perms.length > 1 && (
          <Button variant="subtle" size="sm" onClick={() => perms.forEach((p) => void replyPermission(p.id, "once"))}>
            Allow all {perms.length} once
          </Button>
        )}
      </div>
      {perms.length > 0 && (
        <section>
          <h3 className="section-label">Permissions · {perms.length}</h3>
          {perms.map((p, i) => (
            <div key={p.id} onMouseEnter={() => setCursor(i)}>
              <PermissionCard request={p} showSession active={i === cursor} />
            </div>
          ))}
        </section>
      )}
      {qs.length > 0 && (
        <section>
          <h3 className="section-label">Questions · {qs.length}</h3>
          {qs.map((q) => (
            <QuestionCard key={q.id} request={q} showSession />
          ))}
        </section>
      )}
      {errs.length > 0 && (
        <section>
          <h3 className="section-label">Errors · {errs.length}</h3>
          {errs.map(([id, e]) => (
            <div key={id} className="req req-error">
              <div className="req-head">
                <span className="req-kind">{e.name}</span>
                <button className="link req-session" onClick={() => open(id)}>
                  {displayTitle(sessions[id])}
                </button>
              </div>
              <pre className="req-detail">{e.data?.message ?? "Unknown error"}</pre>
              <div className="req-actions">
                <Button size="sm" variant="primary" onClick={() => send(id, "Continue where you left off.")}>
                  Retry
                </Button>
                <Button size="sm" onClick={() => open(id)}>
                  Open
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
