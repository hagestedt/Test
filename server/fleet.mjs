#!/usr/bin/env node
// opencode-fleet: serves the Fleet UI and reverse-proxies /oc/* to an OpenCode server.
//
//   opencode-fleet                         # spawn `opencode serve` in the current directory
//   opencode-fleet --dir ~/code/app        # ...in another project
//   opencode-fleet --opencode http://127.0.0.1:4096   # attach to a running server
//
// Options: --port 4700 --host 127.0.0.1 --opencode-bin /path/to/opencode
// Env: OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME are forwarded as basic auth.
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(here, "../dist")

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) continue
    const [k, inline] = a.slice(2).split("=", 2)
    if (inline !== undefined) out[k] = inline
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i]
    else out[k] = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  console.log(
    fs
      .readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 10)
      .join("\n")
      .replace(/^\/\/ ?/gm, ""),
  )
  process.exit(0)
}
const port = Number(args.port ?? process.env.FLEET_PORT ?? 4700)
const host = String(args.host ?? process.env.FLEET_HOST ?? "127.0.0.1")
const dir = path.resolve(String(args.dir ?? process.cwd()))

let child
const shutdown = () => {
  child?.kill("SIGTERM")
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

function findOpencode() {
  if (args["opencode-bin"]) return String(args["opencode-bin"])
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN
  const local = path.resolve(here, "../node_modules/.bin/opencode")
  return fs.existsSync(local) ? local : "opencode"
}

async function startOpencode() {
  const bin = findOpencode()
  console.log(`starting ${bin} serve in ${dir}`)
  child = spawn(bin, ["serve", "--port", "0", "--hostname", "127.0.0.1"], { cwd: dir, stdio: ["ignore", "pipe", "inherit"] })
  child.on("exit", (code) => {
    console.error(`opencode exited (${code})`)
    process.exit(code ?? 1)
  })
  return new Promise((resolve, reject) => {
    let buf = ""
    const timer = setTimeout(() => reject(new Error("timed out waiting for opencode serve")), 60_000)
    child.stdout.on("data", (d) => {
      buf += d.toString()
      const m = buf.match(/listening on (https?:\/\/\S+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1].replace(/\/$/, ""))
      }
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(new Error(`could not start opencode (${e.message}). Install it (npm i -g opencode-ai) or pass --opencode <url>.`))
    })
  })
}

const upstream = new URL(args.opencode ? String(args.opencode) : await startOpencode())
const authHeader = process.env.OPENCODE_SERVER_PASSWORD
  ? "Basic " + Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")
  : undefined

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
}

function proxy(req, res) {
  const target = new URL(req.url.replace(/^\/oc/, "") || "/", upstream)
  const headers = { ...req.headers, host: target.host }
  delete headers.origin
  delete headers.referer
  if (authHeader) headers.authorization = authHeader
  const up = http.request(target, { method: req.method, headers }, (ur) => {
    const h = { ...ur.headers }
    if (String(h["content-type"] ?? "").includes("text/event-stream")) {
      h["cache-control"] = "no-cache"
      h["x-accel-buffering"] = "no"
      res.socket?.setNoDelay(true)
    }
    res.writeHead(ur.statusCode ?? 502, h)
    ur.pipe(res)
  })
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" })
    res.end(JSON.stringify({ name: "BadGateway", data: { message: `OpenCode server unreachable: ${e.message}` } }))
  })
  // Tear down upstream (notably long-lived SSE) when the browser goes away.
  res.on("close", () => up.destroy())
  req.pipe(up)
}

function serveStatic(req, res) {
  let file
  try {
    file = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname))
  } catch {
    return res.writeHead(400).end()
  }
  if (file !== dist && !file.startsWith(dist + path.sep)) return res.writeHead(403).end()
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html")
  if (!fs.existsSync(file)) {
    res.writeHead(500, { "content-type": "text/plain" })
    return res.end("Fleet UI is not built. Run `npm run build` first.")
  }
  const ext = path.extname(file)
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  })
  fs.createReadStream(file).pipe(res)
}

http
  .createServer((req, res) => (req.url?.startsWith("/oc/") || req.url === "/oc" ? proxy(req, res) : serveStatic(req, res)))
  .listen(port, host, () => {
    console.log(`OpenCode Fleet → http://${host}:${port}  (opencode: ${upstream.origin})`)
  })
