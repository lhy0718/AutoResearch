<div align="center">
  <h1>AutoLabOS</h1>
  <p><strong>AI-agent-driven research automation with a slash-first TUI and local web ops UI.</strong></p>
  <p>
    Move from paper collection and evidence analysis to experiment execution and
    paper drafting with a checkpointed, inspectable workflow that stays local to
    your workspace.
  </p>
  <p>
    <a href="./README.md"><strong>English</strong></a>
    ·
    <a href="./README.ko.md"><strong>한국어</strong></a>
  </p>
  <p>
    <a href="https://github.com/lhy0718/AutoLabOS/actions/workflows/smoke.yml">
      <img alt="Smoke workflow" src="https://img.shields.io/github/actions/workflow/status/lhy0718/AutoLabOS/smoke.yml?branch=main&style=flat-square&label=smoke" />
    </a>
    <img alt="Node 18+" src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Codex and OpenAI supported" src="https://img.shields.io/badge/Codex%20%2B%20OpenAI-supported-412991?style=flat-square&logo=openai&logoColor=white" />
    <img alt="8-node workflow" src="https://img.shields.io/badge/workflow-8%20nodes-0F766E?style=flat-square" />
    <img alt="Local Web Ops UI" src="https://img.shields.io/badge/web%20ops-local-0EA5E9?style=flat-square" />
    <img alt="Checkpointed runs" src="https://img.shields.io/badge/checkpoints-built%20in-CA8A04?style=flat-square" />
  </p>
  <p>
    <img alt="Semantic Scholar required" src="https://img.shields.io/badge/Semantic%20Scholar-required-1857B6?style=flat-square" />
    <a href="https://github.com/lhy0718/AutoLabOS/stargazers">
      <img alt="GitHub stars" src="https://img.shields.io/github/stars/lhy0718/AutoLabOS?style=flat-square" />
    </a>
    <a href="https://github.com/lhy0718/AutoLabOS/commits/main">
      <img alt="Last commit" src="https://img.shields.io/github/last-commit/lhy0718/AutoLabOS?style=flat-square" />
    </a>
  </p>
</div>

## Why AutoLabOS?

- Turn the research loop into a fixed 8-node state graph from `collect_papers` to `write_paper`.
- Run the main workflow with either `codex` or `OpenAI API`, then switch PDF analysis independently.
- Keep work local and inspectable with checkpoints, budgets, retries, jumps, and run-scoped memory.

## Highlights

| Capability | What it gives you |
| --- | --- |
| Slash-first TUI | Operate the system from `/new`, `/agent ...`, `/model`, `/settings`, and `/doctor` |
| Local Web Ops UI | Run `autolabos web` for onboarding, dashboard controls, artifacts, checkpoints, and live session state in the browser |
| Deterministic natural-language routing | Common intents map to local handlers or slash commands before LLM fallback |
| Hybrid provider model | Default to Codex login for the primary flow, or move to OpenAI API models when you want explicit API-backed execution |
| PDF analysis modes | Default to local extraction + Codex hybrid PDF analysis, or send PDFs directly to the Responses API when needed |
| Research runtime patterns | ReAct, ReWOO, ToT, and Reflexion are used where they make sense |
| Local ACI execution | `implement_experiments` and `run_experiments` execute through file, command, and test actions |

## Quick Start

> [!IMPORTANT]
> `SEMANTIC_SCHOLAR_API_KEY` is required. `OPENAI_API_KEY` is only needed when the main provider or PDF analysis mode is `api`.

1. Install and build

```bash
npm install
npm run build
npm link
```

2. Add environment variables

```bash
cp .env.example .env
echo 'SEMANTIC_SCHOLAR_API_KEY=your_key_here' >> .env
echo 'OPENAI_API_KEY=your_openai_key_here' >> .env
```

3. Launch the TUI

```bash
autolabos
```

4. Launch the web UI

```bash
autolabos web
```

The web server listens on `http://127.0.0.1:4317` by default.
Run this from the research project directory you want AutoLabOS to use as its workspace.

If you are using a repository checkout and the CLI says the installed web assets are missing, build the web bundle once from the AutoLabOS package root:

