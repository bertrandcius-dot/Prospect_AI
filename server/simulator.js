// Demo traffic: random keyword signals around the fences, fed through the real agent pipeline.
export function startSimulator({ agent, store, ratePerMin = 30, log = console }) {
  let stopped = false, timer;
  const loop = () => {
    if (stopped) return;
    const cfg = store.getConfig();
    const kws = cfg.keywords.filter(k => k.on);
    const sources = Object.entries(cfg.sources).filter(([, on]) => on).map(([s]) => s);
    if (kws.length && sources.length) {
      const f = cfg.fences[Math.floor(Math.random() * cfg.fences.length)] || cfg.location;
      const spread = (f.radiusMi || 1.5) * (Math.random() < 0.68 ? 1.25 : 3.5);
      const d = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      const lat = f.lat + (d * Math.sin(a)) / 69, lng = f.lng + (d * Math.cos(a)) / (69 * Math.cos((f.lat * Math.PI) / 180));
      const w = { search: 50, maps: 20, voice: 15, pixel: 15 };
      let t = Math.random() * sources.reduce((s, x) => s + w[x], 0), source = sources[0];
      for (const s of sources) { t -= w[s]; if (t <= 0) { source = s; break; } }
      agent.ingest({ keyword: kws[Math.floor(Math.random() * kws.length)].term, lat, lng, source }).catch(e => log.error?.(e.message));
    }
    timer = setTimeout(loop, (60000 / Math.max(1, ratePerMin)) * (0.5 + Math.random()));
  };
  loop();
  return { stop() { stopped = true; clearTimeout(timer); } };
}
