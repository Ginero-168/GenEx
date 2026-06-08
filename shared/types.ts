export type GateStatus = "pass" | "review" | "fail";

export type PipelineMode = "balanced" | "strict-stock" | "creative";

export type AspectRatio = "square" | "landscape" | "portrait";

export type RenderQuality = "low" | "medium" | "high";

export type MoodboardRole =
  | "human"
  | "place"
  | "prop"
  | "decor"
  | "food"
  | "lighting"
  | "composition"
  | "texture";

export type MarketplaceId =
  | "adobe-stock"
  | "dreamstime"
  | "vecteezy"
  | "123rf"
  | "shutterstock"
  | "alamy"
  | "generic-stock";

export interface GenerationRequest {
  prompt: string;
  negativePrompt: string;
  marketplace: MarketplaceId;
  market: string;
  style: string;
  audience: string;
  aspectRatio: AspectRatio;
  quality: RenderQuality;
  mode: PipelineMode;
  transparentBackground: boolean;
  moodboard?: MoodboardSelection;
}

export interface MoodboardRequest {
  prompt: string;
  market: string;
  style: string;
  audience: string;
  maxComponents?: number;
}

export interface MoodboardComponent {
  id: string;
  label: string;
  role: MoodboardRole;
  promptPhrase: string;
  searchQuery: string;
  required: boolean;
  rationale: string;
}

export interface MoodboardDetailItem {
  id: string;
  label: string;
  role: MoodboardRole;
  promptPhrase: string;
  searchQuery: string;
  required: boolean;
  rationale: string;
}

export interface MoodboardDetailCategory {
  id: string;
  title: string;
  titleEn: string;
  purpose: string;
  items: MoodboardDetailItem[];
}

export interface MoodboardAsset {
  id: string;
  componentId: string;
  componentLabel: string;
  role: MoodboardRole;
  title: string;
  imageUrl: string;
  previewUrl: string;
  sourceUrl: string;
  creator: string;
  creatorUrl?: string;
  license: string;
  licenseUrl?: string;
  source: string;
  width?: number;
  height?: number;
  searchQuery: string;
  relevanceScore: number;
  selectedByDefault: boolean;
}

export interface MoodboardVariation {
  id: string;
  title: string;
  prompt: string;
  emphasis: string;
  componentIds: string[];
}

export interface MoodboardPlan {
  id: string;
  createdAt: string;
  prompt: string;
  summary: string;
  detailSource: "ai" | "local";
  detailModel: string;
  sceneDetails: MoodboardDetailCategory[];
  components: MoodboardComponent[];
  assets: MoodboardAsset[];
  variations: MoodboardVariation[];
  sourceNotes: string[];
  warnings: string[];
}

export interface MoodboardReference {
  assetId: string;
  componentId: string;
  componentLabel: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl?: string;
  sourceUrl: string;
  imageUrl: string;
  searchQuery: string;
}

export interface MoodboardSelection {
  planId: string;
  keptAssetIds: string[];
  removedAssetIds: string[];
  componentBriefs: string[];
  variationPrompt?: string;
  references: MoodboardReference[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  lane: "brain" | "strategy" | "generation" | "quality" | "packaging" | "learning";
  purpose: string;
  inputs: string[];
  outputs: string[];
}

export interface AgentRun {
  id: string;
  name: string;
  status: "completed" | "skipped" | "needs-review" | "failed";
  durationMs: number;
  scoreDelta: number;
  notes: string[];
  outputs: Record<string, string | number | boolean | string[]>;
}

export interface QualityGate {
  id: string;
  title: string;
  status: GateStatus;
  score: number;
  detail: string;
}

export interface StockMetadata {
  title: string;
  description: string;
  keywords: string[];
  category: string;
  releaseNotes: string[];
  rejectionRisks: string[];
  marketplaceNotes: string[];
}

export interface ArtifactLinks {
  imageUrl: string;
  packageUrl: string;
  reportUrl: string;
  metadataUrl: string;
}

export interface GenerationResult {
  id: string;
  createdAt: string;
  prompt: string;
  optimizedPrompt: string;
  readinessScore: number;
  readinessLabel: string;
  gates: QualityGate[];
  agents: AgentRun[];
  metadata: StockMetadata;
  artifacts: ArtifactLinks;
  iterationDigest: {
    passes: number;
    scoreLift: number;
    topChanges: string[];
  };
  demoMode: boolean;
}
