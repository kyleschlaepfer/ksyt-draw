// A second local origin for the e2e host-page tests (http://localhost:4174), separate from the
// embed's origin, so the iframe is really cross-origin. Chrome refuses an intercepted "public" page
// that frames a loopback server, so this has to be a real server.
//
//   /host?f=<JSON [{id, src, title}]>   a lesson-like page with the real site/draw-host.ts inlined
//   /bare?src=<url>                     a plain page with one iframe and no host script
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const hostTs = readFileSync(join(here, "..", "..", "site", "draw-host.ts"), "utf8");
const hostJs = ts.transpileModule(hostTs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace(/export \{\};?/g, "");
const template = readFileSync(join(here, "host.html"), "utf8");

const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function hostPage(frames) {
  const iframes = frames.map((f) =>
    `<figure class="fig"><iframe class="ksyt-draw-frame" id="${attr(f.id)}" src="${attr(f.src)}" title="${attr(f.title)}" loading="eager" ` +
    `referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" ` +
    `style="width:100%;height:120px;border:0;display:block"></iframe><figcaption class="note">${attr(f.title)}</figcaption></figure>`).join("\n");
  return template.replace("{{FRAMES}}", iframes).replace("{{HOST_JS}}", hostJs);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:4174");
  let body = "";
  if (url.pathname === "/host") {
    body = hostPage(JSON.parse(url.searchParams.get("f") || "[]"));
  } else if (url.pathname === "/bare") {
    body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>bare</title></head><body>` +
      `<iframe id="bare" src="${attr(url.searchParams.get("src") || "")}" title="Flowchart" style="width:100%;height:600px;border:0"></iframe></body></html>`;
  } else {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
});
server.listen(4174, "127.0.0.1", () => console.log("host server on http://localhost:4174"));
