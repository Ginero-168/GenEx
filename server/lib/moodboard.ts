import { Buffer } from "node:buffer";
import net from "node:net";
import { nanoid } from "nanoid";
import type sharp from "sharp";
import type {
  MoodboardAsset,
  MoodboardComponent,
  MoodboardDetailCategory,
  MoodboardDetailItem,
  MoodboardPlan,
  MoodboardRequest,
  MoodboardRole,
  MoodboardVariation
} from "../../shared/types";
import { compactWhitespace, extractKeywords, sanitizeForStock } from "./text";

const openverseImageEndpoint = "https://api.openverse.org/v1/images/";
const maxAssetsPerComponent = 2;
const maxProxyBytes = 12 * 1024 * 1024;
const validRoles: MoodboardRole[] = ["human", "place", "prop", "decor", "food", "lighting", "composition", "texture"];
const proxyCache = new Map<string, { buffer: Buffer; contentType: string; cachedAt: number }>();

type Sharp = typeof sharp;

let sharpInstance: Sharp | undefined;

async function loadSharp(): Promise<Sharp> {
  sharpInstance ??= (await import("sharp")).default;
  return sharpInstance;
}

interface OpenverseImage {
  id: string;
  title?: string;
  foreign_landing_url?: string;
  url?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  provider?: string;
  source?: string;
  height?: number;
  width?: number;
  thumbnail?: string;
  detail_url?: string;
  mature?: boolean;
}

interface OpenverseResponse {
  results?: OpenverseImage[];
}

interface MoodboardBuildConfig {
  demoMode: boolean;
  openaiApiKey?: string;
  textModel: string;
}

interface SceneDetailBuild {
  source: "ai" | "local";
  model: string;
  categories: MoodboardDetailCategory[];
  warnings: string[];
}

interface AiSceneDetailResponse {
  categories?: Array<{
    id?: string;
    title?: string;
    titleEn?: string;
    purpose?: string;
    items?: Array<{
      id?: string;
      label?: string;
      role?: MoodboardRole;
      promptPhrase?: string;
      searchQuery?: string;
      required?: boolean;
      rationale?: string;
    }>;
  }>;
}

export async function buildMoodboardPlan(input: MoodboardRequest, config?: MoodboardBuildConfig): Promise<MoodboardPlan> {
  const prompt = compactWhitespace(input.prompt);
  const detailBuild = await buildSceneDetails(input, config);
  const components = selectMoodboardComponents(detailBuild.categories, input).slice(0, clampComponentCount(input.maxComponents));
  const warnings: string[] = [...detailBuild.warnings];

  const batches = await Promise.all(
    components.map(async (component) => {
      try {
        const assets = await fetchOpenverseAssets(component);
        if (assets.length === 0) {
          warnings.push(`No Openverse reference found for ${component.label}.`);
          return [fallbackAsset(component, prompt)];
        }
        return assets;
      } catch (error) {
        warnings.push(
          `Reference search failed for ${component.label}: ${error instanceof Error ? error.message : "unknown error"}.`
        );
        return [fallbackAsset(component, prompt)];
      }
    })
  );

  const assets = dedupeAssets(batches.flat()).slice(0, 24);
  const variations = buildVariations(prompt, components, input, detailBuild.categories);
  const itemCount = detailBuild.categories.reduce((sum, category) => sum + category.items.length, 0);

  return {
    id: `mb_${nanoid(10)}`,
    createdAt: new Date().toISOString(),
    prompt,
    summary: `${detailBuild.categories.length} detail categories, ${itemCount} visual details, ${assets.length} mood board references, ${variations.length} variation prompts.`,
    detailSource: detailBuild.source,
    detailModel: detailBuild.model,
    sceneDetails: detailBuild.categories,
    components,
    assets,
    variations,
    sourceNotes: [
      "Reference search uses Openverse image search with a commercial-license filter first, then broader Openverse fallback if no reference is found.",
      "Reference images are for visual direction and attribution tracking, not final stock deliverables.",
      "Openverse license metadata should still be manually verified before direct reuse."
    ],
    warnings
  };
}

export async function createMoodboardProxyImage(rawUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const sharp = await loadSharp();
  const parsed = parseSafeRemoteUrl(rawUrl);
  const cacheKey = parsed.toString();
  const cached = proxyCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 1000 * 60 * 30) {
    return { buffer: cached.buffer, contentType: cached.contentType };
  }

  const response = await fetch(parsed, {
    headers: {
      "User-Agent": "StockImageAgentLab/0.1 moodboard-proxy"
    },
    signal: AbortSignal.timeout(9000)
  });

  if (!response.ok) {
    throw new Error(`Reference image fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Reference URL did not return an image.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxProxyBytes) {
    throw new Error("Reference image is too large for preview proxy.");
  }

  const rawBuffer = Buffer.from(await response.arrayBuffer());
  if (rawBuffer.byteLength > maxProxyBytes) {
    throw new Error("Reference image is too large for preview proxy.");
  }

  const buffer = await sharp(rawBuffer, { animated: false })
    .rotate()
    .resize({ width: 720, height: 520, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  const result = { buffer, contentType: "image/jpeg" };
  proxyCache.set(cacheKey, { ...result, cachedAt: Date.now() });
  return result;
}

async function buildSceneDetails(input: MoodboardRequest, config?: MoodboardBuildConfig): Promise<SceneDetailBuild> {
  if (config?.openaiApiKey && !config.demoMode) {
    try {
      const categories = await callAiSceneDetailAgent(input, config);
      return {
        source: "ai",
        model: config.textModel,
        categories,
        warnings: []
      };
    } catch (error) {
      return {
        source: "local",
        model: "local-scene-detail-template",
        categories: fallbackSceneDetails(input),
        warnings: [`AI Scene Detail Agent fallback used: ${error instanceof Error ? error.message : "unknown error"}.`]
      };
    }
  }

  return {
    source: "local",
    model: "local-scene-detail-template",
    categories: fallbackSceneDetails(input),
    warnings: ["Local Scene Detail Agent fallback used because OPENAI_API_KEY is not active."]
  };
}

async function callAiSceneDetailAgent(input: MoodboardRequest, config: MoodboardBuildConfig): Promise<MoodboardDetailCategory[]> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.textModel,
      input: [
        {
          role: "system",
          content:
            "You are a senior visual research agent for stock image production. Expand a short scene prompt into rich, concrete, stock-safe visual details before mood board search. Return only structured JSON that matches the schema. Use Thai labels with useful English search queries. Do not include brands, copyrighted characters, readable text, or celebrity likeness."
        },
        {
          role: "user",
          content: compactWhitespace(
            `Scene prompt: ${input.prompt}\nMarket: ${input.market}\nAudience: ${input.audience}\nStyle: ${input.style}\nCreate 4 to 6 categories. Each category needs 5 to 9 concrete visible items. Cover people/characters, furniture/structures, objects/props, decor/materials, mood/lighting/color, and composition when relevant.`
          )
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_detail_taxonomy",
          strict: true,
          schema: sceneDetailJsonSchema()
        }
      }
    }),
    signal: AbortSignal.timeout(16000)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI scene detail request failed with status ${response.status}: ${message.slice(0, 180)}`);
  }

  const data = await response.json();
  const parsed = JSON.parse(extractResponseText(data)) as AiSceneDetailResponse;
  return normalizeAiSceneDetails(parsed, input);
}

