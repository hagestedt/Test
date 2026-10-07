import { useEffect, useMemo, useRef, useState } from "react"
import { useFleet, type Isolation } from "../state/store"
import { defaultModel, toRef, useModelOptions, usePrimaryAgents } from "./Composer"
import { Button, Icon, Kbd } from "./ui"

const TEMPLATES = [
  "Find and fix the most likely bug in this codebase. Add a regression test.",
  "Increase test coverage for the least-tested module.",
  "Review the codebase for security issues and fix what you find.",
  "Improve the README so a new contributor can get running in 5 minutes.",
]

export function Launcher() {
  const open = useFleet((s) => s.launcherOpen)
  const setOpen = useFleet((s) => s.setLauncher)
  const launch = useFleet((s) => s.launch)
  const openAgent = useFleet((s) => s.open)
  const setPicked = useFleet((s) => s.setPicked)
  const setView = useFleet((s) => s.setView)
  const last = useFleet((s) => s.prefs.lastLaunch)
  const connected = useFleet((s) => !!s.root)
  const isGit = useFleet((s) => s.root?.project.vcs === "git")
  const agents = usePrimaryAgents()
  const modelOptions = useModelOptions()

  const [prompt, setPrompt] = useState("")
  const [agent, setAgent] = useState(last?.agent ?? "build")
  const [models, setModels] = useState<string[]>([])
  const [attempts, setAttempts] = useState(last?.attempts ?? 1)
  const [isolation, setIsolation] = useState<Isolation>(last?.isolation ?? "worktree")
  const [perLine, setPerLine] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Defaults depend on server data that may still be loading when the dialog first opens.
  useEffect(() => {
    if (!open) return
    setTimeout(() => ref.current?.focus(), 0)
  }, [open])
  useEffect(() => {
    if (!open || !modelOptions.length) return
    const valid = new Set(modelOptions.map((m) => m.value))
    setModels((current) => {
      if (current.some((m) => valid.has(m))) return current.filter((m) => valid.has(m))
      const remembered = (last?.models ?? []).map((m) => `${m.providerID}/${m.modelID}`).filter((m) => valid.has(m))
      const fallback = defaultModel()
      return remembered.length ? remembered : fallback && valid.has(fallback) ? [fallback] : [modelOptions[0].value]
    })
  }, [open, modelOptions, last])
  useEffect(() => {
    if (open && !last?.isolation) setIsolation(isGit ? "worktree" : "shared")
  }, [open, isGit, last?.isolation])

  const tasks = useMemo(
    () =>
      perLine
        ? prompt
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        : prompt.trim()
          ? [prompt.trim()]
          : [],
    [prompt, perLine],
  )
  const total = tasks.length * models.length * attempts
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return modelOptions.filter((m) => !q || m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)).slice(0, 50)
  }, [modelOptions, query])

  if (!open) return null

  const submit = async () => {
    if (!total || busy || !connected) return
    if (total > 12 && !confirm(`Launch ${total} agents at once?`)) return
    setBusy(true)
    try {
      const all = (await Promise.all(tasks.map((t) => launch({ prompt: t, agent, models: models.map(toRef), attempts, isolation })))).flat()
      setPrompt("")
      setOpen(false)
      if (all.length === 1) openAgent(all[0].id)
      else if (all.length > 1) {
        setPicked(all.slice(0, 6).map((s) => s.id))
        setView(all.length <= 6 ? "tiles" : "board")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal launcher" role="dialog" aria-label="Launch agents" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <header className="modal-head">
          <Icon name="bolt" />
          <h2>Launch agents</h2>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

        <textarea
          ref={ref}
          className="launch-prompt"
          data-testid="launch-prompt"
          placeholder={perLine ? "One task per line — each becomes its own agent" : "What should the agents do?"}
          value={prompt}
          rows={5}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {!prompt && (
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button key={t} className="chip" onClick={() => setPrompt(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={perLine} onChange={(e) => setPerLine(e.target.checked)} />
          One task per line (fan out different tasks)
        </label>

        <div className="launch-grid">
          <div className="field">
            <div className="field-label">Agent</div>
            <div className="seg">
              {agents.map((a) => (
                <button key={a} className={agent === a ? "on" : ""} onClick={() => setAgent(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-label">Attempts per model</div>
            <div className="stepper">
              <button onClick={() => setAttempts(Math.max(1, attempts - 1))} aria-label="Fewer attempts">
                −
              </button>
              <span data-testid="attempts">{attempts}</span>
              <button onClick={() => setAttempts(Math.min(8, attempts + 1))} aria-label="More attempts">
                +
              </button>
            </div>
          </div>

          <div className="field">
            <div className="field-label">Isolation</div>
            <div className="seg">
              <button
                className={isolation === "worktree" ? "on" : ""}
                onClick={() => setIsolation("worktree")}
                disabled={!isGit}
                title={isGit ? "" : "Requires a git repository"}
              >
                <Icon name="branch" size={13} /> Worktree each
              </button>
              <button className={isolation === "shared" ? "on" : ""} onClick={() => setIsolation("shared")}>
                Shared dir
              </button>
            </div>
          </div>
        </div>

        <div className="field">
          <div className="field-label">
            Models <span className="muted">({models.length} selected — pick several to race them)</span>
          </div>
          <div className="model-chips">
            {models.map((m) => (
              <span key={m} className="chip on">
                {m}
                <button onClick={() => setModels(models.filter((x) => x !== m))} aria-label={`Remove ${m}`}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
          <input className="input" placeholder="Search models…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="model-list">
            {filtered.map((m) => (
              <label key={m.value} className="model-opt">
                <input
                  type="checkbox"
                  checked={models.includes(m.value)}
                  onChange={(e) => setModels(e.target.checked ? [...models, m.value] : models.filter((x) => x !== m.value))}
                />
                <span>{m.label}</span>
                <span className="muted small">{m.provider}</span>
              </label>
            ))}
          </div>
        </div>

        {isolation === "shared" && total > 1 && (
          <div className="warn small">
            {total} agents will edit the same working directory concurrently. Use worktrees unless the tasks are read-only.
          </div>
        )}

        <footer className="modal-foot">
          <span className="muted small" data-testid="launch-summary">
            {total
              ? `${total} agent${total > 1 ? "s" : ""}${tasks.length > 1 ? ` · ${tasks.length} tasks` : ""}${models.length > 1 ? ` · ${models.length} models` : ""}${
                  isolation === "worktree" ? ` · ${total} worktree${total > 1 ? "s" : ""}` : ""
                } · ${agent}`
              : connected
                ? "Write a task to get started"
                : "Connecting to OpenCode…"}
          </span>
          <span className="grow" />
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" icon="bolt" disabled={!total || busy || !connected} onClick={() => void submit()} data-testid="launch-submit">
            {busy ? "Launching…" : `Launch ${total || ""}`} <Kbd>⌘↵</Kbd>
          </Button>
        </footer>
      </div>
    </div>
  )
}
