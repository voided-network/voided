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

const fieldPalette = {
  ink: "#080a0b",
  raised: "#111719",
  paper: "#f1efe7",
  muted: "#6f7978",
  line: "rgba(241,239,231,.16)",
  signal: "#c7ff5e",
  signalSoft: "rgba(199,255,94,.32)",
  change: "#ff8b45",
  changeSoft: "rgba(255,139,69,.3)",
};

const courseReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function byteAt(bytes, index) {
  if (!bytes.length) return 0;
  return bytes[((index % bytes.length) + bytes.length) % bytes.length];
}

function createSignalCanvas(canvas, draw) {
  if (!canvas) return { render() {} };
  const context = canvas.getContext("2d", { alpha: false });
  let width = 1;
  let height = 1;
  let visible = true;
  let frame = 0;

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    draw(context, width, height, courseReducedMotion ? 0 : performance.now() / 1000);
  }

  function render() {
    draw(context, width, height, courseReducedMotion ? 0 : performance.now() / 1000);
  }

  function loop(timestamp) {
    if (visible) draw(context, width, height, timestamp / 1000);
    frame = requestAnimationFrame(loop);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && courseReducedMotion) render();
  }, { rootMargin: "180px" });
  visibilityObserver.observe(canvas);
  resize();
  if (!courseReducedMotion) frame = requestAnimationFrame(loop);
  window.addEventListener("pagehide", () => {
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    cancelAnimationFrame(frame);
  }, { once: true });
  return { render };
}

