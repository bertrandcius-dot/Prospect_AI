// Storage. MemoryStore keeps everything in maps and can snapshot to a JSON file.
// To scale out, implement the same methods on Postgres (one table per collection) and pass it to createApp().
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { DEFAULT_TEMPLATES } from "./templates.js";

export const DEFAULT_CONFIG = {
  location: { name: "Brooklyn, NY", lat: 40.6782, lng: -73.9442 },
  fences: [{ id: "f1", lat: 40.6782, lng: -73.9442, radiusMi: 1.5 }],
  keywords: [
    { term: "pizza near me", cat: "Restaurant", color: "#FF5A5F", on: true },
    { term: "best tacos", cat: "Restaurant", color: "#2EC4B6", on: true },
    { term: "vegan brunch", cat: "Restaurant", color: "#F5B642", on: true },
    { term: "caribbean food delivery", cat: "Restaurant", color: "#8B8CFF", on: true },
    { term: "emergency plumber", cat: "Home services", color: "#38BDF8", on: true },
    { term: "hair salon open now", cat: "Beauty", color: "#F472B6", on: true }
  ],
  sources: { search: true, maps: true, voice: true, pixel: true },
  criteria: { profile: true, rating: true, rank: true, dirs: true, ads: true },
  threshold: 3,
  channels: { email: true, sms: true, call: true, voice: true, social: true, gads: false, report: true, form: true, dm: false, mail: false },
  mvp: false,
  cycles: 3,
  bridge: true,
  templates: DEFAULT_TEMPLATES
};

export class MemoryStore {
  constructor({ file = "" } = {}) {
    this.file = file;
    this.config = structuredClone(DEFAULT_CONFIG);
    this.businesses = new Map();   // key: placeId
    this.packages = new Map();     // key: package id
    this.integrations = new Map(); // key: integration id
    this.stats = { sig: 0, inside: 0, qual: 0, unq: 0, pkg: 0, rep: 0, book: 0, voice: 0, pixel: 0 };
    this.seq = 1000;
    if (file && existsSync(file)) this.load();
  }
  load() {
    try {
      const j = JSON.parse(readFileSync(this.file, "utf8"));
      this.config = { ...this.config, ...j.config };
      this.stats = { ...this.stats, ...j.stats };
      this.seq = j.seq || this.seq;
      for (const b of j.businesses || []) this.businesses.set(b.id, b);
      for (const p of j.packages || []) this.packages.set(p.id, p);
      for (const i of j.integrations || []) this.integrations.set(i.id, i);
    } catch (e) { console.error("store: could not load", this.file, e.message); }
  }
  save() {
    if (!this.file) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify({
        config: this.config, stats: this.stats, seq: this.seq,
        businesses: [...this.businesses.values()].slice(-5000),
        packages: [...this.packages.values()].slice(-5000),
        integrations: [...this.integrations.values()]
      }));
      renameSync(tmp, this.file);
    }, 250);
  }
  nextPackageId() { return "PKG-" + ++this.seq; }
  getConfig() { return this.config; }
  updateConfig(patch) { this.config = { ...this.config, ...patch }; this.save(); return this.config; }
  getBusiness(id) { return this.businesses.get(id); }
  upsertBusiness(b) { this.businesses.set(b.id, b); this.save(); return b; }
  putPackage(p) { this.packages.set(p.id, p); this.save(); return p; }
  getPackage(id) { return this.packages.get(id); }
  listPackages({ limit = 50, offset = 0 } = {}) { return [...this.packages.values()].reverse().slice(offset, offset + limit); }
  listIntegrations() { return [...this.integrations.values()]; }
  putIntegration(i) { this.integrations.set(i.id, i); this.save(); return i; }
  deleteIntegration(id) { const ok = this.integrations.delete(id); this.save(); return ok; }
  bump(k, n = 1) { this.stats[k] = (this.stats[k] || 0) + n; this.save(); }
}
