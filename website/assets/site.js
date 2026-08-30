const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const liveRegion = document.querySelector("[data-live-region]");

function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = "";
  window.setTimeout(() => { liveRegion.textContent = message; }, 20);
}

const matrixTransitionKey = "voided:matrix-transition";
const matrixGlyphs = "01AF7E3XYZ<>[]{}|/+*:=░▒";
const matrixTextSelector = "a, button, h1, h2, h3, h4, p, li, dt, dd, figcaption, blockquote, pre, code, label, legend, output, small, strong, time, span";
const matrixSkipSelector = "script, style, noscript, template, svg, canvas, input, textarea, select, option, [hidden], [aria-hidden=\"true\"], [contenteditable=\"true\"], .sr-only, .matrix-remold-layer";
const matrixDocumentWarmups = new Map();

function matrixHash(first, second, third = 0) {
  let value = Math.imul(first + 1, 0x45d9f3b) ^ Math.imul(second + 7, 0x119de1f3) ^ Math.imul(third + 11, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function isVisibleMatrixTarget(element) {
  if (!(element instanceof HTMLElement) || element.closest(matrixSkipSelector)) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function collectMatrixTargets(root = document.body) {
  const grouped = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest(matrixSkipSelector)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    let target = parent.closest(matrixTextSelector) ?? parent;
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== root && root.contains(ancestor)) {
      if (ancestor.matches(matrixTextSelector)) target = ancestor;
      ancestor = ancestor.parentElement;
    }
    if (isVisibleMatrixTarget(target)) {
      if (!grouped.has(target)) grouped.set(target, []);
      grouped.get(target).push(node);
    }
    node = walker.nextNode();
  }

  return [...grouped.entries()].map(([element, nodes], targetIndex) => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const originalStyle = element.getAttribute("style");
    element.style.setProperty("--matrix-remold-width", `${rect.width}px`);
    element.style.setProperty("--matrix-remold-height", `${rect.height}px`);
    element.classList.add("matrix-remold-target");
    return {
      element,
      nodes: nodes.map((textNode, nodeIndex) => ({ textNode, text: textNode.nodeValue, nodeIndex })),
      targetIndex,
      rect,
      color: computed.color,
      fontSize: Math.max(8, Number.parseFloat(computed.fontSize) || 13),
      originalStyle,
    };
  });
}

function remoldMatrixText(targets, amount, frame) {
  targets.forEach((target) => {
    target.nodes.forEach(({ textNode, text, nodeIndex }) => {
      if (amount <= 0.015) {
        textNode.nodeValue = text;
        return;
      }
      textNode.nodeValue = [...text].map((character, characterIndex) => {
        if (/\s/.test(character)) return character;
        const threshold = matrixHash(target.targetIndex, nodeIndex, characterIndex);
        if (amount < threshold * 0.94) return character;
        const glyphIndex = Math.floor(matrixHash(characterIndex + frame, target.targetIndex, nodeIndex + frame) * matrixGlyphs.length);
        if (amount > 0.74 && matrixHash(nodeIndex, characterIndex, target.targetIndex) < (amount - 0.74) * 0.88) return "·";
        return matrixGlyphs[glyphIndex];
      }).join("");
    });
  });
}

function restoreMatrixTargets(targets) {
  targets.forEach(({ element, nodes, originalStyle }) => {
    nodes.forEach(({ textNode, text }) => { textNode.nodeValue = text; });
    element.classList.remove("matrix-remold-target");
    if (originalStyle === null) element.removeAttribute("style");
    else element.setAttribute("style", originalStyle);
  });
}

function createMatrixLayer(targets) {
  const canvas = document.createElement("canvas");
  canvas.className = "matrix-remold-layer";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);

  const particles = [];
  targets.forEach((target) => {
    const characterCount = target.nodes.reduce((total, item) => total + item.text.trim().length, 0);
    const count = Math.min(18, Math.max(2, Math.round(characterCount / 9)));
    for (let index = 0; index < count; index += 1) {
      const horizontal = matrixHash(target.targetIndex, index, 1);
      const vertical = matrixHash(target.targetIndex, index, 2);
      particles.push({
        x: target.rect.left + horizontal * target.rect.width,
        y: target.rect.top + vertical * target.rect.height,
        driftX: (matrixHash(index, target.targetIndex, 3) - 0.5) * 34,
        driftY: (matrixHash(index, target.targetIndex, 4) - 0.5) * 92,
        delay: matrixHash(index, target.targetIndex, 5) * 0.48,
        glyph: matrixGlyphs[Math.floor(matrixHash(index, target.targetIndex, 6) * matrixGlyphs.length)],
        color: target.color,
        size: Math.min(15, Math.max(8, target.fontSize * (0.38 + matrixHash(index, target.targetIndex, 7) * 0.28))),
      });
    }
  });

  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace";
  return { canvas, particles, fontFamily };
}

