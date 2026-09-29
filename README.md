# Playwright Test Studio

Kleine Web-App, die aus einer natürlichsprachlichen Beschreibung oder aus einer
reinen URL automatisch **lauffähige Playwright-Tests** erzeugt. Im Backend
steuert ein Claude-Agent per Tool-Use einen echten (headless) Chromium-Browser:
er navigiert, liest die Seite aus, klickt/tippt selbst durch den beschriebenen
Ablauf und schreibt danach den fertigen Testcode – nicht nur "vermutet",
sondern tatsächlich einmal durchgespielt.

## Zwei Modi

- **Einfach**: URL + Beschreibung ("Suche im Header nach X und prüfe, dass
  Ergebnisse erscheinen") → ein Playwright-Test.
- **Advanced (Testplan)**: nur eine URL → der Agent erkundet die Seite rein
  lesend (keine Formulare, kein Login, keine Käufe) und schlägt 4-8 wichtige,
  für Monitoring lohnende Funktionen vor. Nach Auswahl/Bestätigung generiert
  er für jeden Punkt automatisch einen eigenen Test.

Alle generierten Tests landen unter `generated-tests/*.spec.js`, sind über den
Tab "Gespeicherte Tests" einsehbar und lassen sich direkt aus der UI oder per

```bash
npx playwright test generated-tests/<datei>.spec.js
```

ausführen.

## Architektur

```
server.mjs            Node-HTTP-Server, statisches Frontend + JSON/SSE-API
lib/browserSession.mjs Playwright-Steuerung: navigate/snapshot/click/type/...
lib/claudeAgent.mjs     generischer Tool-Use-Loop gegen die Anthropic-API
lib/testGenerator.mjs   Prompts + Tool-Definitionen für Test-/Plan-Generierung
lib/store.mjs           Speichern/Auflisten/Ausführen generierter Tests
public/                 Frontend (kein Framework, reines HTML/CSS/JS)
```

`snapshot()` liest nicht nur Text, sondern liefert für jedes interaktive
Element auch einen fertigen Playwright-Locator-Vorschlag (`getByRole`,
`getByLabel`, ...), den der Agent 1:1 in den generierten Code übernimmt –
dadurch entstehen robuste Tests statt brüchiger CSS-Selektoren.

Fortschritt (Navigation, Klicks, Zwischengedanken des Agents) wird per
Server-Sent-Events live ins Frontend gestreamt, damit man bei der u.U.
minutenlangen Exploration nicht im Dunkeln sitzt.

## Setup

```bash
npm install
cp .env.example .env
# ANTHROPIC_API_KEY in .env eintragen
npm start          # http://localhost:8124
```

Nutzt das auf dem Pi bereits vorhandene System-Chromium (`/usr/bin/chromium`),
kein eigener Playwright-Browser-Download nötig. Anderer Pfad via
`PLAYWRIGHT_CHROMIUM_PATH` in `.env`.

## Betrieb als systemd-Service (optional)

Analog zum Familien-Dashboard (`pi-assistant/dashboard`): einen
`playwright-test-studio.service` anlegen, der im Kern
`ExecStart=/usr/bin/node server.mjs` in diesem Verzeichnis ausführt, und mit
`systemctl --user enable --now playwright-test-studio.service` starten.

## Grenzen / bewusste Vereinfachungen

- Der Advanced-Modus erkundet nur öffentlich erreichbare Seiten ohne Login
  und führt dabei bewusst keine Formulare/Käufe aus (reine Beobachtung).
- Test-Generierung für einen ganzen Plan läuft sequenziell (ein Browser
  gleichzeitig) und ist auf 10 Punkte gedeckelt – Rücksicht auf die
  begrenzten Ressourcen des Pi und auf API-Kosten.
- Es gibt keine Nutzerverwaltung/Auth – die App ist für den Betrieb im
  eigenen lokalen Netz gedacht.
