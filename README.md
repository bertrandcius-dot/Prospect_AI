# Prospect_AI

Client Prospecting Engine for small businesses, built for **Hydron Culture**. It picks up trigger keywords from searches, pixels and opted-in devices and apps (voice, text and location), checks them against a geofence, finds local businesses with a weak online presence, and sends each one a personalized package: **email, cold call, text, voice message, social media ads, YouTube ads, WhatsApp, Messenger and TV / streaming TV ads**, plus a competitor report and a lead form.

## The dashboard

A black, full-screen live map with a glass HUD. Every feature sits behind an icon, so the map stays clear.

| Where | Icon | Opens |
| --- | --- | --- |
| Left rail | Search | **Keyword triggers**: add, color and toggle terms; turn signal sources on or off |
| | Target | **Geofence**: radius, demo volume, any lat/lng (or tap the map) |
| | Filter | **Qualification rules**: the 5 weak-presence checks and the threshold |
| | Branch | **Follow-up sequence**: 10-day timeline, MVP mode (3 touches), recycle cycles |
| | Phone | **Device capture**: consent box, voice (speech to text), location, place on map, text from apps, connected devices list, SDK snippet |
| | Bolt / crosshair | Send a test burst of signals / recenter the fence |
| Right rail | Pulse | **Live signals** feed (badge counts unseen signals) |
| | Robot | **Ad Engine Agent**: funnel, packages, channels, editable templates |
| | Mic | **Pixel ↔ Voice bridge** |
| | Plug | **Integrations**: 18 built-in apps, any webhook, any REST API (connector), server plugins |
| | Server | **Connection & API**: server address, API key, demo traffic, API reference |

On phones the two rails merge into one bottom dock and drawers open as sheets.

Signals blink in their keyword's color. Shape shows the source: ● search, ▲ maps, ◆ voice, ■ pixel, ⬢ text, ✦ app. Phone glyphs are connected devices; violet ones are inside the fence. Tap a signal for details, tap a business pin to open its package, tap empty map to move the fence. Each package lets you log **Mark replied** and **Mark call booked**, which updates the pipeline and every connected app.

## Device capture (voice, text, location)

Phones, websites and apps that opted in send what the person says or types in your app and where they are. The agent extracts the trigger keywords (it tolerates voice phrasing like "pizza place near me", plurals and aliases), places them at the device's location, and fires the package when the device is inside the geofence.

- Web: `<script src="/sdk.js">` then `ProspectSDK.init({server}).connect()`; native apps call the same REST API. See [docs/device-sdk.md](docs/device-sdk.md) for web, Swift and Kotlin.
- Consent is enforced by the API: no registration without `consent: true`, per-channel permissions, a per-device token, and opt-out that erases the device.
- Audio never leaves the device; transcripts are scanned and dropped, only matched keywords and a rounded location are stored.
- In the hosted artifact, voice uses the viewer's dictation permission and location falls back to placing the device on the map.

## Package channels

