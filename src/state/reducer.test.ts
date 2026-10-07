import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { GlobalEvent, OpencodeEvent } from "../api/types"
import { phaseOf, sessionChanges, todoProgress } from "./derive"
import { applyEvent, applyEvents, emptyData, mergeSnapshot, upsertSorted } from "./reducer"

// Recorded from a real `opencode serve` (1.18.35) driven by test/mock-llm: one agent that plans,
// writes a file, asks for bash permission, gets approved and finishes.
const events: { directory?: string; event: OpencodeEvent }[] = fs
  .readFileSync(path.resolve(__dirname, "../../test/fixtures/global-events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as GlobalEvent)
  .map((g) => ({ directory: g.directory, event: g.payload as OpencodeEvent }))

const SID = (events.find((e) => e.event.type === "session.created")!.event as { properties: { sessionID: string } }).properties.sessionID

describe("upsertSorted", () => {
  it("inserts in id order and replaces existing ids", () => {
    let l = upsertSorted([], { id: "b", v: 1 })
    l = upsertSorted(l, { id: "d", v: 1 })
    l = upsertSorted(l, { id: "a", v: 1 })
    l = upsertSorted(l, { id: "c", v: 1 })
    l = upsertSorted(l, { id: "b", v: 2 })
    expect(l.map((x) => x.id + x.v)).toEqual(["a1", "b2", "c1", "d1"])
  })
})

describe("applyEvents on a recorded opencode session", () => {
  const final = applyEvents(emptyData(), events)

  it("tracks the session and ends idle", () => {
    expect(final.sessions[SID]?.directory).toBe("/project")
    expect(final.status[SID]).toEqual({ type: "idle" })
    expect(final.finishedAt[SID]).toBeGreaterThan(0)
  })

  it("builds the transcript with tool parts", () => {
    const msgs = final.messages[SID]
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(1)
    const tools = msgs.flatMap((m) => final.parts[m.id] ?? []).filter((p) => p.type === "tool")
    expect(tools.map((t) => (t.type === "tool" ? t.tool : ""))).toEqual(["todowrite", "write", "bash", "todowrite"])
    expect(tools.every((t) => t.type === "tool" && t.state.status === "completed")).toBe(true)
  })

  it("streams text deltas into parts before the final part update", () => {
    const deltas = events.filter((e) => e.event.type === "message.part.delta")
    expect(deltas.length).toBeGreaterThan(10)
    const firstDelta = deltas[0].event as Extract<OpencodeEvent, { type: "message.part.delta" }>
    const partID = firstDelta.properties.partID
    // Replay until the last delta of that part, without the final message.part.updated.
    const lastIdx = events.findLastIndex((e) => e.event.type === "message.part.delta" && e.event.properties.partID === partID)
    const mid = applyEvents(emptyData(), events.slice(0, lastIdx + 1))
    const part = mid.parts[firstDelta.properties.messageID].find((p) => p.id === partID)
    const finalPart = final.parts[firstDelta.properties.messageID].find((p) => p.id === partID)
    expect(part?.type === "text" && part.text).toBe(finalPart?.type === "text" && finalPart.text)
  })

  it("raises and clears the permission request", () => {
    const askIdx = events.findIndex((e) => e.event.type === "permission.asked")
    const during = applyEvents(emptyData(), events.slice(0, askIdx + 1))
    const pending = Object.values(during.permissions)
    expect(pending).toHaveLength(1)
    expect(pending[0].permission).toBe("bash")
    expect(pending[0].directory).toBe("/project")
    expect(phaseOf(during, SID, undefined)).toBe("attention")
    expect(during.activity[SID].kind).toBe("permission")
    expect(Object.keys(final.permissions)).toHaveLength(0)
  })

  it("records todos and per-turn diffs", () => {
    expect(todoProgress(final.todos[SID])).toMatchObject({ done: 3, total: 3 })
    const changes = sessionChanges(final, SID)
    expect(changes.map((c) => c.file)).toEqual(["write-release-notes-and.md"])
    expect(changes[0].additions).toBe(6)
  })

  it("classifies phases from status and seen time", () => {
    expect(phaseOf(final, SID, undefined)).toBe("review")
    expect(phaseOf(final, SID, Date.now() + 1000)).toBe("done")
    const busy = applyEvent(final, "/project", { type: "session.status", properties: { sessionID: SID, status: { type: "busy" } } })
    expect(phaseOf(busy, SID, Date.now() + 1000)).toBe("running")
  })

  it("ignores user aborts but surfaces real errors", () => {
    const aborted = applyEvent(final, "/project", { type: "session.error", properties: { sessionID: SID, error: { name: "MessageAbortedError" } } })
    expect(aborted).toBe(final)
    const errored = applyEvent(final, "/project", {
      type: "session.error",
      properties: { sessionID: SID, error: { name: "APIError", data: { message: "rate limited" } } },
    })
    expect(phaseOf(errored, SID, Date.now() + 1000)).toBe("attention")
    expect(errored.activity[SID].label).toBe("rate limited")
    const resumed = applyEvent(errored, "/project", { type: "session.status", properties: { sessionID: SID, status: { type: "busy" } } })
    expect(resumed.errors[SID]).toBeUndefined()
  })

  it("returns the same object for unrelated events", () => {
    expect(applyEvent(final, undefined, { type: "server.heartbeat" })).toBe(final)
  })
})

describe("mergeSnapshot", () => {
  const userMsg = {
    id: "msg_1",
    sessionID: "ses_x",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "p", modelID: "m" },
  } as const
  const asstMsg = {
    id: "msg_2",
    sessionID: "ses_x",
    role: "assistant",
    parentID: "msg_1",
    time: { created: 2 },
    modelID: "m",
    providerID: "p",
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as const
  const text = (t: string) => ({ id: "prt_1", sessionID: "ses_x", messageID: "msg_2", type: "text" as const, text: t })

  it("keeps messages that streamed in while the snapshot was in flight", () => {
    // Live state already has the assistant reply; the (older) snapshot only has the user turn.
    let live = applyEvent(emptyData(), "/p", { type: "message.updated", properties: { sessionID: "ses_x", info: userMsg } })
    live = applyEvent(live, "/p", { type: "message.updated", properties: { sessionID: "ses_x", info: asstMsg } })
    live = applyEvent(live, "/p", { type: "message.part.updated", properties: { sessionID: "ses_x", part: text("Hello wor") } })
    const merged = mergeSnapshot(live, "ses_x", [{ info: userMsg, parts: [] }], [], "events")
    expect(merged.messages.ses_x.map((m) => m.id)).toEqual(["msg_1", "msg_2"])
    expect(merged.parts.msg_2[0]).toMatchObject({ text: "Hello wor" })
  })

  it("prefers live parts over stale snapshot parts, and snapshot after reconnects", () => {
    const live = applyEvent(emptyData(), "/p", { type: "message.part.updated", properties: { sessionID: "ses_x", part: text("Hello world") } })
    const snap = [{ info: asstMsg, parts: [text("Hello")] }]
    expect(mergeSnapshot(live, "ses_x", snap, [], "events").parts.msg_2[0]).toMatchObject({ text: "Hello world" })
    expect(mergeSnapshot(live, "ses_x", snap, [], "snapshot").parts.msg_2[0]).toMatchObject({ text: "Hello" })
  })
})
