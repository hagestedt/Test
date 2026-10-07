import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// In dev, /oc/* is proxied to an OpenCode server (default http://127.0.0.1:4096).
const target = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4700,
    proxy: {
      "/oc": {
        target,
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/oc/, ""),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
} as never)
