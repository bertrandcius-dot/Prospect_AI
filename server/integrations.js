// Integrations: a catalog of built-in tools plus any number of custom webhooks.
// Webhooks are signed (HMAC-SHA256 in X-Prospect-Signature) and retried with exponential backoff.
import { createHmac, randomUUID } from "node:crypto";

export const CATALOG = [
  { id: "gsc", name: "Google Search Console", cat: "Signals", color: "#4285F4", desc: "Keyword impressions by query and city", on: true },
  { id: "gmaps", name: "Google Maps Places", cat: "Signals", color: "#34A853", desc: "Business profiles, ratings, websites", on: true },
  { id: "gads", name: "Google Ads", cat: "Signals", color: "#FBBC04", desc: "Ad presence check and display campaigns", on: false },
  { id: "meta", name: "Meta Pixel", cat: "Audience", color: "#1877F2", desc: "Custom audiences on Facebook and Instagram", on: true },
  { id: "tiktok", name: "TikTok Pixel", cat: "Audience", color: "#25F4EE", desc: "Retarget searchers on TikTok", on: false },
  { id: "sendgrid", name: "SendGrid", cat: "Outreach", color: "#1A82E2", desc: "Email delivery and open tracking", on: true },
  { id: "twilio", name: "Twilio", cat: "Outreach", color: "#F22F46", desc: "SMS, cold calls and voicemail drops", on: true },
  { id: "wa", name: "WhatsApp Business", cat: "Outreach", color: "#25D366", desc: "Direct messages to business accounts", on: false },
  { id: "lob", name: "Lob", cat: "Outreach", color: "#3B82F6", desc: "Printed brochures by mail", on: false },
  { id: "hubspot", name: "HubSpot", cat: "CRM", color: "#FF7A59", desc: "Create contacts and deals", on: false },
  { id: "sf", name: "Salesforce", cat: "CRM", color: "#00A1E0", desc: "Leads and opportunities", on: false },
  { id: "ghl", name: "GoHighLevel", cat: "CRM", color: "#4F7BFF", desc: "Agency sub-accounts and pipelines", on: false },
  { id: "zapier", name: "Zapier", cat: "Automation", color: "#FF4F00", desc: "Send any event to 6,000+ apps", on: false },
  { id: "make", name: "Make", cat: "Automation", color: "#A855F7", desc: "Visual automation scenarios", on: false },
  { id: "slack", name: "Slack", cat: "Automation", color: "#E01E5A", desc: "Post booked calls to a channel", on: true }
];

const ROUTES = { signal: ["Signals", "Automation"], lead: ["CRM", "Automation"], package: ["Outreach", "CRM", "Automation"], booked: ["CRM", "Automation"], reply: ["CRM", "Automation"] };

export function createIntegrations({ store, bus, config, fetchImpl = fetch, log = console }) {
  if (!store.listIntegrations().length) CATALOG.forEach(i => store.putIntegration({ ...i }));

  const sign = body => config.webhookSecret ? "sha256=" + createHmac("sha256", config.webhookSecret).update(body).digest("hex") : undefined;

  async function deliver(url, evt, attempt = 1) {
    const body = JSON.stringify(evt);
    try {
      const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Prospect-Event": evt.type, "X-Prospect-Delivery": evt.id, ...(sign(body) ? { "X-Prospect-Signature": sign(body) } : {}) }, body, signal: AbortSignal.timeout(8000) });
      if (r.status >= 500 || r.status === 429) throw new Error("HTTP " + r.status);
      return { ok: r.ok, status: r.status, attempt };
    } catch (e) {
      if (attempt >= 5) { log.warn?.(`webhook ${url} failed after ${attempt} attempts: ${e.message}`); return { ok: false, error: e.message, attempt }; }
      await new Promise(res => setTimeout(res, Math.min(30000, 500 * 2 ** attempt)));
      return deliver(url, evt, attempt + 1);
    }
  }

  async function builtIn(i, evt) {
    // Real adapters for the tools that only need a token. Others are delivered through Zapier/Make or a custom webhook.
    if (i.id === "slack" && config.keys.slackWebhook && (evt.type === "booked" || evt.type === "reply")) {
      return deliver(config.keys.slackWebhook, { text: `ProspectAI: ${evt.data.owner || ""} (${evt.data.business || ""}) ${evt.type === "booked" ? "booked a discovery call" : "replied"}` });
    }
    if (i.id === "hubspot" && config.keys.hubspot && evt.type === "lead") {
      const r = await fetchImpl("https://api.hubapi.com/crm/v3/objects/companies", { method: "POST", headers: { Authorization: `Bearer ${config.keys.hubspot}`, "Content-Type": "application/json" }, body: JSON.stringify({ properties: { name: evt.data.business, description: `ProspectAI lead: "${evt.data.keyword}" score ${evt.data.score}/5` } }) });
      return { ok: r.ok, status: r.status };
    }
    return { ok: true, status: "logged" };
  }

  bus.subscribe(evt => {
    const cats = ROUTES[evt.type]; if (!cats) return;
    if (evt.type === "signal" && !evt.data.insideFence) return;
    for (const i of store.listIntegrations()) {
      if (!i.on) continue;
      if (i.url) { if (!i.events || i.events === "all" || i.events === evt.type || (Array.isArray(i.events) && i.events.includes(evt.type))) deliver(i.url, evt); }
      else if (cats.includes(i.cat)) builtIn(i, evt).catch(e => log.warn?.(`${i.name}: ${e.message}`));
    }
  });

  return {
    list: () => store.listIntegrations().map(({ secret, ...i }) => i),
    add({ name, url, events = "all", cat = "Automation", color = "#94A3B8" }) {
      if (!name || typeof name !== "string") throw Object.assign(new Error("name is required"), { status: 400 });
      if (!/^https:\/\/[^\s]+$/.test(url || "")) throw Object.assign(new Error("url must be an https:// address"), { status: 400 });
      return store.putIntegration({ id: "wh_" + randomUUID().slice(0, 8), name: name.slice(0, 40), url, events, cat, color, desc: "Custom webhook", on: true, custom: true });
    },
    toggle(id, on) { const i = store.listIntegrations().find(x => x.id === id); if (!i) return null; i.on = !!on; store.putIntegration(i); return i; },
    remove: id => store.deleteIntegration(id),
    deliver
  };
}
