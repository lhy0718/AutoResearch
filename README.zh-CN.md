<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>面向自主科研的操作系统</h1>

  <p><strong>不是研究文本生成，而是自主科研执行。</strong><br/>
  从文献到论文稿件，全部运行在受治理、可检查点恢复、可审计的闭环中。</p>

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

  <p><sub>此 README 为概览翻译版。最完整的技术说明请以 <a href="./README.md">English README</a> 为准。</sub></p>

</div>

---

很多号称“自动化科研”的工具，本质上只是自动化了**文本生成**。它们能产出看起来不错的内容，但没有实验治理、没有证据追踪，也没有对“证据究竟支持到什么程度”进行诚实约束。

AutoLabOS 采取的是另一种路线。**科研真正困难的地方不是写作，而是问题到草稿之间的纪律。** 文献扎根、假设检验、实验治理、失败追踪、主张上限和评审闸门，全部都在固定的 9 节点状态图中完成。

> 先看证据，再下主张。

## 一次运行之后你会得到什么

- 文献语料、BibTeX 与证据存储
- 基于文献的假设与怀疑性评审
- 带基线锁定的实验计划
- 执行结果、指标与失败记忆
- 结果分析、迁移决策与评审包
- 带证据链接的论文草稿、PDF 与节点检查点

所有运行状态都保存在 `.autolabos/runs/<run_id>/`，对外输出镜像到 `outputs/`。

## 快速开始

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# 或
autolabos
```

### 前置条件

- `SEMANTIC_SCHOLAR_API_KEY`: 始终需要
- `OPENAI_API_KEY`: 当 provider 或 PDF mode 为 `api`
- Codex CLI 登录: 当 provider 或 PDF mode 为 `codex`

## 9 节点工作流

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

如果结果不足，系统会回退到假设或实验设计，而不是继续把文字写得更漂亮。所有自动化都被限制在边界明确的节点内部循环里。

## 核心特性

- **实验治理**: 用契约锁定假设、因果机制、单变量变更规则和中止条件
- **主张上限**: `review` 输出当前证据下最强可辩护主张与证据缺口
- **失败记忆**: 对等价失败做指纹聚类，避免重复试错
- **双层论文评估**: 确定性最低门槛 + LLM 论文质量评估
- **五位专家评审面板**: 主张、方法、统计、写作和完整性独立打分

## 界面与运行模式

- `autolabos`: 终端优先 TUI
- `autolabos web`: 本地 Web Ops UI

运行模式:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## 开发

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

关键文档:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>为那些希望实验受治理、主张可辩护的研究者而构建。</sub>
</div>
