export type GuidedBriefInterviewLanguage =
  | "en"
  | "ko"
  | "ja"
  | "zh-CN"
  | "zh-TW"
  | "es"
  | "fr"
  | "de"
  | "pt"
  | "ru";

export interface GuidedBriefInterviewCopy {
  selectionTitle: string;
  introLines: string[];
  requiredAnswerMessage: string;
  questions: {
    topic: string;
    primaryMetric: string;
    meaningfulImprovement: string;
    constraints: string;
    researchQuestion: string;
    whySmallExperiment: string;
    baselineComparator: string;
    datasetTaskBench: string;
    targetComparison: string;
    minimumAcceptableEvidence: string;
    disallowedShortcuts: string;
    allowedBudgetedPasses: string;
    paperCeiling: string;
    minimumExperimentPlan: string;
    failureConditions: string;
    secondaryMetrics: string;
    manuscriptTemplate: string;
    appendixPrefer: string;
    appendixKeepMain: string;
    notes: string;
    questionsRisks: string;
  };
}

export interface GuidedBriefInterviewLanguageOption {
  value: GuidedBriefInterviewLanguage;
  label: string;
  description: string;
}

const ENGLISH_COPY: GuidedBriefInterviewCopy = {
  selectionTitle: "Select guided brief interview language",
  introLines: [
    "Starting guided Research Brief interview.",
    "Use one line per answer. You can separate bullet-like items with semicolons."
  ],
  requiredAnswerMessage: "Please provide a short substantive answer so the brief can be generated.",
  questions: {
    topic: "Topic",
    primaryMetric: "Primary metric",
    meaningfulImprovement: "Meaningful improvement threshold",
    constraints: "Constraints (semicolon-separated)",
    researchQuestion: "Research question",
    whySmallExperiment: "Why can this be tested with a small real experiment? (semicolon-separated)",
    baselineComparator: "Baseline / comparator (semicolon-separated)",
    datasetTaskBench: "Dataset / task / bench (semicolon-separated)",
    targetComparison: "Target comparison (semicolon-separated)",
    minimumAcceptableEvidence: "Minimum acceptable evidence (semicolon-separated)",
    disallowedShortcuts: "Disallowed shortcuts (semicolon-separated)",
    allowedBudgetedPasses: "Allowed budgeted passes (semicolon-separated)",
    paperCeiling: "Paper ceiling if evidence remains weak",
    minimumExperimentPlan: "Minimum experiment plan (semicolon-separated)",
    failureConditions: "Failure conditions (semicolon-separated)",
    secondaryMetrics: "Secondary metrics (optional)",
    manuscriptTemplate: "Manuscript template path (optional)",
    appendixPrefer: "Prefer appendix for (optional; semicolon-separated)",
    appendixKeepMain: "Keep in main body (optional; semicolon-separated)",
    notes: "Notes (optional)",
    questionsRisks: "Questions / risks (optional)"
  }
};

