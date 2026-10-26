import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";

// Read the actual ZIP central directory and content independently of the packager.
function unzip(archive) {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  let offset = archive.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < archive.readUInt16LE(end + 10); i += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const nameLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString();
    const local = archive.readUInt32LE(offset + 42);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const bytes = archive.subarray(start, start + archive.readUInt32LE(offset + 20));
    const method = archive.readUInt16LE(offset + 10);
    assert.ok(method === 0 || method === 8);
    entries.set(name, method === 8 ? inflateRawSync(bytes) : bytes);
    offset += 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
  }
  return entries;
}

// CRX3's header uses length-delimited protobuf fields.
function fields(buffer) {
  let offset = 0;
  function varint() {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = buffer[offset++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  }
  const result = new Map();
  while (offset < buffer.length) {
    const tag = varint();
    assert.equal(tag & 7, 2);
    const length = varint();
    result.set(tag >>> 3, buffer.subarray(offset, offset + length));
    offset += length;
  }
  return result;
}

test("packages clean browser archives and a valid CRX3 using a reusable key", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "monday packages "));
  const script = fileURLToPath(new URL("../scripts/package.mjs", import.meta.url));
  try {
    const keyPath = join(temporary, "existing key.pem");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    const run = () => execFileSync(process.execPath, [script, "--key", keyPath, "--out-dir", temporary], { cwd: tmpdir(), encoding: "utf8" });
    const first = run();
    const sourceManifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url)));
    const prefix = join(temporary, `remove-monday-ai-${sourceManifest.version}`);
    const chromeZip = await readFile(`${prefix}-chrome.zip`);
    for (const browser of ["chrome", "firefox"]) {
      const entries = unzip(await readFile(`${prefix}-${browser}.zip`));
      assert.deepEqual([...entries.keys()].sort(), [
        "background.js", "content.js", "hide-ai.css", "icons/icon-128.png",
        "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "manifest.json",
        "icons/1.svg", "icons/2.svg", "icons/icon-visible-16.png",
        "icons/icon-visible-32.png", "icons/icon-visible-48.png", "icons/icon-visible-128.png"
      ].sort());
      const manifest = JSON.parse(entries.get("manifest.json"));
      assert.equal(manifest.version, sourceManifest.version);
      assert.deepEqual(manifest.background, browser === "chrome" ? { service_worker: "background.js" } : { scripts: ["background.js"] });
    }
    const crx = await readFile(`${prefix}-chrome.crx`);
    assert.equal(crx.subarray(0, 4).toString(), "Cr24");
    assert.equal(crx.readUInt32LE(4), 3);
    const headerEnd = 12 + crx.readUInt32LE(8);
    assert.deepEqual(crx.subarray(headerEnd), chromeZip);
    const header = fields(crx.subarray(12, headerEnd));
    const proof = fields(header.get(2));
    const signedHeader = header.get(10000);
    const signedLength = Buffer.alloc(4);
    signedLength.writeUInt32LE(signedHeader.length);
    const signedBytes = Buffer.concat([Buffer.from("CRX3 SignedData\0"), signedLength, signedHeader, chromeZip]);
    const publicKey = createPublicKey({ key: proof.get(1), format: "der", type: "spki" });
    assert.ok(verify("sha256", signedBytes, publicKey, proof.get(2)), "CRX signature verifies");
    assert.deepEqual(fields(signedHeader).get(1), createHash("sha256").update(proof.get(1)).digest().subarray(0, 16));
    const second = run();
    assert.equal(second.match(/extension ID: (\w+)/)[1], first.match(/extension ID: (\w+)/)[1]);
    assert.equal(await readFile(keyPath, "utf8"), privateKey);
    assert.throws(() => execFileSync(process.execPath, [script, "--key", join(temporary, "missing.pem")], { stdio: "pipe" }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