function drawMatrixDissipation(layer, phase, direction) {
  const { canvas, particles, fontFamily } = layer;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = innerWidth;
  const height = innerHeight;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.textBaseline = "middle";

  const cellWidth = Math.max(42, Math.min(78, width / 15));
  const cellHeight = Math.max(34, Math.min(66, height / 12));
  const columns = Math.ceil(width / cellWidth);
  const rows = Math.ceil(height / cellHeight);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const delay = matrixHash(column, row, columns + rows) * 0.62;
      const rawCoverage = direction === "out"
        ? (phase - delay) / (1 - delay)
        : ((1 - phase) - delay) / (1 - delay);
      const coverage = Math.max(0, Math.min(1, rawCoverage));
      if (coverage <= 0) continue;
      const x = Math.floor(column * cellWidth);
      const y = Math.floor(row * cellHeight);
      const cellBottom = Math.min(height, y + Math.ceil(cellHeight) + 1);
      const revealedHeight = Math.max(1, Math.ceil((cellBottom - y) * coverage));
      const fromTop = matrixHash(row, column, 17) > 0.5;
      const revealY = fromTop ? y : cellBottom - revealedHeight;
      context.globalAlpha = 0.6 + (coverage * 0.4);
      context.fillStyle = "#080a0b";
      context.fillRect(x, revealY, Math.ceil(cellWidth) + 1, revealedHeight);

      if (coverage > 0.08 && coverage < 0.94 && matrixHash(column, row, 23) > 0.76) {
        context.globalAlpha = (1 - Math.abs(0.5 - coverage) * 2) * 0.24;
        context.fillStyle = "#c7ff5e";
        context.fillRect(x, fromTop ? revealY + revealedHeight - 1 : revealY, Math.ceil(cellWidth) + 1, 1);
      }
    }
  }

  particles.forEach((particle, index) => {
    const local = Math.max(0, Math.min(1, (phase - particle.delay) / (1 - particle.delay)));
    const travel = direction === "out" ? local : 1 - local;
    const visibility = Math.sin(local * Math.PI) * 0.78;
    if (visibility <= 0.01) return;
    const flutter = Math.sin((phase * 28) + index) * 4;
    context.globalAlpha = visibility * 0.22;
    context.fillStyle = particle.color;
    context.fillRect(particle.x, particle.y + (particle.driftY * travel), 1, Math.max(5, particle.size * 1.7));
    context.globalAlpha = visibility;
    context.font = `${particle.size}px ${fontFamily}`;
    context.shadowBlur = 9;
    context.shadowColor = "rgba(199, 255, 94, 0.5)";
    context.fillText(particle.glyph, particle.x + (particle.driftX * travel) + flutter, particle.y + (particle.driftY * travel));
  });
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function animateMatrixRemold(direction, onComplete) {
  const targets = collectMatrixTargets();
  const layer = createMatrixLayer(targets);
  const duration = direction === "out" ? 430 : 560;
  const started = performance.now();
  let animationFrame = 0;

  document.documentElement.classList.add("matrix-remold-active");
  document.body.setAttribute("aria-busy", "true");

  if (direction === "in") {
    remoldMatrixText(targets, 1, 0);
    drawMatrixDissipation(layer, 0, direction);
    document.documentElement.classList.remove("matrix-remold-pending");
  }

  function cleanup() {
    cancelAnimationFrame(animationFrame);
    restoreMatrixTargets(targets);
    layer.canvas.remove();
    document.documentElement.classList.remove("matrix-remold-active");
    document.body.removeAttribute("aria-busy");
  }

  function render(now) {
    if (direction === "in") window.scrollTo(0, 0);
    const phase = Math.min(1, (now - started) / duration);
    const eased = phase * phase * (3 - (2 * phase));
    const amount = direction === "out" ? eased : 1 - eased;
    remoldMatrixText(targets, amount, Math.floor((now - started) / 42));
    drawMatrixDissipation(layer, phase, direction);
    if (phase < 1) {
      animationFrame = requestAnimationFrame(render);
      return;
    }
    if (direction === "in") {
      window.scrollTo(0, 0);
      cleanup();
    }
    onComplete(cleanup);
  }

  animationFrame = requestAnimationFrame(render);
  return cleanup;
}

function collectRegionText(root) {
  const entries = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest(matrixSkipSelector)) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    entries.push({ textNode: node, text: node.nodeValue, index: entries.length });
    node = walker.nextNode();
  }
  return entries;
}

function remoldRegionText(entries, amount, frame) {
  entries.forEach(({ textNode, text, index }) => {
    if (amount <= 0.01) {
      textNode.nodeValue = text;
      return;
    }
    textNode.nodeValue = [...text].map((character, characterIndex) => {
      if (/\s/.test(character)) return character;
      const threshold = matrixHash(index, characterIndex, 41);
      if (amount < threshold * 0.9) return character;
      return matrixGlyphs[Math.floor(matrixHash(frame + characterIndex, index, 53) * matrixGlyphs.length)];
    }).join("");
  });
}

function restoreRegionText(entries) {
  entries.forEach(({ textNode, text }) => { textNode.nodeValue = text; });
}

function remoldRegion(region, swap = () => {}, options = {}) {
  if (!region) {
    swap();
    return Promise.resolve();
  }
  if (reducedMotion || region.dataset.regionRemolding === "true") {
    swap();
    return Promise.resolve();
  }

  const outDuration = options.quick ? 70 : 105;
  const inDuration = options.quick ? 95 : 145;
  let entries = collectRegionText(region);
  let swapped = false;
  let frame = 0;
  const started = performance.now();
  region.dataset.regionRemolding = "true";
  region.classList.add("matrix-region-remold");

  return new Promise((resolve) => {
    function finish() {
      restoreRegionText(entries);
      region.classList.remove("matrix-region-remold", "matrix-region-remold--incoming");
      region.removeAttribute("data-region-remolding");
      resolve();
    }

    function render(now) {
      frame += 1;
      const elapsed = now - started;
      if (!swapped) {
        const phase = Math.min(1, elapsed / outDuration);
        remoldRegionText(entries, phase, frame);
        if (phase < 1) {
          requestAnimationFrame(render);
          return;
        }
        restoreRegionText(entries);
        swap();
        swapped = true;
        entries = collectRegionText(region);
        remoldRegionText(entries, 1, frame);
        region.classList.add("matrix-region-remold--incoming");
      }

      const incomingPhase = Math.min(1, (elapsed - outDuration) / inDuration);
      remoldRegionText(entries, 1 - incomingPhase, frame);
      if (incomingPhase < 1) {
        requestAnimationFrame(render);
        return;
      }
      finish();
    }
    requestAnimationFrame(render);
  });
}

