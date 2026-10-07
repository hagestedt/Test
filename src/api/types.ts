// Subset of the OpenCode server schema (v1 HTTP API, opencode >= 1.18) used by Fleet.
// Source of truth: GET /doc on a running `opencode serve`.

export interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
  total?: number
}

export interface FileDiff {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

/** Fleet bookkeeping stored in Session.metadata.fleet so it survives reloads. */
export interface FleetMeta {
  group?: string
  groupTitle?: string
  attempt?: number
  attempts?: number
  worktree?: { name: string; branch?: string; directory: string }
  pinned?: boolean
}

export interface Session {
  id: string
  slug?: string
  projectID?: string
  directory: string
  parentID?: string
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  summary?: { additions: number; deletions: number; files: number; diffs?: FileDiff[] }
  cost?: number
  tokens?: Tokens
  share?: { url: string }
  metadata?: { fleet?: FleetMeta; [k: string]: unknown }
  time: { created: number; updated: number; compacting?: number; archived?: number }
  revert?: { messageID: string; partID?: string }
  project?: { id: string; name?: string; worktree: string }
}

export type SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; attempt: number; message: string; next: number }

export interface MessageError {
  name: string
  data?: { message?: string; [k: string]: unknown }
}

export interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
  summary?: { title?: string; body?: string; diffs: FileDiff[] }
}

export interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  parentID: string
  time: { created: number; completed?: number }
  modelID: string
  providerID: string
  agent: string
  mode?: string
  cost: number
  tokens: Tokens
  error?: MessageError
  finish?: string
}

export type Message = UserMessage | AssistantMessage

interface PartBase {
  id: string
  sessionID: string
  messageID: string
}

export type ToolState =
  | { status: "pending"; input?: Record<string, unknown>; raw?: string }
  | { status: "running"; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number }
    }
  | { status: "error"; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } }

export type Part =
  | (PartBase & { type: "text"; text: string; synthetic?: boolean; ignored?: boolean; time?: { start: number; end?: number } })
  | (PartBase & { type: "reasoning"; text: string; time: { start: number; end?: number } })
  | (PartBase & { type: "tool"; callID: string; tool: string; state: ToolState })
  | (PartBase & { type: "file"; mime: string; filename?: string; url: string })
  | (PartBase & { type: "step-start"; snapshot?: string })
  | (PartBase & { type: "step-finish"; reason: string; cost: number; tokens: Tokens })
  | (PartBase & { type: "patch"; hash: string; files: string[] })
  | (PartBase & { type: "subtask"; prompt: string; description: string; agent: string })
  | (PartBase & { type: "agent"; name: string })
  | (PartBase & { type: "snapshot"; snapshot: string })
  | (PartBase & { type: "retry"; attempt: number; error: MessageError })
  | (PartBase & { type: "compaction"; auto: boolean })

export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export interface Todo {
  id?: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled" | string
  priority: "high" | "medium" | "low" | string
}

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: { messageID: string; callID: string }
}

export interface Agent {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
  model?: { modelID: string; providerID: string }
}

export interface Model {
  id: string
  providerID: string
  name: string
  capabilities?: { reasoning?: boolean; toolcall?: boolean; attachment?: boolean }
  cost?: { input: number; output: number }
  limit?: { context: number; output: number }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, Model>
}

export interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

export interface Worktree {
  name: string
  branch?: string
  directory: string
}

export interface Command {
  name: string
  description?: string
  agent?: string
  template: string
  subtask?: boolean
  source?: string
}

export interface PathInfo {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export interface Project {
  id: string
  worktree: string
  name?: string
  vcs?: string
  sandboxes: string[]
}

export interface VcsInfo {
  branch?: string
  default_branch?: string
}

/** Events as delivered by GET /event (`payload`) and GET /global/event (`{directory, payload}`). */
export type OpencodeEvent =
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties?: unknown }
  | { type: "session.created" | "session.updated" | "session.deleted"; properties: { sessionID: string; info: Session } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatus } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "session.error"; properties: { sessionID?: string; error?: MessageError } }
  | { type: "session.diff"; properties: { sessionID: string; diff: FileDiff[] } }
  | { type: "message.updated"; properties: { sessionID: string; info: Message } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { sessionID: string; part: Part; time?: number } }
  | { type: "message.part.removed"; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: "message.part.delta"; properties: { sessionID: string; messageID: string; partID: string; field: string; delta: string } }
  | { type: "todo.updated"; properties: { sessionID: string; todos: Todo[] } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string; reply: string } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied" | "question.rejected"; properties: { sessionID: string; requestID: string } }
  | { type: "vcs.branch.updated"; properties: { branch?: string } }
  | { type: "worktree.ready" | "worktree.failed"; properties: { name: string; branch?: string; message?: string } }
  | { type: "file.edited"; properties: { file: string } }

export interface GlobalEvent {
  directory?: string
  project?: string
  payload: OpencodeEvent | { type: string; properties?: unknown }
}
