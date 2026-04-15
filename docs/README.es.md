<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Un sistema operativo para investigación autónoma</h1>

  <p><strong>No generación de investigación, sino ejecución autónoma de investigación.</strong><br/>
  De un brief a un manuscrito, dentro de una ejecución governed, checkpointed e inspectable.</p>

  <p>
    <a href="../README.md"><strong>English</strong></a>
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

  <p><sub>Los README localizados son traducciones mantenidas de este documento. Para el texto normativo y las ediciones más recientes, usa el README en inglés como canonical reference.</sub></p>

  <p>
    <a href="https://github.com/lhy0718/AutoLabOS/actions/workflows/ci.yml">
      <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/lhy0718/AutoLabOS/ci.yml?branch=main&style=flat-square&label=ci&logo=githubactions&logoColor=white" />
    </a>
    <a href="https://github.com/lhy0718/AutoLabOS/actions/workflows/smoke.yml">
      <img alt="Smoke" src="https://img.shields.io/github/actions/workflow/status/lhy0718/AutoLabOS/smoke.yml?branch=main&style=flat-square&label=smoke&logo=githubactions&logoColor=white" />
    </a>
    <img alt="Tests" src="https://img.shields.io/badge/tests-validated-22C55E?style=flat-square&logo=vitest&logoColor=white" />
  </p>

  <p>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" />
  </p>

  <p>
    <img alt="Governed workflow" src="https://img.shields.io/badge/workflow-governed%20with%20figure_audit-0F766E?style=flat-square" />
    <img alt="Checkpointed" src="https://img.shields.io/badge/checkpoints-built%20in-0F766E?style=flat-square" />
    <img alt="Claim Ceiling" src="https://img.shields.io/badge/claims-ceiling%20enforced-0F766E?style=flat-square" />
    <img alt="Validation surfaces" src="https://img.shields.io/badge/validation-first--class-0F766E?style=flat-square" />
  </p>

</div>

---

AutoLabOS es un sistema operativo para la ejecución governed de investigación. Trata una corrida como estado de investigación checkpointed, no como una generación puntual.

Todo el bucle central es inspectable. Recolección de literatura, formulación de hipótesis, diseño experimental, implementación, ejecución, análisis, figure audit, review y escritura del manuscrito dejan artifacts auditables. Las afirmaciones permanecen evidence-bounded bajo un claim ceiling. Review no es una etapa de pulido, sino un structural gate.

Los supuestos de calidad se convierten en checks explícitos. Importa más el comportamiento real que la apariencia a nivel de prompt. La reproducibilidad se refuerza mediante artifacts, checkpoints e inspectable transitions.

---

## Por qué existe AutoLabOS

Muchos sistemas de research agents están optimizados para producir texto. AutoLabOS está optimizado para ejecutar un proceso de investigación gobernado.

Esa diferencia importa cuando un proyecto necesita algo más que un borrador convincente.

- un research brief que funciona como contrato de ejecución
- workflow gates explícitos en lugar de deriva abierta de agentes
- checkpoints y artifacts que pueden inspeccionarse después
- review capaz de detener trabajo débil antes de generar el manuscrito
- failure memory para no repetir ciegamente el mismo experimento fallido
- evidence-bounded claims, no prose que supere a los datos

AutoLabOS está pensado para equipos que quieren autonomía sin renunciar a auditabilidad, backtracking y validation.

---

## Qué ocurre en una corrida

Una corrida governed sigue siempre el mismo arco de investigación.

`Brief.md` → literature → hypothesis → experiment design → implementation → execution → analysis → figure audit → review → manuscript

En la práctica:

1. `/new` crea o abre el research brief
2. `/brief start --latest` valida el brief, lo snapshot dentro de la corrida e inicia un run governed
3. el sistema avanza por el workflow fijo y checkpointa estado y artifacts en cada frontera
4. si la evidencia es débil, el sistema hace backtracking o downgrade en lugar de pulir el texto
5. solo si pasa el review gate, `write_paper` redacta el manuscrito a partir de evidencia acotada

