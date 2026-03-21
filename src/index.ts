export { serve } from "./serve";
export { resolveConfig } from "./config";
export { negotiate } from "./negotiate";
export { shouldSkip } from "./skip";
export { compress, addVaryHeader } from "./compress";
export type {
  CompressionAlgorithm,
  CompressionOptions,
  AlgorithmOptions,
  ResolvedCompressionOptions,
} from "./types";
