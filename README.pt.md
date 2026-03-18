<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Um sistema operacional para pesquisa autônoma</h1>

  <p><strong>Execução autônoma de pesquisa, não apenas geração de texto.</strong><br/>
  Da literatura ao manuscrito, dentro de um loop governado, com checkpoints e auditável.</p>

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

  <p><sub>Este README é uma tradução resumida. Para o detalhe técnico completo, use o <a href="./README.md">README em inglês</a> como referência canônica.</sub></p>

</div>

---

A maioria das ferramentas que dizem automatizar pesquisa, na prática, automatiza apenas **geração de texto**. Elas produzem saídas polidas, mas sem governança experimental, sem rastreamento de evidência e sem disciplina honesta sobre o que a evidência realmente sustenta.

AutoLabOS toma outra posição. **A parte difícil da pesquisa não é escrever, e sim a disciplina entre a pergunta e o rascunho.** Fundamentação bibliográfica, teste de hipóteses, governança experimental, memória de falhas, teto de alegações e gate de revisão acontecem dentro de um grafo fixo de 9 nós.

> Evidência primeiro. Alegações depois.

## O que você recebe após uma execução

- Corpus de literatura, BibTeX e armazenamento de evidência
- Hipóteses fundamentadas na literatura com revisão cética
- Plano experimental com baseline travada
- Resultados executados, métricas e memória de falhas
- Análise de resultados, decisões de transição e pacote de revisão
- Manuscrito com links para evidência, PDF e checkpoints por nó

Todo o estado da execução fica em `.autolabos/runs/<run_id>/`, com saídas públicas espelhadas em `outputs/`.

## Início rápido

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# ou
autolabos
```

### Pré-requisitos

- `SEMANTIC_SCHOLAR_API_KEY`: sempre necessário
- `OPENAI_API_KEY`: quando o provider ou o modo PDF for `api`
- Login no Codex CLI: quando o provider ou o modo PDF for `codex`

## Fluxo de 9 nós

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

Se os resultados forem fracos, o sistema volta para hipóteses ou design em vez de seguir adiante para uma escrita otimista. Toda automação vive dentro de loops internos delimitados.

## Propriedades principais

- **Governança experimental**: contratos travam hipótese, mecanismo causal, regra de mudança única e condição de aborto
- **Teto de alegações**: `review` produz a alegação mais forte defensável e as lacunas de evidência
- **Memória de falhas**: agrupa erros equivalentes e evita repetição inútil
- **Avaliação de paper em duas camadas**: gate mínimo determinístico + avaliador LLM
- **Painel de 5 especialistas**: revisão independente de claims, método, estatística, escrita e integridade

## Interfaces e modos

- `autolabos`: TUI centrada no terminal
- `autolabos web`: Web Ops UI local

Modos:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## Desenvolvimento

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

Documentos principais:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>Feito para pesquisadores que querem experimentos governados e alegações defensáveis.</sub>
</div>