El contrato histórico de 9 nodos sigue siendo la línea base arquitectónica. En el runtime actual, `figure_audit` es el checkpoint adicional aprobado entre `analyze_results` y `review`, para que la crítica de figuras pueda checkpointarse y reanudarse de forma independiente.

```mermaid
stateDiagram-v2
    [*] --> collect_papers
    collect_papers --> analyze_papers: complete
    analyze_papers --> generate_hypotheses: complete
    generate_hypotheses --> design_experiments: complete
    design_experiments --> implement_experiments: complete
    implement_experiments --> run_experiments: auto_handoff or complete
    run_experiments --> analyze_results: complete
    analyze_results --> figure_audit: auto_advance
    analyze_results --> implement_experiments: auto_backtrack_to_implement
    analyze_results --> design_experiments: auto_backtrack_to_design
    analyze_results --> generate_hypotheses: auto_backtrack_to_hypotheses
    figure_audit --> review: auto_advance
    review --> write_paper: auto_advance
    review --> implement_experiments: auto_backtrack_to_implement
    review --> design_experiments: auto_backtrack_to_design
    review --> generate_hypotheses: auto_backtrack_to_hypotheses
    write_paper --> [*]: auto_complete
```

Toda la automatización dentro de ese flujo está acotada a bounded node-internal loops. Incluso en modos no atendidos, el workflow sigue siendo governed.

---

## Qué obtienes después de una corrida

AutoLabOS no produce solo un PDF. Produce un estado de investigación trazable.

| Salida | Qué contiene |
|---|---|
| **Corpus de literatura** | papers recolectados, BibTeX, evidence store extraído |
| **Hipótesis** | hypotheses basadas en literatura y skeptical review |
| **Plan experimental** | governed design con contract, baseline lock y checks de consistencia |
| **Resultados ejecutados** | metrics, objective evaluation, failure memory log |
| **Análisis de resultados** | análisis estadístico, attempt decisions, transition reasoning |
| **Figure audit** | figure lint, caption/reference consistency y vision critique opcional |
| **Review packet** | scorecard del panel de 5 especialistas, claim ceiling, critique previa al borrador |
| **Manuscrito** | borrador LaTeX con evidence links, scientific validation y PDF opcional |
| **Checkpoints** | snapshots completos del estado en cada frontera de nodo, reanudables |

Todo vive bajo `.autolabos/runs/<run_id>/`, con salidas públicas reflejadas en `outputs/`.

Ese es el modelo de reproducibilidad: no estado oculto, sino artifacts, checkpoints e inspectable transitions.

---

## Quick Start

```bash
# 1. Instalar y compilar
npm install
npm run build
npm link

# 2. Ir a tu workspace de investigación
cd /path/to/your-research-workspace

# 3. Lanzar una interfaz
autolabos        # TUI
autolabos web    # Web UI
```

Flujo típico de primer uso:

```bash
/new
/brief start --latest
/doctor
```

Notas:

- si `.autolabos/config.yaml` no existe, ambas interfaces te guían en el onboarding
- no ejecutes AutoLabOS desde la raíz del repositorio; usa un directorio de workspace separado para tu ejecución de investigación
- TUI y Web UI comparten el mismo runtime, los mismos artifacts y los mismos checkpoints

### Requisitos previos

| Elemento | Cuándo se necesita | Notas |
|---|---|---|
| `SEMANTIC_SCHOLAR_API_KEY` | Siempre | Descubrimiento de papers y metadata |
| `OPENAI_API_KEY` | Cuando el provider es `api` | Ejecución con modelos OpenAI API |
| Codex CLI login | Cuando el provider es `codex` | Usa tu sesión local de Codex |

---

## Sistema de Research Brief

El brief no es solo un documento de arranque. Es el governed contract de la corrida.

`/new` crea o abre `Brief.md`. `/brief start --latest` lo valida, lo snapshot dentro del run y arranca la ejecución a partir de ese snapshot. El run registra el source path del brief, el snapshot path y cualquier manuscript format parseado. Así, la provenance del run sigue siendo inspectable incluso si el brief del workspace cambia después.
`Appendix Preferences` ahora puede escribirse con la estructura `Prefer appendix for:` y `Keep in main body:` para que la intención de appendix routing quede explícita dentro del brief contract.

