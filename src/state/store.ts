import { create } from "zustand"
import { api, eventSourceUrl, type ModelRef } from "../api/client"
import type { Agent, Command, FleetMeta, GlobalEvent, OpencodeEvent, Project, ProvidersResponse, Session, SessionStatus, VcsInfo } from "../api/types"
import { applyEvent, applyEvents, emptyData, mergeSnapshot, type FleetData } from "./reducer"

export type View = "board" | "agent" | "tiles" | "inbox"
export type Isolation = "worktree" | "shared"

export interface LaunchOptions {
  prompt: string
  agent: string
  models: ModelRef[]
  attempts: number
  isolation: Isolation
}

export interface Toast {
  id: number
  text: string
  kind: "info" | "error" | "success"
  action?: { label: string; run: () => void }
}

interface Prefs {
  seenAt: Record<string, number>
  tiles: string[]
  lastLaunch?: Omit<LaunchOptions, "prompt">
  notify: boolean
}

const PREFS_KEY = "opencode-fleet:prefs"

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { seenAt: {}, tiles: [], notify: true, ...JSON.parse(raw) }
  } catch {}
  return { seenAt: {}, tiles: [], notify: true }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {}
}

export interface FleetStore {
  conn: "connecting" | "online" | "offline"
  error?: string
  root?: { directory: string; project: Project; vcs?: VcsInfo; version?: string }
  agents: Agent[]
  providers?: ProvidersResponse
  commands: Command[]
  data: FleetData
  loaded: Record<string, boolean>

  view: View
  selected?: string
  /** Multi-select used for tiles, compare and broadcast. */
  picked: string[]
  launcherOpen: boolean
  paletteOpen: boolean
  filter: string
  showArchived: boolean
  prefs: Prefs
  toasts: Toast[]

  init(): Promise<void>
  refresh(): Promise<void>
  /**
   * Fetch an agent's history. Live SSE data may land while the request is in flight, so the
   * snapshot is merged rather than swapped in; `prefer` decides who wins for records both have.
   */
  ensureLoaded(id: string, force?: boolean, prefer?: "events" | "snapshot"): Promise<void>

  setView(v: View): void
  open(id: string): void
  togglePick(id: string): void
  setPicked(ids: string[]): void
  markSeen(id: string): void
  setLauncher(open: boolean): void
  setPalette(open: boolean): void
  setFilter(f: string): void
  setShowArchived(v: boolean): void
  setNotify(v: boolean): void
  toast(text: string, kind?: Toast["kind"], action?: Toast["action"]): void
  dismissToast(id: number): void

  launch(opts: LaunchOptions): Promise<Session[]>
  send(id: string, text: string, opts?: { agent?: string; model?: ModelRef }): Promise<void>
  broadcast(ids: string[], text: string): Promise<void>
  abort(id: string): Promise<void>
  fork(id: string, messageID?: string): Promise<Session | undefined>
  rename(id: string, title: string): Promise<void>
  archive(id: string, archived?: boolean): Promise<void>
  remove(id: string, opts?: { removeWorktree?: boolean }): Promise<void>
  /** Best-of-N: keep one attempt, archive its siblings, and surface how to merge it. */
  keepWinner(id: string): Promise<void>
  revert(id: string, messageID: string): Promise<void>
  unrevert(id: string): Promise<void>
  replyPermission(id: string, reply: "once" | "always" | "reject"): Promise<void>
  replyQuestion(id: string, answers: string[][]): Promise<void>
  rejectQuestion(id: string): Promise<void>
}

let toastSeq = 0
let es: EventSource | undefined
let queue: { directory?: string; event: OpencodeEvent }[] = []
let scheduled = false
let everConnected = false

