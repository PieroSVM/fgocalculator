// Genera la cola JP -> Global para la calculadora a partir de Atlas Academy.
// Uso: node atlas-build.mjs > data/queue.json   (Node 18 o superior)
// La lógica está en buildQueue(data), que no hace red, para poder probarla aparte.

const API = "https://api.atlasacademy.io/export";
const DAY = 86400;
const SQ = 2, FRAG = 16, TICKET = 4001; // ids de item en Atlas: SQ gratis, fragmento, ticket

// Suma SQ y tickets de cualquier estructura (regalos de quests, misiones, recompensas, tienda).
export function rewardsOf(root) {
  let sq = 0, tk = 0;
  const seen = new WeakSet();
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) return o.forEach(walk);
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

const clean = (s) => String(s || "").replace(/\s*\n\s*/g, " ").trim();
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

export function buildQueue(d, now = Date.now() / 1000) {
  const jpEv = new Map(d.jpEvents.map((e) => [e.id, e]));

  // 1. Punto actual de Global: retraso mediano de los eventos NA de los últimos 120 días
  //    que llegaron con más de 300 días de retraso; el ancla es el más reciente en JP.
  const lags = [];
  for (const e of d.naEvents) {
    const j = jpEv.get(e.id);
    if (!j || e.type !== "eventQuest" || e.startedAt > now || e.startedAt < now - 120 * DAY) continue;
    const l = e.startedAt - j.startedAt;
    if (l > 300 * DAY) lags.push({ l, id: e.id, name: e.name });
  }
  if (!lags.length) throw new Error("No hay eventos recientes en NA para fijar el punto actual");
  lags.sort((a, b) => a.l - b.l);
  const med = lags[Math.floor(lags.length / 2)].l;
  let T = 0, anchor = null;
  for (const x of lags) {
    if (Math.abs(x.l - med) >= 30 * DAY) continue;
    const t = jpEv.get(x.id).startedAt;
    if (t > T) { T = t; anchor = { id: x.id, name: x.name }; }
  }

  const naEv = new Set(d.naEvents.map((e) => e.id));
  const naSv = new Set(d.naServants.map((s) => s.id));
  const wars = new Map(d.jpWars.map((w) => [w.id, w]));
  const svs = new Map(d.jpServants.map((s) => [s.id, s]));
  const steps = [];

  // 2. Eventos de JP posteriores al punto actual que aún no existen en NA y dan SQ o tickets.
  for (const e of d.jpNiceEvents) {
    if (e.type !== "eventQuest" || e.startedAt <= T || naEv.has(e.id)) continue;
    const r = rewardsOf(e);
    for (const id of e.warIds) { const w = wars.get(id); if (w) { const v = rewardsOf(w); r.sq += v.sq; r.tk += v.tk; } }
    if (!(r.sq > 0 || r.tk > 0)) continue;
    steps.push({ at: e.startedAt, n: clean(e.name), t: "evento", s: "", sq: Math.round(r.sq * 10) / 10, k: r.tk, id: "e" + e.id });
  }

  // 3. Banners: el primer banner de SQ en JP de cada servant 4★/5★ que no está en NA (su debut).
  const debut = new Map();
  for (const g of [...d.jpGachas].sort((a, b) => a.openedAt - b.openedAt)) {
    if (g.type !== "stone" || !g.featuredSvtIds?.length) continue;
    for (const id of g.featuredSvtIds) {
      const s = svs.get(id);
      if (!s || naSv.has(id) || s.rarity < 4 || debut.has(id)) continue;
      debut.set(id, { g, s });
    }
  }
  const byDay = new Map();
  for (const { g, s } of debut.values()) {
    if (g.openedAt <= T) continue;
    const key = Math.floor(g.openedAt / DAY);
    if (!byDay.has(key)) byDay.set(key, { at: g.openedAt, n: clean(g.name), t: "banner", sv: [], sq: 0, k: 0, id: "g" + g.id });
    byDay.get(key).sv.push(s);
  }
  for (const b of byDay.values()) {
    b.sv.sort((a, c) => c.rarity - a.rarity);
    b.s = b.sv.map((s) => s.name + (s.rarity === 5 ? " (SSR)" : " (SR)")).join(", ");
    delete b.sv;
    steps.push(b);
  }

  // 4. Orden JP; la duración de cada paso es el tiempo hasta el siguiente.
  steps.sort((a, b) => a.at - b.at || (a.t === "banner") - (b.t === "banner"));
  return {
    generated: iso(now),
    anchor,
    jpDate: iso(T),
    lagDays: Math.round(med / DAY),
    steps: steps.map((s, i) => {
      const nx = steps[i + 1];
      return { jp: iso(s.at), n: s.n, t: s.t, s: s.s, d: nx ? Math.round((nx.at - s.at) / DAY) : 14, a: s.sq, b: s.sq, k: s.k, id: s.id };
    }),
  };
}

async function main() {
  const get = async (p) => {
    const r = await fetch(`${API}/${p}.json`);
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.json();
  };
  const [jpEvents, naEvents, jpNiceEvents, jpWars, jpServants, naServants, jpGachas] = await Promise.all([
    get("JP/basic_event"), get("NA/basic_event"), get("JP/nice_event_lang_en"), get("JP/nice_war_lang_en"),
    get("JP/basic_servant_lang_en"), get("NA/basic_servant"), get("JP/nice_gacha"),
  ]);
  const q = buildQueue({ jpEvents, naEvents, jpNiceEvents, jpWars, jpServants, naServants, jpGachas });
  process.stdout.write(JSON.stringify(q, null, 1) + "\n");
}

if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