Es decir, el brief no es solo parte del prompt. Es parte del audit trail.

En el contrato actual, `.autolabos/config.yaml` guarda sobre todo valores por defecto de provider/runtime y workspace policy. La intención de investigación de cada run, los evidence bars, las expectativas de baseline, los objetivos de manuscript format y la ruta del manuscript template deben vivir en el Brief. Por eso, el config persistido puede omitir valores por defecto de `research` y algunos campos de manuscript-profile / paper-template.

```bash
/new
/brief start --latest
```

El brief debe cubrir tanto la intención de investigación como las restricciones de gobernanza: topic, objective metric, baseline o comparator, minimum acceptable evidence, disallowed shortcuts y el paper ceiling si la evidencia sigue siendo débil.

<details>
<summary><strong>Secciones del brief y grading</strong></summary>

| Sección | Estado | Propósito |
|---|---|---|
| `## Topic` | Requerida | Definir la pregunta de investigación en 1-3 frases |
| `## Objective Metric` | Requerida | Métrica principal de éxito |
| `## Constraints` | Recomendada | compute budget, límites de dataset, reglas de reproducibilidad |
| `## Plan` | Recomendada | Plan experimental paso a paso |
| `## Target Comparison` | Governance | Comparación frente a un baseline explícito |
| `## Minimum Acceptable Evidence` | Governance | Effect size mínimo, fold count, decision boundary |
| `## Disallowed Shortcuts` | Governance | Atajos que invalidan el resultado |
| `## Paper Ceiling If Evidence Remains Weak` | Governance | Máxima clasificación de paper si la evidencia sigue débil |
| `## Manuscript Format` | Opcional | Número de columnas, presupuesto de páginas, reglas de references / appendix |

| Grado | Significado | ¿Listo para paper-scale? |
|---|---|---|
| `complete` | Core + 4 o más secciones de governance sustantivas | Sí |
| `partial` | Core completo + 2 o más secciones de governance | Avanza con advertencias |
| `minimal` | Solo secciones core | No |

</details>

---

## Dos interfaces, un runtime

AutoLabOS ofrece dos front ends sobre el mismo runtime governed.

| | TUI | Web UI |
|---|---|---|
| Lanzamiento | `autolabos` | `autolabos web` |
| Interacción | slash commands, lenguaje natural | dashboard y composer en navegador |
| Vista de workflow | Progreso de nodos en tiempo real en terminal | governed workflow graph con acciones |
| Artifacts | Inspección por CLI | Inline preview de texto, imágenes y PDFs |
| Superficies operativas | `/watch`, `/queue`, `/explore`, `/doctor` | jobs queue, live watch cards, exploration status, diagnostics |
| Mejor para | Iteración rápida y control directo | Monitoreo visual y navegación de artifacts |

Lo importante es que ambas superficies ven los mismos checkpoints, los mismos runs y los mismos artifacts subyacentes.

---

## Qué hace diferente a AutoLabOS

AutoLabOS está diseñado alrededor de governed execution, no de prompt-only orchestration.

| | Herramientas típicas de investigación | AutoLabOS |
|---|---|---|
| Workflow | Deriva abierta de agentes | Governed fixed graph con review boundaries explícitos |
| State | Efímero | Checkpointed, resumable, inspectable |
| Claims | Tan fuertes como el modelo los escriba | Limitados por evidence y claim ceiling |
| Review | Cleanup pass opcional | Structural gate que puede bloquear la escritura |
| Failures | Se olvidan y se reintentan | Se registran con fingerprint en failure memory |
| Interfaces | Caminos de código separados | TUI y Web comparten un runtime |

Por eso este sistema se entiende mejor como research infrastructure que como paper generator.

---

## Garantías centrales

### Governed Workflow

El workflow es bounded y auditable. El backtracking forma parte del contract. Los resultados que no justifican avanzar se envían de vuelta a hypotheses, design o implementation en vez de convertirse en prose más fuerte.

### Checkpointed Research State

Cada frontera de nodo escribe state inspectable y resumable. La unidad de progreso no es solo el texto producido, sino un run con artifacts, transitions y recoverable state.

