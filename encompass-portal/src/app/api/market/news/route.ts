import { NextRequest, NextResponse } from "next/server";

const FEEDS: Record<string, string> = {
  "mortgage-rates":
    'https://news.google.com/rss/search?q=("mortgage+rates"+OR+"30-year+fixed"+OR+"15-year+fixed"+OR+"ARM+rates")&hl=en-US&gl=US&ceid=US:en',
  "housing-market":
    'https://news.google.com/rss/search?q=("housing+market"+OR+"home+prices"+OR+"home+sales"+OR+"Case-Shiller")&hl=en-US&gl=US&ceid=US:en',
  "fed-policy":
    'https://news.google.com/rss/search?q=("Federal+Reserve"+OR+"FOMC"+OR+"interest+rate+decision"+OR+"rate+cut"+OR+"rate+hike")&hl=en-US&gl=US&ceid=US:en',
  "lending-industry":
    'https://news.google.com/rss/search?q=("mortgage+industry"+OR+"mortgage+lenders"+OR+"loan+origination"+OR+"Fannie+Mae"+OR+"Freddie+Mac")&hl=en-US&gl=US&ceid=US:en',
};

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  category: string;
}

function extractCDATA(text: string): string {
  const m = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : text;
}

function parseRSSItems(xml: string, category: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const itemXml of itemMatches.slice(0, 10)) {
    const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (titleMatch && linkMatch) {
      items.push({
        title: extractCDATA(titleMatch[1]).trim(),
        link: extractCDATA(linkMatch[1]).trim(),
        pubDate: pubDateMatch ? pubDateMatch[1].trim() : "",
        source: sourceMatch ? extractCDATA(sourceMatch[1]).trim() : "",
        category,
      });
    }
  }
  return items;
}

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
  MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",
  TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",
  WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",
};

function buildStateNewsUrl(stateName: string): string {
  const q = encodeURIComponent(`"${stateName}" ("housing market" OR "real estate" OR "mortgage" OR "home prices" OR "home sales")`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export async function GET(req: NextRequest) {
  try {
    const cat = req.nextUrl.searchParams.get("category") || "";
    const states = req.nextUrl.searchParams.get("states") || ""; // e.g. "CA,TX,FL,NC"

    // Determine which feeds to fetch
    const feedEntries: [string, string][] = [];

    if (cat === "local-market" && states) {
      // Local market only: fetch news for specified states
      const stateList = states.split(",").slice(0, 8); // max 8 states
      for (const st of stateList) {
        const name = STATE_NAMES[st.trim()];
        if (name) feedEntries.push([`local:${st.trim()}`, buildStateNewsUrl(name)]);
      }
    } else if (cat && FEEDS[cat]) {
      feedEntries.push([cat, FEEDS[cat]]);
    } else {
      // All categories + local news for top states
      feedEntries.push(...Object.entries(FEEDS));
      if (states) {
        const stateList = states.split(",").slice(0, 5); // top 5 for "all" view
        for (const st of stateList) {
          const name = STATE_NAMES[st.trim()];
          if (name) feedEntries.push([`local:${st.trim()}`, buildStateNewsUrl(name)]);
        }
      }
    }

    const results = await Promise.allSettled(
      feedEntries.map(async ([key, url]) => {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          next: { revalidate: 300 },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        const category = key.startsWith("local:") ? "local-market" : key;
        return parseRSSItems(xml, category);
      })
    );

    const allItems: NewsItem[] = [];
    const seenTitles = new Set<string>(); // deduplicate
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const item of r.value) {
          const normalized = item.title.toLowerCase().trim();
          if (!seenTitles.has(normalized)) {
            seenTitles.add(normalized);
            allItems.push(item);
          }
        }
      }
    }

    // Sort by date descending
    allItems.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    });

    return NextResponse.json({ items: allItems, fetchedAt: new Date().toISOString() });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch news" },
      { status: 500 }
    );
  }
}