function matrixDestinationForLink(link) {
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target && link.target !== "_self") return null;
  if (link.hasAttribute("download") || link.dataset.noTransition !== undefined) return null;
  const destination = new URL(link.href, location.href);
  const current = new URL(location.href);
  const localFile = current.protocol === "file:" && destination.protocol === "file:";
  if (!localFile && destination.origin !== current.origin) return null;
  if (!/\/$|\.html$/i.test(destination.pathname)) return null;
  if (destination.pathname === current.pathname && destination.search === current.search && destination.hash) return null;
  return destination;
}

function warmMatrixDocument(link) {
  const destination = matrixDestinationForLink(link);
  if (!destination || destination.protocol === "file:") return Promise.resolve();
  const cacheKey = `${destination.origin}${destination.pathname}${destination.search}`;
  const currentKey = `${location.origin}${location.pathname}${location.search}`;
  if (cacheKey === currentKey) return Promise.resolve();
  if (matrixDocumentWarmups.has(cacheKey)) return matrixDocumentWarmups.get(cacheKey);

  const warmup = fetch(cacheKey, {
    credentials: "same-origin",
    cache: "force-cache",
    priority: "low",
  }).then((response) => {
    if (!response.ok) throw new Error(`Document warmup returned ${response.status}`);
    return response.text();
  }).catch(() => undefined);
  matrixDocumentWarmups.set(cacheKey, warmup);
  return warmup;
}

function waitForMatrixWarmup(warmup) {
  return Promise.race([
    warmup,
    new Promise((resolve) => window.setTimeout(resolve, 500)),
  ]);
}

function isMatrixNavigation(event, link) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return matrixDestinationForLink(link) !== null;
}

function setupMatrixPageTransitions() {
  if (reducedMotion) return;
  let transitioning = false;
  let activeCleanup = null;
  let incomingNavigation = false;

  try {
    const incoming = JSON.parse(sessionStorage.getItem(matrixTransitionKey) ?? "null");
    sessionStorage.removeItem(matrixTransitionKey);
    if (incoming?.timestamp && Date.now() - incoming.timestamp < 8000) {
      incomingNavigation = true;
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
      window.scrollTo(0, 0);
      activeCleanup = animateMatrixRemold("in", () => { activeCleanup = null; });
    } else {
      document.documentElement.classList.remove("matrix-remold-pending");
    }
  } catch {
    document.documentElement.classList.remove("matrix-remold-pending");
    try { sessionStorage.removeItem(matrixTransitionKey); } catch { /* Storage may be unavailable in hardened browsing modes. */ }
  }

  const warmFromEvent = (event) => {
    const link = event.target.closest?.("a[href]");
    if (link) warmMatrixDocument(link);
  };
  document.addEventListener("pointerover", warmFromEvent, { capture: true, passive: true });
  document.addEventListener("focusin", warmFromEvent, { capture: true });
  document.addEventListener("touchstart", warmFromEvent, { capture: true, passive: true });

  const warmPrimaryNavigation = () => {
    document.querySelectorAll(".site-nav a[href]").forEach((link) => { warmMatrixDocument(link); });
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(warmPrimaryNavigation, { timeout: 1800 });
  else window.setTimeout(warmPrimaryNavigation, 900);

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || transitioning || !isMatrixNavigation(event, link)) return;
    event.preventDefault();
    transitioning = true;
    const destination = link.href;
    const warmup = warmMatrixDocument(link);
    activeCleanup = animateMatrixRemold("out", (cleanup) => {
      waitForMatrixWarmup(warmup).finally(() => {
        try { sessionStorage.setItem(matrixTransitionKey, JSON.stringify({ timestamp: Date.now() })); } catch { /* Navigation still works without the arrival effect. */ }
        location.assign(destination);
        window.setTimeout(() => {
          cleanup();
          transitioning = false;
          activeCleanup = null;
        }, 1600);
      });
    });
  });

  window.addEventListener("pagehide", () => { if (activeCleanup) activeCleanup(); });
  window.addEventListener("pageshow", (event) => {
    if (incomingNavigation) {
      window.scrollTo(0, 0);
    }
    if (!event.persisted) return;
    if (activeCleanup) activeCleanup();
    activeCleanup = null;
    transitioning = false;
  });
}

function setupNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".site-nav");
  if (!toggle || !navigation) return;
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    navigation.classList.toggle("is-open", !expanded);
  });
}

function setupSiteChrome() {
  const page = document.body.dataset.page;
  const navigation = document.querySelector(".site-nav");
  if (navigation) {
    const search = navigation.querySelector("[data-search-open]");
    navigation.replaceChildren();
    [
      ["Learn", "./learn.html", "learn"],
      ["Developer", "./docs.html", "docs"],
      ["Source", "./source.html", "source"],
      ["Updates", "./updates.html", "updates"],
    ].forEach(([label, href, owner]) => {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = href;
      if (page === owner) link.setAttribute("aria-current", "page");
      navigation.append(link);
    });
    if (search) navigation.append(search);
  }

  document.querySelectorAll(".site-footer nav").forEach((footerNavigation) => {
    footerNavigation.replaceChildren();
    [
      ["Learn", "./learn.html"],
      ["Developer", "./docs.html"],
      ["Updates", "./updates.html"],
      ["AI + MCP", "./ai.html"],
      ["Support", "./support.html"],
      ["Source", "./source.html"],
      ["Legal + privacy", "./legal.html"],
      ["Repository ↗", "https://github.com/voided-network/voided"],
    ].forEach(([label, href]) => {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = href;
      footerNavigation.append(link);
    });
  });
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = "Copied";
  announce("Copied to clipboard");
  window.setTimeout(() => { button.textContent = original; }, 1400);
}

function setupCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(button.dataset.copy);
      if (target) copyText(target.textContent.trim(), button);
    });
  });
}