### Claim Ceiling

Las claims se mantienen bajo el strongest defensible evidence ceiling. El sistema registra las claims más fuertes que fueron bloqueadas y los evidence gaps necesarios para desbloquearlas.

### Review As A Structural Gate

`review` no es una etapa de limpieza cosmética. Es el structural gate donde se revisan readiness, sanidad metodológica, evidence linkage, writing discipline y reproducibility handoff antes de generar el manuscrito.

### Failure Memory

Los failure fingerprints se persisten para que errores estructurales o equivalent failures repetidos no se reintenten a ciegas.

### Reproducibility Through Artifacts

La reproducibilidad se impone mediante artifacts, checkpoints e inspectable transitions. Incluso los resúmenes públicos se basan en persisted run outputs, no en una segunda fuente de verdad.

---

## Validation y modelo de calidad orientado a harness

AutoLabOS trata las validation surfaces como first-class.

- `/doctor` comprueba environment y workspace readiness antes de iniciar un run

Paper readiness no es una sola impresión producida por un prompt.

- **Layer 1 - deterministic minimum gate** detiene under-evidenced work mediante artifact / evidence-integrity checks explícitos
- **Layer 2 - LLM paper-quality evaluator** añade crítica estructurada sobre methodology, evidence strength, writing structure, claim support y limitations honesty
- **Review packet + specialist panel** deciden si el camino del manuscrito debe advance, revise o backtrack

`paper_readiness.json` puede incluir `overall_score`. Debe leerse como una señal interna de calidad del run, no como un benchmark científico universal. Algunos caminos avanzados de evaluation / self-improvement usan esa señal para comparar runs o candidatos de prompt mutation.

---

## Capacidades avanzadas de Self-Improvement

AutoLabOS incluye caminos de self-improvement acotados, pero no se trata de blind autonomous rewriting. Están limitados por validation y rollback.

### `autolabos meta-harness`

`autolabos meta-harness` construye un context directory en `outputs/meta-harness/<timestamp>/` a partir de recent completed runs y evaluation history.

Puede incluir:

- run events filtrados
- node artifacts como `result_analysis.json` o `review/decision.json`
- `paper_readiness.json`
- `outputs/eval-harness/history.jsonl`
- archivos actuales de `node-prompts/` para el nodo objetivo

El LLM queda instruido por `TASK.md` para responder solo con `TARGET_FILE + unified diff`, y el target queda restringido a `node-prompts/`. En modo apply, el candidato debe pasar validation checks; si falla, se hace rollback y se escribe un audit log. `--no-apply` solo genera el context. `--dry-run` muestra el diff sin cambiar archivos.

### `autolabos evolve`

`autolabos evolve` ejecuta un bounded mutation-and-evaluation loop sobre `.codex` y `node-prompts`.

- soporta `--max-cycles`, `--target skills|prompts|all` y `--dry-run`
- toma la fitness del run desde `paper_readiness.overall_score`
- muta prompts y skills, ejecuta validation y compara fitness entre ciclos
- si aparece regresión, restaura `.codex` y `node-prompts` desde el último good git tag

Es una ruta de self-improvement, pero no una ruta de reescritura repo-wide sin límites.

### Harness Preset Layer

AutoLabOS también tiene built-in harness presets como `base`, `compact`, `failure-aware` y `review-heavy`. Ajustan artifact/context policy, énfasis en failure memory, prompt policy y compression strategy para evaluaciones comparativas, sin cambiar el governed production workflow.

---

## Comandos comunes

| Comando | Descripción |
|---|---|
| `/new` | Crear o abrir `Brief.md` |
| `/brief start <path\|--latest>` | Iniciar investigación desde un brief |
| `/runs [query]` | Listar o buscar runs |
| `/resume <run>` | Reanudar un run |
| `/agent run <node> [run]` | Ejecutar desde un nodo del graph |
| `/agent status [run]` | Mostrar estados de nodos |
| `/agent overnight [run]` | Ejecutar unattended dentro de límites conservadores |
| `/agent autonomous [run]` | Ejecutar bounded research exploration |
| `/watch` | Vista live watch de runs activos y background jobs |
| `/explore` | Mostrar el estado del exploration engine del run activo |
| `/queue` | Mostrar jobs running / waiting / stalled |
| `/doctor` | Diagnostics de environment y workspace |
| `/model` | Cambiar modelo y reasoning effort |

