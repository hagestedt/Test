#!/usr/bin/env node
// Boots the full e2e stack: disposable git repo + mock LLM + real `opencode serve` (via harness.mjs)
// and the Fleet server in front of it. Used as Playwright's webServer.
import { spawn } from "node:child_process"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const ocPort = Number(process.env.E2E_OPENCODE_PORT ?? 4796)
const mockPort = Number(process.env.E2E_MOCK_PORT ?? 4556)
const fleetPort = Number(process.env.E2E_FLEET_PORT ?? 4797)

const children = []
const stop = () => children.forEach((c) => c.kill("SIGTERM"))
process.on("SIGINT", () => (stop(), process.exit(0)))
process.on("SIGTERM", () => (stop(), process.exit(0)))
process.on("exit", stop)

const harness = spawn(process.execPath, [path.join(here, "harness.mjs"), "--port", String(ocPort), "--mock-port", String(mockPort)], {
  stdio: ["ignore", "pipe", "inherit"],
})
children.push(harness)
harness.on("exit", (c) => process.exit(c ?? 1))

const deadline = setTimeout(() => {
  console.error("e2e-server: harness did not report ready within 120s")
  process.exit(1)
}, 120_000)

for await (const line of readline.createInterface({ input: harness.stdout })) {
  if (!line.startsWith("{")) continue
  const { url } = JSON.parse(line)
  const fleet = spawn(process.execPath, [path.join(here, "../server/fleet.mjs"), "--opencode", url, "--port", String(fleetPort)], {
    stdio: "inherit",
  })
  children.push(fleet)
  fleet.on("exit", (c) => process.exit(c ?? 1))
  clearTimeout(deadline)
  break
}
