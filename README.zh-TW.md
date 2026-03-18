<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>面向自主研究的作業系統</h1>

  <p><strong>不是研究內容生成，而是自主研究執行。</strong><br/>
  從文獻到論文草稿，全部都在受治理、可檢查點恢復、可審視的迴圈中進行。</p>

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

  <p><sub>此 README 為概覽翻譯。最完整的技術說明請以 <a href="./README.md">English README</a> 為準。</sub></p>

</div>

---

許多宣稱能自動化研究的工具，實際上只是在自動化**文字生成**。它們可以產出看似精美的內容，但缺乏實驗治理、證據追蹤，以及對證據支持範圍的誠實約束。

AutoLabOS 採取不同立場。**研究最困難的部分不是寫作，而是問題與草稿之間的紀律。** 文獻基礎、假設驗證、實驗治理、失敗追蹤、主張上限與審查關卡，全都放在固定的 9 節點狀態圖裡處理。

> 先有證據，再談主張。

## 執行後會得到什麼

- 文獻語料、BibTeX 與證據儲存
- 以文獻為基礎的假設與懷疑式審查
- 含基線鎖定的實驗計畫
- 執行結果、指標與失敗記憶
- 結果分析、遷移決策與審查封包
- 含證據連結的論文草稿、PDF 與節點檢查點

所有執行狀態都保存在 `.autolabos/runs/<run_id>/`，對外輸出則鏡像到 `outputs/`。

## 快速開始

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# 或
autolabos
```

### 前置需求

- `SEMANTIC_SCHOLAR_API_KEY`: 永遠需要
- `OPENAI_API_KEY`: 當 provider 或 PDF mode 為 `api`
- Codex CLI 登入: 當 provider 或 PDF mode 為 `codex`

## 9 節點工作流程

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

若結果不足，系統會回退到假設或設計，而不是繼續往包裝文字的方向前進。所有自動化都被限制在邊界明確的節點內部循環中。

## 核心特性

- **實驗治理**: 以契約鎖定假設、因果機制、單一變更規則與中止條件
- **主張上限**: `review` 輸出目前證據下最強可辯護主張與證據缺口
- **失敗記憶**: 對等價失敗做指紋化，避免重複試錯
- **雙層論文評估**: 決定性最低門檻 + LLM 論文品質評估
- **五位專家審查面板**: 對主張、方法、統計、寫作與完整性分別評估

## 介面與執行模式

- `autolabos`: 終端優先 TUI
- `autolabos web`: 本機 Web Ops UI

執行模式:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## 開發

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

主要文件:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>為那些希望實驗受治理、主張可被辯護的研究者而打造。</sub>
</div>