<details>
<summary><strong>Lista completa de comandos</strong></summary>

| Comando | Descripción |
|---|---|
| `/help` | Mostrar lista de comandos |
| `/new` | Crear o abrir `Brief.md` del workspace |
| `/brief start <path\|--latest>` | Iniciar investigación desde el `Brief.md` del workspace o desde un brief dado |
| `/doctor` | Diagnostics de environment + workspace |
| `/runs [query]` | Listar o buscar runs |
| `/run <run>` | Seleccionar run |
| `/resume <run>` | Reanudar run |
| `/agent list` | Listar nodos del graph |
| `/agent run <node> [run]` | Ejecutar desde un nodo |
| `/agent status [run]` | Mostrar estados de nodos |
| `/agent collect [query] [options]` | Recolectar papers |
| `/agent recollect <n> [run]` | Recolectar papers adicionales |
| `/agent focus <node>` | Mover el focus con safe jump |
| `/agent graph [run]` | Mostrar graph state |
| `/agent resume [run] [checkpoint]` | Reanudar desde checkpoint |
| `/agent retry [node] [run]` | Reintentar nodo |
| `/agent jump <node> [run] [--force]` | Saltar a un nodo |
| `/agent overnight [run]` | Overnight autonomy (24h) |
| `/agent autonomous [run]` | Open-ended autonomous research |
| `/model` | Selector de modelo y reasoning |
| `/approve` | Aprobar un nodo pausado |
| `/queue` | Mostrar jobs running / waiting / stalled |
| `/watch` | Live watch de runs activos |
| `/explore` | Mostrar estado del exploration engine |
| `/retry` | Reintentar el nodo actual |
| `/settings` | Configuración de provider y modelo |
| `/quit` | Salir |

</details>

---

## Para quién es / para quién no es

### Buen encaje

- equipos que quieren autonomía sin perder governed workflow
- trabajo de research engineering donde checkpoints y artifacts importan
- proyectos paper-scale o paper-adjacent que requieren disciplina de evidencia
- entornos donde review, traceability y resumability importan tanto como generation

### No es buen encaje

- usuarios que solo quieren un one-shot draft rápido
- workflows que no necesitan artifact trail ni review gates
- proyectos que prefieren free-form agent behavior frente a governed execution
- casos donde basta una simple herramienta de resumen de literatura

---

## Advanced Details

<details>
<summary><strong>Modos de ejecución</strong></summary>

AutoLabOS mantiene el governed workflow y los safety gates en todos los modos.

| Modo | Comando | Comportamiento |
|---|---|---|
| **Interactive** | `autolabos` | TUI con slash commands y approval gates explícitos |
| **Minimal approval** | Config: `approval_mode: minimal` | Autoaprueba transiciones seguras |
| **Hybrid approval** | Config: `approval_mode: hybrid` | Avanza automáticamente en transiciones fuertes y de bajo riesgo; pausa las de riesgo o baja confianza |
| **Overnight** | `/agent overnight [run]` | Ejecución unattended de una sola pasada, límite de 24h, backtracking conservador |
| **Autonomous** | `/agent autonomous [run]` | Open-ended bounded research exploration |

</details>

<details>
<summary><strong>Governance artifact flow</strong></summary>

```mermaid
flowchart LR
    Brief["Research Brief<br/>completeness artifact"] --> Design["design_experiments"]
    Design --> Contract["Experiment Contract<br/>hypothesis, single change,<br/>confound check"]
    Design --> Consistency["Brief-Design Consistency<br/>warnings artifact"]
    Contract --> Run["run_experiments"]
    Run --> Failures["Failure Memory<br/>fingerprinted JSONL"]
    Run --> Analyze["analyze_results"]
    Analyze --> Decision["Attempt Decision<br/>keep/discard/replicate"]
    Decision --> FigureAudit["figure_audit"]
    FigureAudit --> Review["review"]
    Failures --> Review
    Contract --> Review
    Review --> Ceiling["Pre-Review Summary<br/>claim ceiling detail"]
    Ceiling --> Paper["write_paper"]
```

