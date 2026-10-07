import type {
  Agent,
  Command,
  FileDiff,
  MessageWithParts,
  PathInfo,
  PermissionRequest,
  Project,
  ProvidersResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
  Worktree,
} from "./types"

/**
 * Thin client for the OpenCode HTTP API. Every call that touches project state takes the
 * directory explicitly: OpenCode runs one instance per directory, and each git worktree an
 * agent runs in is its own directory.
 */
export const API_BASE = "/oc"

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const msg = (body as { data?: { message?: string } })?.data?.message ?? (body as { message?: string })?.message ?? `HTTP ${status}`
    super(msg)
  }
}

type Query = Record<string, string | number | boolean | undefined>

async function request<T>(method: string, path: string, opts: { directory?: string; query?: Query; body?: unknown } = {}): Promise<T> {
  const params = new URLSearchParams()
  if (opts.directory) params.set("directory", opts.directory)
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) params.set(k, String(v))
  const qs = params.toString()
  const res = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, {
    method,
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  const data = text ? safeJson(text) : undefined
  if (!res.ok) throw new ApiError(res.status, data ?? text)
  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface PromptInput {
  text: string
  agent?: string
  model?: ModelRef
}

export const api = {
  health: () => request<{ healthy: boolean; version: string }>("GET", "/global/health"),
  path: (directory?: string) => request<PathInfo>("GET", "/path", { directory }),
  project: (directory?: string) => request<Project>("GET", "/project/current", { directory }),
  vcs: (directory: string) => request<VcsInfo>("GET", "/vcs", { directory }),
  vcsDiff: (directory: string, mode: "git" | "branch") => request<FileDiff[]>("GET", "/vcs/diff", { directory, query: { mode } }),

  agents: (directory?: string) => request<Agent[]>("GET", "/agent", { directory }),
  providers: (directory?: string) => request<ProvidersResponse>("GET", "/config/providers", { directory }),
  commands: (directory?: string) => request<Command[]>("GET", "/command", { directory }),
  findFiles: (directory: string, query: string) => request<string[]>("GET", "/find/file", { directory, query: { query, limit: 20 } }),

  /** All sessions across every directory/worktree of every project. */
  allSessions: () => request<Session[]>("GET", "/experimental/session", { query: { limit: 500 } }),
  status: (directory: string) => request<Record<string, SessionStatus>>("GET", "/session/status", { directory }),
  createSession: (directory: string, body: { title?: string; agent?: string; parentID?: string; metadata?: Session["metadata"] }) =>
    request<Session>("POST", "/session", { directory, body }),
  updateSession: (s: Pick<Session, "id" | "directory">, body: { title?: string; metadata?: Session["metadata"]; time?: { archived?: number } }) =>
    request<Session>("PATCH", `/session/${s.id}`, { directory: s.directory, body }),
  deleteSession: (s: Pick<Session, "id" | "directory">) => request<boolean>("DELETE", `/session/${s.id}`, { directory: s.directory }),
  messages: (s: Pick<Session, "id" | "directory">) => request<MessageWithParts[]>("GET", `/session/${s.id}/message`, { directory: s.directory }),
  todos: (s: Pick<Session, "id" | "directory">) => request<Todo[]>("GET", `/session/${s.id}/todo`, { directory: s.directory }),
  prompt: (s: Pick<Session, "id" | "directory">, input: PromptInput) =>
    request<void>("POST", `/session/${s.id}/prompt_async`, {
      directory: s.directory,
      body: { agent: input.agent, model: input.model, parts: [{ type: "text", text: input.text }] },
    }),
  command: (s: Pick<Session, "id" | "directory">, command: string, args: string, agent?: string) =>
    request<unknown>("POST", `/session/${s.id}/command`, { directory: s.directory, body: { command, arguments: args, agent } }),
  shell: (s: Pick<Session, "id" | "directory">, command: string, agent: string) =>
    request<unknown>("POST", `/session/${s.id}/shell`, { directory: s.directory, body: { command, agent } }),
  abort: (s: Pick<Session, "id" | "directory">) => request<boolean>("POST", `/session/${s.id}/abort`, { directory: s.directory }),
  fork: (s: Pick<Session, "id" | "directory">, messageID?: string) =>
    request<Session>("POST", `/session/${s.id}/fork`, { directory: s.directory, body: messageID ? { messageID } : {} }),
  revert: (s: Pick<Session, "id" | "directory">, messageID: string) =>
    request<Session>("POST", `/session/${s.id}/revert`, { directory: s.directory, body: { messageID } }),
  unrevert: (s: Pick<Session, "id" | "directory">) => request<Session>("POST", `/session/${s.id}/unrevert`, { directory: s.directory }),
  turnDiff: (s: Pick<Session, "id" | "directory">, messageID: string) =>
    request<FileDiff[]>("GET", `/session/${s.id}/diff`, { directory: s.directory, query: { messageID } }),

  permissions: (directory: string) => request<PermissionRequest[]>("GET", "/permission", { directory }),
  replyPermission: (directory: string, id: string, reply: "once" | "always" | "reject", message?: string) =>
    request<boolean>("POST", `/permission/${id}/reply`, { directory, body: { reply, message } }),
  questions: (directory: string) => request<QuestionRequest[]>("GET", "/question", { directory }),
  replyQuestion: (directory: string, id: string, answers: string[][]) =>
    request<boolean>("POST", `/question/${id}/reply`, { directory, body: { answers } }),
  rejectQuestion: (directory: string, id: string) => request<boolean>("POST", `/question/${id}/reject`, { directory }),

  worktrees: (directory: string) => request<string[]>("GET", "/experimental/worktree", { directory }),
  createWorktree: (directory: string, name: string) => request<Worktree>("POST", "/experimental/worktree", { directory, body: { name } }),
  removeWorktree: (directory: string, worktree: string) =>
    request<boolean>("DELETE", "/experimental/worktree", { directory, body: { directory: worktree } }),
}

export function eventSourceUrl() {
  return `${API_BASE}/global/event`
}
