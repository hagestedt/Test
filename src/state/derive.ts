import type { AssistantMessage, FileDiff, Session, Todo } from "../api/types"
import type { FleetData } from "./reducer"

/** Where an agent sits on the board, in priority order. */
export type Phase = "attention" | "running" | "review" | "done"

export const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: "attention", label: "Needs you", hint: "Waiting on an approval, an answer, or hit an error" },
  { id: "running", label: "Running", hint: "Working right now" },
  { id: "review", label: "Ready for review", hint: "Finished since you last looked" },
  { id: "done", label: "Reviewed", hint: "Idle and already seen" },
]

export function phaseOf(data: FleetData, id: string, seenAt: number | undefined): Phase {
  if (hasPending(data, id) || data.errors[id]) return "attention"
  const st = data.status[id]
  if (st && st.type !== "idle") return "running"
  const finished = data.finishedAt[id] ?? data.sessions[id]?.time.updated ?? 0
  if (!seenAt || finished > seenAt) return "review"
  return "done"
}

export function hasPending(data: FleetData, id: string): boolean {
  for (const p of Object.values(data.permissions)) if (p.sessionID === id) return true
  for (const q of Object.values(data.questions)) if (q.sessionID === id) return true
  return false
}

export function todoProgress(todos: Todo[] | undefined) {
  const list = (todos ?? []).filter((t) => t.status !== "cancelled")
  const done = list.filter((t) => t.status === "completed").length
  const current = list.find((t) => t.status === "in_progress")
  return { done, total: list.length, current }
}

const changesCache = new WeakMap<object, { diffs: FileDiff[] | undefined; result: FileDiff[] }>()
const NO_DIFFS: FileDiff[] = []

/** Aggregate per-turn diffs (stored on user messages) into one entry per file. Memoized by input identity. */
export function sessionChanges(data: FleetData, id: string): FileDiff[] {
  const key = data.messages[id]
  if (!key) return data.diffs[id] ?? NO_DIFFS
  const hit = changesCache.get(key)
  if (hit && hit.diffs === data.diffs[id]) return hit.result
  const result = computeChanges(data, id)
  changesCache.set(key, { diffs: data.diffs[id], result })
  return result
}

function computeChanges(data: FleetData, id: string): FileDiff[] {
  const byFile = new Map<string, FileDiff>()
  for (const m of data.messages[id] ?? []) {
    if (m.role !== "user") continue
    for (const d of m.summary?.diffs ?? []) {
      const key = d.file ?? "?"
      const prev = byFile.get(key)
      byFile.set(
        key,
        prev
          ? {
              ...d,
              additions: prev.additions + d.additions,
              deletions: prev.deletions + d.deletions,
              patch: [prev.patch, d.patch].filter(Boolean).join("\n"),
              status: prev.status === "added" ? "added" : d.status,
            }
          : d,
      )
    }
  }
  for (const d of data.diffs[id] ?? []) if (d.file && !byFile.has(d.file)) byFile.set(d.file, d)
  return [...byFile.values()]
}

export function diffStats(diffs: FileDiff[], session?: Session) {
  if (!diffs.length && session?.summary)
    return { files: session.summary.files, additions: session.summary.additions, deletions: session.summary.deletions }
  return {
    files: diffs.length,
    additions: diffs.reduce((a, d) => a + d.additions, 0),
    deletions: diffs.reduce((a, d) => a + d.deletions, 0),
  }
}

export function sessionCost(data: FleetData, id: string): { cost: number; tokens: number } {
  const s = data.sessions[id]
  let cost = 0
  let tokens = 0
  for (const m of data.messages[id] ?? []) {
    if (m.role !== "assistant") continue
    const a = m as AssistantMessage
    cost += a.cost ?? 0
    tokens += (a.tokens?.input ?? 0) + (a.tokens?.output ?? 0) + (a.tokens?.reasoning ?? 0)
  }
  if (!tokens && s?.tokens) tokens = s.tokens.input + s.tokens.output + s.tokens.reasoning
  if (!cost && s?.cost) cost = s.cost
  return { cost, tokens }
}

export function lastModel(data: FleetData, id: string): string | undefined {
  const msgs = data.messages[id] ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === "assistant") return `${m.providerID}/${m.modelID}`
    if (m.role === "user") return `${m.model.providerID}/${m.model.modelID}`
  }
  const s = data.sessions[id]
  return s?.model ? `${s.model.providerID}/${s.model.id}` : undefined
}

export function lastAgent(data: FleetData, id: string): string | undefined {
  const msgs = data.messages[id] ?? []
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].agent) return msgs[i].agent
  return data.sessions[id]?.agent
}

export function childrenOf(data: FleetData, id: string): Session[] {
  return Object.values(data.sessions).filter((s) => s.parentID === id)
}

export function formatCost(n: number) {
  if (!n) return "$0"
  return n < 0.01 ? `<$0.01` : `$${n.toFixed(2)}`
}

export function formatTokens(n: number) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function timeAgo(ts: number | undefined, now = Date.now()) {
  if (!ts) return ""
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return "now"
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** One-line "what is this agent doing" summary; blockers outrank whatever streamed last. */
export function statusLine(data: FleetData, id: string): { text: string; kind: string } {
  const error = data.errors[id]
  if (error) return { text: error.data?.message ?? error.name, kind: "error" }
  for (const p of Object.values(data.permissions)) if (p.sessionID === id) return { text: `Needs approval: ${p.permission}`, kind: "permission" }
  for (const q of Object.values(data.questions))
    if (q.sessionID === id) return { text: `Asking: ${q.questions[0]?.header ?? "a question"}`, kind: "question" }
  const busy = data.status[id] && data.status[id].type !== "idle"
  const current = todoProgress(data.todos[id]).current
  if (busy && current) return { text: current.content, kind: "text" }
  const act = data.activity[id]
  return { text: act?.label ?? (busy ? "Starting" : "Idle"), kind: act?.kind ?? "" }
}

/** Title with the best-of-N attempt number, so sibling attempts are distinguishable. */
export function displayTitle(s: Session | undefined): string {
  if (!s) return "Unknown agent"
  const t = s.title || "Untitled agent"
  const f = s.metadata?.fleet
  return f?.group && f.attempts && f.attempts > 1 ? `${t} #${f.attempt}` : t
}
