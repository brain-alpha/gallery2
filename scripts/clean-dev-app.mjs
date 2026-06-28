import { rm } from "node:fs/promises";
import path from "node:path";

const pathsToClean = [
  "dist",
  "dist-ssr",
  path.join("node_modules", ".vite"),
  path.join("src-tauri", "target"),
];

for (const relativePath of pathsToClean) {
  const targetPath = path.resolve(process.cwd(), relativePath);
  await rm(targetPath, { recursive: true, force: true });
  console.log(`removed ${relativePath}`);
}