const searchIndex = [
  { title: "Learn encryption", summary: "Plain-language interactive course covering bytes, encoding, hashing, encryption, keys, E2EE, integrity, passwords, recovery, and limits.", url: "./learn.html" },
  { title: "Developer Lab", summary: "Choose a runtime, run interactive architecture labs, and inspect the complete library.", url: "./docs.html?guide=lab" },
  { title: "Updates", summary: "Release status, changelog, compatibility notes, and project news.", url: "./updates.html" },
  { title: "AI reference", summary: "Direct semantic HTML for agents: API choices, runtimes, artifacts, recovery, and security.", url: "./ai.html" },
  { title: "AI compact index", summary: "llms.txt routing index for machine readers.", url: "./llms.txt" },
  { title: "AI full reference", summary: "Standalone plain-text Voided context for agents without MCP.", url: "./llms-full.txt" },
  { title: "Machine reference JSON", summary: "Structured Voided facts, invariants, release state, and endpoints.", url: "./ai.json" },
  { title: "Voided MCP", summary: "Read-only local source knowledge, code search, symbols, modules, and file excerpts.", url: "./mcp.html" },
  { title: "Source", summary: "Repository, packages, release integrity, licenses, agent resources, and project routes.", url: "./source.html" },
  { title: "Voided agent skill", summary: "Reusable SKILL.md for API selection, safety boundaries, and reference routing.", url: "./downloads/voided-skill.md" },
  { title: "Voided AGENTS.md instruction", summary: "Compact persistent repository guidance for coding agents.", url: "./downloads/voided-agents.md" },
  { title: "Browser SDK", summary: "Stateful client, IndexedDB keys, WASM behavior, compression, and browser support.", url: "./docs.html?guide=browser" },
  { title: "Node.js SDK", summary: "Native Rust package, Buffer APIs, runtime verification, CJS, and ESM.", url: "./docs.html?guide=node" },
  { title: "Rust crate", summary: "voided-core source-of-truth APIs, feature flags, and native integration.", url: "./docs.html?guide=rust" },
  { title: "Artifact model", summary: "VOF3, Fuse, protect/open, inspection, repacking, and presets.", url: "./docs.html?guide=fuse" },
  { title: "Recovery Deck", summary: "52-card generation, deterministic derivation, root wrapping, UI, and rotation.", url: "./docs.html?guide=recovery" },
  { title: "Security boundaries", summary: "Authentication, inspection, bounded work, key lifecycle, and reporting.", url: "./docs.html?guide=security" },
  { title: "Choose an API", summary: "Interactive decision guide for runtime and artifact ownership.", url: "./docs.html?guide=lab#choose-api" },
  { title: "Fuse preset lab", summary: "Compare compact, balanced, and concealed intent.", url: "./docs.html?guide=lab#preset-lab" },
  { title: "Complete library map", summary: "High-level, shell, primitive, recovery, utility, and lifecycle APIs.", url: "./docs.html?guide=library" },
  { title: "Developer support", summary: "Generate diagnostic commands and a safe issue report.", url: "./docs.html?guide=operations" },
  { title: "Compatibility", summary: "Safari, Chromium, Firefox policy, Node.js, macOS, Linux, and Windows.", url: "./support.html#compat-title" },
  { title: "Report a vulnerability", summary: "Open a private GitHub Security Advisory without exposing secret material.", url: "https://github.com/voided-network/voided/security/advisories/new" },
];

function setupSearch() {
  const dialog = document.querySelector("[data-search-dialog]");
  const input = dialog?.querySelector("[data-search-input]");
  const results = dialog?.querySelector("[data-search-results]");
  if (!dialog || !input || !results) return;

  const localEntries = [...document.querySelectorAll("[data-search-title]")].map((element) => ({
    title: element.dataset.searchTitle,
    summary: element.dataset.searchSummary ?? "",
    url: `${location.pathname}#${element.id || "main"}`,
  }));
  const entries = [...searchIndex, ...localEntries].filter((entry, index, all) => all.findIndex((candidate) => candidate.title === entry.title && candidate.url === entry.url) === index);

  function render(query) {
    results.replaceChildren();
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "Try ‘Recovery Deck’, ‘WASM’, ‘inspect’, or ‘rotation’.";
      results.append(empty);
      return;
    }
    const matches = entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.summary}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).slice(0, 8);
    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "No exact match. Try a package, runtime, or API name.";
      results.append(empty);
      return;
    }
    for (const entry of matches) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = entry.url;
      const title = document.createElement("strong");
      title.textContent = entry.title;
      const summary = document.createElement("span");
      summary.textContent = entry.summary;
      link.append(title, summary);
      results.append(link);
    }
  }

  function openSearch() {
    if (!dialog.open) dialog.showModal();
    input.value = "";
    render("");
    window.setTimeout(() => input.focus(), 20);
  }

  document.querySelectorAll("[data-search-open]").forEach((button) => button.addEventListener("click", openSearch));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });
  input.addEventListener("input", () => render(input.value));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("cancel", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) dialog.close();
  });
}

