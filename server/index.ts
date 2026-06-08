import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentRegistry } from "../shared/agents";
import { runStockImagePipeline } from "./orchestrator";
import { marketplaceOptions } from "./lib/marketplaces";
import { buildMoodboardPlan, createMoodboardProxyImage } from "./lib/moodboard";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputRoot = path.join(rootDir, "outputs");
const port = Number(process.env.PORT ?? 8787);

await fs.mkdir(outputRoot, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use("/outputs", express.static(outputRoot));

const requestSchema = z.object({
  prompt: z.string().min(8).max(1600),
  negativePrompt: z.string().max(800).default(""),
  marketplace: z.enum(["adobe-stock", "dreamstime", "vecteezy", "123rf", "shutterstock", "alamy", "generic-stock"]).default("adobe-stock"),
  market: z.string().min(1).max(120).default("global commercial stock"),
  style: z.string().min(1).max(120).default("clean realistic commercial photography"),
  audience: z.string().min(1).max(120).default("marketing teams"),
  aspectRatio: z.enum(["square", "landscape", "portrait"]).default("landscape"),
  quality: z.enum(["low", "medium", "high"]).default("high"),
  mode: z.enum(["balanced", "strict-stock", "creative"]).default("strict-stock"),
  transparentBackground: z.boolean().default(false),
  moodboard: z
    .object({
      planId: z.string().min(1).max(80),
      keptAssetIds: z.array(z.string().min(1).max(80)).max(40),
      removedAssetIds: z.array(z.string().min(1).max(80)).max(80),
      componentBriefs: z.array(z.string().min(1).max(280)).max(40),
      variationPrompt: z.string().max(1200).optional(),
      references: z
        .array(
          z.object({
            assetId: z.string().min(1).max(80),
            componentId: z.string().min(1).max(80),
            componentLabel: z.string().min(1).max(140),
            title: z.string().min(1).max(220),
            creator: z.string().max(180),
            license: z.string().max(120),
            licenseUrl: z.string().max(500).optional(),
            sourceUrl: z.string().max(800),
            imageUrl: z.string().max(1000),
            searchQuery: z.string().max(240)
          })
        )
        .max(40)
    })
    .optional()
});

const moodboardRequestSchema = z.object({
  prompt: z.string().min(8).max(1600),
  market: z.string().min(1).max(120).default("global commercial stock"),
  style: z.string().min(1).max(120).default("clean realistic commercial photography"),
  audience: z.string().min(1).max(120).default("marketing teams"),
  maxComponents: z.number().int().min(4).max(16).optional()
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    app: "stock-image-agent-lab",
    demoMode: process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY,
    agents: agentRegistry.length
  });
});

app.get("/api/agents", (_request, response) => {
  response.json({ agents: agentRegistry });
});

app.get("/api/marketplaces", (_request, response) => {
  response.json({ marketplaces: marketplaceOptions() });
});

app.post("/api/moodboards", async (request, response) => {
  const parsed = moodboardRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid moodboard request",
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    response.json(
      await buildMoodboardPlan(parsed.data, {
        demoMode: process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        textModel: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5"
      })
    );
  } catch (error) {
    response.status(500).json({
      error: "Moodboard agent failed",
      message: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

app.get("/api/moodboards/image", async (request, response) => {
  const rawUrl = typeof request.query.url === "string" ? request.query.url : "";
  if (!rawUrl) {
    response.status(400).json({ error: "Missing image url" });
    return;
  }

  try {
    const image = await createMoodboardProxyImage(rawUrl);
    response.setHeader("Cache-Control", "public, max-age=1800");
    response.type(image.contentType).send(image.buffer);
  } catch (error) {
    response.status(502).json({
      error: "Moodboard image proxy failed",
      message: error instanceof Error ? error.message : "Unknown image proxy error"
    });
  }
});

app.post("/api/projects", async (request, response) => {
  const parsed = requestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid generation request",
      details: parsed.error.flatten()
    });
    return;
  }

  try {
    const result = await runStockImagePipeline(parsed.data, {
      outputRoot,
      publicOutputBase: "/outputs",
      demoMode: process.env.DEMO_MODE === "true",
      openaiApiKey: process.env.OPENAI_API_KEY,
      imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
      textModel: process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5"
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: "Pipeline failed",
      message: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.get("*", async (_request, response, next) => {
  try {
    await fs.access(path.join(distDir, "index.html"));
    response.sendFile(path.join(distDir, "index.html"));
  } catch {
    next();
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Stock Image Agent Lab API running at http://127.0.0.1:${port}`);
});