function drawFieldGrid(context, width, height, columns = 24, rows = 12) {
  context.strokeStyle = "rgba(199,255,94,.055)";
  context.lineWidth = 0.5;
  for (let column = 0; column <= columns; column += 1) {
    const x = (column / columns) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = (row / rows) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawMono(context, text, x, y, options = {}) {
  const { color = fieldPalette.paper, size = 9, align = "left", alpha = 1, weight = 500 } = options;
  context.save();
  context.fillStyle = color;
  context.globalAlpha = alpha;
  context.font = `${weight} ${size}px SFMono-Regular, Consolas, "Liberation Mono", monospace`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(text, x, y);
  context.restore();
}

function drawTerminalPanel(context, x, y, width, height, color = fieldPalette.signal) {
  context.fillStyle = "rgba(7,12,12,.82)";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(241,239,231,.15)";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.fillStyle = color;
  context.fillRect(x, y, Math.min(width, 42), 2);
}

function drawStatusLamp(context, x, y, color, active = true) {
  context.save();
  context.fillStyle = color;
  context.globalAlpha = active ? 1 : 0.25;
  context.shadowColor = color;
  context.shadowBlur = active ? 10 : 0;
  context.beginPath();
  context.arc(x, y, 2.6, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawFlowPackets(context, fromX, toX, y, time, color, active = true, stop = 1) {
  context.strokeStyle = active ? "rgba(199,255,94,.32)" : "rgba(241,239,231,.1)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(fromX, y);
  context.lineTo(toX, y);
  context.stroke();
  if (!active) return;
  for (let index = 0; index < 7; index += 1) {
    const progress = Math.min(((time * 0.18 + index / 7) % 1), stop);
    const x = fromX + (toX - fromX) * progress;
    context.fillStyle = color;
    context.globalAlpha = 0.35 + progress * 0.65;
    context.fillRect(x - 2, y - 2, 4, 4);
  }
  context.globalAlpha = 1;
}

function drawMatrixColumn(context, bytes, x, top, bottom, column, time, color, faded = false) {
  const rowHeight = 18;
  const rows = Math.ceil((bottom - top) / rowHeight) + 2;
  const offset = (time * (16 + (column % 4) * 2) + column * 31) % rowHeight;
  for (let row = -1; row < rows; row += 1) {
    const index = row + column * 7 + Math.floor(time * 1.4);
    const byte = byteAt(bytes, index);
    const y = top + row * rowHeight + offset;
    const edgeFade = Math.min(1, (y - top) / 34, (bottom - y) / 34);
    drawMono(context, byte.toString(16).padStart(2, "0").toUpperCase(), x, y, {
      color,
      size: 8,
      alpha: Math.max(0, edgeFade) * (faded ? 0.18 : 0.42 + ((byte % 5) / 10)),
    });
  }
}

function drawKeyFingerprint(context, x, y, width, height, seed, color, label) {
  drawMono(context, label, x + width / 2, y - 14, { color: fieldPalette.muted, size: 8, align: "center" });
  context.strokeStyle = "rgba(241,239,231,.14)";
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  const bars = Math.max(6, Math.min(12, Math.floor(width / 11)));
  const gap = 3;
  const barWidth = Math.max(2, (width - 18 - gap * (bars - 1)) / bars);
  for (let index = 0; index < bars; index += 1) {
    const value = ((seed * (index + 11) + index * 47) ^ (seed >> (index % 5))) & 255;
    const barHeight = 12 + (value / 255) * (height - 30);
    context.fillStyle = color;
    context.globalAlpha = 0.32 + (value / 255) * 0.68;
    context.fillRect(x + 9 + index * (barWidth + gap), y + height - 9 - barHeight, barWidth, barHeight);
  }
  context.globalAlpha = 1;
}

function drawLock(context, x, y, size, color, closed) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.5, size * 0.035);
  context.strokeRect(x - size * 0.35, y - size * 0.05, size * 0.7, size * 0.55);
  context.beginPath();
  context.arc(x, y - size * 0.08, size * 0.23, Math.PI, closed ? Math.PI * 2 : Math.PI * 1.72);
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y + size * 0.16, size * 0.045, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawTransformField(context, width, height, time, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 30, 14);
  const pad = width < 600 ? 9 : 18;
  const gap = width < 600 ? 7 : 14;
  const top = width < 600 ? 38 : 46;
  const bottom = 30;
  const panelWidth = (width - pad * 2 - gap * 2) / 3;
  const panelHeight = height - top - bottom;
  const panels = [0, 1, 2].map((index) => ({ x: pad + index * (panelWidth + gap), y: top, width: panelWidth, height: panelHeight }));
  const encrypted = state.cipherBytes.length > 0;

  panels.forEach((panel, index) => drawTerminalPanel(context, panel.x, panel.y, panel.width, panel.height, index === 0 && !encrypted ? fieldPalette.change : fieldPalette.signal));

  const source = panels[0];
  context.save();
  context.beginPath();
  context.rect(source.x + 1, source.y + 1, source.width - 2, source.height - 2);
  context.clip();
  const sourceColumns = Math.max(2, Math.min(8, Math.floor(source.width / 34)));
  for (let column = 0; column < sourceColumns; column += 1) {
    drawMatrixColumn(context, state.bytes, source.x + 14 + column * ((source.width - 28) / sourceColumns), source.y + 20, source.y + source.height - 22, column, time, column % 3 === 0 ? fieldPalette.change : fieldPalette.paper);
  }
  const scanY = source.y + 20 + ((time * 28) % Math.max(1, source.height - 44));
  const sourceGradient = context.createLinearGradient(0, scanY - 24, 0, scanY + 4);
  sourceGradient.addColorStop(0, "rgba(255,139,69,0)");
  sourceGradient.addColorStop(1, "rgba(255,139,69,.17)");
  context.fillStyle = sourceGradient;
  context.fillRect(source.x, scanY - 24, source.width, 28);
  context.restore();
  drawMono(context, `${state.bytes.length} UTF-8 BYTES`, source.x + source.width / 2, source.y + source.height - 12, { color: fieldPalette.change, size: width < 600 ? 6.5 : 8, align: "center" });

  const hash = panels[1];
  const digestColumns = width < 600 ? 4 : 8;
  const digestRows = Math.ceil(32 / digestColumns);
  const digestGap = width < 600 ? 3 : 5;
  const digestCellWidth = (hash.width - 22 - digestGap * (digestColumns - 1)) / digestColumns;
  const digestCellHeight = Math.min(24, (hash.height - 82 - digestGap * (digestRows - 1)) / digestRows);
  const digestTop = hash.y + 42;
  for (let index = 0; index < 32; index += 1) {
    const column = index % digestColumns;
    const row = Math.floor(index / digestColumns);
    const x = hash.x + 11 + column * (digestCellWidth + digestGap);
    const y = digestTop + row * (digestCellHeight + digestGap);
    const byte = byteAt(state.digest, index);
    const pulse = (Math.floor(time * 5) + index) % 17 === 0;
    context.fillStyle = pulse ? "rgba(199,255,94,.34)" : `rgba(199,255,94,${0.05 + (byte / 255) * 0.12})`;
    context.fillRect(x, y, digestCellWidth, digestCellHeight);
    drawMono(context, byte.toString(16).padStart(2, "0").toUpperCase(), x + digestCellWidth / 2, y + digestCellHeight / 2, { color: fieldPalette.signal, size: width < 600 ? 6 : 8, align: "center", alpha: 0.72 });
  }
  drawMono(context, "SHA-256", hash.x + hash.width / 2, hash.y + 23, { color: fieldPalette.signal, size: width < 600 ? 7 : 10, align: "center", weight: 700 });
  drawMono(context, "FIXED 256-BIT DIGEST", hash.x + hash.width / 2, hash.y + hash.height - 12, { color: fieldPalette.muted, size: width < 600 ? 5.5 : 8, align: "center" });

  const cipher = panels[2];
  context.save();
  context.beginPath();
  context.rect(cipher.x + 1, cipher.y + 1, cipher.width - 2, cipher.height - 2);
  context.clip();
  const cipherBytes = encrypted ? state.cipherBytes : state.digest;
  const cipherColumns = Math.max(2, Math.min(8, Math.floor(cipher.width / 34)));
  for (let column = 0; column < cipherColumns; column += 1) {
    drawMatrixColumn(context, cipherBytes, cipher.x + 14 + column * ((cipher.width - 28) / cipherColumns), cipher.y + 20, cipher.y + cipher.height - 22, column + 9, time * 1.22, fieldPalette.signal, !encrypted);
  }
  context.restore();
  drawStatusLamp(context, cipher.x + 14, cipher.y + 19, encrypted ? fieldPalette.signal : fieldPalette.change, true);
  drawMono(context, encrypted ? "SEALED" : "AWAITING KEY", cipher.x + 23, cipher.y + 19, { color: encrypted ? fieldPalette.signal : fieldPalette.change, size: width < 600 ? 6 : 8 });
  drawMono(context, encrypted ? "XCHACHA20-POLY1305" : "NO CIPHERTEXT", cipher.x + cipher.width / 2, cipher.y + cipher.height - 12, { color: encrypted ? fieldPalette.signal : fieldPalette.muted, size: width < 600 ? 5.5 : 8, align: "center" });

  const wireY = top + panelHeight * 0.5;
  drawFlowPackets(context, source.x + source.width, hash.x, wireY, time, fieldPalette.change, true);
  drawFlowPackets(context, hash.x + hash.width, cipher.x, wireY, time, fieldPalette.signal, encrypted);
}

function drawKeyField(context, width, height, time, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 28, 12);
  const compact = width < 600;
  const y = height * 0.51;
  const fingerprintWidth = Math.max(72, width * (compact ? 0.23 : 0.2));
  const fingerprintHeight = Math.min(150, height * 0.42);
  const leftX = width * 0.15 - fingerprintWidth / 2;
  const rightX = width * 0.85 - fingerprintWidth / 2;
  const gateWidth = Math.max(76, width * (compact ? 0.22 : 0.18));
  const gateHeight = Math.min(160, height * 0.5);
  const gateX = width * 0.5 - gateWidth / 2;
  const gateY = y - gateHeight / 2;
  const isRejected = state.status === "rejected";
  const active = ["locked", "sealed", "open"].includes(state.status);
  const accent = isRejected ? fieldPalette.change : fieldPalette.signal;

  drawKeyFingerprint(context, leftX, y - fingerprintHeight / 2, fingerprintWidth, fingerprintHeight, state.model === "asymmetric" ? 0xb6 : 0xca, fieldPalette.signal, state.model === "asymmetric" ? "PUBLIC KEY" : "KEY A");
  drawKeyFingerprint(context, rightX, y - fingerprintHeight / 2, fingerprintWidth, fingerprintHeight, state.model === "asymmetric" ? 0x67 : isRejected ? 0x91 : 0xca, isRejected ? fieldPalette.change : fieldPalette.signal, state.model === "asymmetric" ? "PRIVATE KEY" : isRejected ? "KEY B" : "KEY A");

  drawTerminalPanel(context, gateX, gateY, gateWidth, gateHeight, accent);
  drawMono(context, "CIPHER GATE", width * 0.5, gateY + 18, { color: fieldPalette.muted, size: compact ? 6 : 8, align: "center" });
  drawLock(context, width * 0.5, y - 2, Math.min(62, gateHeight * 0.42), accent, state.status !== "open");
  drawMono(context, isRejected ? "DENIED" : state.status === "locked" || state.status === "sealed" ? "SEALED" : "AUTHORIZED", width * 0.5, gateY + gateHeight - 18, { color: accent, size: compact ? 6.5 : 9, align: "center", weight: 700 });

  const leftBus = leftX + fingerprintWidth;
  const rightBus = rightX;
  drawFlowPackets(context, leftBus, gateX, y, time, accent, active, 1);
  drawFlowPackets(context, gateX + gateWidth, rightBus, y, time, accent, active && !isRejected, 1);

  if (isRejected) {
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (ray / 8) * Math.PI * 2 + time * 0.5;
      context.beginPath();
      context.moveTo(gateX + gateWidth / 2, y);
      context.lineTo(gateX + gateWidth / 2 + Math.cos(angle) * (20 + ray * 2), y + Math.sin(angle) * (14 + ray));
      context.strokeStyle = fieldPalette.changeSoft;
      context.stroke();
    }
  }

  const status = isRejected
    ? "KEY MISMATCH · NO PLAINTEXT RELEASED"
    : state.status === "locked" ? "MATCHING SECRET REQUIRED TO OPEN"
      : state.status === "sealed" ? "PUBLIC KEY SEALED · PRIVATE KEY REQUIRED"
        : state.model === "asymmetric" ? "PUBLIC KEY LOCKS · PRIVATE KEY OPENS" : "MATCHING KEYS · ACCESS GRANTED";
  drawStatusLamp(context, width * 0.5 - Math.min(140, status.length * 3.2), height - 22, accent, true);
  drawMono(context, status, width * 0.5, height - 22, { color: accent, size: compact ? 6.2 : 9, align: "center" });
}

