import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Download,
  FileJson,
  Image,
  Images,
  PackageCheck,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  WandSparkles
} from "lucide-react";
import type {
  AgentDefinition,
  GenerationRequest,
  GenerationResult,
  MarketplaceId,
  MoodboardPlan,
  MoodboardReference,
  MoodboardSelection,
  QualityGate
} from "../shared/types";
import { MoodBoardCanvas } from "./MoodBoardCanvas";
import "./styles.css";

const defaultRequest: GenerationRequest = {
  prompt: "ทีมงานสตาร์ทอัพกำลังประชุมวางแผนผลิตภัณฑ์ในออฟฟิศสว่างทันสมัย มีพื้นที่ว่างสำหรับข้อความทางการตลาด",
  negativePrompt: "โลโก้ แบรนด์ ข้อความอ่านได้ ลายน้ำ คนดัง ตัวละครมีลิขสิทธิ์",
  marketplace: "adobe-stock",
  market: "global commercial stock",
  style: "realistic editorial-commercial photography",
  audience: "marketing teams",
  aspectRatio: "landscape",
  quality: "high",
  mode: "strict-stock",
  transparentBackground: false
};

const promptExamples = [
  {
    label: "Bookstore",
    prompt: "ร้านหนังสือ"
  },
  {
    label: "Chinese restaurant",
    prompt: "ตัวละครคนในร้านอาหารจีน มีผู้ชาย ผู้หญิง พ่อครัว โต๊ะ เก้าอี้ กำแพง จานชาม และศาลเจ้า"
  },
  {
    label: "Eco workspace",
    prompt: "พื้นที่ทำงานรักษ์โลก มีโต๊ะไม้ รีไซเคิลแพ็กเกจจิ้ง ต้นไม้ แสงธรรมชาติ และคนทำงานออกแบบผลิตภัณฑ์"
  }
];