const sdkExamples = {
  browser: {
    package: "@voideddev/e2ee-client",
    filename: "browser.ts",
    linkLabel: "Open the Browser guide",
    description: "Use the stateful client for browser key storage and the normal protect/open lifecycle.",
    href: "./docs.html?guide=browser",
    code: `import { VoidedE2EEClient } from "@voideddev/e2ee-client";

const client = new VoidedE2EEClient();
const blob = await client.protect("Private data", {
  preset: "balanced",
});

const restored = await client.open(blob);`,
  },
  node: {
    package: "@voideddev/enc-server",
    filename: "server.mjs",
    linkLabel: "Open the Node.js guide",
    description: "Use native Rust-backed Buffer APIs when plaintext already lives in a trusted Node.js process.",
    href: "./docs.html?guide=node",
    code: `import { generateKey, open, protect } from "@voideddev/enc-server";

const key = generateKey();
const { artifact } = protect(Buffer.from("Private data"), key, {
  preset: "balanced",
});

const restored = open(artifact, key);
key.fill(0);`,
  },
  rust: {
    package: "voided-core",
    filename: "main.rs",
    linkLabel: "Open the Rust guide",
    description: "Use the source-of-truth crate for native systems, feature control, and explicit byte ownership.",
    href: "./docs.html?guide=rust",
    code: `use voided_core::shell::{open, protect, ProtectOptions};
use voided_core::encryption::generate_key;

let key = generate_key();
let result = protect(
    b"Private data",
    &key,
    Some(ProtectOptions::default()),
)?;

let restored = open(&result.artifact, &key)?;`,
  },
};