function sceneDetailJsonSchema() {
  const itemSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "role", "promptPhrase", "searchQuery", "required", "rationale"],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      role: { enum: validRoles },
      promptPhrase: { type: "string" },
      searchQuery: { type: "string" },
      required: { type: "boolean" },
      rationale: { type: "string" }
    }
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["categories"],
    properties: {
      categories: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "titleEn", "purpose", "items"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            titleEn: { type: "string" },
            purpose: { type: "string" },
            items: {
              type: "array",
              minItems: 5,
              maxItems: 9,
              items: itemSchema
            }
          }
        }
      }
    }
  };
}

function extractResponseText(data: unknown): string {
  const maybe = data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof maybe.output_text === "string" && maybe.output_text.trim()) {
    return maybe.output_text;
  }

  const text = maybe.output
    ?.flatMap((entry) => entry.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");

  if (!text) {
    throw new Error("OpenAI scene detail response did not include JSON text.");
  }
  return text;
}

function normalizeAiSceneDetails(parsed: AiSceneDetailResponse, input: MoodboardRequest): MoodboardDetailCategory[] {
  const categories = (parsed.categories ?? [])
    .map((rawCategory, categoryIndex) => {
      const categoryId = slug(rawCategory.id || rawCategory.titleEn || rawCategory.title || `category-${categoryIndex + 1}`);
      const items = (rawCategory.items ?? [])
        .map((rawItem, itemIndex) => {
          const label = compactWhitespace(rawItem.label ?? "");
          const promptPhrase = compactWhitespace(rawItem.promptPhrase ?? label);
          const role = validRoles.includes(rawItem.role as MoodboardRole) ? (rawItem.role as MoodboardRole) : inferRole(categoryId, label);
          return detailItem(
            categoryId,
            itemIndex,
            label || `Visual detail ${itemIndex + 1}`,
            role,
            promptPhrase,
            compactWhitespace(rawItem.searchQuery ?? `${input.prompt} ${label}`),
            rawItem.required ?? itemIndex < 3,
            compactWhitespace(rawItem.rationale ?? "Useful visual anchor for stock image generation.")
          );
        })
        .filter((item) => item.label.length > 1)
        .slice(0, 9);

      return category(
        categoryId,
        compactWhitespace(rawCategory.title ?? rawCategory.titleEn ?? `Visual Category ${categoryIndex + 1}`),
        compactWhitespace(rawCategory.titleEn ?? rawCategory.title ?? `Visual Category ${categoryIndex + 1}`),
        compactWhitespace(rawCategory.purpose ?? "Scene detail expansion for mood board search."),
        items
      );
    })
    .filter((entry) => entry.items.length >= 3)
    .slice(0, 6);

  if (categories.length < 3) {
    throw new Error("OpenAI scene detail response was too sparse.");
  }

  return categories;
}

function fallbackSceneDetails(input: MoodboardRequest): MoodboardDetailCategory[] {
  const prompt = compactWhitespace(input.prompt);
  const haystack = `${prompt} ${input.market} ${input.style} ${input.audience}`.toLowerCase();

  if (isBookstoreScene(haystack)) {
    return bookstoreSceneDetails();
  }

  if (isChineseRestaurantScene(haystack)) {
    return chineseRestaurantSceneDetails();
  }

  const keywords = extractKeywords(sanitizeForStock(prompt)).slice(0, 8);
  const keywordQuery = keywords.join(" ") || "commercial stock scene";

  return genericSceneDetails(keywordQuery, hasAny(haystack, ["person", "people", "portrait", "model", "man", "woman", "คน", "ผู้ชาย", "ผู้หญิง", "พนักงาน", "ลูกค้า"]));
}

function selectMoodboardComponents(categories: MoodboardDetailCategory[], input: MoodboardRequest): MoodboardComponent[] {
  const max = clampComponentCount(input.maxComponents);
  const selected: MoodboardComponent[] = [];
  const seen = new Set<string>();
  const rounds = Math.max(...categories.map((category) => category.items.length), 0);

  for (let index = 0; index < rounds && selected.length < max; index += 1) {
    for (const categoryEntry of categories) {
      const requiredItems = categoryEntry.items.filter((item) => item.required);
      const optionalItems = categoryEntry.items.filter((item) => !item.required);
      const itemEntry = [...requiredItems, ...optionalItems][index];
      if (!itemEntry || seen.has(itemEntry.id)) continue;
      selected.push(componentFromDetailItem(itemEntry));
      seen.add(itemEntry.id);
      if (selected.length >= max) break;
    }
  }

  return selected;
}

