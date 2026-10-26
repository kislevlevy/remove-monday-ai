import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

// Keep the supplied SVGs as the source; Chrome manifest icons require raster files.
const directory = new URL("../extension/icons/", import.meta.url);
for (const [source, prefix] of [["2.svg", "icon"], ["1.svg", "icon-visible"]]) {
  const svg = await readFile(new URL(source, directory), "utf8");
  for (const size of [16, 32, 48, 128]) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    await writeFile(new URL(`${prefix}-${size}.png`, directory), png);
  }
}
console.log("Generated hidden and visible icons from the supplied SVGs");
