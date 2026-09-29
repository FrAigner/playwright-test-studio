// Tabs
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

function logLine(container, text, cls = "") {
  const div = document.createElement("div");
  div.className = `line ${cls}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function describeEvent(e) {
  switch (e.type) {
    case "navigate":
      return { text: `→ öffne ${e.url}` };
    case "snapshot":
      return { text: `  Seite gelesen (${e.elementCount} Elemente): ${e.url}` };
    case "click":
      return { text: `  klicke Element ${e.ref}` };
    case "type":
      return { text: `  tippe "${e.text}" in Feld ${e.ref}${e.submit ? " + Enter" : ""}` };
    case "select_option":
      return { text: `  wähle "${e.value}" in ${e.ref}` };
    case "press_key":
      return { text: `  Taste: ${e.key}` };
    case "thought":
      return { text: `💭 ${e.text}` };
    case "tool_error":
      return { text: `  Fehler bei ${e.name}: ${e.error}`, cls: "err" };
    case "done":
      return { text: `✓ Agent ist fertig, schreibt Ergebnis...`, cls: "ok" };
    case "error":
      return { text: `Fehler: ${e.message}`, cls: "err" };
    default:
      return null;
  }
}

async function streamPost(url, body, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      onEvent(JSON.parse(json));
    }
  }
}

function codeBlock(filename, summary, code) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p><strong>${filename}</strong> — ${summary || ""}</p>
    <pre class="code-box"></pre>
    <div class="result-actions">
      <button class="secondary" data-action="copy">Code kopieren</button>
      <button class="secondary" data-action="download">Herunterladen</button>
      <button data-action="run">Test ausführen</button>
    </div>
    <p class="status-text" data-run-status></p>
  `;
  wrap.querySelector("pre").textContent = code;
  wrap.querySelector('[data-action="copy"]').addEventListener("click", () => {
    navigator.clipboard.writeText(code);
  });
  wrap.querySelector('[data-action="download"]').addEventListener("click", () => {
    const blob = new Blob([code], { type: "text/javascript" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  });
  wrap.querySelector('[data-action="run"]').addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    const statusEl = wrap.querySelector("[data-run-status]");
    statusEl.textContent = "Test läuft...";
    try {
      const res = await fetch(`/api/tests/${encodeURIComponent(filename)}/run`, { method: "POST" });
      const data = await res.json();
      statusEl.textContent = data.ok ? "✓ Test bestanden" : "✗ Test fehlgeschlagen";
      statusEl.className = `status-text ${data.ok ? "" : "err"}`;
      const pre = document.createElement("pre");
      pre.className = "code-box";
      pre.textContent = data.output;
      wrap.appendChild(pre);
    } catch (err) {
      statusEl.textContent = `Fehler: ${err.message}`;
    } finally {
      ev.target.disabled = false;
    }
  });
  return wrap;
}

// --- Einfacher Modus ---
const simpleForm = document.getElementById("simple-form");
const simpleLog = document.getElementById("simple-log");
const simpleResult = document.getElementById("simple-result");

simpleForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  simpleLog.innerHTML = "";
  simpleResult.innerHTML = "";
  const submitBtn = simpleForm.querySelector("button");
  submitBtn.disabled = true;
  const data = Object.fromEntries(new FormData(simpleForm));
  try {
    await streamPost("/api/generate-test", data, (e) => {
      if (e.type === "result") {
        simpleResult.appendChild(codeBlock(e.filename, e.summary, e.code));
        return;
      }
      const d = describeEvent(e);
      if (d) logLine(simpleLog, d.text, d.cls);
    });
  } catch (err) {
    logLine(simpleLog, `Fehler: ${err.message}`, "err");
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Advanced: Testplan ---
const planForm = document.getElementById("plan-form");
const planLog = document.getElementById("plan-log");
const planResult = document.getElementById("plan-result");
const planItemTemplate = document.getElementById("plan-item-template");

let currentPlanUrl = "";

planForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  planLog.innerHTML = "";
  planResult.innerHTML = "";
  const submitBtn = planForm.querySelector("button");
  submitBtn.disabled = true;
  const data = Object.fromEntries(new FormData(planForm));
  currentPlanUrl = data.url;
  try {
    await streamPost("/api/generate-plan", data, (e) => {
      if (e.type === "result") {
        renderPlan(e.plan);
        return;
      }
      const d = describeEvent(e);
      if (d) logLine(planLog, d.text, d.cls);
    });
  } catch (err) {
    logLine(planLog, `Fehler: ${err.message}`, "err");
  } finally {
    submitBtn.disabled = false;
  }
});

