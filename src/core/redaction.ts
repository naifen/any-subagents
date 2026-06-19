import path from "node:path";

const builtInSecretPatterns: RegExp[] = [
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
];

export interface RedactionOptions {
  extraPatterns?: string[];
  pathRedaction?: boolean;
  basePaths?: string[];
}

export const redactText = (input: string, options: RedactionOptions = {}): string => {
  let output = input;
  const patterns = [...builtInSecretPatterns];
  for (const pattern of options.extraPatterns ?? []) {
    patterns.push(new RegExp(pattern, "g"));
  }
  for (const pattern of patterns) {
    output = output.replace(pattern, "[redacted]");
  }
  if (options.pathRedaction) {
    // Redact only configured base paths (longest first so nested roots match before
    // their parents), rather than a broad filesystem heuristic that mangles arbitrary content.
    const basePaths = [...(options.basePaths ?? [])].filter((basePath) => basePath.length > 0).sort((a, b) => b.length - a.length);
    for (const basePath of basePaths) {
      output = output.split(basePath).join("[redacted-path]");
    }
  }
  return output;
};

export const redactObject = <T>(value: T, options: RedactionOptions = {}): T => {
  if (typeof value === "string") return redactText(value, options) as T;
  if (Array.isArray(value)) return value.map((entry) => redactObject(entry, options)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactObject(entry, options);
    }
    return result as T;
  }
  return value;
};

export const redactFilePath = (filePath: string, options: RedactionOptions = {}): string => {
  if (!options.pathRedaction) return filePath;
  for (const basePath of options.basePaths ?? []) {
    if (filePath.startsWith(basePath)) {
      return path.join("[redacted-path]", path.relative(basePath, filePath));
    }
  }
  return "[redacted-path]";
};