const COPY_BY_LANGUAGE: Record<GuidedBriefInterviewLanguage, GuidedBriefInterviewCopy> = {
  en: ENGLISH_COPY,
  ko: {
    selectionTitle: "연구 브리프 인터뷰 언어 선택",
    introLines: [
      "가이드형 Research Brief 인터뷰를 시작합니다.",
      "각 답변은 한 줄로 입력하세요. 목록성 항목은 세미콜론으로 구분할 수 있습니다."
    ],
    requiredAnswerMessage: "브리프를 생성하려면 짧더라도 실질적인 답변이 필요합니다.",
    questions: {
      topic: "주제",
      primaryMetric: "주요 평가 지표",
      meaningfulImprovement: "의미 있는 개선 기준",
      constraints: "제약 조건 (세미콜론 구분)",
      researchQuestion: "연구 질문",
      whySmallExperiment: "왜 작은 실제 실험으로 검증할 수 있나요? (세미콜론 구분)",
      baselineComparator: "베이스라인 / 비교 대상 (세미콜론 구분)",
      datasetTaskBench: "데이터셋 / 작업 / 벤치마크 (세미콜론 구분)",
      targetComparison: "목표 비교 항목 (세미콜론 구분)",
      minimumAcceptableEvidence: "최소 허용 증거 수준 (세미콜론 구분)",
      disallowedShortcuts: "금지되는 지름길 (세미콜론 구분)",
      allowedBudgetedPasses: "허용되는 예산 내 추가 패스 (세미콜론 구분)",
      paperCeiling: "증거가 약할 때의 paper ceiling",
      minimumExperimentPlan: "최소 실험 계획 (세미콜론 구분)",
      failureConditions: "실패 조건 (세미콜론 구분)",
      secondaryMetrics: "보조 지표 (선택 사항)",
      manuscriptTemplate: "원고 템플릿 경로 (선택 사항)",
      appendixPrefer: "부록으로 보내고 싶은 항목 (선택 사항; 세미콜론 구분)",
      appendixKeepMain: "본문에 남기고 싶은 항목 (선택 사항; 세미콜론 구분)",
      notes: "메모 (선택 사항)",
      questionsRisks: "질문 / 리스크 (선택 사항)"
    }
  },
  ja: {
    selectionTitle: "研究ブリーフ面談の言語を選択",
    introLines: [
      "ガイド付き Research Brief 面談を開始します。",
      "各回答は1行で入力してください。箇条書き風の項目はセミコロンで区切れます。"
    ],
    requiredAnswerMessage: "ブリーフを生成するには、短くても実質的な回答が必要です。",
    questions: {
      topic: "トピック",
      primaryMetric: "主要評価指標",
      meaningfulImprovement: "意味のある改善基準",
      constraints: "制約条件（セミコロン区切り）",
      researchQuestion: "研究質問",
      whySmallExperiment: "なぜ小規模な実験で検証できますか？（セミコロン区切り）",
      baselineComparator: "ベースライン / 比較対象（セミコロン区切り）",
      datasetTaskBench: "データセット / タスク / ベンチ（セミコロン区切り）",
      targetComparison: "比較したい対象（セミコロン区切り）",
      minimumAcceptableEvidence: "最低限必要な証拠（セミコロン区切り）",
      disallowedShortcuts: "禁止する近道（セミコロン区切り）",
      allowedBudgetedPasses: "許可する追加パス（セミコロン区切り）",
      paperCeiling: "証拠が弱い場合の paper ceiling",
      minimumExperimentPlan: "最小実験計画（セミコロン区切り）",
      failureConditions: "失敗条件（セミコロン区切り）",
      secondaryMetrics: "副次指標（任意）",
      manuscriptTemplate: "原稿テンプレートのパス（任意）",
      appendixPrefer: "付録に回したい内容（任意・セミコロン区切り）",
      appendixKeepMain: "本文に残したい内容（任意・セミコロン区切り）",
      notes: "メモ（任意）",
      questionsRisks: "質問 / リスク（任意）"
    }
  },
  "zh-CN": {
    selectionTitle: "选择研究简报访谈语言",
    introLines: [
      "开始引导式 Research Brief 访谈。",
      "每个回答请尽量用一行完成。列表项可以用分号分隔。"
    ],
    requiredAnswerMessage: "要生成 brief，需要给出简短但有实质内容的回答。",
    questions: {
      topic: "主题",
      primaryMetric: "主要指标",
      meaningfulImprovement: "有意义的改进阈值",
      constraints: "约束条件（用分号分隔）",
      researchQuestion: "研究问题",
      whySmallExperiment: "为什么这个问题可以用小规模真实实验来验证？（用分号分隔）",
      baselineComparator: "基线 / 比较对象（用分号分隔）",
      datasetTaskBench: "数据集 / 任务 / 基准（用分号分隔）",
      targetComparison: "目标比较（用分号分隔）",
      minimumAcceptableEvidence: "最低可接受证据（用分号分隔）",
      disallowedShortcuts: "禁止的捷径（用分号分隔）",
      allowedBudgetedPasses: "允许的预算内额外轮次（用分号分隔）",
      paperCeiling: "若证据仍然较弱时的 paper ceiling",
      minimumExperimentPlan: "最小实验计划（用分号分隔）",
      failureConditions: "失败条件（用分号分隔）",
      secondaryMetrics: "次要指标（可选）",
      manuscriptTemplate: "稿件模板路径（可选）",
      appendixPrefer: "优先放入附录的内容（可选；用分号分隔）",
      appendixKeepMain: "需要保留在正文中的内容（可选；用分号分隔）",
      notes: "备注（可选）",
      questionsRisks: "问题 / 风险（可选）"
    }
  },
  "zh-TW": {
    selectionTitle: "選擇研究簡報訪談語言",
    introLines: [
      "開始引導式 Research Brief 訪談。",
      "每個回答請盡量用一行完成。條列項可用分號分隔。"
    ],
    requiredAnswerMessage: "要產生 brief，需要提供簡短但有實質內容的回答。",
    questions: {
      topic: "主題",
      primaryMetric: "主要指標",
      meaningfulImprovement: "有意義的改善門檻",
      constraints: "限制條件（以分號分隔）",
      researchQuestion: "研究問題",
      whySmallExperiment: "為什麼這個問題可以用小型真實實驗驗證？（以分號分隔）",
      baselineComparator: "基線 / 比較對象（以分號分隔）",
      datasetTaskBench: "資料集 / 任務 / 基準（以分號分隔）",
      targetComparison: "目標比較（以分號分隔）",
      minimumAcceptableEvidence: "最低可接受證據（以分號分隔）",
      disallowedShortcuts: "禁止的捷徑（以分號分隔）",
      allowedBudgetedPasses: "允許的額外預算內輪次（以分號分隔）",
      paperCeiling: "若證據仍偏弱時的 paper ceiling",
      minimumExperimentPlan: "最小實驗計畫（以分號分隔）",
      failureConditions: "失敗條件（以分號分隔）",
      secondaryMetrics: "次要指標（選填）",
      manuscriptTemplate: "稿件模板路徑（選填）",
      appendixPrefer: "偏好放入附錄的內容（選填；以分號分隔）",
      appendixKeepMain: "應保留在正文中的內容（選填；以分號分隔）",
      notes: "備註（選填）",
      questionsRisks: "問題 / 風險（選填）"
    }
  },
  es: {
    selectionTitle: "Selecciona el idioma de la entrevista del brief",
    introLines: [
      "Iniciando la entrevista guiada de Research Brief.",
      "Usa una línea por respuesta. Puedes separar elementos tipo viñeta con punto y coma."
    ],
    requiredAnswerMessage: "Para generar el brief necesito una respuesta breve pero sustantiva.",
    questions: {
      topic: "Tema",
      primaryMetric: "Métrica principal",
      meaningfulImprovement: "Umbral de mejora significativa",
      constraints: "Restricciones (separadas por punto y coma)",
      researchQuestion: "Pregunta de investigación",
      whySmallExperiment: "¿Por qué puede probarse con un experimento real pequeño? (separado por punto y coma)",
      baselineComparator: "Línea base / comparador (separado por punto y coma)",
      datasetTaskBench: "Dataset / tarea / benchmark (separado por punto y coma)",
      targetComparison: "Comparación objetivo (separada por punto y coma)",
      minimumAcceptableEvidence: "Evidencia mínima aceptable (separada por punto y coma)",
      disallowedShortcuts: "Atajos no permitidos (separados por punto y coma)",
      allowedBudgetedPasses: "Pasadas adicionales permitidas dentro del presupuesto (separadas por punto y coma)",
      paperCeiling: "Paper ceiling si la evidencia sigue siendo débil",
      minimumExperimentPlan: "Plan mínimo de experimentos (separado por punto y coma)",
      failureConditions: "Condiciones de fallo (separadas por punto y coma)",
      secondaryMetrics: "Métricas secundarias (opcional)",
      manuscriptTemplate: "Ruta de la plantilla del manuscrito (opcional)",
      appendixPrefer: "Preferir enviar al apéndice (opcional; separado por punto y coma)",
      appendixKeepMain: "Mantener en el cuerpo principal (opcional; separado por punto y coma)",
      notes: "Notas (opcional)",
      questionsRisks: "Preguntas / riesgos (opcional)"
    }
  },
  fr: {
    selectionTitle: "Choisir la langue de l’entretien du brief",
    introLines: [
      "Démarrage de l’entretien guidé du Research Brief.",
      "Utilisez une ligne par réponse. Les éléments de type liste peuvent être séparés par des points-virgules."
    ],
    requiredAnswerMessage: "Pour générer le brief, il faut une réponse courte mais substantielle.",
    questions: {
      topic: "Sujet",
      primaryMetric: "Métrique principale",
      meaningfulImprovement: "Seuil d’amélioration significative",
      constraints: "Contraintes (séparées par des points-virgules)",
      researchQuestion: "Question de recherche",
      whySmallExperiment: "Pourquoi cela peut-il être testé avec une petite expérience réelle ? (séparé par des points-virgules)",
      baselineComparator: "Baseline / comparateur (séparé par des points-virgules)",
      datasetTaskBench: "Jeu de données / tâche / benchmark (séparé par des points-virgules)",
      targetComparison: "Comparaison cible (séparée par des points-virgules)",
      minimumAcceptableEvidence: "Niveau minimal de preuve acceptable (séparé par des points-virgules)",
      disallowedShortcuts: "Raccourcis interdits (séparés par des points-virgules)",
      allowedBudgetedPasses: "Passes supplémentaires autorisées dans le budget (séparées par des points-virgules)",
      paperCeiling: "Paper ceiling si la preuve reste faible",
      minimumExperimentPlan: "Plan expérimental minimal (séparé par des points-virgules)",
      failureConditions: "Conditions d’échec (séparées par des points-virgules)",
      secondaryMetrics: "Métriques secondaires (optionnel)",
      manuscriptTemplate: "Chemin du modèle de manuscrit (optionnel)",
      appendixPrefer: "À placer de préférence en annexe (optionnel ; séparé par des points-virgules)",
      appendixKeepMain: "À garder dans le corps principal (optionnel ; séparé par des points-virgules)",
      notes: "Notes (optionnel)",
      questionsRisks: "Questions / risques (optionnel)"
    }
  },
  de: {
    selectionTitle: "Sprache für das Brief-Interview wählen",
    introLines: [
      "Das geführte Research-Brief-Interview wird gestartet.",
      "Bitte jede Antwort in einer Zeile eingeben. Listenartige Punkte können mit Semikolon getrennt werden."
    ],
    requiredAnswerMessage: "Damit der Brief erzeugt werden kann, brauche ich eine kurze, aber inhaltliche Antwort.",
    questions: {
      topic: "Thema",
      primaryMetric: "Primäre Metrik",
      meaningfulImprovement: "Schwelle für bedeutsame Verbesserung",
      constraints: "Randbedingungen (mit Semikolon getrennt)",
      researchQuestion: "Forschungsfrage",
      whySmallExperiment: "Warum lässt sich das mit einem kleinen realen Experiment testen? (mit Semikolon getrennt)",
      baselineComparator: "Baseline / Vergleich (mit Semikolon getrennt)",
      datasetTaskBench: "Datensatz / Aufgabe / Benchmark (mit Semikolon getrennt)",
      targetComparison: "Zielvergleich (mit Semikolon getrennt)",
      minimumAcceptableEvidence: "Minimal akzeptable Evidenz (mit Semikolon getrennt)",
      disallowedShortcuts: "Nicht erlaubte Abkürzungen (mit Semikolon getrennt)",
      allowedBudgetedPasses: "Erlaubte zusätzliche Durchläufe im Budget (mit Semikolon getrennt)",
      paperCeiling: "Paper ceiling, falls die Evidenz schwach bleibt",
      minimumExperimentPlan: "Minimaler Experimentplan (mit Semikolon getrennt)",
      failureConditions: "Fehlerbedingungen (mit Semikolon getrennt)",
      secondaryMetrics: "Sekundäre Metriken (optional)",
      manuscriptTemplate: "Pfad zur Manuskriptvorlage (optional)",
      appendixPrefer: "Bevorzugt in den Anhang verschieben (optional; mit Semikolon getrennt)",
      appendixKeepMain: "Im Hauptteil behalten (optional; mit Semikolon getrennt)",
      notes: "Notizen (optional)",
      questionsRisks: "Fragen / Risiken (optional)"
    }
  },
  pt: {
    selectionTitle: "Escolha o idioma da entrevista do brief",
    introLines: [
      "Iniciando a entrevista guiada do Research Brief.",
      "Use uma linha por resposta. Itens em formato de lista podem ser separados por ponto e vírgula."
    ],
    requiredAnswerMessage: "Para gerar o brief, preciso de uma resposta curta, mas substantiva.",
    questions: {
      topic: "Tópico",
      primaryMetric: "Métrica principal",
      meaningfulImprovement: "Limiar de melhoria significativa",
      constraints: "Restrições (separadas por ponto e vírgula)",
      researchQuestion: "Pergunta de pesquisa",
      whySmallExperiment: "Por que isso pode ser testado com um pequeno experimento real? (separado por ponto e vírgula)",
      baselineComparator: "Baseline / comparador (separado por ponto e vírgula)",
      datasetTaskBench: "Conjunto de dados / tarefa / benchmark (separado por ponto e vírgula)",
      targetComparison: "Comparação alvo (separada por ponto e vírgula)",
      minimumAcceptableEvidence: "Evidência mínima aceitável (separada por ponto e vírgula)",
      disallowedShortcuts: "Atalhos não permitidos (separados por ponto e vírgula)",
      allowedBudgetedPasses: "Passes extras permitidos dentro do orçamento (separados por ponto e vírgula)",
      paperCeiling: "Paper ceiling se a evidência continuar fraca",
      minimumExperimentPlan: "Plano mínimo de experimento (separado por ponto e vírgula)",
      failureConditions: "Condições de falha (separadas por ponto e vírgula)",
      secondaryMetrics: "Métricas secundárias (opcional)",
      manuscriptTemplate: "Caminho do template do manuscrito (opcional)",
      appendixPrefer: "Preferir mover para o apêndice (opcional; separado por ponto e vírgula)",
      appendixKeepMain: "Manter no corpo principal (opcional; separado por ponto e vírgula)",
      notes: "Notas (opcional)",
      questionsRisks: "Perguntas / riscos (opcional)"
    }
  },
  ru: {
    selectionTitle: "Выберите язык интервью для brief",
    introLines: [
      "Запускаю guided interview для Research Brief.",
      "Используйте одну строку на ответ. Пункты списка можно разделять точкой с запятой."
    ],
    requiredAnswerMessage: "Чтобы создать brief, нужен короткий, но содержательный ответ.",
    questions: {
      topic: "Тема",
      primaryMetric: "Основная метрика",
      meaningfulImprovement: "Порог значимого улучшения",
      constraints: "Ограничения (через точку с запятой)",
      researchQuestion: "Исследовательский вопрос",
      whySmallExperiment: "Почему это можно проверить небольшим реальным экспериментом? (через точку с запятой)",
      baselineComparator: "Бейзлайн / сравнение (через точку с запятой)",
      datasetTaskBench: "Датасет / задача / бенчмарк (через точку с запятой)",
      targetComparison: "Целевое сравнение (через точку с запятой)",
      minimumAcceptableEvidence: "Минимально приемлемое доказательство (через точку с запятой)",
      disallowedShortcuts: "Недопустимые сокращения пути (через точку с запятой)",
      allowedBudgetedPasses: "Разрешенные дополнительные проходы в рамках бюджета (через точку с запятой)",
      paperCeiling: "Paper ceiling, если доказательства останутся слабыми",
      minimumExperimentPlan: "Минимальный план эксперимента (через точку с запятой)",
      failureConditions: "Условия провала (через точку с запятой)",
      secondaryMetrics: "Вторичные метрики (необязательно)",
      manuscriptTemplate: "Путь к шаблону рукописи (необязательно)",
      appendixPrefer: "Предпочтительно вынести в приложение (необязательно; через точку с запятой)",
      appendixKeepMain: "Оставить в основном тексте (необязательно; через точку с запятой)",
      notes: "Примечания (необязательно)",
      questionsRisks: "Вопросы / риски (необязательно)"
    }
  }
};

