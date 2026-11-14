# Plugins & API connectors

There are four ways to connect ProspectAI to any other app, from no-code to code:

| Way | Where | Good for |
| --- | --- | --- |
| **Webhook** | Integrations → "Add any app by webhook" | Zapier, Make, n8n, your own endpoint. Signed with `X-Prospect-Signature`, retried 5 times. |
| **API connector** | Integrations → "Connect any API" or `POST /api/integrations` with `method`, `headers`, `bodyTemplate` | Calling a third-party REST API directly (Pipedrive, Airtable, Monday, a TV partner) with your own URL, headers and JSON body. |
| **Server plugin** | a `.js` file in `plugins/` | New outreach channels, new signal sources, custom logic. |
| **REST + SSE** | `/api/*`, `/api/stream` | Building your own app on top of ProspectAI. See `openapi.yaml`. |

## API connector templates

URL and body are templates. `{{path}}` reads from the event:

| Placeholder | Value |
| --- | --- |
| `{{type}}` | `package`, `lead`, `booked`, `reply`, `signal` |
| `{{at}}` | ISO time |
| `{{data.keyword}}` | trigger keyword |
| `{{data.business.name}}`, `{{data.business.owner}}`, `{{data.business.rating}}` | business on a package |
| `{{data.business}}` | business name on `lead` events |
| `{{data.score}}` | weak checks out of 5 |
| `{{data.channels}}` | channel list as JSON |

Values are JSON-escaped inside the body. Header values (API tokens) are stored on the server and never returned by the API; only header names are shown. Use **Test** in the Integrations panel to send a sample `package` event.

```bash
curl -X POST localhost:8787/api/integrations -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{
  "name": "Pipedrive", "method": "POST", "events": "lead",
  "url": "https://api.pipedrive.com/v1/leads?api_token=YOUR_TOKEN",
  "bodyTemplate": "{\"title\":\"{{data.business}} — {{data.keyword}}\"}"
}'
```

## Writing a plugin

```js
// plugins/my-plugin.js
export default {
  name: "My plugin",
  description: "Shown in the dashboard",

  // New outreach channels. Turn them on by adding the id to config.channels (PUT /api/config).
  channels: {
    async sms_eu({ pkg, messages, business }) {
      // messages has subject, email, sms, call, voice, ad, youtube, messenger, tv
      return { status: "sent" };           // or "dry_run" / "failed"
    }
  },

  // A new signal source. Call ingest() for each keyword hit; return a stop function.
  async sources({ ingest, config }) {
    const t = setInterval(async () => {
      // e.g. poll a social listening API, a call-tracking system or a smart-speaker skill
      // await ingest({ keyword: "pizza near me", lat: 40.67, lng: -73.94, source: "app" });
    }, 60000);
    return () => clearInterval(t);
  },

  // Every event on the bus: signal, lead, monitor, package, touch, reply, booked, device, geofence, config
  async onEvent(evt) {}
};
```

Two working examples ship in `plugins/`: `example-airtable.js` (CRM sync) and `example-tv-network.js` (a `localtv` channel for TV / CTV buying). Set `PLUGINS_DIR` to load plugins from somewhere else, or to an empty string to load none. Plugins run inside the server, so install only code you trust.
