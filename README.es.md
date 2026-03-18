<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Un sistema operativo para investigación autónoma</h1>

  <p><strong>Ejecución autónoma de investigación, no solo generación de texto.</strong><br/>
  Desde la literatura hasta el manuscrito, dentro de un bucle gobernado, checkpointed e inspeccionable.</p>

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

  <p><sub>Este README es una traducción resumida. Para el detalle técnico completo, usa <a href="./README.md">English README</a> como referencia canónica.</sub></p>

</div>

---

La mayoría de las herramientas que dicen automatizar la investigación en realidad automatizan la **generación de texto**. Producen resultados pulidos, pero sin gobernanza experimental, sin trazabilidad de evidencia y sin límites honestos sobre lo que la evidencia realmente sostiene.

AutoLabOS toma otra postura. **La parte difícil de investigar no es escribir, sino la disciplina entre la pregunta y el borrador.** Base bibliográfica, prueba de hipótesis, gobernanza experimental, memoria de fallos, techo de afirmaciones y compuertas de revisión ocurren dentro de un grafo fijo de 9 nodos.

> Evidencia primero. Afirmaciones después.

## Qué obtienes después de una ejecución

- Corpus bibliográfico, BibTeX y almacén de evidencia
- Hipótesis basadas en literatura con revisión escéptica
- Plan experimental con baseline bloqueado
- Resultados ejecutados, métricas y memoria de fallos
- Análisis de resultados, decisiones de transición y paquete de revisión
- Manuscrito con enlaces a evidencia, PDF y checkpoints por nodo

Todo queda bajo `.autolabos/runs/<run_id>/` y los artefactos públicos se reflejan en `outputs/`.

## Inicio rápido

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# o
autolabos
```

### Requisitos previos

- `SEMANTIC_SCHOLAR_API_KEY`: siempre
- `OPENAI_API_KEY`: cuando el provider o el modo PDF sea `api`
- Inicio de sesión en Codex CLI: cuando el provider o el modo PDF sea `codex`

## Flujo de 9 nodos

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

Si los resultados son débiles, el sistema retrocede hacia hipótesis o diseño en lugar de seguir escribiendo. Toda automatización vive dentro de bucles internos acotados.

## Propiedades clave

- **Gobernanza experimental**: contratos que fijan hipótesis, mecanismo causal, cambio único y criterio de aborto
- **Techo de afirmaciones**: `review` produce la afirmación más fuerte defendible y las brechas de evidencia
- **Memoria de fallos**: agrupa errores equivalentes y evita repetir intentos inútiles
- **Evaluación de paper en dos capas**: puerta mínima determinista + evaluador LLM
- **Panel de 5 especialistas**: revisión independiente de claims, método, estadística, escritura e integridad

## Interfaces y modos

- `autolabos`: TUI centrada en terminal
- `autolabos web`: Web Ops UI local

Modos:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## Desarrollo

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

Documentos principales:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>Construido para investigadores que quieren experimentos gobernados y afirmaciones defendibles.</sub>
</div>
