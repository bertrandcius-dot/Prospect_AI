export const DEFAULT_TEMPLATES = {
  emailSubject: "{{owner_name}}, {{search_count}} people searched \"{{keyword}}\" near {{business_name}}",
  email: "Hi {{owner_name}},\n\nIn the last 7 days, {{search_count}} people within {{radius}} miles of {{business_name}} searched for \"{{keyword}}\". Most of them ended up at {{competitor}}.\n\nYour Google profile is rated {{rating}}, and {{gap}}.\n\nI put together a free report that shows where those customers went and the three changes that would bring them to you. Want me to send it, or walk you through it in 10 minutes this week?\n\nHydron Culture · ProspectAI",
  sms: "Hi {{owner_name}}, this is Hydron Culture. {{search_count}} locals searched \"{{keyword}}\" near {{business_name}} this week. Want the free report on where they went? Reply YES. Reply STOP to opt out.",
  call: "Hi, is this {{owner_name}}? I'm calling from Hydron Culture about {{business_name}}.\n\nThis week {{search_count}} people within {{radius}} miles searched \"{{keyword}}\". Most picked {{competitor}}. I noticed {{gap}}.\n\nCould I take 10 minutes Thursday to show you the report?",
  voice: "Hi {{owner_name}}, it's Hydron Culture. {{search_count}} people near {{business_name}} searched \"{{keyword}}\" this week and most went to {{competitor}}. I have a free report for you. Call or text me back at this number.",
  ad: "Looking for {{keyword}}? {{business_name}} is {{radius}} miles away. Order today."
};

export const fill = (tpl, vars) => String(tpl).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export function gapText(b) {
  const g = [];
  const f = b.fails || {};
  if (f.profile) g.push(b.website ? "your Google profile is missing hours, photos and menu" : "there is no website on your Google profile");
  if (f.ads) g.push("you have no active Google Ads");
  if (f.dirs) g.push(`you are listed on only ${b.dirs ?? 0} of 6 directories`);
  if (f.rank) g.push(`you rank #${b.rank} for this search`);
  if (f.rating) g.push("recent reviews are pulling your rating down");
  return g.slice(0, 2).join(" and ") || "your profile has room to grow";
}

export function varsFor(pkg, config) {
  const b = pkg.business;
  return {
    owner_name: (b.owner || "there").split(" ")[0],
    business_name: b.name,
    keyword: pkg.keyword,
    search_count: Math.max(pkg.demand * 9 + 23, 23),
    radius: config.fences?.[0]?.radiusMi ?? 1.5,
    rating: (b.rating ?? 0).toFixed(1),
    competitor: pkg.competitor?.name || "a nearby competitor",
    gap: gapText(b),
    location: config.location?.name || ""
  };
}
