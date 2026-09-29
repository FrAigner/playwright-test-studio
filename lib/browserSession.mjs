import { chromium } from "playwright";

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/chromium";
const MAX_ELEMENTS = 60;

// Baut aus einem DOM-Element eine robuste, für generierten Testcode
// verwendbare Playwright-Locator-Beschreibung (bevorzugt Rolle/Text/Label,
// wie es auch ein Mensch beim Schreiben eines Tests tun würde).
function buildLocatorSnippet(el) {
  const esc = (s) => s.replace(/'/g, "\\'");
  if (el.testId) return `page.getByTestId('${esc(el.testId)}')`;
  if (el.role && el.accessibleName) {
    return `page.getByRole('${el.role}', { name: '${esc(el.accessibleName)}' })`;
  }
  if (el.label) return `page.getByLabel('${esc(el.label)}')`;
  if (el.placeholder) return `page.getByPlaceholder('${esc(el.placeholder)}')`;
  if (el.accessibleName) return `page.getByText('${esc(el.accessibleName)}', { exact: true })`;
  if (el.id) return `page.locator('#${esc(el.id)}')`;
  if (el.name) return `page.locator('[name="${esc(el.name)}"]')`;
  return `page.locator('${el.cssFallback}')`;
}

export class BrowserSession {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.browser = null;
    this.page = null;
    this.refCounter = 0;
  }

  async start(url) {
    this.browser = await chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
    });
    const context = await this.browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 PlaywrightTestStudio",
    });
    this.page = await context.newPage();
    await this.navigate(url);
  }

  async navigate(url) {
    this.onEvent({ type: "navigate", url });
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await this.page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});
    return { url: this.page.url(), title: await this.page.title() };
  }

  // Liest die interaktiven Elemente + Überschriften der aktuellen Seite aus
  // und markiert jedes interaktive Element mit einem temporären
  // data-agent-ref Attribut, über das click/type es gezielt ansprechen.
  async snapshot() {
    const data = await this.page.evaluate((maxElements) => {
      document
        .querySelectorAll("[data-agent-ref]")
        .forEach((el) => el.removeAttribute("data-agent-ref"));

      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      const accessibleName = (el) => {
        return (
          el.getAttribute("aria-label") ||
          el.innerText?.trim().slice(0, 80) ||
          el.getAttribute("alt") ||
          el.getAttribute("title") ||
          el.value ||
          ""
        ).trim();
      };

      const roleOf = (el) => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === "a" && el.hasAttribute("href")) return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          const t = (el.getAttribute("type") || "text").toLowerCase();
          if (["submit", "button"].includes(t)) return "button";
          if (t === "checkbox") return "checkbox";
          if (t === "radio") return "radio";
          return "textbox";
        }
        return null;
      };

      const labelFor = (el) => {
        if (el.id) {
          const lbl = document.querySelector(`label[for="${el.id}"]`);
          if (lbl) return lbl.innerText.trim().slice(0, 80);
        }
        const parentLabel = el.closest("label");
        return parentLabel ? parentLabel.innerText.trim().slice(0, 80) : "";
      };

      const candidates = Array.from(
        document.querySelectorAll(
          "a[href], button, input, select, textarea, [role], [onclick], summary"
        )
      ).filter(isVisible);

      let refCounter = 0;
      const elements = [];
      for (const el of candidates) {
        if (elements.length >= maxElements) break;
        const role = roleOf(el);
        const ref = `e${refCounter++}`;
        el.setAttribute("data-agent-ref", ref);
        elements.push({
          ref,
          tag: el.tagName.toLowerCase(),
          role,
          accessibleName: accessibleName(el),
          label: labelFor(el),
          placeholder: el.getAttribute("placeholder") || "",
          id: el.id || "",
          name: el.getAttribute("name") || "",
          testId: el.getAttribute("data-testid") || "",
          type: el.getAttribute("type") || "",
          href: el.tagName.toLowerCase() === "a" ? el.getAttribute("href") : undefined,
          cssFallback: `[data-agent-ref="${ref}"]`,
        });
      }

      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .slice(0, 15)
        .map((h) => h.innerText.trim())
        .filter(Boolean);

      return {
        title: document.title,
        url: window.location.href,
        headings,
        elements,
      };
    }, MAX_ELEMENTS);

    data.elements = data.elements.map((el) => ({
      ...el,
      suggestedLocator: buildLocatorSnippet(el),
    }));

    this.onEvent({ type: "snapshot", url: data.url, elementCount: data.elements.length });
    return data;
  }

  async click(ref) {
    this.onEvent({ type: "click", ref });
    await this.page.click(`[data-agent-ref="${ref}"]`, { timeout: 8000 });
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }

  async type(ref, text, { submit = false } = {}) {
    this.onEvent({ type: "type", ref, text, submit });
    const locator = this.page.locator(`[data-agent-ref="${ref}"]`);
    await locator.fill(text, { timeout: 8000 });
    if (submit) {
      await locator.press("Enter");
      await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }
  }

  async selectOption(ref, value) {
    this.onEvent({ type: "select_option", ref, value });
    await this.page.selectOption(`[data-agent-ref="${ref}"]`, value, { timeout: 8000 });
  }

  async pressKey(key) {
    this.onEvent({ type: "press_key", key });
    await this.page.keyboard.press(key);
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }

  async wait(ms) {
    await this.page.waitForTimeout(Math.min(ms, 5000));
  }

  async close() {
    await this.browser?.close().catch(() => {});
  }
}
