# Architecture

```mermaid
flowchart LR
  subgraph Signals
    GSC[Search Console] --> ING
    MAPS[Google Maps] --> ING
    VOICE[Voice search, opt-in] --> ING
    PIX[Social pixel] --> ING
  end
  ING[Signal ingest + geofence filter] --> Q{Qualify: 5 weak-presence checks}
  Q -- "3+ failed" --> AGENT[Ad Engine Agent: build package]
  Q -- "passes" --> MON[Monitoring and maintenance offer]
  AGENT --> EMAIL[Email]
  AGENT --> SMS[SMS]
  AGENT --> CALL[Cold call / voice drop]
  AGENT --> ADS[Social + Google ads]
  AGENT --> REP[Competitor report + lead form]
  VOICE <-. bridge .-> PIX
  AGENT --> SEQ[Follow-up sequence, 14-day recycle]
  SEQ --> CONV[Discovery call → client]
  ING & Q & AGENT & CONV --> BUS[(Event bus: signal, lead, package, booked)]
  BUS --> INT[Integrations: CRM, Zapier, Make, Slack, webhooks]
```

## Components

| Layer | Dashboard (`src/app.html`) | Server (`server/index.js`) |
| --- | --- | --- |
| Ingest | `spawn()` / `ProspectAI.pushSignal()` | `POST /api/signals` |
| Geofence | Canvas circle, haversine-equivalent screen distance | `insideAnyFence()` with haversine miles |
| Qualify | `scoreBiz()`, configurable criteria and threshold | `qualify()` |
| Package | `agentProcess()` + templates | `POST /api/outreach` (SendGrid, Twilio) |
| Event bus | `emit()` → listeners, `window` events, integrations | `publish()` → registered webhooks |

## Production path

1. Replace the simulated signal generator with Search Console query exports by city, plus Places Text Search for each keyword.
2. Store prospects and packages in Postgres with a `(place_id, keyword)` uniqueness key so each business gets one package per cycle.
3. Run the follow-up sequence on a job queue (BullMQ, Cloud Tasks) keyed by package id and day offset.
4. Feed the dashboard through Server-Sent Events from the event bus instead of the in-page simulator.
