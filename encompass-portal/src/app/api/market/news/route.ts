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

export async function GET(req: NextRequest) {
  try {
    const cat = req.nextUrl.searchParams.get("category") || "";
    const feedEntries = cat && FEEDS[cat] ? [[cat, FEEDS[cat]]] : Object.entries(FEEDS);

    const results = await Promise.allSettled(
      feedEntries.map(async ([key, url]) => {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          next: { revalidate: 300 },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSSItems(xml, key);
      })
    );

    const allItems: NewsItem[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") allItems.push(...r.value);
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
