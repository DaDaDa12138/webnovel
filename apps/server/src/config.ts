import fs from "node:fs";
import path from "node:path";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const repoRoot = findRepoRoot(process.cwd());

export const config = {
  repoRoot,
  port: Number(process.env.PORT ?? 18080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? path.resolve(repoRoot, "data"),
  webDist: process.env.WEB_DIST ?? path.resolve(repoRoot, "apps/web/dist"),
  corpusDir: process.env.CORPUS_DIR ?? path.resolve(repoRoot, "fixtures/corpus"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  seedCorpus: process.env.SEED_CORPUS === "1",
};
