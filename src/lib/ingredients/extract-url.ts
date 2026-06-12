import * as cheerio from "cheerio";

const MAX_CHARS = 20000;

export function extractReadableText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  const title = $("title").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return { title, text };
}

export async function fetchUrlText(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ title: string; text: string }> {
  const res = await fetchFn(url, { headers: { "user-agent": "idea-brewing/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractReadableText(await res.text());
}