function setupSdkSwitcher() {
  const switcher = document.querySelector("[data-sdk-switcher]");
  if (!switcher) return;
  const code = switcher.querySelector("[data-sdk-code]");
  const packageName = switcher.querySelector("[data-sdk-package]");
  const description = switcher.querySelector("[data-sdk-description]");
  const filename = switcher.querySelector("[data-sdk-filename]");
  const link = switcher.querySelector(".text-link");
  const linkLabel = switcher.querySelector("[data-sdk-link-label]");
  switcher.querySelectorAll("[data-sdk]").forEach((button) => {
    button.addEventListener("click", () => {
      const example = sdkExamples[button.dataset.sdk];
      switcher.querySelectorAll("[data-sdk]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
      code.textContent = example.code;
      packageName.textContent = example.package;
      description.textContent = example.description;
      filename.textContent = example.filename;
      link.href = example.href;
      linkLabel.textContent = example.linkLabel;
      announce(`${button.dataset.sdk} example selected`);
    });
  });
}

function setupDocs() {
  const panels = [...document.querySelectorAll("[data-guide-panel]")];
  const buttons = [...document.querySelectorAll("[data-guide]")];
  const toc = document.querySelector("[data-doc-toc]");
  const main = document.querySelector(".docs-main");
  if (panels.length === 0) return;

  function rebuildToc(selected) {
    if (!toc) return;
    toc.replaceChildren();
    selected.querySelectorAll("[data-doc-heading]").forEach((section) => {
      const link = document.createElement("a");
      link.href = `#${section.id}`;
      link.textContent = section.dataset.docHeading;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const destination = document.getElementById(section.id);
        if (!destination) return;
        const url = new URL(location.href);
        url.hash = section.id;
        history.replaceState(history.state, "", url);
        remoldRegion(destination, () => {}, { quick: true }).then(() => {
          destination.scrollIntoView({ block: "start", behavior: "auto" });
        });
      });
      toc.append(link);
    });
  }

  function commitGuide(selected, updateHistory) {
    const selectedButton = buttons.find((button) => button.dataset.guide === selected.dataset.guidePanel);
    panels.forEach((panel) => { panel.hidden = panel !== selected; });
    buttons.forEach((button) => {
      if (button.dataset.guide === selected.dataset.guidePanel) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    rebuildToc(selected);
    if (updateHistory) {
      const url = new URL(location.href);
      url.searchParams.set("guide", selected.dataset.guidePanel);
      url.hash = "";
      history.pushState({ guide: selected.dataset.guidePanel }, "", url);
    }
    document.title = `${selected.querySelector("h1").textContent} — Voided Developer`;
    document.dispatchEvent(new CustomEvent("voided:guide-change", { detail: { guide: selected.dataset.guidePanel } }));
    if (selectedButton && window.matchMedia("(max-width: 780px)").matches) {
      const sidebar = selectedButton.closest(".docs-sidebar");
      sidebar.scrollLeft = Math.max(0, selectedButton.offsetLeft - ((sidebar.clientWidth - selectedButton.offsetWidth) / 2));
    }
  }

  function showGuide(name, updateHistory = true, animate = true) {
    if (animate && main?.dataset.regionRemolding === "true") return Promise.resolve();
    const selected = panels.find((panel) => panel.dataset.guidePanel === name) ?? panels[0];
    const current = panels.find((panel) => !panel.hidden);
    if (current === selected) {
      if (!animate) commitGuide(selected, false);
      else rebuildToc(selected);
      return Promise.resolve();
    }
    const swap = () => commitGuide(selected, updateHistory);
    const transition = animate ? remoldRegion(main, swap) : (swap(), Promise.resolve());
    return transition.then(() => {
      if (updateHistory) main.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  buttons.forEach((button) => button.addEventListener("click", () => showGuide(button.dataset.guide)));
  const initial = new URL(location.href).searchParams.get("guide") ?? "start";
  showGuide(initial, false, false).then(() => {
    const hashTarget = location.hash ? document.querySelector(location.hash) : null;
    if (hashTarget) hashTarget.scrollIntoView({ block: "start", behavior: "auto" });
  });
  window.addEventListener("popstate", () => showGuide(new URL(location.href).searchParams.get("guide") ?? "start", false));
}

const pathRecommendations = {
  browser: {
    package: "@voideddev/e2ee-client",
    full: { title: "Use protect/open.", copy: "Let the stateful browser client own key persistence and the complete VOF3 artifact lifecycle.", code: `const artifact = await client.protect(data, {\n  preset: "balanced",\n});\nconst restored = await client.open(artifact);` },
    shell: { title: "Use crypto.fuse/unfuse.", copy: "Your bytes are already prepared. Apply only the authenticated outer shell through the verified WASM backend.", code: `const shell = await crypto.fuse(bytes, key, "balanced");\nconst restored = await crypto.unfuse(shell, key);` },
    primitive: { title: "Use crypto.encrypt/decrypt.", copy: "You own serialization and the outer format. Keep nonce, tag, algorithm, and key lifecycle explicit.", code: `const encrypted = await crypto.encrypt(bytes, key);\nconst restored = await crypto.decrypt(encrypted, key);` },
    recovery: { title: "Use Recovery Deck helpers.", copy: "Derive transient recovery material in verified WASM and persist only the opaque root wrapper.", code: `const setup = await crypto.createRecoveryDeck(root);\nawait saveOpaqueWrapper(setup.rootWrapper);\nsetup.deck.fill("");` },
  },
  node: {
    package: "@voideddev/enc-server",
    full: { title: "Use protect/open.", copy: "Keep plaintext inside the trusted server process and produce one native Rust-backed artifact.", code: `const { artifact } = protect(data, key, {\n  preset: "balanced",\n});\nconst restored = open(artifact, key);` },
    shell: { title: "Use fuse/unfuse.", copy: "Wrap already-prepared Buffer data in the shell without re-owning its inner preparation.", code: `const shell = fuse(data, key, "balanced");\nconst restored = unfuse(shell, key);` },
    primitive: { title: "Use encrypt/decrypt.", copy: "You own the outer wire format and need only the native AEAD result fields.", code: `const encrypted = encrypt(data, key);\nconst restored = decrypt(encrypted, key);` },
    recovery: { title: "Use createRecoveryDeck.", copy: "Generate a deck and wrapper around an existing stable root; never persist the deck or derived key.", code: `const setup = createRecoveryDeck(stableRoot);\nawait saveOpaqueWrapper(setup.rootWrapper);\nsetup.deck.fill("");` },
  },
  rust: {
    package: "voided-core",
    full: { title: "Use shell::protect/open.", copy: "Call the source-of-truth artifact path directly with explicit options and native key ownership.", code: `let result = protect(data, &key, Some(options))?;\nlet restored = open(&result.artifact, &key)?;` },
    shell: { title: "Use fuse_bytes/unfuse_bytes.", copy: "Apply the outer shell directly to bytes your Rust system has already prepared.", code: `let shell = fuse_bytes(data, &key, Some(options))?;\nlet restored = unfuse_bytes(&shell, &key)?;` },
    primitive: { title: "Use encryption::encrypt/decrypt.", copy: "Own the outer representation while using the audited AEAD primitives directly.", code: `let encrypted = encrypt(data, &key, Some(options))?;\nlet restored = decrypt(&encrypted, &key)?;` },
    recovery: { title: "Use recovery_deck.", copy: "Generate and derive under the permanent protocol while keeping secret buffers transient.", code: `let setup = create_recovery_deck(&stable_root)?;\nstore_wrapper(&setup.root_wrapper)?;` },
  },
};

function setupPathFinder() {
  const finder = document.querySelector("[data-path-finder]");
  if (!finder) return;
  const state = { runtime: "browser", ownership: "full", need: "artifact" };
  const packageName = finder.querySelector("[data-recommendation-package]");
  const title = finder.querySelector("[data-recommendation-title]");
  const copy = finder.querySelector("[data-recommendation-copy]");
  const code = finder.querySelector("[data-recommendation-code]");
  const filename = finder.querySelector("[data-recommendation-file]");
  function render() {
    const runtime = pathRecommendations[state.runtime];
    const recommendation = state.need === "recovery" ? runtime.recovery : runtime[state.ownership];
    packageName.textContent = runtime.package;
    title.textContent = recommendation.title;
    copy.textContent = recommendation.copy;
    code.textContent = recommendation.code;
    filename.textContent = state.runtime === "rust" ? "main.rs" : state.runtime === "node" ? "server.mjs" : "browser.ts";
  }
  finder.querySelectorAll("[data-choice-group]").forEach((group) => {
    group.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", () => {
      group.querySelectorAll("[data-choice]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      state[group.dataset.choiceGroup] = button.dataset.choice;
      render();
    }));
  });
  render();
}

const presetData = {
  compact: { label: "Compact · lowest overhead", title: "Keep it lean.", copy: "Choose compact when artifact size is the governing constraint and your measured corpus does not need more shell variation.", width: "26%", overhead: "low", variation: "low", use: "measured", code: `const { artifact } = protect(data, key, {\n  preset: "compact",\n});` },
  balanced: { label: "Balanced · recommended default", title: "Start here.", copy: "General-purpose artifact shaping for most applications. It keeps overhead and shell variation in a practical middle ground.", width: "55%", overhead: "medium", variation: "medium", use: "default", code: `const { artifact } = protect(data, key, {\n  preset: "balanced",\n});` },
  concealed: { label: "Concealed · heavier variation", title: "Vary the silhouette.", copy: "Choose concealed only when added shell variation is worth the extra artifact overhead in your measured workload.", width: "88%", overhead: "high", variation: "high", use: "specialized", code: `const { artifact } = protect(data, key, {\n  preset: "concealed",\n});` },
};

function setupPresetLab() {
  const lab = document.querySelector("[data-preset-lab]");
  if (!lab) return;
  const fields = {
    label: lab.querySelector("[data-preset-label]"), title: lab.querySelector("[data-preset-title]"), copy: lab.querySelector("[data-preset-copy]"), meter: lab.querySelector("[data-preset-meter]"), overhead: lab.querySelector("[data-preset-overhead]"), variation: lab.querySelector("[data-preset-variation]"), use: lab.querySelector("[data-preset-use]"), code: lab.querySelector("[data-preset-code]"),
  };
  lab.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const value = presetData[button.dataset.preset];
    lab.querySelectorAll("[data-preset]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    Object.keys(fields).forEach((key) => {
      if (key === "meter") fields[key].style.width = value.width;
      else fields[key].textContent = value[key];
    });
  }));
}