export const useFleet = create<FleetStore>((set, get) => {
  const fail = (e: unknown, what: string) => {
    const msg = e instanceof Error ? e.message : String(e)
    get().toast(`${what}: ${msg}`, "error")
  }

  const flush = () => {
    scheduled = false
    const batch = queue
    queue = []
    if (!batch.length) return
    const before = get().data
    const after = applyEvents(before, batch)
    if (after !== before) set({ data: after })
    notifyTransitions(batch, before, after)
  }

  const notifyTransitions = (batch: typeof queue, before: FleetData, after: FleetData) => {
    const { prefs, selected, view } = get()
    for (const { event } of batch) {
      let sid: string | undefined
      let body = ""
      if (event.type === "permission.asked") {
        sid = event.properties.sessionID
        body = `Needs approval: ${event.properties.permission} ${event.properties.patterns.join(" ")}`
      } else if (event.type === "question.asked") {
        sid = event.properties.sessionID
        body = event.properties.questions[0]?.question ?? "Has a question"
      } else if (event.type === "session.status" && event.properties.status.type === "idle") {
        sid = event.properties.sessionID
        if (!before.status[sid] || before.status[sid].type === "idle") continue
        body = after.errors[sid] ? "Stopped with an error" : "Finished"
      }
      if (!sid) continue
      const s = after.sessions[sid]
      if (!s || s.parentID) continue
      const focused = document.visibilityState === "visible" && view === "agent" && selected === sid
      if (focused) continue
      if (prefs.notify && document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification(s.title || "Agent", { body, tag: sid })
        n.onclick = () => {
          window.focus()
          get().open(sid!)
        }
      }
    }
  }

  const connect = () => {
    es?.close()
    set({ conn: "connecting" })
    es = new EventSource(eventSourceUrl())
    es.onmessage = (msg) => {
      let ev: GlobalEvent
      try {
        ev = JSON.parse(msg.data)
      } catch {
        return
      }
      const payload = ev.payload as OpencodeEvent
      if (!payload?.type) return
      if (payload.type === "server.connected") {
        set({ conn: "online", error: undefined })
        if (everConnected) void get().refresh()
        everConnected = true
        return
      }
      queue.push({ directory: ev.directory, event: payload })
      if (!scheduled) {
        scheduled = true
        requestAnimationFrame(flush)
        // rAF is paused in background tabs; make sure events still land.
        setTimeout(() => scheduled && flush(), 250)
      }
    }
    es.onopen = () => set({ conn: "online", error: undefined })
    es.onerror = () => set({ conn: es?.readyState === EventSource.CLOSED ? "offline" : "connecting" })
  }

  const sessionOf = (id: string) => {
    const s = get().data.sessions[id]
    if (!s) throw new Error(`Unknown session ${id}`)
    return s
  }

  const putSession = (s: Session) =>
    set((st) => ({ data: applyEvent(st.data, s.directory, { type: "session.updated", properties: { sessionID: s.id, info: s } }) }))

  const updatePrefs = (fn: (p: Prefs) => Prefs) => {
    const prefs = fn(get().prefs)
    savePrefs(prefs)
    set({ prefs })
  }

  return {
    conn: "connecting",
    agents: [],
    commands: [],
    data: emptyData(),
    loaded: {},
    view: "board",
    picked: loadPrefs().tiles,
    launcherOpen: false,
    paletteOpen: false,
    filter: "",
    showArchived: false,
    prefs: loadPrefs(),
    toasts: [],

    async init() {
      try {
        const [path, health] = await Promise.all([api.path(), api.health().catch(() => undefined)])
        const [project, vcs, agents, providers, commands] = await Promise.all([
          api.project(path.directory),
          api.vcs(path.directory).catch(() => undefined),
          api.agents(path.directory).catch(() => []),
          api.providers(path.directory).catch(() => undefined),
          api.commands(path.directory).catch(() => []),
        ])
        set({ root: { directory: path.directory, project, vcs, version: health?.version }, agents, providers, commands })
        connect()
        await get().refresh()
      } catch (e) {
        set({ conn: "offline", error: e instanceof Error ? e.message : String(e) })
      }
    },

    async refresh() {
      const root = get().root
      if (!root) return
      const all = await api.allSessions().catch(() => [] as Session[])
      const mine = all.filter((s) => s.projectID === root.project.id || s.project?.id === root.project.id)
      const dirs = new Set([root.directory, ...mine.map((s) => s.directory)])
      const perDir = await Promise.all(
        [...dirs].map(async (dir) => {
          const [status, permissions, questions] = await Promise.all([
            api.status(dir).catch(() => ({}) as Record<string, SessionStatus>),
            api.permissions(dir).catch(() => []),
            api.questions(dir).catch(() => []),
          ])
          return { dir, status, permissions, questions }
        }),
      )
      set((st) => {
        const data: FleetData = { ...st.data, sessions: {}, permissions: {}, questions: {}, status: { ...st.data.status } }
        for (const s of mine) data.sessions[s.id] = { ...st.data.sessions[s.id], ...s }
        for (const { dir, status, permissions, questions } of perDir) {
          for (const s of mine) if (s.directory === dir && !status[s.id]) data.status[s.id] = { type: "idle" }
          Object.assign(data.status, status)
          for (const p of permissions) data.permissions[p.id] = { ...p, directory: dir }
          for (const q of questions) data.questions[q.id] = { ...q, directory: dir }
        }
        return { data }
      })
      // Board cards show todos + diff stats, so prefetch them for active roots.
      const roots = mine.filter((s) => !s.parentID && !s.time.archived).sort((a, b) => b.time.updated - a.time.updated)
      // After a (re)connect we may have missed events, so the server snapshot is authoritative.
      await Promise.all(roots.slice(0, 40).map((s) => get().ensureLoaded(s.id, true, "snapshot")))
    },

    async ensureLoaded(id, force, prefer = "events") {
      if (get().loaded[id] && !force) return
      const s = get().data.sessions[id]
      if (!s) return
      set((st) => ({ loaded: { ...st.loaded, [id]: true } }))
      try {
        const [msgs, todos] = await Promise.all([api.messages(s), api.todos(s).catch(() => [])])
        set((st) => ({ data: mergeSnapshot(st.data, id, msgs, todos, prefer) }))
      } catch (e) {
        set((st) => ({ loaded: { ...st.loaded, [id]: false } }))
        fail(e, "Loading agent")
      }
    },

    setView: (view) => set({ view }),
    open(id) {
      set({ selected: id, view: "agent" })
      get().markSeen(id)
      void get().ensureLoaded(id)
    },
    togglePick(id) {
      const picked = get().picked.includes(id) ? get().picked.filter((x) => x !== id) : [...get().picked, id]
      get().setPicked(picked)
    },
    setPicked(ids) {
      set({ picked: ids })
      updatePrefs((p) => ({ ...p, tiles: ids }))
      ids.forEach((id) => void get().ensureLoaded(id))
    },
    markSeen: (id) => updatePrefs((p) => ({ ...p, seenAt: { ...p.seenAt, [id]: Date.now() } })),
    setLauncher: (launcherOpen) => set({ launcherOpen }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setFilter: (filter) => set({ filter }),
    setShowArchived: (showArchived) => set({ showArchived }),
    setNotify(v) {
      updatePrefs((p) => ({ ...p, notify: v }))
      if (v && "Notification" in window && Notification.permission === "default") void Notification.requestPermission()
    },
    toast(text, kind = "info", action) {
      const id = ++toastSeq
      set((st) => ({ toasts: [...st.toasts, { id, text, kind, action }] }))
      setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4500)
    },
    dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

    async launch(opts) {
      const root = get().root
      if (!root) throw new Error("Not connected")
      updatePrefs((p) => ({ ...p, lastLaunch: { agent: opts.agent, models: opts.models, attempts: opts.attempts, isolation: opts.isolation } }))
      const group = Math.random().toString(36).slice(2, 8)
      const groupTitle = opts.prompt.replace(/\s+/g, " ").trim().slice(0, 80)
      const slug =
        groupTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .split("-")
          .filter(Boolean)
          .slice(0, 3)
          .join("-") || "task"
      const runs = opts.models.flatMap((model) => Array.from({ length: Math.max(1, opts.attempts) }, () => model))
      const total = runs.length
      const results = await Promise.allSettled(
        runs.map(async (model, i) => {
          let directory = root.directory
          let worktree: FleetMeta["worktree"]
          if (opts.isolation === "worktree") {
            const wt = await api.createWorktree(root.directory, `${slug}-${group}-${i + 1}`)
            directory = wt.directory
            worktree = { name: wt.name, branch: wt.branch, directory: wt.directory }
          }
          const fleet: FleetMeta = { group: total > 1 ? group : undefined, groupTitle, attempt: i + 1, attempts: total, worktree }
          const session = await api.createSession(directory, { agent: opts.agent, metadata: { fleet } })
          putSession(session)
          await api.prompt(session, { text: opts.prompt, agent: opts.agent, model })
          return session
        }),
      )
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
      const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
      if (bad.length) fail(bad[0].reason, `${bad.length} of ${total} agents failed to launch`)
      if (ok.length) get().toast(`Launched ${ok.length} agent${ok.length > 1 ? "s" : ""}`, "success")
      ok.forEach((s) => set((st) => ({ loaded: { ...st.loaded, [s.id]: true } })))
      return ok
    },

    async send(id, text, opts) {
      try {
        await api.prompt(sessionOf(id), { text, ...opts })
      } catch (e) {
        fail(e, "Sending message")
        throw e
      }
    },
    async broadcast(ids, text) {
      const res = await Promise.allSettled(ids.map((id) => api.prompt(sessionOf(id), { text })))
      const failed = res.filter((r) => r.status === "rejected").length
      get().toast(failed ? `Sent to ${ids.length - failed}/${ids.length} agents` : `Sent to ${ids.length} agents`, failed ? "error" : "success")
    },
    async abort(id) {
      await api.abort(sessionOf(id)).catch((e) => fail(e, "Stopping agent"))
    },
    async fork(id, messageID) {
      try {
        const s = await api.fork(sessionOf(id), messageID)
        putSession(s)
        get().toast("Forked into a new agent", "success", { label: "Open", run: () => get().open(s.id) })
        return s
      } catch (e) {
        fail(e, "Forking")
      }
    },
    async rename(id, title) {
      try {
        putSession(await api.updateSession(sessionOf(id), { title }))
      } catch (e) {
        fail(e, "Renaming")
      }
    },
    async archive(id, archived = true) {
      try {
        putSession(await api.updateSession(sessionOf(id), { time: { archived: archived ? Date.now() : 0 } }))
        if (archived) get().toast("Archived", "info", { label: "Undo", run: () => void get().archive(id, false) })
      } catch (e) {
        fail(e, "Archiving")
      }
    },
    async remove(id, opts) {
      const s = sessionOf(id)
      try {
        await api.deleteSession(s)
        const wt = s.metadata?.fleet?.worktree
        if (opts?.removeWorktree && wt && get().root) await api.removeWorktree(get().root!.directory, wt.directory)
        set((st) => ({
          data: applyEvent(st.data, s.directory, { type: "session.deleted", properties: { sessionID: id, info: s } }),
          picked: st.picked.filter((x) => x !== id),
          selected: st.selected === id ? undefined : st.selected,
          view: st.selected === id && st.view === "agent" ? "board" : st.view,
        }))
      } catch (e) {
        fail(e, "Deleting")
      }
    },
    async keepWinner(id) {
      const winner = sessionOf(id)
      const group = winner.metadata?.fleet?.group
      if (!group) return
      const losers = Object.values(get().data.sessions).filter((s) => s.id !== id && s.metadata?.fleet?.group === group && !s.time.archived)
      await Promise.allSettled(losers.map((s) => api.updateSession(s, { time: { archived: Date.now() } }).then(putSession)))
      set((st) => ({ picked: st.picked.filter((x) => !losers.some((l) => l.id === x)) }))
      const branch = winner.metadata?.fleet?.worktree?.branch
      get().toast(
        `Kept attempt #${winner.metadata?.fleet?.attempt}; archived ${losers.length} other${losers.length === 1 ? "" : "s"}`,
        "success",
        branch ? { label: `Copy git merge ${branch}`, run: () => void navigator.clipboard?.writeText(`git merge ${branch}`) } : undefined,
      )
    },
    async revert(id, messageID) {
      try {
        putSession(await api.revert(sessionOf(id), messageID))
      } catch (e) {
        fail(e, "Reverting")
      }
    },
    async unrevert(id) {
      try {
        putSession(await api.unrevert(sessionOf(id)))
      } catch (e) {
        fail(e, "Restoring")
      }
    },
    async replyPermission(id, reply) {
      const p = get().data.permissions[id]
      if (!p) return
      try {
        await api.replyPermission(p.directory, id, reply)
        set((st) => ({
          data: applyEvent(st.data, p.directory, { type: "permission.replied", properties: { sessionID: p.sessionID, requestID: id, reply } }),
        }))
      } catch (e) {
        fail(e, "Replying to permission")
      }
    },
    async replyQuestion(id, answers) {
      const q = get().data.questions[id]
      if (!q) return
      try {
        await api.replyQuestion(q.directory, id, answers)
        set((st) => ({ data: applyEvent(st.data, q.directory, { type: "question.replied", properties: { sessionID: q.sessionID, requestID: id } }) }))
      } catch (e) {
        fail(e, "Answering")
      }
    },
    async rejectQuestion(id) {
      const q = get().data.questions[id]
      if (!q) return
      try {
        await api.rejectQuestion(q.directory, id)
        set((st) => ({
          data: applyEvent(st.data, q.directory, { type: "question.rejected", properties: { sessionID: q.sessionID, requestID: id } }),
        }))
      } catch (e) {
        fail(e, "Dismissing question")
      }
    },
  }
})
