import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fromDir = join(root, "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.wasm", "pglite.data", "initdb.wasm"];
const out = join(root, ".vercel/output/functions");

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name === "electric-sql__pglite.mjs") {
      for (const file of files) {
        const source = join(fromDir, file);
        if (existsSync(source)) cpSync(source, join(dir, file));
      }
    }
  }
}

walk(out);
