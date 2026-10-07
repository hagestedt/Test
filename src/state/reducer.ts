import type {
  FileDiff,
  Message,
  MessageError,
  MessageWithParts,
  OpencodeEvent,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "../api/types"

export interface Activity {
  label: string
  kind: "tool" | "text" | "reasoning" | "permission" | "question" | "error" | "done"
  at: number
}

export type Located<T> = T & { directory: string }

/** Normalized, event-sourced view of every agent the OpenCode server knows about. */
export interface FleetData {
  sessions: Record<string, Session>
  status: Record<string, SessionStatus>
  /** sessionID -> messages sorted by id (ids are time-ordered). */
  messages: Record<string, Message[]>
  /** messageID -> parts sorted by id. */
  parts: Record<string, Part[]>
  todos: Record<string, Todo[]>
  diffs: Record<string, FileDiff[]>
  permissions: Record<string, Located<PermissionRequest>>
  questions: Record<string, Located<QuestionRequest>>
  errors: Record<string, MessageError | undefined>
  activity: Record<string, Activity>
  /** Timestamp of the last busy -> idle transition. */
  finishedAt: Record<string, number>
}

export const emptyData = (): FleetData => ({
  sessions: {},
  status: {},
  messages: {},
  parts: {},
  todos: {},
  diffs: {},
  permissions: {},
  questions: {},
  errors: {},
  activity: {},
  finishedAt: {},
})

export function upsertSorted<T extends { id: string }>(list: readonly T[] | undefined, item: T): T[] {
  const arr = list ? [...list] : []
  // Fast path: append at the end (the common streaming case).
  const last = arr[arr.length - 1]
  if (!last || last.id < item.id) {
    arr.push(item)
    return arr
  }
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].id < item.id) lo = mid + 1
    else hi = mid
  }
  if (arr[lo]?.id === item.id) arr[lo] = item
  else arr.splice(lo, 0, item)
  return arr
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

export function describeTool(tool: string, input: Record<string, unknown> | undefined, title?: string): string {
  if (title) return `${tool}: ${title}`
  const i = input ?? {}
  const path = (i.filePath ?? i.path ?? i.pattern) as string | undefined
  if (tool === "bash" && typeof i.command === "string") return `$ ${i.command}`
  if (path) return `${tool} ${shortPath(path)}`
  if (tool === "task" && typeof i.description === "string") return `subagent: ${i.description}`
  if (tool === "todowrite") return "Updating plan"
  return tool
}

export function shortPath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p
}

function activityForPart(part: Part, now: number): Activity | undefined {
  switch (part.type) {
    case "tool": {
      const st = part.state
      if (st.status === "error") return { label: `${part.tool} failed`, kind: "error", at: now }
      const title = st.status === "running" || st.status === "completed" ? st.title : undefined
      return { label: describeTool(part.tool, st.input, title), kind: "tool", at: now }
    }
    case "text":
      return part.synthetic ? undefined : { label: "Writing response", kind: "text", at: now }
    case "reasoning":
      return { label: "Thinking", kind: "reasoning", at: now }
    case "subtask":
      return { label: `subagent: ${part.description}`, kind: "tool", at: now }
  }
  return undefined
}

