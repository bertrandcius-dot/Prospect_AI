// Business lookup. GooglePlaces uses the Places API (New) Text Search; SimulatedPlaces returns
// deterministic example businesses so the whole loop runs without keys.

const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const NAMES = {
  Restaurant: [["Mama", "Tony's", "Lakou", "Bella", "Golden", "Casa", "Island", "Sunset", "Urban", "Kreyol"], ["Kitchen", "Pizzeria", "Taqueria", "Grill", "Bistro", "Cafe", "Eats", "Table", "Spot", "Plates"]],
  "Home services": [["Rapid", "Borough", "AllPro", "Neighborhood", "Precision", "Reliable", "Metro"], ["Plumbing", "Pipe Co.", "Drain Pros", "Home Repair", "Rooter", "Services"]],
  Beauty: [["Crown", "Glow", "Silk", "Velvet", "Studio", "Royal", "Fresh", "Luxe"], ["Salon", "Hair Bar", "Beauty Lounge", "Braids", "Cuts", "Spa"]],
  Health: [["Smile", "Family", "Bright", "Care", "Harbor", "Park"], ["Dental", "Clinic", "Health", "Wellness", "Chiropractic"]],
  Retail: [["Corner", "Block", "Market", "Thread", "Local", "Uptown"], ["Shop", "Boutique", "Goods", "Supply", "Market"]]
};
const OWNERS = ["Marie Joseph", "Tony Russo", "Ana Delgado", "Kwame Mensah", "Linh Tran", "Jean-Baptiste Pierre", "Fatima Ali", "Carlos Rivera", "Grace Kim", "Dwayne Brooks", "Sofia Rossi", "Malik Johnson", "Nadia Haddad", "Luis Ortega", "Esther Charles"];

export class SimulatedPlaces {
  name = "simulated";
  async search({ keyword, category = "Restaurant", lat, lng, locationName = "" }) {
    const key = locationName + "|" + keyword;
    const r = rng(hash(key));
    const parts = NAMES[category] || NAMES.Restaurant;
    return Array.from({ length: 7 }, (_, i) => {
      const rating = Math.round((2.9 + r() * 2.0) * 10) / 10;
      const weakProfile = r() < 0.55;
      return {
        id: `sim:${hash(key)}:${i}`,
        name: parts[0][Math.floor(r() * parts[0].length)] + " " + parts[1][(Math.floor(r() * parts[1].length) + i) % parts[1].length],
        owner: OWNERS[Math.floor(r() * OWNERS.length)],
        rating, reviews: Math.floor(12 + r() * 380),
        website: weakProfile ? (r() < 0.5 ? "https://example.com" : null) : "https://example.com",
        hasHours: !weakProfile, hasPhotos: !weakProfile,
        rank: r() < 0.6 ? 8 + Math.floor(r() * 25) : 1 + Math.floor(r() * 5),
        dirs: r() < 0.55 ? Math.floor(r() * 3) : 3 + Math.floor(r() * 3),
        hasAds: r() > 0.7,
        lat: lat + (r() - 0.5) * 0.02, lng: lng + (r() - 0.5) * 0.02,
        email: null, phone: null, simulated: true
      };
    });
  }
}

export class GooglePlaces {
  name = "google";
  constructor(key) { this.key = key; }
  async search({ keyword, lat, lng, radiusMi = 1.5 }) {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.regularOpeningHours,places.photos,places.location,places.nationalPhoneNumber"
      },
      body: JSON.stringify({ textQuery: keyword, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(50000, radiusMi * 1609) } }, pageSize: 20 })
    });
    if (!r.ok) throw new Error(`Places API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return (j.places || []).map((p, i) => ({
      id: "gp:" + p.id, name: p.displayName?.text, owner: null,
      rating: p.rating ?? 0, reviews: p.userRatingCount ?? 0, website: p.websiteUri || null,
      hasHours: !!p.regularOpeningHours, hasPhotos: (p.photos || []).length >= 5,
      rank: i + 1, dirs: null, hasAds: null, // enrich with your directory + ads checks
      lat: p.location?.latitude, lng: p.location?.longitude, phone: p.nationalPhoneNumber || null, email: null
    }));
  }
}

export function competitorFor(biz) {
  const r = rng(hash(biz.id + "c"));
  const p = NAMES.Restaurant;
  return { name: `${p[0][Math.floor(r() * p[0].length)]} ${p[1][Math.floor(r() * p[1].length)]} ${["Express", "House", "Spot", "Corner"][Math.floor(r() * 4)]}`, rating: +(4.5 + r() * 0.4).toFixed(1), reviews: Math.floor(400 + r() * 900), rank: 1 + Math.floor(r() * 2), dirs: 6 };
}
