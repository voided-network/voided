const encoder = new TextEncoder();
const decoder = new TextDecoder();

let wasmPromise;

function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = import("../runtime/voided_wasm.js").then(async (module) => {
      await module.default({ module_or_path: new URL("../runtime/voided_wasm_bg.wasm", import.meta.url) });
      return module;
    });
  }
  return wasmPromise;
}

function bytesToHex(bytes, separator = "") {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(separator);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function setBusy(button, busy, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? "Working locally…" : idleLabel;
}

function setupByteLab() {
  const lab = document.querySelector("[data-byte-lab]");
  if (!lab) return;

  const input = lab.querySelector("[data-byte-input]");
  const text = lab.querySelector("[data-byte-text]");
  const hex = lab.querySelector("[data-byte-hex]");
  const decimal = lab.querySelector("[data-byte-decimal]");
  const count = lab.querySelector("[data-byte-count]");
  const strip = lab.querySelector("[data-byte-strip]");

  function render() {
    const bytes = encoder.encode(input.value);
    text.textContent = input.value || "(empty)";
    hex.textContent = bytes.length ? bytesToHex(bytes, " ") : "—";
    decimal.textContent = bytes.length ? [...bytes].join(" ") : "—";
    count.textContent = String(bytes.length);
    strip.replaceChildren();
    for (const [index, byte] of bytes.entries()) {
      const cell = document.createElement("span");
      const position = document.createElement("small");
      const value = document.createElement("strong");
      const binary = document.createElement("code");
      position.textContent = String(index + 1).padStart(2, "0");
      value.textContent = byte.toString(16).padStart(2, "0");
      binary.textContent = byte.toString(2).padStart(8, "0");
      cell.append(position, value, binary);
      strip.append(cell);
    }
  }

  input.addEventListener("input", render);
  render();
}

function setupTransformLab() {
  const lab = document.querySelector("[data-transform-lab]");
  if (!lab) return;

  const input = lab.querySelector("[data-transform-input]");
  const base64 = lab.querySelector("[data-transform-base64]");
  const decoded = lab.querySelector("[data-transform-decoded]");
  const hash = lab.querySelector("[data-transform-hash]");
  const cipher = lab.querySelector("[data-transform-cipher]");
  const restored = lab.querySelector("[data-transform-restored]");
  const decodeButton = lab.querySelector("[data-transform-decode]");
  const encryptButton = lab.querySelector("[data-transform-encrypt]");
  const openButton = lab.querySelector("[data-transform-open]");
  let updateSequence = 0;
  let key = null;
  let encrypted = null;

  function clearSecretState() {
    key?.fill(0);
    key = null;
    encrypted = null;
    openButton.disabled = true;
  }

  async function update() {
    const sequence = ++updateSequence;
    const bytes = encoder.encode(input.value);
    base64.textContent = bytesToBase64(bytes) || "(empty input)";
    decoded.textContent = "Select decode to reverse the Base64 representation.";
    hash.textContent = "Calculating…";
    clearSecretState();
    cipher.textContent = "Message changed. Generate a fresh key to encrypt it.";
    restored.textContent = "Runs locally in Voided’s Rust/WASM runtime.";
    try {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      if (sequence === updateSequence) hash.textContent = bytesToHex(digest);
    } catch (error) {
      if (sequence === updateSequence) hash.textContent = `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  decodeButton.addEventListener("click", () => {
    try {
      decoded.textContent = `Decoded: ${decoder.decode(base64ToBytes(base64.textContent))}`;
    } catch {
      decoded.textContent = "That value is not valid Base64.";
    }
  });

  encryptButton.addEventListener("click", async () => {
    setBusy(encryptButton, true, "Generate key + encrypt");
    restored.textContent = "Loading the verified Rust/WASM runtime…";
    try {
      const wasm = await loadWasm();
      clearSecretState();
      key = wasm.generateKey();
      encrypted = wasm.encrypt(encoder.encode(input.value), key, "xchacha20-poly1305");
      cipher.textContent = JSON.stringify(encrypted, null, 2);
      restored.textContent = "Protected with a fresh 256-bit key. The full encrypted result is shown above.";
      openButton.disabled = false;
    } catch (error) {
      cipher.textContent = "Encryption did not run.";
      restored.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(encryptButton, false, "Generate key + encrypt");
    }
  });

  openButton.addEventListener("click", async () => {
    if (!key || !encrypted) return;
    try {
      const wasm = await loadWasm();
      restored.textContent = `Opened with the matching key: ${decoder.decode(wasm.decrypt(encrypted, key))}`;
    } catch (error) {
      restored.textContent = `Open failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  input.addEventListener("input", update);
  window.addEventListener("pagehide", clearSecretState, { once: true });
  update();
}

function setupKeyModels() {
  const lab = document.querySelector("[data-key-model-lab]");
  if (!lab) return;

  lab.querySelectorAll("[data-key-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const model = button.dataset.keyModel;
      lab.querySelectorAll("[data-key-model]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      lab.querySelectorAll("[data-key-model-panel]").forEach((panel) => { panel.hidden = panel.dataset.keyModelPanel !== model; });
    });
  });

  const keyObject = lab.querySelector("[data-key-object]");
  const keyState = lab.querySelector("[data-key-state]");
  const keyExplanation = lab.querySelector("[data-key-explanation]");
  let locked = false;
  lab.querySelectorAll("[data-key-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.keyAction;
      if (action === "lock") {
        locked = true;
        keyObject.dataset.state = "locked";
        keyState.textContent = "LOCKED BY A";
        keyExplanation.textContent = "Key A turned readable data into ciphertext. Alice may now send the locked result through an untrusted path.";
      } else if (action === "wrong") {
        keyObject.dataset.state = "rejected";
        keyState.textContent = locked ? "KEY B REJECTED" : "NOTHING TO OPEN";
        keyExplanation.textContent = locked ? "Key B is the wrong secret. Authentication fails, so no plaintext is released." : "Lock the message first. An open message does not need a key.";
      } else {
        keyObject.dataset.state = "open";
        keyState.textContent = locked ? "OPENED BY A" : "ALREADY OPEN";
        keyExplanation.textContent = locked ? "The same secret Key A opened the message. That shared secret must stay private on both sides." : "The message is already readable.";
        locked = false;
      }
    });
  });

  const mailbox = lab.querySelector(".mailbox");
  const mailboxState = lab.querySelector("[data-mailbox-state]");
  const mailboxExplanation = lab.querySelector("[data-mailbox-explanation]");
  let sealed = false;
  lab.querySelectorAll("[data-mailbox-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.mailboxAction;
      if (action === "send") {
        sealed = true;
        mailbox.dataset.state = "sealed";
        mailboxState.textContent = "SEALED FOR BOB";
        mailboxExplanation.textContent = "The sender used Bob’s public key. Sharing that public key lets people protect messages for Bob; it does not let them read Bob’s messages.";
      } else if (action === "public") {
        mailbox.dataset.state = "rejected";
        mailboxState.textContent = sealed ? "PUBLIC KEY CANNOT OPEN" : "BOX IS EMPTY";
        mailboxExplanation.textContent = sealed ? "The public key can help seal this message, but it cannot reverse the operation. Bob’s private key is required." : "Seal a message first.";
      } else {
        mailbox.dataset.state = "open";
        mailboxState.textContent = sealed ? "OPENED BY BOB" : "BOX IS EMPTY";
        mailboxExplanation.textContent = sealed ? "Bob’s private key opened what his public key prepared. The private key never needed to travel to the sender." : "Seal a message first.";
        sealed = false;
      }
    });
  });
}

