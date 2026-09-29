import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_TURNS = 20;

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY ist nicht gesetzt (siehe .env.example)."
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Generischer Tool-Use-Loop: schickt eine Aufgabe an Claude, führt jeden
 * angeforderten Tool-Call über `executeTool` aus und wiederholt das,
 * bis eines der in `terminalTools` gelisteten Tools aufgerufen wird
 * (oder MAX_TURNS erreicht ist).
 *
 * @returns {Promise<{terminalTool: string, input: object}>}
 */
export async function runAgentLoop({
  system,
  userMessage,
  tools,
  terminalTools,
  executeTool,
  onEvent = () => {},
}) {
  const anthropic = getClient();
  const messages = [{ role: "user", content: userMessage }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const isLastChance = turn === MAX_TURNS - 2;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: isLastChance
        ? `${system}\n\nWICHTIG: Du hast nur noch sehr wenige Schritte übrig. Schließe JETZT mit dem passenden Abschluss-Tool ab.`
        : system,
      messages,
      tools,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const textBlocks = response.content.filter((b) => b.type === "text");
    for (const t of textBlocks) {
      if (t.text?.trim()) onEvent({ type: "thought", text: t.text.trim() });
    }

    const terminal = toolUses.find((tu) => terminalTools.includes(tu.name));
    if (terminal) {
      onEvent({ type: "done" });
      return { terminalTool: terminal.name, input: terminal.input };
    }

    if (toolUses.length === 0) {
      // Modell hat nur Text geliefert, ohne Tool aufzurufen -> nachhaken.
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content:
          "Bitte fahre mit einem Tool-Aufruf fort, oder rufe das Abschluss-Tool auf, wenn du fertig bist.",
      });
      continue;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const tu of toolUses) {
      onEvent({ type: "tool_call", name: tu.name, input: tu.input });
      try {
        const result = await executeTool(tu.name, tu.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result ?? {}),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Fehler: ${err.message}`,
          is_error: true,
        });
        onEvent({ type: "tool_error", name: tu.name, error: err.message });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Agent hat das Limit an Schritten erreicht, ohne fertig zu werden.");
}
