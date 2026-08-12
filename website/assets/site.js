const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const liveRegion = document.querySelector("[data-live-region]");

function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = "";
  window.setTimeout(() => { liveRegion.textContent = message; }, 20);
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
  { title: "Get started", summary: "Choose Browser, Node.js, or Rust and use the normal protect/open flow.", url: "./docs.html?guide=start" },
  { title: "Browser SDK", summary: "Stateful client, IndexedDB keys, WASM behavior, compression, and browser support.", url: "./docs.html?guide=browser" },
  { title: "Node.js SDK", summary: "Native Rust package, Buffer APIs, runtime verification, CJS, and ESM.", url: "./docs.html?guide=node" },
  { title: "Rust crate", summary: "voided-core source-of-truth APIs, feature flags, and native integration.", url: "./docs.html?guide=rust" },
  { title: "Artifact model", summary: "VOF3, Fuse, protect/open, inspection, repacking, and presets.", url: "./docs.html?guide=fuse" },
  { title: "Recovery Deck", summary: "52-card generation, deterministic derivation, root wrapping, UI, and rotation.", url: "./docs.html?guide=recovery" },
  { title: "Security boundaries", summary: "Authentication, inspection, bounded work, key lifecycle, and reporting.", url: "./docs.html?guide=security" },
  { title: "Choose an API", summary: "Interactive decision guide for runtime and artifact ownership.", url: "./learn.html#choose-api" },
  { title: "Fuse preset lab", summary: "Compare compact, balanced, and concealed intent.", url: "./learn.html#preset-lab" },
  { title: "Developer support", summary: "Generate diagnostic commands and a safe issue report.", url: "./support.html" },
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

function setupReveals() {
  const elements = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.14, rootMargin: "0px 0px -6%" });
  elements.forEach((element) => observer.observe(element));
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

function setupArtifactStage() {
  const stage = document.querySelector("[data-artifact-stage]");
  if (!stage || reducedMotion) return;
  stage.addEventListener("pointermove", (event) => {
    const bounds = stage.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    stage.style.setProperty("--ry", `${x * 10}deg`);
    stage.style.setProperty("--rx", `${y * -8}deg`);
  });
  stage.addEventListener("pointerleave", () => {
    stage.style.setProperty("--ry", "0deg");
    stage.style.setProperty("--rx", "0deg");
  });
}

function setupSignalCanvas() {
  const canvas = document.querySelector("#signal-canvas");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const points = Array.from({ length: 28 }, (_, index) => ({
    x: ((index * 37) % 101) / 100,
    y: ((index * 61) % 97) / 96,
    phase: index * 0.41,
  }));
  let frame = 0;
  function draw(time = 0) {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(bounds.width * ratio));
    const height = Math.max(1, Math.floor(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(199,255,94,.15)";
    context.fillStyle = "rgba(199,255,94,.7)";
    context.lineWidth = ratio;
    const positions = points.map((point) => ({
      x: point.x * width,
      y: (point.y + Math.sin(time * 0.00035 + point.phase) * 0.015) * height,
    }));
    for (let index = 0; index < positions.length; index += 1) {
      for (let other = index + 1; other < positions.length; other += 1) {
        const dx = positions[index].x - positions[other].x;
        const dy = positions[index].y - positions[other].y;
        if (dx * dx + dy * dy < (width * 0.16) ** 2) {
          context.beginPath();
          context.moveTo(positions[index].x, positions[index].y);
          context.lineTo(positions[other].x, positions[other].y);
          context.stroke();
        }
      }
      context.beginPath();
      context.arc(positions[index].x, positions[index].y, 1.35 * ratio, 0, Math.PI * 2);
      context.fill();
    }
    if (!reducedMotion) frame = requestAnimationFrame(draw);
  }
  draw();
  window.addEventListener("pagehide", () => cancelAnimationFrame(frame), { once: true });
}

function setupDocs() {
  const panels = [...document.querySelectorAll("[data-guide-panel]")];
  const buttons = [...document.querySelectorAll("[data-guide]")];
  const toc = document.querySelector("[data-doc-toc]");
  if (panels.length === 0) return;

  function showGuide(name, updateHistory = true) {
    const selected = panels.find((panel) => panel.dataset.guidePanel === name) ?? panels[0];
    const selectedButton = buttons.find((button) => button.dataset.guide === selected.dataset.guidePanel);
    panels.forEach((panel) => { panel.hidden = panel !== selected; });
    buttons.forEach((button) => {
      if (button.dataset.guide === selected.dataset.guidePanel) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (toc) {
      toc.replaceChildren();
      selected.querySelectorAll("[data-doc-heading]").forEach((section) => {
        const link = document.createElement("a");
        link.href = `#${section.id}`;
        link.textContent = section.dataset.docHeading;
        toc.append(link);
      });
    }
    if (updateHistory) {
      const url = new URL(location.href);
      url.searchParams.set("guide", selected.dataset.guidePanel);
      history.pushState({ guide: selected.dataset.guidePanel }, "", url);
    }
    document.title = `${selected.querySelector("h1").textContent} — Voided Docs`;
    if (selectedButton && window.matchMedia("(max-width: 780px)").matches) {
      const sidebar = selectedButton.closest(".docs-sidebar");
      sidebar.scrollLeft = Math.max(0, selectedButton.offsetLeft - ((sidebar.clientWidth - selectedButton.offsetWidth) / 2));
    }
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }

  buttons.forEach((button) => button.addEventListener("click", () => showGuide(button.dataset.guide)));
  const initial = new URL(location.href).searchParams.get("guide") ?? "start";
  showGuide(initial, false);
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
  const context = form.elements.context;
  const output = form.querySelector("[data-diagnostic-output]");
  const runtimeLabels = { browser: "Browser / WASM", node: "Node.js native package", rust: "Rust crate" };
  function render() {
    const symptomLabel = symptom.options[symptom.selectedIndex].text;
    const safeContext = context.value.trim() || "[Add OS/runtime version and exact public error message]";
    output.textContent = `Runtime: ${runtimeLabels[runtime.value]}\nSymptom: ${symptomLabel}\n\nRun:\n${diagnosticCommands[runtime.value][symptom.value].join("\n")}\n\nSafe context:\n${safeContext}\n\nInclude:\n- Package or crate version\n- OS and architecture\n- Exact public error message\n- Whether the failure is deterministic\n\nNever include keys, deck order, plaintext, environment secrets, or protected customer data.`;
  }
  form.addEventListener("input", render);
  render();
}

setupNavigation();
setupCopyButtons();
setupSearch();
setupReveals();
setupSdkSwitcher();
setupArtifactStage();
setupSignalCanvas();
setupDocs();
setupPathFinder();
setupPresetLab();
setupDiagnosticBuilder();