function setupJourneyLab() {
  const lab = document.querySelector("[data-journey-lab]");
  if (!lab) return;

  const stage = lab.querySelector(".journey-stage");
  const packet = lab.querySelector("[data-journey-packet]");
  const aliceView = lab.querySelector("[data-alice-view]");
  const serviceView = lab.querySelector("[data-service-view]");
  const serviceDetail = lab.querySelector("[data-service-detail]");
  const bobView = lab.querySelector("[data-bob-view]");
  const nextButton = lab.querySelector("[data-journey-next]");
  const caption = lab.querySelector("[data-journey-caption]");
  let mode = "e2ee";
  let step = 0;

  function render() {
    stage.dataset.journeyStage = String(step);
    stage.dataset.journeyMode = mode;
    if (mode === "e2ee") {
      const copy = [
        ["MESSAGE", "READABLE", "CIPHERTEXT ONLY", "WAITING", "Alice protects the message before it leaves her device.", "Send message"],
        ["CIPHERTEXT", "SENT", "CIPHERTEXT ONLY", "WAITING", "Only the locked representation crosses the first path.", "Advance through service"],
        ["CIPHERTEXT", "SENT", "CIPHERTEXT ONLY", "WAITING", "The service routes and may store ciphertext without receiving the reading key.", "Deliver to Bob"],
        ["MESSAGE", "SENT", "CIPHERTEXT ONLY", "READABLE", "Bob’s endpoint authenticates and opens the message locally.", "Reset journey"],
      ][step];
      [packet.textContent, aliceView.textContent, serviceView.textContent, bobView.textContent, caption.textContent, nextButton.textContent] = copy;
      serviceDetail.textContent = "moves and stores the locked box";
    } else {
      const copy = [
        ["MESSAGE", "READABLE", "WAITING", "WAITING", "Alice sends readable data to the service.", "Send message"],
        ["PLAINTEXT", "SENT", "READABLE HERE", "WAITING", "The service receives data it can read before forwarding it.", "Advance through service"],
        ["PLAINTEXT", "SENT", "READABLE HERE", "WAITING", "Transport encryption may protect each connection, while the service remains an endpoint with access.", "Deliver to Bob"],
        ["MESSAGE", "SENT", "READABLE HERE", "READABLE", "Bob receives the message, but the service was also able to read it.", "Reset journey"],
      ][step];
      [packet.textContent, aliceView.textContent, serviceView.textContent, bobView.textContent, caption.textContent, nextButton.textContent] = copy;
      serviceDetail.textContent = "processes readable content";
    }
  }

  lab.querySelectorAll("[data-journey-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.journeyMode;
      step = 0;
      lab.querySelectorAll("[data-journey-mode]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      render();
    });
  });
  nextButton.addEventListener("click", () => {
    step = step === 3 ? 0 : step + 1;
    render();
  });
  render();
}

