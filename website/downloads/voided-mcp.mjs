#!/usr/bin/env node

// ../slipner/developer/packages/cli/src/foreign/voided-mcp.ts
import readline from "node:readline";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
var SERVER_NAME = "voided-mcp";
var SERVER_VERSION = "0.1.0";
var SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
var DEFAULT_VOIDED_ROOT = "/Volumes/ORICO/odessa/voided";
var DEFAULT_LIMIT = 8;
var MAX_LIMIT = 25;
var DEFAULT_READ_SPAN = 120;
var MAX_READ_SPAN = 400;
var SNIPPET_RADIUS = 3;
var VoidedRuntime = class {
  root;
  fileCache = /* @__PURE__ */ new Map();
  constructor() {
    this.root = path.resolve(normalizeString(process.env.VOIDED_ROOT) || DEFAULT_VOIDED_ROOT);
  }
  async getContext() {
    const exists = await this.rootExists();
    const modules = await this.listModules();
    const knowledgeFiles = await this.getFiles("knowledge:all");
    const codeFiles = await this.getFiles("code:all");
    return {
      root: this.root,
      exists,
      modules,
      counts: {
        knowledgeFiles: knowledgeFiles.length,
        codeFiles: codeFiles.length
      },
      areas: {
        knowledge: ["docs", "examples", "readmes"],
        code: ["rust", "node", "browser"]
      }
    };
  }
  async listModules() {
    await this.ensureRootExists();
    const crates = await this.loadCrates();
    const packages = await this.loadPackages();
    return {
      root: this.root,
      docs: [
        "README.md",
        "instructions.md",
        "docs/",
        "examples/"
      ],
      crates,
      packages
    };
  }
  async searchKnowledge(query, area, limit) {
    await this.ensureRootExists();
    const files = await this.getFiles(`knowledge:${area}`);
    return this.searchFiles(files, query, limit, "doc");
  }
  async searchCode(query, area, limit, pathContains) {
    await this.ensureRootExists();
    let files = await this.getFiles(`code:${area}`);
    if (pathContains) {
      const needle = pathContains.toLowerCase();
      files = files.filter((file) => file.toLowerCase().includes(needle));
    }
    return this.searchFiles(files, query, limit, "reference");
  }
  async findSymbol(symbol, limit) {
    await this.ensureRootExists();
    const files = await this.getFiles("code:all");
    const escaped = escapeRegExp(symbol);
    const definitionPatterns = [
      new RegExp(`\\bpub\\s+fn\\s+${escaped}\\b`),
      new RegExp(`\\bpub\\s+struct\\s+${escaped}\\b`),
      new RegExp(`\\bpub\\s+enum\\s+${escaped}\\b`),
      new RegExp(`\\bpub\\s+trait\\s+${escaped}\\b`),
      new RegExp(`\\bimpl\\s+${escaped}\\b`),
      new RegExp(`\\bexport\\s+function\\s+${escaped}\\b`),
      new RegExp(`\\bexport\\s+class\\s+${escaped}\\b`),
      new RegExp(`\\bexport\\s+interface\\s+${escaped}\\b`),
      new RegExp(`\\bexport\\s+type\\s+${escaped}\\b`),
      new RegExp(`\\bclass\\s+${escaped}\\b`),
      new RegExp(`\\bfunction\\s+${escaped}\\b`),
      new RegExp(`\\binterface\\s+${escaped}\\b`),
      new RegExp(`\\btype\\s+${escaped}\\b`),
      new RegExp(`\\bconst\\s+${escaped}\\b`)
    ];
    const loosePattern = new RegExp(`\\b${escaped}\\b`);
    const definitions = [];
    const references = [];
    for (const relativePath of files) {
      const content = await readTextFile(path.join(this.root, relativePath));
      if (content === null) {
        continue;
      }
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!loosePattern.test(line)) {
          continue;
        }
        const snippet = buildSnippet(lines, index);
        const match = {
          path: relativePath,
          line: index + 1,
          kind: definitionPatterns.some((pattern) => pattern.test(line)) ? "definition" : "reference",
          snippet
        };
        if (match.kind === "definition") {
          definitions.push(match);
        } else {
          references.push(match);
        }
        if (definitions.length + references.length >= limit * 3) {
          break;
        }
      }
    }
    return [...definitions, ...references].slice(0, limit);
  }
  async readRepoFile(relativeOrAbsolutePath, startLine, endLine) {
    await this.ensureRootExists();
    const resolved = this.resolvePath(relativeOrAbsolutePath);
    const relativePath = toRepoRelative(this.root, resolved);
    const content = await readFile(resolved, "utf8");
    const lines = content.split("\n");
    const start = clamp(startLine ?? 1, 1, lines.length || 1);
    const requestedEnd = endLine ?? start + DEFAULT_READ_SPAN - 1;
    const end = clamp(requestedEnd, start, Math.min(lines.length || 1, start + MAX_READ_SPAN - 1));
    const excerpt = lines.slice(start - 1, end).join("\n");
    return {
      root: this.root,
      path: relativePath,
      startLine: start,
      endLine: end,
      totalLines: lines.length,
      excerpt
    };
  }
  async rootExists() {
    try {
      await access(this.root);
      return true;
    } catch {
      return false;
    }
  }
  async ensureRootExists() {
    if (!await this.rootExists()) {
      throw new Error(`Voided root not found: ${this.root}`);
    }
  }
  resolvePath(relativeOrAbsolutePath) {
    const candidate = path.isAbsolute(relativeOrAbsolutePath) ? path.resolve(relativeOrAbsolutePath) : path.resolve(this.root, relativeOrAbsolutePath);
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Requested path is outside the Voided repository root.");
    }
    return candidate;
  }
  async loadCrates() {
    const cratesDir = path.join(this.root, "crates");
    const entries = await safeReaddir(cratesDir);
    const crates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const crateDir = path.join(cratesDir, entry.name);
      const cargoTomlPath = path.join(crateDir, "Cargo.toml");
      const cargoToml = await readTextFile(cargoTomlPath);
      if (!cargoToml) {
        continue;
      }
      crates.push({
        name: extractTomlString(cargoToml, "name") || entry.name,
        path: toRepoRelative(this.root, crateDir),
        description: extractTomlString(cargoToml, "description")
      });
    }
    return crates;
  }
  async loadPackages() {
    const packagesDir = path.join(this.root, "packages");
    const entries = await safeReaddir(packagesDir);
    const packages = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageDir = path.join(packagesDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      const packageJson = await readJsonFile(packageJsonPath);
      if (!packageJson) {
        continue;
      }
      packages.push({
        name: typeof packageJson.name === "string" ? packageJson.name : entry.name,
        path: toRepoRelative(this.root, packageDir),
        description: typeof packageJson.description === "string" ? packageJson.description : null
      });
    }
    return packages;
  }
  async getFiles(cacheKey) {
    const existing = this.fileCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const promise = this.scanFiles(cacheKey);
    this.fileCache.set(cacheKey, promise);
    return promise;
  }
  async scanFiles(cacheKey) {
    const files = [];
    await walkDirectory(this.root, async (absolutePath, relativePath) => {
      if (matchesCacheKey(relativePath, cacheKey)) {
        files.push(relativePath);
      }
    });
    return files.sort();
  }
  async searchFiles(files, query, limit, defaultKind) {
    const normalized = query.toLowerCase();
    const matches = [];
    for (const relativePath of files) {
      const content = await readTextFile(path.join(this.root, relativePath));
      if (content === null) {
        continue;
      }
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(normalized)) {
          continue;
        }
        matches.push({
          path: relativePath,
          line: index + 1,
          kind: defaultKind,
          snippet: buildSnippet(lines, index)
        });
        if (matches.length >= limit) {
          return matches;
        }
      }
    }
    return matches;
  }
};
var tools = [];
var toolMap = /* @__PURE__ */ new Map();
function startVoidedMcpServer() {
  const runtime = new VoidedRuntime();
  tools = buildTools(runtime);
  toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
          data: toJsonError(error)
        }
      });
      return;
    }
    try {
      await handleRequest(request);
    } catch (error) {
      if (request.id === void 0) {
        return;
      }
      writeResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: error.message || "Internal error"
        }
      });
    }
  });
  rl.on("close", () => {
    process.exit(0);
  });
  process.on("uncaughtException", (error) => {
    process.stderr.write(`[${SERVER_NAME}] uncaught exception: ${error.stack || error.message}
`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const text = reason instanceof Error ? reason.stack || reason.message : String(reason);
    process.stderr.write(`[${SERVER_NAME}] unhandled rejection: ${text}
`);
  });
}
async function handleRequest(request) {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    if (request.id !== void 0) {
      writeResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32600,
          message: "Invalid Request"
        }
      });
    }
    return;
  }
  switch (request.method) {
    case "initialize":
      if (request.id === void 0) {
        return;
      }
      writeResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: negotiateProtocolVersion(asOptionalObject(request.params)?.protocolVersion),
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION
          },
          instructions: "Voided MCP gives implementation help from the local Voided repo. Start with repo/module overview, then search knowledge or code, then read exact files to ground answers in the source."
        }
      });
      return;
    case "notifications/initialized":
      return;
    case "ping":
      if (request.id !== void 0) {
        writeResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {}
        });
      }
      return;
    case "tools/list":
      if (request.id === void 0) {
        return;
      }
      writeResponse({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      });
      return;
    case "tools/call":
      if (request.id === void 0) {
        return;
      }
      await handleToolCall(request.id, request.params);
      return;
    default:
      if (request.id !== void 0) {
        writeResponse({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          }
        });
      }
  }
}
async function handleToolCall(id, params) {
  const body = asObject(params, "tools/call params");
  const toolName = requireString(body, "name");
  const args = asOptionalObject(body.arguments) || {};
  const tool = toolMap.get(toolName);
  if (!tool) {
    writeResponse({
      jsonrpc: "2.0",
      id,
      result: toolErrorResult(`Unknown tool: ${toolName}`)
    });
    return;
  }
  try {
    const result = await tool.handler(args);
    writeResponse({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        structuredContent: result,
        isError: false
      }
    });
  } catch (error) {
    writeResponse({
      jsonrpc: "2.0",
      id,
      result: toolErrorResult(error.message || "Tool execution failed")
    });
  }
}
function buildTools(ctx) {
  return [
    {
      name: "voided_get_context",
      title: "Get Voided Context",
      description: "Show the configured Voided repository root, discovered module counts, and the search areas this MCP exposes.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      handler: async () => ctx.getContext()
    },
    {
      name: "voided_list_modules",
      title: "List Voided Modules",
      description: "List the main Voided crates and npm packages that the MCP can use as implementation references.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      handler: async () => ctx.listModules()
    },
    {
      name: "voided_search_knowledge",
      title: "Search Voided Docs",
      description: "Search Voided READMEs, docs, instructions, and examples for implementation guidance.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          area: {
            type: "string",
            enum: ["all", "docs", "examples", "readmes"]
          },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT }
        },
        required: ["query"],
        additionalProperties: false
      },
      handler: async (args) => {
        const query = requireString(args, "query");
        const area = getOptionalEnum(args, "area", ["all", "docs", "examples", "readmes"]) || "all";
        const limit = getOptionalInteger(args, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const matches = await ctx.searchKnowledge(query, area, limit);
        return {
          query,
          area,
          matches
        };
      }
    },
    {
      name: "voided_search_code",
      title: "Search Voided Code",
      description: "Search Voided source files for implementation details across Rust, Node, browser, or all code.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          area: {
            type: "string",
            enum: ["all", "rust", "node", "browser"]
          },
          pathContains: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT }
        },
        required: ["query"],
        additionalProperties: false
      },
      handler: async (args) => {
        const query = requireString(args, "query");
        const area = getOptionalEnum(args, "area", ["all", "rust", "node", "browser"]) || "all";
        const pathContains = getOptionalString(args, "pathContains");
        const limit = getOptionalInteger(args, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const matches = await ctx.searchCode(query, area, limit, pathContains);
        return {
          query,
          area,
          pathContains: pathContains || null,
          matches
        };
      }
    },
    {
      name: "voided_find_symbol",
      title: "Find Voided Symbol",
      description: "Find likely definitions and key references for a symbol across the Voided implementation.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT }
        },
        required: ["symbol"],
        additionalProperties: false
      },
      handler: async (args) => {
        const symbol = requireString(args, "symbol");
        const limit = getOptionalInteger(args, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const matches = await ctx.findSymbol(symbol, limit);
        return {
          symbol,
          matches
        };
      }
    },
    {
      name: "voided_read_file",
      title: "Read Voided File",
      description: "Read a specific file from the Voided repo, optionally constrained to a line range.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 }
        },
        required: ["path"],
        additionalProperties: false
      },
      handler: async (args) => {
        const requestedPath = requireString(args, "path");
        const startLine = getOptionalInteger(args, "startLine", 1);
        const endLine = getOptionalInteger(args, "endLine", 1);
        return ctx.readRepoFile(requestedPath, startLine, endLine);
      }
    }
  ];
}
function matchesCacheKey(relativePath, cacheKey) {
  const normalized = relativePath.replace(/\\/g, "/");
  switch (cacheKey) {
    case "knowledge:all":
      return isKnowledgeFile(normalized, "all");
    case "knowledge:docs":
      return isKnowledgeFile(normalized, "docs");
    case "knowledge:examples":
      return isKnowledgeFile(normalized, "examples");
    case "knowledge:readmes":
      return isKnowledgeFile(normalized, "readmes");
    case "code:all":
      return isCodeFile(normalized, "all");
    case "code:rust":
      return isCodeFile(normalized, "rust");
    case "code:node":
      return isCodeFile(normalized, "node");
    case "code:browser":
      return isCodeFile(normalized, "browser");
    default:
      return false;
  }
}
function isKnowledgeFile(relativePath, area) {
  if (!isTextExtension(relativePath)) {
    return false;
  }
  const isReadme = relativePath === "README.md" || relativePath.endsWith("/README.md") || relativePath === "instructions.md";
  const isDoc = relativePath.startsWith("docs/");
  const isExample = relativePath.startsWith("examples/") || relativePath.includes("/examples/");
  switch (area) {
    case "all":
      return isReadme || isDoc || isExample;
    case "docs":
      return isDoc || relativePath === "instructions.md";
    case "examples":
      return isExample;
    case "readmes":
      return isReadme;
    default:
      return false;
  }
}
function isCodeFile(relativePath, area) {
  const normalized = relativePath.replace(/\\/g, "/");
  const isRust = normalized.startsWith("crates/") && normalized.endsWith(".rs");
  const isNode = normalized.startsWith("packages/enc-server/src/") && isTextExtension(normalized);
  const isBrowser = normalized.startsWith("packages/e2ee-client/src/") && isTextExtension(normalized);
  switch (area) {
    case "all":
      return isRust || isNode || isBrowser;
    case "rust":
      return isRust;
    case "node":
      return isNode || normalized.startsWith("crates/voided-node/src/");
    case "browser":
      return isBrowser || normalized.startsWith("crates/voided-wasm/src/");
    default:
      return false;
  }
}
function isTextExtension(relativePath) {
  return [".md", ".txt", ".rs", ".ts", ".js", ".json", ".toml", ".yml", ".yaml", ".mjs"].includes(
    path.extname(relativePath).toLowerCase()
  );
}
async function walkDirectory(root, onFile) {
  async function walk(currentDir) {
    const entries = await safeReaddir(currentDir);
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      const relativePath = toRepoRelative(root, absolutePath);
      await onFile(absolutePath, relativePath);
    }
  }
  await walk(root);
}
async function safeReaddir(target) {
  try {
    return await readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}
async function readTextFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
async function readJsonFile(filePath) {
  const raw = await readTextFile(filePath);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function extractTomlString(content, key) {
  const match = content.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] || null;
}
function buildSnippet(lines, matchedIndex) {
  const start = Math.max(0, matchedIndex - SNIPPET_RADIUS);
  const end = Math.min(lines.length, matchedIndex + SNIPPET_RADIUS + 1);
  return lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join("\n");
}
function toRepoRelative(root, target) {
  return path.relative(root, target).replace(/\\/g, "/");
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function negotiateProtocolVersion(candidate) {
  if (typeof candidate === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(candidate)) {
    return candidate;
  }
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}
function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}
`);
}
function toolErrorResult(message) {
  return {
    content: [
      {
        type: "text",
        text: message
      }
    ],
    isError: true
  };
}
function asObject(value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
function asOptionalObject(value) {
  if (value === void 0 || value === null) {
    return null;
  }
  return asObject(value);
}
function requireString(obj, key) {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}
function getOptionalString(obj, key) {
  const value = obj[key];
  if (value === void 0 || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}
function getOptionalInteger(obj, key, min, max) {
  const value = obj[key];
  if (value === void 0 || value === null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer.`);
  }
  const numeric = value;
  if (min !== void 0 && numeric < min) {
    throw new Error(`${key} must be at least ${min}.`);
  }
  if (max !== void 0 && numeric > max) {
    throw new Error(`${key} must be at most ${max}.`);
  }
  return numeric;
}
function getOptionalEnum(obj, key, allowed) {
  const value = obj[key];
  if (value === void 0 || value === null) {
    return null;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}
function normalizeString(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
function toJsonError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name
    };
  }
  return {
    message: String(error)
  };
}
var IGNORED_NAMES = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "tools",
  "prebuilds",
  ".DS_Store"
]);

// ../slipner/developer/packages/cli/src/voided-mcp.ts
startVoidedMcpServer();
