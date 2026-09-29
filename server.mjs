import "dotenv/config";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateTest, generatePlan, generateSuite } from "./lib/testGenerator.mjs";
import {
  saveGeneratedTest,
  listGeneratedTests,
  readGeneratedTest,
  runGeneratedTest,
} from "./lib/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 8124;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function openSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  return {
    send(event) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      res.end();
    },
  };
}

async function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  try {
    await stat(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/generate-test") {
      const { url: targetUrl, description } = await readBody(req);
      const sse = openSSE(res);
      try {
        const result = await generateTest({ url: targetUrl, description }, (e) => sse.send(e));
        const filename = await saveGeneratedTest(result.filename, result.code);
        sse.send({ type: "result", filename, summary: result.summary, code: result.code });
      } catch (err) {
        sse.send({ type: "error", message: err.message });
      }
      sse.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-plan") {
      const { url: targetUrl } = await readBody(req);
      const sse = openSSE(res);
      try {
        const plan = await generatePlan({ url: targetUrl }, (e) => sse.send(e));
        sse.send({ type: "result", plan });
      } catch (err) {
        sse.send({ type: "error", message: err.message });
      }
      sse.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate-suite") {
      const { url: targetUrl, plan } = await readBody(req);
      const sse = openSSE(res);
      try {
        const results = await generateSuite({ url: targetUrl, plan }, (e) => sse.send(e));
        const saved = [];
        for (const r of results) {
          if (r.ok) {
            const filename = await saveGeneratedTest(r.test.filename, r.test.code);
            saved.push({ item: r.item, ok: true, filename, summary: r.test.summary });
          } else {
            saved.push({ item: r.item, ok: false, error: r.error });
          }
        }
        sse.send({ type: "result", results: saved });
      } catch (err) {
        sse.send({ type: "error", message: err.message });
      }
      sse.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tests") {
      return sendJson(res, 200, { files: await listGeneratedTests() });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/tests/")) {
      const name = decodeURIComponent(url.pathname.replace("/api/tests/", ""));
      try {
        const code = await readGeneratedTest(name);
        return sendJson(res, 200, { filename: name, code });
      } catch {
        return sendJson(res, 404, { error: "nicht gefunden" });
      }
    }

    if (req.method === "POST" && /^\/api\/tests\/[^/]+\/run$/.test(url.pathname)) {
      const name = decodeURIComponent(url.pathname.split("/")[3]);
      const result = await runGeneratedTest(name);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET") {
      return await serveStatic(req, res);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
  } catch (err) {
    console.error("Request-Fehler:", err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Playwright Test Studio läuft auf http://0.0.0.0:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("WARNUNG: ANTHROPIC_API_KEY ist nicht gesetzt (.env fehlt?) - Generierung wird fehlschlagen.");
  }
});