function setupTamperLab() {
  const lab = document.querySelector("[data-tamper-lab]");
  if (!lab) return;

  const artifactOutput = lab.querySelector("[data-tamper-artifact]");
  const seal = lab.querySelector("[data-tamper-seal]");
  const result = lab.querySelector("[data-tamper-result]");
  const protectButton = lab.querySelector("[data-tamper-protect]");
  const flipButton = lab.querySelector("[data-tamper-flip]");
  const openButton = lab.querySelector("[data-tamper-open]");
  let key = null;
  let artifact = null;
  let tampered = false;

  function clearSecrets() {
    key?.fill(0);
    artifact?.fill(0);
    key = null;
    artifact = null;
  }

  protectButton.addEventListener("click", async () => {
    setBusy(protectButton, true, "Protect locally");
    result.textContent = "Loading the verified Rust/WASM runtime…";
    try {
      const wasm = await loadWasm();
      clearSecrets();
      key = wasm.generateKey();
      const protectedResult = wasm.protect(encoder.encode("Transfer 10 credits"), key, "balanced", undefined, undefined, "xchacha20-poly1305", undefined);
      artifact = protectedResult.artifact;
      tampered = false;
      artifactOutput.textContent = bytesToBase64(artifact);
      seal.textContent = "AUTHENTICATED SEAL INTACT";
      seal.dataset.state = "intact";
      result.textContent = `Protected locally as ${artifact.length} authenticated VOF3 bytes. The full artifact is shown above.`;
      flipButton.disabled = false;
      openButton.disabled = false;
    } catch (error) {
      artifactOutput.textContent = "Protection did not run.";
      result.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(protectButton, false, "Protect locally");
    }
  });

  flipButton.addEventListener("click", () => {
    if (!artifact || tampered) return;
    artifact[Math.floor(artifact.length / 2)] ^= 1;
    tampered = true;
    artifactOutput.textContent = bytesToBase64(artifact);
    seal.textContent = "ONE BYTE CHANGED";
    seal.dataset.state = "broken";
    result.textContent = "The artifact still looks like arbitrary data. Authentication must decide whether it is trustworthy.";
    flipButton.disabled = true;
  });

  openButton.addEventListener("click", async () => {
    if (!artifact || !key) return;
    try {
      const wasm = await loadWasm();
      const plaintext = wasm.open(artifact, key);
      result.textContent = `Authenticated and opened: ${decoder.decode(plaintext)}`;
      seal.textContent = "AUTHENTICATED";
      seal.dataset.state = "intact";
    } catch {
      result.textContent = "Authentication failed. No plaintext released.";
      seal.textContent = "REJECTED · SEAL BROKEN";
      seal.dataset.state = "broken";
    }
  });

  window.addEventListener("pagehide", clearSecrets, { once: true });
}

