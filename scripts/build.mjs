import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await import("./generate-icons.mjs");

const source = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", source), "utf8"));
for (const browser of ["chrome", "firefox"]) {
  const destination = new URL(`../dist/${browser}/`, import.meta.url);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  const result = structuredClone(manifest);
  if (browser === "firefox") {
    delete result.minimum_chrome_version;
    result.background = { scripts: ["background.js"] };
    result.browser_specific_settings = {
      gecko: {
        id: "remove-monday-ai@local.extension",
        strict_min_version: "142.0",
        data_collection_permissions: { required: ["none"] }
      }
    };
  }
  await writeFile(new URL("manifest.json", destination), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Built dist/${browser}`);
}
