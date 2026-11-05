/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `vite preview` serves dist/ the way Cloudflare will: with the headers in public/_headers. Without
 * this the browser tests would run with no Content-Security-Policy, and a library that injects a
 * style or script the policy forbids would pass every test and break in production.
 */
function headersFromFile(): Plugin {
  type Rule = { pattern: RegExp; set: Array<[string, string]>; unset: string[] };
  const rules: Rule[] = [];
  let cur: Rule | null = null;
  for (const raw of readFileSync(resolve(import.meta.dirname, "public/_headers"), "utf8").split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      const glob = raw.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      cur = { pattern: new RegExp(`^${glob}$`), set: [], unset: [] };
      rules.push(cur);
    } else if (cur) {
      const line = raw.trim();
      if (line.startsWith("!")) cur.unset.push(line.slice(1).trim().toLowerCase());
      else { const i = line.indexOf(":"); cur.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
    }
  }
  return {
    name: "headers-from-file",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "/").split("?")[0];
        const out = new Map<string, [string, string]>();
        // Cloudflare applies every matching rule in order; `! Name` removes what an earlier rule set
        for (const r of rules) {
          if (!r.pattern.test(path)) continue;
          for (const name of r.unset) out.delete(name);
          for (const [k, v] of r.set) out.set(k.toLowerCase(), [k, v]);
        }
        for (const [k, v] of out.values()) res.setHeader(k, v);
        next();
      });
    },
  };
}

// Two pages: the playground at / and the embed at /embed/.
export default defineConfig({
  plugins: [headersFromFile()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        play: resolve(import.meta.dirname, "index.html"),
        embed: resolve(import.meta.dirname, "embed/index.html"),
      },
    },
    // the PDF writer is one large chunk, loaded only when a PDF is asked for
    chunkSizeWarningLimit: 1200,
  },
  test: { include: ["test/**/*.test.ts"] },
});