function setupKdfLab() {
  const lab = document.querySelector("[data-kdf-lab]");
  if (!lab) return;

  const password = lab.querySelector("[data-kdf-password]");
  const work = lab.querySelector("[data-kdf-work]");
  const workLabel = lab.querySelector("[data-kdf-work-label]");
  const passwordView = lab.querySelector("[data-kdf-password-view]");
  const saltView = lab.querySelector("[data-kdf-salt-view]");
  const workView = lab.querySelector("[data-kdf-work-view]");
  const output = lab.querySelector("[data-kdf-output]");
  const status = lab.querySelector("[data-kdf-status]");
  const runButton = lab.querySelector("[data-kdf-run]");
  const saltButton = lab.querySelector("[data-kdf-salt]");
  let salt = randomBytes(16);

  function updateInputs() {
    const rounds = Number(work.value).toLocaleString();
    passwordView.textContent = password.value || "(empty)";
    workLabel.textContent = `${rounds} rounds`;
    workView.textContent = rounds;
    output.textContent = "Run the derivation.";
  }

  function replaceSalt() {
    salt.fill(0);
    salt = randomBytes(16);
    saltView.textContent = bytesToHex(salt);
    output.textContent = "Run again with this salt.";
    status.textContent = "The password stayed the same; the random salt changed the derivation path.";
  }

  runButton.addEventListener("click", async () => {
    setBusy(runButton, true, "Derive 256 bits");
    const started = performance.now();
    try {
      const material = await crypto.subtle.importKey("raw", encoder.encode(password.value), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(work.value), hash: "SHA-256" }, material, 256);
      output.textContent = bytesToHex(new Uint8Array(bits));
      status.textContent = `Derived 256 bits locally in ${Math.max(1, Math.round(performance.now() - started))} ms. This is a teaching lab, not a password-policy recommendation.`;
    } catch (error) {
      output.textContent = "Derivation unavailable.";
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(runButton, false, "Derive 256 bits");
    }
  });

  password.addEventListener("input", updateInputs);
  work.addEventListener("input", updateInputs);
  saltButton.addEventListener("click", replaceSalt);
  saltView.textContent = bytesToHex(salt);
  updateInputs();
  window.addEventListener("pagehide", () => salt.fill(0), { once: true });
}

const quizExplanations = [
  "Correct: Base64 is reversible encoding. It has no secret key and provides no confidentiality.",
  "Correct: a cryptographic hash is deliberately sensitive to even a tiny input change.",
  "Correct: carrying ciphertext is different from holding the key that can read it.",
  "Correct: rotate the recovery wrapper around the stable root; application and data keys can remain unchanged.",
];

function setupKnowledgeCheck() {
  document.querySelectorAll("[data-question]").forEach((question, index) => {
    const output = question.querySelector("output");
    question.querySelectorAll("[data-quiz-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const correct = button.dataset.quizChoice === question.dataset.answer;
        question.querySelectorAll("[data-quiz-choice]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
        question.dataset.result = correct ? "correct" : "incorrect";
        output.textContent = correct ? quizExplanations[index] : "Not quite. Trace the job or trust boundary again, then retry.";
      });
    });
  });
}

setupByteLab();
setupTransformLab();
setupKeyModels();
setupJourneyLab();
setupTamperLab();
setupKdfLab();
setupKnowledgeCheck();