```bash
cd /path/to/AutoLabOS
npm --prefix web run build
autolabos web
```

Use a custom bind address or port when needed:

```bash
autolabos web --host 0.0.0.0 --port 8080
```

Development mode:

```bash
npm run dev
npm run dev:web
```

Without `npm link`, you can still run:

```bash
node dist/cli/main.js
node dist/cli/main.js web
```

> [!NOTE]
> External entrypoints are `autolabos` and `autolabos web`. `autolabos init` is intentionally not supported.

## First Run

1. Run `autolabos` or `autolabos web` in an empty project.
2. If `.autolabos/config.yaml` does not exist, the TUI opens the setup wizard and the web app shows the onboarding form.
3. Both flows create the same scaffold/config, store your Semantic Scholar key, and open the main dashboard.
4. Choose the primary LLM provider:
   - `codex`: use Codex ChatGPT login for the main workflow (default)
   - `api`: use OpenAI API models for the main workflow (`OPENAI_API_KEY` required)
5. Choose the PDF analysis mode:
   - `codex`: download and extract PDF text locally, then analyze with Codex (default)
   - `api`: send the PDF directly to the Responses API (`OPENAI_API_KEY` required)
6. If the provider or PDF mode is `api`, setup wizard and `/settings` let you choose a model.
   - Current built-in catalog: `gpt-5.4`, `gpt-5`, `gpt-5-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`
7. `/model` now lets you choose the active backend first, then select the slot/model:
   - Codex CLI backend: Codex model selector
   - OpenAI API backend: OpenAI API model selector
8. At runtime, AutoLabOS reads `SEMANTIC_SCHOLAR_API_KEY` and `OPENAI_API_KEY` from `process.env` or `.env`.

## Web Ops UI

`autolabos web` starts a local single-user browser UI on top of the same runtime used by the TUI.

- Onboarding uses the same non-interactive setup helper, so web setup writes the same `.autolabos/config.yaml` and `.env` values as the TUI wizard.
- The dashboard includes run search and selection, the 8-node workflow view, node actions, live logs, checkpoints, artifacts, metadata, and `/doctor` summaries.
- The bottom composer accepts both slash commands and supported natural-language requests.
- Multi-step natural-language plans use browser buttons instead of `y/a/n`: `Run next`, `Run all`, and `Cancel`.
- Artifact browsing is restricted to `.autolabos/runs/<run_id>` and previews common text files, images, and PDFs inline.

Typical web flow:

1. Start the server with `autolabos web`.
   Run this from the project directory you want to manage.
   If you see a missing web assets message while using a repository checkout, build once from the AutoLabOS package root with `npm --prefix web run build`, then restart the server.
2. Open `http://127.0.0.1:4317`.
3. Complete onboarding if the workspace is not configured yet.
4. Create or select a run, then use the workflow cards or composer to drive execution.

## Node and Agent Structure

AutoLabOS has two layers that are easy to conflate:

- Orchestration layer: `/agent ...` targets the 8 graph nodes. In code, `AgentId` is currently an alias of `GraphNodeId`.
- Role layer: nodes emit or run `agentRole` identities such as `implementer`, `runner`, and `paper_writer` inside prompts, events, and session managers.

### Node-to-Role Map

```mermaid
flowchart TB
    subgraph Orchestration["Orchestration layer (`/agent` targets)"]
        O["AgentOrchestrator"]
        N1["collect_papers"]
        N2["analyze_papers"]
        N3["generate_hypotheses"]
        N4["design_experiments"]
        N5["implement_experiments"]
        N6["run_experiments"]
        N7["analyze_results"]
        N8["write_paper"]

        O --> N1 --> N2 --> N3 --> N4 --> N5 --> N6 --> N7 --> N8
    end

    subgraph Roles["Role layer (`agentRole`)"]
        R1["collector_curator"]
        R2["reader_evidence_extractor"]
        R3["hypothesis_agent"]
        R4["experiment_designer"]
        R5["implementer"]
        R6["runner"]
        R7["analyst_statistician"]
        R8["paper_writer"]
        R9["reviewer"]
    end

    N1 -. primary role .-> R1
    N2 -. primary role .-> R2
    N3 -. primary role .-> R3
    N4 -. primary role .-> R4
    N5 -. primary role .-> R5
    N6 -. primary role .-> R6
    N7 -. primary role .-> R7
    N8 -. drafting .-> R8
    N8 -. review .-> R9
```