</details>

<details>
<summary><strong>Artifact flow</strong></summary>

```mermaid
flowchart TB
    A["collect_papers"] --> A1["corpus.jsonl, bibtex.bib"]
    A1 --> B["analyze_papers"]
    B --> B1["paper_summaries.jsonl, evidence_store.jsonl"]
    B1 --> C["generate_hypotheses"]
    C --> C1["hypotheses.jsonl"]
    C1 --> D["design_experiments"]
    D --> D1["experiment_plan.yaml, experiment_contract.json,<br/>brief_design_consistency.json"]
    D1 --> E["implement_experiments"]
    E --> F["run_experiments"]
    F --> F1["metrics.json, failure_memory.jsonl,<br/>objective_evaluation.json"]
    F1 --> G["analyze_results"]
    G --> G1["result_analysis.json, attempt_decisions.jsonl,<br/>transition_recommendation.json"]
    G1 --> H["figure_audit"]
    H --> H1["gate1_gate2_issues.json,<br/>figure_audit_summary.json"]
    H1 --> I["review"]
    I --> I1["pre_review_summary.json, review_packet.json,<br/>minimum_gate.json, paper_critique.json"]
    I1 --> J["write_paper"]
    J --> J1["main.tex, references.bib,<br/>scientific_validation.json, main.pdf"]
```

</details>

<details>
<summary><strong>Arquitectura de nodos</strong></summary>

| Nodo | Rol | Qué hace |
|---|---|---|
| `collect_papers` | collector, curator | Descubre y filtra candidate paper sets con Semantic Scholar |
| `analyze_papers` | reader, evidence extractor | Extrae summaries y evidence de los papers seleccionados |
| `generate_hypotheses` | hypothesis agent + skeptical reviewer | Sintetiza ideas desde la literatura y las somete a presión |
| `design_experiments` | designer + feasibility/statistical/ops panel | Filtra planes por viabilidad y escribe el experiment contract |
| `implement_experiments` | implementer | Produce cambios de código y workspace mediante ACI actions |
| `run_experiments` | runner + failure triager + rerun planner | Ejecuta experimentos, registra fallos y decide reruns |
| `analyze_results` | analyst + metric auditor + confounder detector | Comprueba la fiabilidad de resultados y escribe attempt decisions |
| `figure_audit` | figure auditor + optional vision critique | Comprueba evidence alignment, captions / references y publication readiness |
| `review` | 5-specialist panel + claim ceiling + two-layer gate | Realiza structural review y bloquea la escritura si falta evidencia |
| `write_paper` | paper writer + reviewer critique | Redacta el manuscrito, ejecuta post-draft critique y construye el PDF |

</details>

<details>
<summary><strong>Bounded automation</strong></summary>

| Nodo | Automatización interna | Límite |
|---|---|---|
| `analyze_papers` | Autoexpansión de evidence window cuando la evidencia es escasa | <= 2 expansiones |
| `design_experiments` | Deterministic panel scoring + experiment contract | Una vez por diseño |
| `run_experiments` | Failure triage + un rerun transitorio | Nunca reintenta fallos estructurales |
| `run_experiments` | Failure memory fingerprinting | >= 3 fallos idénticos agotan los retries |
| `analyze_results` | Objective rematching + result panel calibration | Un rematch antes de pausa humana |
| `figure_audit` | Gate 3 figure critique + summary aggregation | La vision critique sigue siendo resumable de forma independiente |
| `write_paper` | Related-work scout + validation-aware repair | 1 repair como máximo |

</details>

<details>
<summary><strong>Public output bundle</strong></summary>

```
outputs/<title-slug>-<run_id_prefix>/
  ├── paper/
  ├── experiment/
  ├── analysis/
  ├── review/
  ├── results/
  ├── reproduce/
  ├── manifest.json
  └── README.md
```

</details>

---

## Estado

AutoLabOS es un proyecto OSS activo de research engineering. Las referencias canónicas de comportamiento y contracts están en `docs/`, especialmente:

- `docs/architecture.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

