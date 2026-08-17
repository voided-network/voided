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
  return bytes.length ? bytes[index % bytes.length] : 0;
}

function createSignalCanvas(canvas, draw) {
  if (!canvas) return { render() {} };
  const context = canvas.getContext("2d", { alpha: false });
  const pointer = { active: false, x: 0.5, y: 0.5 };
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
    draw(context, width, height, courseReducedMotion ? 0 : performance.now() / 1000, pointer);
  }

  function render() {
    draw(context, width, height, courseReducedMotion ? 0 : performance.now() / 1000, pointer);
  }

  function loop(timestamp) {
    if (visible) draw(context, width, height, timestamp / 1000, pointer);
    frame = requestAnimationFrame(loop);
  }

  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.active = true;
    pointer.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    pointer.y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (courseReducedMotion) render();
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
    if (courseReducedMotion) render();
  });

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
  context.strokeStyle = fieldPalette.line;
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

function drawByteGlyph(context, byte, x, y, size, phase) {
  const unit = size / 5;
  context.fillStyle = fieldPalette.paper;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const bit = (byte >> ((row * 3 + column * 5 + phase) % 8)) & 1;
      const echo = ((byte + row * 11 + column * 7 + phase) % 5) === 0;
      if (bit ^ echo) context.fillRect(x + column * unit, y + row * unit, Math.max(1, unit - 1.2), Math.max(1, unit - 1.2));
    }
  }
}

