<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Ein Betriebssystem für autonome Forschung</h1>

  <p><strong>Autonome Forschungsausführung statt bloßer Textgenerierung.</strong><br/>
  Von der Literatur bis zum Manuskript in einem gesteuerten, checkpointbaren und überprüfbaren Ablauf.</p>

  <p>
    <a href="./README.md"><strong>English</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.ko.md"><strong>한국어</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.ja.md"><strong>日本語</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.zh-CN.md"><strong>简体中文</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.zh-TW.md"><strong>繁體中文</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.es.md"><strong>Español</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.fr.md"><strong>Français</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.de.md"><strong>Deutsch</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.pt.md"><strong>Português</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="./README.ru.md"><strong>Русский</strong></a>
  </p>

  <p><sub>Dieses README ist eine zusammengefasste Ubersetzung. Fur die vollstandige technische Referenz gilt das <a href="./README.md">englische README</a> als kanonisch.</sub></p>

</div>

---

Die meisten Werkzeuge, die Forschungsautomatisierung versprechen, automatisieren in Wahrheit nur die **Textgenerierung**. Sie liefern glatte Ausgaben, aber ohne Experiment-Governance, ohne Evidenzverfolgung und ohne ehrliche Begrenzung dessen, was die Daten tatsachlich tragen.

AutoLabOS verfolgt einen anderen Ansatz. **Der schwierige Teil von Forschung ist nicht das Schreiben, sondern die Disziplin zwischen Frage und Entwurf.** Literaturfundierung, Hypothesentests, Experiment-Governance, Fehlerspeicher, Claim Ceiling und Review-Gates laufen in einem festen 9-Knoten-Zustandsgraphen ab.

> Erst Evidenz. Dann Behauptungen.

## Was Sie nach einem Run erhalten

- Literaturkorpus, BibTeX und Evidenzspeicher
- Literaturgestutzte Hypothesen mit skeptischer Review
- Experimentplan mit gesperrter Baseline
- Ausgefuhrte Resultate, Metriken und Fehlerspeicher
- Ergebnisanalyse, Ubergangsentscheidungen und Review-Paket
- Manuskript mit Evidenzlinks, PDF und Checkpoints pro Knoten

Alle Zustande liegen unter `.autolabos/runs/<run_id>/`, offentliche Ausgaben werden nach `outputs/` gespiegelt.

## Schnellstart

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# oder
autolabos
```

### Voraussetzungen

- `SEMANTIC_SCHOLAR_API_KEY`: immer erforderlich
- `OPENAI_API_KEY`: wenn Provider oder PDF-Modus `api` ist
- Codex-CLI-Login: wenn Provider oder PDF-Modus `codex` ist

## 9-Knoten-Workflow

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

Wenn Ergebnisse schwach sind, geht das System zu Hypothesen oder Design zuruck, statt optimistisch weiterzuschreiben. Automatisierung bleibt auf klar begrenzte Schleifen innerhalb der Knoten beschrankt.

## Kerneigenschaften

- **Experiment-Governance**: Vertrage fixieren Hypothese, kausalen Mechanismus, Single-Change-Regel und Abbruchbedingung
- **Claim Ceiling**: `review` erzeugt die starkste vertretbare Aussage und die Evidenzlucken
- **Fehlerspeicher**: gruppiert aquivalente Fehler und stoppt nutzlose Wiederholungen
- **Zweistufige Paper-Bewertung**: deterministische Mindesthurde + LLM-Qualitatsbewertung
- **5-Spezialisten-Panel**: unabhangige Bewertung von Claims, Methodik, Statistik, Schreiben und Integritat

## Oberflachen und Modi

- `autolabos`: terminalzentrierte TUI
- `autolabos web`: lokale Web-Ops-UI

Modi:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## Entwicklung

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

Wichtige Dokumente:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>Gebaut fur Forschende, die kontrollierte Experimente und belastbare Aussagen wollen.</sub>
</div>
