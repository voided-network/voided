#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pages = ["index.html", "docs.html", "learn.html", "support.html", "404.html"];
const failures = [];

for (const page of pages) {
  const pagePath = join(root, page);
  const html = readFileSync(pagePath, "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) failures.push(`${page}: duplicate ids ${[...new Set(duplicateIds)].join(", ")}`);
  if (!html.includes('<meta name="viewport"')) failures.push(`${page}: missing viewport metadata`);
  if (!html.includes("skip-link")) failures.push(`${page}: missing skip link`);
  if (!html.includes('href="/assets/styles.css"')) failures.push(`${page}: missing shared stylesheet`);

  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)) {
    const target = match[1];
    if (/^\/https?:/.test(target)) continue;
    let localPath = resolve(root, `.${target}`);
    if (target.endsWith("/")) localPath = join(localPath, "index.html");
    try {
      readFileSync(localPath);
    } catch {
      failures.push(`${page}: missing local asset ${target}`);
    }
  }
}

const siteScript = readFileSync(join(root, "assets", "site.js"), "utf8");
for (const required of ["prefers-reduced-motion", "aria-expanded", "data-copy", "data-guide"]) {
  if (!siteScript.includes(required)) failures.push(`site.js: missing ${required} behavior`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`[voided-site] verified ${pages.length} pages, shared assets, local links, unique ids, and accessibility hooks`);

