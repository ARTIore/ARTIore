import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith(".html")) files.push(full);
  }
  return files;
}

function one(html, pattern, file) {
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${file} expected one ${pattern}, found ${matches.length}`);
  }
  return matches[0][1] ?? matches[0][0];
}

const files = await htmlFiles(dist);
if (files.length < 20) throw new Error(`expected many pages, found ${files.length}`);

const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();

for (const file of files) {
  const html = await readFile(file, "utf8");
  if (html.includes('http-equiv="refresh"')) continue;
  const title = one(html, /<title>([^<]+)<\/title>/g, file);
  const description = one(html, /<meta name="description" content="([^"]*)">/g, file);
  const canonical = one(html, /<link rel="canonical" href="([^"]+)">/g, file);
  if (!description.trim()) throw new Error(`empty description in ${file}`);
  if (!canonical.startsWith("https://artiore.com")) throw new Error(`bad canonical in ${file}: ${canonical}`);
  if (html.includes("chatbase") || html.includes("googletagmanager") || html.includes("google-analytics") || html.includes("gtag(")) {
    throw new Error(`third-party tracker in ${file}`);
  }
  for (const [map, value, label] of [
    [titles, title, "title"],
    [descriptions, description, "description"],
    [canonicals, canonical, "canonical"],
  ]) {
    if (map.has(value)) throw new Error(`duplicate ${label} "${value}" in ${file} and ${map.get(value)}`);
    map.set(value, file);
  }
}

const required = ["index.html", "404.html", "try.html", "api-documentation.html"];
for (const rel of required) {
  if (!files.some((file) => file.endsWith(rel))) throw new Error(`missing ${rel}`);
}

const tryHtml = await readFile(path.join(dist, "try.html"), "utf8");
if (!tryHtml.includes('id="situation"') || !tryHtml.includes(">Analyze<")) {
  throw new Error("try page is missing the situation field or Analyze button");
}
if (!tryHtml.includes("Practical next steps") || !tryHtml.includes("Evidence")) {
  throw new Error("try page is missing the five-part description");
}

const home = await readFile(path.join(dist, "index.html"), "utf8");
if (!home.includes("ARTIore: Clarity-First Reasoning for Decisions")) {
  throw new Error("home title missing");
}

const robots = await readFile(path.join(dist, "robots.txt"), "utf8");
if (!robots.includes("Sitemap:")) throw new Error("robots.txt missing sitemap");
const sitemapFiles = (await readdir(dist)).filter((name) => name.startsWith("sitemap"));
if (sitemapFiles.length === 0) throw new Error("sitemap missing");

console.log(`checked ${files.length} html files`);