### Execution Graph

```mermaid
stateDiagram-v2
    [*] --> collect_papers
    collect_papers --> analyze_papers: approve
    analyze_papers --> generate_hypotheses: approve
    generate_hypotheses --> design_experiments: approve
    design_experiments --> implement_experiments: approve
    implement_experiments --> run_experiments: auto_handoff or approve
    run_experiments --> analyze_results: approve
    analyze_results --> write_paper: advance or approve
    analyze_results --> implement_experiments: backtrack_to_implement
    analyze_results --> design_experiments: backtrack_to_design
    analyze_results --> generate_hypotheses: backtrack_to_hypotheses
    analyze_results --> manual_review: pause_for_human
    manual_review --> analyze_results: retry or jump
    write_paper --> [*]: approve
```

Default `agent_approval` mode pauses after every node. `implement_experiments` is the one forward step that can skip its pause through automatic handoff to `run_experiments`, and `analyze_results` is the node that can explicitly redirect the graph backward.

| Graph node | Primary role(s) | Current implementation shape |
| --- | --- | --- |
| `collect_papers` | `collector_curator` | Semantic Scholar search, de-duplication, enrichment, and BibTeX generation |
| `analyze_papers` | `reader_evidence_extractor` | ranked paper selection plus local or Responses API PDF analysis |
| `generate_hypotheses` | `hypothesis_agent` | staged evidence-axis -> draft -> review -> selection pipeline |
| `design_experiments` | `experiment_designer` | candidate design generation and `experiment_plan.yaml` selection |
| `implement_experiments` | `implementer` | `ImplementSessionManager`, localization, Codex patching, verification, and optional handoff |
| `run_experiments` | `runner` | ACI preflight/tests/command execution, metrics capture, and verifier feedback |
| `analyze_results` | `analyst_statistician` | objective evaluation, result synthesis, and transition recommendation |
| `write_paper` | `paper_writer`, `reviewer` | `PaperWriterSessionManager`, outline/draft/review/finalize stages, optional LaTeX repair |

The role catalog is broader than the concrete runtime wiring. Today the deepest multi-turn session managers are `implement_experiments` and `write_paper`, while the earlier nodes mainly use structured node handlers plus role-specific prompts and events.

### Artifact Flow

```mermaid
flowchart TB
    A["collect_papers"] --> A1["collect_request.json<br/>collect_result.json<br/>collect_enrichment.jsonl<br/>corpus.jsonl<br/>bibtex.bib"]
    A1 --> B["analyze_papers"]
    B --> B1["analysis_manifest.json<br/>paper_summaries.jsonl<br/>evidence_store.jsonl"]
    B1 --> C["generate_hypotheses"]
    C --> C1["hypotheses.jsonl<br/>hypothesis_generation/evidence_axes.json<br/>hypothesis_generation/selection.json<br/>hypothesis_generation/drafts.jsonl<br/>hypothesis_generation/reviews.jsonl"]
    C1 --> D["design_experiments"]
    D --> D1["experiment_plan.yaml"]
    D1 --> E["implement_experiments"]
    E --> F["run_experiments"]
    F --> F1["exec_logs/run_experiments.txt<br/>exec_logs/observations.jsonl<br/>metrics.json<br/>objective_evaluation.json<br/>run_experiments_verify_report.json"]
    F1 --> G["analyze_results"]
    G --> G1["result_analysis.json<br/>result_analysis_synthesis.json<br/>transition_recommendation.json<br/>figures/performance.svg"]
    G1 --> H["write_paper"]
    H --> H1["paper/main.tex<br/>paper/references.bib<br/>paper/evidence_links.json<br/>paper/draft.json<br/>paper/validation.json<br/>paper/main.pdf (optional)"]
```

All run artifacts live under `.autolabos/runs/<run_id>/`, which makes the pipeline inspectable from both the TUI and the local web UI.

