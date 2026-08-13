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
  const artifactPanel = lab.querySelector("[data-lab-artifact-panel]");
  const artifactLabel = lab.querySelector("[data-lab-artifact-label]");
  const artifactRaw = lab.querySelector("[data-lab-artifact-raw]");
  let key = null;
  let operation = "protect";

  function updateUsage() {
    const setup = `const plaintext = new TextEncoder().encode(${JSON.stringify(input.value)});\nconst key = /* 32-byte Uint8Array shown above */;`;
    if (operation === "protect") {
      usage.textContent = `${setup}\n\nconst { artifact } = voided.protect(\n  plaintext, key, ${JSON.stringify(preset.value)},\n  undefined, undefined, "xchacha20-poly1305"\n);\nconst restored = voided.open(artifact, key);`;
    } else if (operation === "fuse") {
      usage.textContent = `${setup}\n\nconst fused = voided.fuse(plaintext, key, ${JSON.stringify(preset.value)});\nconst restored = voided.unfuse(fused, key);`;
    } else {
      usage.textContent = `${setup}\n\nconst encrypted = voided.encrypt(\n  plaintext, key, "xchacha20-poly1305"\n);\nconst restored = voided.decrypt(encrypted, key);`;
    }
  }

  function clearArtifact() {
    artifactPanel.hidden = true;
    artifactRaw.textContent = "";
  }

  function showArtifact(label, value) {
    artifactLabel.textContent = label;
    artifactRaw.textContent = value;
    artifactPanel.hidden = false;
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
      clearArtifact();
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
      clearArtifact();
      updateUsage();
      setOutputMessage(output, "", operation === "protect" ? "Creates a complete VOF3 artifact, then opens it." : operation === "fuse" ? "Applies and reverses the authenticated Fuse shell." : "Runs the lower-level AEAD primitive and verifies the result.");
    });
  });

  input.addEventListener("input", updateUsage);
  preset.addEventListener("change", () => {
    clearArtifact();
    updateUsage();
  });

  runButton.addEventListener("click", async () => {
    if (!key) return;
    const plaintext = encoder.encode(input.value);
    let binaryArtifact;
    let restored;
    setBusy(runButton, true, "Run round trip");
    clearArtifact();
    setOutputMessage(output, "", "Running locally…");
    try {
      const wasm = await loadWasm();
      let result;
      let rawLabel;
      let rawValue;
      if (operation === "protect") {
        const protectedResult = wasm.protect(plaintext, key, preset.value, undefined, undefined, "xchacha20-poly1305", undefined);
        binaryArtifact = protectedResult.artifact;
        restored = wasm.open(protectedResult.artifact, key);
        const info = wasm.inspectArtifact(protectedResult.artifact);
        rawLabel = "Full VOF3 artifact · Base64";
        rawValue = bytesToBase64(protectedResult.artifact);
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
        rawLabel = "Full fused payload · Base64";
        rawValue = bytesToBase64(fused);
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
      showArtifact(rawLabel, rawValue);
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
  let client;
  let inlineUI;
  let modalUI;
  let activeTheme = "plain";
  let currentDeck = [];
  let mountGeneration = 0;

  const themeNotes = {
    plain: "Quiet utility grid. The host owns every visual decision.",
    editorial: "A kinetic paper spread with oversized marks and a dealt-card entrance.",
    signal: "A dense neon cipher board with luminous suits and an active scan line.",
  };

  const labels = {
    title: "Recovery Deck",
    description: "Demo only. Select a card and then its destination to move it.",
    warning: "Do not use this displayed order as a real recovery credential.",
    reorderHint: "Drag, click two positions, or use the arrow keys.",
    shuffle: "New secure deck",
    shuffling: "Generating…",
    confirm: "Confirm demo",
    close: "Close preview",
  };

  function renderCardContent(card, state, documentRef) {
    if (activeTheme === "plain") return null;
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

  function createUI() {
    return client.createRecoveryDeckUI({
      deck: currentDeck,
      injectDefaultStyles: false,
      rootClassName: `site-recovery-ui site-recovery-ui--${activeTheme}`,
      labels,
      renderCardContent,
      onChange: (deck, reason) => {
        replaceCurrentDeck(deck);
        status.textContent = reason === "shuffle" ? "Fresh secure deck generated by the shipped component." : "Card moved by the shipped component.";
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
  }

  try {
    client = await loadClient();
    currentDeck = await client.generateRecoveryDeck();
    await mountInlineTheme();
    modalButton.disabled = false;
    status.textContent = "Generic component mounted inline with the System design.";
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
      status.textContent = `Building the ${button.textContent} design…`;
      try {
        await mountInlineTheme();
        status.textContent = `${button.textContent} rebuilt through public class and card-rendering hooks.`;
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
  });

  window.addEventListener("pagehide", () => {
    inlineUI?.destroy();
    modalUI?.destroy();
  }, { once: true });
}

setupFunctionLab();
void setupDeckLab();
