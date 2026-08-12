#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pages = ["index.html", "docs.html", "learn.html", "support.html", "ai.html", "mcp.html", "404.html"];
const failures = [];

for (const page of pages) {
  const pagePath = join(root, page);
  const html = readFileSync(pagePath, "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) failures.push(`${page}: duplicate ids ${[...new Set(duplicateIds)].join(", ")}`);
  if (!html.includes('<meta name="viewport"')) failures.push(`${page}: missing viewport metadata`);
  if (!html.includes("skip-link")) failures.push(`${page}: missing skip link`);
  if (!html.includes('href="./assets/styles.css"')) failures.push(`${page}: missing shared stylesheet`);
  if (/\s(?:href|src)="\//.test(html)) failures.push(`${page}: local links must remain file-preview compatible`);

  for (const match of html.matchAll(/(?:href|src)="((?:\.\/|\/)[^"#?]+)"/g)) {
    const target = match[1];
    let localPath = resolve(root, target.startsWith("/") ? `.${target}` : target);
    if (target.endsWith("/")) localPath = join(localPath, "index.html");
    try {
      readFileSync(localPath);
    } catch {
      failures.push(`${page}: missing local asset ${target}`);
    }
  }
}

const siteScript = readFileSync(join(root, "assets", "site.js"), "utf8");
for (const required of ["prefers-reduced-motion", "aria-expanded", "data-copy", "data-guide", "Voided MCP", "llms-full.txt"]) {
  if (!siteScript.includes(required)) failures.push(`site.js: missing ${required} behavior or search route`);
}

const compactReference = readFileSync(join(root, "llms.txt"), "utf8");
for (const required of ["Use protect/open", "llms-full.txt", "Voided MCP", "Recovery Deck"]) {
  if (!compactReference.includes(required)) failures.push(`llms.txt: missing ${required}`);
}

const fullReference = readFileSync(join(root, "llms-full.txt"), "utf8");
for (const required of ["225.58 bits", "29-byte", "32-byte", "80 bytes", "Windows x64", "voided_get_context"]) {
  if (!fullReference.includes(required)) failures.push(`llms-full.txt: missing ${required}`);
}

for (const jsonFile of ["ai.json", "mcp.json"]) {
  try {
    JSON.parse(readFileSync(join(root, jsonFile), "utf8"));
  } catch (error) {
    failures.push(`${jsonFile}: invalid JSON (${error.message})`);
  }
}

const mcpPath = join(root, "downloads", "voided-mcp.mjs");
const mcpBytes = readFileSync(mcpPath);
const actualMcpHash = createHash("sha256").update(mcpBytes).digest("hex");
const expectedMcpHash = "fd8ad4bdb0afde8d9d47d7a196dc88a473c3cc65a2494c4281cd4b5240f77354";
if (actualMcpHash !== expectedMcpHash) failures.push(`voided-mcp.mjs: SHA-256 ${actualMcpHash} does not match descriptor`);
for (const descriptor of ["mcp.html", "mcp.json", "ai.json", "downloads/README.txt"]) {
  if (!readFileSync(join(root, descriptor), "utf8").includes(expectedMcpHash)) failures.push(`${descriptor}: missing MCP checksum`);
}

async function smokeMcp() {
  const child = spawn(process.execPath, [mcpPath], {
    cwd: root,
    env: { ...process.env, VOIDED_ROOT: resolve(root, "..") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const stderr = [];
  let nextId = 1;
  const lines = createInterface({ input: child.stdout });

  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter.resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  child.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  child.on("exit", (code) => {
    if (pending.size === 0) return;
    const error = new Error(`MCP exited with code ${code}: ${stderr.join("").trim()}`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolveRequest, rejectRequest) => {
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  const timeout = new Promise((_, rejectTimeout) => {
    setTimeout(() => rejectTimeout(new Error("MCP smoke timed out after 8 seconds")), 8000).unref();
  });

  try {
    return await Promise.race([
      (async () => {
        const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "voided-site-check", version: "1.0.0" } });
        if (initialized.result?.serverInfo?.name !== "voided-mcp") throw new Error("MCP initialize returned the wrong server identity");
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

        const listed = await request("tools/list", {});
        const toolNames = listed.result?.tools?.map((tool) => tool.name) ?? [];
        const expectedTools = ["voided_get_context", "voided_list_modules", "voided_search_knowledge", "voided_search_code", "voided_find_symbol", "voided_read_file"];
        if (toolNames.length !== expectedTools.length || expectedTools.some((name) => !toolNames.includes(name))) throw new Error("MCP tools/list did not expose the six documented tools");

        const context = await request("tools/call", { name: "voided_get_context", arguments: {} });
        if (context.result?.isError || context.result?.structuredContent?.exists !== true) throw new Error("MCP context did not recognize the Voided checkout");

        const search = await request("tools/call", { name: "voided_search_knowledge", arguments: { query: "Recovery Deck", area: "docs", limit: 2 } });
        if (search.result?.isError || !search.result?.structuredContent?.matches?.length) throw new Error("MCP knowledge search returned no Recovery Deck protocol result");

        const read = await request("tools/call", { name: "voided_read_file", arguments: { path: "docs/recovery-deck-protocol.md", startLine: 1, endLine: 32 } });
        if (read.result?.isError || !read.result?.structuredContent?.excerpt?.includes("voided/recovery/deck")) throw new Error("MCP bounded read did not return the permanent Recovery Deck domain");

        return { toolCount: toolNames.length, matchCount: search.result.structuredContent.matches.length, readPath: read.result.structuredContent.path };
      })(),
      timeout,
    ]);
  } finally {
    child.stdin.end();
    lines.close();
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

let mcpSmoke;
try {
  mcpSmoke = await smokeMcp();
} catch (error) {
  failures.push(`voided-mcp.mjs: protocol smoke failed (${error.message})`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`[voided-site] verified ${pages.length} pages`);
console.log("[voided-site] verified file-preview-safe local links, shared assets, unique ids, and accessibility hooks");
console.log("[voided-site] parsed ai.json and mcp.json; checked compact and full AI references");
console.log(`[voided-site] verified voided-mcp.mjs SHA-256 ${actualMcpHash}`);
console.log(`[voided-site] MCP smoke passed: initialize -> tools/list (${mcpSmoke.toolCount}) -> context -> knowledge search (${mcpSmoke.matchCount}) -> bounded read (${mcpSmoke.readPath})`);
