import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ["src/main.jsx"], bundle: true, write: false, metafile: true,
  outdir: "dist", format: "iife", platform: "browser", target: "es2022",
  minify: true, legalComments: "inline", define: { "process.env.NODE_ENV": '"production"' },
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WhatsApp Assistant</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>\n`;
await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/index.html"), html);
// Keep the full upstream notices with the redistributable bundle, including
// tree-shaken SDK inputs. No network or install scripts are needed at runtime.
const packages = new Set(Object.keys(result.metafile.inputs).filter((file) => file.startsWith("node_modules/"))
  .map((file) => { const parts = file.slice("node_modules/".length).split("/"); return parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]; }));
await mkdir(path.join(root, "licenses"), { recursive: true });
for (const name of [...packages].sort()) {
  let license;
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"]) {
    try { license = await readFile(path.join(root, "node_modules", name, filename), "utf8"); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!license) throw new Error(`Missing redistribution license: ${name}`);
  await writeFile(path.join(root, "licenses", name.replaceAll("/", "__") + ".txt"), license.replace(/[\t ]+$/gm, ""));
}
console.log("WhatsApp UI built (bundled HTML, no CDN).");
