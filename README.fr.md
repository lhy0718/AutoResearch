<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Un système d'exploitation pour la recherche autonome</h1>

  <p><strong>Exécution autonome de la recherche, pas seulement génération de texte.</strong><br/>
  De la littérature au manuscrit, dans une boucle gouvernée, checkpointée et inspectable.</p>

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

  <p><sub>Ce README est une traduction synthétique. Pour le détail technique complet, utilisez le <a href="./README.md">README anglais</a> comme référence canonique.</sub></p>

</div>

---

La plupart des outils qui prétendent automatiser la recherche automatisent en réalité la **génération de texte**. Ils produisent des sorties convaincantes, mais sans gouvernance expérimentale, sans traçabilité des preuves et sans discipline honnête sur ce que les preuves permettent réellement d'affirmer.

AutoLabOS adopte une autre position. **La partie difficile de la recherche n'est pas l'écriture, mais la discipline entre la question et le brouillon.** Ancrage bibliographique, test d'hypothèses, gouvernance expérimentale, mémoire des échecs, plafond des revendications et porte de revue sont intégrés dans un graphe d'état fixe à 9 nœuds.

> Les preuves d'abord. Les affirmations ensuite.

## Ce que vous obtenez après une exécution

- Corpus de littérature, BibTeX et stockage de preuves
- Hypothèses fondées sur la littérature avec revue sceptique
- Plan expérimental avec baseline verrouillée
- Résultats exécutés, métriques et mémoire des échecs
- Analyse des résultats, décisions de transition et dossier de revue
- Manuscrit avec liens vers les preuves, PDF et checkpoints par nœud

Tout est stocké dans `.autolabos/runs/<run_id>/`, avec les sorties publiques répliquées dans `outputs/`.

## Démarrage rapide

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# ou
autolabos
```

### Prérequis

- `SEMANTIC_SCHOLAR_API_KEY` : toujours requis
- `OPENAI_API_KEY` : si le provider ou le mode PDF est `api`
- Connexion Codex CLI : si le provider ou le mode PDF est `codex`

## Workflow à 9 nœuds

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

Si les résultats sont insuffisants, le système revient vers les hypothèses ou le design au lieu d'avancer vers une rédaction trop optimiste. Toute l'automatisation reste bornée à l'intérieur des nœuds.

## Propriétés clés

- **Gouvernance expérimentale** : des contrats figent hypothèse, mécanisme causal, règle de changement unique et critère d'arrêt
- **Plafond des affirmations** : `review` produit l'affirmation la plus forte défendable et les écarts de preuve
- **Mémoire des échecs** : regroupe les erreurs équivalentes et évite les répétitions inutiles
- **Évaluation d'article en deux couches** : seuil minimal déterministe + évaluateur LLM
- **Panel de 5 spécialistes** : revue indépendante des claims, de la méthode, des statistiques, de l'écriture et de l'intégrité

## Interfaces et modes

- `autolabos` : TUI orientée terminal
- `autolabos web` : interface Web Ops locale

Modes :

- Interactive
- Minimal approval
- Overnight
- Autonomous

## Développement

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

Documents principaux :

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>Conçu pour les chercheurs qui veulent des expériences gouvernées et des affirmations défendables.</sub>
</div>
