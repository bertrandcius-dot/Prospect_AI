// Example plugin: adds a "localtv" outreach channel that books a TV spot through your station or CTV partner's API.
// Replace the URL with your partner's endpoint. Without TV_PARTNER_URL it runs as a dry run.
const { TV_PARTNER_URL, TV_PARTNER_KEY } = process.env;

export default {
  name: "Local TV network",
  description: "Books 15-second local TV / CTV spots for a package",
  channels: {
    async localtv({ pkg, messages }) {
      if (!TV_PARTNER_URL) return { status: "dry_run", reason: "TV_PARTNER_URL not set" };
      const r = await fetch(TV_PARTNER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(TV_PARTNER_KEY ? { Authorization: `Bearer ${TV_PARTNER_KEY}` } : {}) },
        body: JSON.stringify({ advertiser: pkg.business.name, script: messages.tv, geo: { lat: pkg.lat, lng: pkg.lng, radiusMi: 5 }, lengthSec: 15 })
      });
      return { status: r.ok ? "sent" : "failed", code: r.status };
    }
  }
};
