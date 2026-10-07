import { useState } from "react"
import type { PermissionRequest, QuestionRequest } from "../api/types"
import { displayTitle } from "../state/derive"
import { useFleet } from "../state/store"
import { Button, Icon, Kbd } from "./ui"

function permissionSummary(p: PermissionRequest): { title: string; detail?: string } {
  const meta = p.metadata ?? {}
  if (p.permission === "bash") return { title: "Run a shell command", detail: String(meta.command ?? p.patterns.join(" ")) }
  if (p.permission === "edit") return { title: "Edit files", detail: String(meta.filepath ?? meta.filePath ?? p.patterns.join("\n")) }
  if (p.permission === "external_directory") return { title: "Access a directory outside the project", detail: p.patterns.join("\n") }
  if (p.permission === "webfetch") return { title: "Fetch a URL", detail: String(meta.url ?? p.patterns.join(" ")) }
  return { title: `Use ${p.permission}`, detail: p.patterns.join("\n") || undefined }
}

export function PermissionCard({ request, showSession, active }: { request: PermissionRequest; showSession?: boolean; active?: boolean }) {
  const reply = useFleet((s) => s.replyPermission)
  const open = useFleet((s) => s.open)
  const title = useFleet((s) => displayTitle(s.data.sessions[request.sessionID]))
  const [busy, setBusy] = useState(false)
  const { title: what, detail } = permissionSummary(request)
  const go = async (r: "once" | "always" | "reject") => {
    setBusy(true)
    await reply(request.id, r)
    setBusy(false)
  }
  return (
    <div className={`req req-permission ${active ? "req-active" : ""}`} data-testid="permission-card">
      <div className="req-head">
        <Icon name="bolt" size={14} />
        <span className="req-kind">Permission</span>
        {showSession && (
          <button className="link req-session" onClick={() => open(request.sessionID)}>
            {title ?? request.sessionID}
          </button>
        )}
      </div>
      <div className="req-title">{what}</div>
      {detail && <pre className="req-detail">{detail}</pre>}
      {request.always.length > 0 && (
        <div className="muted small">
          “Always” will allow: <code>{request.always.join(", ")}</code>
        </div>
      )}
      <div className="req-actions">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => go("once")} icon="check">
          Allow once {active && <Kbd>a</Kbd>}
        </Button>
        <Button variant="subtle" size="sm" disabled={busy} onClick={() => go("always")}>
          Always {active && <Kbd>⇧A</Kbd>}
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={() => go("reject")} icon="x">
          Deny {active && <Kbd>d</Kbd>}
        </Button>
      </div>
    </div>
  )
}

export function QuestionCard({ request, showSession }: { request: QuestionRequest; showSession?: boolean }) {
  const reply = useFleet((s) => s.replyQuestion)
  const reject = useFleet((s) => s.rejectQuestion)
  const open = useFleet((s) => s.open)
  const title = useFleet((s) => displayTitle(s.data.sessions[request.sessionID]))
  const [picked, setPicked] = useState<string[][]>(() => request.questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ""))
  const [busy, setBusy] = useState(false)

  const toggle = (qi: number, label: string, multiple?: boolean) =>
    setPicked((prev) =>
      prev.map((sel, i) => (i !== qi ? sel : multiple ? (sel.includes(label) ? sel.filter((l) => l !== label) : [...sel, label]) : [label])),
    )

  const answers = picked.map((sel, i) => (custom[i].trim() ? [...sel, custom[i].trim()] : sel))
  const ready = answers.every((a) => a.length > 0)
  const submit = async () => {
    setBusy(true)
    await reply(request.id, answers)
    setBusy(false)
  }

  return (
    <div className="req req-question" data-testid="question-card">
      <div className="req-head">
        <Icon name="sparkle" size={14} />
        <span className="req-kind">Question</span>
        {showSession && (
          <button className="link req-session" onClick={() => open(request.sessionID)}>
            {title ?? request.sessionID}
          </button>
        )}
      </div>
      {request.questions.map((q, qi) => (
        <div key={qi} className="q">
          <div className="req-title">{q.question}</div>
          <div className="q-options">
            {q.options.map((o) => (
              <button
                key={o.label}
                className={`q-opt ${picked[qi].includes(o.label) ? "on" : ""}`}
                onClick={() => toggle(qi, o.label, q.multiple)}
                aria-pressed={picked[qi].includes(o.label)}
              >
                <span className="q-label">{o.label}</span>
                <span className="q-desc">{o.description}</span>
              </button>
            ))}
          </div>
          {q.custom !== false && (
            <input
              className="input"
              placeholder="Or type your own answer…"
              value={custom[qi]}
              onChange={(e) => setCustom((c) => c.map((v, i) => (i === qi ? e.target.value : v)))}
              onKeyDown={(e) => e.key === "Enter" && ready && submit()}
            />
          )}
        </div>
      ))}
      <div className="req-actions">
        <Button variant="primary" size="sm" disabled={!ready || busy} onClick={submit} icon="send">
          Answer
        </Button>
        <Button size="sm" disabled={busy} onClick={() => reject(request.id)}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
