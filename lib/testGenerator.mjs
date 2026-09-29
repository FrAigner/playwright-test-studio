import { BrowserSession } from "./browserSession.mjs";
import { runAgentLoop } from "./claudeAgent.mjs";

const EXPLORATION_TOOLS = [
  {
    name: "navigate",
    description: "Öffnet eine URL im Browser (z.B. um zu einer Unterseite zu wechseln).",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "snapshot",
    description:
      "Liest die aktuell sichtbare Seite aus: Titel, Überschriften und alle interaktiven Elemente " +
      "(Links, Buttons, Formularfelder) mit einer 'ref' zum Ansteuern und einem 'suggestedLocator' " +
      "(fertiger Playwright-Locator-Code für den finalen Test). Rufe dies nach jeder Navigation/Aktion " +
      "erneut auf, bevor du das nächste Element ansteuerst, da sich refs pro Snapshot ändern können.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Klickt auf das Element mit der angegebenen ref aus dem letzten snapshot.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "type",
    description:
      "Trägt Text in das Feld mit der angegebenen ref ein. submit=true drückt danach Enter.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "select_option",
    description: "Wählt in einem <select>-Element (ref) den Wert value aus.",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, value: { type: "string" } },
      required: ["ref", "value"],
    },
  },
  {
    name: "press_key",
    description: "Drückt eine Tastatur-Taste, z.B. 'Enter' oder 'Escape'.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "wait",
    description: "Wartet die angegebene Zeit in Millisekunden (max. 5000), z.B. auf Ladeanimationen.",
    input_schema: {
      type: "object",
      properties: { ms: { type: "number" } },
      required: ["ms"],
    },
  },
];

const FINISH_TEST_TOOL = {
  name: "finish_test",
  description:
    "Schließt die Aufgabe ab und liefert den fertigen, lauffähigen Playwright-Testcode.",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "kurzer, sprechender Dateiname, z.B. 'produktsuche.spec.js'",
      },
      summary: { type: "string", description: "1-2 Sätze, was der Test prüft" },
      code: {
        type: "string",
        description:
          "Vollständiger Inhalt der .spec.js-Datei (import { test, expect } from '@playwright/test'; ...).",
      },
    },
    required: ["filename", "summary", "code"],
  },
};

const FINISH_PLAN_TOOL = {
  name: "finish_plan",
  description: "Liefert den fertigen Testplan als Liste wichtiger zu überwachender Funktionen.",
  input_schema: {
    type: "object",
    properties: {
      plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: {
              type: "string",
              description:
                "So konkret formuliert, dass es 1:1 als Anweisung für einen Test-Generator dient.",
            },
            priority: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
          },
          required: ["name", "description", "priority"],
        },
      },
    },
    required: ["plan"],
  },
};

function codeGenSystemPrompt() {
  return `Du bist ein erfahrener QA-Automatisierungs-Ingenieur. Du steuerst einen echten, laufenden \
Chromium-Browser über Tools und sollst am Ende einen sauberen, lauffähigen Playwright-Test \
(@playwright/test, JavaScript, ESM) liefern, der GENAU die beschriebene Nutzeraktion abbildet.

Vorgehen:
1. Rufe zuerst snapshot auf, um die Seite zu verstehen.
2. Führe die beschriebene Aktion Schritt für Schritt selbst im Browser aus (click/type/navigate/...),
   um zu verifizieren, dass sie funktioniert und um die richtigen Selektoren/Erwartungen zu ermitteln.
3. Rufe nach jeder Navigation oder größeren Änderung erneut snapshot auf.
4. Wenn du die Aktion erfolgreich durchgespielt hast, schreibe den finalen Testcode und rufe finish_test auf.

Regeln für den generierten Code:
- Nutze test('...', async ({ page }) => { ... }) aus '@playwright/test'.
- Nutze bevorzugt die suggestedLocator-Werte aus den Snapshots (getByRole/getByLabel/getByPlaceholder/getByText),
  keine rohen data-agent-ref-Selektoren (die existieren nur zur Laufzeit deiner Exploration, nicht im echten Test).
- Der Test muss mit page.goto(<Start-URL>) beginnen.
- Füge mindestens eine sinnvolle expect(...)-Assertion ein, die den Erfolg der Aktion prüft
  (z.B. dass Suchergebnisse erscheinen, eine URL sich ändert, ein Text sichtbar wird).
- Kurze Kommentare nur, wo der Grund für einen Schritt nicht offensichtlich ist.
- Keine Erklärtexte außerhalb von finish_test - der Code muss direkt lauffähig sein.`;
}

