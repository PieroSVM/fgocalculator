// Refreshes data/queue.json and downloads new banner art and icons from the FGO Wiki.
// Usage: node tools/update.mjs   (Node 20+). Then run: python3 tools/build.py
// Exits without writing anything when the sources return nothing usable, so the site keeps the last good data.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWiki, iconFiles, fileUrls, readAtlas, atlasSteps, buildQueue, neededFiles } from "./updater-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "fgocalculator-updater/1.0 (+https://github.com/PieroSVM/fgocalculator)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = "json") {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://fategrandorder.fandom.com/" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return as === "json" ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= 4) throw new Error(`${url}: ${e.message}`);
      await sleep(2000 * i);
    }
  }
}
const getJSON = (u) => get(u, "json");

async function main() {
  const now = Date.now() / 1000;
  const qPath = join(root, "data", "queue.json");
  const old = existsSync(qPath) ? JSON.parse(await readFile(qPath, "utf8")) : null;
  const names = existsSync(join(root, "data", "names.json")) ? JSON.parse(await readFile(join(root, "data", "names.json"), "utf8")) : {};

  console.log("Reading the wiki...");
  const wiki = await readWiki(getJSON);
  const templates = wiki.flatMap((e) => e.camps.flatMap((c) => c.sv.map((s) => s.t)));
  const icons = await iconFiles(getJSON, templates);

  console.log("Reading Atlas Academy...");
  const atlas = atlasSteps(await readAtlas(getJSON), now);

  const { queue, jpNames } = buildQueue({ wiki, atlas, icons, names, now });
  const banners = queue.steps.filter((s) => s.t === "banner").length;
  const oldBanners = old ? old.steps.filter((s) => s.t === "banner").length : 0;
  console.log(`${queue.steps.length} steps, ${banners} banners (was ${oldBanners}). Global is at JP ${queue.jpDate}.`);
  if (banners < 10 || banners < oldBanners * 0.5) throw new Error("Too few banners, the wiki format may have changed. Keeping the current data.");
  for (const n of jpNames) console.log(`::warning::Event without an English name, add it to data/names.json: ${n}`);

  // New images: downloaded as is, never resized or re-encoded.
  const files = neededFiles(wiki, icons);
  const dir = join(root, "assets", "w");
  await mkdir(dir, { recursive: true });
  const missing = Object.entries(files).filter(([local]) => !existsSync(join(dir, local)));
  if (missing.length) {
    const urls = await fileUrls(getJSON, missing.map(([, wikiName]) => wikiName));
    for (const [local, wikiName] of missing) {
      const url = urls[wikiName.trim().replace(/ /g, "_")];
      if (!url) { console.log(`::warning::No download URL for ${wikiName}`); continue; }
      try {
        await writeFile(join(dir, local), await get(url, "bytes"));
        console.log(`Downloaded ${local}`);
      } catch (e) { console.log(`::warning::Could not download ${wikiName}: ${e.message}`); }
    }
  }

  const sig = (q) => JSON.stringify([q.jpDate, q.lagDays, q.steps]);
  queue.version = createHash("sha1").update(sig(queue)).digest("hex").slice(0, 12);
  if (old && sig(old) === sig(queue)) { console.log("No changes in the queue."); return; }
  await writeFile(qPath, JSON.stringify(queue, null, 1) + "\n");
  console.log(`data/queue.json updated (version ${queue.version}).`);
}

main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