function drawTransformField(context, width, height, time, pointer, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 30, 14);
  const thirds = [0, width / 3, width * 2 / 3, width];
  context.strokeStyle = "rgba(199,255,94,.25)";
  for (const x of thirds.slice(1, -1)) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }

  const sourceWidth = width / 3;
  const glyphSize = Math.min(34, sourceWidth / 7);
  const glyphGapX = (sourceWidth - glyphSize * 4) / 5;
  const glyphGapY = (height - glyphSize * 4) / 5;
  for (let index = 0; index < 16; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = glyphGapX + column * (glyphSize + glyphGapX);
    const y = glyphGapY + row * (glyphSize + glyphGapY);
    context.strokeStyle = "rgba(241,239,231,.2)";
    context.strokeRect(x - 5, y - 5, glyphSize + 10, glyphSize + 10);
    drawByteGlyph(context, byteAt(state.bytes, index), x, y, glyphSize, index);
  }

  for (let stream = 0; stream < 6; stream += 1) {
    const seed = byteAt(state.bytes, stream * 3) / 255;
    const flow = (time * (0.055 + seed * 0.035) + stream / 6) % 1;
    context.beginPath();
    for (let point = 0; point <= 32; point += 1) {
      const progress = point / 32;
      const x = 12 + progress * (sourceWidth - 24);
      const y = height * (0.16 + stream * 0.135)
        + Math.sin(progress * Math.PI * (2.4 + seed) + time * 0.85 + stream) * (7 + seed * 12);
      if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = stream % 2 === 0 ? "rgba(255,139,69,.34)" : "rgba(199,255,94,.18)";
    context.lineWidth = stream % 2 === 0 ? 1.4 : 0.8;
    context.stroke();
    const headX = 12 + flow * (sourceWidth - 24);
    const headY = height * (0.16 + stream * 0.135)
      + Math.sin(flow * Math.PI * (2.4 + seed) + time * 0.85 + stream) * (7 + seed * 12);
    context.fillStyle = stream % 2 === 0 ? fieldPalette.change : fieldPalette.signal;
    context.beginPath(); context.arc(headX, headY, stream % 2 === 0 ? 2.8 : 1.8, 0, Math.PI * 2); context.fill();
  }

  for (let index = 0; index < 34; index += 1) {
    const progress = (index / 34 + time * (0.055 + (byteAt(state.bytes, index) / 255) * 0.035)) % 1;
    const fromX = sourceWidth * 0.42;
    const toX = width * 0.73;
    const x = fromX + (toX - fromX) * progress;
    const current = pointer.active ? (pointer.y - 0.5) * 90 : 0;
    const y = height * 0.5 + Math.sin(progress * Math.PI * 4 + index * 1.7 + time) * (18 + byteAt(state.bytes, index) * 0.08) + current * Math.sin(progress * Math.PI);
    context.fillStyle = index % 5 === 0 ? fieldPalette.signal : fieldPalette.change;
    context.globalAlpha = 0.28 + (1 - progress) * 0.6;
    context.beginPath(); context.arc(x, y, index % 5 === 0 ? 2.3 : 1.25, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;

  const terrainLeft = width / 3 + 16;
  const terrainRight = width * 2 / 3 - 16;
  const terrainTop = height * 0.22;
  const terrainBottom = height * 0.8;
  for (let row = 0; row < 10; row += 1) {
    context.beginPath();
    for (let column = 0; column < 14; column += 1) {
      const progressX = column / 13;
      const progressY = row / 9;
      const seed = byteAt(state.digest, row * 14 + column) / 255;
      const x = terrainLeft + progressX * (terrainRight - terrainLeft) + (progressY - 0.5) * 18;
      const wave = Math.sin(progressX * Math.PI * 3 + time * 0.7 + row * 0.36) * (8 + seed * 24);
      const y = terrainTop + progressY * (terrainBottom - terrainTop) - wave;
      if (column === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = row % 3 === 0 ? fieldPalette.signalSoft : "rgba(241,239,231,.48)";
    context.lineWidth = row % 3 === 0 ? 1.3 : 0.75;
    context.stroke();
  }
  for (let column = 0; column < 14; column += 1) {
    context.beginPath();
    for (let row = 0; row < 10; row += 1) {
      const progressX = column / 13;
      const progressY = row / 9;
      const seed = byteAt(state.digest, row * 14 + column) / 255;
      const x = terrainLeft + progressX * (terrainRight - terrainLeft) + (progressY - 0.5) * 18;
      const y = terrainTop + progressY * (terrainBottom - terrainTop) - Math.sin(progressX * Math.PI * 3 + time * 0.7 + row * 0.36) * (8 + seed * 24);
      if (row === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = "rgba(241,239,231,.17)";
    context.lineWidth = 0.6;
    context.stroke();
  }

  const fieldBytes = state.cipherBytes.length ? state.cipherBytes : state.digest;
  const points = [];
  const fieldLeft = width * 2 / 3;
  for (let index = 0; index < 42; index += 1) {
    const seedA = byteAt(fieldBytes, index * 2) / 255;
    const seedB = byteAt(fieldBytes, index * 2 + 1) / 255;
    const orbit = time * (0.08 + (index % 5) * 0.012);
    const x = fieldLeft + 28 + seedA * (width - fieldLeft - 56) + Math.cos(orbit + index) * 7;
    const y = 30 + seedB * (height - 60) + Math.sin(orbit * 1.3 + index) * 7;
    points.push({ x, y });
  }
  for (let index = 1; index < points.length; index += 1) {
    if (index % 3 === 0) continue;
    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = state.cipherBytes.length ? fieldPalette.signalSoft : "rgba(241,239,231,.17)";
    context.lineWidth = 0.6;
    context.stroke();
  }
  points.forEach((point, index) => {
    context.fillStyle = index % 7 === 0 ? fieldPalette.change : state.cipherBytes.length ? fieldPalette.signal : fieldPalette.paper;
    context.beginPath(); context.arc(point.x, point.y, index % 7 === 0 ? 2.6 : 1.35, 0, Math.PI * 2); context.fill();
  });
}

function drawKeyField(context, width, height, time, pointer, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 26, 10);
  const centers = [{ x: width * 0.18, y: height * 0.5 }, { x: width * 0.5, y: height * 0.5 }, { x: width * 0.82, y: height * 0.5 }];
  const isRejected = state.status === "rejected";
  const accent = isRejected ? fieldPalette.change : fieldPalette.signal;
  const drift = pointer.active ? (pointer.y - 0.5) * 28 : 0;
  centers.forEach((center, index) => {
    for (let ring = 1; ring <= 4; ring += 1) {
      context.beginPath();
      context.arc(center.x, center.y + drift * (index - 1), 18 + ring * 13 + Math.sin(time + ring + index) * 2, 0, Math.PI * 2);
      context.strokeStyle = ring === 1 ? accent : "rgba(241,239,231,.13)";
      context.lineWidth = ring === 1 ? 1.4 : 0.7;
      context.stroke();
    }
  });

  context.strokeStyle = isRejected ? fieldPalette.changeSoft : fieldPalette.signalSoft;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(centers[0].x, centers[0].y);
  context.bezierCurveTo(width * 0.32, height * 0.22 + drift, width * 0.38, height * 0.78 - drift, centers[1].x, centers[1].y);
  context.bezierCurveTo(width * 0.62, height * 0.22 - drift, width * 0.7, height * 0.78 + drift, centers[2].x, centers[2].y);
  context.stroke();

  const moving = state.status === "locked" || state.status === "sealed" || state.status === "open";
  for (let index = 0; index < 28; index += 1) {
    const progress = moving ? (index / 28 + time * 0.085) % 1 : index / 28;
    const x = centers[0].x + (centers[2].x - centers[0].x) * progress;
    const y = height * 0.5 + Math.sin(progress * Math.PI * 4 + index * 0.7) * (18 + (pointer.active ? 16 : 0));
    context.fillStyle = isRejected && progress > 0.42 && progress < 0.58 ? fieldPalette.change : accent;
    context.globalAlpha = moving ? 0.85 : 0.2;
    context.beginPath(); context.arc(x, y, index % 6 === 0 ? 2.7 : 1.3, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;

  if (state.model === "asymmetric") {
    for (let index = 0; index < 18; index += 1) {
      const angle = (index / 18) * Math.PI * 2 + time * 0.08;
      const radius = 72 + (index % 3) * 13;
      context.fillStyle = index % 4 === 0 ? fieldPalette.signal : fieldPalette.paper;
      context.globalAlpha = 0.65;
      context.fillRect(centers[0].x + Math.cos(angle) * radius - 2, centers[0].y + Math.sin(angle) * radius - 2, 4, 4);
    }
    context.globalAlpha = 1;
    drawByteGlyph(context, 0b10110110, centers[2].x - 17, centers[2].y - 17, 34, 2);
  } else {
    drawByteGlyph(context, 0b11001010, centers[0].x - 17, centers[0].y - 17, 34, 1);
    drawByteGlyph(context, 0b11001010, centers[2].x - 17, centers[2].y - 17, 34, 1);
  }

  if (isRejected) {
    const radius = 34 + ((time * 44) % 90);
    context.beginPath(); context.arc(centers[1].x, centers[1].y, radius, 0, Math.PI * 2);
    context.strokeStyle = fieldPalette.changeSoft; context.lineWidth = 2; context.stroke();
  }
}

function drawJourneyField(context, width, height, time, pointer, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  drawFieldGrid(context, width, height, 32, 12);
  const y = height * (0.5 + (pointer.active ? (pointer.y - 0.5) * 0.05 : 0));
  const positions = [width * 0.12, width * 0.34, width * 0.5, width * 0.88];
  if (!Number.isFinite(state.position) || state.position <= 0) state.position = positions[state.step];
  state.position += (positions[state.step] - state.position) * 0.08;
  const routeColor = state.mode === "e2ee" ? fieldPalette.signal : fieldPalette.change;

  for (let lane = -3; lane <= 3; lane += 1) {
    context.beginPath();
    for (let point = 0; point <= 80; point += 1) {
      const progress = point / 80;
      const x = width * 0.1 + progress * width * 0.8;
      const wave = Math.sin(progress * Math.PI * 5 + time * 1.2 + lane) * (4 + Math.abs(lane) * 2);
      const py = y + lane * 10 + wave;
      if (point === 0) context.moveTo(x, py); else context.lineTo(x, py);
    }
    context.strokeStyle = lane === 0 ? routeColor : "rgba(241,239,231,.13)";
    context.lineWidth = lane === 0 ? 1.5 : 0.6;
    context.stroke();
  }

  const serviceX = width * 0.5;
  context.fillStyle = state.mode === "server" ? "rgba(255,139,69,.14)" : "rgba(199,255,94,.05)";
  context.fillRect(serviceX - width * 0.1, height * 0.17, width * 0.2, height * 0.66);
  context.strokeStyle = state.mode === "server" ? fieldPalette.change : fieldPalette.signalSoft;
  context.strokeRect(serviceX - width * 0.1, height * 0.17, width * 0.2, height * 0.66);
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const on = (row * 7 + column + Math.floor(time * 3)) % (state.mode === "server" ? 4 : 3) === 0;
      context.fillStyle = on ? routeColor : "rgba(241,239,231,.12)";
      context.fillRect(serviceX - 42 + column * 14, height * 0.28 + row * 14, 5, 5);
    }
  }

  for (const x of [width * 0.12, width * 0.88]) {
    for (let ring = 0; ring < 5; ring += 1) {
      context.beginPath(); context.arc(x, y, 20 + ring * 12 + Math.sin(time + ring) * 2, 0, Math.PI * 2);
      context.strokeStyle = ring === 0 ? fieldPalette.signal : "rgba(241,239,231,.13)"; context.stroke();
    }
  }

  const packetSize = Math.min(72, height * 0.18);
  context.fillStyle = fieldPalette.ink;
  context.strokeStyle = routeColor;
  context.lineWidth = 2;
  context.fillRect(state.position - packetSize / 2, y - packetSize / 2, packetSize, packetSize);
  context.strokeRect(state.position - packetSize / 2, y - packetSize / 2, packetSize, packetSize);
  if (state.mode === "e2ee" && state.step > 0 && state.step < 3) {
    for (let index = 0; index < 25; index += 1) {
      context.fillStyle = index % 4 === 0 ? fieldPalette.signal : fieldPalette.paper;
      context.globalAlpha = 0.45 + (index % 3) * 0.18;
      context.fillRect(state.position - packetSize * 0.32 + (index % 5) * packetSize * 0.13, y - packetSize * 0.32 + Math.floor(index / 5) * packetSize * 0.13, 3, 3);
    }
  } else {
    context.strokeStyle = state.mode === "server" && state.step > 0 ? fieldPalette.change : fieldPalette.paper;
    context.lineWidth = 2;
    for (let line = -1; line <= 1; line += 1) {
      context.beginPath(); context.moveTo(state.position - packetSize * 0.25, y + line * 9); context.lineTo(state.position + packetSize * (line === 1 ? 0.12 : 0.25), y + line * 9); context.stroke();
    }
  }
  context.globalAlpha = 1;

  for (let index = 0; index < 40; index += 1) {
    const progress = (index / 40 + time * 0.045) % 1;
    const x = width * 0.1 + progress * width * 0.8;
    const py = y + Math.sin(progress * 18 + index) * 34;
    context.fillStyle = index % 8 === 0 ? routeColor : fieldPalette.paper;
    context.globalAlpha = 0.15 + progress * 0.55;
    context.beginPath(); context.arc(x, py, index % 8 === 0 ? 2.4 : 1, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;
}

function drawTamperField(context, width, height, time, pointer, state) {
  context.fillStyle = fieldPalette.ink;
  context.fillRect(0, 0, width, height);
  const columns = width < 560 ? 12 : 20;
  const bytes = state.bytes;
  const rows = bytes?.length ? Math.ceil(bytes.length / columns) : 7;
  const gap = 4;
  const cellWidth = Math.max(5, (width - 44 - gap * (columns - 1)) / columns);
  const cellHeight = Math.max(5, Math.min(18, (height - 42 - gap * (rows - 1)) / rows));
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const startX = 22;
  const startY = Math.max(20, (height - gridHeight) / 2);
  const count = bytes?.length || columns * rows;

  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cellWidth + gap);
    const y = startY + row * (cellHeight + gap);
    const value = bytes ? bytes[index] : Math.round((Math.sin(index * 1.7 + time) + 1) * 50);
    const isBroken = index === state.tamperedIndex;
    context.fillStyle = isBroken ? fieldPalette.change : bytes ? `rgba(199,255,94,${0.12 + (value / 255) * 0.65})` : "rgba(241,239,231,.07)";
    context.fillRect(x, y, cellWidth, cellHeight);
    if (pointer.active) {
      const pointerColumn = Math.floor((pointer.x * width - startX) / (cellWidth + gap));
      const pointerRow = Math.floor((pointer.y * height - startY) / (cellHeight + gap));
      if (column === pointerColumn && row === pointerRow) {
        context.strokeStyle = fieldPalette.paper; context.lineWidth = 1; context.strokeRect(x - 2, y - 2, cellWidth + 4, cellHeight + 4);
      }
    }
  }

  if (bytes) {
    const rawScan = ((time - state.changedAt) * 0.22) % 1;
    const brokenColumn = state.tamperedIndex >= 0 ? state.tamperedIndex % columns : columns - 1;
    const stop = state.status === "rejected" ? brokenColumn / columns : 1;
    const progress = Math.min(rawScan, stop);
    const scanX = startX + progress * (width - 44);
    const gradient = context.createLinearGradient(scanX - 34, 0, scanX + 10, 0);
    gradient.addColorStop(0, "rgba(199,255,94,0)");
    gradient.addColorStop(1, state.status === "rejected" ? fieldPalette.change : fieldPalette.signal);
    context.fillStyle = gradient;
    context.fillRect(scanX - 34, startY - 8, 44, gridHeight + 16);
  }

  if (state.tamperedIndex >= 0) {
    const column = state.tamperedIndex % columns;
    const row = Math.floor(state.tamperedIndex / columns);
    const x = startX + column * (cellWidth + gap) + cellWidth / 2;
    const y = startY + row * (cellHeight + gap) + cellHeight / 2;
    for (let ray = 0; ray < 10; ray += 1) {
      const angle = (ray / 10) * Math.PI * 2 + time * 0.2;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + Math.cos(angle) * (18 + ray * 2), y + Math.sin(angle) * (12 + ray));
      context.strokeStyle = fieldPalette.changeSoft; context.stroke();
    }
  }
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
  const transformField = createSignalCanvas(lab.querySelector("[data-transform-canvas]"), (context, width, height, time, pointer) => drawTransformField(context, width, height, time, pointer, transformState));
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
  const keyField = createSignalCanvas(lab.querySelector("[data-key-canvas]"), (context, width, height, time, pointer) => drawKeyField(context, width, height, time, pointer, keyFieldState));

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
  const journeyField = createSignalCanvas(journeyCanvas, (context, width, height, time, pointer) => drawJourneyField(context, width, height, time, pointer, journeyFieldState));

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
  const tamperField = createSignalCanvas(tamperCanvas, (context, width, height, time, pointer) => drawTamperField(context, width, height, time, pointer, tamperFieldState));
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

  tamperCanvas.addEventListener("pointermove", (event) => {
    if (!artifact) return;
    const bounds = tamperCanvas.getBoundingClientRect();
    const columns = bounds.width < 560 ? 12 : 20;
    const rows = Math.ceil(artifact.length / columns);
    const column = Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * rows)));
    const index = Math.min(artifact.length - 1, row * columns + column);
    tamperProbe.textContent = `BYTE ${String(index).padStart(3, "0")} · 0x${artifact[index].toString(16).padStart(2, "0")}`;
  });
  tamperCanvas.addEventListener("pointerleave", () => {
    tamperProbe.textContent = artifact ? `${artifact.length} AUTHENTICATED BYTES` : "AWAITING ARTIFACT";
  });

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
