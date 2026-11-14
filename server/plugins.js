// Plugin system. Drop a file in ./plugins (or PLUGINS_DIR) that default-exports:
//   {
//     name: "My CRM",
//     channels: { myChannel: async ({ pkg, messages, business }) => ({ status: "sent" }) },  // new outreach channels
//     sources:  async ({ ingest, config }) => () => {},   // optional: start a signal feed; return a stop function
//     onEvent:  async (evt) => {},                         // optional: receive every bus event
//   }
// Plugins run inside the server process. Only install plugins you trust.
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPlugins(dir, log = console) {
  if (!dir || !existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => /\.(m?js)$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      const p = mod.default || mod;
      if (!p || !p.name) { log.warn?.(`plugin ${f}: missing default export with a name`); continue; }
      out.push({ ...p, file: f });
      log.log?.(`plugin loaded: ${p.name} (${f})`);
    } catch (e) { log.error?.(`plugin ${f} failed to load: ${e.message}`); }
  }
  return out;
}

export function wirePlugins(plugins, { bus, agent, store, channels, log = console }) {
  const stops = [];
  for (const p of plugins) {
    for (const [id, fn] of Object.entries(p.channels || {})) channels[id] = fn;
    if (typeof p.onEvent === "function") bus.subscribe(evt => Promise.resolve(p.onEvent(evt)).catch(e => log.warn?.(`${p.name}: ${e.message}`)));
    if (typeof p.sources === "function") Promise.resolve(p.sources({ ingest: agent.ingest, config: store.getConfig() })).then(stop => typeof stop === "function" && stops.push(stop)).catch(e => log.warn?.(`${p.name} source: ${e.message}`));
  }
  return {
    list: () => plugins.map(p => ({ name: p.name, file: p.file, description: p.description || "", channels: Object.keys(p.channels || {}), source: typeof p.sources === "function", events: typeof p.onEvent === "function" })),
    stop: () => stops.forEach(s => { try { s(); } catch {} })
  };
}