function drawJourneyField(context, width, height, time, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 32, 12);
  const compact = width < 600;
  const y = height * 0.52;
  const positions = [width * 0.12, width * 0.34, width * 0.5, width * 0.88];
  if (!Number.isFinite(state.position) || state.position <= 0) state.position = positions[state.step];
  state.position += (positions[state.step] - state.position) * 0.08;
  const routeColor = state.mode === "e2ee" ? fieldPalette.signal : fieldPalette.change;
  const endpointWidth = compact ? 58 : Math.min(150, width * 0.16);
  const endpointHeight = compact ? 104 : Math.min(180, height * 0.48);
  const endpointY = y - endpointHeight / 2;
  const serviceX = width * 0.5;
  const serviceWidth = compact ? 74 : Math.min(200, width * 0.2);
  const serviceHeight = compact ? 160 : Math.min(240, height * 0.62);
  const serviceY = y - serviceHeight / 2;

  drawTerminalPanel(context, width * 0.12 - endpointWidth / 2, endpointY, endpointWidth, endpointHeight, fieldPalette.signal);
  drawTerminalPanel(context, width * 0.88 - endpointWidth / 2, endpointY, endpointWidth, endpointHeight, fieldPalette.signal);
  drawTerminalPanel(context, serviceX - serviceWidth / 2, serviceY, serviceWidth, serviceHeight, routeColor);
  drawMono(context, "KEY", width * 0.12, endpointY + 18, { color: fieldPalette.signal, size: compact ? 7 : 9, align: "center", weight: 700 });
  drawMono(context, "KEY", width * 0.88, endpointY + 18, { color: fieldPalette.signal, size: compact ? 7 : 9, align: "center", weight: 700 });
  drawKeyFingerprint(context, width * 0.12 - endpointWidth * 0.3, y - endpointHeight * 0.18, endpointWidth * 0.6, endpointHeight * 0.38, 0x44, fieldPalette.signal, "");
  drawKeyFingerprint(context, width * 0.88 - endpointWidth * 0.3, y - endpointHeight * 0.18, endpointWidth * 0.6, endpointHeight * 0.38, 0x44, fieldPalette.signal, "");

  const rackTop = serviceY + 30;
  const rackRows = compact ? 6 : 8;
  for (let row = 0; row < rackRows; row += 1) {
    const rackY = rackTop + row * ((serviceHeight - 64) / rackRows);
    context.strokeStyle = "rgba(241,239,231,.12)";
    context.strokeRect(serviceX - serviceWidth * 0.36, rackY, serviceWidth * 0.72, 11);
    drawStatusLamp(context, serviceX - serviceWidth * 0.29, rackY + 5.5, row % 3 === 0 ? routeColor : fieldPalette.muted, true);
    drawMono(context, state.mode === "e2ee" ? byteAt(new Uint8Array([0xa3, 0x7c, 0x91, 0xef]), row).toString(16).padStart(2, "0").toUpperCase() : "TXT", serviceX + serviceWidth * 0.27, rackY + 5.5, { color: state.mode === "e2ee" ? fieldPalette.signal : fieldPalette.change, size: compact ? 5.5 : 7, align: "right", alpha: 0.72 });
  }
  drawMono(context, state.mode === "e2ee" ? "CIPHERTEXT RELAY" : "PLAINTEXT VISIBLE", serviceX, serviceY + serviceHeight - 16, { color: routeColor, size: compact ? 5.5 : 8, align: "center", weight: 700 });

  drawFlowPackets(context, width * 0.12 + endpointWidth / 2, serviceX - serviceWidth / 2, y, time, routeColor, state.step > 0);
  drawFlowPackets(context, serviceX + serviceWidth / 2, width * 0.88 - endpointWidth / 2, y, time, routeColor, state.step > 1);

  const packetSize = compact ? 34 : Math.min(62, height * 0.16);
  context.fillStyle = fieldPalette.ink;
  context.strokeStyle = routeColor;
  context.lineWidth = 2;
  context.fillRect(state.position - packetSize / 2, y - packetSize / 2, packetSize, packetSize);
  context.strokeRect(state.position - packetSize / 2, y - packetSize / 2, packetSize, packetSize);
  const encryptedTransit = state.mode === "e2ee" && state.step > 0 && state.step < 3;
  drawMono(context, encryptedTransit ? "A7 3C" : "TXT", state.position, y, { color: routeColor, size: compact ? 6 : 9, align: "center", weight: 700 });
  const boundaryText = state.mode === "e2ee" ? "ONLY ENDPOINTS HOLD DECRYPTION KEYS" : "SERVICE RECEIVES READABLE DATA";
  drawStatusLamp(context, width * 0.5 - Math.min(150, boundaryText.length * 3.2), height - 22, routeColor, true);
  drawMono(context, boundaryText, width * 0.5, height - 22, { color: routeColor, size: compact ? 6 : 9, align: "center" });
}