function planSystemPrompt() {
  return `Du bist ein erfahrener QA-Lead. Du bekommst die Start-URL einer Webseite und sollst NUR \
per Browsing (navigate/snapshot) herausfinden, welche wichtigen, für Monitoring lohnenden Nutzerfunktionen \
es gibt (z.B. Suche, Login, Warenkorb/Checkout-Einstieg, Kontaktformular, Filter, Registrierung, Navigation).

WICHTIG - das ist eine rein lesende Erkundung:
- Du darfst navigate und snapshot beliebig nutzen, um Seiten/Navigation zu verstehen.
- Klicke höchstens auf harmlose Navigations-/Menü-Links, um Unterseiten zu entdecken.
- Fülle KEINE Formulare aus, logge dich NICHT ein, kaufe NICHTS, lösche/ändere NICHTS.
- Erkunde maximal 5-8 Seiten, dann schließe ab.

Rufe abschließend finish_plan mit 4-8 Einträgen auf, priorisiert nach Wichtigkeit für laufendes Monitoring.
Jede description muss so konkret sein, dass sie direkt als Anweisung für einen Testgenerator dient
(z.B. "Suche nach einem Artikel über das Suchfeld im Header und prüfe, dass Ergebnisse erscheinen").`;
}

async function withBrowserSession(url, onEvent, fn) {
  const session = new BrowserSession(onEvent);
  try {
    await session.start(url);
    return await fn(session);
  } finally {
    await session.close();
  }
}

function makeExecutor(session) {
  return async (name, input) => {
    switch (name) {
      case "navigate":
        return await session.navigate(input.url);
      case "snapshot":
        return await session.snapshot();
      case "click":
        await session.click(input.ref);
        return { ok: true };
      case "type":
        await session.type(input.ref, input.text, { submit: !!input.submit });
        return { ok: true };
      case "select_option":
        await session.selectOption(input.ref, input.value);
        return { ok: true };
      case "press_key":
        await session.pressKey(input.key);
        return { ok: true };
      case "wait":
        await session.wait(input.ms ?? 500);
        return { ok: true };
      default:
        throw new Error(`Unbekanntes Tool: ${name}`);
    }
  };
}

export async function generateTest({ url, description }, onEvent = () => {}) {
  return withBrowserSession(url, onEvent, async (session) => {
    const { terminalTool, input } = await runAgentLoop({
      system: codeGenSystemPrompt(),
      userMessage: `Start-URL: ${url}\n\nGewünschter Test (vom Nutzer beschrieben):\n${description}`,
      tools: [...EXPLORATION_TOOLS, FINISH_TEST_TOOL],
      terminalTools: ["finish_test"],
      executeTool: makeExecutor(session),
      onEvent,
    });
    if (terminalTool !== "finish_test") throw new Error("Unerwartetes Abschluss-Tool");
    return input; // { filename, summary, code }
  });
}

export async function generatePlan({ url }, onEvent = () => {}) {
  return withBrowserSession(url, onEvent, async (session) => {
    const { input } = await runAgentLoop({
      system: planSystemPrompt(),
      userMessage: `Start-URL: ${url}\n\nErstelle einen Testplan für die wichtigsten Funktionen, die per Monitoring überwacht werden sollten.`,
      tools: [
        EXPLORATION_TOOLS.find((t) => t.name === "navigate"),
        EXPLORATION_TOOLS.find((t) => t.name === "snapshot"),
        EXPLORATION_TOOLS.find((t) => t.name === "click"),
        FINISH_PLAN_TOOL,
      ],
      terminalTools: ["finish_plan"],
      executeTool: makeExecutor(session),
      onEvent,
    });
    return input.plan; // [{name, description, priority}]
  });
}

export async function generateSuite({ url, plan }, onEvent = () => {}) {
  const capped = plan.slice(0, 10);
  const results = [];
  for (let i = 0; i < capped.length; i++) {
    const item = capped[i];
    onEvent({ type: "suite_item_start", index: i, total: capped.length, item });
    try {
      const test = await generateTest({ url, description: item.description }, (e) =>
        onEvent({ ...e, planItem: item.name })
      );
      results.push({ item, ok: true, test });
      onEvent({ type: "suite_item_done", index: i, item, ok: true });
    } catch (err) {
      results.push({ item, ok: false, error: err.message });
      onEvent({ type: "suite_item_done", index: i, item, ok: false, error: err.message });
    }
  }
  return results;
}