function componentFromDetailItem(itemEntry: MoodboardDetailItem): MoodboardComponent {
  return component(
    itemEntry.id,
    itemEntry.label,
    itemEntry.role,
    itemEntry.promptPhrase,
    itemEntry.searchQuery,
    itemEntry.required,
    itemEntry.rationale
  );
}

function relaxedQueriesFor(component: MoodboardComponent): string[] {
  const label = component.label.toLowerCase();
  const search = component.searchQuery.toLowerCase();
  const bookstoreContext = hasAny(`${label} ${search}`, ["ร้านหนังสือ", "bookstore", "bookshop", "library", "bookshelf", "bookshelves", "หนังสือ"]);
  const chineseRestaurantContext = hasAny(`${label} ${search}`, ["ร้านอาหารจีน", "chinese restaurant", "chinese", "ตะเกียบ", "จานชาม"]);
  const queries = [component.searchQuery];

  if (bookstoreContext && hasAny(label, ["พนักงาน", "staff"])) {
    queries.push("bookstore staff", "bookshop owner", "retail clerk bookstore");
  }
  if (bookstoreContext && hasAny(label, ["ลูกค้า", "อ่านหนังสือ", "สวมแว่น", "customer", "reading"])) {
    queries.push("person reading in bookstore", "bookstore customer reading", "reader browsing bookshelves");
  }
  if (bookstoreContext && hasAny(label, ["ชั้นหนังสือ", "สันหนังสือ", "bookshelf", "bookshelves"])) {
    queries.push("bookstore shelves", "wooden bookshelves", "library bookshelves");
  }
  if (bookstoreContext && hasAny(label, ["บันได", "ladder"])) {
    queries.push("library ladder", "bookstore ladder", "rolling library ladder");
  }
  if (bookstoreContext && hasAny(label, ["กองหนังสือ", "ปกแข็ง", "ปกอ่อน", "เปิดกาง", "book"])) {
    queries.push("stack of books", "open book table", "books on shelves");
  }
  if (bookstoreContext && hasAny(label, ["โต๊ะ", "display", "table"])) {
    queries.push("bookstore display table", "books on table", "bookshop table");
  }
  if (bookstoreContext && hasAny(label, ["กาแฟ", "แก้ว", "coffee"])) {
    queries.push("coffee mug books", "coffee book table", "reading coffee");
  }
  if (bookstoreContext && hasAny(label, ["โคม", "แสง", "แดด", "lighting", "sunlight"])) {
    queries.push("bookstore warm lighting", "sunlight bookshelves", "library sunlight");
  }
  if (bookstoreContext && hasAny(label, ["กระถาง", "ต้นไม้", "plant"])) {
    queries.push("plants bookshelves", "bookstore plants", "library plants");
  }
  if (bookstoreContext && hasAny(label, ["ไม้", "อิฐ", "พื้น", "wood", "brick"])) {
    queries.push("wooden bookstore interior", "exposed brick bookstore", "wooden bookshelves");
  }

  if (chineseRestaurantContext) {
    queries.push("Chinese restaurant interior", "Chinese restaurant dining table", "Chinese restaurant decor");
  }
  if (chineseRestaurantContext && component.role === "food") queries.push("Chinese food dishes table");
  if (chineseRestaurantContext && component.role === "lighting") queries.push("Chinese lantern restaurant");
  if (chineseRestaurantContext && component.role === "human") queries.push("Chinese restaurant people dining");

  if (bookstoreContext && component.role === "human") queries.push("person reading books", "bookstore people");
  if (bookstoreContext && component.role === "place") queries.push("bookstore interior", "library interior");
  if (bookstoreContext && component.role === "prop") queries.push("books bookstore", "bookshop objects");
  if (bookstoreContext && component.role === "lighting") queries.push("warm library lighting", "bookstore window light");
  if (bookstoreContext && component.role === "texture") queries.push("bookshelf texture", "paper pages books");
  if (bookstoreContext) queries.push("bookstore interior", "independent bookstore", "library bookshelves");

  return Array.from(new Set(queries.map((query) => compactWhitespace(query)).filter(Boolean))).slice(0, 6);
}