function drawTamperField(context, width, height, time, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 30, 12);
  const compact = width < 560;
  const columns = compact ? 8 : 16;
  const bytes = state.bytes;
  const count = bytes?.length || columns * (compact ? 12 : 7);
  const rows = Math.ceil(count / columns);
  const addressWidth = compact ? 25 : 42;
  const gap = compact ? 2 : 4;
  const startX = 14 + addressWidth;
  const startY = compact ? 50 : 58;
  const footerHeight = compact ? 42 : 54;
  const availableWidth = width - startX - 14;
  const availableHeight = height - startY - footerHeight;
  const cellWidth = (availableWidth - gap * (columns - 1)) / columns;
  const cellHeight = Math.max(9, Math.min(28, (availableHeight - gap * (rows - 1)) / rows));
  const gridHeight = rows * cellHeight + (rows - 1) * gap;

  drawMono(context, "AUTHENTICATED ARTIFACT / HEX", 14, 22, { color: fieldPalette.paper, size: compact ? 7 : 10, weight: 700 });
  const statusColor = state.status === "rejected" || state.status === "broken" ? fieldPalette.change : state.status === "intact" ? fieldPalette.signal : fieldPalette.muted;
  const statusText = state.status === "rejected" ? "TAG MISMATCH · REJECTED" : state.status === "broken" ? "BYTE CHANGED · VERIFY REQUIRED" : state.status === "intact" ? "AUTHENTICATED · INTACT" : "AWAITING ARTIFACT";
  drawStatusLamp(context, width - 14 - Math.min(170, statusText.length * 5.4), 22, statusColor, state.status !== "idle");
  drawMono(context, statusText, width - 14, 22, { color: statusColor, size: compact ? 6 : 9, align: "right", weight: 700 });

  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cellWidth + gap);
    const y = startY + row * (cellHeight + gap);
    if (column === 0) drawMono(context, (row * columns).toString(16).padStart(4, "0").toUpperCase(), 14, y + cellHeight / 2, { color: fieldPalette.muted, size: compact ? 5.5 : 8 });
    const value = bytes ? bytes[index] : 0;
    const isBroken = index === state.tamperedIndex;
    context.fillStyle = isBroken ? "rgba(255,139,69,.3)" : bytes ? `rgba(199,255,94,${0.035 + (value / 255) * 0.1})` : "rgba(241,239,231,.035)";
    context.fillRect(x, y, cellWidth, cellHeight);
    context.strokeStyle = isBroken ? fieldPalette.change : "rgba(241,239,231,.08)";
    context.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    drawMono(context, bytes ? value.toString(16).padStart(2, "0").toUpperCase() : "··", x + cellWidth / 2, y + cellHeight / 2, { color: isBroken ? fieldPalette.change : bytes ? fieldPalette.signal : fieldPalette.muted, size: compact ? 5.5 : 8, align: "center", alpha: isBroken ? 1 : bytes ? 0.72 : 0.25, weight: isBroken ? 700 : 500 });
  }

  if (bytes) {
    const progress = ((time - state.changedAt) * 0.17) % 1;
    const scanY = startY + progress * gridHeight;
    const gradient = context.createLinearGradient(0, scanY - 24, 0, scanY + 2);
    gradient.addColorStop(0, "rgba(199,255,94,0)");
    gradient.addColorStop(1, state.status === "rejected" ? "rgba(255,139,69,.65)" : "rgba(199,255,94,.55)");
    context.fillStyle = gradient;
    context.fillRect(startX, scanY - 24, availableWidth, 26);
  }

  const footerY = startY + gridHeight + (compact ? 12 : 18);
  const fingerprintBytes = bytes || new Uint8Array(8);
  const expected = [...Array(8)].map((_, index) => byteAt(fingerprintBytes, Math.max(0, fingerprintBytes.length - 8 + index)).toString(16).padStart(2, "0")).join("");
  const observed = state.status === "rejected" ? `${expected.slice(0, -2)}${expected.slice(-2) === "ff" ? "00" : "ff"}` : expected;
  drawMono(context, "EXPECTED TAG", 14, footerY, { color: fieldPalette.muted, size: compact ? 5.5 : 8 });
  drawMono(context, expected.toUpperCase(), 14, footerY + 15, { color: fieldPalette.signal, size: compact ? 5.5 : 8 });
  drawMono(context, "OBSERVED TAG", width * 0.54, footerY, { color: fieldPalette.muted, size: compact ? 5.5 : 8 });
  drawMono(context, observed.toUpperCase(), width * 0.54, footerY + 15, { color: state.status === "rejected" ? fieldPalette.change : fieldPalette.signal, size: compact ? 5.5 : 8 });
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
  const packetReadout = lab.querySelector("[data-field-packets]");
  const transformState = { bytes: encoder.encode(input.value), digest: new Uint8Array(32), cipherBytes: new Uint8Array() };
  const transformField = createSignalCanvas(lab.querySelector("[data-transform-canvas]"), (context, width, height, time) => drawTransformField(context, width, height, time, transformState));
  let updateSequence = 0;
  let key = null;
  let encrypted = null;

  function clearSecretState() {
    key?.fill(0);
    key = null;
    encrypted = null;
    transformState.cipherBytes = new Uint8Array();
    openButton.disabled = true;
    transformField.render();
  }

  async function update() {
    const sequence = ++updateSequence;
    const bytes = encoder.encode(input.value);
    transformState.bytes = bytes;
    packetReadout.textContent = `${bytes.length} SIGNAL${bytes.length === 1 ? "" : "S"}`;
    base64.textContent = bytesToBase64(bytes) || "(empty input)";
    decoded.textContent = "Select decode to reverse the Base64 representation.";
    hash.textContent = "Calculating…";
    clearSecretState();
    cipher.textContent = "Message changed. Generate a fresh key to encrypt it.";
    restored.textContent = "Runs locally in Voided’s Rust/WASM runtime.";
    try {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      if (sequence === updateSequence) {
        hash.textContent = bytesToHex(digest);
        transformState.digest = digest;
        transformField.render();
      }
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
      transformState.cipherBytes = base64ToBytes(encrypted.ciphertext);
      cipher.textContent = JSON.stringify(encrypted, null, 2);
      restored.textContent = "Protected with a fresh 256-bit key. The full encrypted result is shown above.";
      openButton.disabled = false;
      transformField.render();
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
  const keyFieldState = { model: "symmetric", status: "open" };
  const keyField = createSignalCanvas(lab.querySelector("[data-key-canvas]"), (context, width, height, time) => drawKeyField(context, width, height, time, keyFieldState));

  lab.querySelectorAll("[data-key-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const model = button.dataset.keyModel;
      keyFieldState.model = model;
      keyFieldState.status = "open";
      lab.querySelectorAll("[data-key-model]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      lab.querySelectorAll("[data-key-model-panel]").forEach((panel) => { panel.hidden = panel.dataset.keyModelPanel !== model; });
      keyField.render();
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
        keyFieldState.status = "locked";
        keyObject.dataset.state = "locked";
        keyState.textContent = "LOCKED BY A";
        keyExplanation.textContent = "Key A turned readable data into ciphertext. Alice may now send the locked result through an untrusted path.";
      } else if (action === "wrong") {
        keyFieldState.status = locked ? "rejected" : "open";
        keyObject.dataset.state = "rejected";
        keyState.textContent = locked ? "KEY B REJECTED" : "NOTHING TO OPEN";
        keyExplanation.textContent = locked ? "Key B is the wrong secret. Authentication fails, so no plaintext is released." : "Lock the message first. An open message does not need a key.";
      } else {
        keyFieldState.status = "open";
        keyObject.dataset.state = "open";
        keyState.textContent = locked ? "OPENED BY A" : "ALREADY OPEN";
        keyExplanation.textContent = locked ? "The same secret Key A opened the message. That shared secret must stay private on both sides." : "The message is already readable.";
        locked = false;
      }
      keyField.render();
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
        keyFieldState.status = "sealed";
        mailbox.dataset.state = "sealed";
        mailboxState.textContent = "SEALED FOR BOB";
        mailboxExplanation.textContent = "The sender used Bob’s public key. Sharing that public key lets people protect messages for Bob; it does not let them read Bob’s messages.";
      } else if (action === "public") {
        keyFieldState.status = sealed ? "rejected" : "open";
        mailbox.dataset.state = "rejected";
        mailboxState.textContent = sealed ? "PUBLIC KEY CANNOT OPEN" : "BOX IS EMPTY";
        mailboxExplanation.textContent = sealed ? "The public key can help seal this message, but it cannot reverse the operation. Bob’s private key is required." : "Seal a message first.";
      } else {
        keyFieldState.status = "open";
        mailbox.dataset.state = "open";
        mailboxState.textContent = sealed ? "OPENED BY BOB" : "BOX IS EMPTY";
        mailboxExplanation.textContent = sealed ? "Bob’s private key opened what his public key prepared. The private key never needed to travel to the sender." : "Seal a message first.";
        sealed = false;
      }
      keyField.render();
    });
  });
}

