const encoder = new TextEncoder();
const decoder = new TextDecoder();

let wasmPromise;
let clientPromise;

function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = import("../runtime/voided_wasm.js").then(async (module) => {
      await module.default({ module_or_path: new URL("../runtime/voided_wasm_bg.wasm", import.meta.url) });
      return module;
    });
  }
  return wasmPromise;
}

function loadClient() {
  if (!clientPromise) {
    clientPromise = import("../runtime/e2ee-client.js").then(async (client) => {
      client.configureWasmLoader({ glueUrl: new URL("../runtime/voided_wasm.js", import.meta.url) });
      await client.forceWasmBackend();
      return client;
    });
  }
  return clientPromise;
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stringifyRaw(value) {
  return JSON.stringify(value, (_key, nested) => nested instanceof Uint8Array ? {
    bytes: nested.length,
    base64: bytesToBase64(nested),
    hex: bytesToHex(nested),
  } : nested, 2);
}

function stringToRustLiteral(value) {
  const escaped = [...value].map((character) => {
    if (character === "\\") return "\\\\";
    if (character === '"') return '\\"';
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    const codePoint = character.codePointAt(0);
    return codePoint < 0x20 ? `\\u{${codePoint.toString(16)}}` : character;
  }).join("");
  return `"${escaped}"`;
}

function setBusy(button, busy, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? "Running…" : idleLabel;
}

function setOutputMessage(output, title, message) {
  output.replaceChildren();
  if (title) {
    const heading = document.createElement("strong");
    heading.textContent = title;
    output.append(heading);
  }
  const detail = document.createElement("span");
  detail.textContent = message;
  output.append(detail);
}

function appendOutputRow(output, label, value) {
  const row = document.createElement("span");
  const name = document.createElement("b");
  name.textContent = label;
  const result = document.createElement("code");
  result.textContent = value;
  row.append(name, result);
  output.append(row);
}

function setupFunctionLab() {
  const lab = document.querySelector("[data-function-lab]");
  if (!lab) return;

  const runtime = lab.querySelector("[data-lab-runtime]");
  const keyStatus = lab.querySelector("[data-lab-key-status]");
  const keyPanel = lab.querySelector("[data-lab-key-panel]");
  const keyRaw = lab.querySelector("[data-lab-key-raw]");
  const generateButton = lab.querySelector("[data-lab-generate-key]");
  const runButton = lab.querySelector("[data-lab-run]");
  const input = lab.querySelector("[data-lab-input]");
  const preset = lab.querySelector("[data-lab-preset]");
  const usage = lab.querySelector("[data-lab-usage]");
  const output = lab.querySelector("[data-lab-output]");
  const roundtrip = lab.querySelector("[data-lab-roundtrip]");
  const match = lab.querySelector("[data-lab-match]");
  const artifactLabel = lab.querySelector("[data-lab-artifact-label]");
  const artifactRaw = lab.querySelector("[data-lab-artifact-raw]");
  const artifactMeta = lab.querySelector("[data-lab-artifact-meta]");
  const traceInputText = lab.querySelector("[data-lab-input-text]");
  const traceInputHex = lab.querySelector("[data-lab-input-hex]");
  const traceInputBase64 = lab.querySelector("[data-lab-input-base64]");
  const traceKeyBase64 = lab.querySelector("[data-lab-trace-key-base64]");
  const traceKeyHex = lab.querySelector("[data-lab-key-hex]");
  const traceRestoredHex = lab.querySelector("[data-lab-restored-hex]");
  const traceRestoredBase64 = lab.querySelector("[data-lab-restored-base64]");
  const traceRestoredText = lab.querySelector("[data-lab-restored-text]");
  let key = null;
  let operation = "protect";
  let language = "node";

  function updateUsage() {
    if (language === "rust") {
      const text = stringToRustLiteral(input.value);
      const presetName = `${preset.value[0].toUpperCase()}${preset.value.slice(1)}`;
      if (operation === "encrypt") {
        usage.textContent = `use voided_core::encryption;\n\nfn main() -> Result<(), Box<dyn std::error::Error>> {\n    let key = encryption::generate_key();\n    let encrypted_data = encryption::encrypt(\n        ${text}.as_bytes(),\n        &key,\n        None,\n    )?;\n    let restored_text = String::from_utf8(\n        encryption::decrypt(&encrypted_data, &key)?\n    )?;\n\n    println!("{restored_text}");\n    Ok(())\n}`;
      } else {
        const safetyNote = operation === "fuse" ? "    // The safe text path applies AEAD before the Fuse shell.\n" : "";
        usage.textContent = `use voided_core::{\n    encryption,\n    shell::{self, FusedPreset, ProtectOptions},\n};\n\nfn main() -> Result<(), Box<dyn std::error::Error>> {\n    let key = encryption::generate_key();\n${safetyNote}    let protected_data = shell::protect(\n        ${text}.as_bytes(),\n        &key,\n        Some(ProtectOptions {\n            preset: FusedPreset::${presetName},\n            ..Default::default()\n        }),\n    )?;\n    let restored_text = String::from_utf8(\n        shell::open(&protected_data.artifact, &key)?\n    )?;\n\n    println!("{restored_text}");\n    Ok(())\n}`;
      }
      return;
    }

    const text = JSON.stringify(input.value);
    if (operation === "protect") {
      usage.textContent = `import { protect, open } from "@voideddev/e2ee-client";\n\nconst protectedData = await protect(${text}, {\n  preset: ${JSON.stringify(preset.value)},\n});\nconst restoredText = await open(protectedData);`;
    } else if (operation === "fuse") {
      usage.textContent = `import { protect, open } from "@voideddev/e2ee-client";\n\n// Encoding, AEAD, and Fuse are handled for you.\nconst protectedData = await protect(${text}, {\n  preset: ${JSON.stringify(preset.value)},\n});\nconst restoredText = await open(protectedData);`;
    } else {
      usage.textContent = `import { encrypt, decrypt } from "@voideddev/e2ee-client";\n\nconst encryptedData = await encrypt(${text});\nconst restoredText = await decrypt(encryptedData);`;
    }
  }

  function clearRoundtrip() {
    roundtrip.hidden = true;
    match.textContent = "Not run";
    artifactRaw.textContent = "";
    artifactMeta.textContent = "";
  }

  function showRoundtrip({ plaintext, restored, label, raw, metadata }) {
    traceInputText.textContent = input.value;
    traceInputHex.textContent = bytesToHex(plaintext);
    traceInputBase64.textContent = bytesToBase64(plaintext);
    traceKeyBase64.textContent = bytesToBase64(key);
    traceKeyHex.textContent = bytesToHex(key);
    artifactLabel.textContent = label;
    artifactRaw.textContent = raw;
    artifactMeta.textContent = stringifyRaw(metadata);
    traceRestoredHex.textContent = bytesToHex(restored);
    traceRestoredBase64.textContent = bytesToBase64(restored);
    traceRestoredText.textContent = decoder.decode(restored);
    match.textContent = "Exact match · true";
    roundtrip.hidden = false;
  }

  function clearKey() {
    key?.fill(0);
    key = null;
  }

  generateButton.addEventListener("click", async () => {
    generateButton.disabled = true;
    runtime.textContent = "Loading Rust/WASM…";
    try {
      const wasm = await loadWasm();
      clearKey();
      key = wasm.generateKey();
      keyStatus.textContent = "32 bytes · full value shown below";
      keyRaw.textContent = bytesToBase64(key);
      keyPanel.hidden = false;
      clearRoundtrip();
      updateUsage();
      runtime.textContent = "Rust/WASM ready";
      runButton.disabled = false;
      setOutputMessage(output, "", "Key generated locally. The exact Base64 value is visible above.");
    } catch (error) {
      runtime.textContent = "Runtime unavailable";
      setOutputMessage(output, "Could not initialize Voided WASM.", error instanceof Error ? error.message : String(error));
    } finally {
      generateButton.disabled = false;
    }
  });

  lab.querySelectorAll("[data-lab-operation]").forEach((button) => {
    button.addEventListener("click", () => {
      operation = button.dataset.labOperation;
      lab.querySelectorAll("[data-lab-operation]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      preset.disabled = operation === "encrypt";
      clearRoundtrip();
      updateUsage();
      setOutputMessage(output, "", operation === "protect" ? "Creates a complete VOF3 artifact, then opens it." : operation === "fuse" ? "Isolates the Fuse shell for inspection. Normal text callers should still use protect/open." : "Runs the lower-level AEAD primitive and verifies the result.");
    });
  });

  lab.querySelectorAll("[data-lab-language]").forEach((button) => {
    button.addEventListener("click", () => {
      language = button.dataset.labLanguage;
      lab.querySelectorAll("[data-lab-language]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      updateUsage();
    });
  });

  input.addEventListener("input", updateUsage);
  preset.addEventListener("change", () => {
    clearRoundtrip();
    updateUsage();
  });

  runButton.addEventListener("click", async () => {
    if (!key) return;
    const plaintext = encoder.encode(input.value);
    let binaryArtifact;
    let restored;
    setBusy(runButton, true, "Run round trip");
    clearRoundtrip();
    setOutputMessage(output, "", "Running locally…");
    try {
      const wasm = await loadWasm();
      let result;
      let rawLabel;
      let rawValue;
      let publicStructure;
      if (operation === "protect") {
        const protectedResult = wasm.protect(plaintext, key, preset.value, undefined, undefined, "xchacha20-poly1305", undefined);
        binaryArtifact = protectedResult.artifact;
        restored = wasm.open(protectedResult.artifact, key);
        const info = wasm.inspectArtifact(protectedResult.artifact);
        rawLabel = "Full VOF3 artifact · Base64";
        rawValue = bytesToBase64(protectedResult.artifact);
        publicStructure = info;
        result = {
          Function: "protect → open",
          Format: `VOF${info.version}`,
          Preset: info.preset,
          Input: `${plaintext.length} bytes`,
          Artifact: `${protectedResult.artifact.length} bytes`,
        };
      } else if (operation === "fuse") {
        const fused = wasm.fuse(plaintext, key, preset.value, undefined);
        binaryArtifact = fused;
        restored = wasm.unfuse(fused, key);
        rawLabel = "Full isolated Fuse shell · Base64";
        rawValue = bytesToBase64(fused);
        publicStructure = wasm.inspectFused(fused);
        result = {
          Function: "fuse → unfuse",
          Preset: preset.value,
          Input: `${plaintext.length} bytes`,
          Fused: `${fused.length} bytes`,
        };
      } else {
        const encrypted = wasm.encrypt(plaintext, key, "xchacha20-poly1305");
        restored = wasm.decrypt(encrypted, key);
        rawLabel = "Full encrypted result · JSON";
        rawValue = JSON.stringify(encrypted, null, 2);
        publicStructure = {
          algorithm: encrypted.algorithm,
          ciphertextBytes: atob(encrypted.ciphertext).length,
          nonceBytes: atob(encrypted.nonce).length,
          tagBytes: atob(encrypted.tag).length,
        };
        result = {
          Function: "encrypt → decrypt",
          Algorithm: encrypted.algorithm,
          Input: `${plaintext.length} bytes`,
          Ciphertext: `${encrypted.ciphertext.length} base64 characters`,
        };
      }

      if (!equalBytes(plaintext, restored)) throw new Error("Round-trip output did not match the input");
      output.replaceChildren();
      const status = document.createElement("strong");
      status.textContent = "Round trip verified";
      output.append(status);
      for (const [label, value] of Object.entries(result)) {
        appendOutputRow(output, label, value);
      }
      appendOutputRow(output, "Restored", decoder.decode(restored));
      showRoundtrip({ plaintext, restored, label: rawLabel, raw: rawValue, metadata: publicStructure });
    } catch (error) {
      setOutputMessage(output, "Operation rejected", error instanceof Error ? error.message : String(error));
    } finally {
      binaryArtifact?.fill(0);
      restored?.fill(0);
      plaintext.fill(0);
      setBusy(runButton, false, "Run round trip");
    }
  });

  window.addEventListener("pagehide", clearKey, { once: true });
  updateUsage();
}

async function setupDeckLab() {
  const lab = document.querySelector("[data-deck-lab]");
  if (!lab) return;

  const host = lab.querySelector("[data-deck-component-host]");
  const status = lab.querySelector("[data-deck-status]");
  const modalButton = lab.querySelector("[data-deck-modal]");
  const shuffleButton = lab.querySelector("[data-deck-shuffle]");
  let client;
  let inlineUI;
  let modalUI;
  let activeTheme = "plain";
  let currentDeck = [];
  let mountGeneration = 0;

  const themeNotes = {
    plain: "All 52 positions at once: the sensible default integration.",
    editorial: "The same ordered deck dealt into four physical 13-card hands.",
    signal: "A four-ring visualization paired with an exact, selectable 01–52 order reader.",
    dealer: "A green-felt table that deals the exact order across four readable player lanes.",
    spiral: "A numbered permutation spirals from the stable root outward to position 52.",
    timeline: "The full order becomes a horizontal inspection tape with four indexed chapters.",
    vault: "Four independently readable 13-card dials surround the stable-root lock.",
    cascade: "Four vertical, overlapping runs expose the deck like a physical card waterfall.",
    map: "The order becomes four transit lines with every card rendered as a readable station.",
    archive: "Thirteen archival trays hold four consecutive positions each for fast transcription.",
    wave: "All 52 cards ride one scrollable signal waveform without losing exact position labels.",
    constellation: "A spatial star map turns the permutation into a navigable field of 52 nodes.",
    folio: "Thirteen printable-style folios group four consecutive positions into physical spreads.",
  };
  const themeNames = {
    plain: "Order grid", editorial: "Four hands", signal: "Cipher orbit", dealer: "Dealer table", spiral: "Spiral index", timeline: "Order tape", vault: "Vault dial", cascade: "Cascade", map: "Route map", archive: "Archive", wave: "Signal wave", constellation: "Constellation", folio: "Folio",
  };

  const labels = {
    title: "Recovery Deck",
    description: "Demo only. Select a card and then its destination to move it.",
    warning: "Do not use this displayed order as a real recovery credential.",
    reorderHint: "Drag, click two positions, or use the arrow keys.",
    shuffle: "Secure shuffle",
    shuffling: "Shuffling securely…",
    confirm: "Confirm demo",
    close: "Close preview",
  };

  function appendTextParts(parent, parts) {
    parts.forEach(([tagName, value]) => {
      const element = document.createElement(tagName);
      element.textContent = value;
      parent.append(element);
    });
  }

  function renderCardContent(card, state, documentRef) {
    if (!["editorial", "signal"].includes(activeTheme)) return null;
    const art = documentRef.createElement("span");
    art.className = `deck-card-art deck-card-art--${activeTheme}`;
    art.style.setProperty("--deck-index", String(state.position));

    if (activeTheme === "editorial") {
      const folio = documentRef.createElement("span");
      folio.className = "deck-card-art__folio";
      folio.textContent = String(state.position + 1).padStart(2, "0");
      const rank = documentRef.createElement("strong");
      rank.className = "deck-card-art__rank";
      rank.textContent = card.rank;
      const suit = documentRef.createElement("span");
      suit.className = "deck-card-art__suit";
      suit.textContent = card.suitSymbol;
      const name = documentRef.createElement("span");
      name.className = "deck-card-art__name";
      name.textContent = card.suitName;
      art.append(folio, rank, suit, name);
    } else {
      const address = documentRef.createElement("span");
      address.className = "deck-card-art__address";
      address.textContent = `${String(state.position + 1).padStart(2, "0")} / ${card.id}`;
      const sigil = documentRef.createElement("strong");
      sigil.className = "deck-card-art__sigil";
      sigil.textContent = card.suitSymbol;
      const rank = documentRef.createElement("span");
      rank.className = "deck-card-art__signal-rank";
      rank.textContent = card.rankName.toUpperCase();
      art.append(address, sigil, rank);
    }
    return art;
  }

  function replaceCurrentDeck(deck) {
    currentDeck.fill("");
    currentDeck = [...deck];
  }

  function decorateLayout(root) {
    if (!root) return;
    const panel = root.querySelector(".voideddev-recovery-panel");
    const grid = root.querySelector(".voideddev-recovery-deck-grid");
    const actions = root.querySelector(".voideddev-recovery-actions");
    if (!panel || !grid || !actions) return;

    const cards = [...grid.querySelectorAll(":scope > .voideddev-recovery-card")];
    if (cards.length !== 52) return;
    panel.insertBefore(actions, grid);
    grid.dataset.deckLayout = activeTheme;
    if (!grid.dataset.deckRelayoutListener) {
      grid.dataset.deckRelayoutListener = "true";
      grid.addEventListener("click", () => queueMicrotask(() => decorateLayout(root)));
    }

    if (activeTheme === "editorial") {
      grid.replaceChildren();
      for (let handIndex = 0; handIndex < 4; handIndex += 1) {
        const hand = document.createElement("section");
        hand.className = "deck-hand";
        hand.setAttribute("aria-label", `Hand ${handIndex + 1}, positions ${handIndex * 13 + 1} through ${handIndex * 13 + 13}`);
        const heading = document.createElement("header");
        const name = document.createElement("strong");
        name.textContent = `HAND ${String(handIndex + 1).padStart(2, "0")}`;
        const range = document.createElement("span");
        range.textContent = `${String(handIndex * 13 + 1).padStart(2, "0")}—${String(handIndex * 13 + 13).padStart(2, "0")}`;
        const fan = document.createElement("div");
        fan.className = "deck-hand__fan";
        heading.append(name, range);
        for (const [cardIndex, card] of cards.slice(handIndex * 13, handIndex * 13 + 13).entries()) {
          card.style.setProperty("--fan-x", `${(cardIndex - 6) * 23}px`);
          card.style.setProperty("--fan-x-mobile", `${(cardIndex - 6) * 16}px`);
          card.style.setProperty("--fan-angle", `${(cardIndex - 6) * 3.1}deg`);
          card.style.setProperty("--fan-depth", String(cardIndex + 1));
          fan.append(card);
        }
        hand.append(heading, fan);
        grid.append(hand);
      }
    } else if (activeTheme === "signal") {
      grid.replaceChildren();
      const orbit = document.createElement("div");
      orbit.className = "cipher-orbit";
      const core = document.createElement("div");
      core.className = "cipher-core";
      core.setAttribute("aria-hidden", "true");
      const count = document.createElement("strong");
      count.textContent = "52";
      const label = document.createElement("span");
      label.textContent = "ORDER LOCKED";
      core.append(count, label);
      orbit.append(core);
      for (let ringIndex = 0; ringIndex < 4; ringIndex += 1) {
        const ring = document.createElement("div");
        ring.className = `cipher-ring cipher-ring--${ringIndex + 1}`;
        ring.setAttribute("role", "group");
        ring.setAttribute("aria-label", `Cipher ring ${ringIndex + 1}, positions ${ringIndex * 13 + 1} through ${ringIndex * 13 + 13}`);
        for (const [cardIndex, card] of cards.slice(ringIndex * 13, ringIndex * 13 + 13).entries()) {
          const angle = cardIndex * (360 / 13);
          card.style.setProperty("--orbit-angle", `${angle}deg`);
          card.style.setProperty("--orbit-counter", `${-angle}deg`);
          card.style.setProperty("--orbit-delay", `${-(cardIndex * 0.18)}s`);
          ring.append(card);
        }
        orbit.append(ring);
      }

      const reader = document.createElement("aside");
      reader.className = "cipher-reader";
      reader.setAttribute("aria-label", "Readable Recovery Deck order");
      const readerHeader = document.createElement("header");
      const readerHeading = document.createElement("strong");
      readerHeading.textContent = "EXACT ORDER";
      const readerHint = document.createElement("span");
      readerHint.textContent = "SELECT ANY POSITION";
      readerHeader.append(readerHeading, readerHint);

      const readerFocus = document.createElement("div");
      readerFocus.className = "cipher-reader__focus";
      readerFocus.setAttribute("aria-live", "polite");
      const readerPosition = document.createElement("span");
      readerPosition.className = "cipher-reader__position";
      const readerName = document.createElement("strong");
      readerName.className = "cipher-reader__name";
      const readerMark = document.createElement("span");
      readerMark.className = "cipher-reader__mark";
      const readerId = document.createElement("code");
      readerId.className = "cipher-reader__id";
      readerFocus.append(readerPosition, readerName, readerMark, readerId);

      const order = document.createElement("ol");
      order.className = "cipher-reader__order";
      const orderButtons = [];
      const suitSymbols = { S: "♠", H: "♥", D: "♦", C: "♣" };
      const readCard = (card, index) => {
        const cardId = card.dataset.voideddevCardId;
        const cardName = card.getAttribute("aria-label")?.replace(/^Position \d+:\s*/, "") ?? cardId;
        const color = card.dataset.voideddevColor;
        readerFocus.dataset.color = color;
        readerPosition.textContent = `POSITION ${String(index + 1).padStart(2, "0")} / 52`;
        readerName.textContent = cardName;
        readerMark.textContent = suitSymbols[card.dataset.voideddevSuit] ?? "";
        readerId.textContent = cardId;
        orderButtons.forEach((button, buttonIndex) => button.setAttribute("aria-pressed", String(buttonIndex === index)));
      };

      cards.forEach((card, index) => {
        const cardId = card.dataset.voideddevCardId;
        const cardName = card.getAttribute("aria-label")?.replace(/^Position \d+:\s*/, "") ?? cardId;
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.color = card.dataset.voideddevColor;
        button.setAttribute("aria-label", `Position ${index + 1}: ${cardName}`);
        button.setAttribute("aria-pressed", "false");
        const position = document.createElement("span");
        position.textContent = String(index + 1).padStart(2, "0");
        const identifier = document.createElement("strong");
        identifier.textContent = cardId;
        button.append(position, identifier);
        button.addEventListener("click", () => {
          readCard(card, index);
          card.focus({ preventScroll: true });
        });
        card.addEventListener("focus", () => readCard(card, index));
        card.addEventListener("pointerenter", () => readCard(card, index), { passive: true });
        item.append(button);
        order.append(item);
        orderButtons.push(button);
      });

      const readerNote = document.createElement("p");
      readerNote.textContent = "Every position remains readable without exporting or persisting the recovery order.";
      reader.append(readerHeader, readerFocus, order, readerNote);
      grid.append(orbit, reader);
      readCard(cards[0], 0);
    } else if (activeTheme === "dealer") {
      grid.replaceChildren();
      const table = document.createElement("div");
      table.className = "deck-dealer-table";
      const shoe = document.createElement("div");
      shoe.className = "deck-dealer-shoe";
      appendTextParts(shoe, [["strong", "52"], ["span", "SECURE DEAL"]]);
      table.append(shoe);
      for (let laneIndex = 0; laneIndex < 4; laneIndex += 1) {
        const lane = document.createElement("section");
        lane.className = "deck-dealer-lane";
        const heading = document.createElement("header");
        heading.textContent = `PLAYER ${laneIndex + 1} · ${String(laneIndex * 13 + 1).padStart(2, "0")}—${String(laneIndex * 13 + 13).padStart(2, "0")}`;
        const cardsHost = document.createElement("div");
        cardsHost.className = "deck-dealer-cards";
        cards.slice(laneIndex * 13, laneIndex * 13 + 13).forEach((card, index) => {
          card.style.setProperty("--lane-index", String(index));
          cardsHost.append(card);
        });
        lane.append(heading, cardsHost);
        table.append(lane);
      }
      grid.append(table);
    } else if (activeTheme === "spiral") {
      grid.replaceChildren();
      const stage = document.createElement("div");
      stage.className = "deck-spiral-stage";
      const core = document.createElement("div");
      core.className = "deck-spiral-core";
      appendTextParts(core, [["strong", "ROOT"], ["span", "01 → 52"]]);
      stage.append(core);
      cards.forEach((card, index) => {
        const angle = index * 0.73 - Math.PI / 2;
        const radius = 7 + index * 0.78;
        card.style.setProperty("--spiral-left", `${50 + Math.cos(angle) * radius}%`);
        card.style.setProperty("--spiral-top", `${50 + Math.sin(angle) * radius}%`);
        card.style.setProperty("--spiral-angle", `${angle * 57.2958 + 90}deg`);
        card.style.setProperty("--order-index", String(index));
        stage.append(card);
      });
      grid.append(stage);
    } else if (activeTheme === "timeline") {
      grid.replaceChildren();
      const viewport = document.createElement("div");
      viewport.className = "deck-order-tape";
      const track = document.createElement("div");
      track.className = "deck-order-tape__track";
      cards.forEach((card, index) => {
        if (index % 13 === 0) {
          const marker = document.createElement("span");
          marker.className = "deck-order-tape__marker";
          marker.textContent = `CHAPTER ${index / 13 + 1}`;
          track.append(marker);
        }
        card.style.setProperty("--order-index", String(index));
        track.append(card);
      });
      viewport.append(track);
      grid.append(viewport);
    } else if (activeTheme === "vault") {
      grid.replaceChildren();
      const dial = document.createElement("div");
      dial.className = "deck-vault-dial";
      const lock = document.createElement("div");
      lock.className = "deck-vault-lock";
      appendTextParts(lock, [["span", "RECOVERY"], ["strong", "52"], ["span", "POSITIONS"]]);
      dial.append(lock);
      for (let ringIndex = 0; ringIndex < 4; ringIndex += 1) {
        const ring = document.createElement("section");
        ring.className = `deck-vault-ring deck-vault-ring--${ringIndex + 1}`;
        ring.setAttribute("aria-label", `Vault dial ${ringIndex + 1}`);
        cards.slice(ringIndex * 13, ringIndex * 13 + 13).forEach((card, index) => {
          const angle = index * (360 / 13);
          card.style.setProperty("--dial-angle", `${angle}deg`);
          card.style.setProperty("--dial-counter", `${-angle}deg`);
          ring.append(card);
        });
        dial.append(ring);
      }
      grid.append(dial);
    } else if (activeTheme === "cascade") {
      grid.replaceChildren();
      const cascade = document.createElement("div");
      cascade.className = "deck-cascade";
      for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
        const column = document.createElement("section");
        column.className = "deck-cascade-column";
        const heading = document.createElement("header");
        heading.textContent = `${String(columnIndex * 13 + 1).padStart(2, "0")}—${String(columnIndex * 13 + 13).padStart(2, "0")}`;
        const stack = document.createElement("div");
        stack.className = "deck-cascade-stack";
        cards.slice(columnIndex * 13, columnIndex * 13 + 13).forEach((card, index) => {
          card.style.setProperty("--cascade-index", String(index));
          stack.append(card);
        });
        column.append(heading, stack);
        cascade.append(column);
      }
      grid.append(cascade);
    } else if (activeTheme === "map") {
      grid.replaceChildren();
      const routeMap = document.createElement("div");
      routeMap.className = "deck-route-map";
      ["NORTH", "EAST", "SOUTH", "WEST"].forEach((name, lineIndex) => {
        const route = document.createElement("section");
        route.className = `deck-route deck-route--${lineIndex + 1}`;
        const heading = document.createElement("header");
        appendTextParts(heading, [["strong", `${name} LINE`], ["span", `${String(lineIndex * 13 + 1).padStart(2, "0")}—${String(lineIndex * 13 + 13).padStart(2, "0")}`]]);
        const stations = document.createElement("div");
        stations.className = "deck-route__stations";
        cards.slice(lineIndex * 13, lineIndex * 13 + 13).forEach((card) => stations.append(card));
        route.append(heading, stations);
        routeMap.append(route);
      });
      grid.append(routeMap);
    } else if (activeTheme === "archive") {
      grid.replaceChildren();
      const archive = document.createElement("div");
      archive.className = "deck-archive";
      for (let trayIndex = 0; trayIndex < 13; trayIndex += 1) {
        const tray = document.createElement("section");
        tray.className = "deck-archive-tray";
        const label = document.createElement("span");
        label.textContent = `TRAY ${String(trayIndex + 1).padStart(2, "0")}`;
        tray.append(label);
        cards.slice(trayIndex * 4, trayIndex * 4 + 4).forEach((card) => tray.append(card));
        archive.append(tray);
      }
      grid.append(archive);
    } else if (activeTheme === "wave") {
      grid.replaceChildren();
      const viewport = document.createElement("div");
      viewport.className = "deck-wave-viewport";
      const wave = document.createElement("div");
      wave.className = "deck-wave";
      cards.forEach((card, index) => {
        card.style.setProperty("--wave-x", `${index * 74}px`);
        card.style.setProperty("--wave-y", `${88 + Math.sin(index * 0.58) * 65}px`);
        card.style.setProperty("--wave-angle", `${Math.cos(index * 0.58) * 15}deg`);
        wave.append(card);
      });
      viewport.append(wave);
      grid.append(viewport);
    } else if (activeTheme === "constellation") {
      grid.replaceChildren();
      const sky = document.createElement("div");
      sky.className = "deck-constellation";
      cards.forEach((card, index) => {
        const x = 4 + ((index * 37) % 92);
        const y = 7 + ((index * 53) % 84);
        card.style.setProperty("--star-x", `${x}%`);
        card.style.setProperty("--star-y", `${y}%`);
        card.style.setProperty("--star-delay", `${-(index * 0.11)}s`);
        sky.append(card);
      });
      grid.append(sky);
    } else if (activeTheme === "folio") {
      grid.replaceChildren();
      const folios = document.createElement("div");
      folios.className = "deck-folios";
      for (let pageIndex = 0; pageIndex < 13; pageIndex += 1) {
        const page = document.createElement("section");
        page.className = "deck-folio";
        const heading = document.createElement("header");
        appendTextParts(heading, [["span", "RECOVERY DECK"], ["strong", `FOLIO ${String(pageIndex + 1).padStart(2, "0")}`]]);
        const pageCards = document.createElement("div");
        pageCards.className = "deck-folio__cards";
        cards.slice(pageIndex * 4, pageIndex * 4 + 4).forEach((card) => pageCards.append(card));
        page.append(heading, pageCards);
        folios.append(page);
      }
      grid.append(folios);
    }
  }

  function decorateAllLayouts() {
    decorateLayout(host.querySelector(".site-recovery-ui"));
    document.querySelectorAll(".site-recovery-ui.voideddev-recovery-overlay").forEach(decorateLayout);
  }

  async function secureShuffle() {
    const roots = [...document.querySelectorAll(".site-recovery-ui")];
    roots.forEach((root) => root.classList.add("is-secure-shuffling"));
    shuffleButton.disabled = true;
    shuffleButton.textContent = activeTheme === "editorial" || activeTheme === "dealer" ? "Collecting + dealing…" : ["signal", "vault", "spiral"].includes(activeTheme) ? "Reindexing layout…" : "Shuffling securely…";
    status.textContent = "Generating a completely fresh CSPRNG permutation…";
    try {
      await new Promise((resolve) => setTimeout(resolve, 820));
      return await client.generateRecoveryDeck();
    } finally {
      roots.forEach((root) => root.classList.remove("is-secure-shuffling"));
      shuffleButton.disabled = false;
      shuffleButton.textContent = "Secure shuffle";
    }
  }

  function createUI() {
    return client.createRecoveryDeckUI({
      deck: currentDeck,
      injectDefaultStyles: false,
      rootClassName: `site-recovery-ui site-recovery-ui--${activeTheme}`,
      labels,
      shuffleDeck: secureShuffle,
      renderCardContent,
      onChange: (deck, reason) => {
        replaceCurrentDeck(deck);
        queueMicrotask(decorateAllLayouts);
        status.textContent = reason === "shuffle" ? "Fresh secure deck generated, animated, and dealt by the same component." : "Card moved; the custom presentation rebuilt without changing the deck model.";
      },
      onConfirm: () => {
        status.textContent = "Demo confirmed. A real setup would derive a transient Recovery Key and wrap the stable root.";
      },
      onClose: () => {
        modalUI = null;
      },
      onError: (error) => {
        status.textContent = `Recovery Deck UI error: ${error instanceof Error ? error.message : String(error)}`;
      },
    });
  }

  async function mountInlineTheme() {
    const generation = ++mountGeneration;
    inlineUI?.destroy();
    const nextUI = createUI();
    await nextUI.mount(host);
    if (generation !== mountGeneration) {
      nextUI.destroy();
      return;
    }
    inlineUI = nextUI;
    decorateLayout(host.querySelector(".site-recovery-ui"));
  }

  try {
    client = await loadClient();
    currentDeck = await client.generateRecoveryDeck();
    await mountInlineTheme();
    modalButton.disabled = false;
    shuffleButton.disabled = false;
    status.textContent = "Generic component mounted as a complete 52-position order grid.";
  } catch (error) {
    status.textContent = `Recovery Deck UI unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }

  lab.querySelectorAll("button[data-deck-theme]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.dataset.deckTheme === activeTheme) return;
      activeTheme = button.dataset.deckTheme;
      host.dataset.deckAppearance = activeTheme;
      const themeButtons = [...lab.querySelectorAll("button[data-deck-theme]")];
      themeButtons.forEach((candidate) => {
        candidate.disabled = true;
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      lab.querySelector("[data-deck-theme-note]").textContent = themeNotes[activeTheme];
      status.textContent = `Building the ${themeNames[activeTheme]} design…`;
      try {
        await mountInlineTheme();
        status.textContent = `${themeNames[activeTheme]} rebuilt from the same 52-card component and current deck order.`;
      } catch (error) {
        status.textContent = `Could not apply the design: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        themeButtons.forEach((candidate) => { candidate.disabled = false; });
      }
    });
  });

  modalButton.addEventListener("click", async () => {
    modalUI?.destroy();
    modalUI = createUI();
    await modalUI.show();
    decorateAllLayouts();
  });

  shuffleButton.addEventListener("click", () => {
    host.querySelector(".voideddev-recovery-shuffle")?.click();
  });

  window.addEventListener("pagehide", () => {
    inlineUI?.destroy();
    modalUI?.destroy();
  }, { once: true });
}

setupFunctionLab();
void setupDeckLab();
