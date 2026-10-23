import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const files = [];
async function collect(directory) {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile() && /\.(ts|tsx|css)$/.test(name)) {
      const data = await fs.readFile(path.join(root, name));
      const text = data.toString("utf8");
      files.push({
        path: name,
        lines: text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0),
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
for (const directory of ["app", "components", "core", "lib", "worker", "db"])
  await collect(directory);
await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
await fs.writeFile(
  path.join(root, "artifacts/source-manifest.json"),
  JSON.stringify({ version: pkg.version, files }, null, 2) + "\n",
);
console.log(`Recorded ${files.length} source files for V${pkg.version}`);