const LANGUAGE_OPTIONS: GuidedBriefInterviewLanguageOption[] = [
  { value: "en", label: "English", description: "Ask the guided brief questions in English." },
  { value: "ko", label: "한국어", description: "질문을 한국어로 진행합니다." },
  { value: "ja", label: "日本語", description: "質問を日本語で行います。" },
  { value: "zh-CN", label: "简体中文", description: "使用简体中文提问。" },
  { value: "zh-TW", label: "繁體中文", description: "使用繁體中文提問。" },
  { value: "es", label: "Español", description: "Hace las preguntas en español." },
  { value: "fr", label: "Français", description: "Pose les questions en français." },
  { value: "de", label: "Deutsch", description: "Stellt die Fragen auf Deutsch." },
  { value: "pt", label: "Português", description: "Faz as perguntas em português." },
  { value: "ru", label: "Русский", description: "Задает вопросы на русском языке." }
];

export function listGuidedBriefInterviewLanguages(): GuidedBriefInterviewLanguageOption[] {
  return LANGUAGE_OPTIONS.map((option) => ({ ...option }));
}

export function getGuidedBriefInterviewCopy(
  language: GuidedBriefInterviewLanguage
): GuidedBriefInterviewCopy {
  return COPY_BY_LANGUAGE[language] ?? ENGLISH_COPY;
}

