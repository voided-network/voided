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
  const generateButton = lab.querySelector("[data-lab-generate-key]");
  const runButton = lab.querySelector("[data-lab-run]");
  const input = lab.querySelector("[data-lab-input]");
  const preset = lab.querySelector("[data-lab-preset]");
  const output = lab.querySelector("[data-lab-output]");
  let key = null;
  let operation = "protect";

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
      keyStatus.textContent = "32 bytes · generated locally";
      runtime.textContent = "Rust/WASM ready";
      runButton.disabled = false;
      setOutputMessage(output, "", "Key generated locally. Choose a function and run it.");
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
      setOutputMessage(output, "", operation === "protect" ? "Creates a complete VOF3 artifact, then opens it." : operation === "fuse" ? "Applies and reverses the authenticated Fuse shell." : "Runs the lower-level AEAD primitive and verifies the result.");
    });
  });

  runButton.addEventListener("click", async () => {
    if (!key) return;
    const plaintext = encoder.encode(input.value);
    setBusy(runButton, true, "Run round trip");
    setOutputMessage(output, "", "Running locally…");
    try {
      const wasm = await loadWasm();
      let restored;
      let result;
      if (operation === "protect") {
        const protectedResult = wasm.protect(plaintext, key, preset.value, undefined, undefined, "xchacha20-poly1305", undefined);
        restored = wasm.open(protectedResult.artifact, key);
        const info = wasm.inspectArtifact(protectedResult.artifact);
        result = {
          Function: "protect → open",
          Format: `VOF${info.version}`,
          Preset: info.preset,
          Input: `${plaintext.length} bytes`,
          Artifact: `${protectedResult.artifact.length} bytes`,
        };
        protectedResult.artifact.fill(0);
      } else if (operation === "fuse") {
        const fused = wasm.fuse(plaintext, key, preset.value, undefined);
        restored = wasm.unfuse(fused, key);
        result = {
          Function: "fuse → unfuse",
          Preset: preset.value,
          Input: `${plaintext.length} bytes`,
          Fused: `${fused.length} bytes`,
        };
        fused.fill(0);
      } else {
        const encrypted = wasm.encrypt(plaintext, key, "xchacha20-poly1305");
        restored = wasm.decrypt(encrypted, key);
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
      restored.fill(0);
    } catch (error) {
      setOutputMessage(output, "Operation rejected", error instanceof Error ? error.message : String(error));
    } finally {
      plaintext.fill(0);
      setBusy(runButton, false, "Run round trip");
    }
  });

  window.addEventListener("pagehide", clearKey, { once: true });
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

  function createUI() {
    return client.createRecoveryDeckUI({
      injectDefaultStyles: false,
      rootClassName: `site-recovery-ui site-recovery-ui--${activeTheme}`,
      labels,
      onChange: (_deck, reason) => {
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

  try {
    client = await loadClient();
    inlineUI = createUI();
    await inlineUI.mount(host);
    modalButton.disabled = false;
    status.textContent = "Generic component mounted inline with the plain theme.";
  } catch (error) {
    status.textContent = `Recovery Deck UI unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }

  lab.querySelectorAll("button[data-deck-theme]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTheme = button.dataset.deckTheme;
      host.dataset.deckAppearance = activeTheme;
      lab.querySelectorAll("button[data-deck-theme]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      status.textContent = `${button.textContent} theme applied through the component’s public class hooks.`;
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
