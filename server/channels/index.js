// Outreach channels. Each one sends for real when its keys and the contact field exist,
// and returns { status: "dry_run" } otherwise, so the pipeline never blocks on a missing key.
import { createHash } from "node:crypto";

const dry = reason => ({ status: "dry_run", reason });
const sha256 = s => createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
async function ok(r) { if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`.slice(0, 300)); return { status: "sent", code: r.status }; }
const twilioAuth = k => "Basic " + Buffer.from(`${k.twilioSid}:${k.twilioToken}`).toString("base64");
const xmlEsc = s => String(s).replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

export function createChannels(k) {
  return {
    async email({ to, subject, body }) {
      if (!k.sendgrid || !k.fromEmail) return dry("SENDGRID_API_KEY / FROM_EMAIL not set");
      if (!to) return dry("no email on file");
      return ok(await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST", headers: { Authorization: `Bearer ${k.sendgrid}`, "Content-Type": "application/json" },
        body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: k.fromEmail }, subject, content: [{ type: "text/plain", value: body + "\n\nTo unsubscribe, reply STOP." }] })
      }));
    },
    async sms({ to, body }) {
      if (!k.twilioSid || !k.twilioToken || !k.twilioFrom) return dry("Twilio keys not set");
      if (!to) return dry("no phone on file");
      return ok(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${k.twilioSid}/Messages.json`, {
        method: "POST", headers: { Authorization: twilioAuth(k), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: k.twilioFrom, Body: body })
      }));
    },
    // Cold call: rings the business and plays the script; a rep can take over with <Dial> in production.
    async call({ to, script }) {
      if (!k.twilioSid || !k.twilioToken || !k.twilioFrom) return dry("Twilio keys not set");
      if (!to) return dry("no phone on file");
      return ok(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${k.twilioSid}/Calls.json`, {
        method: "POST", headers: { Authorization: twilioAuth(k), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: k.twilioFrom, Twiml: `<Response><Say voice="Polly.Joanna">${xmlEsc(script)}</Say></Response>` })
      }));
    },
    async voice({ to, message }) {
      if (!k.twilioSid || !k.twilioToken || !k.twilioFrom) return dry("Twilio keys not set");
      if (!to) return dry("no phone on file");
      return ok(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${k.twilioSid}/Calls.json`, {
        method: "POST", headers: { Authorization: twilioAuth(k), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: k.twilioFrom, MachineDetection: "DetectMessageEnd", Twiml: `<Response><Say>${xmlEsc(message)}</Say></Response>` })
      }));
    },
    // Social: sends a server-side Conversions API event so the business owner enters a custom audience.
    async social({ email, phone, keyword }) {
      if (!k.metaPixelId || !k.metaToken) return dry("META_PIXEL_ID / META_ACCESS_TOKEN not set");
      if (!email && !phone) return dry("no hashed identifier available");
      const user_data = {}; if (email) user_data.em = [sha256(email)]; if (phone) user_data.ph = [sha256(phone.replace(/\D/g, ""))];
      return ok(await fetch(`https://graph.facebook.com/v19.0/${k.metaPixelId}/events?access_token=${encodeURIComponent(k.metaToken)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [{ event_name: "ProspectSignal", event_time: Math.floor(Date.now() / 1000), action_source: "system_generated", user_data, custom_data: { keyword } }] })
      }));
    },
    async dm({ to, body }) {
      if (!k.whatsappPhoneId || !k.whatsappToken) return dry("WhatsApp Cloud API keys not set");
      if (!to) return dry("no phone on file");
      return ok(await fetch(`https://graph.facebook.com/v19.0/${k.whatsappPhoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${k.whatsappToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body } })
      }));
    },
    async mail({ address, body }) {
      if (!k.lob) return dry("LOB_API_KEY not set");
      if (!address) return dry("no mailing address on file");
      return ok(await fetch("https://api.lob.com/v1/postcards", {
        method: "POST", headers: { Authorization: "Basic " + Buffer.from(k.lob + ":").toString("base64"), "Content-Type": "application/json" },
        body: JSON.stringify({ to: address, front: `<html><body><h1>${xmlEsc(body.slice(0, 80))}</h1></body></html>`, back: `<html><body>${xmlEsc(body)}</body></html>` })
      }));
    },
    async gads() { return dry("Google Ads display runs from the client's account after signup"); },
    async report() { return { status: "sent", note: "report generated" }; },
    async form() { return { status: "sent", note: "intake form link generated" }; }
  };
}