### Control Surfaces

```mermaid
flowchart TB
    TUI["Slash-first TUI<br/>/new + /agent + /model + /doctor"] --> Session["Interaction session"]
    Web["Local Web Ops UI<br/>onboarding + dashboard + composer + artifact browser"] --> Session
    Natural["Natural-language routing<br/>deterministic first, LLM fallback second"] --> Session

    Session --> Runtime["Shared runtime<br/>run store + checkpoint store + event stream + orchestrator"]
    Runtime --> Nodes["8-node workflow execution"]
    Runtime --> Artifacts["Run artifacts<br/>.autolabos/runs/<run_id>"]
    Runtime --> State["Run state and memory<br/>context + episodes + long-term store"]

    Artifacts --> Web
    State --> TUI
```

### Concrete Agent Runtime

```mermaid
flowchart LR
    UI["CLI / TUI / Web UI"] --> Session["InteractionSession / web composer"]
    Session --> Orchestrator["AgentOrchestrator"]
    Orchestrator --> Runtime["StateGraphRuntime"]
    Runtime --> Registry["DefaultNodeRegistry"]
    Runtime --> Stores["RunStore + CheckpointStore + EventStream"]

    Registry --> Collect["collect_papers"]
    Registry --> Analyze["analyze_papers"]
    Registry --> Hyp["generate_hypotheses"]
    Registry --> Design["design_experiments"]
    Registry --> Impl["implement_experiments"]
    Registry --> Run["run_experiments"]
    Registry --> Results["analyze_results"]
    Registry --> Paper["write_paper"]

    Collect --> Scholar["Semantic Scholar + enrichment"]
    Analyze --> Pdf["Local text/image PDF analysis or Responses API PDF"]
    Hyp --> ToT["ToT-style branching + staged review"]
    Design --> ToT

    Impl --> ImplMgr["ImplementSessionManager"]
    ImplMgr --> Localizer["ImplementationLocalizer"]
    ImplMgr --> Codex["Codex CLI session"]
    ImplMgr --> ACI["Local ACI"]
    ImplMgr --> Reflex["EpisodeMemory + LongTermStore"]

    Run --> ACI
    Run --> Verify["Metrics + verifier report"]
    Verify -. feedback loop .-> ImplMgr

    Results --> Synthesis["Objective evaluation + analysis synthesis + transition recommendation"]

    Paper --> PaperMgr["PaperWriterSessionManager"]
    PaperMgr --> Writer["paper_writer"]
    PaperMgr --> Reviewer["reviewer"]
    PaperMgr --> Codex
    PaperMgr --> LLM["OpenAI / Codex LLM"]
    PaperMgr --> Latex["Optional LaTeX compile + repair"]
```

Key source areas:

- `src/runtime/createRuntime.ts`: wires config, providers, stores, event stream, runtime, and orchestrator
- `src/interaction/*`: shared command/session layer used by the TUI and the web composer
- `src/core/stateGraph/*`: node execution, retries, approvals, budgets, jumps, and checkpoints
- `src/core/nodes/*`: the 8 workflow handlers and their artifact-writing logic
- `src/integrations/*` and `src/tools/*`: provider clients, Semantic Scholar access, and local execution adapters
- `src/web/*` and `web/src/*`: local HTTP server plus browser UI on top of the same runtime

## Most-Used Commands

| Command | Description |
| --- | --- |
| `/new` | Create a run |
| `/runs [query]` | List or search runs |
| `/run <run>` | Select a run |
| `/resume <run>` | Resume a run |
| `/agent collect [query] [options]` | Collect papers with filters, sort, and bibliographic options |
| `/agent run <node> [run]` | Execute from a graph node |
| `/agent status [run]` | Show node statuses |
| `/agent graph [run]` | Show graph state |
| `/agent resume [run] [checkpoint]` | Resume from the latest or a specific checkpoint |
| `/agent retry [node] [run]` | Retry a node |
| `/agent jump <node> [run] [--force]` | Jump between nodes |
| `/agent budget [run]` | Show budget usage |
| `/model` | Open model and reasoning selector |
| `/settings` | Edit defaults |
| `/doctor` | Run environment checks |

