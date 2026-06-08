import { tsImport } from "tsx/esm/api";

await tsImport("./server/index.ts", import.meta.url);
