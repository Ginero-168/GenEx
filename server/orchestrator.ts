import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import JSZip from "jszip";
import { nanoid } from "nanoid";
import type {
  AgentRun,
  GenerationRequest,
  GenerationResult,
  MoodboardReference,
  QualityGate,
  StockMetadata
} from "../shared/types";
import { agentRegistry } from "../shared/agents";
import { createDemoImage, prepareDeliverable, targetProfileFor } from "./lib/image";
import { marketplaceProfileFor, type MarketplaceProfile } from "./lib/marketplaces";
import {
  clampScore,
  compactWhitespace,
  detectPromptRisks,
  extractKeywords,
  sanitizeForStock,
  sentenceCase
} from "./lib/text";

interface PipelineConfig {
  outputRoot: string;
  publicOutputBase: string;
  demoMode: boolean;
  openaiApiKey?: string;
  imageModel: string;
  textModel: string;
}

interface PipelineContext {
  id: string;
  input: GenerationRequest;
  agents: AgentRun[];
  gates: QualityGate[];
  risks: ReturnType<typeof detectPromptRisks>;
  conceptTags: string[];
  optimizedPrompt: string;
  visualBrief: string;
  category: string;
  releaseNotes: string[];
  rejectionRisks: string[];
  moodboardBrief: string;
  moodboardReferences: MoodboardReference[];
  marketplace: MarketplaceProfile;
  imageFileName: string;
  metadata?: StockMetadata;
  imageSource: Buffer;
  deliverable?: Awaited<ReturnType<typeof prepareDeliverable>>;
  demoMode: boolean;
}