Common collection options:

- `--run <run_id>`
- `--limit <n>`
- `--additional <n>`
- `--last-years <n>`
- `--year <spec>`
- `--date-range <start:end>`
- `--sort <relevance|citationCount|publicationDate|paperId>`
- `--order <asc|desc>`
- `--field <csv>`
- `--venue <csv>`
- `--type <csv>`
- `--min-citations <n>`
- `--open-access`
- `--bibtex <generated|s2|hybrid>`
- `--dry-run`

Examples:

- `/agent collect --last-years 5 --sort relevance --limit 100`
- `/agent collect "agent planning" --sort citationCount --order desc --min-citations 100`
- `/agent collect --additional 200 --run <run_id>`

## Natural-Language Control

AutoLabOS does not try to support every sentence with hard-coded rules. Instead, it defines deterministic intent families and routes those locally before falling back to the workspace-grounded LLM.

Ask this inside the TUI to see the live supported list:

- `what natural inputs are supported?`

Typical examples:

- `create a new run`
- `collect 100 papers from the last 5 years by relevance`
- `show current status`
- `jump back to collect_papers`
- `how many papers were collected?`

Multi-step natural-language plans pause between steps:

- `y`: run only the next step
- `a`: run all remaining steps without pausing again
- `n`: cancel the remaining plan

Implementation references:

- Deterministic routing: [src/core/commands/naturalDeterministic.ts](./src/core/commands/naturalDeterministic.ts)
- Local status / next-step assistant: [src/core/commands/naturalAssistant.ts](./src/core/commands/naturalAssistant.ts)

<details>
<summary>Full slash command list</summary>

| Command | Description |
| --- | --- |
| `/help` | Show command list |
| `/new` | Create run |
| `/doctor` | Environment checks |
| `/runs [query]` | List or search runs |
| `/run <run>` | Select run |
| `/resume <run>` | Resume run |
| `/agent list` | List graph nodes |
| `/agent run <node> [run]` | Execute from node |
| `/agent status [run]` | Show node statuses |
| `/agent collect [query] [options]` | Collect papers with filters, sort, and options |
| `/agent recollect <n> [run]` | Backward-compatible alias for additional collection |
| `/agent focus <node>` | Move focus to node with a safe jump |
| `/agent graph [run]` | Show graph state |
| `/agent resume [run] [checkpoint]` | Resume from latest or specific checkpoint |
| `/agent retry [node] [run]` | Retry node |
| `/agent jump <node> [run] [--force]` | Jump node |
| `/agent budget [run]` | Show budget usage |
| `/model` | Open arrow-key selector for model and reasoning effort |
| `/approve` | Approve current node |
| `/retry` | Retry current node |
| `/settings` | Edit defaults |
| `/quit` | Exit |

</details>

<details>
<summary>Supported natural-language intent families</summary>

1. Help / settings / model / doctor / quit
   - Examples: `show help`, `open model selector`, `run environment checks`
2. Run lifecycle
   - Examples: `create a new run`, `list runs`, `open run alpha`, `resume the previous run`
3. Run title changes
   - Examples: `change the run title to Multi-agent collaboration`
4. Workflow structure / status / next step
   - Examples: `what should I do next?`, `show current status`, `show the workflow`
5. Paper collection
   - Examples: `collect 100 papers from the last 5 years by relevance`
   - Examples: `collect 50 open-access review papers`
   - Examples: `collect 200 more papers`
   - Examples: `clear collected papers, then collect 100 new papers`
6. Node control
   - Examples: `jump back to collect_papers`, `retry the hypothesis node`, `focus on implement_experiments`
7. Graph / budget / approval
   - Examples: `show graph`, `show budget`, `approve current node`, `retry current node`
8. Direct questions about collected papers
   - Examples: `how many papers were collected?`
   - Examples: `how many papers are missing PDF paths?`
   - Examples: `what is the top-cited paper?`
   - Examples: `show 3 paper titles`

</details>

<details>
<summary>Runtime defaults, storage, and execution details</summary>

### State Graph

Fixed graph nodes:

