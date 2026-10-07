import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { Session } from "../api/types"
import { phaseOf, type Phase } from "../state/derive"
import { useFleet } from "../state/store"

const ICONS = {
  plus: "M12 5v14M5 12h14",
  board: "M4 4h6v16H4zM14 4h6v10h-6z",
  tiles: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  inbox: "M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h4.5l1 2h5l1-2H20",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  stop: "M7 7h10v10H7z",
  send: "M5 12h14M13 6l6 6-6 6",
  fork: "M7 4v6a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v2M7 4a2 2 0 1 0 0 .01M17 20a2 2 0 1 0 0 .01M7 20V10",
  archive: "M4 7h16v3H4zM6 10v9h12v-9M10 14h4",
  trash: "M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-.01M6 21a3 3 0 1 0 0-.01M18 9a9 9 0 0 1-9 9",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6z",
  terminal: "M4 6l6 6-6 6M12 18h8",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  copy: "M8 8h12v12H8zM4 16V4h12",
  broadcast: "M12 12a1 1 0 1 0 0-.01M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8",
  ship: "M3 17l2 3h14l2-3M5 17V9l7-4 7 4v8M12 5v12",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  compare: "M8 4v16M16 4v16M4 8h4M16 16h4",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

export const PHASE_LABEL: Record<Phase, string> = {
  attention: "Needs you",
  running: "Running",
  review: "Ready for review",
  done: "Reviewed",
}

export function StatusDot({ phase, title }: { phase: Phase; title?: string }) {
  return <span className={`dot dot-${phase}`} title={title ?? PHASE_LABEL[phase]} aria-label={PHASE_LABEL[phase]} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Button({
  children,
  icon,
  variant = "ghost",
  size = "md",
  className = "",
  ...rest
}: {
  children?: ReactNode
  icon?: IconName
  variant?: "primary" | "ghost" | "danger" | "subtle"
  size?: "sm" | "md"
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  )
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

export function usePhase(id: string): Phase {
  return useFleet((s) => phaseOf(s.data, id, s.prefs.seenAt[id]))
}

/** Top-level agents (not subagents) for the connected project, newest first. */
export function useRootSessions(): Session[] {
  const sessions = useFleet((s) => s.data.sessions)
  const showArchived = useFleet((s) => s.showArchived)
  const filter = useFleet((s) => s.filter)
  const projectID = useFleet((s) => s.root?.project.id)
  return useMemo(() => {
    const f = filter.trim().toLowerCase()
    return Object.values(sessions)
      .filter((s) => !s.parentID && (!projectID || s.projectID === projectID))
      .filter((s) => showArchived || !s.time.archived)
      .filter((s) => !f || s.title.toLowerCase().includes(f) || s.metadata?.fleet?.worktree?.branch?.toLowerCase().includes(f))
      .sort((a, b) => b.time.created - a.time.created)
  }, [sessions, showArchived, filter, projectID])
}

export function agentColor(name: string | undefined): string {
  switch (name) {
    case "build":
      return "var(--c-build)"
    case "plan":
      return "var(--c-plan)"
    default:
      return "var(--c-other)"
  }
}

export function AgentBadge({ name }: { name?: string }) {
  if (!name) return null
  return (
    <span className="badge agent-badge" style={{ "--badge": agentColor(name) } as React.CSSProperties}>
      {name}
    </span>
  )
}

export function ModelBadge({ model }: { model?: string }) {
  if (!model) return null
  const short = model.split("/").pop()
  return (
    <span className="badge" title={model}>
      {short}
    </span>
  )
}

export function BranchBadge({ session }: { session: Session }) {
  const wt = session.metadata?.fleet?.worktree
  if (!wt) return null
  return (
    <span className="badge branch-badge" title={wt.directory}>
      <Icon name="branch" size={12} />
      {wt.branch ?? wt.name}
    </span>
  )
}

export function DiffStat({ additions, deletions, files }: { additions: number; deletions: number; files?: number }) {
  if (!additions && !deletions && !files) return null
  return (
    <span className="diffstat">
      {files !== undefined && (
        <span className="muted">
          {files} file{files === 1 ? "" : "s"}
        </span>
      )}
      <span className="add">+{additions}</span>
      <span className="del">−{deletions}</span>
    </span>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return null
  return (
    <span className="progress" title={`${done}/${total} steps`}>
      <span className="progress-bar">
        <span style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span className="muted">
        {done}/{total}
      </span>
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  )
}

export function copy(text: string) {
  void navigator.clipboard?.writeText(text)
  useFleet.getState().toast("Copied to clipboard", "success")
}
