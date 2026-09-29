import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(ROOT, "generated-tests");

function safeFilename(name) {
  const base = (name || "test").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  const withExt = base.endsWith(".spec.js") ? base : `${base}.spec.js`;
  return withExt.replace(/^-+/, "");
}

export async function saveGeneratedTest(filename, code) {
  await mkdir(TESTS_DIR, { recursive: true });
  let name = safeFilename(filename);
  let full = path.join(TESTS_DIR, name);
  let i = 2;
  while (
    await readFile(full, "utf8")
      .then(() => true)
      .catch(() => false)
  ) {
    name = safeFilename(filename).replace(/\.spec\.js$/, `-${i}.spec.js`);
    full = path.join(TESTS_DIR, name);
    i++;
  }
  await writeFile(full, code, "utf8");
  return name;
}

export async function listGeneratedTests() {
  await mkdir(TESTS_DIR, { recursive: true });
  const files = await readdir(TESTS_DIR);
  return files.filter((f) => f.endsWith(".spec.js")).sort();
}

export async function readGeneratedTest(filename) {
  const name = safeFilename(filename);
  return readFile(path.join(TESTS_DIR, name), "utf8");
}

export function runGeneratedTest(filename) {
  const name = safeFilename(filename);
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["playwright", "test", path.join("generated-tests", name), "--reporter=list"],
      { cwd: ROOT, env: process.env }
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}