/** Apply one OpenCode event. Returns the same object when nothing changed. */
export function applyEvent(data: FleetData, directory: string | undefined, event: OpencodeEvent, now = Date.now()): FleetData {
  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const info = event.properties.info
      return { ...data, sessions: { ...data.sessions, [info.id]: { ...data.sessions[info.id], ...info } } }
    }
    case "session.deleted": {
      const id = event.properties.info?.id ?? event.properties.sessionID
      return {
        ...data,
        sessions: omit(data.sessions, id),
        status: omit(data.status, id),
        messages: omit(data.messages, id),
        todos: omit(data.todos, id),
      }
    }
    case "session.status": {
      const { sessionID, status } = event.properties
      const prev = data.status[sessionID]
      const next: FleetData = { ...data, status: { ...data.status, [sessionID]: status } }
      if (status.type === "busy" && data.errors[sessionID]) next.errors = omit(data.errors, sessionID)
      if (status.type === "idle" && prev && prev.type !== "idle") {
        next.finishedAt = { ...data.finishedAt, [sessionID]: now }
        if (!data.errors[sessionID]) next.activity = { ...data.activity, [sessionID]: { label: "Finished", kind: "done", at: now } }
      }
      return next
    }
    case "session.idle": {
      const id = event.properties.sessionID
      if (data.status[id]?.type === "idle") return data
      return applyEvent(data, directory, { type: "session.status", properties: { sessionID: id, status: { type: "idle" } } }, now)
    }
    case "session.error": {
      const { sessionID, error } = event.properties
      if (!sessionID) return data
      // Aborts are user-initiated; not an error worth flagging.
      if (error?.name === "MessageAbortedError") return data
      return {
        ...data,
        errors: { ...data.errors, [sessionID]: error },
        activity: { ...data.activity, [sessionID]: { label: error?.data?.message ?? error?.name ?? "Error", kind: "error", at: now } },
      }
    }
    case "session.diff": {
      const { sessionID, diff } = event.properties
      if (!diff.length && !data.diffs[sessionID]) return data
      return { ...data, diffs: { ...data.diffs, [sessionID]: diff } }
    }
    case "message.updated": {
      const info = event.properties.info
      return { ...data, messages: { ...data.messages, [info.sessionID]: upsertSorted(data.messages[info.sessionID], info) } }
    }
    case "message.removed": {
      const { sessionID, messageID } = event.properties
      const list = data.messages[sessionID]
      if (!list) return data
      return { ...data, messages: { ...data.messages, [sessionID]: list.filter((m) => m.id !== messageID) }, parts: omit(data.parts, messageID) }
    }
    case "message.part.updated": {
      const part = event.properties.part
      const next: FleetData = { ...data, parts: { ...data.parts, [part.messageID]: upsertSorted(data.parts[part.messageID], part) } }
      const act = activityForPart(part, now)
      if (act && data.status[part.sessionID]?.type !== "idle") next.activity = { ...data.activity, [part.sessionID]: act }
      return next
    }
    case "message.part.removed": {
      const { messageID, partID } = event.properties
      const list = data.parts[messageID]
      if (!list) return data
      return { ...data, parts: { ...data.parts, [messageID]: list.filter((p) => p.id !== partID) } }
    }
    case "message.part.delta": {
      const { messageID, partID, field, delta } = event.properties
      const list = data.parts[messageID]
      const idx = list?.findIndex((p) => p.id === partID) ?? -1
      if (!list || idx < 0) return data
      const part = list[idx] as unknown as Record<string, unknown>
      const updated = { ...part, [field]: String(part[field] ?? "") + delta } as unknown as Part
      const arr = [...list]
      arr[idx] = updated
      return { ...data, parts: { ...data.parts, [messageID]: arr } }
    }
    case "todo.updated": {
      const { sessionID, todos } = event.properties
      return { ...data, todos: { ...data.todos, [sessionID]: todos } }
    }
    case "permission.asked": {
      const req = event.properties
      return {
        ...data,
        permissions: { ...data.permissions, [req.id]: { ...req, directory: directory ?? "" } },
        activity: { ...data.activity, [req.sessionID]: { label: `Needs approval: ${req.permission}`, kind: "permission", at: now } },
      }
    }
    case "permission.replied":
      return { ...data, permissions: omit(data.permissions, event.properties.requestID) }
    case "question.asked": {
      const req = event.properties
      return {
        ...data,
        questions: { ...data.questions, [req.id]: { ...req, directory: directory ?? "" } },
        activity: { ...data.activity, [req.sessionID]: { label: `Asking: ${req.questions[0]?.header ?? "question"}`, kind: "question", at: now } },
      }
    }
    case "question.replied":
    case "question.rejected":
      return { ...data, questions: omit(data.questions, event.properties.requestID) }
  }
  return data
}

export function applyEvents(data: FleetData, batch: { directory?: string; event: OpencodeEvent }[], now = Date.now()): FleetData {
  let d = data
  for (const { directory, event } of batch) d = applyEvent(d, directory, event, now)
  return d
}

/**
 * Merge fetched history for one session into live state. SSE events can land while the fetch is
 * in flight, so swapping the snapshot in would drop them; `prefer` picks the winner for records
 * present in both (live events normally, the snapshot after a reconnect).
 */
export function mergeSnapshot(data: FleetData, id: string, msgs: MessageWithParts[], todos: Todo[], prefer: "events" | "snapshot"): FleetData {
  const byId = new Map<string, Message>()
  const live = data.messages[id] ?? []
  const first = prefer === "events" ? msgs.map((m) => m.info) : live
  const second = prefer === "events" ? live : msgs.map((m) => m.info)
  for (const m of first) byId.set(m.id, m)
  for (const m of second) byId.set(m.id, m)
  const parts = { ...data.parts }
  for (const m of msgs) {
    const merged = new Map<string, Part>()
    const livePartList = data.parts[m.info.id] ?? []
    const [a, b] = prefer === "events" ? [m.parts, livePartList] : [livePartList, m.parts]
    for (const p of a) merged.set(p.id, p)
    for (const p of b) merged.set(p.id, p)
    parts[m.info.id] = [...merged.values()].sort((x, y) => (x.id < y.id ? -1 : 1))
  }
  const liveTodos = data.todos[id]
  return {
    ...data,
    messages: { ...data.messages, [id]: [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : 1)) },
    parts,
    todos: { ...data.todos, [id]: prefer === "events" && liveTodos ? liveTodos : todos },
  }
}
