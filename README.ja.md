<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>自律研究のためのオペレーティングシステム</h1>

  <p><strong>研究生成ではなく、自律研究の実行。</strong><br/>
  文献収集から原稿作成までを、統制され、チェックポイント可能で、検証可能なループの中で進めます。</p>

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

  <p><sub>この README は概要翻訳です。最も詳細な技術仕様は <a href="./README.md">English README</a> を基準文書として参照してください。</sub></p>

</div>

---

研究の自動化をうたう多くのツールは、実際には**テキスト生成**を自動化しているだけです。見栄えの良い成果物は出せても、実験ガバナンス、証拠追跡、主張と証拠の整合性が欠けています。

AutoLabOS は別の立場を取ります。**研究で難しいのは文章を書くことではなく、問いと草稿の間に必要な規律です。** 文献基盤、仮説検証、実験ガバナンス、失敗追跡、主張上限、レビューゲートを固定の 9 ノード状態グラフの中で扱います。

> Evidence first. Claims second.

## 実行後に得られるもの

- 文献コーパス、BibTeX、証拠ストア
- 文献に基づく仮説と懐疑的レビュー
- ベースライン固定付きの実験計画
- 実行結果、指標、失敗メモリ
- 結果分析、遷移判断、レビュー・パケット
- 証拠リンク付き原稿、PDF、各ノードのチェックポイント

すべての実行状態は `.autolabos/runs/<run_id>/` に保存され、公開向け成果物は `outputs/` にミラーされます。

## クイックスタート

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# または
autolabos
```

### 前提条件

- `SEMANTIC_SCHOLAR_API_KEY`: 常に必要
- `OPENAI_API_KEY`: provider または PDF mode が `api` の場合
- Codex CLI ログイン: provider または PDF mode が `codex` の場合

## 9 ノードワークフロー

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

結果が弱ければ前進せず、仮説や設計段階へバックトラックします。自動化はすべて境界が明示されたノード内部ループに限定されます。

## コア特性

- **実験ガバナンス**: 仮説、因果メカニズム、単一変更規則、中止条件を契約として固定
- **主張上限**: `review` が防御可能な最強の主張と未充足の証拠ギャップを出力
- **失敗メモリ**: 同等失敗を指紋化し、無意味な再試行を停止
- **二層の論文評価**: 決定的な最小ゲート + LLM 品質評価
- **5 名の専門家レビュー**: 主張、方法論、統計、文章、完全性を独立評価

## インターフェースと実行モード

- `autolabos`: ターミナル中心の TUI
- `autolabos web`: ローカル Web Ops UI

実行モード:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## 開発

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

主要ドキュメント:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>実験は統制され、主張は防御可能であるべきだと考える研究者のために。</sub>
</div>
