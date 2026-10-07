import { memo, useMemo, useState } from "react"
import type { FileDiff } from "../api/types"
import { DiffStat, Icon } from "./ui"

interface Line {
  kind: "add" | "del" | "ctx" | "hunk"
  text: string
  old?: number
  new?: number
}

const HEADER = /^(Index: |={5,}|--- |\+\+\+ |diff --git |index |new file mode|deleted file mode|similarity index|rename (from|to) |\\ No newline)/

export function parsePatch(patch: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (m) {
        o = Number(m[1])
        n = Number(m[2])
      }
      out.push({ kind: "hunk", text: raw })
      continue
    }
    if (HEADER.test(raw)) continue
    if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1), new: n++ })
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1), old: o++ })
    else if (raw.startsWith(" ")) out.push({ kind: "ctx", text: raw.slice(1), old: o++, new: n++ })
  }
  return out
}

const FileBlock = memo(function FileBlock({ diff, open: initial }: { diff: FileDiff; open: boolean }) {
  const [open, setOpen] = useState(initial)
  const lines = useMemo(() => (open && diff.patch ? parsePatch(diff.patch) : []), [open, diff.patch])
  return (
    <div className="diff-file">
      <button className="diff-file-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevron" size={14} className={open ? "rot90" : ""} />
        <span className={`diff-status diff-${diff.status ?? "modified"}`}>{(diff.status ?? "modified")[0].toUpperCase()}</span>
        <span className="diff-name">{diff.file}</span>
        <DiffStat additions={diff.additions} deletions={diff.deletions} />
      </button>
      {open &&
        (diff.patch ? (
          <div className="diff-body" role="table">
            {lines.map((l, i) => (
              <div key={i} className={`dl dl-${l.kind}`} role="row">
                <span className="ln">{l.kind === "hunk" ? "" : (l.old ?? "")}</span>
                <span className="ln">{l.kind === "hunk" ? "" : (l.new ?? "")}</span>
                <span className="lt">
                  {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                  {l.text}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted pad">No patch available.</div>
        ))}
    </div>
  )
})

export function DiffView({ diffs, empty = "No changes yet." }: { diffs: FileDiff[]; empty?: string }) {
  if (!diffs.length) return <div className="muted pad">{empty}</div>
  return (
    <div className="diff">
      {diffs.map((d, i) => (
        <FileBlock key={(d.file ?? "") + i} diff={d} open={diffs.length <= 4} />
      ))}
    </div>
  )
}