function bookstoreSceneDetails(): MoodboardDetailCategory[] {
  return [
    category("characters", "ผู้คนและตัวละคร", "Characters", "Human presence, roles, actions, and release-risk cues.", [
      detailItem("characters", 0, "พนักงานร้านหนังสือใส่ผ้ากันเปื้อนหรือป้ายชื่อ", "human", "bookstore staff wearing apron or name tag", "bookstore staff apron name tag", true, "Defines service role and retail context."),
      detailItem("characters", 1, "ลูกค้ายืนอ่านหนังสือข้างชั้น", "human", "customer standing and reading near bookshelves", "bookstore customer reading aisle", true, "Adds natural browsing behavior."),
      detailItem("characters", 2, "เด็กน้อยนั่งอ่านหนังสือนิทานบนพื้น", "human", "child sitting on floor reading picture book", "child reading picture book bookstore floor", false, "Creates family-friendly lifestyle variation."),
      detailItem("characters", 3, "นักศึกษาสะพายกระเป๋ากอดหนังสือ", "human", "student with backpack holding several books", "student backpack holding books bookstore", false, "Useful education and campus buyer signal."),
      detailItem("characters", 4, "คนสวมแว่นเพ่งมองสันหนังสือ", "human", "person wearing glasses inspecting book spines", "person glasses browsing book spines", true, "Strong close-up action cue."),
      detailItem("characters", 5, "ลูกค้าจ่ายเงินที่เคาน์เตอร์", "human", "customer paying at bookstore cashier counter", "bookstore cashier customer payment", false, "Retail transaction variation.")
    ]),
    category("furniture-structures", "เฟอร์นิเจอร์และโครงสร้าง", "Furniture and Structures", "Spatial anchors, scale, pathways, and room identity.", [
      detailItem("furniture-structures", 0, "ชั้นหนังสือไม้ทรงสูงจรดเพดาน", "place", "floor to ceiling tall wooden bookshelves", "floor to ceiling wooden bookshelves bookstore", true, "Primary visual identity of a bookstore."),
      detailItem("furniture-structures", 1, "บันไดไม้มีล้อเลื่อน", "prop", "rolling wooden library ladder", "rolling wooden library ladder bookstore", true, "Distinctive vertical browsing detail."),
      detailItem("furniture-structures", 2, "โต๊ะจัดแสดงหนังสือแนะนำกลางร้าน", "prop", "central table displaying recommended books", "bookstore display table recommended books", true, "Creates merchandising focal point."),
      detailItem("furniture-structures", 3, "เก้าอี้อาร์มแชร์บุนุ่มหรือโซฟาหนังวินเทจ", "prop", "soft armchair or vintage leather sofa reading corner", "bookstore armchair vintage leather sofa reading corner", false, "Adds cozy dwell-time mood."),
      detailItem("furniture-structures", 4, "โต๊ะไม้ยาวสำหรับนั่งอ่าน", "prop", "long wooden reading table", "bookstore long wooden reading table", false, "Supports study and quiet workspace variation."),
      detailItem("furniture-structures", 5, "เคาน์เตอร์คิดเงิน", "prop", "bookstore cashier counter", "bookstore cashier counter", true, "Retail structure for commercial context."),
      detailItem("furniture-structures", 6, "หน้าต่างกระจกบานใหญ่เห็นวิวถนน", "place", "large street facing glass window", "bookstore large front window street view", false, "Adds daylight and exterior context."),
      detailItem("furniture-structures", 7, "กำแพงอิฐโชว์แนวและพื้นไม้ปาร์เกต์", "texture", "exposed brick wall and parquet wood floor", "bookstore exposed brick parquet wood floor", false, "Material palette and texture reference."),
      detailItem("furniture-structures", 8, "ทางเดินแคบระหว่างชั้นหนังสือ", "composition", "narrow aisle between bookshelves", "narrow bookstore aisle bookshelves", true, "Gives depth and perspective.")
    ]),
    category("objects-props", "สิ่งของและรายละเอียด", "Objects and Props", "Readable physical details that make the scene specific without brands.", [
      detailItem("objects-props", 0, "หนังสือปกแข็งและปกอ่อนเรียงเต็มชั้น", "prop", "hardcover and paperback books neatly arranged", "hardcover paperback books neatly arranged shelves", true, "Core product detail."),
      detailItem("objects-props", 1, "กองหนังสือซ้อนสูงบนโต๊ะหรือพื้น", "prop", "tall stacks of books on table or floor", "stacks of books bookstore table floor", true, "Adds abundance and texture."),
      detailItem("objects-props", 2, "หนังสือเปิดกางทิ้งไว้", "prop", "open book lying on reading table", "open book on bookstore reading table", false, "Useful close-up and detail crop."),
      detailItem("objects-props", 3, "ป้ายบอกหมวดหมู่หนังสือแบบไม่มีแบรนด์", "decor", "generic book category signs without readable branding", "generic bookstore category signs", false, "Navigation detail; should avoid readable protected text."),
      detailItem("objects-props", 4, "รถเข็นหนังสือขนาดเล็ก", "prop", "small book cart between shelves", "small book cart bookstore aisle", false, "Operational prop and scale cue."),
      detailItem("objects-props", 5, "ถ้วยกาแฟร้อนหรือแก้วมัคบนโต๊ะอ่าน", "prop", "hot coffee mug on reading table", "coffee mug reading table bookstore", false, "Cozy lifestyle cue."),
      detailItem("objects-props", 6, "โคมไฟตั้งโต๊ะคลาสสิกหรือโคมไฟระย้า", "lighting", "classic desk lamp or pendant light", "bookstore classic desk lamp pendant light", true, "Lighting object and mood cue."),
      detailItem("objects-props", 7, "ที่คั่นหนังสือ สมุดโน้ต และปากกา", "prop", "bookmark notebook and pen beside open book", "bookmark notebook pen open book", false, "Detail props for close-up stock variations."),
      detailItem("objects-props", 8, "ถุงผ้ารักษ์โลกแขวนโชว์", "prop", "plain tote bags hanging for display", "plain tote bags bookstore display", false, "Retail add-on prop without brand risk.")
    ]),
    category("decor-materials", "ของตกแต่งและพื้นผิว", "Decor and Materials", "Texture, wall details, natural accents, and atmosphere-building objects.", [
      detailItem("decor-materials", 0, "กระถางต้นไม้เล็กแซมตามชั้นหนังสือ", "decor", "small potted plants placed between bookshelves", "small potted plants bookshelf bookstore", false, "Adds organic color and softness."),
      detailItem("decor-materials", 1, "โปสเตอร์โปรโมทหนังสือใหม่แบบไม่มีข้อความอ่านได้", "decor", "generic new book poster with no readable text", "generic bookstore poster wall no readable text", false, "Background retail cue while staying stock-safe."),
      detailItem("decor-materials", 2, "ไม้สีน้ำตาลเข้มบนชั้นและโต๊ะ", "texture", "dark brown wood shelves and tables", "dark wood shelves tables bookstore", true, "Material palette anchor."),
      detailItem("decor-materials", 3, "กระดาษสีครีมและสันหนังสือหลากสี", "texture", "cream paper pages and varied book spines", "cream paper pages colorful book spines", true, "Close visual texture and color rhythm."),
      detailItem("decor-materials", 4, "มุมอ่านหนังสือเงียบสงบ", "composition", "quiet reading nook inside bookstore", "quiet bookstore reading nook", true, "Atmosphere and composition anchor.")
    ]),
    category("mood-lighting", "บรรยากาศ แสง และโทนสี", "Mood Lighting and Color", "Light behavior, palette, air, and emotional tone.", [
      detailItem("mood-lighting", 0, "แสงไฟสีส้มอบอุ่น", "lighting", "warm white and amber interior lighting", "warm amber bookstore lighting", true, "Defines cozy commercial mood."),
      detailItem("mood-lighting", 1, "แสงแดดยามบ่ายส่องเฉียงผ่านหน้าต่าง", "lighting", "afternoon sunlight streaming through large window", "afternoon sunlight bookstore window", true, "Natural light and cinematic depth."),
      detailItem("mood-lighting", 2, "ฝุ่นละอองเล็กสะท้อนแสงในอากาศ", "lighting", "subtle dust particles visible in sunbeams", "dust particles sunbeam bookstore", false, "Old-bookstore atmosphere cue."),
      detailItem("mood-lighting", 3, "ความเงียบสงบ อบอุ่น และน่าค้นหา", "composition", "quiet cozy curious bookstore atmosphere", "cozy quiet bookstore atmosphere", true, "High-level mood for image generation."),
      detailItem("mood-lighting", 4, "โทนสีน้ำตาลไม้ เหลืองส้ม ครีมกระดาษ และเขียวใบไม้", "texture", "brown wood amber cream paper and green plant palette", "bookstore brown wood amber cream green color palette", true, "Palette guardrail for visual consistency.")
    ])
  ];
}

