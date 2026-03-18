<div align="center">

  <br/>

  <img alt="AutoLabOS" src="https://img.shields.io/badge/AutoLabOS-0F766E?style=for-the-badge&logoColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6Ii8%2BPHBhdGggZD0iTTIgMTdsMTAgNSAxMC01Ii8%2BPHBhdGggZD0iTTIgMTJsMTAgNSAxMC01Ii8%2BPC9zdmc%2B" />

  <h1>Операционная система для автономных исследований</h1>

  <p><strong>Автономное выполнение исследований, а не просто генерация текста.</strong><br/>
  От литературы до рукописи, внутри управляемого, checkpoint-ориентированного и проверяемого цикла.</p>

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

  <p><sub>Этот README является кратким переводом. Для полной технической информации используйте <a href="./README.md">английский README</a> как канонический источник.</sub></p>

</div>

---

Большинство инструментов, которые обещают автоматизировать исследования, на деле автоматизируют лишь **генерацию текста**. Они выдают гладкий результат, но без экспериментального governance, без трассировки доказательств и без честного ограничения того, что доказательства действительно поддерживают.

AutoLabOS занимает другую позицию. **Самая сложная часть исследования — не письмо, а дисциплина между вопросом и черновиком.** Опора на литературу, проверка гипотез, управление экспериментами, память о сбоях, потолок утверждений и review-gate работают внутри фиксированного графа из 9 узлов.

> Сначала доказательства. Потом утверждения.

## Что вы получаете после запуска

- Корпус литературы, BibTeX и хранилище доказательств
- Гипотезы на основе литературы и скептическая проверка
- План эксперимента с зафиксированным baseline
- Исполненные результаты, метрики и память о сбоях
- Анализ результатов, решения о переходах и review-пакет
- Рукопись со ссылками на доказательства, PDF и checkpoints по узлам

Все состояние запуска хранится в `.autolabos/runs/<run_id>/`, а публичные результаты зеркалируются в `outputs/`.

## Быстрый старт

```bash
npm install && npm run build && npm link
cd /path/to/your-research-project

autolabos web
# или
autolabos
```

### Предварительные требования

- `SEMANTIC_SCHOLAR_API_KEY`: всегда нужен
- `OPENAI_API_KEY`: если provider или PDF mode равен `api`
- Вход в Codex CLI: если provider или PDF mode равен `codex`

## Рабочий процесс из 9 узлов

`collect_papers` → `analyze_papers` → `generate_hypotheses` → `design_experiments` → `implement_experiments` → `run_experiments` → `analyze_results` → `review` → `write_paper`

Если результаты слабы, система откатывается к гипотезам или дизайну, а не движется вперед к оптимистичному тексту. Вся автоматизация живет внутри ограниченных внутренних циклов.

## Ключевые свойства

- **Управление экспериментами**: контракт фиксирует гипотезу, причинный механизм, правило одного изменения и условие остановки
- **Потолок утверждений**: `review` формирует максимально защищаемое утверждение и пробелы в доказательствах
- **Память о сбоях**: группирует эквивалентные ошибки и не повторяет бессмысленные попытки
- **Двухслойная оценка статьи**: детерминированный минимум + LLM-оценка качества
- **Панель из 5 специалистов**: независимая оценка claims, методологии, статистики, письма и integrity

## Интерфейсы и режимы

- `autolabos`: терминальная TUI
- `autolabos web`: локальный Web Ops UI

Режимы:

- Interactive
- Minimal approval
- Overnight
- Autonomous

## Разработка

```bash
npm install
npm run build
npm test
npm run test:smoke:all
```

Основные документы:

- `docs/architecture.md`
- `docs/tui-live-validation.md`
- `docs/experiment-quality-bar.md`
- `docs/paper-quality-bar.md`
- `docs/reproducibility.md`
- `docs/research-brief-template.md`

---

<div align="center">
  <sub>Создано для исследователей, которым нужны управляемые эксперименты и защищаемые утверждения.</sub>
</div>
