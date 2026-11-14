// Central configuration. Every value comes from the environment so the same image runs in dev, staging and prod.
const env = process.env;
const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: num(env.PORT, 8787),
  host: env.HOST || "0.0.0.0",
  apiKey: env.API_KEY || "",                       // required on write routes when set
  corsOrigin: env.CORS_ORIGIN || "*",
  dataFile: env.DATA_FILE || "",                   // JSON snapshot path; empty = memory only
  simulate: bool(env.SIMULATE, !env.GOOGLE_MAPS_API_KEY), // demo traffic when no real signal source
  simulateRate: num(env.SIMULATE_RATE, 30),        // signals per minute
  sequenceDayMs: num(env.SEQUENCE_DAY_MS, 86_400_000), // shrink to e.g. 5000 for demos
  rateLimit: { perMinute: num(env.RATE_LIMIT_PER_MIN, 600) },
  webhookSecret: env.WEBHOOK_SECRET || "",
  deviceAppKey: env.DEVICE_APP_KEY || "",          // when set, apps must send X-App-Key to register devices
  pluginsDir: env.PLUGINS_DIR ?? "plugins",
  keys: {
    googleMaps: env.GOOGLE_MAPS_API_KEY || "",
    googleMapsBrowser: env.GOOGLE_MAPS_BROWSER_KEY || "",   // public key for the dashboard map; restrict it by HTTP referrer
    sendgrid: env.SENDGRID_API_KEY || "",
    fromEmail: env.FROM_EMAIL || "",
    twilioSid: env.TWILIO_SID || "",
    twilioToken: env.TWILIO_TOKEN || "",
    twilioFrom: env.TWILIO_FROM || "",
    metaPixelId: env.META_PIXEL_ID || "",
    metaToken: env.META_ACCESS_TOKEN || "",
    whatsappPhoneId: env.WHATSAPP_PHONE_ID || "",
    whatsappToken: env.WHATSAPP_TOKEN || "",
    lob: env.LOB_API_KEY || "",
    hubspot: env.HUBSPOT_TOKEN || "",
    slackWebhook: env.SLACK_WEBHOOK_URL || "",
    messengerPageToken: env.MESSENGER_PAGE_TOKEN || "",
    tvAdsUrl: env.TV_ADS_URL || "",
    tvAdsKey: env.TV_ADS_KEY || "",
    googleAds: {
      accessToken: env.GOOGLE_ADS_ACCESS_TOKEN || "",
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      customerId: env.GOOGLE_ADS_CUSTOMER_ID || "",
      loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "",
      userListId: env.GOOGLE_ADS_USER_LIST_ID || ""
    }
  }
};
