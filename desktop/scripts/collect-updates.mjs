// After a Windows build: copies the update feed (latest.yml) and the installer's .blockmap next to the installer in
// release/. The app's updater reads latest.yml from the GitHub release, and the .blockmap files of the old and new
// installers let it download only the blocks that changed.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const release = path.resolve(root, "..", "release");
mkdirSync(release, { recursive: true });

const files = existsSync(out) ? readdirSync(out).filter((n) => n === "latest.yml" || n.endsWith("-Windows.exe.blockmap")) : [];
if (!files.includes("latest.yml")) {
  console.error("latest.yml was not generated: check the publish settings in desktop/package.json");
  process.exit(1);
}
for (const name of files) {
  copyFileSync(path.join(out, name), path.join(release, name));
  console.log(`  • collected       ${path.join("release", name)}`);
}