function App() {
  const [request, setRequest] = React.useState<GenerationRequest>(defaultRequest);
  const [agents, setAgents] = React.useState<AgentDefinition[]>([]);
  const [marketplaces, setMarketplaces] = React.useState<Array<{ id: MarketplaceId; label: string; acceptsAi: boolean }>>([]);
  const [result, setResult] = React.useState<GenerationResult | null>(null);
  const [moodboard, setMoodboard] = React.useState<MoodboardPlan | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = React.useState<Set<string>>(new Set());
  const [removedAssetIds, setRemovedAssetIds] = React.useState<Set<string>>(new Set());
  const [activeVariationId, setActiveVariationId] = React.useState<string | null>(null);
  const [moodboardLoading, setMoodboardLoading] = React.useState(false);
  const [moodboardError, setMoodboardError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/agents")
      .then((response) => response.json())
      .then((data: { agents: AgentDefinition[] }) => setAgents(data.agents))
      .catch(() => setAgents([]));
    fetch("/api/marketplaces")
      .then((response) => response.json())
      .then((data: { marketplaces: Array<{ id: MarketplaceId; label: string; acceptsAi: boolean }> }) => setMarketplaces(data.marketplaces))
      .catch(() => setMarketplaces([]));
  }, []);

  const activeVariation = React.useMemo(
    () => moodboard?.variations.find((variation) => variation.id === activeVariationId),
    [activeVariationId, moodboard]
  );
  const selectedMoodboardCount = React.useMemo(
    () => moodboard?.assets.filter((asset) => selectedAssetIds.has(asset.id) && !removedAssetIds.has(asset.id)).length ?? 0,
    [moodboard, removedAssetIds, selectedAssetIds]
  );

  async function buildMoodboard() {
    setMoodboardLoading(true);
    setMoodboardError(null);

    try {
      const response = await fetch("/api/moodboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: request.prompt,
          market: request.market,
          style: request.style,
          audience: request.audience,
          maxComponents: 12
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? "Moodboard failed");
      }

      const plan = data as MoodboardPlan;
      setMoodboard(plan);
      setSelectedAssetIds(new Set(plan.assets.filter((asset) => asset.selectedByDefault).map((asset) => asset.id)));
      setRemovedAssetIds(new Set());
      setActiveVariationId(plan.variations[0]?.id ?? null);
    } catch (caught) {
      setMoodboardError(caught instanceof Error ? caught.message : "Moodboard failed");
    } finally {
      setMoodboardLoading(false);
    }
  }

  function toggleMoodboardAsset(assetId: string) {
    if (removedAssetIds.has(assetId)) return;
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  function removeMoodboardAsset(assetId: string) {
    setRemovedAssetIds((current) => new Set(current).add(assetId));
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      next.delete(assetId);
      return next;
    });
  }

  function restoreMoodboardAssets() {
    if (!moodboard) return;
    setRemovedAssetIds(new Set());
    setSelectedAssetIds(new Set(moodboard.assets.map((asset) => asset.id)));
  }

  function buildMoodboardSelection(): MoodboardSelection | undefined {
    if (!moodboard) return undefined;

    const keptAssets = moodboard.assets.filter((asset) => selectedAssetIds.has(asset.id) && !removedAssetIds.has(asset.id));
    if (keptAssets.length === 0) return undefined;

    const keptComponentIds = new Set(keptAssets.map((asset) => asset.componentId));
    const detailBriefs = moodboard.sceneDetails
      .flatMap((category) =>
        category.items.map((item) => ({
          ...item,
          categoryTitle: category.title
        }))
      )
      .filter((item) => item.required || keptComponentIds.has(item.id))
      .map((item) => `${item.categoryTitle} - ${item.label}: ${item.promptPhrase}`);
    const references: MoodboardReference[] = keptAssets.map((asset) => ({
      assetId: asset.id,
      componentId: asset.componentId,
      componentLabel: asset.componentLabel,
      title: asset.title,
      creator: asset.creator,
      license: asset.license,
      licenseUrl: asset.licenseUrl,
      sourceUrl: asset.sourceUrl,
      imageUrl: asset.imageUrl,
      searchQuery: asset.searchQuery
    }));

    return {
      planId: moodboard.id,
      keptAssetIds: keptAssets.map((asset) => asset.id),
      removedAssetIds: [...removedAssetIds],
      componentBriefs: detailBriefs.slice(0, 36),
      variationPrompt: activeVariation?.prompt,
      references
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, moodboard: buildMoodboardSelection() })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? "Generation failed");
      }
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar" aria-label="Workspace status">
        <div>
          <p className="eyebrow">Stock Image Agent Lab</p>
          <h1>สร้างภาพพร้อม QC สำหรับขาย stock</h1>
        </div>
        <div className="status-strip">
          <StatusItem icon={<BrainCircuit size={18} />} label="Central Brain" value={`${agents.length || 10} agents`} />
          <StatusItem
            icon={<Images size={18} />}
            label="Mood Board"
            value={moodboard ? `${selectedMoodboardCount}/${moodboard.assets.length} kept` : "standby"}
          />
          <StatusItem icon={<ShieldCheck size={18} />} label="Readiness" value={result ? `${result.readinessScore}%` : "standby"} />
          <StatusItem icon={<RefreshCw size={18} />} label="Iteration" value="1,000 passes" />
        </div>
      </section>

      <section className="workspace-grid">
        <form className="composer tool-panel" onSubmit={submit}>
          <div className="panel-heading">
            <Sparkles size={19} />
            <h2>Prompt Studio</h2>
          </div>

          <label className="field">
            <span>ข้อความตั้งต้น</span>
            <textarea
              value={request.prompt}
              onChange={(event) => setRequest({ ...request, prompt: event.target.value })}
              minLength={8}
              maxLength={1600}
              required
            />
          </label>

          <div className="example-rail" aria-label="Prompt examples">
            {promptExamples.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => {
                  setRequest({ ...request, prompt: example.prompt });
                  setMoodboard(null);
                  setSelectedAssetIds(new Set());
                  setRemovedAssetIds(new Set());
                  setActiveVariationId(null);
                }}
              >
                {example.label}
              </button>
            ))}
          </div>

          <div className="moodboard-control">
            <div className="mini-heading">
              <Images size={17} />
              <span>Mood Board Agent</span>
            </div>
            <button
              className="secondary-action"
              type="button"
              onClick={buildMoodboard}
              disabled={moodboardLoading || request.prompt.trim().length < 8}
            >
              {moodboardLoading ? <RefreshCw className="spin" size={18} /> : <Search size={18} />}
              <span>{moodboardLoading ? "กำลังรวบรวม" : "สร้าง Mood board"}</span>
            </button>
            {moodboard ? (
              <div className="board-stat-row">
                <span>{moodboard.sceneDetails.length} groups</span>
                <span>{moodboard.components.length} anchors</span>
                <span>{selectedMoodboardCount} kept</span>
              </div>
            ) : null}
            {moodboardError ? (
              <div className="error-line" role="alert">
                <AlertTriangle size={17} />
                <span>{moodboardError}</span>
              </div>
            ) : null}
          </div>

          <label className="field">
            <span>Negative prompt</span>
            <textarea
              className="compact-textarea"
              value={request.negativePrompt}
              onChange={(event) => setRequest({ ...request, negativePrompt: event.target.value })}
              maxLength={800}
            />
          </label>

          <div className="field-grid">
            <label className="field">
              <span>เว็บ Stock</span>
              <select
                value={request.marketplace}
                onChange={(event) => setRequest({ ...request, marketplace: event.target.value as MarketplaceId })}
              >
                {(marketplaces.length ? marketplaces : fallbackMarketplaces).map((marketplace) => (
                  <option key={marketplace.id} value={marketplace.id}>
                    {marketplace.label}{marketplace.acceptsAi ? "" : " (blocked)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ตลาด</span>
              <input value={request.market} onChange={(event) => setRequest({ ...request, market: event.target.value })} />
            </label>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>ผู้ซื้อ</span>
              <input value={request.audience} onChange={(event) => setRequest({ ...request, audience: event.target.value })} />
            </label>
            <label className="field">
              <span>สไตล์</span>
              <input value={request.style} onChange={(event) => setRequest({ ...request, style: event.target.value })} />
            </label>
          </div>

          <div className="control-group" aria-label="Aspect ratio">
            <span>สัดส่วน</span>
            <Segmented
              value={request.aspectRatio}
              options={[
                ["landscape", "3:2"],
                ["square", "1:1"],
                ["portrait", "2:3"]
              ]}
              onChange={(value) => setRequest({ ...request, aspectRatio: value as GenerationRequest["aspectRatio"] })}
            />
          </div>

          <div className="control-group" aria-label="Quality">
            <span>คุณภาพ</span>
            <Segmented
              value={request.quality}
              options={[
                ["high", "High"],
                ["medium", "Med"],
                ["low", "Low"]
              ]}
              onChange={(value) => setRequest({ ...request, quality: value as GenerationRequest["quality"] })}
            />
          </div>

          <div className="control-group" aria-label="Mode">
            <span>โหมด</span>
            <Segmented
              value={request.mode}
              options={[
                ["strict-stock", "Strict"],
                ["balanced", "Balanced"],
                ["creative", "Creative"]
              ]}
              onChange={(value) => setRequest({ ...request, mode: value as GenerationRequest["mode"] })}
            />
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={request.transparentBackground}
              onChange={(event) => setRequest({ ...request, transparentBackground: event.target.checked })}
            />
            <span>Transparent background</span>
          </label>

          <button className="primary-action" type="submit" disabled={loading}>
            {loading ? <RefreshCw className="spin" size={19} /> : <Play size={19} />}
            <span>{loading ? "กำลังประมวลผล" : moodboard ? "Run with mood board" : "Run pipeline"}</span>
          </button>

          {error ? (
            <div className="error-line" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          ) : null}
        </form>

        <section className="preview-zone">
          <section className="moodboard-stage" aria-label="Mood board workspace">
            <div className="board-header">
              <div>
                <p className="eyebrow">Mood Board</p>
                <h2>{moodboard?.summary ?? "Reference canvas standby"}</h2>
              </div>
              <div className="asset-actions">
                <button
                  className={`icon-action ${!moodboard ? "disabled" : ""}`}
                  type="button"
                  onClick={restoreMoodboardAssets}
                  disabled={!moodboard}
                  title="Restore references"
                >
                  <Undo2 size={18} />
                </button>
              </div>
            </div>

            {moodboard ? (
              <>
                <SceneDetailPanel moodboard={moodboard} />
                <MoodBoardCanvas
                  assets={moodboard.assets}
                  selectedAssetIds={selectedAssetIds}
                  removedAssetIds={removedAssetIds}
                  onToggleAsset={toggleMoodboardAsset}
                  onRemoveAsset={removeMoodboardAsset}
                />
                <ComponentRail moodboard={moodboard} selectedAssetIds={selectedAssetIds} removedAssetIds={removedAssetIds} />
                <VariationRail
                  variations={moodboard.variations}
                  activeVariationId={activeVariationId}
                  onSelect={setActiveVariationId}
                />
                <SourceNotes notes={moodboard.sourceNotes} warnings={moodboard.warnings} />
              </>
            ) : (
              <div className="empty-board">
                <Images size={42} />
                <span>Mood board canvas</span>
              </div>
            )}
          </section>

          <div className="preview-frame output-frame">
            {result ? (
              <img src={result.artifacts.imageUrl} alt={result.metadata.title} />
            ) : (
              <div className="empty-preview" aria-label="Preview placeholder">
                <Image size={54} />
                <span>รอผลลัพธ์</span>
              </div>
            )}
          </div>

          <div className="metadata-band">
            <div>
              <p className="eyebrow">Title</p>
              <h2>{result?.metadata.title ?? "Stock-ready title จะปรากฏที่นี่"}</h2>
            </div>
            <div className="asset-actions">
              <a className={`icon-action ${!result ? "disabled" : ""}`} href={result?.artifacts.packageUrl ?? "#"} download title="Download package">
                <PackageCheck size={18} />
              </a>
              <a className={`icon-action ${!result ? "disabled" : ""}`} href={result?.artifacts.metadataUrl ?? "#"} target="_blank" rel="noreferrer" title="Open metadata">
                <FileJson size={18} />
              </a>
              <a className={`icon-action ${!result ? "disabled" : ""}`} href={result?.artifacts.imageUrl ?? "#"} download title="Download image">
                <Download size={18} />
              </a>
            </div>
          </div>

          {result ? <KeywordRail keywords={result.metadata.keywords} /> : null}
          {result ? <PolicyNotes notes={result.metadata.marketplaceNotes} /> : null}
        </section>

        <aside className="inspector tool-panel">
          <div className="panel-heading">
            <SlidersHorizontal size={19} />
            <h2>Readiness</h2>
          </div>

          <ScoreBlock result={result} loading={loading} />

          <div className="gate-list">
            {(result?.gates ?? placeholderGates).map((gate) => (
              <GateRow key={gate.id} gate={gate} />
            ))}
          </div>

          <div className="agent-trace">
            <h3>Agent trace</h3>
            {(result?.agents ?? agents.slice(0, 7).map((agent) => ({
              id: agent.id,
              name: agent.name,
              status: "skipped" as const,
              durationMs: 0,
              scoreDelta: 0,
              notes: [agent.purpose],
              outputs: {}
            }))).map((agent) => (
              <div className="agent-row" key={agent.id}>
                <span className={`agent-dot ${agent.status}`} />
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.notes[0]}</small>
                </div>
                <em>{agent.scoreDelta > 0 ? `+${agent.scoreDelta}` : agent.scoreDelta}</em>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="status-item">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          className={value === optionValue ? "active" : ""}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ScoreBlock({ result, loading }: { result: GenerationResult | null; loading: boolean }) {
  const score = result?.readinessScore ?? 0;
  const label = result?.readinessLabel ?? (loading ? "กำลังตรวจ" : "ยังไม่เริ่ม");
  return (
    <div className="score-block">
      <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}>
        <strong>{score || "--"}</strong>
      </div>
      <div>
        <span>{label}</span>
        <small>{result?.demoMode ? "Demo renderer" : result ? "OpenAI image API" : "Pipeline standby"}</small>
      </div>
    </div>
  );
}

function GateRow({ gate }: { gate: QualityGate }) {
  const Icon = gate.status === "pass" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`gate-row ${gate.status}`}>
      <Icon size={17} />
      <div>
        <strong>{gate.title}</strong>
        <small>{gate.detail}</small>
      </div>
      <span>{gate.score}</span>
    </div>
  );
}

function KeywordRail({ keywords }: { keywords: string[] }) {
  return (
    <div className="keyword-rail" aria-label="Keywords">
      {keywords.slice(0, 18).map((keyword) => (
        <span key={keyword}>{keyword}</span>
      ))}
    </div>
  );
}

function PolicyNotes({ notes }: { notes: string[] }) {
  return (
    <div className="policy-notes">
      {notes.slice(0, 4).map((note) => (
        <span key={note}>{note}</span>
      ))}
    </div>
  );
}

function SceneDetailPanel({ moodboard }: { moodboard: MoodboardPlan }) {
  const detailCount = moodboard.sceneDetails.reduce((sum, category) => sum + category.items.length, 0);
  return (
    <section className="scene-detail-panel" aria-label="Scene detail agent output">
      <div className="scene-detail-header">
        <div>
          <p className="eyebrow">Scene Detail Agent</p>
          <h3>
            {moodboard.sceneDetails.length} หมวด / {detailCount} รายละเอียด
          </h3>
        </div>
        <span>{moodboard.detailSource === "ai" ? `AI: ${moodboard.detailModel}` : "Local fallback"}</span>
      </div>
      <div className="scene-detail-grid">
        {moodboard.sceneDetails.map((category) => (
          <article className="detail-category" key={category.id}>
            <div>
              <strong>{category.title}</strong>
              <small>{category.titleEn}</small>
            </div>
            <p>{category.purpose}</p>
            <div className="detail-item-list">
              {category.items.slice(0, 9).map((item) => (
                <span className={item.required ? "required" : ""} key={item.id} title={item.promptPhrase}>
                  {item.label}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ComponentRail({
  moodboard,
  selectedAssetIds,
  removedAssetIds
}: {
  moodboard: MoodboardPlan;
  selectedAssetIds: Set<string>;
  removedAssetIds: Set<string>;
}) {
  return (
    <div className="component-rail" aria-label="Mood board elements">
      {moodboard.components.map((component) => {
        const keptCount = moodboard.assets.filter(
          (asset) => asset.componentId === component.id && selectedAssetIds.has(asset.id) && !removedAssetIds.has(asset.id)
        ).length;
        return (
          <span className={keptCount ? "active" : ""} key={component.id}>
            {component.label}
            <strong>{keptCount}</strong>
          </span>
        );
      })}
    </div>
  );
}

function VariationRail({
  variations,
  activeVariationId,
  onSelect
}: {
  variations: MoodboardPlan["variations"];
  activeVariationId: string | null;
  onSelect: (variationId: string) => void;
}) {
  return (
    <div className="variation-rail" aria-label="Mood board variations">
      {variations.map((variation) => (
        <button
          key={variation.id}
          type="button"
          className={variation.id === activeVariationId ? "active" : ""}
          onClick={() => onSelect(variation.id)}
          title={variation.prompt}
        >
          <WandSparkles size={15} />
          <span>{variation.title}</span>
          <small>{variation.emphasis}</small>
        </button>
      ))}
    </div>
  );
}

function SourceNotes({ notes, warnings }: { notes: string[]; warnings: string[] }) {
  return (
    <div className="source-notes">
      {[...warnings, ...notes].slice(0, 4).map((note) => (
        <span key={note}>{note}</span>
      ))}
    </div>
  );
}

const placeholderGates: QualityGate[] = [
  { id: "prompt", title: "Prompt compliance", status: "review", score: 0, detail: "รอ prompt" },
  { id: "resolution", title: "Resolution", status: "review", score: 0, detail: "รอ render" },
  { id: "metadata", title: "Metadata quality", status: "review", score: 0, detail: "รอ metadata" }
];

const fallbackMarketplaces: Array<{ id: MarketplaceId; label: string; acceptsAi: boolean }> = [
  { id: "adobe-stock", label: "Adobe Stock", acceptsAi: true },
  { id: "dreamstime", label: "Dreamstime", acceptsAi: true },
  { id: "vecteezy", label: "Vecteezy", acceptsAi: true },
  { id: "123rf", label: "123RF", acceptsAi: true },
  { id: "shutterstock", label: "Shutterstock", acceptsAi: false },
  { id: "alamy", label: "Alamy", acceptsAi: false },
  { id: "generic-stock", label: "Generic Stock Package", acceptsAi: true }
];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
