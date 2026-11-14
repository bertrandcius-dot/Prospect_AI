# ProspectAI

A prospecting agent for small businesses, built for **Hydron Culture**. It watches keyword searches inside a geofenced area, finds local businesses with a weak online presence, and sends each one a personalized outreach package: email, SMS, cold call, voice message, social ads through a pixel, a competitor report and a lead form.

## The dashboard

A black, full-screen live map with a glass HUD. Every feature sits behind an icon, so the map stays clear.

| Where | Icon | Opens |
| --- | --- | --- |
| Left rail | Search | **Keyword triggers**: add, color and toggle terms; turn signal sources on or off |
| | Target | **Geofence**: radius, demo volume, any lat/lng (or tap the map) |
| | Filter | **Qualification rules**: the 5 weak-presence checks and the threshold |
| | Branch | **Follow-up sequence**: 10-day timeline, MVP mode (3 touches), recycle cycles |
| | Bolt / crosshair | Send a test burst of signals / recenter the fence |
| Right rail | Pulse | **Live signals** feed (badge counts unseen signals) |
| | Robot | **Ad Engine Agent**: funnel, packages, channels, editable templates |
| | Mic | **Pixel ↔ Voice bridge** |
| | Plug | **Integrations**: 15 built-in apps plus any webhook |
| | Server | **Connection & API**: server address, API key, demo traffic, API reference |

On phones the two rails merge into one bottom dock and drawers open as sheets.

Signals blink in their keyword's color. Shape shows the source: ● search, ▲ maps, ◆ voice, ■ pixel. Tap a signal for details, tap a business pin to open its package, tap empty map to move the fence. Each package lets you log **Mark replied** and **Mark call booked**, which updates the pipeline and every connected app.

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
  integrations.js   catalog, signed webhooks (HMAC-SHA256) with retry + backoff, HubSpot, Slack
  channels/         SendGrid, Twilio SMS/calls/voicemail, Meta Conversions API, WhatsApp Cloud, Lob
  providers/        Google Places (New) text search, deterministic simulator
  simulator.js      demo traffic through the real pipeline
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

## Data and compliance

Demo data is simulated. In production, voice and pixel signals must come only from people who opted in through the platform SDKs; Search Console and ad platforms report aggregated searches, not individual searchers. SMS and calls must follow TCPA (consent, quiet hours, STOP), and email must follow CAN-SPAM. Set `API_KEY` before exposing the server.

## Pricing model

$299/month base (200 leads), $1.50 per extra lead, $799/month agency tier with white-label and API access.
