import type { AgentDefinition } from "./types";

export const agentRegistry: AgentDefinition[] = [
  {
    id: "central-brain",
    name: "Central Brain",
    lane: "brain",
    purpose: "Orchestrates the workflow, owns scoring policy, and routes work between specialist agents.",
    inputs: ["GenerationRequest", "agent registry", "stock policy"],
    outputs: ["execution plan", "trace", "final readiness decision"]
  },
  {
    id: "prompt-strategist",
    name: "Prompt Strategist",
    lane: "strategy",
    purpose: "Turns a raw idea into a stock-safe production prompt with commercial framing.",
    inputs: ["raw prompt", "style", "market"],
    outputs: ["optimized prompt", "concept tags", "negative constraints"]
  },
  {
    id: "scene-detail-agent",
    name: "Scene Detail Agent",
    lane: "strategy",
    purpose: "Expands short scene prompts into rich visual taxonomies before reference search and image generation.",
    inputs: ["raw prompt", "market", "style", "audience"],
    outputs: ["detail categories", "visual detail items", "search-ready component anchors"]
  },
  {
    id: "moodboard-agent",
    name: "Mood Board Agent",
    lane: "strategy",
    purpose: "Breaks the scene into visible components, gathers licensed references, and turns selected references into variation-ready visual anchors.",
    inputs: ["raw prompt", "market", "style", "reference search results", "user selections"],
    outputs: ["component matrix", "reference mood board", "variation prompts", "selected visual anchors"]
  },
  {
    id: "visual-director",
    name: "Visual Director",
    lane: "strategy",
    purpose: "Defines composition, lighting, subject clarity, and aspect-ratio intent before rendering.",
    inputs: ["optimized prompt", "aspect ratio", "audience"],
    outputs: ["visual brief", "composition checks"]
  },
  {
    id: "market-analyst",
    name: "Market Analyst",
    lane: "strategy",
    purpose: "Scores usefulness for stock buyers and maps the image to likely categories and use cases.",
    inputs: ["concept tags", "market", "audience"],
    outputs: ["category", "buyer use cases", "marketability score"]
  },
  {
    id: "compliance-auditor",
    name: "Compliance Auditor",
    lane: "quality",
    purpose: "Flags trademark, likeness, release, sensitive-content, and AI-stock rejection risks.",
    inputs: ["raw prompt", "optimized prompt", "concept tags"],
    outputs: ["risk list", "release notes", "hard-block gates"]
  },
  {
    id: "image-generator",
    name: "Image Generator",
    lane: "generation",
    purpose: "Creates the source image through OpenAI Image API or a deterministic local demo renderer.",
    inputs: ["optimized prompt", "render settings"],
    outputs: ["source image", "generation metadata"]
  },
  {
    id: "technical-inspector",
    name: "Technical Inspector",
    lane: "quality",
    purpose: "Checks dimensions, megapixels, format, file size, alpha channel, and output consistency.",
    inputs: ["source image", "target stock profile"],
    outputs: ["technical gates", "deliverable image"]
  },
  {
    id: "metadata-editor",
    name: "Metadata Editor",
    lane: "packaging",
    purpose: "Builds title, description, category, keyword set, and rejection-risk notes.",
    inputs: ["prompt plan", "market analysis", "compliance notes"],
    outputs: ["metadata.json", "metadata.csv"]
  },
  {
    id: "packaging-agent",
    name: "Packaging Agent",
    lane: "packaging",
    purpose: "Bundles image, metadata, and readiness report into a stock-submission package.",
    inputs: ["deliverable image", "metadata", "readiness report"],
    outputs: ["package.zip", "artifact links"]
  },
  {
    id: "iteration-lab",
    name: "Iteration Lab",
    lane: "learning",
    purpose: "Runs repeated critique passes and preserves the improvement trail for product planning.",
    inputs: ["architecture", "quality gates", "agent trace"],
    outputs: ["iteration log", "score lift", "roadmap changes"]
  }
];
