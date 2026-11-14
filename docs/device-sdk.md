# Device & app capture

ProspectAI listens for trigger keywords on phones, websites and apps **that opted in**. A device sends voice transcripts, text and its location; the server extracts the keywords, checks the geofence and, inside it, starts the Ad Engine Agent, which builds and sends the package.

```
voice / text / app event ──► POST /api/devices/:id/events ──► keyword extraction ──► geofence check ──► signal ──► package
location ────────────────────►            (updates the device's position, fires geofence enter/leave events)
```

## Rules the API enforces

- **Consent first.** `POST /api/devices` refuses to register without `"consent": true`. Ask the person in your app before calling it.
- **Per-channel consent.** A device registers for `voice`, `text`, `location` and/or `app`. Events of any other type get `403`.
- **Own token.** Each device gets a token, used in `X-Device-Token`. The server stores only its hash.
- **No raw audio.** Speech is turned into text on the device. Transcripts and text are scanned in memory and dropped; only the matched keyword, the source and a location rounded to about 11 m are kept.
- **Opt-out erases.** `DELETE /api/devices/:id` with the device token removes the device.
- Optional `DEVICE_APP_KEY`: when set, only your apps (sending `X-App-Key`) can register devices.

## Web, PWA and WebView

```html
<script src="https://YOUR-SERVER/sdk.js"></script>
<script>
  const p = ProspectSDK.init({ server: "https://YOUR-SERVER", appName: "Hydron Eats" });
  document.querySelector("#allow").onclick = async () => {
    await p.connect({ voice: true, text: true, location: true });  // registers with consent + starts location
    p.startVoice();                                                // browser speech recognition
  };
  searchBox.addEventListener("change", e => p.trackText(e.target.value));
  p.on("match", m => console.log("keyword", m.term));
  p.on("fence", f => console.log(f.inside ? "inside fence" : "outside"));
  // Settings screen: p.disconnect() stops everything and erases the device.
</script>
```

Events are batched every 2 seconds, so you can call `trackText` freely.

## iOS (Swift)

```swift
import Speech, CoreLocation

struct Prospect {
  static let server = URL(string: "https://YOUR-SERVER")!
  static var id = UserDefaults.standard.string(forKey: "pai.id")
  static var token = UserDefaults.standard.string(forKey: "pai.token")

  static func register() async throws {   // call after the person taps "Allow"
    var r = URLRequest(url: server.appendingPathComponent("api/devices")); r.httpMethod = "POST"
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = try JSONSerialization.data(withJSONObject: ["consent": true, "name": UIDevice.current.model, "platform": "ios", "channels": ["voice", "text", "location"]])
    let (data, _) = try await URLSession.shared.data(for: r)
    let j = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    id = (j["device"] as! [String: Any])["id"] as? String; token = j["token"] as? String
    UserDefaults.standard.set(id, forKey: "pai.id"); UserDefaults.standard.set(token, forKey: "pai.token")
  }

  static func send(_ event: [String: Any]) {
    guard let id, let token else { return }
    var r = URLRequest(url: server.appendingPathComponent("api/devices/\(id)/events")); r.httpMethod = "POST"
    r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue(token, forHTTPHeaderField: "X-Device-Token")
    r.httpBody = try? JSONSerialization.data(withJSONObject: event)
    URLSession.shared.dataTask(with: r).resume()
  }
}

// Location: CLLocationManager delegate (significant changes or region monitoring keeps battery low)
func locationManager(_ m: CLLocationManager, didUpdateLocations l: [CLLocation]) {
  guard let c = l.last?.coordinate else { return }
  Prospect.send(["type": "location", "lat": c.latitude, "lng": c.longitude])
}

// Voice: on-device recognition, final results only
let request = SFSpeechAudioBufferRecognitionRequest(); request.requiresOnDeviceRecognition = true
recognizer.recognitionTask(with: request) { result, _ in
  if let r = result, r.isFinal { Prospect.send(["type": "voice", "text": r.bestTranscription.formattedString]) }
}
```

Add `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and `NSLocationWhenInUseUsageDescription` to Info.plist with plain explanations.

## Android (Kotlin)

```kotlin
object Prospect {
  private const val SERVER = "https://YOUR-SERVER"
  private val http = OkHttpClient(); private val json = "application/json".toMediaType()
  var id: String? = null; var token: String? = null

  fun register(name: String) {               // after the person agrees
    val body = """{"consent":true,"name":"$name","platform":"android","channels":["voice","text","location"]}""".toRequestBody(json)
    http.newCall(Request.Builder().url("$SERVER/api/devices").post(body).build()).execute().use {
      val j = JSONObject(it.body!!.string()); id = j.getJSONObject("device").getString("id"); token = j.getString("token")
    }
  }
  fun send(event: JSONObject) {
    val r = Request.Builder().url("$SERVER/api/devices/$id/events").header("X-Device-Token", token!!).post(event.toString().toRequestBody(json)).build()
    http.newCall(r).enqueue(object : Callback { override fun onFailure(c: Call, e: IOException) {}; override fun onResponse(c: Call, r: Response) { r.close() } })
  }
}

// Voice: SpeechRecognizer with EXTRA_PREFER_OFFLINE, send onResults text
override fun onResults(results: Bundle) {
  results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
    Prospect.send(JSONObject().put("type", "voice").put("text", it))
  }
}
// Location: FusedLocationProviderClient or Geofencing API; send lat/lng on updates
```

Declare `RECORD_AUDIO` and `ACCESS_FINE_LOCATION`, and request them at runtime with a clear reason.

## Other apps and backends

Anything that can make an HTTPS request can send keywords:

```bash
curl -X POST https://YOUR-SERVER/api/devices/$ID/events -H "X-Device-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"events":[{"type":"location","lat":40.6782,"lng":-73.9442},{"type":"app","text":"user searched best tacos"}]}'
```

`POST /api/extract {"text": "..."}` returns the keywords in any text without creating a signal, which is useful for testing.

## Limits of what a device can capture

The SDK only sees what the person gives your app: speech while your app is listening, text typed or shown inside your app, and location your app is allowed to read. Mobile operating systems do not let one app read other apps' messages or listen in the background, and ProspectAI is not designed to work around that. To reach people searching elsewhere, use the signal sources that platforms provide in aggregate: Search Console, Maps, and the Meta, TikTok and Google pixels.
