import { FormEvent, startTransition, useEffect, useState } from "react";

import {
  ArtifactEntry,
  BootstrapResponse,
  CheckpointEntry,
  DoctorCheck,
  RunRecord,
  WebSessionState
} from "./types";

const NODE_ORDER = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "write_paper"
] as const;

type TabId = "logs" | "artifacts" | "checkpoints" | "meta" | "doctor";

const DETAIL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "logs", label: "Live logs" },
  { id: "artifacts", label: "Artifacts" },
  { id: "checkpoints", label: "Checkpoints" },
  { id: "meta", label: "Metadata" },
  { id: "doctor", label: "Doctor" }
];

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [session, setSession] = useState<WebSessionState | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactEntry | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("logs");
  const [showNewRunForm, setShowNewRunForm] = useState(false);
  const [newRunTopic, setNewRunTopic] = useState("");
  const [newRunConstraints, setNewRunConstraints] = useState("");
  const [newRunObjective, setNewRunObjective] = useState("");
  const [setupForm, setSetupForm] = useState({
    projectName: "",
    defaultTopic: "",
    defaultConstraints: "",
    defaultObjectiveMetric: "",
    llmMode: "codex_chatgpt_only",
    pdfAnalysisMode: "codex_text_extract",
    semanticScholarApiKey: "",
    openAiApiKey: ""
  });

  useEffect(() => {
    void refreshBootstrap();
    void refreshDoctor();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    void refreshRunDetails(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }
    setSession(bootstrap.session);
    setSelectedRunId(bootstrap.activeRunId || bootstrap.runs[0]?.id);
    if (!setupForm.projectName) {
      setSetupForm((current) => ({
        ...current,
        projectName: bootstrap.setupDefaults.projectName,
        defaultTopic: bootstrap.setupDefaults.defaultTopic,
        defaultConstraints: bootstrap.setupDefaults.defaultConstraints.join(", "),
        defaultObjectiveMetric: bootstrap.setupDefaults.defaultObjectiveMetric
      }));
      setNewRunTopic(bootstrap.setupDefaults.defaultTopic);
      setNewRunConstraints(bootstrap.setupDefaults.defaultConstraints.join(", "));
      setNewRunObjective(bootstrap.setupDefaults.defaultObjectiveMetric);
    }
  }, [bootstrap]);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.addEventListener("session_state", (event) => {
      const nextSession = JSON.parse((event as MessageEvent).data) as WebSessionState;
      startTransition(() => {
        setSession(nextSession);
        if (nextSession.activeRunId) {
          setSelectedRunId(nextSession.activeRunId);
        }
      });
    });
    source.addEventListener("runtime_event", () => {
      if (selectedRunId) {
        startTransition(() => {
          void refreshRunDetails(selectedRunId);
        });
      }
    });
    source.addEventListener("bootstrap", () => {
      startTransition(() => {
        void refreshBootstrap();
      });
    });
    return () => {
      source.close();
    };
  }, [selectedRunId]);

  const filteredRuns = !bootstrap
    ? []
    : bootstrap.runs.filter((run) => {
        const query = runSearch.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return run.id.toLowerCase().includes(query) || run.title.toLowerCase().includes(query);
      });
  const activeTabLabel = DETAIL_TABS.find((tab) => tab.id === activeTab)?.label || "Inspector";
  const completedNodeCount = selectedRun
    ? NODE_ORDER.filter((node) => selectedRun.graph.nodeStates[node].status === "completed").length
    : 0;
  const selectedRunStatusClass = selectedRun ? statusToneClass(selectedRun.status) : "is-neutral";

  async function refreshBootstrap() {
    const data = await api<BootstrapResponse>("/api/bootstrap");
    setBootstrap(data);
  }

  async function refreshRunDetails(runId: string) {
    const [{ run }, artifactsResponse, checkpointsResponse] = await Promise.all([
      api<{ run: RunRecord }>(`/api/runs/${encodeURIComponent(runId)}`),
      api<{ artifacts: ArtifactEntry[] }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`),
      api<{ checkpoints: CheckpointEntry[] }>(`/api/runs/${encodeURIComponent(runId)}/checkpoints`)
    ]);
    setSelectedRun(run);
    setArtifacts(artifactsResponse.artifacts);
    setCheckpoints(checkpointsResponse.checkpoints);
    if (selectedArtifact) {
      const nextArtifact = artifactsResponse.artifacts.find((item) => item.path === selectedArtifact.path) || null;
      setSelectedArtifact(nextArtifact);
      if (nextArtifact?.previewable) {
        await loadArtifactPreview(runId, nextArtifact);
        return;
      }
      setArtifactPreview(null);
      return;
    }
    setArtifactPreview(null);
  }

  async function refreshDoctor() {
    const response = await api<{ configured: boolean; checks: DoctorCheck[] }>("/api/doctor");
    setDoctorChecks(response.checks);
  }

  async function loadArtifactPreview(runId: string, artifact: ArtifactEntry) {
    setSelectedArtifact(artifact);
    if (!artifact.previewable || artifact.kind === "directory") {
      setArtifactPreview(null);
      return;
    }
    if (artifact.kind === "image" || artifact.kind === "pdf") {
      setArtifactPreview(`/api/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(artifact.path)}`);
      return;
    }
    const text = await fetch(`/api/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(artifact.path)}`).then((response) => response.text());
    setArtifactPreview(text);
  }

  async function runSlashSelection(runId: string) {
    const response = await api<{ session: WebSessionState }>("/api/session/input", {
      method: "POST",
      body: JSON.stringify({ text: `/run ${runId}` })
    });
    setSession(response.session);
    setSelectedRunId(runId);
    await refreshBootstrap();
  }

  async function submitComposer(event: FormEvent) {
    event.preventDefault();
    if (!commandInput.trim()) {
      return;
    }
    const response = await api<{ session: WebSessionState }>("/api/session/input", {
      method: "POST",
      body: JSON.stringify({ text: commandInput })
    });
    setSession(response.session);
    setCommandInput("");
    await refreshBootstrap();
    if (response.session.activeRunId) {
      await refreshRunDetails(response.session.activeRunId);
    }
  }

  async function submitNewRun(event: FormEvent) {
    event.preventDefault();
    const constraints = newRunConstraints
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const response = await api<{ run: RunRecord; session: WebSessionState }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        topic: newRunTopic,
        constraints,
        objectiveMetric: newRunObjective
      })
    });
    setShowNewRunForm(false);
    setSession(response.session);
    setSelectedRunId(response.run.id);
    await refreshBootstrap();
    await refreshRunDetails(response.run.id);
  }

  async function submitSetup(event: FormEvent) {
    event.preventDefault();
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        ...setupForm,
        defaultConstraints: setupForm.defaultConstraints
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      })
    });
    await refreshBootstrap();
    await refreshDoctor();
  }

  async function triggerPending(action: "next" | "all" | "cancel") {
    const response = await api<{ session: WebSessionState }>("/api/session/pending", {
      method: "POST",
      body: JSON.stringify({ action })
    });
    setSession(response.session);
    await refreshBootstrap();
    if (selectedRunId) {
      await refreshRunDetails(selectedRunId);
    }
  }

  async function cancelActive() {
    const response = await api<{ session: WebSessionState }>("/api/session/cancel", {
      method: "POST"
    });
    setSession(response.session);
  }

  async function runAction(endpoint: string, body?: unknown) {
    const response = await api<{ session: WebSessionState }>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined
    });
    setSession(response.session);
    const nextRunId = response.session.activeRunId || selectedRunId;
    if (nextRunId) {
      setSelectedRunId(nextRunId);
    }
    await refreshBootstrap();
    if (nextRunId) {
      await refreshRunDetails(nextRunId);
    }
  }

  if (!bootstrap) {
    return <div className="shell"><div className="panel hero">Loading AutoResearch Web Ops...</div></div>;
  }

  if (!bootstrap.configured) {
    return (
      <div className="shell onboarding-shell">
        <div className="panel hero">
          <p className="eyebrow">AutoResearch Web Ops</p>
          <h1>One screen for the full research loop.</h1>
          <p className="lede">
            Keep setup, runs, workflow controls, and artifacts in a browser UI that stays out of the way.
          </p>
          <div className="chip-list">
            <span className="chip">Onboarding</span>
            <span className="chip">Workflow control</span>
            <span className="chip">Artifacts</span>
            <span className="chip">Live logs</span>
          </div>
        </div>
        <form className="panel onboarding-form" onSubmit={submitSetup}>
          <div className="section-heading">
            <div>
              <p className="section-kicker">Workspace</p>
              <h2>Initial setup</h2>
            </div>
          </div>
          <label>
            Project name
            <input value={setupForm.projectName} onChange={(event) => setSetupForm((current) => ({ ...current, projectName: event.target.value }))} />
          </label>
          <label>
            Default topic
            <input value={setupForm.defaultTopic} onChange={(event) => setSetupForm((current) => ({ ...current, defaultTopic: event.target.value }))} />
          </label>
          <label>
            Default constraints
            <input value={setupForm.defaultConstraints} onChange={(event) => setSetupForm((current) => ({ ...current, defaultConstraints: event.target.value }))} />
          </label>
          <label>
            Objective metric
            <input value={setupForm.defaultObjectiveMetric} onChange={(event) => setSetupForm((current) => ({ ...current, defaultObjectiveMetric: event.target.value }))} />
          </label>
          <div className="inline-fields">
            <label>
              Primary provider
              <select value={setupForm.llmMode} onChange={(event) => setSetupForm((current) => ({ ...current, llmMode: event.target.value }))}>
                <option value="codex_chatgpt_only">Codex ChatGPT</option>
                <option value="openai_api">OpenAI API</option>
              </select>
            </label>
            <label>
              PDF mode
              <select value={setupForm.pdfAnalysisMode} onChange={(event) => setSetupForm((current) => ({ ...current, pdfAnalysisMode: event.target.value }))}>
                <option value="codex_text_extract">Codex text extract</option>
                <option value="responses_api_pdf">Responses API PDF</option>
              </select>
            </label>
          </div>
          <label>
            Semantic Scholar API key
            <input type="password" value={setupForm.semanticScholarApiKey} onChange={(event) => setSetupForm((current) => ({ ...current, semanticScholarApiKey: event.target.value }))} />
          </label>
          <label>
            OpenAI API key
            <input type="password" value={setupForm.openAiApiKey} onChange={(event) => setSetupForm((current) => ({ ...current, openAiApiKey: event.target.value }))} />
          </label>
          <div className="form-actions">
            <button className="button button-primary" type="submit">Initialize workspace</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <aside className="panel sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <p className="eyebrow">AutoResearch</p>
            <h1>Web Ops</h1>
            <p>{bootstrap.configSummary?.projectName}</p>
          </div>
          <div className="config-card">
            <div className="chip-list">
              <span className="chip">{labelProviderMode(bootstrap.configSummary?.llmMode)}</span>
              <span className="chip">{labelPdfMode(bootstrap.configSummary?.pdfMode)}</span>
            </div>
            <small>{bootstrap.configSummary?.taskModel}</small>
          </div>
        </div>
        <div className="section-heading">
          <div>
            <p className="section-kicker">Runs</p>
            <h2>Workspace runs</h2>
          </div>
          <span className="count-badge">{filteredRuns.length}</span>
        </div>
        <div className="sidebar-toolbar">
          <input
            placeholder="Search runs"
            value={runSearch}
            onChange={(event) => setRunSearch(event.target.value)}
          />
          <button
            className="button button-primary"
            type="button"
            onClick={() => setShowNewRunForm((current) => !current)}
          >
            {showNewRunForm ? "Close" : "New run"}
          </button>
        </div>
        {showNewRunForm ? (
          <form className="subtle-card new-run-form" onSubmit={submitNewRun}>
            <label>
              Topic
              <input value={newRunTopic} onChange={(event) => setNewRunTopic(event.target.value)} />
            </label>
            <label>
              Constraints
              <input value={newRunConstraints} onChange={(event) => setNewRunConstraints(event.target.value)} />
            </label>
            <label>
              Objective
              <input value={newRunObjective} onChange={(event) => setNewRunObjective(event.target.value)} />
            </label>
            <div className="form-actions">
              <button className="button button-primary" type="submit">Create run</button>
              <button className="button button-secondary" type="button" onClick={() => setShowNewRunForm(false)}>Cancel</button>
            </div>
          </form>
        ) : null}
        <div className="run-list">
          {filteredRuns.length === 0 ? (
            <div className="inline-empty">No runs match this search yet.</div>
          ) : (
            filteredRuns.map((run) => (
              <button
                key={run.id}
                className={`run-list-item ${selectedRunId === run.id ? "selected" : ""}`}
                type="button"
                onClick={() => {
                  void runSlashSelection(run.id);
                }}
              >
                <div className="run-list-top">
                  <span className="run-title">{run.title}</span>
                  <span className={`status-pill ${statusToneClass(run.status)}`}>{formatStatusLabel(run.status)}</span>
                </div>
                <div className="run-list-bottom">
                  <span className="run-meta">{formatNodeLabel(run.currentNode)}</span>
                  <span className="run-meta">{formatTimestamp(run.updatedAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="main-column">
        {selectedRun ? (
          <>
            <section className="panel run-header">
              <div className="run-header-top">
                <div>
                  <p className="eyebrow">Selected run</p>
                  <div className="title-row">
                    <h2>{selectedRun.title}</h2>
                    <span className={`status-pill ${selectedRunStatusClass}`}>{formatStatusLabel(selectedRun.status)}</span>
                  </div>
                  <p className="run-topic">{selectedRun.topic}</p>
                </div>
                <div className="header-actions">
                  <button className="button button-primary" type="button" onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/approve`)}>Approve</button>
                  <button className="button button-secondary" type="button" onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/retry`)}>Retry</button>
                  {session?.canCancel ? (
                    <button className="button button-danger" type="button" onClick={() => void cancelActive()}>Cancel</button>
                  ) : null}
                </div>
              </div>

              <div className="stat-grid">
                <article className="stat-card">
                  <span className="stat-label">Current node</span>
                  <strong>{formatNodeLabel(selectedRun.currentNode)}</strong>
                </article>
                <article className="stat-card">
                  <span className="stat-label">Progress</span>
                  <strong>{completedNodeCount} / {NODE_ORDER.length}</strong>
                </article>
                <article className="stat-card">
                  <span className="stat-label">Checkpoint</span>
                  <strong>#{selectedRun.graph.checkpointSeq}</strong>
                </article>
                <article className="stat-card">
                  <span className="stat-label">Budget</span>
                  <strong>{selectedRun.graph.budget.toolCallsUsed} / {selectedRun.graph.budget.policy.maxToolCalls}</strong>
                </article>
              </div>

              {selectedRun.constraints.length > 0 ? (
                <div className="chip-list">
                  {selectedRun.constraints.map((constraint) => (
                    <span key={constraint} className="chip">{constraint}</span>
                  ))}
                </div>
              ) : null}

              {selectedRun.latestSummary ? (
                <p className="summary-copy">{selectedRun.latestSummary}</p>
              ) : null}
            </section>

            <section className="panel workflow-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Workflow</p>
                  <h3>Eight-node state graph</h3>
                </div>
                <span className="count-badge">{completedNodeCount}/{NODE_ORDER.length} complete</span>
              </div>

              <div className="workflow-grid">
                {NODE_ORDER.map((node) => {
                  const state = selectedRun.graph.nodeStates[node];
                  const isCurrent = selectedRun.currentNode === node;
                  return (
                    <article key={node} className={`node-card status-${state.status} ${isCurrent ? "current" : ""}`}>
                      <header className="node-card-header">
                        <span className="node-index">{NODE_ORDER.indexOf(node) + 1}</span>
                        <div className="node-copy">
                          <h3>{formatNodeLabel(node)}</h3>
                          <p className="node-note">{state.note || state.lastError || "No node note yet."}</p>
                        </div>
                        <span className={`status-pill ${statusToneClass(state.status)}`}>{formatStatusLabel(state.status)}</span>
                      </header>
                      <div className="node-footer">
                        <span className="node-meta">{isCurrent ? "Current node" : formatTimestamp(state.updatedAt)}</span>
                        <div className="node-actions">
                          <button className="button button-secondary button-small" type="button" onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/run-node`, { node })}>Run</button>
                          <button className="button button-secondary button-small" type="button" onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/retry`, { node })}>Retry</button>
                          <button className="button button-ghost button-small" type="button" onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/jump`, { node, force: true })}>Jump</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="panel empty-state">
            <h2>No run selected</h2>
            <p>Choose a run from the left rail or create a new one to inspect the workflow.</p>
          </section>
        )}

        {session?.pendingPlan ? (
          <section className="panel pending-panel">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Pending plan</p>
                <h3>Step {session.pendingPlan.stepIndex + 1} of {session.pendingPlan.totalSteps}</h3>
              </div>
              <span className="count-badge">{session.pendingPlan.totalSteps} queued</span>
            </div>
            <div className="pending-body">
              <ol className="command-list">
                {session.pendingPlan.displayCommands.map((command) => (
                  <li key={command}>{command}</li>
                ))}
              </ol>
              <div className="pending-actions">
                <button className="button button-primary" type="button" onClick={() => void triggerPending("next")}>Run next</button>
                {session.pendingPlan.totalSteps > 1 ? (
                  <button className="button button-secondary" type="button" onClick={() => void triggerPending("all")}>Run all</button>
                ) : null}
                <button className="button button-danger" type="button" onClick={() => void triggerPending("cancel")}>Cancel</button>
              </div>
            </div>
          </section>
        ) : null}

      </main>

      <aside className="panel detail-column">
        <div className="detail-header">
          <div>
            <p className="section-kicker">Inspector</p>
            <h2>{activeTabLabel}</h2>
          </div>
        </div>
        <div className="tab-row">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="detail-content">
          {activeTab === "logs" ? (
            <div className="log-list">
              {(session?.logs || []).length === 0 ? (
                <div className="inline-empty">Live runtime output will appear here.</div>
              ) : (
                (session?.logs || []).slice(-80).map((line, index) => (
                  <pre key={`${line}-${index}`} className="log-line">{line}</pre>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "artifacts" ? (
            <div className="artifact-layout">
              <div className="artifact-list">
                {artifacts.length === 0 ? (
                  <div className="inline-empty">No artifacts for this run yet.</div>
                ) : (
                  artifacts.map((artifact) => (
                    <button
                      key={artifact.path}
                      className={`artifact-item ${selectedArtifact?.path === artifact.path ? "selected" : ""}`}
                      type="button"
                      onClick={() => {
                        if (selectedRunId) {
                          void loadArtifactPreview(selectedRunId, artifact);
                        }
                      }}
                    >
                      <span>{artifact.path}</span>
                      <small>{labelArtifactKind(artifact.kind)} · {formatBytes(artifact.size)}</small>
                    </button>
                  ))
                )}
              </div>
              <div className="artifact-preview">
                {selectedArtifact?.kind === "image" && artifactPreview ? <img src={artifactPreview} alt={selectedArtifact.path} /> : null}
                {selectedArtifact?.kind === "pdf" && artifactPreview ? <iframe src={artifactPreview} title={selectedArtifact.path} /> : null}
                {selectedArtifact && (selectedArtifact.kind === "text" || selectedArtifact.kind === "json") ? (
                  <pre>{artifactPreview}</pre>
                ) : null}
                {selectedArtifact && selectedArtifact.kind === "download" ? (
                  <a
                    className="button button-secondary"
                    href={`/api/runs/${encodeURIComponent(selectedRunId || "")}/artifact?path=${encodeURIComponent(selectedArtifact.path)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download artifact
                  </a>
                ) : null}
                {!selectedArtifact ? <div className="inline-empty">Choose an artifact to preview it here.</div> : null}
              </div>
            </div>
          ) : null}

          {activeTab === "checkpoints" ? (
            <div className="checkpoint-list">
              {checkpoints.length === 0 ? (
                <div className="inline-empty">No checkpoints recorded yet.</div>
              ) : (
                checkpoints.map((checkpoint) => (
                  <article key={checkpoint.seq} className="checkpoint-item">
                    <div className="checkpoint-row">
                      <strong>#{checkpoint.seq}</strong>
                      <span className="status-pill is-neutral">{formatNodeLabel(checkpoint.node)}</span>
                    </div>
                    <span>{formatStatusLabel(checkpoint.phase)}</span>
                    <small>{formatTimestamp(checkpoint.createdAt)}</small>
                    {checkpoint.reason ? <small>{checkpoint.reason}</small> : null}
                  </article>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "meta" && selectedRun ? (
            <div className="meta-card">
              <article className="meta-row"><span>ID</span><strong>{selectedRun.id}</strong></article>
              <article className="meta-row"><span>Status</span><strong>{formatStatusLabel(selectedRun.status)}</strong></article>
              <article className="meta-row"><span>Objective</span><strong>{selectedRun.objectiveMetric}</strong></article>
              <article className="meta-row"><span>Constraints</span><strong>{selectedRun.constraints.join(", ") || "None"}</strong></article>
              <article className="meta-row"><span>Budget</span><strong>{selectedRun.graph.budget.toolCallsUsed}/{selectedRun.graph.budget.policy.maxToolCalls} tool calls</strong></article>
              <article className="meta-row"><span>Wall clock</span><strong>{(selectedRun.graph.budget.wallClockMsUsed / 60000).toFixed(1)} / {selectedRun.graph.budget.policy.maxWallClockMinutes} min</strong></article>
              <article className="meta-row"><span>USD</span><strong>{selectedRun.graph.budget.usdUsed || 0} / {selectedRun.graph.budget.policy.maxUsd}</strong></article>
            </div>
          ) : null}

          {activeTab === "doctor" ? (
            <div className="doctor-list">
              {doctorChecks.length === 0 ? (
                <div className="inline-empty">Doctor checks will appear after bootstrap completes.</div>
              ) : (
                doctorChecks.map((check) => (
                  <article key={check.name} className={`doctor-item ${check.ok ? "ok" : "fail"}`}>
                    <span className={`status-pill ${check.ok ? "is-success" : "is-danger"}`}>{check.ok ? "OK" : "FAIL"}</span>
                    <div>
                      <h4>{check.name}</h4>
                      <p>{check.detail}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : null}
        </div>

        <form className="composer composer-inline" onSubmit={submitComposer}>
          <div className="section-heading">
            <div>
              <p className="section-kicker">Command input</p>
              <h3>{activeTab === "logs" ? "Logs and input together" : "Run a command"}</h3>
            </div>
            <span className={`status-pill ${session?.busy ? "is-active" : "is-neutral"}`}>
              {session?.busy ? session.busyLabel || "Working..." : "Idle"}
            </span>
          </div>
          <label className="field-label">
            Prompt
            <textarea
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
              placeholder="collect 100 papers from the last 5 years by relevance"
              rows={3}
            />
          </label>
          <div className="composer-actions">
            <button className="button button-primary" type="submit" disabled={session?.busy}>Send</button>
            {session?.canCancel ? (
              <button className="button button-danger" type="button" onClick={() => void cancelActive()}>Cancel active task</button>
            ) : null}
          </div>
        </form>
      </aside>
    </div>
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function formatNodeLabel(value: string): string {
  return toHeadline(value.replace(/_/g, " "));
}

function formatStatusLabel(value: string): string {
  return toHeadline(value.replace(/_/g, " "));
}

function labelProviderMode(value: BootstrapResponse["configSummary"]["llmMode"] | undefined): string {
  return value === "openai_api" ? "OpenAI API" : "Codex ChatGPT";
}

function labelPdfMode(value: BootstrapResponse["configSummary"]["pdfMode"] | undefined): string {
  return value === "responses_api_pdf" ? "Responses API PDF" : "Codex text extract";
}

function labelArtifactKind(value: ArtifactEntry["kind"]): string {
  switch (value) {
    case "json":
      return "JSON";
    case "pdf":
      return "PDF";
    default:
      return toHeadline(value);
  }
}

function statusToneClass(status?: string): string {
  switch (status) {
    case "completed":
      return "is-success";
    case "running":
    case "active":
      return "is-active";
    case "failed":
      return "is-danger";
    case "paused":
    case "pending":
      return "is-neutral";
    default:
      return "is-neutral";
  }
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "No timestamp";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function toHeadline(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
