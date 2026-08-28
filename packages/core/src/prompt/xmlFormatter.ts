/**
 * XML Formatting, Tag Generation, and Parsing Utilities.
 *
 * Provides safe XML escaping/unescaping, tag composition, and isomorphic extraction.
 */

export function escapeXml(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXml(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export function formatXmlTag(
  name: string,
  content: string,
  attributes?: Record<string, string | number | boolean | undefined>
): string {
  const attrEntries = attributes ? Object.entries(attributes).filter(([_, v]) => v !== undefined) : [];
  const attrsStr = attrEntries.length > 0
    ? " " + attrEntries.map(([k, v]) => `${k}="${escapeXml(String(v))}"`).join(" ")
    : "";

  if (content === "") {
    return `<${name}${attrsStr} />`;
  }

  return `<${name}${attrsStr}>\n${content}\n</${name}>`;
}

export function extractXmlTag(xml: string, tagName: string): string | null {
  if (!xml || typeof xml !== "string") return null;
  const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

export function extractAllXmlTags(
  xml: string,
  tagName: string
): Array<{ content: string; attributes: Record<string, string> }> {
  if (!xml || typeof xml !== "string") return [];
  const results: Array<{ content: string; attributes: Record<string, string> }> = [];
  const regex = new RegExp(`<${tagName}(\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");

  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const rawAttrs = match[1] || "";
    const content = match[2].trim();
    const attributes: Record<string, string> = {};

    const attrRegex = /([a-zA-Z0-9_\-]+)="([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      attributes[attrMatch[1]] = unescapeXml(attrMatch[2]);
    }

    results.push({ content, attributes });
  }

  return results;
}