const diagnosticCommands = {
  browser: {
    load: ["npm --prefix packages/e2ee-client run verify:release", "npm --prefix packages/e2ee-client run test:wasm", "npm --prefix packages/e2ee-client run smoke:package"],
    open: ["npm --prefix packages/e2ee-client run test:integration", "npm --prefix packages/e2ee-client run test:wasm"],
    recovery: ["npm --prefix packages/e2ee-client run test:wasm", "npm --prefix packages/e2ee-client test -- recovery-deck-ui"],
    performance: ["npm --prefix packages/e2ee-client run test:benchmark"],
    package: ["npm --prefix packages/e2ee-client run verify:source", "npm --prefix packages/e2ee-client run smoke:package"],
  },
  node: {
    load: ["npm --prefix packages/enc-server run verify:release:current", "npm --prefix packages/enc-server run smoke:package:current"],
    open: ["npm --prefix packages/enc-server run test:integration"],
    recovery: ["npm --prefix packages/enc-server test -- recovery-deck"],
    performance: ["npm --prefix packages/enc-server test"],
    package: ["npm --prefix packages/enc-server run verify:source", "npm --prefix packages/enc-server run smoke:package:current"],
  },
  rust: {
    load: ["cargo check --manifest-path crates/Cargo.toml --workspace --all-features"],
    open: ["cargo test --manifest-path crates/Cargo.toml -p voided-core shell"],
    recovery: ["cargo test --manifest-path crates/Cargo.toml -p voided-core recovery_deck"],
    performance: ["npm run test:rust:performance"],
    package: ["cargo package --manifest-path crates/voided-core/Cargo.toml --list"],
  },
};

function setupDiagnosticBuilder() {
  const form = document.querySelector("[data-diagnostic-form]");
  if (!form) return;
  const runtime = form.elements.runtime;
  const symptom = form.elements.symptom;
  const output = form.querySelector("[data-diagnostic-output]");
  const runtimeLabels = { browser: "Browser / WASM", node: "Node.js native package", rust: "Rust crate" };
  function render() {
    const symptomLabel = symptom.options[symptom.selectedIndex].text;
    output.textContent = `# ${runtimeLabels[runtime.value]}\n# ${symptomLabel}\n\n${diagnosticCommands[runtime.value][symptom.value].join("\n")}`;
  }
  form.addEventListener("input", render);
  render();
}

const developerModeBriefs = {
  start: {
    guided: ["Start with the highest safe surface.", "Pick the runtime where readable data already exists, then use protect/open unless you deliberately own the outer format."],
    expert: ["Entry contract", "Browser: stateful client · Node: native Buffer API · Rust: voided-core. Current writer: VOF3. Default AEAD: XChaCha20-Poly1305."],
  },
  lab: {
    guided: ["Make the ownership decision visible.", "Use the controls to see which layer owns bytes, policy, artifacts, and recovery state."],
    expert: ["Workbench contract", "Resolve runtime + inner-byte ownership + required output. Inspect VOF3 stages, preset overhead, and wrapper-only recovery rotation."],
  },
  library: {
    guided: ["Move down only when you need control.", "Every lower layer removes automation and hands more lifecycle responsibility to your application."],
    expert: ["Surface contract", "High-level → shell → primitive → recovery → utility. Package versions and wire-format versions are independent."],
  },
  browser: {
    guided: ["Keep browser plaintext in the browser.", "Use the stateful client for normal app data and let it own verified WASM, artifact flow, and key lifecycle."],
    expert: ["Browser contract", "Verified Rust/WASM is mandatory for Fuse and Recovery Deck. IndexedDB is a local key method, not an E2EE trust proof. Compression defaults off."],
  },
  node: {
    guided: ["Use Node only when the server is allowed to read.", "The native package is for trusted server processes; client-side E2EE should protect data before it reaches Node."],
    expert: ["Node contract", "Node 18+ · native Rust Buffer APIs · CJS + ESM · explicit zeroization. Never call this an E2EE server boundary if plaintext enters the process."],
  },
  rust: {
    guided: ["Use the source-of-truth implementation directly.", "Rust is the right surface when your native system needs explicit feature, allocation, and byte ownership."],
    expert: ["Rust contract", "voided-core owns authenticated open, bounded work, canonical parsing, recovery derivation, and VOF3 writers. Feature selection is target-specific."],
  },
  fuse: {
    guided: ["One artifact, one authenticated story.", "Fuse shapes already-prepared bytes; protect/open owns the complete normal application path."],
    expert: ["Artifact contract", "VOF3 plan + payload are authenticated together. Keyless inspection is untrusted. compact/balanced/concealed alter shape and overhead, not the AEAD primitive."],
  },
  recovery: {
    guided: ["Recover a stable root, not every file.", "A new random deck replaces only the recovery wrapper while application and data keys remain stable."],
    expert: ["Recovery contract", "52! permutations → canonical 29-byte rank → domain-separated 32-byte key → 80-byte opaque wrapper. Deck and derived key never persist."],
  },
  security: {
    guided: ["Cryptography is one boundary in a system.", "Keep keys and plaintext out of logs, authenticate before trust, and decide where readable data is allowed to exist."],
    expert: ["Failure contract", "Reject malformed, oversized, non-canonical, wrong-key, and tampered inputs before plaintext release. Structural inspection cannot authorize."],
  },
  operations: {
    guided: ["Share the smallest reproducible failure.", "Run the focused checks, include public runtime facts, and remove all secret or customer material."],
    expert: ["Evidence contract", "Report platform, version, exact public error, deterministic reproduction, and command output. Secrets, plaintext, decks, roots, and crash memory stay out."],
  },
};

