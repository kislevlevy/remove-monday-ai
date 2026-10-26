import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import crx3 from "crx3";
import yazl from "yazl";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    key: { type: "string" },
    "out-dir": { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});

if (values.help) {
  console.log(`Usage: npm run package -- [--key /path/to/existing.pem] [--out-dir /path/to/output]

Builds Firefox ZIP, Chrome ZIP, and signed Chrome CRX3 packages.
Default output: dist/packages
Default key: .keys/chrome.pem (generated once, then reused)
--key must point to an existing RSA private key.`);
} else {
  try {
    await packageExtensions();
  } catch (error) {
    console.error(`Packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function packageExtensions() {
  const keyPath = values.key ? resolve(values.key) : join(root, ".keys", "chrome.pem");
  let key;
  try {
    key = await readFile(keyPath);
  } catch (error) {
    if (error.code !== "ENOENT" || values.key) throw error;
    await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    // Never overwrite an existing signing key, including during concurrent runs.
    await writeFile(keyPath, privateKey, { mode: 0o600, flag: "wx" });
    key = privateKey;
    console.log("Created .keys/chrome.pem. Back it up privately and reuse it for future CRX builds.");
  }
  if (createPrivateKey(key).asymmetricKeyType !== "rsa") {
    throw new Error("The Chrome signing key must be an RSA private key.");
  }

  // Always rebuild so archives cannot silently contain stale code or manifests.
  await import("./build.mjs");
  const manifest = JSON.parse(await readFile(join(root, "extension", "manifest.json"), "utf8"));
  const outDir = values["out-dir"] ? resolve(values["out-dir"]) : join(root, "dist", "packages");
  await mkdir(outDir, { recursive: true });
  const prefix = `remove-monday-ai-${manifest.version}`;
  const firefoxZip = join(outDir, `${prefix}-firefox.zip`);
  const chromeZip = join(outDir, `${prefix}-chrome.zip`);
  const chromeCrx = join(outDir, `${prefix}-chrome.crx`);

  await zipDirectory(join(root, "dist", "firefox"), firefoxZip);
  await zipDirectory(join(root, "dist", "chrome"), chromeZip);
  const info = await crx3(createReadStream(chromeZip), { keyPath, crxPath: chromeCrx });
  for (const file of [firefoxZip, chromeZip, chromeCrx]) console.log(`Created ${file}`);
  console.log(`Chrome CRX extension ID: ${info.appId}`);
}

async function zipDirectory(directory, destination) {
  const zip = new yazl.ZipFile();
  // Attach stream error handlers before adding files.
  const done = pipeline(zip.outputStream, createWriteStream(destination));
  async function addFiles(relative = "") {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await addFiles(name);
      else if (entry.isFile()) zip.addFile(join(directory, name), name);
      else throw new Error(`Unsupported extension asset: ${name}`);
    }
  }
  try {
    await addFiles();
    zip.end();
  } catch (error) {
    zip.outputStream.destroy(error);
  }
  await done;
}
