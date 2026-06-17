import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicSchemas } from "./index.js";

const outputDir = path.resolve("schemas");
await mkdir(outputDir, { recursive: true });

await Promise.all(
  Object.entries(publicSchemas).map(([name, schema]) =>
    writeFile(path.join(outputDir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`)
  )
);
