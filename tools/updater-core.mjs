// Builds the calculator queue from the FGO Wiki (Fandom) and Atlas Academy.
// Pure logic: every network call goes through the `get` functions passed in,
// so the same code runs in Node (tools/update.mjs) and in a browser for testing.

export const WIKI = "https://fategrandorder.fandom.com/api.php";
export const ATLAS = "https://api.atlasacademy.io/export";
const DAY = 86400;
const SQ = 2, FRAG = 16, TICKET = 4001; // Atlas item ids: free SQ, fragment, summon ticket
const BIG_RERUN = 7; // a campaign with this many 5★ or more is shown as a name list

const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const clean = (s) => String(s || "").replace(/\s*\n\s*/g, " ").trim();
const hasJapanese = (s) => /[぀-ヿ一-鿿]/.test(s);
const fileKey = (f) => f.trim().replace(/ /g, "_");
// Local file name: spaces and characters like apostrophes become "_" (the bytes are never changed).
export const localName = (f) => fileKey(f).replace(/[^\w.-]/g, "_");
const noComments = (s) => String(s || "").replace(/<!--[\s\S]*?-->/g, "");
const wikiDate = (s) => { // "December 11, 2024 18:00" -> "2024-12-11"
  const m = String(s || "").match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00 UTC`);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};

// ---------- Wiki parsing ----------

// Rows of the "Upcoming Events" table: {{EtaEventNA |event = Page{{!}}Shown name |eta = ...}}
export function parseUpcoming(wt) {
  const out = [];
  for (const m of noComments(wt).matchAll(/\{\{EtaEventNA([\s\S]*?)\n\}\}/g)) {
    const f = fields(m[1]);
    const ev = (f.event || "").replace(/\{\{!\}\}/g, "|");
    const [page, shown] = ev.includes("|") ? ev.split("|") : [ev, ev];
    const name = clean(shown);
    if (!name) continue;
    out.push({ name, page: page.trim() === "#" ? "" : clean(page), eta: clean(f.eta) });
  }
  return out;
}

function fields(body) {
  const f = {};
  for (const line of body.split(/\n\s*\|/)) {
    const i = line.indexOf("=");
    if (i > 0) f[line.slice(0, i).replace(/^\|/, "").trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return f;
}

// Summoning campaigns inside an event's wikitext (with its summon subpages already inlined).
export function parseCampaigns(text) {
  text = noComments(text).replace(/\{\{!\}\}/g, "|");
  const heads = [...text.matchAll(/\{\{EventHeaderJP([\s\S]*?)\n\}\}/g)];
  const camps = [];
  heads.forEach((h, idx) => {
    const f = fields(h[1]);
    if (!/summon/i.test(f.type || "")) return;
    const body = text.slice(h.index + h[0].length, idx + 1 < heads.length ? heads[idx + 1].index : text.length);
    const t0 = body.search(/Rate-Up Servants/i);
    if (t0 < 0) return;
    const tbl = body.slice(t0, body.indexOf("\n|}", t0) + 1 || undefined);
    const sv = [];
    // |5{{Star}} or |5{{LimitedS}}, then |{{Icon template}}, |[[Name]] {{LimitedS}}, |{{Class}}
    const row = /\|\s*([1-5])\s*\{\{(Star|LimitedS|LockedS)[^}]*\}\}\s*\n\|\s*\{\{([^}]+)\}\}\s*\n\|\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]([^\n]*)\n\|\s*\{\{([^}|]+)\}\}/g;
    for (const m of tbl.matchAll(row)) {
      if (+m[1] < 4) continue;
      sv.push({ r: +m[1], n: clean(m[5] || m[4]), t: m[3].split("|")[0].trim(), l: /Limited/i.test(m[2] + m[6]) ? 1 : 0, c: m[7].trim().replace(/(Gold|Silver|Bronze)$/, "") });
    }
    if (!sv.some((s) => s.r === 5)) return;
    camps.push({ start: f.start || "", end: f.end || "", img: f.image ? fileKey(f.image) : "", sv });
  });
  return camps;
}

// ---------- Wiki fetching ----------

async function pages(getJSON, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const q = `${WIKI}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(chunk.join("|"))}`;
    const r = await getJSON(q);
    const alias = {};
    for (const n of [...(r.query?.normalized || []), ...(r.query?.redirects || [])]) alias[n.to] = n.from;
    for (const p of r.query?.pages || []) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (text == null) continue;
      let t = p.title;
      out[t] = text;
      while (alias[t]) { t = alias[t]; out[t] = text; }
    }
  }
  return out;
}

export async function readWiki(getJSON) {
  const up = await pages(getJSON, ["Event List (US)/Upcoming Events"]);
  const list = parseUpcoming(Object.values(up)[0] || "");
  if (!list.length) throw new Error("Upcoming events list is empty or could not be parsed");
  const main = await pages(getJSON, [...new Set(list.map((e) => e.page).filter(Boolean))]);
  // Inline the transcluded summon subpages ({{:Some Event Summoning Campaign 2}}).
  const subs = new Set();
  for (const t of Object.values(main)) for (const m of t.replace(/\{\{!\}\}/g, "|").matchAll(/\{\{:([^}|]+)\}\}/g)) if (/summon/i.test(m[1])) subs.add(m[1].trim());
  const sub = await pages(getJSON, [...subs]);
  const events = list.map((e) => {
    let t = main[e.page] || "";
    const head = t.match(/\{\{EventHeaderJP([\s\S]*?)\n\}\}/);
    t = t.replace(/\{\{:([^}|]+)\}\}/g, (all, p) => sub[p.trim()] ?? all);
    return { ...e, start: head ? wikiDate(fields(head[1]).start) : "", camps: parseCampaigns(t) };
  });
  return events;
}

// Servant icon files: {{Louhi}} expands to [[File:S429A1Icon.webp|...]].
export async function iconFiles(getJSON, templates) {
  const map = {};
  const list = [...new Set(templates)];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const text = chunk.map((t) => `{{${t}}}`).join("\n@@\n");
    const r = await getJSON(`${WIKI}?action=expandtemplates&prop=wikitext&format=json&formatversion=2&text=${encodeURIComponent(text)}`);
    const parts = (r.expandtemplates?.wikitext || "").split("\n@@\n");
    chunk.forEach((t, j) => { const m = (parts[j] || "").match(/\[\[File:([^|\]]+)/); if (m) map[t] = fileKey(m[1]); });
  }
  return map;
}

// Download URLs for wiki files, keyed by our file name.
export async function fileUrls(getJSON, files) {
  const map = {};
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40);
    const r = await getJSON(`${WIKI}?action=query&prop=imageinfo&iiprop=url&format=json&formatversion=2&titles=${encodeURIComponent(chunk.map((f) => "File:" + f).join("|"))}`);
    const back = {};
    for (const n of r.query?.normalized || []) back[n.to] = n.from;
    for (const p of r.query?.pages || []) {
      const url = p.imageinfo?.[0]?.url;
      if (!url) continue;
      const from = (back[p.title] || p.title).replace(/^File:/, "");
      map[fileKey(from)] = url;
    }
  }
  return map;
}

// ---------- Atlas ----------

export function rewardsOf(root) {
  let sq = 0, tk = 0;
  const seen = new WeakSet();
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o.type === "item" && typeof o.num === "number") {
      if (o.objectId === SQ) sq += o.num;
      else if (o.objectId === FRAG) sq += o.num / 7;
      else if (o.objectId === TICKET) tk += o.num;
    }
    if (Array.isArray(o.targetIds) && o.purchaseType === "item") {
      const n = (o.setNum || 1) * (o.limitNum || 0);
      if (o.targetIds.includes(SQ)) sq += n;
      if (o.targetIds.includes(FRAG)) sq += n / 7;
      if (o.targetIds.includes(TICKET)) tk += n;
    }
    for (const k in o) if (k !== "giftAdds" && k !== "cost" && k !== "consumes") walk(o[k]);
  };
  walk(root);
  return { sq, tk };
}

export async function readAtlas(getJSON) {
  const g = (p) => getJSON(`${ATLAS}/${p}.json`);
  const [jpEvents, naEvents, jpNiceEvents, jpWars] = await Promise.all([
    g("JP/basic_event"), g("NA/basic_event"), g("JP/nice_event_lang_en"), g("JP/nice_war_lang_en"),
  ]);
  return { jpEvents, naEvents, jpNiceEvents, jpWars };
}

// Where Global is now (median JP->NA lag of recent events) and the JP events after that point that give SQ or tickets.
export function atlasSteps(d, now) {
  const jpEv = new Map(d.jpEvents.map((e) => [e.id, e]));
  const lags = [];
  for (const e of d.naEvents) {
    const j = jpEv.get(e.id);
    if (!j || e.type !== "eventQuest" || e.startedAt > now || e.startedAt < now - 120 * DAY) continue;
    const l = e.startedAt - j.startedAt;
    if (l > 300 * DAY) lags.push({ l, id: e.id, name: e.name });
  }
  if (!lags.length) throw new Error("No recent NA events to place Global on the JP timeline");
  lags.sort((a, b) => a.l - b.l);
  const med = lags[Math.floor(lags.length / 2)].l;
  let T = 0, anchor = null;
  for (const x of lags) {
    if (Math.abs(x.l - med) >= 30 * DAY) continue;
    const t = jpEv.get(x.id).startedAt;
    if (t > T) { T = t; anchor = { id: x.id, name: x.name }; }
  }
  const naEv = new Set(d.naEvents.map((e) => e.id));
  const wars = new Map(d.jpWars.map((w) => [w.id, w]));
  const events = [];
  for (const e of d.jpNiceEvents) {
    if (e.type !== "eventQuest" || e.startedAt <= T || naEv.has(e.id)) continue;
    const r = rewardsOf(e);
    for (const id of e.warIds || []) { const w = wars.get(id); if (w) { const v = rewardsOf(w); r.sq += v.sq; r.tk += v.tk; } }
    if (!(r.sq > 0 || r.tk > 0)) continue;
    events.push({ jp: iso(e.startedAt), n: clean(e.name), a: Math.round(r.sq * 10) / 10, k: r.tk, id: "e" + e.id });
  }
  return { T, jpDate: iso(T), lagDays: Math.round(med / DAY), anchor, events };
}

// ---------- Merge ----------

// names: optional { "<atlas event id>": "English name" } overrides for events with no English name yet.
export function buildQueue({ wiki, atlas, icons = {}, names = {}, now }) {
  const steps = [];
  // A wiki event lends its Global name to the Atlas event that starts the same JP day: always when it has
  // summoning campaigns, otherwise only when Atlas has no English name yet. Each wiki name is used once.
  const byStart = new Map();
  for (const e of wiki) {
    const first = e.camps.map((c) => wikiDate(c.start)).filter(Boolean).sort()[0];
    for (const d of [e.start, first]) if (d && !byStart.has(d)) byStart.set(d, e);
  }
  const used = new Set();
  for (const e of atlas.events) {
    const w = byStart.get(e.jp);
    const take = w && !used.has(w) && (w.camps.length > 0 || hasJapanese(e.n));
    if (take) used.add(w);
    const n = names[e.id.slice(1)] || (take ? w.name : e.n);
    steps.push({ jp: e.jp, n, t: "evento", s: "", a: e.a, b: e.a, k: e.k, id: e.id });
  }
  for (const e of wiki) {
    e.camps.forEach((c, i) => {
      const jp = wikiDate(c.start);
      if (!jp) return;
      const fives = c.sv.filter((s) => s.r === 5);
      const big = fives.length >= BIG_RERUN;
      const sv = (big ? fives : c.sv).map((s) => ({ name: s.n, r: s.r, cls: s.c, lim: s.l, i: big || !icons[s.t] ? "" : localName(icons[s.t]) }));
      steps.push({
        jp, n: `${e.name} · Summoning Campaign ${i + 1}`, ev: e.name, t: "banner",
        s: big ? `Rerun of ${fives.length} 5★ servants` : fives.map((s) => s.n).join(", "),
        sv, img: c.img ? localName(c.img) : "", big, end: wikiDate(c.end), a: 0, b: 0, k: 0,
        id: "w:" + (c.img ? localName(c.img).replace(/\.[a-z0-9]+$/i, "") : localName(`${e.name}-${i + 1}`)),
      });
    });
  }
  steps.sort((x, y) => (x.jp < y.jp ? -1 : x.jp > y.jp ? 1 : (x.t === "banner") - (y.t === "banner")));
  const seen = new Set();
  const out = steps.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const DAYMS = 864e5;
  out.forEach((s, i) => { const nx = out[i + 1]; s.d = nx ? Math.round((Date.parse(nx.jp) - Date.parse(s.jp)) / DAYMS) : 14; });
  const jpNames = out.filter((s) => s.t !== "banner" && hasJapanese(s.n)).map((s) => `${s.id} ${s.n}`);
  return {
    queue: {
      generated: iso(now),
      source: "Fandom FGO Wiki (Event List (US)/Upcoming Events) + Atlas Academy",
      anchor: atlas.anchor, jpDate: atlas.jpDate, lagDays: atlas.lagDays,
      steps: out.map(({ jp, n, ev, t, s, sv, img, big, end, d, a, b, k, id }) =>
        t === "banner" ? { jp, n, ev, t, s, sv, img, big, end, d, a, b, k, id } : { jp, n, t, s, d, a, b, k, id }),
    },
    jpNames,
  };
}

// Files the page needs, as { localName: wikiFileName }: banner art for every campaign, icons for servants shown as faces.
export function neededFiles(wiki, icons) {
  const out = {};
  for (const e of wiki) for (const c of e.camps) {
    if (c.img) out[localName(c.img)] = c.img;
    if (c.sv.filter((s) => s.r === 5).length >= BIG_RERUN) continue;
    for (const s of c.sv) if (icons[s.t]) out[localName(icons[s.t])] = icons[s.t];
  }
  return out;
}
