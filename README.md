# Stock Image Agent Lab

Web application for turning a text prompt into a stock-ready image package through a central brain and specialist sub-agent pipeline.

## Run

```bash
npm install
cp .env.example .env
npm run iterate
npm run dev
```

Open `http://127.0.0.1:5173`.

Without `OPENAI_API_KEY`, the app uses a deterministic demo renderer so the full QC, metadata, and packaging workflow still works. With a key, the backend calls the OpenAI Image API using `OPENAI_IMAGE_MODEL` defaulting to `gpt-image-2`.

Marketplace policies are modeled as local `MarketplaceProfile` configs. Adobe Stock, Dreamstime, Vecteezy, 123RF, Shutterstock, Alamy, and a generic stock package profile are included. The profile controls eligibility, required AI disclosure notes, output format, resolution range, keyword count, and metadata phrase policy.

## Pipeline

1. Central Brain routes the job and owns readiness scoring.
2. Scene Detail Agent expands the short prompt into visual categories, details, search queries, and keyword-ready anchors.
3. Mood Board Agent gathers Openverse references from the selected anchors and creates variation prompts.
4. Prompt Strategist converts the raw prompt plus selected scene details and mood board anchors into a stock-safe generation prompt.
5. Visual Director defines composition and target aspect ratio.
6. Market Analyst maps buyer intent and category.
7. Compliance Auditor flags trademark, sensitive-content, and release risks.
8. Platform Eligibility Gate checks whether the selected marketplace accepts contributor AI uploads.
9. Image Generator creates the source image.
10. Technical Inspector upscales and verifies stock-size output against the selected marketplace profile.
11. Metadata Editor exports JSON and CSV.
12. Packaging Agent creates a ZIP package.
13. Iteration Lab links each run to the 1,000-pass architecture critique artifact.

## Mood Board

`POST /api/moodboards` first asks the Scene Detail Agent to expand a short prompt into rich visual taxonomy categories. With `OPENAI_API_KEY`, the agent uses structured AI output; without a key, it uses local high-detail templates so the workflow remains testable. The Mood Board Agent then searches Openverse for reference images with source, creator, and license metadata. The frontend shows the taxonomy first, then draws references onto a canvas where users can keep, mute, or delete images before running the pipeline.

Selected references are sent as `GenerationRequest.moodboard`, saved as `moodboard-selection.json`, included in `package.zip`, and listed in the readiness report. They are treated as internal visual direction only; the generated stock image should be original and manually reviewed before submission.

## OpenAI Notes

The current OpenAI image generation guide says image generation is available through the Image API for direct one-prompt generation and through the Responses API for conversational or multi-step flows. This app starts with the Image API for the render step and keeps the agent pipeline in application code so QC and packaging are transparent.
