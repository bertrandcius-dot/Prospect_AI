// Example plugin: copies every qualified lead and booked call to Airtable.
// Set AIRTABLE_TOKEN, AIRTABLE_BASE and AIRTABLE_TABLE to turn it on; without them it does nothing.
const { AIRTABLE_TOKEN, AIRTABLE_BASE, AIRTABLE_TABLE = "Leads" } = process.env;

export default {
  name: "Airtable sync",
  description: "Adds qualified leads and booked calls to an Airtable table",
  async onEvent(evt) {
    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE) return;
    if (evt.type !== "lead" && evt.type !== "booked") return;
    const d = evt.data;
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields: { Business: d.business?.name || d.business, Owner: d.owner || d.business?.owner, Keyword: d.keyword, Status: evt.type, At: evt.at } }] })
    });
  }
};