function chineseRestaurantSceneDetails(): MoodboardDetailCategory[] {
  return [
    category("characters", "ผู้คนและตัวละคร", "Characters", "People and role cues for dining and service scenes.", [
      detailItem("characters", 0, "ผู้ชายจีนกำลังนั่งรับประทานอาหาร", "human", "Chinese male guest dining naturally", "Chinese man dining restaurant", true, "Human subject option."),
      detailItem("characters", 1, "ผู้หญิงจีนกำลังเลือกเมนูหรือคีบอาหาร", "human", "Chinese female guest choosing menu or picking food", "Chinese woman dining restaurant", true, "Human subject option."),
      detailItem("characters", 2, "พ่อครัวจีนกำลังเตรียมอาหาร", "human", "Chinese chef preparing food", "Chinese chef cooking", true, "Kitchen action anchor."),
      detailItem("characters", 3, "พนักงานเสิร์ฟถือจานอาหาร", "human", "restaurant server carrying dishes", "Chinese restaurant server dishes", false, "Service role variation."),
      detailItem("characters", 4, "กลุ่มลูกค้ารอบโต๊ะกลม", "human", "small group dining around round table", "Chinese restaurant group round table", false, "Lifestyle group composition.")
    ]),
    category("furniture-structures", "เฟอร์นิเจอร์และโครงสร้าง", "Furniture and Structures", "Restaurant layout and room identity.", [
      detailItem("furniture-structures", 0, "ร้านอาหารจีนภายในลึกเห็นหลายชั้นระยะ", "place", "Chinese restaurant interior with depth", "Chinese restaurant interior", true, "Primary location anchor."),
      detailItem("furniture-structures", 1, "โต๊ะกลมสำหรับรับประทานอาหาร", "prop", "round Chinese dining table", "Chinese restaurant round dining table", true, "Dining structure anchor."),
      detailItem("furniture-structures", 2, "เก้าอี้ไม้พนักโค้ง", "prop", "wooden dining chairs with curved backs", "Chinese restaurant wooden chairs", true, "Furniture style cue."),
      detailItem("furniture-structures", 3, "กำแพงไม้และลายตกแต่งจีน", "decor", "wood wall with Chinese decorative motifs", "Chinese restaurant wall decor", true, "Background identity."),
      detailItem("furniture-structures", 4, "เคาน์เตอร์รับลูกค้าหรือพื้นที่ครัวเปิด", "place", "host counter or open kitchen area", "Chinese restaurant host counter open kitchen", false, "Operational context.")
    ]),
    category("objects-props", "สิ่งของและรายละเอียด", "Objects and Props", "Dining details and cultural props.", [
      detailItem("objects-props", 0, "จานชามเซรามิกและตะเกียบบนโต๊ะ", "prop", "ceramic bowls plates and chopsticks on table", "Chinese bowls plates chopsticks", true, "Tableware detail."),
      detailItem("objects-props", 1, "อาหารจีนหลายจานเสิร์ฟร่วมกัน", "food", "multiple Chinese dishes served family style", "Chinese food dishes restaurant table", true, "Food detail."),
      detailItem("objects-props", 2, "กาน้ำชาและถ้วยชา", "prop", "Chinese teapot and teacups", "Chinese teapot teacups restaurant", false, "Authentic table prop."),
      detailItem("objects-props", 3, "เมนูแบบไม่มีข้อความอ่านได้", "prop", "generic menu without readable text", "Chinese restaurant menu no readable text", false, "Restaurant cue without text risk."),
      detailItem("objects-props", 4, "ศาลเจ้าขนาดเล็กหรือแท่นบูชา", "decor", "small respectful Chinese shrine altar detail", "Chinese shrine altar restaurant", false, "Optional cultural detail.")
    ]),
    category("mood-lighting", "บรรยากาศ แสง และโทนสี", "Mood Lighting and Color", "Lighting, palette, and atmosphere.", [
      detailItem("mood-lighting", 0, "โคมไฟจีนสีแดงและแสงอุ่น", "lighting", "warm red Chinese lantern lighting", "Chinese lantern restaurant interior", true, "Lighting identity."),
      detailItem("mood-lighting", 1, "โทนแดง ไม้น้ำตาล ทอง และครีม", "texture", "red brown wood gold and cream palette", "Chinese restaurant red gold wood palette", true, "Color guardrail."),
      detailItem("mood-lighting", 2, "บรรยากาศคึกคักแต่อบอุ่น", "composition", "warm lively restaurant atmosphere", "warm lively Chinese restaurant atmosphere", true, "Mood cue."),
      detailItem("mood-lighting", 3, "แสงสะท้อนบนจานชามและโต๊ะไม้", "lighting", "soft highlights on tableware and wood table", "restaurant tableware warm highlights", false, "Detail lighting cue.")
    ])
  ];
}

