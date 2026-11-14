# ProspectAI

A prospecting agent for small businesses, built for **Hydron Culture**. It watches keyword searches inside a geofenced area, finds local businesses with a weak online presence, and sends each one a personalized outreach package: email, SMS, cold call, voice message, social ads through a pixel, a competitor report and a lead form.

Google handles trillions of searches a year. A business that isn't visible there loses those customers to competitors that are.

## The dashboard

| Area | What it does |
| --- | --- |
| **Center: live map** | Geofence circle with a radar sweep. Each keyword signal blinks in its keyword's color. Shape shows the source: ● search, ▲ maps, ◆ voice, ■ pixel. Tap the map to move the fence, tap a signal for details, tap a business pin to open its package. |
| **Left: targeting** | **Keywords**: add, toggle and color-code trigger terms, and turn signal sources on or off. **Geofence**: radius, search volume, custom lat/lng. **Qualify**: the five weak-presence checks and the threshold. **Sequence**: the follow-up timeline, MVP mode (3 touches) and the 14-day recycle. |
| **Right: engine** | **Signals**: live feed. **Ad Engine**: the pipeline funnel (Detect → Qualify → Reach out → Replied → Convert), outreach packages, channel toggles and editable templates. **Pixel ↔ Voice**: the two-way bridge between voice searches and social pixel audiences. **Integrations**: connect tools, add custom webhooks, developer API. |

On phones the layout stacks with the map first, then the engine panel, then targeting.

## Agent workflow

1. **Detect**: keyword signal from Search Console, Maps, voice search or a social pixel, inside the geofence
2. **Qualify**: score nearby businesses on profile, reviews/rating, search and AI ranking, directory coverage and Google Ads. Failing 3 or more checks (configurable) qualifies the business. Businesses that pass go to the monitoring and maintenance offer.
3. **Reach out**: the Ad Engine Agent builds a package with `{{owner_name}}`, `{{business_name}}`, `{{keyword}}`, `{{search_count}}`, `{{competitor}}` and `{{gap}}` filled in
4. **Follow up**: Day 1 email + report → Day 3 SMS → Day 7 call, or the full 10-day multi-channel sequence
5. **Convert**: a reply books a discovery call. Pipeline MRR is estimated at $299/month per booked account.

## Run it

The dashboard is one static file with no build step. Open `index.html`, or:

```bash
node server/index.js
```

Then open http://localhost:8787. The server exposes the same loop as an API (`/api/signals`, `/api/prospects`, `/api/outreach`, `/api/integrations`). Every adapter runs as a dry run until you set its keys:

```bash
export GOOGLE_MAPS_API_KEY=... SENDGRID_API_KEY=... FROM_EMAIL=you@yourdomain.com
export TWILIO_SID=... TWILIO_TOKEN=... TWILIO_FROM=+15551234567
```

After editing `src/app.html`, run `./build.sh` to regenerate `index.html`.

## Connecting other tools

From the browser console, or any script loaded on the page:

```js
ProspectAI.pushSignal({ keyword: "pizza near me", lat: 40.6782, lng: -73.9442, source: "voice" });
ProspectAI.on("package", pkg => console.log(pkg));          // also: signal, lead, booked
ProspectAI.registerIntegration({ name: "Airtable", category: "CRM", onEvent: (type, data) => {} });
ProspectAI.setGeofence({ lat: 25.8283, lng: -80.1937, radius: 2 });
ProspectAI.getState();
```

Events are also dispatched as `window` events (`prospect:signal`, `prospect:lead`, `prospect:package`, `prospect:booked`), and custom webhooks can be added from the Integrations tab.

## Data and compliance

The dashboard runs on **simulated signals and example businesses** until real APIs are connected. In production, voice and pixel signals must come only from users who opted in through the platform SDKs. Search Console and ad platforms report aggregated data, not individual searchers. SMS and calls must follow TCPA rules, including consent, quiet hours and STOP replies, and email must follow CAN-SPAM.

## Pricing model

- $299/month base, up to 200 leads
- $1.50 per lead above that
- $799/month agency tier with white-label and API access

See [docs/architecture.md](docs/architecture.md) for the system design.
