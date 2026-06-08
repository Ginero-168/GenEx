import type { MarketplaceId } from "../../shared/types";

export interface MarketplaceProfile {
  id: MarketplaceId;
  label: string;
  acceptsAi: boolean;
  blockedReason?: string;
  minMegapixels: number;
  maxMegapixels: number;
  maxFileSizeBytes: number;
  outputFormat: "jpeg" | "png";
  extension: "jpg" | "png";
  keywordMin: number;
  keywordMax: number;
  titleMaxChars: number;
  requiresAiLabel: boolean;
  metadataAiPhrase: "forbidden" | "required" | "optional";
  requiredCategory?: string;
  policyNotes: string[];
}

export const marketplaceProfiles: Record<MarketplaceId, MarketplaceProfile> = {
  "adobe-stock": {
    id: "adobe-stock",
    label: "Adobe Stock",
    acceptsAi: true,
    minMegapixels: 4,
    maxMegapixels: 100,
    maxFileSizeBytes: 45_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 10,
    keywordMax: 49,
    titleMaxChars: 70,
    requiresAiLabel: true,
    metadataAiPhrase: "forbidden",
    policyNotes: [
      "Tick Created using generative AI tools before submission.",
      "If fictional people or property appear, tick People and Property are fictional.",
      "Do not put generative AI in title or keywords."
    ]
  },
  dreamstime: {
    id: "dreamstime",
    label: "Dreamstime",
    acceptsAi: true,
    minMegapixels: 3,
    maxMegapixels: 70,
    maxFileSizeBytes: 45_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 10,
    keywordMax: 50,
    titleMaxChars: 200,
    requiresAiLabel: true,
    metadataAiPhrase: "required",
    requiredCategory: "Illustrations & Clipart / Generative AI",
    policyNotes: [
      "Title or description should clearly state that the image is AI generated.",
      "Generated realistic human faces are high risk.",
      "Use the Generative AI category."
    ]
  },
  vecteezy: {
    id: "vecteezy",
    label: "Vecteezy",
    acceptsAi: true,
    minMegapixels: 4,
    maxMegapixels: 100,
    maxFileSizeBytes: 50_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 10,
    keywordMax: 50,
    titleMaxChars: 160,
    requiresAiLabel: true,
    metadataAiPhrase: "required",
    policyNotes: [
      "Include AI generated in titles and keywords.",
      "Human visual inspection is required for AI artifacts.",
      "Copy space and broad commercial usability are favored."
    ]
  },
  "123rf": {
    id: "123rf",
    label: "123RF",
    acceptsAi: true,
    minMegapixels: 6,
    maxMegapixels: 100,
    maxFileSizeBytes: 45_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 10,
    keywordMax: 50,
    titleMaxChars: 180,
    requiresAiLabel: true,
    metadataAiPhrase: "optional",
    requiredCategory: "AI Generated Images",
    policyNotes: [
      "Upload to AI Generated Images category only.",
      "Minimum resolution target is 6 megapixels.",
      "Reject likely for flawed anatomy, nonsensical text, watermark, or spam-similar variants."
    ]
  },
  shutterstock: {
    id: "shutterstock",
    label: "Shutterstock",
    acceptsAi: false,
    blockedReason: "Shutterstock does not accept AI-generated content from contributors.",
    minMegapixels: 4,
    maxMegapixels: 100,
    maxFileSizeBytes: 50_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 7,
    keywordMax: 50,
    titleMaxChars: 2048,
    requiresAiLabel: false,
    metadataAiPhrase: "optional",
    policyNotes: [
      "Contributor AI upload is blocked.",
      "Metadata still avoids trademarks, PII, emoji, spam, and irrelevant keywords."
    ]
  },
  alamy: {
    id: "alamy",
    label: "Alamy",
    acceptsAi: false,
    blockedReason: "Alamy says it does not accept AI-generated images.",
    minMegapixels: 4,
    maxMegapixels: 100,
    maxFileSizeBytes: 200_000_000,
    outputFormat: "jpeg",
    extension: "jpg",
    keywordMin: 10,
    keywordMax: 50,
    titleMaxChars: 150,
    requiresAiLabel: false,
    metadataAiPhrase: "optional",
    policyNotes: ["Contributor AI upload is blocked for this target."]
  },
  "generic-stock": {
    id: "generic-stock",
    label: "Generic Stock Package",
    acceptsAi: true,
    minMegapixels: 4,
    maxMegapixels: 100,
    maxFileSizeBytes: 45_000_000,
    outputFormat: "png",
    extension: "png",
    keywordMin: 10,
    keywordMax: 50,
    titleMaxChars: 120,
    requiresAiLabel: true,
    metadataAiPhrase: "optional",
    policyNotes: ["Use only after checking the current policy of the target marketplace."]
  }
};

export function marketplaceProfileFor(id: MarketplaceId): MarketplaceProfile {
  return marketplaceProfiles[id] ?? marketplaceProfiles["generic-stock"];
}

export function marketplaceOptions() {
  return Object.values(marketplaceProfiles).map((profile) => ({
    id: profile.id,
    label: profile.label,
    acceptsAi: profile.acceptsAi
  }));
}