function genericSceneDetails(keywordQuery: string, hasPeople: boolean): MoodboardDetailCategory[] {
  return [
    category("characters", "ผู้คนและตัวละคร", "Characters", "People, roles, and actions if the scene benefits from human presence.", [
      detailItem("characters", 0, "ตัวแบบหลักที่แสดงบทบาทของฉาก", "human", "main human subject with natural stock-safe action", `${keywordQuery} person lifestyle`, hasPeople, "Gives the concept a clear human use case."),
      detailItem("characters", 1, "ผู้ใช้หรือลูกค้าที่โต้ตอบกับสถานที่", "human", "customer or user interacting with the environment", `${keywordQuery} customer interaction`, hasPeople, "Adds commercial storytelling."),
      detailItem("characters", 2, "ภาพมือกำลังหยิบหรือใช้งานวัตถุ", "human", "hands interacting with key object", `${keywordQuery} hands detail`, false, "Useful close-up variation.")
    ]),
    category("environment", "สถานที่และโครงสร้าง", "Environment and Structures", "Spatial layout and location anchors.", [
      detailItem("environment", 0, "มุมกว้างของสถานที่หลัก", "place", "wide view of the primary environment", `${keywordQuery} interior environment wide view`, true, "Primary location reference."),
      detailItem("environment", 1, "พื้นหลังที่สะอาดมีพื้นที่ว่างสำหรับงานโฆษณา", "composition", "clean background with copy space", `${keywordQuery} copy space background`, true, "Stock buyer usability."),
      detailItem("environment", 2, "เส้นนำสายตาและระยะลึกในภาพ", "composition", "depth lines and layered perspective", `${keywordQuery} layered perspective composition`, true, "Composition anchor.")
    ]),
    category("objects-props", "สิ่งของและรายละเอียด", "Objects and Props", "Specific objects that make the idea instantly readable.", [
      detailItem("objects-props", 0, "วัตถุหลักของแนวคิด", "prop", "primary object that communicates the concept", `${keywordQuery} main object`, true, "Core visual object."),
      detailItem("objects-props", 1, "พร็อปสนับสนุนที่ช่วยเล่าเรื่อง", "prop", "supporting props that clarify the story", `${keywordQuery} props details`, true, "Prevents generic output."),
      detailItem("objects-props", 2, "รายละเอียดพื้นผิวและวัสดุ", "texture", "material texture and tactile details", `${keywordQuery} material texture detail`, false, "Close-up reference.")
    ]),
    category("mood-lighting", "บรรยากาศ แสง และสี", "Mood Lighting and Color", "Light, palette, and emotional tone.", [
      detailItem("mood-lighting", 0, "แสงธรรมชาติหรือแสงเชิงพาณิชย์ที่ควบคุมดี", "lighting", "controlled natural or commercial lighting", `${keywordQuery} lighting color palette`, true, "Quality guardrail."),
      detailItem("mood-lighting", 1, "โทนสีที่สอดคล้องกับตลาดเป้าหมาย", "texture", "cohesive commercial color palette", `${keywordQuery} commercial color palette`, true, "Palette guardrail."),
      detailItem("mood-lighting", 2, "บรรยากาศที่ชัดเจนและจดจำง่าย", "composition", "clear memorable mood", `${keywordQuery} mood atmosphere`, true, "Emotional direction.")
    ])
  ];
}

function category(
  id: string,
  title: string,
  titleEn: string,
  purpose: string,
  items: MoodboardDetailItem[]
): MoodboardDetailCategory {
  return {
    id,
    title,
    titleEn,
    purpose,
    items
  };
}

function detailItem(
  categoryId: string,
  index: number,
  label: string,
  role: MoodboardRole,
  promptPhrase: string,
  searchQuery: string,
  required: boolean,
  rationale: string
): MoodboardDetailItem {
  return {
    id: `${categoryId}-${slug(label) || index}`,
    label,
    role,
    promptPhrase,
    searchQuery,
    required,
    rationale
  };
}

async function fetchOpenverseAssets(component: MoodboardComponent): Promise<MoodboardAsset[]> {
  const queries = relaxedQueriesFor(component);
  const assets: MoodboardAsset[] = [];
  for (const query of queries) {
    const commercialAssets = await fetchOpenverseAssetsForQuery(component, query, true);
    assets.push(...commercialAssets);
    const uniqueAssets = dedupeAssets(assets);
    if (uniqueAssets.length >= maxAssetsPerComponent) {
      return uniqueAssets.slice(0, maxAssetsPerComponent);
    }
  }

  for (const query of queries) {
    const broadAssets = await fetchOpenverseAssetsForQuery(component, query, false);
    assets.push(...broadAssets);
    const uniqueAssets = dedupeAssets(assets);
    if (uniqueAssets.length >= maxAssetsPerComponent) {
      return uniqueAssets.slice(0, maxAssetsPerComponent);
    }
  }

  return dedupeAssets(assets).slice(0, maxAssetsPerComponent);
}

