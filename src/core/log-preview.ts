import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config/schema.js";
import type { RuntimePaths } from "../storage/paths.js";
import { redactText } from "./redaction.js";
import { redactionOptionsFromConfig } from "./redaction-context.js";

export const readLogPreview = async (
  filePath: string,
  config: AppConfig,
  maxBytes = 8_192,
  paths?: RuntimePaths
): Promise<{ preview: string; truncated: boolean }> => {
  const content = await readFile(filePath, "utf8");
  const truncated = content.length > maxBytes;
  const preview = redactText(content.slice(0, maxBytes), redactionOptionsFromConfig(config, paths));
  return { preview, truncated };
};