function setupJourneyLab() {
  const lab = document.querySelector("[data-journey-lab]");
  if (!lab) return;

  const stage = lab.querySelector(".journey-stage");
  const journeyCanvas = lab.querySelector("[data-journey-canvas]");
  const packet = lab.querySelector("[data-journey-packet]");
  const aliceView = lab.querySelector("[data-alice-view]");
  const serviceView = lab.querySelector("[data-service-view]");
  const serviceDetail = lab.querySelector("[data-service-detail]");
  const bobView = lab.querySelector("[data-bob-view]");
  const nextButton = lab.querySelector("[data-journey-next]");
  const caption = lab.querySelector("[data-journey-caption]");
  let mode = "e2ee";
  let step = 0;
  const journeyFieldState = { mode, step, position: 0 };
  const journeyField = createSignalCanvas(journeyCanvas, (context, width, height, time) => drawJourneyField(context, width, height, time, journeyFieldState));

  function render() {
    stage.dataset.journeyStage = String(step);
    stage.dataset.journeyMode = mode;
    journeyFieldState.mode = mode;
    journeyFieldState.step = step;
    journeyCanvas.setAttribute("aria-label", mode === "e2ee" ? "Animated route where only Alice and Bob can read the message" : "Animated route where the carrying service can also read the message");
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
    journeyField.render();
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
  const tamperCanvas = lab.querySelector("[data-tamper-canvas]");
  const tamperProbe = lab.querySelector("[data-tamper-probe]");
  const tamperFieldState = { bytes: null, tamperedIndex: -1, status: "idle", changedAt: performance.now() / 1000 };
  const tamperField = createSignalCanvas(tamperCanvas, (context, width, height, time) => drawTamperField(context, width, height, time, tamperFieldState));
  let key = null;
  let artifact = null;
  let tampered = false;

  function clearSecrets() {
    key?.fill(0);
    artifact?.fill(0);
    key = null;
    artifact = null;
    tamperFieldState.bytes = null;
    tamperFieldState.tamperedIndex = -1;
    tamperFieldState.status = "idle";
    tamperField.render();
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
      tamperFieldState.bytes = artifact;
      tamperFieldState.tamperedIndex = -1;
      tamperFieldState.status = "intact";
      tamperFieldState.changedAt = performance.now() / 1000;
      artifactOutput.textContent = bytesToBase64(artifact);
      seal.textContent = "AUTHENTICATED SEAL INTACT";
      seal.dataset.state = "intact";
      result.textContent = `Protected locally as ${artifact.length} authenticated VOF3 bytes. The full artifact is shown above.`;
      flipButton.disabled = false;
      openButton.disabled = false;
      tamperProbe.textContent = `${artifact.length} AUTHENTICATED BYTES`;
      tamperField.render();
    } catch (error) {
      artifactOutput.textContent = "Protection did not run.";
      result.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      setBusy(protectButton, false, "Protect locally");
    }
  });

  flipButton.addEventListener("click", () => {
    if (!artifact || tampered) return;
    const changedIndex = Math.floor(artifact.length * 0.54);
    artifact[changedIndex] ^= 1;
    tampered = true;
    tamperFieldState.tamperedIndex = changedIndex;
    tamperFieldState.status = "broken";
    tamperFieldState.changedAt = performance.now() / 1000;
    artifactOutput.textContent = bytesToBase64(artifact);
    seal.textContent = "ONE BYTE CHANGED";
    seal.dataset.state = "broken";
    result.textContent = "The artifact still looks like arbitrary data. Authentication must decide whether it is trustworthy.";
    flipButton.disabled = true;
    tamperProbe.textContent = `BYTE ${String(tamperFieldState.tamperedIndex).padStart(3, "0")} CHANGED`;
    tamperField.render();
  });

  openButton.addEventListener("click", async () => {
    if (!artifact || !key) return;
    try {
      const wasm = await loadWasm();
      const plaintext = wasm.open(artifact, key);
      result.textContent = `Authenticated and opened: ${decoder.decode(plaintext)}`;
      seal.textContent = "AUTHENTICATED";
      seal.dataset.state = "intact";
      tamperFieldState.status = "authenticated";
      tamperFieldState.changedAt = performance.now() / 1000;
    } catch {
      result.textContent = "Authentication failed. No plaintext released.";
      seal.textContent = "REJECTED · SEAL BROKEN";
      seal.dataset.state = "broken";
      tamperFieldState.status = "rejected";
      tamperFieldState.changedAt = performance.now() / 1000;
    }
    tamperField.render();
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