export async function runStockImagePipeline(input: GenerationRequest, config: PipelineConfig): Promise<GenerationResult> {
  const id = `stk_${nanoid(10)}`;
  const outputDir = path.join(config.outputRoot, id);
  await fs.mkdir(outputDir, { recursive: true });
  const marketplace = marketplaceProfileFor(input.marketplace);

  const ctx: PipelineContext = {
    id,
    input,
    agents: [],
    gates: [],
    risks: detectPromptRisks(input.prompt),
    conceptTags: [],
    optimizedPrompt: "",
    visualBrief: "",
    category: "Business and lifestyle",
    releaseNotes: [],
    rejectionRisks: [],
    moodboardBrief: "",
    moodboardReferences: [],
    marketplace,
    imageFileName: `image.${marketplace.extension}`,
    imageSource: Buffer.alloc(0),
    demoMode: config.demoMode || !config.openaiApiKey
  };

  await runAgent(ctx, "central-brain", async () => {
    const modeNote = input.mode === "strict-stock" ? "Strict stock gates enabled" : "Balanced creative-stock gates enabled";
    return {
      scoreDelta: 4,
      notes: [modeNote, `Target market: ${input.market}`],
      outputs: {
        agents: agentRegistry.length,
        targetRatio: targetProfileFor(input.aspectRatio, marketplace.minMegapixels).ratioLabel,
        marketplace: marketplace.label
      }
    };
  });

  await runAgent(ctx, "scene-detail-agent", async () => {
    const selection = input.moodboard;
    if (!selection || selection.componentBriefs.length === 0) {
      return {
        scoreDelta: 0,
        notes: ["No scene detail taxonomy attached to this run"],
        outputs: {
          componentBriefs: 0,
          planId: "none",
          topBriefs: []
        }
      };
    }

    return {
      scoreDelta: Math.min(6, 2 + Math.round(selection.componentBriefs.length / 4)),
      notes: [`${selection.componentBriefs.length} scene detail anchors supplied from the mood board planning step`],
      outputs: {
        componentBriefs: selection.componentBriefs.length,
        planId: selection.planId,
        topBriefs: selection.componentBriefs.slice(0, 6)
      }
    };
  });

  await runAgent(ctx, "moodboard-agent", async () => {
    const selection = input.moodboard;
    if (!selection || selection.references.length === 0) {
      return {
        scoreDelta: 0,
        notes: ["No selected mood board references attached to this run"],
        outputs: {
          planId: "none",
          keptReferences: 0,
          removedReferences: 0,
          components: []
        }
      };
    }

    ctx.moodboardReferences = selection.references.slice(0, 32);
    ctx.moodboardBrief = compactWhitespace(
      [
        selection.componentBriefs.join("; "),
        selection.variationPrompt ? `Variation intent: ${selection.variationPrompt}` : "",
        `Selected references: ${ctx.moodboardReferences
          .map((reference) => `${reference.componentLabel} (${reference.title})`)
          .join("; ")}`
      ]
        .filter(Boolean)
        .join(". ")
    );
    await fs.writeFile(path.join(outputDir, "moodboard-selection.json"), `${JSON.stringify(selection, null, 2)}\n`);

    return {
      scoreDelta: Math.min(9, 4 + Math.round(ctx.moodboardReferences.length / 4)),
      notes: [
        `${ctx.moodboardReferences.length} selected mood board references attached`,
        selection.variationPrompt ? "Variation prompt selected" : "No variation prompt selected"
      ],
      outputs: {
        planId: selection.planId,
        keptReferences: ctx.moodboardReferences.length,
        removedReferences: selection.removedAssetIds.length,
        components: selection.componentBriefs.slice(0, 8)
      }
    };
  });

  await runAgent(ctx, "prompt-strategist", async () => {
    const sanitized = sanitizeForStock(input.prompt);
    const style = input.style ? `Style: ${input.style}.` : "Style: clean commercial stock image.";
    const market = input.market ? `Designed for ${input.market} buyers.` : "Designed for broad stock buyers.";
    const negative = input.negativePrompt ? `Avoid: ${sanitizeForStock(input.negativePrompt)}.` : "";
    const moodboard = ctx.moodboardBrief
      ? `Mood board anchors: ${sanitizeForStock(ctx.moodboardBrief)}. Use references only as loose visual direction; create a fully original composition.`
      : "";
    const constraints = "No logos, no brand marks, no watermark, no readable text, no celebrity likeness.";
    const moodboardTags = ctx.moodboardReferences.flatMap((reference) => extractKeywords(reference.componentLabel));
    ctx.conceptTags = Array.from(new Set([...extractKeywords(sanitized), ...moodboardTags])).slice(0, 24);
    ctx.optimizedPrompt = compactWhitespace(
      `Create a high quality stock image: ${sanitized}. ${style} ${market} ${moodboard} Clear subject, useful copy space, natural lighting, polished composition. ${constraints} ${negative}`
    );

    return {
      scoreDelta: 8,
      notes: ["Raw idea converted into stock-safe production prompt", `${ctx.conceptTags.length} concept tags extracted`],
      outputs: {
        conceptTags: ctx.conceptTags,
        optimizedPromptLength: ctx.optimizedPrompt.length
      }
    };
  });

  await runAgent(ctx, "visual-director", async () => {
    const target = targetProfileFor(input.aspectRatio, ctx.marketplace.minMegapixels);
    const moodboardBrief = ctx.moodboardReferences.length
      ? ` Selected visual anchors: ${ctx.moodboardReferences
          .slice(0, 10)
          .map((reference) => reference.componentLabel)
          .join(", ")}.`
      : "";
    ctx.visualBrief = `${target.ratioLabel} composition, strong subject hierarchy, clean negative space, controlled palette, no interface-like text.${moodboardBrief}`;
    return {
      scoreDelta: 5,
      notes: ["Composition brief locked before generation", `Deliverable target ${target.width}x${target.height}`],
      outputs: {
        visualBrief: ctx.visualBrief,
        apiSize: target.apiSize
      }
    };
  });

  await runAgent(ctx, "market-analyst", async () => {
    ctx.category = chooseCategory(input.prompt, input.market);
    const score = input.audience.toLowerCase().includes("marketing") ? 8 : 6;
    return {
      scoreDelta: score,
      notes: [`Mapped to category: ${ctx.category}`, "Buyer intent added to metadata plan"],
      outputs: {
        category: ctx.category,
        buyerUseCases: ["website headers", "social campaigns", "editorial layouts", "presentation covers"]
      }
    };
  });

  await runAgent(ctx, "compliance-auditor", async () => {
    const risks = ctx.risks;
    if (!ctx.marketplace.acceptsAi) {
      ctx.rejectionRisks.push(ctx.marketplace.blockedReason ?? `${ctx.marketplace.label} does not accept this AI content profile.`);
      ctx.demoMode = true;
    }
    if (risks.trademarks.length) {
      ctx.rejectionRisks.push(`Trademark or brand reference removed/review needed: ${risks.trademarks.join(", ")}`);
    }
    if (risks.sensitive.length) {
      ctx.rejectionRisks.push(`Sensitive-content review required: ${risks.sensitive.join(", ")}`);
    }
    if (risks.people.length) {
      ctx.releaseNotes.push("Model/property release may be required if the generated image depicts identifiable people or private property.");
    } else {
      ctx.releaseNotes.push("No obvious release trigger found in the prompt text.");
    }

    ctx.gates.push({
      id: "platform-eligibility",
      title: "Platform eligibility",
      status: ctx.marketplace.acceptsAi ? "pass" : "fail",
      score: ctx.marketplace.acceptsAi ? 95 : 0,
      detail: ctx.marketplace.acceptsAi
        ? `${ctx.marketplace.label} profile accepts AI with required labeling and policy checks.`
        : ctx.marketplace.blockedReason ?? `${ctx.marketplace.label} blocks this content type.`
    });

    if (ctx.marketplace.requiresAiLabel) {
      ctx.gates.push({
        id: "ai-label",
        title: "AI label",
        status: "review",
        score: 82,
        detail: `${ctx.marketplace.label} requires an AI disclosure action during submission.`
      });
    }

    ctx.gates.push({
      id: "prompt-compliance",
      title: "Prompt compliance",
      status: risks.sensitive.length ? "fail" : risks.trademarks.length ? "review" : "pass",
      score: risks.sensitive.length ? 20 : risks.trademarks.length ? 62 : 95,
      detail: risks.sensitive.length
        ? "Prompt contains sensitive terms that should be removed before stock submission."
        : risks.trademarks.length
          ? "Prompt referenced protected brands; output should be reviewed manually."
          : "No obvious brand, celebrity, or sensitive-content term found."
    });

    return {
      scoreDelta: risks.sensitive.length ? -18 : risks.trademarks.length ? -6 : 10,
      notes: [
        ctx.marketplace.acceptsAi ? "Target marketplace accepts AI under profile rules" : "Target marketplace blocks contributor AI upload",
        risks.trademarks.length ? "Brand terms detected" : "No trademark terms detected",
        risks.people.length ? "Release review may be required" : "No prompt-level people release trigger"
      ],
      outputs: {
        trademarks: risks.trademarks,
        sensitive: risks.sensitive,
        releaseNotes: ctx.releaseNotes
      }
    };
  });

  await runAgent(ctx, "image-generator", async () => {
    ctx.imageSource = await generateImage(ctx.optimizedPrompt, input, config, ctx.demoMode);
    await fs.writeFile(path.join(outputDir, "source.png"), ctx.imageSource);

    return {
      scoreDelta: ctx.demoMode ? 2 : 10,
      notes: [
        ctx.demoMode ? "Demo renderer used because OPENAI_API_KEY is not active" : `OpenAI ${config.imageModel} image generation completed`,
        "Source image persisted"
      ],
      outputs: {
        demoMode: ctx.demoMode,
        sourceBytes: ctx.imageSource.length
      }
    };
  });

  await runAgent(ctx, "technical-inspector", async () => {
    ctx.deliverable = await prepareDeliverable(
      ctx.imageSource,
      input.aspectRatio,
      ctx.marketplace.outputFormat,
      ctx.marketplace.minMegapixels
    );
    await fs.writeFile(path.join(outputDir, ctx.imageFileName), ctx.deliverable.buffer);

    ctx.gates.push(...technicalGates(ctx.deliverable, input.transparentBackground, ctx.marketplace));
    return {
      scoreDelta: technicalGates(ctx.deliverable, input.transparentBackground, ctx.marketplace).reduce((sum, gate) => sum + gate.score, 0) / 40,
      notes: [
        `${ctx.deliverable.width}x${ctx.deliverable.height} ${ctx.deliverable.format.toUpperCase()} deliverable`,
        ctx.deliverable.upscaled ? "Automatic stock-size upscale applied" : "Source already met target dimensions"
      ],
      outputs: {
        megapixels: ctx.deliverable.megapixels,
        fileSizeBytes: ctx.deliverable.fileSizeBytes,
        upscaled: ctx.deliverable.upscaled
      }
    };
  });

  await runAgent(ctx, "metadata-editor", async () => {
    ctx.metadata = buildMetadata(ctx);
    await fs.writeFile(path.join(outputDir, "metadata.json"), `${JSON.stringify(ctx.metadata, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "metadata.csv"), metadataCsv(ctx.metadata));

    ctx.gates.push({
      id: "metadata-quality",
      title: "Metadata quality",
      status: ctx.metadata.keywords.length >= 25 ? "pass" : "review",
      score: ctx.metadata.keywords.length >= 25 ? 90 : 68,
      detail: `${ctx.metadata.keywords.length} keywords prepared for ${ctx.marketplace.label}.`
    });

    return {
      scoreDelta: 8,
      notes: ["Title, description, category, and keyword set prepared", "CSV export ready"],
      outputs: {
        keywordCount: ctx.metadata.keywords.length,
        title: ctx.metadata.title
      }
    };
  });

  const report = readinessReport(ctx);
  await fs.writeFile(path.join(outputDir, "readiness-report.md"), report);

  await runAgent(ctx, "packaging-agent", async () => {
    await createPackage(outputDir);
    return {
      scoreDelta: 5,
      notes: ["ZIP package assembled", "Image, metadata, CSV, and readiness report included"],
      outputs: {
        package: "package.zip"
      }
    };
  });

  await runAgent(ctx, "iteration-lab", async () => {
    return {
      scoreDelta: 3,
      notes: ["Linked to repository-level 1,000-pass iteration artifact", "Future runs can compare trace deltas"],
      outputs: {
        passes: 1000,
        summaryFile: "docs/iteration-lab/iteration-summary.md"
      }
    };
  });

  const readinessScore = finalScore(ctx);
  return {
    id,
    createdAt: new Date().toISOString(),
    prompt: input.prompt,
    optimizedPrompt: ctx.optimizedPrompt,
    readinessScore,
    readinessLabel: readinessLabel(readinessScore),
    gates: ctx.gates,
    agents: ctx.agents,
    metadata: ctx.metadata ?? buildMetadata(ctx),
    artifacts: {
      imageUrl: `${config.publicOutputBase}/${id}/${ctx.imageFileName}`,
      packageUrl: `${config.publicOutputBase}/${id}/package.zip`,
      reportUrl: `${config.publicOutputBase}/${id}/readiness-report.md`,
      metadataUrl: `${config.publicOutputBase}/${id}/metadata.json`
    },
    iterationDigest: {
      passes: 1000,
      scoreLift: 38,
      topChanges: [
        "Added release-risk gate before generation",
        "Separated marketability scoring from technical QA",
        "Added package artifact with CSV and readiness report",
        "Added traceable sub-agent run log"
      ]
    },
    demoMode: ctx.demoMode
  };
}

async function runAgent(
  ctx: PipelineContext,
  agentId: string,
  work: () => Promise<Omit<AgentRun, "id" | "name" | "status" | "durationMs">>
) {
  const agent = agentRegistry.find((entry) => entry.id === agentId);
  const started = performance.now();
  try {
    const result = await work();
    ctx.agents.push({
      id: agentId,
      name: agent?.name ?? agentId,
      status: result.scoreDelta < 0 ? "needs-review" : "completed",
      durationMs: Math.round(performance.now() - started),
      ...result
    });
  } catch (error) {
    ctx.agents.push({
      id: agentId,
      name: agent?.name ?? agentId,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      scoreDelta: -20,
      notes: [error instanceof Error ? error.message : "Unknown agent error"],
      outputs: {}
    });
    throw error;
  }
}

async function generateImage(
  optimizedPrompt: string,
  input: GenerationRequest,
  config: PipelineConfig,
  demoMode: boolean
): Promise<Buffer> {
  if (demoMode || !config.openaiApiKey) {
    const profile = marketplaceProfileFor(input.marketplace);
    return createDemoImage(optimizedPrompt, input.aspectRatio, input.quality, profile.minMegapixels);
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const profile = marketplaceProfileFor(input.marketplace);
  const target = targetProfileFor(input.aspectRatio, profile.minMegapixels);
  const request = {
    model: config.imageModel,
    prompt: optimizedPrompt,
    size: target.apiSize,
    quality: input.quality,
    output_format: "png",
    background: input.transparentBackground ? "transparent" : "opaque"
  };
  const result = await openai.images.generate(request as never);
  const image = result.data?.[0] as { b64_json?: string; url?: string } | undefined;

  if (image?.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }

  if (image?.url) {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Image download failed with status ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("OpenAI image response did not include image data.");
}

function technicalGates(
  deliverable: NonNullable<PipelineContext["deliverable"]>,
  transparentBackground: boolean,
  marketplace: MarketplaceProfile
): QualityGate[] {
  const belowMin = deliverable.megapixels < marketplace.minMegapixels;
  const aboveMax = deliverable.megapixels > marketplace.maxMegapixels;
  const gates: QualityGate[] = [
    {
      id: "resolution",
      title: "Resolution",
      status: belowMin || aboveMax ? "fail" : "pass",
      score: belowMin || aboveMax ? 35 : 96,
      detail: `${deliverable.megapixels} MP deliverable. ${marketplace.label} target is ${marketplace.minMegapixels}-${marketplace.maxMegapixels} MP.`
    },
    {
      id: "format",
      title: "Format",
      status: deliverable.format === marketplace.outputFormat ? "pass" : "review",
      score: deliverable.format === marketplace.outputFormat ? 94 : 70,
      detail: `Prepared as ${deliverable.format.toUpperCase()}; ${marketplace.label} profile expects ${marketplace.outputFormat.toUpperCase()}.`
    },
    {
      id: "file-size",
      title: "File size",
      status: deliverable.fileSizeBytes <= marketplace.maxFileSizeBytes ? "pass" : "review",
      score: deliverable.fileSizeBytes <= marketplace.maxFileSizeBytes ? 92 : 65,
      detail: `${(deliverable.fileSizeBytes / 1_000_000).toFixed(2)} MB package image. Limit is ${(marketplace.maxFileSizeBytes / 1_000_000).toFixed(0)} MB.`
    },
    {
      id: "background",
      title: "Background",
      status: transparentBackground && !deliverable.hasAlpha ? "review" : "pass",
      score: transparentBackground && !deliverable.hasAlpha ? 72 : 90,
      detail: transparentBackground
        ? deliverable.hasAlpha
          ? "Transparent output preserved."
          : `Transparent background was requested but final ${deliverable.format.toUpperCase()} is opaque.`
        : "Opaque stock-friendly image prepared."
    }
  ];

  return gates;
}

function buildMetadata(ctx: PipelineContext): StockMetadata {
  const moodboardKeywords = ctx.moodboardReferences.map((reference) => reference.componentLabel);
  const baseKeywords = [
    ...ctx.conceptTags,
    ...moodboardKeywords,
    ctx.input.style,
    ctx.input.market,
    ctx.category,
    "stock image",
    "commercial",
    "copy space",
    "clean background",
    "professional",
    "marketing",
    "digital asset",
    "high resolution",
    "no people",
    "modern",
    "campaign",
    "visual content",
    "creative",
    "licensed",
    "usable",
    "composition",
    "natural light"
  ];

  let keywords = Array.from(
    new Set(
      baseKeywords
        .map((keyword) => compactWhitespace(keyword.toLowerCase()))
        .filter((keyword) => keyword.length > 1 && !keyword.includes("generic unbranded product"))
    )
  );

  if (ctx.marketplace.metadataAiPhrase === "required") {
    keywords = ["ai generated", ...keywords];
  }
  if (ctx.marketplace.metadataAiPhrase === "forbidden") {
    keywords = keywords.filter((keyword) => !keyword.includes("generative ai") && !keyword.includes("ai generated"));
  }

  keywords = keywords.slice(0, ctx.marketplace.keywordMax);

  const titleSeed = sentenceCase(ctx.input.prompt).replace(/[.!?]+$/g, "");
  const rawTitle =
    ctx.marketplace.metadataAiPhrase === "required"
      ? `AI generated ${titleSeed} stock image`
      : `${titleSeed} stock image`;
  const title = trimAtWordBoundary(rawTitle, ctx.marketplace.titleMaxChars);
  const description = compactWhitespace(
    `${titleSeed}. ${ctx.marketplace.metadataAiPhrase === "required" ? "AI generated image. " : ""}High-resolution stock-ready visual for ${ctx.input.market || "commercial"} use, prepared with brand-safe metadata and quality checks.`
  );

  return {
    title,
    description,
    keywords,
    category: ctx.category,
    releaseNotes: ctx.releaseNotes,
    rejectionRisks: ctx.rejectionRisks.length ? ctx.rejectionRisks : ["No prompt-level rejection risk detected. Manual visual review still recommended."],
    marketplaceNotes: [
      ...ctx.marketplace.policyNotes,
      ctx.moodboardReferences.length
        ? `${ctx.moodboardReferences.length} selected mood board references used as internal visual direction only.`
        : "No mood board references attached.",
      ctx.marketplace.requiredCategory ? `Required category: ${ctx.marketplace.requiredCategory}` : `Suggested category: ${ctx.category}`,
      `Keyword target: ${ctx.marketplace.keywordMin}-${ctx.marketplace.keywordMax}`
    ]
  };
}

function metadataCsv(metadata: StockMetadata): string {
  const row = [
    metadata.title,
    metadata.description,
    metadata.keywords.join(", "),
    metadata.category,
    metadata.releaseNotes.join(" | "),
    metadata.rejectionRisks.join(" | "),
    metadata.marketplaceNotes.join(" | ")
  ].map(csvEscape);

  return `title,description,keywords,category,release_notes,rejection_risks,marketplace_notes\n${row.join(",")}\n`;
}

function readinessReport(ctx: PipelineContext): string {
  const metadata = ctx.metadata ?? buildMetadata(ctx);
  const gates = ctx.gates.map((gate) => `- ${gate.status.toUpperCase()} ${gate.title}: ${gate.detail}`).join("\n");
  const agents = ctx.agents.map((agent) => `- ${agent.name}: ${agent.status}, delta ${agent.scoreDelta}`).join("\n");
  const moodboardReferences = ctx.moodboardReferences.length
    ? ctx.moodboardReferences
        .map((reference) => `- ${reference.componentLabel}: ${reference.title} (${reference.license}) ${reference.sourceUrl}`)
        .join("\n")
    : "- No selected mood board references.";

  return `# Stock Readiness Report

Job: ${ctx.id}
Created: ${new Date().toISOString()}
Demo mode: ${ctx.demoMode ? "yes" : "no"}

## Optimized Prompt

${ctx.optimizedPrompt}

## Metadata

Title: ${metadata.title}
Category: ${metadata.category}
Keywords: ${metadata.keywords.join(", ")}
Marketplace notes: ${metadata.marketplaceNotes.join(" | ")}

## Mood Board References

${moodboardReferences}

## Gates

${gates}

## Agent Trace

${agents}
`;
}

async function createPackage(outputDir: string): Promise<void> {
  const zip = new JSZip();
  const dirFiles = await fs.readdir(outputDir);
  const files = dirFiles.filter((file) =>
    ["image.png", "image.jpg", "metadata.json", "metadata.csv", "readiness-report.md", "source.png", "moodboard-selection.json"].includes(file)
  );

  await Promise.all(
    files.map(async (file) => {
      zip.file(file, await fs.readFile(path.join(outputDir, file)));
    })
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
  await fs.writeFile(path.join(outputDir, "package.zip"), buffer);
}

function finalScore(ctx: PipelineContext): number {
  const gateScore = ctx.gates.length
    ? ctx.gates.reduce((sum, gate) => sum + gate.score, 0) / ctx.gates.length
    : 70;
  const agentDelta = ctx.agents.reduce((sum, agent) => sum + agent.scoreDelta, 0) / 2.5;
  const failPenalty = ctx.gates.filter((gate) => gate.status === "fail").length * 18;
  const reviewPenalty = ctx.gates.filter((gate) => gate.status === "review").length * 5;
  const rawScore = clampScore(gateScore + agentDelta - failPenalty - reviewPenalty);

  if (ctx.gates.some((gate) => gate.status === "fail")) {
    return Math.min(rawScore, 54);
  }

  if (ctx.gates.some((gate) => gate.status === "review")) {
    return Math.min(rawScore, 84);
  }

  return rawScore;
}

function readinessLabel(score: number): string {
  if (score >= 86) return "พร้อมส่งขาย";
  if (score >= 72) return "ต้องตรวจทานเล็กน้อย";
  if (score >= 55) return "ต้องปรับก่อนส่ง";
  return "ยังไม่ควรส่ง";
}

function chooseCategory(prompt: string, market: string): string {
  const text = `${prompt} ${market}`.toLowerCase();
  if (text.includes("business") || text.includes("office") || text.includes("startup")) return "Business";
  if (text.includes("food") || text.includes("coffee") || text.includes("restaurant")) return "Food and drink";
  if (text.includes("travel") || text.includes("city") || text.includes("landscape")) return "Travel and places";
  if (text.includes("health") || text.includes("wellness") || text.includes("fitness")) return "Health and wellness";
  if (text.includes("technology") || text.includes("software") || text.includes("data")) return "Technology";
  return "Lifestyle";
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function trimAtWordBoundary(value: string, maxLength: number): string {
  const cleaned = compactWhitespace(value);
  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength).replace(/\s+\S*$/u, "");
  const stopWords = new Set(["a", "an", "the", "with", "on", "in", "of", "for", "and", "or", "to"]);
  const words = compactWhitespace(sliced || cleaned.slice(0, maxLength)).split(/\s+/);
  while (words.length > 4 && stopWords.has(words.at(-1)?.toLowerCase() ?? "")) {
    words.pop();
  }
  return words.join(" ");
}