function renderPlan(plan) {
  planResult.innerHTML = "";
  const list = document.createElement("div");
  plan.forEach((item, idx) => {
    const node = planItemTemplate.content.cloneNode(true);
    node.querySelector(".plan-item-name").textContent = item.name;
    node.querySelector(".plan-item-desc").textContent = item.description;
    node.querySelector(".badge").textContent = item.priority;
    node.querySelector("input").dataset.index = idx;
    list.appendChild(node);
  });
  planResult.appendChild(list);

  const genBtn = document.createElement("button");
  genBtn.textContent = "Tests für ausgewählte Punkte generieren";
  genBtn.addEventListener("click", () => generateSuite(plan, list, genBtn));
  planResult.appendChild(genBtn);

  const suiteLog = document.createElement("div");
  suiteLog.className = "log";
  const suiteResult = document.createElement("div");
  suiteResult.className = "result";
  planResult.appendChild(suiteLog);
  planResult.appendChild(suiteResult);

  genBtn.dataset.attachedLog = "true";
  genBtn._suiteLog = suiteLog;
  genBtn._suiteResult = suiteResult;
}

async function generateSuite(plan, listEl, genBtn) {
  const checked = Array.from(listEl.querySelectorAll("input[type=checkbox]"))
    .filter((cb) => cb.checked)
    .map((cb) => plan[Number(cb.dataset.index)]);
  if (checked.length === 0) return;

  genBtn.disabled = true;
  const suiteLog = genBtn._suiteLog;
  const suiteResult = genBtn._suiteResult;
  suiteLog.innerHTML = "";
  suiteResult.innerHTML = "";

  try {
    await streamPost(
      "/api/generate-suite",
      { url: currentPlanUrl, plan: checked },
      (e) => {
        if (e.type === "suite_item_start") {
          logLine(suiteLog, `\n[${e.index + 1}/${e.total}] ${e.item.name}`, "ok");
          return;
        }
        if (e.type === "suite_item_done") {
          logLine(suiteLog, e.ok ? `  ✓ fertig` : `  ✗ Fehler: ${e.error}`, e.ok ? "ok" : "err");
          return;
        }
        if (e.type === "result") {
          e.results.forEach((r) => {
            if (r.ok) {
              fetch(`/api/tests/${encodeURIComponent(r.filename)}`)
                .then((res) => res.json())
                .then((full) => suiteResult.appendChild(codeBlock(full.filename, r.summary, full.code)));
            }
          });
          return;
        }
        const d = describeEvent(e);
        if (d) logLine(suiteLog, `  ${d.text}`, d.cls);
      }
    );
  } catch (err) {
    logLine(suiteLog, `Fehler: ${err.message}`, "err");
  } finally {
    genBtn.disabled = false;
  }
}

// --- Bibliothek ---
const libraryList = document.getElementById("library-list");
const libraryCode = document.getElementById("library-code");

async function loadLibrary() {
  const res = await fetch("/api/tests");
  const { files } = await res.json();
  libraryList.innerHTML = "";
  files.forEach((filename) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${filename}</span>`;
    const actions = document.createElement("span");

    const viewBtn = document.createElement("button");
    viewBtn.className = "secondary";
    viewBtn.textContent = "Ansehen";
    viewBtn.addEventListener("click", async () => {
      const r = await fetch(`/api/tests/${encodeURIComponent(filename)}`);
      const data = await r.json();
      libraryCode.hidden = false;
      libraryCode.textContent = data.code;
    });

    const runBtn = document.createElement("button");
    runBtn.textContent = "Ausführen";
    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      runBtn.textContent = "läuft...";
      const r = await fetch(`/api/tests/${encodeURIComponent(filename)}/run`, { method: "POST" });
      const data = await r.json();
      runBtn.textContent = data.ok ? "✓ bestanden" : "✗ fehlgeschlagen";
      runBtn.disabled = false;
    });

    actions.appendChild(viewBtn);
    actions.appendChild(runBtn);
    li.appendChild(actions);
    libraryList.appendChild(li);
  });
}

document.getElementById("refresh-library").addEventListener("click", loadLibrary);
document.querySelector('[data-tab="library"]').addEventListener("click", loadLibrary);