function setupDevMode() {
  const switcher = document.querySelector("[data-dev-mode-switch]");
  if (!switcher) return;
  const page = document.body;
  const main = document.querySelector(".docs-main");
  const explanation = document.querySelector("[data-dev-mode-description]");
  const descriptions = {
    guided: "Plain-language reasoning, recommended defaults, and visible security boundaries.",
    expert: "Contracts, byte ownership, protocol facts, and API surface without the introductory layer.",
  };
  document.querySelectorAll("[data-guide-panel]").forEach((panel) => {
    const header = panel.querySelector(".docs-guide__header");
    if (!header || header.querySelector("[data-dev-mode-brief]")) return;
    const brief = document.createElement("div");
    brief.className = "dev-mode-brief";
    brief.dataset.devModeBrief = "";
    const label = document.createElement("span");
    const title = document.createElement("strong");
    const copy = document.createElement("p");
    label.dataset.devModeLabel = "";
    title.dataset.devModeTitle = "";
    copy.dataset.devModeCopy = "";
    brief.append(label, title, copy);
    header.append(brief);
  });

  function renderBriefs(mode) {
    document.querySelectorAll("[data-guide-panel]").forEach((panel) => {
      const facts = developerModeBriefs[panel.dataset.guidePanel]?.[mode];
      const brief = panel.querySelector("[data-dev-mode-brief]");
      if (!facts || !brief) return;
      brief.querySelector("[data-dev-mode-label]").textContent = mode === "expert" ? "EXPERT CONTRACT" : "GUIDED PATH";
      brief.querySelector("[data-dev-mode-title]").textContent = facts[0];
      brief.querySelector("[data-dev-mode-copy]").textContent = facts[1];
    });
  }

  function commitMode(mode) {
    page.dataset.devMode = mode;
    switcher.querySelectorAll("[data-dev-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.devMode === mode)));
    if (explanation) explanation.textContent = descriptions[mode];
    renderBriefs(mode);
  }

  function setMode(mode, animate = true) {
    if (page.dataset.devMode === mode && animate) return;
    if (animate && main?.dataset.regionRemolding === "true") return;
    const apply = () => commitMode(mode);
    if (animate) remoldRegion(main, apply, { quick: true });
    else apply();
    announce(`${mode === "expert" ? "Expert" : "Guided"} developer mode selected`);
  }
  switcher.querySelectorAll("[data-dev-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.devMode)));
  setMode("guided", false);
}

const artifactStages = {
  input: { index: "01", title: "Application bytes", owner: "Your application", fact: "Define the plaintext trust boundary and size limit before invoking crypto.", bytes: "UTF-8 or caller-owned bytes" },
  prepare: { index: "02", title: "Prepared payload", owner: "Voided policy", fact: "Optional bounded compression runs only under an explicit policy. Browser high-level compression defaults off.", bytes: "none · gzip · brotli" },
  encrypt: { index: "03", title: "AEAD payload", owner: "voided-core", fact: "XChaCha20-Poly1305 authenticates the payload and context. Tampering becomes a hard failure.", bytes: "nonce + ciphertext + tag" },
  shape: { index: "04", title: "VOF3 artifact", owner: "Fuse writer", fact: "The complete authenticated plan becomes one versioned monolith under compact, balanced, or concealed intent.", bytes: "one persistent byte artifact" },
  inspect: { index: "05", title: "Structural inspection", owner: "Untrusted caller", fact: "Keyless metadata is attacker-controlled. It may guide bounded routing, never authorization.", bytes: "public shape metadata" },
  open: { index: "06", title: "Authenticated open", owner: "voided-core", fact: "Parsing and work bounds precede tag verification; plaintext is released only after authentication and bounded decompression.", bytes: "original application bytes" },
};

function setupArtifactExplorer() {
  const explorer = document.querySelector("[data-artifact-explorer]");
  if (!explorer) return;
  const fields = {
    index: explorer.querySelector("[data-artifact-index]"),
    title: explorer.querySelector("[data-artifact-title]"),
    owner: explorer.querySelector("[data-artifact-owner]"),
    fact: explorer.querySelector("[data-artifact-fact]"),
    bytes: explorer.querySelector("[data-artifact-bytes]"),
  };
  explorer.querySelectorAll("[data-artifact-stage]").forEach((button) => button.addEventListener("click", () => {
    const stage = artifactStages[button.dataset.artifactStage];
    explorer.querySelectorAll("[data-artifact-stage]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    Object.entries(fields).forEach(([key, element]) => { element.textContent = stage[key]; });
  }));
}

function setupRecoverySimulator() {
  const simulator = document.querySelector("[data-recovery-simulator]");
  if (!simulator) return;
  const state = simulator.querySelector("[data-recovery-state]");
  const wrapper = simulator.querySelector("[data-recovery-wrapper]");
  const root = simulator.querySelector("[data-recovery-root]");
  const apps = [...simulator.querySelectorAll("[data-recovery-app]")];
  let generation = 1;
  simulator.querySelector("[data-recovery-rotate]").addEventListener("click", () => {
    generation += 1;
    simulator.classList.remove("is-rotating");
    void simulator.offsetWidth;
    simulator.classList.add("is-rotating");
    wrapper.textContent = `WRAPPER ${String(generation).padStart(2, "0")} · NEW`;
    root.textContent = "STABLE ROOT · UNCHANGED";
    apps.forEach((app) => { app.textContent = `${app.dataset.recoveryApp} KEY · UNCHANGED`; });
    state.textContent = `Rotation ${generation - 1}: a fresh CSPRNG deck replaced only the recovery wrapper. No application key or protected artifact changed.`;
  });
}

setupSiteChrome();
setupNavigation();
setupCopyButtons();
setupSearch();
setupSdkSwitcher();
setupDocs();
setupPathFinder();
setupPresetLab();
setupDiagnosticBuilder();
setupDevMode();
setupArtifactExplorer();
setupRecoverySimulator();
setupMatrixPageTransitions();