| Channel | Adapter | Turns real with |
| --- | --- | --- |
| Email | SendGrid | `SENDGRID_API_KEY`, `FROM_EMAIL` |
| Text, cold call, voice message | Twilio | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` |
| Social media ads | Meta Conversions API (custom audiences) | `META_PIXEL_ID`, `META_ACCESS_TOKEN` |
| YouTube ads | Google Ads Customer Match list used by your YouTube campaign | `GOOGLE_ADS_*` |
| WhatsApp | WhatsApp Cloud API | `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN` |
| Messenger | Messenger Send API | `MESSENGER_PAGE_TOKEN` |
| TV / streaming TV | Your CTV or station partner endpoint, or the `localtv` plugin | `TV_ADS_URL`, `TV_ADS_KEY` |
| Mailed brochure | Lob | `LOB_API_KEY` |
| Anything else | A plugin channel or an API connector | see [docs/plugins.md](docs/plugins.md) |

## Demo vs live

- **Demo**: opened as a plain file or as the hosted artifact, the dashboard runs the same pipeline in the browser with example businesses.
- **Live**: served by the ProspectAI server (or pointed at it under Connection & API), it streams real events over SSE, and every change you make (keywords, fence, rules, channels, templates, integrations) is saved on the server.

## Run it

```bash
cp .env.example .env
npm start            # http://localhost:8787
npm run dev          # demo traffic on, 10-day sequence runs in ~50 seconds
npm test
docker compose up --build
```

No dependencies to install; Node 18.17+ only.

## Architecture

```
server/
  index.js          entry, graceful shutdown
  app.js            REST routes, SSE stream, auth, rate limiting, static dashboard
  agent.js          signal → geofence → lookup → qualify → package → channels → sequence
  bus.js            event bus with replay buffer (swap for Redis pub/sub to fan out)
  store.js          MemoryStore + JSON snapshots (swap for Postgres, same methods)
  integrations.js   catalog, signed webhooks (HMAC-SHA256) with retry + backoff, API connectors, HubSpot, Slack
  devices.js        consented device registry, voice/text/location events, geofence enter/leave
  keywords.js       keyword extraction from voice and text
  plugins.js        plugin loader (channels, sources, event handlers)
  channels/         SendGrid, Twilio, Meta, YouTube (Google Ads), WhatsApp, Messenger, TV/CTV, Lob
  providers/        Google Places (New) text search, deterministic simulator
  simulator.js      demo traffic through the real pipeline
plugins/            example plugins: Airtable sync, local TV network
sdk/prospect-sdk.js device SDK served at /sdk.js
src/app.html        the dashboard (build.sh wraps it into index.html)
openapi.yaml        full API reference
```

Every channel runs as a **dry run** until its keys are set, so the whole loop works on day one and turns real one integration at a time.

### Scaling

- The HTTP layer is stateless when `DATA_FILE` is empty: run as many replicas as you need behind a load balancer.
- Replace `MemoryStore` with a Postgres implementation of the same 12 methods, and the bus `subscribe/publish` with Redis pub/sub, so every replica sees every event.
- Move the follow-up `setTimeout` scheduler in `agent.js` to a durable queue (BullMQ, Cloud Tasks, SQS) keyed by package id and day.
- Rate limiting is per instance; put a gateway limit in front for global quotas.

## Connecting other apps

```bash
# send a signal from anything: a form, Zapier, a voice app, your own tracker
curl -X POST localhost:8787/api/signals -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' \
  -d '{"keyword":"pizza near me","lat":40.6782,"lng":-73.9442,"source":"voice"}'

# receive every package in your app (signed with WEBHOOK_SECRET)
curl -X POST localhost:8787/api/integrations -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' \
  -d '{"name":"Airtable","url":"https://hooks.example.com/abc","events":"package"}'
```

Verify webhooks by computing `sha256=` + HMAC-SHA256 of the raw body with `WEBHOOK_SECRET` and comparing it to `X-Prospect-Signature`.

In the page: `ProspectAI.on("package", fn)`, `ProspectAI.pushSignal({...})`, `ProspectAI.registerIntegration({name, onEvent})`, `ProspectAI.connect(url)`, `ProspectAI.getState()`. Events are also dispatched as `window` events named `prospect:<type>`.

## UX ideas

Suggestions for making the app more engaging and easier to navigate are in [docs/ux-suggestions.md](docs/ux-suggestions.md). They are proposals only and have not been built.

## Data and compliance

Demo data is simulated. In production, voice and pixel signals must come only from people who opted in through the platform SDKs; Search Console and ad platforms report aggregated searches, not individual searchers. SMS and calls must follow TCPA (consent, quiet hours, STOP), and email must follow CAN-SPAM. Set `API_KEY` before exposing the server.

## Pricing model

$299/month base (200 leads), $1.50 per extra lead, $799/month agency tier with white-label and API access.