async function fetchOpenverseAssetsForQuery(component: MoodboardComponent, query: string, commercialOnly: boolean): Promise<MoodboardAsset[]> {
  const url = new URL(openverseImageEndpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", "8");
  if (commercialOnly) {
    url.searchParams.set("license_type", "commercial");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "StockImageAgentLab/0.1 moodboard-agent"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Openverse returned ${response.status}`);
  }

  const data = (await response.json()) as OpenverseResponse;
  return (data.results ?? [])
    .filter((result) => result.url && !result.mature)
    .slice(0, maxAssetsPerComponent)
    .map((result, index) => toMoodboardAsset(result, component, query, index, commercialOnly));
}

function toMoodboardAsset(
  result: OpenverseImage,
  component: MoodboardComponent,
  query: string,
  index: number,
  commercialOnly: boolean
): MoodboardAsset {
  const license = compactWhitespace([result.license, result.license_version].filter(Boolean).join(" ")) || "license metadata unavailable";
  return {
    id: `asset_${nanoid(9)}`,
    componentId: component.id,
    componentLabel: component.label,
    role: component.role,
    title: compactWhitespace(result.title ?? component.label).slice(0, 140),
    imageUrl: result.url ?? "",
    previewUrl: result.url ?? result.thumbnail ?? "",
    sourceUrl: result.foreign_landing_url ?? result.detail_url ?? result.url ?? "",
    creator: compactWhitespace(result.creator ?? "Unknown creator"),
    creatorUrl: result.creator_url,
    license,
    licenseUrl: result.license_url,
    source: result.source ?? result.provider ?? "openverse",
    width: result.width,
    height: result.height,
    searchQuery: query,
    relevanceScore: Math.max(52, (commercialOnly ? 96 : 78) - index * 8),
    selectedByDefault: true
  };
}

function buildVariations(
  prompt: string,
  components: MoodboardComponent[],
  input: MoodboardRequest,
  categories: MoodboardDetailCategory[]
): MoodboardVariation[] {
  const text = `${prompt} ${input.market} ${input.style}`.toLowerCase();
  const cleanPrompt = sanitizeForStock(prompt);
  const characterPhrases = phrasesFor(categories, "Characters", 4);
  const structurePhrases = phrasesFor(categories, "Furniture", 4).concat(phrasesFor(categories, "Environment", 4));
  const objectPhrases = phrasesFor(categories, "Objects", 5);
  const moodPhrases = phrasesFor(categories, "Mood", 4);

  if (isBookstoreScene(text)) {
    return [
      variation("reading-customer", "Reading customer", `${cleanPrompt}, customer reading beside tall wooden bookshelves, warm bookstore lighting, stacked books, cozy commercial stock composition with copy space.`, "people, shelves, warm mood", components, ["characters-ลูกค้ายืนอ่านหนังสือข้างชั้น", "furniture-structures-ชั้นหนังสือไม้ทรงสูงจรดเพดาน", "mood-lighting-แสงไฟสีส้มอบอุ่น"]),
      variation("wide-interior", "Wide bookstore interior", `${cleanPrompt}, wide bookstore interior with floor-to-ceiling wooden shelves, rolling ladder, display table, narrow aisles, afternoon window light, no readable text.`, "room layout, shelves, display table", components, ["furniture-structures-ชั้นหนังสือไม้ทรงสูงจรดเพดาน", "furniture-structures-บันไดไม้มีล้อเลื่อน", "furniture-structures-โต๊ะจัดแสดงหนังสือแนะนำกลางร้าน"]),
      variation("cozy-reading-nook", "Cozy reading nook", `${cleanPrompt}, soft armchair reading corner, coffee mug, open book, plants, amber light and calm old-bookstore atmosphere, stock-ready detail.`, "armchair, coffee, open book, plants", components, ["furniture-structures-เก้าอี้อาร์มแชร์บุนุ่มหรือโซฟาหนังวินเทจ", "objects-props-ถ้วยกาแฟร้อนหรือแก้วมัคบนโต๊ะอ่าน", "decor-materials-กระถางต้นไม้เล็กแซมตามชั้นหนังสือ"]),
      variation("book-prop-detail", "Book detail", `${cleanPrompt}, close detail of hardcover and paperback stacks, open book, bookmark, notebook, pen, cream paper texture, shallow depth of field.`, "books, paper texture, detail crop", components, ["objects-props-หนังสือปกแข็งและปกอ่อนเรียงเต็มชั้น", "objects-props-กองหนังสือซ้อนสูงบนโต๊ะหรือพื้น", "objects-props-ที่คั่นหนังสือ สมุดโน้ต และปากกา"])
    ];
  }

  if (isChineseRestaurantScene(text)) {
    return [
      variation("chef-hero", "Chef hero", "Chinese chef preparing dishes in a warm Chinese restaurant, authentic tableware, red wood decor, commercial stock composition with clean copy space.", "chef, kitchen action, tableware", components, ["chinese-chef", "plates-bowls", "restaurant-interior"]),
      variation("dining-couple", "Dining guests", "Chinese man and woman dining in a Chinese restaurant, round table, bowls, chopsticks, warm lantern light, natural candid commercial photography.", "male and female guests, dining table, lantern light", components, ["chinese-man", "chinese-woman", "tables-chairs", "food-dishes"]),
      variation("interior-wide", "Interior wide", "Wide view of a Chinese restaurant interior with tables, chairs, wall decor, plates, subtle shrine detail, polished stock image with copy space.", "room layout, decor, environmental scale", components, ["restaurant-interior", "tables-chairs", "wall-decor", "shrine-altar"]),
      variation("food-detail", "Food detail", "Close commercial detail of Chinese dishes, ceramic bowls, chopsticks and warm restaurant atmosphere, no logos or readable text.", "food, plates, texture, shallow depth", components, ["food-dishes", "plates-bowls", "lantern-light"])
    ];
  }

  return [
    variation("hero-subject", "Hero subject", `${cleanPrompt}, ${characterPhrases || "clear hero subject"}, polished commercial stock lighting, clean negative space, no logos or readable text.`, "single strong subject", components, componentIdsForRole(components, "human", "composition")),
    variation("environment-wide", "Environment wide", `${cleanPrompt}, ${structurePhrases || "wider environmental composition"}, useful copy space, readable context, brand-safe details.`, "place and context", components, componentIdsForRole(components, "place", "composition")),
    variation("detail-crop", "Detail crop", `${cleanPrompt}, ${objectPhrases || "close detail crop with tactile props"}, premium texture, shallow depth of field, stock-safe background.`, "props and texture", components, componentIdsForRole(components, "prop", "texture")),
    variation("mood-lighting", "Mood and lighting", `${cleanPrompt}, ${moodPhrases || "clear memorable mood and controlled commercial lighting"}, balanced color palette, original stock-ready composition.`, "lighting and color", components, componentIdsForRole(components, "lighting", "texture"))
  ];
}

function variation(
  id: string,
  title: string,
  prompt: string,
  emphasis: string,
  components: MoodboardComponent[],
  preferredIds: string[]
): MoodboardVariation {
  const componentIds = preferredIds.filter((componentId) => components.some((component) => component.id === componentId));
  return {
    id,
    title,
    prompt: compactWhitespace(prompt),
    emphasis,
    componentIds: componentIds.length ? componentIds : components.slice(0, 4).map((component) => component.id)
  };
}

function phrasesFor(categories: MoodboardDetailCategory[], titlePattern: string, maxItems: number): string {
  const pattern = titlePattern.toLowerCase();
  return categories
    .filter((categoryEntry) => `${categoryEntry.title} ${categoryEntry.titleEn}`.toLowerCase().includes(pattern))
    .flatMap((categoryEntry) => categoryEntry.items)
    .slice(0, maxItems)
    .map((itemEntry) => itemEntry.promptPhrase)
    .join(", ");
}

function componentIdsForRole(components: MoodboardComponent[], ...roles: MoodboardRole[]): string[] {
  return components
    .filter((entry) => roles.includes(entry.role))
    .slice(0, 5)
    .map((entry) => entry.id);
}

function component(
  id: string,
  label: string,
  role: MoodboardRole,
  promptPhrase: string,
  searchQuery: string,
  required: boolean,
  rationale: string
): MoodboardComponent {
  return {
    id,
    label,
    role,
    promptPhrase,
    searchQuery,
    required,
    rationale
  };
}

function fallbackAsset(component: MoodboardComponent, prompt: string): MoodboardAsset {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 520">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#375c93"/>
          <stop offset="0.5" stop-color="#2f8f83"/>
          <stop offset="1" stop-color="#b45d48"/>
        </linearGradient>
      </defs>
      <rect width="720" height="520" fill="#edf2f4"/>
      <rect x="58" y="62" width="604" height="386" rx="28" fill="url(#g)" opacity=".86"/>
      <circle cx="196" cy="190" r="82" fill="#ffffff" opacity=".22"/>
      <rect x="316" y="154" width="234" height="52" rx="18" fill="#ffffff" opacity=".28"/>
      <rect x="196" y="288" width="328" height="64" rx="24" fill="#ffffff" opacity=".24"/>
    </svg>
  `);

  return {
    id: `asset_${nanoid(9)}`,
    componentId: component.id,
    componentLabel: component.label,
    role: component.role,
    title: `${component.label} fallback reference`,
    imageUrl: `data:image/svg+xml;charset=utf-8,${svg}`,
    previewUrl: `data:image/svg+xml;charset=utf-8,${svg}`,
    sourceUrl: "https://openverse.org/",
    creator: "Local fallback renderer",
    license: "Generated placeholder",
    source: "local",
    searchQuery: `${component.searchQuery} ${prompt}`.slice(0, 160),
    relevanceScore: 45,
    selectedByDefault: false
  };
}

function dedupeAssets(assets: MoodboardAsset[]): MoodboardAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.imageUrl}|${asset.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueComponents(components: MoodboardComponent[]): MoodboardComponent[] {
  const seen = new Set<string>();
  return components.filter((component) => {
    if (seen.has(component.id)) return false;
    seen.add(component.id);
    return true;
  });
}

function clampComponentCount(value: number | undefined): number {
  if (!value) return 12;
  return Math.max(4, Math.min(16, Math.round(value)));
}

function isBookstoreScene(text: string): boolean {
  return hasAny(text, ["ร้านหนังสือ", "bookstore", "book shop", "bookshop", "library bookstore"]);
}

function isChineseRestaurantScene(text: string): boolean {
  return hasAny(text, ["ร้านอาหารจีน", "ภัตตาคารจีน", "chinese restaurant", "dim sum", "dumpling", "chinese chef"]);
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferRole(categoryId: string, label: string): MoodboardRole {
  const text = `${categoryId} ${label}`.toLowerCase();
  if (hasAny(text, ["character", "people", "person", "human", "ผู้คน", "ลูกค้า", "พนักงาน", "เด็ก", "นักศึกษา"])) return "human";
  if (hasAny(text, ["lighting", "light", "แสง", "โคม"])) return "lighting";
  if (hasAny(text, ["food", "อาหาร", "จาน"])) return "food";
  if (hasAny(text, ["decor", "poster", "plant", "ตกแต่ง", "โปสเตอร์", "กระถาง"])) return "decor";
  if (hasAny(text, ["texture", "material", "พื้นผิว", "ไม้", "อิฐ", "กระดาษ"])) return "texture";
  if (hasAny(text, ["place", "environment", "structure", "ร้าน", "กำแพง", "หน้าต่าง", "ทางเดิน"])) return "place";
  if (hasAny(text, ["composition", "mood", "บรรยากาศ", "โทน"])) return "composition";
  return "prop";
}

function slug(value: string): string {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function parseSafeRemoteUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Only http and https image URLs can be proxied.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Local or private image URLs cannot be proxied.");
  }

  return parsed;
}

function isPrivateIpv4(hostname: string): boolean {
  if (net.isIP(hostname) !== 4) return false;
  const [a, b] = hostname.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
