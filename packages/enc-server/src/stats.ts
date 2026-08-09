import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";
import { randomBytes } from "crypto";

export interface Metric {
  label: string;
  originalSize: number;
  compressedSize: number;
  encryptedSize?: number;
  storedSize: number;
  compressionRatio: number;
  expansionRatio: number;
  computeUnits: number;
  algorithm: string;
  durationMs: number;
  memoryMb?: number;
}

/**
 * Simple singleton stats collector so library consumers (or tests) can push
 * metrics and later produce human-readable summaries. No external I/O unless
 * you explicitly call `dumpToJson()`.
 */
export class StatsTracker {
  private static _instance: StatsTracker | undefined;
  private metrics: Metric[] = [];

  static get instance(): StatsTracker {
    if (!this._instance) this._instance = new StatsTracker();
    return this._instance;
  }

  add(m: Metric) {
    this.metrics.push(m);
  }

  get summary() {
    const total = this.metrics.length;
    if (total === 0) {
      return {
        count: 0,
        avgCompressionRatio: 0,
        minCompressionRatio: 0,
        maxCompressionRatio: 0,
        avgExpansionRatio: 0,
        minExpansionRatio: 0,
        maxExpansionRatio: 0,
        totalBytesSaved: 0,
        totalDataMoved: 0,
        totalComputeUnits: 0,
        totalDurationMs: 0,
        avgStoredSize: 0,
        maxStoredSize: 0,
        minStoredSize: 0,
      };
    }
    const sum = (key: keyof Metric) =>
      this.metrics.reduce((a, b) => a + ((b[key] as number) || 0), 0);
    const avg = (key: keyof Metric) => sum(key) / total;
    const max = (key: keyof Metric) =>
      Math.max(...this.metrics.map((m) => (m[key] as number) || 0));
    const min = (key: keyof Metric) =>
      Math.min(...this.metrics.map((m) => (m[key] as number) || 0));
    return {
      count: total,
      avgCompressionRatio: avg("compressionRatio"),
      minCompressionRatio: min("compressionRatio"),
      maxCompressionRatio: max("compressionRatio"),
      avgExpansionRatio: avg("expansionRatio"),
      minExpansionRatio: min("expansionRatio"),
      maxExpansionRatio: max("expansionRatio"),
      totalBytesSaved: sum("originalSize") - sum("compressedSize"),
      totalDataMoved: sum("storedSize"),
      totalComputeUnits: sum("computeUnits"),
      totalDurationMs: sum("durationMs"),
      avgStoredSize: avg("storedSize"),
      maxStoredSize: max("storedSize"),
      minStoredSize: min("storedSize"),
    };
  }

  printSummary(costPerUnit = 0.001) {
    const rows = this.metrics.map((m) => ({
      label: m.label,
      start: m.originalSize,
      stored: m.storedSize,
      delta: m.storedSize - m.originalSize,
      pct:
        (
          ((m.storedSize - m.originalSize) / m.originalSize) *
          100
        ).toFixed(1) + "%",
      duration: m.durationMs + "ms",
    }));

    // Suppress huge tables in CI by grouping if >50 rows
    if (rows.length <= 50) console.table(rows);

    const s = this.summary;
    console.log("\n─── Aggregated Stats ─────────────────────────");
    console.log(` Test cases              : ${s.count}`);
    console.log(
      ` Compression ratio (avg) : ${(s.avgCompressionRatio * 100).toFixed(
        2
      )}%  [${(s.minCompressionRatio * 100).toFixed(1)}–${(
        s.maxCompressionRatio * 100
      ).toFixed(1)}]`
    );
    console.log(
      ` Expansion ratio  (avg)  : ${(s.avgExpansionRatio * 100).toFixed(
        2
      )}%  [${(s.minExpansionRatio * 100).toFixed(1)}–${(
        s.maxExpansionRatio * 100
      ).toFixed(1)}]`
    );
    console.log(` Bytes saved via comp.   : ${s.totalBytesSaved}`);
    console.log(` Data moved over wire    : ${s.totalDataMoved}`);
    console.log(
      ` Stored size   (avg)     : ${Math.round(s.avgStoredSize)} bytes  [${
        s.minStoredSize
      }-${s.maxStoredSize}]`
    );
    console.log(` Total compute units     : ${s.totalComputeUnits}`);
    console.log(
      ` Estimated API cost      : $${(
        s.totalComputeUnits * costPerUnit
      ).toFixed(3)}`
    );
    console.log(` Wall time               : ${s.totalDurationMs} ms`);
    console.log("──────────────────────────────────────────────\n");
  }

  dumpToJson(path = "voideddev-test-stats.json") {
    if (isAbsolute(path)) {
      throw new Error("Stats output must be a relative path inside the current working directory.");
    }
    const root = realpathSync(process.cwd());
    const target = resolve(root, path);
    const targetRelative = relative(root, target);
    if (targetRelative === ".." || targetRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("Stats output cannot escape the current working directory.");
    }
    const parent = realpathSync(dirname(target));
    const parentRelative = relative(root, parent);
    if (parentRelative === ".." || parentRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new Error("Stats output parent cannot escape through a symlink.");
    }

    const temporary = resolve(
      parent,
      `.voided-stats-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
    );
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      writeFileSync(
        descriptor,
        JSON.stringify({ metrics: this.metrics, summary: this.summary }, null, 2),
        "utf8",
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      // Atomic rename replaces a target symlink itself; it never follows it.
      renameSync(temporary, target);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }
}
