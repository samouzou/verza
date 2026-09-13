import {config as loadDotenv} from "dotenv";
import path from "node:path";
import {fileURLToPath} from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads `.env.verza-canvas-dev` / `.env.verza-canvas` (or `.env`) before config reads process.env.
 * Precedence: existing process.env > `.env.local` > project file > `.env`.
 */
export function loadProjectEnv(): string {
  const fromExplicit =
    process.env.VERZA_ENV?.trim() ||
    process.env.VERZA_FIREBASE_PROJECT_ID?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    "";

  const projectFile = fromExplicit
    ? path.join(mcpRoot, `.env.${fromExplicit}`)
    : null;

  // Base .env first (lowest priority among files)
  loadDotenv({path: path.join(mcpRoot, ".env")});

  if (projectFile) {
    loadDotenv({path: projectFile, override: true});
  } else {
    // Default to dev when no project selected — matches local Optic habits
    loadDotenv({
      path: path.join(mcpRoot, ".env.verza-canvas-dev"),
      override: true,
    });
  }

  // Local overrides win over project file
  loadDotenv({path: path.join(mcpRoot, ".env.local"), override: true});

  const loaded =
    process.env.VERZA_FIREBASE_PROJECT_ID?.trim() ||
    fromExplicit ||
    "verza-canvas-dev";

  console.error(`[verza-mcp] env project=${loaded}`);
  return loaded;
}