1. `collect_papers`
2. `analyze_papers`
3. `generate_hypotheses`
4. `design_experiments`
5. `implement_experiments`
6. `run_experiments`
7. `analyze_results`
8. `write_paper`

### Runtime Policies

- Checkpoints: `.autolabos/runs/<run_id>/checkpoints/`
- Checkpoint phases: `before | after | fail | jump | retry`
- Retry policy: `maxAttemptsPerNode=3`
- Auto rollback policy: `maxAutoRollbacksPerNode=2`
- Jump modes:
  - `safe`: only current or previous node
  - `force`: forward jumps allowed and skipped nodes are recorded
- Budget policy:
  - `maxToolCalls=150`
  - `maxWallClockMinutes=240`
  - `maxUsd=15` (soft-check if provider cost is unavailable)

### Agent Runtime Patterns

- ReAct loop: `PLAN_CREATED -> TOOL_CALLED -> OBS_RECEIVED`
- ReWOO split (planner/worker): used for high-cost nodes
- ToT (Tree-of-Thoughts): used in hypothesis and design nodes
- Reflexion: failure episodes are stored and reused on retries

### Memory Layers

- Run context memory: per-run short-term state
- Long-term store: JSONL summary and index history
- Episode memory: Reflexion failure lessons

### ACI (Agent-Computer Interface)

Standard actions:

- `read_file`
- `write_file`
- `apply_patch`
- `run_command`
- `run_tests`
- `tail_logs`

`implement_experiments` and `run_experiments` are executed via ACI.

### Command Palette

- Type `/`: open command list
- `Tab`: autocomplete
- `Up/Down`: navigate candidates
- `Enter`: execute
- Run suggestions include `run_id + title + current_node + status + relative time`
- When the input is empty, the TUI shows context-aware next actions with exact commands and natural-language examples
- The next-actions panel now expands into a broader state-aware action catalog: run, status, graph, budget, count, jump, and natural-language queries
- Empty-input guidance follows the user's recent language or OS locale, and `Tab` fills the first suggested action

### Run Metadata

`runs.json` stores:

- `version: 3`
- `workflowVersion: 3`
- `currentNode`
- `graph` (`RunGraphState`)
- `nodeThreads` (`Partial<Record<GraphNodeId, string>>`)
- `memoryRefs` (`runContextPath`, `longTermPath`, `episodePath`)

Legacy runs are auto-migrated to v3 on load.

### Generated Paths

- `.autolabos/config.yaml`
- `.autolabos/runs/runs.json`
- `.autolabos/runs/<run_id>/checkpoints/*`
- `.autolabos/runs/<run_id>/memory/*`
- `.autolabos/runs/<run_id>/paper/*`

</details>

## Development

```bash
npm run build
npm test
npm run test:smoke:all
npm run test:smoke:natural-collect
npm run test:smoke:natural-collect-execute
npm run test:smoke:ci
```

Smoke test notes:

- Smoke harness files live under `tests/smoke/`.
- The manual example workspace stays under `/test`.
- Smoke uses an isolated workspace under `/test/smoke-workspace` so it does not overwrite root `/test` example state.
- `test:smoke:natural-collect` verifies natural-language collect request -> pending `/agent collect ...` command.
- `test:smoke:natural-collect-execute` verifies natural-language collect request -> `y` execute -> collect artifacts created.
- `test:smoke:all` runs the full local smoke bundle in `/test/smoke-workspace`.
- Smoke uses `AUTOLABOS_FAKE_CODEX_RESPONSE` to avoid live Codex calls.
- Execute smoke also uses `AUTOLABOS_FAKE_SEMANTIC_SCHOLAR_RESPONSE`.
- `test:smoke:ci` runs CI-mode smoke selection.
  - Default mode: `pending`
  - Additional modes: `execute`, `composite`, `composite-all`, `llm-composite`, `llm-composite-all`, `llm-replan`
  - Set `AUTOLABOS_SMOKE_MODE=<mode>` or `AUTOLABOS_SMOKE_MODE=all` to switch CI scenarios.
- Smoke output is quiet by default. Set `AUTOLABOS_SMOKE_VERBOSE=1` to print full PTY logs.
