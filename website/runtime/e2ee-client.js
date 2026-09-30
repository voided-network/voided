var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/qrcode/lib/can-promise.js
var require_can_promise = __commonJS({
  "../../node_modules/qrcode/lib/can-promise.js"(exports$1, module) {
    module.exports = function() {
      return typeof Promise === "function" && Promise.prototype && Promise.prototype.then;
    };
  }
});

// ../../node_modules/qrcode/lib/core/utils.js
var require_utils = __commonJS({
  "../../node_modules/qrcode/lib/core/utils.js"(exports$1) {
    var toSJISFunction;
    var CODEWORDS_COUNT = [
      0,
      // Not used
      26,
      44,
      70,
      100,
      134,
      172,
      196,
      242,
      292,
      346,
      404,
      466,
      532,
      581,
      655,
      733,
      815,
      901,
      991,
      1085,
      1156,
      1258,
      1364,
      1474,
      1588,
      1706,
      1828,
      1921,
      2051,
      2185,
      2323,
      2465,
      2611,
      2761,
      2876,
      3034,
      3196,
      3362,
      3532,
      3706
    ];
    exports$1.getSymbolSize = function getSymbolSize(version) {
      if (!version) throw new Error('"version" cannot be null or undefined');
      if (version < 1 || version > 40) throw new Error('"version" should be in range from 1 to 40');
      return version * 4 + 17;
    };
    exports$1.getSymbolTotalCodewords = function getSymbolTotalCodewords(version) {
      return CODEWORDS_COUNT[version];
    };
    exports$1.getBCHDigit = function(data) {
      let digit = 0;
      while (data !== 0) {
        digit++;
        data >>>= 1;
      }
      return digit;
    };
    exports$1.setToSJISFunction = function setToSJISFunction(f) {
      if (typeof f !== "function") {
        throw new Error('"toSJISFunc" is not a valid function.');
      }
      toSJISFunction = f;
    };
    exports$1.isKanjiModeEnabled = function() {
      return typeof toSJISFunction !== "undefined";
    };
    exports$1.toSJIS = function toSJIS(kanji) {
      return toSJISFunction(kanji);
    };
  }
});

// ../../node_modules/qrcode/lib/core/error-correction-level.js
var require_error_correction_level = __commonJS({
  "../../node_modules/qrcode/lib/core/error-correction-level.js"(exports$1) {
    exports$1.L = { bit: 1 };
    exports$1.M = { bit: 0 };
    exports$1.Q = { bit: 3 };
    exports$1.H = { bit: 2 };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "l":
        case "low":
          return exports$1.L;
        case "m":
        case "medium":
          return exports$1.M;
        case "q":
        case "quartile":
          return exports$1.Q;
        case "h":
        case "high":
          return exports$1.H;
        default:
          throw new Error("Unknown EC Level: " + string);
      }
    }
    exports$1.isValid = function isValid(level) {
      return level && typeof level.bit !== "undefined" && level.bit >= 0 && level.bit < 4;
    };
    exports$1.from = function from(value, defaultValue) {
      if (exports$1.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../../node_modules/qrcode/lib/core/bit-buffer.js
var require_bit_buffer = __commonJS({
  "../../node_modules/qrcode/lib/core/bit-buffer.js"(exports$1, module) {
    function BitBuffer() {
      this.buffer = [];
      this.length = 0;
    }
    BitBuffer.prototype = {
      get: function(index) {
        const bufIndex = Math.floor(index / 8);
        return (this.buffer[bufIndex] >>> 7 - index % 8 & 1) === 1;
      },
      put: function(num, length) {
        for (let i2 = 0; i2 < length; i2++) {
          this.putBit((num >>> length - i2 - 1 & 1) === 1);
        }
      },
      getLengthInBits: function() {
        return this.length;
      },
      putBit: function(bit) {
        const bufIndex = Math.floor(this.length / 8);
        if (this.buffer.length <= bufIndex) {
          this.buffer.push(0);
        }
        if (bit) {
          this.buffer[bufIndex] |= 128 >>> this.length % 8;
        }
        this.length++;
      }
    };
    module.exports = BitBuffer;
  }
});

// ../../node_modules/qrcode/lib/core/bit-matrix.js
var require_bit_matrix = __commonJS({
  "../../node_modules/qrcode/lib/core/bit-matrix.js"(exports$1, module) {
    function BitMatrix(size) {
      if (!size || size < 1) {
        throw new Error("BitMatrix size must be defined and greater than 0");
      }
      this.size = size;
      this.data = new Uint8Array(size * size);
      this.reservedBit = new Uint8Array(size * size);
    }
    BitMatrix.prototype.set = function(row, col, value, reserved) {
      const index = row * this.size + col;
      this.data[index] = value;
      if (reserved) this.reservedBit[index] = true;
    };
    BitMatrix.prototype.get = function(row, col) {
      return this.data[row * this.size + col];
    };
    BitMatrix.prototype.xor = function(row, col, value) {
      this.data[row * this.size + col] ^= value;
    };
    BitMatrix.prototype.isReserved = function(row, col) {
      return this.reservedBit[row * this.size + col];
    };
    module.exports = BitMatrix;
  }
});

// ../../node_modules/qrcode/lib/core/alignment-pattern.js
var require_alignment_pattern = __commonJS({
  "../../node_modules/qrcode/lib/core/alignment-pattern.js"(exports$1) {
    var getSymbolSize = require_utils().getSymbolSize;
    exports$1.getRowColCoords = function getRowColCoords(version) {
      if (version === 1) return [];
      const posCount = Math.floor(version / 7) + 2;
      const size = getSymbolSize(version);
      const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
      const positions = [size - 7];
      for (let i2 = 1; i2 < posCount - 1; i2++) {
        positions[i2] = positions[i2 - 1] - intervals;
      }
      positions.push(6);
      return positions.reverse();
    };
    exports$1.getPositions = function getPositions(version) {
      const coords = [];
      const pos = exports$1.getRowColCoords(version);
      const posLength = pos.length;
      for (let i2 = 0; i2 < posLength; i2++) {
        for (let j = 0; j < posLength; j++) {
          if (i2 === 0 && j === 0 || // top-left
          i2 === 0 && j === posLength - 1 || // bottom-left
          i2 === posLength - 1 && j === 0) {
            continue;
          }
          coords.push([pos[i2], pos[j]]);
        }
      }
      return coords;
    };
  }
});

// ../../node_modules/qrcode/lib/core/finder-pattern.js
var require_finder_pattern = __commonJS({
  "../../node_modules/qrcode/lib/core/finder-pattern.js"(exports$1) {
    var getSymbolSize = require_utils().getSymbolSize;
    var FINDER_PATTERN_SIZE = 7;
    exports$1.getPositions = function getPositions(version) {
      const size = getSymbolSize(version);
      return [
        // top-left
        [0, 0],
        // top-right
        [size - FINDER_PATTERN_SIZE, 0],
        // bottom-left
        [0, size - FINDER_PATTERN_SIZE]
      ];
    };
  }
});

// ../../node_modules/qrcode/lib/core/mask-pattern.js
var require_mask_pattern = __commonJS({
  "../../node_modules/qrcode/lib/core/mask-pattern.js"(exports$1) {
    exports$1.Patterns = {
      PATTERN000: 0,
      PATTERN001: 1,
      PATTERN010: 2,
      PATTERN011: 3,
      PATTERN100: 4,
      PATTERN101: 5,
      PATTERN110: 6,
      PATTERN111: 7
    };
    var PenaltyScores = {
      N1: 3,
      N2: 3,
      N3: 40,
      N4: 10
    };
    exports$1.isValid = function isValid(mask) {
      return mask != null && mask !== "" && !isNaN(mask) && mask >= 0 && mask <= 7;
    };
    exports$1.from = function from(value) {
      return exports$1.isValid(value) ? parseInt(value, 10) : void 0;
    };
    exports$1.getPenaltyN1 = function getPenaltyN1(data) {
      const size = data.size;
      let points = 0;
      let sameCountCol = 0;
      let sameCountRow = 0;
      let lastCol = null;
      let lastRow = null;
      for (let row = 0; row < size; row++) {
        sameCountCol = sameCountRow = 0;
        lastCol = lastRow = null;
        for (let col = 0; col < size; col++) {
          let module2 = data.get(row, col);
          if (module2 === lastCol) {
            sameCountCol++;
          } else {
            if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
            lastCol = module2;
            sameCountCol = 1;
          }
          module2 = data.get(col, row);
          if (module2 === lastRow) {
            sameCountRow++;
          } else {
            if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
            lastRow = module2;
            sameCountRow = 1;
          }
        }
        if (sameCountCol >= 5) points += PenaltyScores.N1 + (sameCountCol - 5);
        if (sameCountRow >= 5) points += PenaltyScores.N1 + (sameCountRow - 5);
      }
      return points;
    };
    exports$1.getPenaltyN2 = function getPenaltyN2(data) {
      const size = data.size;
      let points = 0;
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
          if (last === 4 || last === 0) points++;
        }
      }
      return points * PenaltyScores.N2;
    };
    exports$1.getPenaltyN3 = function getPenaltyN3(data) {
      const size = data.size;
      let points = 0;
      let bitsCol = 0;
      let bitsRow = 0;
      for (let row = 0; row < size; row++) {
        bitsCol = bitsRow = 0;
        for (let col = 0; col < size; col++) {
          bitsCol = bitsCol << 1 & 2047 | data.get(row, col);
          if (col >= 10 && (bitsCol === 1488 || bitsCol === 93)) points++;
          bitsRow = bitsRow << 1 & 2047 | data.get(col, row);
          if (col >= 10 && (bitsRow === 1488 || bitsRow === 93)) points++;
        }
      }
      return points * PenaltyScores.N3;
    };
    exports$1.getPenaltyN4 = function getPenaltyN4(data) {
      let darkCount = 0;
      const modulesCount = data.data.length;
      for (let i2 = 0; i2 < modulesCount; i2++) darkCount += data.data[i2];
      const k = Math.abs(Math.ceil(darkCount * 100 / modulesCount / 5) - 10);
      return k * PenaltyScores.N4;
    };
    function getMaskAt(maskPattern, i2, j) {
      switch (maskPattern) {
        case exports$1.Patterns.PATTERN000:
          return (i2 + j) % 2 === 0;
        case exports$1.Patterns.PATTERN001:
          return i2 % 2 === 0;
        case exports$1.Patterns.PATTERN010:
          return j % 3 === 0;
        case exports$1.Patterns.PATTERN011:
          return (i2 + j) % 3 === 0;
        case exports$1.Patterns.PATTERN100:
          return (Math.floor(i2 / 2) + Math.floor(j / 3)) % 2 === 0;
        case exports$1.Patterns.PATTERN101:
          return i2 * j % 2 + i2 * j % 3 === 0;
        case exports$1.Patterns.PATTERN110:
          return (i2 * j % 2 + i2 * j % 3) % 2 === 0;
        case exports$1.Patterns.PATTERN111:
          return (i2 * j % 3 + (i2 + j) % 2) % 2 === 0;
        default:
          throw new Error("bad maskPattern:" + maskPattern);
      }
    }
    exports$1.applyMask = function applyMask(pattern, data) {
      const size = data.size;
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size; row++) {
          if (data.isReserved(row, col)) continue;
          data.xor(row, col, getMaskAt(pattern, row, col));
        }
      }
    };
    exports$1.getBestMask = function getBestMask(data, setupFormatFunc) {
      const numPatterns = Object.keys(exports$1.Patterns).length;
      let bestPattern = 0;
      let lowerPenalty = Infinity;
      for (let p = 0; p < numPatterns; p++) {
        setupFormatFunc(p);
        exports$1.applyMask(p, data);
        const penalty = exports$1.getPenaltyN1(data) + exports$1.getPenaltyN2(data) + exports$1.getPenaltyN3(data) + exports$1.getPenaltyN4(data);
        exports$1.applyMask(p, data);
        if (penalty < lowerPenalty) {
          lowerPenalty = penalty;
          bestPattern = p;
        }
      }
      return bestPattern;
    };
  }
});

// ../../node_modules/qrcode/lib/core/error-correction-code.js
var require_error_correction_code = __commonJS({
  "../../node_modules/qrcode/lib/core/error-correction-code.js"(exports$1) {
    var ECLevel = require_error_correction_level();
    var EC_BLOCKS_TABLE = [
      // L  M  Q  H
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      2,
      1,
      2,
      2,
      4,
      1,
      2,
      4,
      4,
      2,
      4,
      4,
      4,
      2,
      4,
      6,
      5,
      2,
      4,
      6,
      6,
      2,
      5,
      8,
      8,
      4,
      5,
      8,
      8,
      4,
      5,
      8,
      11,
      4,
      8,
      10,
      11,
      4,
      9,
      12,
      16,
      4,
      9,
      16,
      16,
      6,
      10,
      12,
      18,
      6,
      10,
      17,
      16,
      6,
      11,
      16,
      19,
      6,
      13,
      18,
      21,
      7,
      14,
      21,
      25,
      8,
      16,
      20,
      25,
      8,
      17,
      23,
      25,
      9,
      17,
      23,
      34,
      9,
      18,
      25,
      30,
      10,
      20,
      27,
      32,
      12,
      21,
      29,
      35,
      12,
      23,
      34,
      37,
      12,
      25,
      34,
      40,
      13,
      26,
      35,
      42,
      14,
      28,
      38,
      45,
      15,
      29,
      40,
      48,
      16,
      31,
      43,
      51,
      17,
      33,
      45,
      54,
      18,
      35,
      48,
      57,
      19,
      37,
      51,
      60,
      19,
      38,
      53,
      63,
      20,
      40,
      56,
      66,
      21,
      43,
      59,
      70,
      22,
      45,
      62,
      74,
      24,
      47,
      65,
      77,
      25,
      49,
      68,
      81
    ];
    var EC_CODEWORDS_TABLE = [
      // L  M  Q  H
      7,
      10,
      13,
      17,
      10,
      16,
      22,
      28,
      15,
      26,
      36,
      44,
      20,
      36,
      52,
      64,
      26,
      48,
      72,
      88,
      36,
      64,
      96,
      112,
      40,
      72,
      108,
      130,
      48,
      88,
      132,
      156,
      60,
      110,
      160,
      192,
      72,
      130,
      192,
      224,
      80,
      150,
      224,
      264,
      96,
      176,
      260,
      308,
      104,
      198,
      288,
      352,
      120,
      216,
      320,
      384,
      132,
      240,
      360,
      432,
      144,
      280,
      408,
      480,
      168,
      308,
      448,
      532,
      180,
      338,
      504,
      588,
      196,
      364,
      546,
      650,
      224,
      416,
      600,
      700,
      224,
      442,
      644,
      750,
      252,
      476,
      690,
      816,
      270,
      504,
      750,
      900,
      300,
      560,
      810,
      960,
      312,
      588,
      870,
      1050,
      336,
      644,
      952,
      1110,
      360,
      700,
      1020,
      1200,
      390,
      728,
      1050,
      1260,
      420,
      784,
      1140,
      1350,
      450,
      812,
      1200,
      1440,
      480,
      868,
      1290,
      1530,
      510,
      924,
      1350,
      1620,
      540,
      980,
      1440,
      1710,
      570,
      1036,
      1530,
      1800,
      570,
      1064,
      1590,
      1890,
      600,
      1120,
      1680,
      1980,
      630,
      1204,
      1770,
      2100,
      660,
      1260,
      1860,
      2220,
      720,
      1316,
      1950,
      2310,
      750,
      1372,
      2040,
      2430
    ];
    exports$1.getBlocksCount = function getBlocksCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_BLOCKS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    exports$1.getTotalCodewordsCount = function getTotalCodewordsCount(version, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case ECLevel.L:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 0];
        case ECLevel.M:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 1];
        case ECLevel.Q:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 2];
        case ECLevel.H:
          return EC_CODEWORDS_TABLE[(version - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
  }
});

// ../../node_modules/qrcode/lib/core/galois-field.js
var require_galois_field = __commonJS({
  "../../node_modules/qrcode/lib/core/galois-field.js"(exports$1) {
    var EXP_TABLE = new Uint8Array(512);
    var LOG_TABLE = new Uint8Array(256);
    (function initTables() {
      let x2 = 1;
      for (let i2 = 0; i2 < 255; i2++) {
        EXP_TABLE[i2] = x2;
        LOG_TABLE[x2] = i2;
        x2 <<= 1;
        if (x2 & 256) {
          x2 ^= 285;
        }
      }
      for (let i2 = 255; i2 < 512; i2++) {
        EXP_TABLE[i2] = EXP_TABLE[i2 - 255];
      }
    })();
    exports$1.log = function log(n) {
      if (n < 1) throw new Error("log(" + n + ")");
      return LOG_TABLE[n];
    };
    exports$1.exp = function exp(n) {
      return EXP_TABLE[n];
    };
    exports$1.mul = function mul(x2, y) {
      if (x2 === 0 || y === 0) return 0;
      return EXP_TABLE[LOG_TABLE[x2] + LOG_TABLE[y]];
    };
  }
});

// ../../node_modules/qrcode/lib/core/polynomial.js
var require_polynomial = __commonJS({
  "../../node_modules/qrcode/lib/core/polynomial.js"(exports$1) {
    var GF = require_galois_field();
    exports$1.mul = function mul(p1, p2) {
      const coeff = new Uint8Array(p1.length + p2.length - 1);
      for (let i2 = 0; i2 < p1.length; i2++) {
        for (let j = 0; j < p2.length; j++) {
          coeff[i2 + j] ^= GF.mul(p1[i2], p2[j]);
        }
      }
      return coeff;
    };
    exports$1.mod = function mod(divident, divisor) {
      let result = new Uint8Array(divident);
      while (result.length - divisor.length >= 0) {
        const coeff = result[0];
        for (let i2 = 0; i2 < divisor.length; i2++) {
          result[i2] ^= GF.mul(divisor[i2], coeff);
        }
        let offset = 0;
        while (offset < result.length && result[offset] === 0) offset++;
        result = result.slice(offset);
      }
      return result;
    };
    exports$1.generateECPolynomial = function generateECPolynomial(degree) {
      let poly = new Uint8Array([1]);
      for (let i2 = 0; i2 < degree; i2++) {
        poly = exports$1.mul(poly, new Uint8Array([1, GF.exp(i2)]));
      }
      return poly;
    };
  }
});

// ../../node_modules/qrcode/lib/core/reed-solomon-encoder.js
var require_reed_solomon_encoder = __commonJS({
  "../../node_modules/qrcode/lib/core/reed-solomon-encoder.js"(exports$1, module) {
    var Polynomial = require_polynomial();
    function ReedSolomonEncoder(degree) {
      this.genPoly = void 0;
      this.degree = degree;
      if (this.degree) this.initialize(this.degree);
    }
    ReedSolomonEncoder.prototype.initialize = function initialize(degree) {
      this.degree = degree;
      this.genPoly = Polynomial.generateECPolynomial(this.degree);
    };
    ReedSolomonEncoder.prototype.encode = function encode(data) {
      if (!this.genPoly) {
        throw new Error("Encoder not initialized");
      }
      const paddedData = new Uint8Array(data.length + this.degree);
      paddedData.set(data);
      const remainder = Polynomial.mod(paddedData, this.genPoly);
      const start = this.degree - remainder.length;
      if (start > 0) {
        const buff = new Uint8Array(this.degree);
        buff.set(remainder, start);
        return buff;
      }
      return remainder;
    };
    module.exports = ReedSolomonEncoder;
  }
});

// ../../node_modules/qrcode/lib/core/version-check.js
var require_version_check = __commonJS({
  "../../node_modules/qrcode/lib/core/version-check.js"(exports$1) {
    exports$1.isValid = function isValid(version) {
      return !isNaN(version) && version >= 1 && version <= 40;
    };
  }
});

// ../../node_modules/qrcode/lib/core/regex.js
var require_regex = __commonJS({
  "../../node_modules/qrcode/lib/core/regex.js"(exports$1) {
    var numeric = "[0-9]+";
    var alphanumeric = "[A-Z $%*+\\-./:]+";
    var kanji = "(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+";
    kanji = kanji.replace(/u/g, "\\u");
    var byte = "(?:(?![A-Z0-9 $%*+\\-./:]|" + kanji + ")(?:.|[\r\n]))+";
    exports$1.KANJI = new RegExp(kanji, "g");
    exports$1.BYTE_KANJI = new RegExp("[^A-Z0-9 $%*+\\-./:]+", "g");
    exports$1.BYTE = new RegExp(byte, "g");
    exports$1.NUMERIC = new RegExp(numeric, "g");
    exports$1.ALPHANUMERIC = new RegExp(alphanumeric, "g");
    var TEST_KANJI = new RegExp("^" + kanji + "$");
    var TEST_NUMERIC = new RegExp("^" + numeric + "$");
    var TEST_ALPHANUMERIC = new RegExp("^[A-Z0-9 $%*+\\-./:]+$");
    exports$1.testKanji = function testKanji(str) {
      return TEST_KANJI.test(str);
    };
    exports$1.testNumeric = function testNumeric(str) {
      return TEST_NUMERIC.test(str);
    };
    exports$1.testAlphanumeric = function testAlphanumeric(str) {
      return TEST_ALPHANUMERIC.test(str);
    };
  }
});

// ../../node_modules/qrcode/lib/core/mode.js
var require_mode = __commonJS({
  "../../node_modules/qrcode/lib/core/mode.js"(exports$1) {
    var VersionCheck = require_version_check();
    var Regex = require_regex();
    exports$1.NUMERIC = {
      id: "Numeric",
      bit: 1 << 0,
      ccBits: [10, 12, 14]
    };
    exports$1.ALPHANUMERIC = {
      id: "Alphanumeric",
      bit: 1 << 1,
      ccBits: [9, 11, 13]
    };
    exports$1.BYTE = {
      id: "Byte",
      bit: 1 << 2,
      ccBits: [8, 16, 16]
    };
    exports$1.KANJI = {
      id: "Kanji",
      bit: 1 << 3,
      ccBits: [8, 10, 12]
    };
    exports$1.MIXED = {
      bit: -1
    };
    exports$1.getCharCountIndicator = function getCharCountIndicator(mode, version) {
      if (!mode.ccBits) throw new Error("Invalid mode: " + mode);
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid version: " + version);
      }
      if (version >= 1 && version < 10) return mode.ccBits[0];
      else if (version < 27) return mode.ccBits[1];
      return mode.ccBits[2];
    };
    exports$1.getBestModeForData = function getBestModeForData(dataStr) {
      if (Regex.testNumeric(dataStr)) return exports$1.NUMERIC;
      else if (Regex.testAlphanumeric(dataStr)) return exports$1.ALPHANUMERIC;
      else if (Regex.testKanji(dataStr)) return exports$1.KANJI;
      else return exports$1.BYTE;
    };
    exports$1.toString = function toString(mode) {
      if (mode && mode.id) return mode.id;
      throw new Error("Invalid mode");
    };
    exports$1.isValid = function isValid(mode) {
      return mode && mode.bit && mode.ccBits;
    };
    function fromString(string) {
      if (typeof string !== "string") {
        throw new Error("Param is not a string");
      }
      const lcStr = string.toLowerCase();
      switch (lcStr) {
        case "numeric":
          return exports$1.NUMERIC;
        case "alphanumeric":
          return exports$1.ALPHANUMERIC;
        case "kanji":
          return exports$1.KANJI;
        case "byte":
          return exports$1.BYTE;
        default:
          throw new Error("Unknown mode: " + string);
      }
    }
    exports$1.from = function from(value, defaultValue) {
      if (exports$1.isValid(value)) {
        return value;
      }
      try {
        return fromString(value);
      } catch (e) {
        return defaultValue;
      }
    };
  }
});

// ../../node_modules/qrcode/lib/core/version.js
var require_version = __commonJS({
  "../../node_modules/qrcode/lib/core/version.js"(exports$1) {
    var Utils = require_utils();
    var ECCode = require_error_correction_code();
    var ECLevel = require_error_correction_level();
    var Mode = require_mode();
    var VersionCheck = require_version_check();
    var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    var G18_BCH = Utils.getBCHDigit(G18);
    function getBestVersionForDataLength(mode, length, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        if (length <= exports$1.getCapacity(currentVersion, errorCorrectionLevel, mode)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    function getReservedBitsCount(mode, version) {
      return Mode.getCharCountIndicator(mode, version) + 4;
    }
    function getTotalBitsFromDataArray(segments, version) {
      let totalBits = 0;
      segments.forEach(function(data) {
        const reservedBits = getReservedBitsCount(data.mode, version);
        totalBits += reservedBits + data.getBitsLength();
      });
      return totalBits;
    }
    function getBestVersionForMixedData(segments, errorCorrectionLevel) {
      for (let currentVersion = 1; currentVersion <= 40; currentVersion++) {
        const length = getTotalBitsFromDataArray(segments, currentVersion);
        if (length <= exports$1.getCapacity(currentVersion, errorCorrectionLevel, Mode.MIXED)) {
          return currentVersion;
        }
      }
      return void 0;
    }
    exports$1.from = function from(value, defaultValue) {
      if (VersionCheck.isValid(value)) {
        return parseInt(value, 10);
      }
      return defaultValue;
    };
    exports$1.getCapacity = function getCapacity(version, errorCorrectionLevel, mode) {
      if (!VersionCheck.isValid(version)) {
        throw new Error("Invalid QR Code version");
      }
      if (typeof mode === "undefined") mode = Mode.BYTE;
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (mode === Mode.MIXED) return dataTotalCodewordsBits;
      const usableBits = dataTotalCodewordsBits - getReservedBitsCount(mode, version);
      switch (mode) {
        case Mode.NUMERIC:
          return Math.floor(usableBits / 10 * 3);
        case Mode.ALPHANUMERIC:
          return Math.floor(usableBits / 11 * 2);
        case Mode.KANJI:
          return Math.floor(usableBits / 13);
        case Mode.BYTE:
        default:
          return Math.floor(usableBits / 8);
      }
    };
    exports$1.getBestVersionForData = function getBestVersionForData(data, errorCorrectionLevel) {
      let seg;
      const ecl = ECLevel.from(errorCorrectionLevel, ECLevel.M);
      if (Array.isArray(data)) {
        if (data.length > 1) {
          return getBestVersionForMixedData(data, ecl);
        }
        if (data.length === 0) {
          return 1;
        }
        seg = data[0];
      } else {
        seg = data;
      }
      return getBestVersionForDataLength(seg.mode, seg.getLength(), ecl);
    };
    exports$1.getEncodedBits = function getEncodedBits(version) {
      if (!VersionCheck.isValid(version) || version < 7) {
        throw new Error("Invalid QR Code version");
      }
      let d = version << 12;
      while (Utils.getBCHDigit(d) - G18_BCH >= 0) {
        d ^= G18 << Utils.getBCHDigit(d) - G18_BCH;
      }
      return version << 12 | d;
    };
  }
});

// ../../node_modules/qrcode/lib/core/format-info.js
var require_format_info = __commonJS({
  "../../node_modules/qrcode/lib/core/format-info.js"(exports$1) {
    var Utils = require_utils();
    var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    var G15_BCH = Utils.getBCHDigit(G15);
    exports$1.getEncodedBits = function getEncodedBits(errorCorrectionLevel, mask) {
      const data = errorCorrectionLevel.bit << 3 | mask;
      let d = data << 10;
      while (Utils.getBCHDigit(d) - G15_BCH >= 0) {
        d ^= G15 << Utils.getBCHDigit(d) - G15_BCH;
      }
      return (data << 10 | d) ^ G15_MASK;
    };
  }
});

// ../../node_modules/qrcode/lib/core/numeric-data.js
var require_numeric_data = __commonJS({
  "../../node_modules/qrcode/lib/core/numeric-data.js"(exports$1, module) {
    var Mode = require_mode();
    function NumericData(data) {
      this.mode = Mode.NUMERIC;
      this.data = data.toString();
    }
    NumericData.getBitsLength = function getBitsLength(length) {
      return 10 * Math.floor(length / 3) + (length % 3 ? length % 3 * 3 + 1 : 0);
    };
    NumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    NumericData.prototype.getBitsLength = function getBitsLength() {
      return NumericData.getBitsLength(this.data.length);
    };
    NumericData.prototype.write = function write(bitBuffer) {
      let i2, group, value;
      for (i2 = 0; i2 + 3 <= this.data.length; i2 += 3) {
        group = this.data.substr(i2, 3);
        value = parseInt(group, 10);
        bitBuffer.put(value, 10);
      }
      const remainingNum = this.data.length - i2;
      if (remainingNum > 0) {
        group = this.data.substr(i2);
        value = parseInt(group, 10);
        bitBuffer.put(value, remainingNum * 3 + 1);
      }
    };
    module.exports = NumericData;
  }
});

// ../../node_modules/qrcode/lib/core/alphanumeric-data.js
var require_alphanumeric_data = __commonJS({
  "../../node_modules/qrcode/lib/core/alphanumeric-data.js"(exports$1, module) {
    var Mode = require_mode();
    var ALPHA_NUM_CHARS = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      " ",
      "$",
      "%",
      "*",
      "+",
      "-",
      ".",
      "/",
      ":"
    ];
    function AlphanumericData(data) {
      this.mode = Mode.ALPHANUMERIC;
      this.data = data;
    }
    AlphanumericData.getBitsLength = function getBitsLength(length) {
      return 11 * Math.floor(length / 2) + 6 * (length % 2);
    };
    AlphanumericData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    AlphanumericData.prototype.getBitsLength = function getBitsLength() {
      return AlphanumericData.getBitsLength(this.data.length);
    };
    AlphanumericData.prototype.write = function write(bitBuffer) {
      let i2;
      for (i2 = 0; i2 + 2 <= this.data.length; i2 += 2) {
        let value = ALPHA_NUM_CHARS.indexOf(this.data[i2]) * 45;
        value += ALPHA_NUM_CHARS.indexOf(this.data[i2 + 1]);
        bitBuffer.put(value, 11);
      }
      if (this.data.length % 2) {
        bitBuffer.put(ALPHA_NUM_CHARS.indexOf(this.data[i2]), 6);
      }
    };
    module.exports = AlphanumericData;
  }
});

// ../../node_modules/qrcode/lib/core/byte-data.js
var require_byte_data = __commonJS({
  "../../node_modules/qrcode/lib/core/byte-data.js"(exports$1, module) {
    var Mode = require_mode();
    function ByteData(data) {
      this.mode = Mode.BYTE;
      if (typeof data === "string") {
        this.data = new TextEncoder().encode(data);
      } else {
        this.data = new Uint8Array(data);
      }
    }
    ByteData.getBitsLength = function getBitsLength(length) {
      return length * 8;
    };
    ByteData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    ByteData.prototype.getBitsLength = function getBitsLength() {
      return ByteData.getBitsLength(this.data.length);
    };
    ByteData.prototype.write = function(bitBuffer) {
      for (let i2 = 0, l = this.data.length; i2 < l; i2++) {
        bitBuffer.put(this.data[i2], 8);
      }
    };
    module.exports = ByteData;
  }
});

// ../../node_modules/qrcode/lib/core/kanji-data.js
var require_kanji_data = __commonJS({
  "../../node_modules/qrcode/lib/core/kanji-data.js"(exports$1, module) {
    var Mode = require_mode();
    var Utils = require_utils();
    function KanjiData(data) {
      this.mode = Mode.KANJI;
      this.data = data;
    }
    KanjiData.getBitsLength = function getBitsLength(length) {
      return length * 13;
    };
    KanjiData.prototype.getLength = function getLength() {
      return this.data.length;
    };
    KanjiData.prototype.getBitsLength = function getBitsLength() {
      return KanjiData.getBitsLength(this.data.length);
    };
    KanjiData.prototype.write = function(bitBuffer) {
      let i2;
      for (i2 = 0; i2 < this.data.length; i2++) {
        let value = Utils.toSJIS(this.data[i2]);
        if (value >= 33088 && value <= 40956) {
          value -= 33088;
        } else if (value >= 57408 && value <= 60351) {
          value -= 49472;
        } else {
          throw new Error(
            "Invalid SJIS character: " + this.data[i2] + "\nMake sure your charset is UTF-8"
          );
        }
        value = (value >>> 8 & 255) * 192 + (value & 255);
        bitBuffer.put(value, 13);
      }
    };
    module.exports = KanjiData;
  }
});

// ../../node_modules/dijkstrajs/dijkstra.js
var require_dijkstra = __commonJS({
  "../../node_modules/dijkstrajs/dijkstra.js"(exports$1, module) {
    var dijkstra = {
      single_source_shortest_paths: function(graph, s, d) {
        var predecessors = {};
        var costs = {};
        costs[s] = 0;
        var open3 = dijkstra.PriorityQueue.make();
        open3.push(s, 0);
        var closest, u, v, cost_of_s_to_u, adjacent_nodes, cost_of_e, cost_of_s_to_u_plus_cost_of_e, cost_of_s_to_v, first_visit;
        while (!open3.empty()) {
          closest = open3.pop();
          u = closest.value;
          cost_of_s_to_u = closest.cost;
          adjacent_nodes = graph[u] || {};
          for (v in adjacent_nodes) {
            if (adjacent_nodes.hasOwnProperty(v)) {
              cost_of_e = adjacent_nodes[v];
              cost_of_s_to_u_plus_cost_of_e = cost_of_s_to_u + cost_of_e;
              cost_of_s_to_v = costs[v];
              first_visit = typeof costs[v] === "undefined";
              if (first_visit || cost_of_s_to_v > cost_of_s_to_u_plus_cost_of_e) {
                costs[v] = cost_of_s_to_u_plus_cost_of_e;
                open3.push(v, cost_of_s_to_u_plus_cost_of_e);
                predecessors[v] = u;
              }
            }
          }
        }
        if (typeof d !== "undefined" && typeof costs[d] === "undefined") {
          var msg = ["Could not find a path from ", s, " to ", d, "."].join("");
          throw new Error(msg);
        }
        return predecessors;
      },
      extract_shortest_path_from_predecessor_list: function(predecessors, d) {
        var nodes = [];
        var u = d;
        while (u) {
          nodes.push(u);
          predecessors[u];
          u = predecessors[u];
        }
        nodes.reverse();
        return nodes;
      },
      find_path: function(graph, s, d) {
        var predecessors = dijkstra.single_source_shortest_paths(graph, s, d);
        return dijkstra.extract_shortest_path_from_predecessor_list(
          predecessors,
          d
        );
      },
      /**
       * A very naive priority queue implementation.
       */
      PriorityQueue: {
        make: function(opts) {
          var T = dijkstra.PriorityQueue, t = {}, key;
          opts = opts || {};
          for (key in T) {
            if (T.hasOwnProperty(key)) {
              t[key] = T[key];
            }
          }
          t.queue = [];
          t.sorter = opts.sorter || T.default_sorter;
          return t;
        },
        default_sorter: function(a, b) {
          return a.cost - b.cost;
        },
        /**
         * Add a new item to the queue and ensure the highest priority element
         * is at the front of the queue.
         */
        push: function(value, cost) {
          var item = { value, cost };
          this.queue.push(item);
          this.queue.sort(this.sorter);
        },
        /**
         * Return the highest priority element in the queue.
         */
        pop: function() {
          return this.queue.shift();
        },
        empty: function() {
          return this.queue.length === 0;
        }
      }
    };
    if (typeof module !== "undefined") {
      module.exports = dijkstra;
    }
  }
});

// ../../node_modules/qrcode/lib/core/segments.js
var require_segments = __commonJS({
  "../../node_modules/qrcode/lib/core/segments.js"(exports$1) {
    var Mode = require_mode();
    var NumericData = require_numeric_data();
    var AlphanumericData = require_alphanumeric_data();
    var ByteData = require_byte_data();
    var KanjiData = require_kanji_data();
    var Regex = require_regex();
    var Utils = require_utils();
    var dijkstra = require_dijkstra();
    function getStringByteLength(str) {
      return unescape(encodeURIComponent(str)).length;
    }
    function getSegments(regex, mode, str) {
      const segments = [];
      let result;
      while ((result = regex.exec(str)) !== null) {
        segments.push({
          data: result[0],
          index: result.index,
          mode,
          length: result[0].length
        });
      }
      return segments;
    }
    function getSegmentsFromString(dataStr) {
      const numSegs = getSegments(Regex.NUMERIC, Mode.NUMERIC, dataStr);
      const alphaNumSegs = getSegments(Regex.ALPHANUMERIC, Mode.ALPHANUMERIC, dataStr);
      let byteSegs;
      let kanjiSegs;
      if (Utils.isKanjiModeEnabled()) {
        byteSegs = getSegments(Regex.BYTE, Mode.BYTE, dataStr);
        kanjiSegs = getSegments(Regex.KANJI, Mode.KANJI, dataStr);
      } else {
        byteSegs = getSegments(Regex.BYTE_KANJI, Mode.BYTE, dataStr);
        kanjiSegs = [];
      }
      const segs = numSegs.concat(alphaNumSegs, byteSegs, kanjiSegs);
      return segs.sort(function(s1, s2) {
        return s1.index - s2.index;
      }).map(function(obj) {
        return {
          data: obj.data,
          mode: obj.mode,
          length: obj.length
        };
      });
    }
    function getSegmentBitsLength(length, mode) {
      switch (mode) {
        case Mode.NUMERIC:
          return NumericData.getBitsLength(length);
        case Mode.ALPHANUMERIC:
          return AlphanumericData.getBitsLength(length);
        case Mode.KANJI:
          return KanjiData.getBitsLength(length);
        case Mode.BYTE:
          return ByteData.getBitsLength(length);
      }
    }
    function mergeSegments(segs) {
      return segs.reduce(function(acc, curr) {
        const prevSeg = acc.length - 1 >= 0 ? acc[acc.length - 1] : null;
        if (prevSeg && prevSeg.mode === curr.mode) {
          acc[acc.length - 1].data += curr.data;
          return acc;
        }
        acc.push(curr);
        return acc;
      }, []);
    }
    function buildNodes(segs) {
      const nodes = [];
      for (let i2 = 0; i2 < segs.length; i2++) {
        const seg = segs[i2];
        switch (seg.mode) {
          case Mode.NUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.ALPHANUMERIC, length: seg.length },
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.ALPHANUMERIC:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: seg.length }
            ]);
            break;
          case Mode.KANJI:
            nodes.push([
              seg,
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
            break;
          case Mode.BYTE:
            nodes.push([
              { data: seg.data, mode: Mode.BYTE, length: getStringByteLength(seg.data) }
            ]);
        }
      }
      return nodes;
    }
    function buildGraph(nodes, version) {
      const table = {};
      const graph = { start: {} };
      let prevNodeIds = ["start"];
      for (let i2 = 0; i2 < nodes.length; i2++) {
        const nodeGroup = nodes[i2];
        const currentNodeIds = [];
        for (let j = 0; j < nodeGroup.length; j++) {
          const node = nodeGroup[j];
          const key = "" + i2 + j;
          currentNodeIds.push(key);
          table[key] = { node, lastCount: 0 };
          graph[key] = {};
          for (let n = 0; n < prevNodeIds.length; n++) {
            const prevNodeId = prevNodeIds[n];
            if (table[prevNodeId] && table[prevNodeId].node.mode === node.mode) {
              graph[prevNodeId][key] = getSegmentBitsLength(table[prevNodeId].lastCount + node.length, node.mode) - getSegmentBitsLength(table[prevNodeId].lastCount, node.mode);
              table[prevNodeId].lastCount += node.length;
            } else {
              if (table[prevNodeId]) table[prevNodeId].lastCount = node.length;
              graph[prevNodeId][key] = getSegmentBitsLength(node.length, node.mode) + 4 + Mode.getCharCountIndicator(node.mode, version);
            }
          }
        }
        prevNodeIds = currentNodeIds;
      }
      for (let n = 0; n < prevNodeIds.length; n++) {
        graph[prevNodeIds[n]].end = 0;
      }
      return { map: graph, table };
    }
    function buildSingleSegment(data, modesHint) {
      let mode;
      const bestMode = Mode.getBestModeForData(data);
      mode = Mode.from(modesHint, bestMode);
      if (mode !== Mode.BYTE && mode.bit < bestMode.bit) {
        throw new Error('"' + data + '" cannot be encoded with mode ' + Mode.toString(mode) + ".\n Suggested mode is: " + Mode.toString(bestMode));
      }
      if (mode === Mode.KANJI && !Utils.isKanjiModeEnabled()) {
        mode = Mode.BYTE;
      }
      switch (mode) {
        case Mode.NUMERIC:
          return new NumericData(data);
        case Mode.ALPHANUMERIC:
          return new AlphanumericData(data);
        case Mode.KANJI:
          return new KanjiData(data);
        case Mode.BYTE:
          return new ByteData(data);
      }
    }
    exports$1.fromArray = function fromArray(array) {
      return array.reduce(function(acc, seg) {
        if (typeof seg === "string") {
          acc.push(buildSingleSegment(seg, null));
        } else if (seg.data) {
          acc.push(buildSingleSegment(seg.data, seg.mode));
        }
        return acc;
      }, []);
    };
    exports$1.fromString = function fromString(data, version) {
      const segs = getSegmentsFromString(data, Utils.isKanjiModeEnabled());
      const nodes = buildNodes(segs);
      const graph = buildGraph(nodes, version);
      const path = dijkstra.find_path(graph.map, "start", "end");
      const optimizedSegs = [];
      for (let i2 = 1; i2 < path.length - 1; i2++) {
        optimizedSegs.push(graph.table[path[i2]].node);
      }
      return exports$1.fromArray(mergeSegments(optimizedSegs));
    };
    exports$1.rawSplit = function rawSplit(data) {
      return exports$1.fromArray(
        getSegmentsFromString(data, Utils.isKanjiModeEnabled())
      );
    };
  }
});

// ../../node_modules/qrcode/lib/core/qrcode.js
var require_qrcode = __commonJS({
  "../../node_modules/qrcode/lib/core/qrcode.js"(exports$1) {
    var Utils = require_utils();
    var ECLevel = require_error_correction_level();
    var BitBuffer = require_bit_buffer();
    var BitMatrix = require_bit_matrix();
    var AlignmentPattern = require_alignment_pattern();
    var FinderPattern = require_finder_pattern();
    var MaskPattern = require_mask_pattern();
    var ECCode = require_error_correction_code();
    var ReedSolomonEncoder = require_reed_solomon_encoder();
    var Version = require_version();
    var FormatInfo = require_format_info();
    var Mode = require_mode();
    var Segments = require_segments();
    function setupFinderPattern(matrix, version) {
      const size = matrix.size;
      const pos = FinderPattern.getPositions(version);
      for (let i2 = 0; i2 < pos.length; i2++) {
        const row = pos[i2][0];
        const col = pos[i2][1];
        for (let r = -1; r <= 7; r++) {
          if (row + r <= -1 || size <= row + r) continue;
          for (let c = -1; c <= 7; c++) {
            if (col + c <= -1 || size <= col + c) continue;
            if (r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupTimingPattern(matrix) {
      const size = matrix.size;
      for (let r = 8; r < size - 8; r++) {
        const value = r % 2 === 0;
        matrix.set(r, 6, value, true);
        matrix.set(6, r, value, true);
      }
    }
    function setupAlignmentPattern(matrix, version) {
      const pos = AlignmentPattern.getPositions(version);
      for (let i2 = 0; i2 < pos.length; i2++) {
        const row = pos[i2][0];
        const col = pos[i2][1];
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0) {
              matrix.set(row + r, col + c, true, true);
            } else {
              matrix.set(row + r, col + c, false, true);
            }
          }
        }
      }
    }
    function setupVersionInfo(matrix, version) {
      const size = matrix.size;
      const bits2 = Version.getEncodedBits(version);
      let row, col, mod;
      for (let i2 = 0; i2 < 18; i2++) {
        row = Math.floor(i2 / 3);
        col = i2 % 3 + size - 8 - 3;
        mod = (bits2 >> i2 & 1) === 1;
        matrix.set(row, col, mod, true);
        matrix.set(col, row, mod, true);
      }
    }
    function setupFormatInfo(matrix, errorCorrectionLevel, maskPattern) {
      const size = matrix.size;
      const bits2 = FormatInfo.getEncodedBits(errorCorrectionLevel, maskPattern);
      let i2, mod;
      for (i2 = 0; i2 < 15; i2++) {
        mod = (bits2 >> i2 & 1) === 1;
        if (i2 < 6) {
          matrix.set(i2, 8, mod, true);
        } else if (i2 < 8) {
          matrix.set(i2 + 1, 8, mod, true);
        } else {
          matrix.set(size - 15 + i2, 8, mod, true);
        }
        if (i2 < 8) {
          matrix.set(8, size - i2 - 1, mod, true);
        } else if (i2 < 9) {
          matrix.set(8, 15 - i2 - 1 + 1, mod, true);
        } else {
          matrix.set(8, 15 - i2 - 1, mod, true);
        }
      }
      matrix.set(size - 8, 8, 1, true);
    }
    function setupData(matrix, data) {
      const size = matrix.size;
      let inc = -1;
      let row = size - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!matrix.isReserved(row, col - c)) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) === 1;
              }
              matrix.set(row, col - c, dark);
              bitIndex--;
              if (bitIndex === -1) {
                byteIndex++;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || size <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
    function createData(version, errorCorrectionLevel, segments) {
      const buffer = new BitBuffer();
      segments.forEach(function(data) {
        buffer.put(data.mode.bit, 4);
        buffer.put(data.getLength(), Mode.getCharCountIndicator(data.mode, version));
        data.write(buffer);
      });
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewordsBits = (totalCodewords - ecTotalCodewords) * 8;
      if (buffer.getLengthInBits() + 4 <= dataTotalCodewordsBits) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 !== 0) {
        buffer.putBit(0);
      }
      const remainingByte = (dataTotalCodewordsBits - buffer.getLengthInBits()) / 8;
      for (let i2 = 0; i2 < remainingByte; i2++) {
        buffer.put(i2 % 2 ? 17 : 236, 8);
      }
      return createCodewords(buffer, version, errorCorrectionLevel);
    }
    function createCodewords(bitBuffer, version, errorCorrectionLevel) {
      const totalCodewords = Utils.getSymbolTotalCodewords(version);
      const ecTotalCodewords = ECCode.getTotalCodewordsCount(version, errorCorrectionLevel);
      const dataTotalCodewords = totalCodewords - ecTotalCodewords;
      const ecTotalBlocks = ECCode.getBlocksCount(version, errorCorrectionLevel);
      const blocksInGroup2 = totalCodewords % ecTotalBlocks;
      const blocksInGroup1 = ecTotalBlocks - blocksInGroup2;
      const totalCodewordsInGroup1 = Math.floor(totalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup1 = Math.floor(dataTotalCodewords / ecTotalBlocks);
      const dataCodewordsInGroup2 = dataCodewordsInGroup1 + 1;
      const ecCount = totalCodewordsInGroup1 - dataCodewordsInGroup1;
      const rs = new ReedSolomonEncoder(ecCount);
      let offset = 0;
      const dcData = new Array(ecTotalBlocks);
      const ecData = new Array(ecTotalBlocks);
      let maxDataSize = 0;
      const buffer = new Uint8Array(bitBuffer.buffer);
      for (let b = 0; b < ecTotalBlocks; b++) {
        const dataSize = b < blocksInGroup1 ? dataCodewordsInGroup1 : dataCodewordsInGroup2;
        dcData[b] = buffer.slice(offset, offset + dataSize);
        ecData[b] = rs.encode(dcData[b]);
        offset += dataSize;
        maxDataSize = Math.max(maxDataSize, dataSize);
      }
      const data = new Uint8Array(totalCodewords);
      let index = 0;
      let i2, r;
      for (i2 = 0; i2 < maxDataSize; i2++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          if (i2 < dcData[r].length) {
            data[index++] = dcData[r][i2];
          }
        }
      }
      for (i2 = 0; i2 < ecCount; i2++) {
        for (r = 0; r < ecTotalBlocks; r++) {
          data[index++] = ecData[r][i2];
        }
      }
      return data;
    }
    function createSymbol(data, version, errorCorrectionLevel, maskPattern) {
      let segments;
      if (Array.isArray(data)) {
        segments = Segments.fromArray(data);
      } else if (typeof data === "string") {
        let estimatedVersion = version;
        if (!estimatedVersion) {
          const rawSegments = Segments.rawSplit(data);
          estimatedVersion = Version.getBestVersionForData(rawSegments, errorCorrectionLevel);
        }
        segments = Segments.fromString(data, estimatedVersion || 40);
      } else {
        throw new Error("Invalid data");
      }
      const bestVersion = Version.getBestVersionForData(segments, errorCorrectionLevel);
      if (!bestVersion) {
        throw new Error("The amount of data is too big to be stored in a QR Code");
      }
      if (!version) {
        version = bestVersion;
      } else if (version < bestVersion) {
        throw new Error(
          "\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: " + bestVersion + ".\n"
        );
      }
      const dataBits = createData(version, errorCorrectionLevel, segments);
      const moduleCount = Utils.getSymbolSize(version);
      const modules = new BitMatrix(moduleCount);
      setupFinderPattern(modules, version);
      setupTimingPattern(modules);
      setupAlignmentPattern(modules, version);
      setupFormatInfo(modules, errorCorrectionLevel, 0);
      if (version >= 7) {
        setupVersionInfo(modules, version);
      }
      setupData(modules, dataBits);
      if (isNaN(maskPattern)) {
        maskPattern = MaskPattern.getBestMask(
          modules,
          setupFormatInfo.bind(null, modules, errorCorrectionLevel)
        );
      }
      MaskPattern.applyMask(maskPattern, modules);
      setupFormatInfo(modules, errorCorrectionLevel, maskPattern);
      return {
        modules,
        version,
        errorCorrectionLevel,
        maskPattern,
        segments
      };
    }
    exports$1.create = function create(data, options) {
      if (typeof data === "undefined" || data === "") {
        throw new Error("No input text");
      }
      let errorCorrectionLevel = ECLevel.M;
      let version;
      let mask;
      if (typeof options !== "undefined") {
        errorCorrectionLevel = ECLevel.from(options.errorCorrectionLevel, ECLevel.M);
        version = Version.from(options.version);
        mask = MaskPattern.from(options.maskPattern);
        if (options.toSJISFunc) {
          Utils.setToSJISFunction(options.toSJISFunc);
        }
      }
      return createSymbol(data, version, errorCorrectionLevel, mask);
    };
  }
});

// ../../node_modules/qrcode/lib/renderer/utils.js
var require_utils2 = __commonJS({
  "../../node_modules/qrcode/lib/renderer/utils.js"(exports$1) {
    function hex2rgba(hex) {
      if (typeof hex === "number") {
        hex = hex.toString();
      }
      if (typeof hex !== "string") {
        throw new Error("Color should be defined as hex string");
      }
      let hexCode = hex.slice().replace("#", "").split("");
      if (hexCode.length < 3 || hexCode.length === 5 || hexCode.length > 8) {
        throw new Error("Invalid hex color: " + hex);
      }
      if (hexCode.length === 3 || hexCode.length === 4) {
        hexCode = Array.prototype.concat.apply([], hexCode.map(function(c) {
          return [c, c];
        }));
      }
      if (hexCode.length === 6) hexCode.push("F", "F");
      const hexValue = parseInt(hexCode.join(""), 16);
      return {
        r: hexValue >> 24 & 255,
        g: hexValue >> 16 & 255,
        b: hexValue >> 8 & 255,
        a: hexValue & 255,
        hex: "#" + hexCode.slice(0, 6).join("")
      };
    }
    exports$1.getOptions = function getOptions(options) {
      if (!options) options = {};
      if (!options.color) options.color = {};
      const margin = typeof options.margin === "undefined" || options.margin === null || options.margin < 0 ? 4 : options.margin;
      const width = options.width && options.width >= 21 ? options.width : void 0;
      const scale = options.scale || 4;
      return {
        width,
        scale: width ? 4 : scale,
        margin,
        color: {
          dark: hex2rgba(options.color.dark || "#000000ff"),
          light: hex2rgba(options.color.light || "#ffffffff")
        },
        type: options.type,
        rendererOpts: options.rendererOpts || {}
      };
    };
    exports$1.getScale = function getScale(qrSize, opts) {
      return opts.width && opts.width >= qrSize + opts.margin * 2 ? opts.width / (qrSize + opts.margin * 2) : opts.scale;
    };
    exports$1.getImageWidth = function getImageWidth(qrSize, opts) {
      const scale = exports$1.getScale(qrSize, opts);
      return Math.floor((qrSize + opts.margin * 2) * scale);
    };
    exports$1.qrToImageData = function qrToImageData(imgData, qr, opts) {
      const size = qr.modules.size;
      const data = qr.modules.data;
      const scale = exports$1.getScale(size, opts);
      const symbolSize = Math.floor((size + opts.margin * 2) * scale);
      const scaledMargin = opts.margin * scale;
      const palette = [opts.color.light, opts.color.dark];
      for (let i2 = 0; i2 < symbolSize; i2++) {
        for (let j = 0; j < symbolSize; j++) {
          let posDst = (i2 * symbolSize + j) * 4;
          let pxColor = opts.color.light;
          if (i2 >= scaledMargin && j >= scaledMargin && i2 < symbolSize - scaledMargin && j < symbolSize - scaledMargin) {
            const iSrc = Math.floor((i2 - scaledMargin) / scale);
            const jSrc = Math.floor((j - scaledMargin) / scale);
            pxColor = palette[data[iSrc * size + jSrc] ? 1 : 0];
          }
          imgData[posDst++] = pxColor.r;
          imgData[posDst++] = pxColor.g;
          imgData[posDst++] = pxColor.b;
          imgData[posDst] = pxColor.a;
        }
      }
    };
  }
});

// ../../node_modules/qrcode/lib/renderer/canvas.js
var require_canvas = __commonJS({
  "../../node_modules/qrcode/lib/renderer/canvas.js"(exports$1) {
    var Utils = require_utils2();
    function clearCanvas(ctx, canvas, size) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!canvas.style) canvas.style = {};
      canvas.height = size;
      canvas.width = size;
      canvas.style.height = size + "px";
      canvas.style.width = size + "px";
    }
    function getCanvasElement() {
      try {
        return document.createElement("canvas");
      } catch (e) {
        throw new Error("You need to specify a canvas element");
      }
    }
    exports$1.render = function render(qrData, canvas, options) {
      let opts = options;
      let canvasEl = canvas;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!canvas) {
        canvasEl = getCanvasElement();
      }
      opts = Utils.getOptions(opts);
      const size = Utils.getImageWidth(qrData.modules.size, opts);
      const ctx = canvasEl.getContext("2d");
      const image = ctx.createImageData(size, size);
      Utils.qrToImageData(image.data, qrData, opts);
      clearCanvas(ctx, canvasEl, size);
      ctx.putImageData(image, 0, 0);
      return canvasEl;
    };
    exports$1.renderToDataURL = function renderToDataURL(qrData, canvas, options) {
      let opts = options;
      if (typeof opts === "undefined" && (!canvas || !canvas.getContext)) {
        opts = canvas;
        canvas = void 0;
      }
      if (!opts) opts = {};
      const canvasEl = exports$1.render(qrData, canvas, opts);
      const type = opts.type || "image/png";
      const rendererOpts = opts.rendererOpts || {};
      return canvasEl.toDataURL(type, rendererOpts.quality);
    };
  }
});

// ../../node_modules/qrcode/lib/renderer/svg-tag.js
var require_svg_tag = __commonJS({
  "../../node_modules/qrcode/lib/renderer/svg-tag.js"(exports$1) {
    var Utils = require_utils2();
    function getColorAttrib(color, attrib) {
      const alpha = color.a / 255;
      const str = attrib + '="' + color.hex + '"';
      return alpha < 1 ? str + " " + attrib + '-opacity="' + alpha.toFixed(2).slice(1) + '"' : str;
    }
    function svgCmd(cmd, x2, y) {
      let str = cmd + x2;
      if (typeof y !== "undefined") str += " " + y;
      return str;
    }
    function qrToPath(data, size, margin) {
      let path = "";
      let moveBy = 0;
      let newRow = false;
      let lineLength = 0;
      for (let i2 = 0; i2 < data.length; i2++) {
        const col = Math.floor(i2 % size);
        const row = Math.floor(i2 / size);
        if (!col && !newRow) newRow = true;
        if (data[i2]) {
          lineLength++;
          if (!(i2 > 0 && col > 0 && data[i2 - 1])) {
            path += newRow ? svgCmd("M", col + margin, 0.5 + row + margin) : svgCmd("m", moveBy, 0);
            moveBy = 0;
            newRow = false;
          }
          if (!(col + 1 < size && data[i2 + 1])) {
            path += svgCmd("h", lineLength);
            lineLength = 0;
          }
        } else {
          moveBy++;
        }
      }
      return path;
    }
    exports$1.render = function render(qrData, options, cb) {
      const opts = Utils.getOptions(options);
      const size = qrData.modules.size;
      const data = qrData.modules.data;
      const qrcodesize = size + opts.margin * 2;
      const bg = !opts.color.light.a ? "" : "<path " + getColorAttrib(opts.color.light, "fill") + ' d="M0 0h' + qrcodesize + "v" + qrcodesize + 'H0z"/>';
      const path = "<path " + getColorAttrib(opts.color.dark, "stroke") + ' d="' + qrToPath(data, size, opts.margin) + '"/>';
      const viewBox = 'viewBox="0 0 ' + qrcodesize + " " + qrcodesize + '"';
      const width = !opts.width ? "" : 'width="' + opts.width + '" height="' + opts.width + '" ';
      const svgTag = '<svg xmlns="http://www.w3.org/2000/svg" ' + width + viewBox + ' shape-rendering="crispEdges">' + bg + path + "</svg>\n";
      if (typeof cb === "function") {
        cb(null, svgTag);
      }
      return svgTag;
    };
  }
});

// ../../node_modules/qrcode/lib/browser.js
var require_browser = __commonJS({
  "../../node_modules/qrcode/lib/browser.js"(exports$1) {
    var canPromise = require_can_promise();
    var QRCode2 = require_qrcode();
    var CanvasRenderer = require_canvas();
    var SvgRenderer = require_svg_tag();
    function renderCanvas(renderFunc, canvas, text, opts, cb) {
      const args = [].slice.call(arguments, 1);
      const argsNum = args.length;
      const isLastArgCb = typeof args[argsNum - 1] === "function";
      if (!isLastArgCb && !canPromise()) {
        throw new Error("Callback required as last argument");
      }
      if (isLastArgCb) {
        if (argsNum < 2) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 2) {
          cb = text;
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 3) {
          if (canvas.getContext && typeof cb === "undefined") {
            cb = opts;
            opts = void 0;
          } else {
            cb = opts;
            opts = text;
            text = canvas;
            canvas = void 0;
          }
        }
      } else {
        if (argsNum < 1) {
          throw new Error("Too few arguments provided");
        }
        if (argsNum === 1) {
          text = canvas;
          canvas = opts = void 0;
        } else if (argsNum === 2 && !canvas.getContext) {
          opts = text;
          text = canvas;
          canvas = void 0;
        }
        return new Promise(function(resolve, reject) {
          try {
            const data = QRCode2.create(text, opts);
            resolve(renderFunc(data, canvas, opts));
          } catch (e) {
            reject(e);
          }
        });
      }
      try {
        const data = QRCode2.create(text, opts);
        cb(null, renderFunc(data, canvas, opts));
      } catch (e) {
        cb(e);
      }
    }
    exports$1.create = QRCode2.create;
    exports$1.toCanvas = renderCanvas.bind(null, CanvasRenderer.render);
    exports$1.toDataURL = renderCanvas.bind(null, CanvasRenderer.renderToDataURL);
    exports$1.toString = renderCanvas.bind(null, function(data, _, opts) {
      return SvgRenderer.render(data, opts);
    });
  }
});

// src/crypto-backend.ts
var crypto_backend_exports = {};
__export(crypto_backend_exports, {
  base64Decode: () => base64Decode,
  base64Encode: () => base64Encode,
  compareHashes: () => compareHashes,
  compress: () => compress2,
  configureWasmLoader: () => configureWasmLoader,
  createRecoveryDeck: () => createRecoveryDeck,
  decompress: () => decompress2,
  decompressBounded: () => decompressBounded,
  decrypt: () => decrypt,
  decryptWithAad: () => decryptWithAad,
  deriveKeyHkdf: () => deriveKeyHkdf,
  deriveKeyPbkdf2: () => deriveKeyPbkdf2,
  deriveRecoveryKey: () => deriveRecoveryKey,
  encodeRecoveryDeck: () => encodeRecoveryDeck,
  encrypt: () => encrypt,
  encryptWithAad: () => encryptWithAad,
  forceTypeScriptBackend: () => forceTypeScriptBackend,
  forceWasmBackend: () => forceWasmBackend,
  fuse: () => fuse,
  generateFingerprint: () => generateFingerprint,
  generateHmac: () => generateHmac,
  generateKey: () => generateKey,
  generateRecoveryDeck: () => generateRecoveryDeck,
  generateSafetyNumbers: () => generateSafetyNumbers,
  generateSalt: () => generateSalt,
  getCurrentBackend: () => getCurrentBackend,
  hash: () => hash,
  hashWithSalt: () => hashWithSalt,
  hexDecode: () => hexDecode,
  hexEncode: () => hexEncode,
  inspectArtifact: () => inspectArtifact,
  inspectFused: () => inspectFused,
  isWasmBackendReady: () => isWasmBackendReady,
  open: () => open,
  protect: () => protect,
  randomBytes: () => randomBytes,
  repackArtifact: () => repackArtifact,
  rotateRecoveryDeck: () => rotateRecoveryDeck,
  unfuse: () => unfuse,
  unwrapRootWithRecoveryKey: () => unwrapRootWithRecoveryKey,
  useWasmBackend: () => useWasmBackend,
  validateRecoveryDeck: () => validateRecoveryDeck,
  wrapRootWithRecoveryKey: () => wrapRootWithRecoveryKey
});

// src/base64-validation.ts
function base64SextetValue(character) {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  return code === 43 ? 62 : code === 47 ? 63 : -1;
}
function inspectCanonicalBase64(value, maxDecodedBytes) {
  if (typeof value !== "string") {
    return { ok: false, reason: "not-canonical" };
  }
  if (value.length === 0) {
    return { ok: true, decodedLength: 0 };
  }
  const maxEncodedLength = Math.ceil(maxDecodedBytes / 3) * 4;
  if (value.length > maxEncodedLength) {
    return { ok: false, reason: "too-large" };
  }
  if (value.length % 4 !== 0) {
    return { ok: false, reason: "not-canonical" };
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index++) {
    if (base64SextetValue(value[index]) < 0) {
      return { ok: false, reason: "not-canonical" };
    }
  }
  for (let index = dataLength; index < value.length; index++) {
    if (value[index] !== "=") {
      return { ok: false, reason: "not-canonical" };
    }
  }
  if (padding === 2 && (base64SextetValue(value[value.length - 3]) & 15) !== 0 || padding === 1 && (base64SextetValue(value[value.length - 2]) & 3) !== 0) {
    return { ok: false, reason: "not-canonical" };
  }
  const decodedLength = value.length / 4 * 3 - padding;
  if (!Number.isSafeInteger(decodedLength) || decodedLength < 0 || decodedLength > maxDecodedBytes) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, decodedLength };
}

// src/wasm/boundary.ts
var WASM_PLAINTEXT_MAX_BYTES = 100 * 1024 * 1024;
var WASM_BOUNDED_DECOMPRESSION_MAX_BYTES = 512 * 1024 * 1024;
var WASM_ARTIFACT_MAX_BYTES = 140 * 1024 * 1024;
var WASM_RAW_MAX_BYTES = 16 * 1024 * 1024;
var WASM_KDF_INPUT_MAX_BYTES = 1024 * 1024;
var WASM_CONTEXT_MAX_BYTES = 1024;
var WASM_CHUNK_MAX_BYTES = 1024 * 1024;
var WASM_HKDF_MAX_OUTPUT_BYTES = 255 * 32;
var TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength"
)?.get;
var TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "length"
)?.get;
var TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag
)?.get;
var HAS_OWN_PROPERTY = Object.prototype.hasOwnProperty;
function hasIntrinsicTypedArrayLength(value) {
  let current = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "length");
    if (descriptor) {
      return descriptor.get === TYPED_ARRAY_LENGTH_GETTER && descriptor.set === void 0;
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}
function assertAggregateBytes(label, maxBytes, ...lengths) {
  let total = 0;
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes - total) {
      throw new Error(`[voided-wasm] ${label} exceeds its size limit`);
    }
    total += length;
  }
}
function callAfterPreflight(preflight, rawCall, postflight) {
  preflight();
  const result = rawCall();
  return postflight ? postflight(result) : result;
}
function assertBytes(value, label, maxBytes, minBytes = 0) {
  if (!TYPED_ARRAY_BYTE_LENGTH_GETTER || !TYPED_ARRAY_LENGTH_GETTER || !TYPED_ARRAY_TAG_GETTER) {
    throw new Error(`[voided-wasm] ${label} must be a Uint8Array`);
  }
  let length;
  try {
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== "Uint8Array") {
      throw new Error("wrong typed-array brand");
    }
    length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    if (Reflect.apply(HAS_OWN_PROPERTY, value, ["length"]) || !hasIntrinsicTypedArrayLength(value) || Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) !== length) {
      throw new Error("shadowed typed-array length");
    }
  } catch {
    throw new Error(`[voided-wasm] ${label} must be a valid Uint8Array`);
  }
  if (length < minBytes || length > maxBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain between ${minBytes} and ${maxBytes} bytes`
    );
  }
  return length;
}
function assertExactBytes(value, label, expectedBytes) {
  const length = assertBytes(value, label, expectedBytes);
  if (length !== expectedBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain exactly ${expectedBytes} bytes`
    );
  }
  return length;
}
function assertSafeInteger(value, label, min, max2) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max2) {
    throw new Error(
      `[voided-wasm] ${label} must be a safe integer from ${min} to ${max2}`
    );
  }
  return value;
}
function assertCanonicalBase64(value, label, maxDecodedBytes, exactDecodedBytes) {
  const inspected = inspectCanonicalBase64(value, maxDecodedBytes);
  if (!inspected.ok) {
    const reason = inspected.reason === "too-large" ? "exceeds its size limit" : "must be canonical padded base64";
    throw new Error(`[voided-wasm] ${label} ${reason}`);
  }
  if (exactDecodedBytes !== void 0 && inspected.decodedLength !== exactDecodedBytes) {
    throw new Error(
      `[voided-wasm] ${label} must decode to exactly ${exactDecodedBytes} bytes`
    );
  }
  return inspected.decodedLength;
}
function assertCanonicalLowerHex(value, label, maxDecodedBytes, exactDecodedBytes) {
  if (typeof value !== "string" || value.length > maxDecodedBytes * 2 || value.length % 2 !== 0) {
    throw new Error(
      `[voided-wasm] ${label} must be canonical lowercase hexadecimal within its size limit`
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (!(code >= 48 && code <= 57 || code >= 97 && code <= 102)) {
      throw new Error(
        `[voided-wasm] ${label} must be canonical lowercase hexadecimal within its size limit`
      );
    }
  }
  const decodedLength = value.length / 2;
  if (exactDecodedBytes !== void 0 && decodedLength !== exactDecodedBytes) {
    throw new Error(
      `[voided-wasm] ${label} must decode to exactly ${exactDecodedBytes} bytes`
    );
  }
  return decodedLength;
}
function assertUtf8String(value, label, maxBytes, minBytes = 0) {
  if (typeof value !== "string") {
    throw new Error(`[voided-wasm] ${label} must be a string`);
  }
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 127) bytes += 1;
    else if (code <= 2047) bytes += 2;
    else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > maxBytes) break;
  }
  if (bytes < minBytes || bytes > maxBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain between ${minBytes} and ${maxBytes} UTF-8 bytes`
    );
  }
  return bytes;
}
function assertOneOf(value, label, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`[voided-wasm] ${label} is unsupported`);
  }
}
function authenticatedAlgorithm(value) {
  const algorithm = value ?? "xchacha20-poly1305";
  assertOneOf(algorithm, "authenticated encryption algorithm", [
    "xchacha20-poly1305",
    "aes-256-gcm"
  ]);
  return algorithm;
}
function hashAlgorithm(value) {
  const algorithm = value ?? "sha256";
  assertOneOf(algorithm, "hash algorithm", ["sha256", "sha512"]);
  return algorithm;
}
function compressionAlgorithm(value) {
  const algorithm = value ?? "brotli";
  assertOneOf(algorithm, "compression algorithm", [
    "gzip",
    "brotli",
    "none"
  ]);
  return algorithm;
}
function fusedPreset(value) {
  const preset = value ?? "balanced";
  assertOneOf(preset, "fused preset", [
    "compact",
    "balanced",
    "concealed"
  ]);
  return preset;
}
function compressionLevel(algorithm, value) {
  const level = value ?? 6;
  const max2 = algorithm === "gzip" ? 9 : algorithm === "brotli" ? 11 : 6;
  const min = algorithm === "none" && level !== 6 ? 0 : 0;
  assertSafeInteger(level, "compression level", min, max2);
  if (algorithm === "none" && level !== 0 && level !== 6) {
    throw new Error("[voided-wasm] compression level is invalid for none");
  }
  return level;
}
function optionalChunkSize(value) {
  if (value === void 0) return void 0;
  return assertSafeInteger(value, "shell chunk size", 1, WASM_CHUNK_MAX_BYTES);
}
function pbkdfParameters(input, salt, iterations) {
  assertBytes(input, "PBKDF2 input", WASM_KDF_INPUT_MAX_BYTES, 1);
  assertBytes(salt, "PBKDF2 salt", 1024, 16);
  assertSafeInteger(iterations, "PBKDF2 iterations", 1e5, 1e6);
}
function validateEncryptionResult(value, expectedAlgorithm) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] encryption result must be an object");
  }
  const result = value;
  if (result.algorithm !== expectedAlgorithm) {
    throw new Error("[voided-wasm] encryption result algorithm mismatch");
  }
  assertCanonicalBase64(
    result.ciphertext,
    "ciphertext",
    WASM_PLAINTEXT_MAX_BYTES
  );
  assertCanonicalBase64(
    result.nonce,
    "nonce",
    expectedAlgorithm === "xchacha20-poly1305" ? 24 : 12,
    expectedAlgorithm === "xchacha20-poly1305" ? 24 : 12
  );
  assertCanonicalBase64(result.tag, "authentication tag", 16, 16);
  return value;
}
function validateHashResult(value, algorithm, label = "hash result") {
  assertCanonicalLowerHex(
    value,
    label,
    algorithm === "sha256" ? 32 : 64,
    algorithm === "sha256" ? 32 : 64
  );
  return value;
}
function validateBytesResult(value, label, maxBytes, exactBytes) {
  if (exactBytes === void 0) assertBytes(value, label, maxBytes);
  else assertExactBytes(value, label, exactBytes);
  return value;
}
function metadataInteger(value, label, max2) {
  return assertSafeInteger(value, label, 0, max2);
}
function validateCompressionResult(value, inputLength, requestedAlgorithm) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] compression result must be an object");
  }
  const result = value;
  assertOneOf(result.algorithm, "returned compression algorithm", [
    "gzip",
    "brotli",
    "none"
  ]);
  if (result.algorithm !== requestedAlgorithm && result.algorithm !== "none") {
    throw new Error("[voided-wasm] compression result algorithm mismatch");
  }
  const compressedLength = assertBytes(
    result.compressed,
    "compressed result",
    WASM_PLAINTEXT_MAX_BYTES
  );
  if (metadataInteger(
    result.originalSize,
    "compression original size",
    WASM_PLAINTEXT_MAX_BYTES
  ) !== inputLength || metadataInteger(
    result.compressedSize,
    "compression output size",
    WASM_PLAINTEXT_MAX_BYTES
  ) !== compressedLength) {
    throw new Error("[voided-wasm] compression metadata size mismatch");
  }
  if (typeof result.compressionRatio !== "number" || !Number.isFinite(result.compressionRatio) || result.compressionRatio < 0) {
    throw new Error("[voided-wasm] compression ratio is invalid");
  }
  return value;
}
function validateFusedShellInfo(value, shellLength) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] fused shell metadata must be an object");
  }
  const info = value;
  assertSafeInteger(info.version, "fused shell version", 1, 255);
  assertOneOf(info.preset, "returned fused preset", [
    "compact",
    "balanced",
    "concealed"
  ]);
  assertSafeInteger(info.chunkSize, "fused shell chunk size", 1, WASM_CHUNK_MAX_BYTES);
  metadataInteger(info.chunkCount, "fused shell chunk count", Number.MAX_SAFE_INTEGER);
  const payload = metadataInteger(
    info.payloadSize,
    "fused shell payload size",
    WASM_PLAINTEXT_MAX_BYTES
  );
  const metadata = metadataInteger(
    info.metadataSize,
    "fused shell metadata size",
    WASM_ARTIFACT_MAX_BYTES
  );
  const tag = metadataInteger(
    info.tagSize,
    "fused shell tag size",
    WASM_ARTIFACT_MAX_BYTES
  );
  const shell = metadataInteger(
    info.shellSize,
    "fused shell size",
    WASM_ARTIFACT_MAX_BYTES
  );
  if (shell !== shellLength || payload + metadata + tag !== shell || !Number.isSafeInteger(payload + metadata + tag)) {
    throw new Error("[voided-wasm] fused shell metadata size mismatch");
  }
  return value;
}
function validateArtifactInfo(value, artifactLength) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] protected artifact metadata must be an object");
  }
  const info = value;
  assertSafeInteger(info.version, "protected artifact version", 1, 255);
  assertOneOf(info.preset, "returned fused preset", [
    "compact",
    "balanced",
    "concealed"
  ]);
  assertOneOf(info.compressionAlgorithm, "returned compression algorithm", [
    "gzip",
    "brotli",
    "none"
  ]);
  assertOneOf(info.encryptionAlgorithm, "returned encryption algorithm", [
    "xchacha20-poly1305",
    "aes-256-gcm"
  ]);
  metadataInteger(
    info.originalSize,
    "protected artifact original size",
    WASM_PLAINTEXT_MAX_BYTES
  );
  metadataInteger(
    info.compressedSize,
    "protected artifact compressed size",
    WASM_PLAINTEXT_MAX_BYTES
  );
  metadataInteger(
    info.encryptedSize,
    "protected artifact encrypted size",
    WASM_ARTIFACT_MAX_BYTES
  );
  if (metadataInteger(
    info.protectedSize,
    "protected artifact size",
    WASM_ARTIFACT_MAX_BYTES
  ) !== artifactLength) {
    throw new Error("[voided-wasm] protected artifact size metadata mismatch");
  }
  assertSafeInteger(
    info.shellChunkSize,
    "protected artifact shell chunk size",
    1,
    WASM_CHUNK_MAX_BYTES
  );
  metadataInteger(
    info.shellChunkCount,
    "protected artifact shell chunk count",
    Number.MAX_SAFE_INTEGER
  );
  assertExactBytes(info.shellNonce, "protected artifact shell nonce", 12);
  return value;
}
function validateProtectResult(value, originalLength) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] protect result must be an object");
  }
  const result = value;
  const artifactLength = assertBytes(
    result.artifact,
    "protected artifact result",
    WASM_ARTIFACT_MAX_BYTES
  );
  validateArtifactInfo(value, artifactLength);
  if (result.originalSize !== originalLength) {
    throw new Error("[voided-wasm] protect result original size mismatch");
  }
  return value;
}

// src/wasm/secure-module.ts
function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`[voided-wasm] ${label} must be a boolean`);
  }
  return value;
}
function assertNotAllZero(value, label) {
  let aggregate = 0;
  for (let index = 0; index < 32; index++) aggregate |= value[index];
  if (aggregate === 0) {
    throw new Error(`[voided-wasm] ${label} must not be all zero`);
  }
}
function assertBoundedString(value, label, maxCodeUnits) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxCodeUnits) {
    throw new Error(`[voided-wasm] ${label} is invalid`);
  }
  return value;
}
function validateKeyPair(value) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] X25519 key pair must be an object");
  }
  const pair = value;
  const publicKey = pair.public_key ?? pair.publicKey;
  assertExactBytes(publicKey, "X25519 public key result", 32);
  assertNotAllZero(publicKey, "X25519 public key result");
  assertExactBytes(
    pair.private_key ?? pair.privateKey,
    "X25519 private key result",
    32
  );
  return value;
}
var RECOVERY_CARD_IDS = /* @__PURE__ */ new Set([
  "AS",
  "2S",
  "3S",
  "4S",
  "5S",
  "6S",
  "7S",
  "8S",
  "9S",
  "10S",
  "JS",
  "QS",
  "KS",
  "AH",
  "2H",
  "3H",
  "4H",
  "5H",
  "6H",
  "7H",
  "8H",
  "9H",
  "10H",
  "JH",
  "QH",
  "KH",
  "AD",
  "2D",
  "3D",
  "4D",
  "5D",
  "6D",
  "7D",
  "8D",
  "9D",
  "10D",
  "JD",
  "QD",
  "KD",
  "AC",
  "2C",
  "3C",
  "4C",
  "5C",
  "6C",
  "7C",
  "8C",
  "9C",
  "10C",
  "JC",
  "QC",
  "KC"
]);
function assertRecoveryDeck(value, label) {
  if (!Array.isArray(value) || value.length !== 52) {
    throw new Error(`[voided-wasm] ${label} must contain exactly 52 cards`);
  }
  const seen = /* @__PURE__ */ new Set();
  for (let index = 0; index < value.length; index++) {
    const card = value[index];
    if (typeof card !== "string" || !RECOVERY_CARD_IDS.has(card)) {
      throw new Error(`[voided-wasm] ${label} has an unknown card at position ${index}`);
    }
    if (seen.has(card)) {
      throw new Error(`[voided-wasm] ${label} has a duplicate card at position ${index}`);
    }
    seen.add(card);
  }
}
function validateRecoveryDeckSetup(value) {
  if (!value || typeof value !== "object") {
    throw new Error("[voided-wasm] recovery deck setup must be an object");
  }
  const setup = value;
  assertRecoveryDeck(setup.deck, "generated recovery deck");
  const rootWrapper = setup.rootWrapper ?? setup.root_wrapper;
  assertExactBytes(rootWrapper, "recovery root wrapper result", 80);
  return {
    deck: setup.deck,
    rootWrapper
  };
}
function validateProtectOptions(preset, compression, level, encryption, chunkSize) {
  const checkedPreset = fusedPreset(preset);
  const checkedCompression = compressionAlgorithm(compression);
  compressionLevel(checkedCompression, level);
  const checkedEncryption = authenticatedAlgorithm(encryption);
  optionalChunkSize(chunkSize);
  return {
    preset: checkedPreset,
    compression: checkedCompression,
    encryption: checkedEncryption
  };
}
function validateReturnedProtectConfiguration(result, expected) {
  if (result.preset !== expected.preset || result.compressionAlgorithm !== expected.compression && result.compressionAlgorithm !== "none" || result.encryptionAlgorithm !== expected.encryption) {
    throw new Error("[voided-wasm] protected artifact configuration mismatch");
  }
  return result;
}
function secureWasmModule(raw) {
  const inspectFused2 = (data) => {
    let inputLength = 0;
    return callAfterPreflight(
      () => {
        inputLength = assertBytes(
          data,
          "fused shell input",
          WASM_ARTIFACT_MAX_BYTES
        );
      },
      () => raw.inspectFused(data),
      (info) => validateFusedShellInfo(info, inputLength)
    );
  };
  const inspectArtifact2 = (artifact) => {
    let inputLength = 0;
    return callAfterPreflight(
      () => {
        inputLength = assertBytes(
          artifact,
          "protected artifact input",
          WASM_ARTIFACT_MAX_BYTES
        );
      },
      () => raw.inspectArtifact(artifact),
      (info) => validateArtifactInfo(info, inputLength)
    );
  };
  return {
    version: () => callAfterPreflight(
      () => void 0,
      () => raw.version(),
      (value) => assertBoundedString(value, "version result", 128)
    ),
    generate_key: () => validateBytesResult(raw.generate_key(), "generated key", 32, 32),
    encrypt: (data, key, algorithm) => {
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, "encryption input", WASM_PLAINTEXT_MAX_BYTES);
          assertExactBytes(key, "encryption key", 32);
        },
        () => raw.encrypt(data, key, checkedAlgorithm),
        (value) => validateEncryptionResult(
          value,
          checkedAlgorithm
        )
      );
    },
    decrypt: (ciphertext, nonce, tag, key, algorithm) => {
      if (algorithm === void 0) {
        throw new Error(
          "[voided-wasm] authenticated encryption algorithm is required"
        );
      }
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertCanonicalBase64(
            ciphertext,
            "ciphertext",
            WASM_PLAINTEXT_MAX_BYTES
          );
          assertCanonicalBase64(
            nonce,
            "nonce",
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12,
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12
          );
          assertCanonicalBase64(tag, "authentication tag", 16, 16);
          assertExactBytes(key, "decryption key", 32);
        },
        () => raw.decrypt(ciphertext, nonce, tag, key, checkedAlgorithm),
        (value) => validateBytesResult(
          value,
          "decrypted plaintext",
          WASM_PLAINTEXT_MAX_BYTES
        )
      );
    },
    encrypt_with_aad: (data, key, aad, algorithm) => {
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const dataLength = assertBytes(
            data,
            "authenticated encryption input",
            WASM_PLAINTEXT_MAX_BYTES
          );
          assertExactBytes(key, "authenticated encryption key", 32);
          const aadLength = assertBytes(
            aad,
            "authenticated additional data",
            WASM_RAW_MAX_BYTES
          );
          assertAggregateBytes(
            "authenticated encryption working set",
            WASM_PLAINTEXT_MAX_BYTES,
            dataLength,
            aadLength,
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12,
            16
          );
        },
        () => raw.encrypt_with_aad(data, key, aad, checkedAlgorithm),
        (value) => validateEncryptionResult(
          value,
          checkedAlgorithm
        )
      );
    },
    decrypt_with_aad: (ciphertext, nonce, tag, key, algorithm, aad) => {
      if (algorithm === void 0) {
        throw new Error(
          "[voided-wasm] authenticated encryption algorithm is required"
        );
      }
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const ciphertextLength = assertCanonicalBase64(
            ciphertext,
            "ciphertext",
            WASM_PLAINTEXT_MAX_BYTES
          );
          assertCanonicalBase64(
            nonce,
            "nonce",
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12,
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12
          );
          assertCanonicalBase64(tag, "authentication tag", 16, 16);
          assertExactBytes(key, "authenticated decryption key", 32);
          const aadLength = assertBytes(
            aad,
            "authenticated additional data",
            WASM_RAW_MAX_BYTES
          );
          assertAggregateBytes(
            "authenticated decryption working set",
            WASM_PLAINTEXT_MAX_BYTES,
            ciphertextLength,
            aadLength,
            checkedAlgorithm === "xchacha20-poly1305" ? 24 : 12,
            16
          );
        },
        () => raw.decrypt_with_aad(
          ciphertext,
          nonce,
          tag,
          key,
          checkedAlgorithm,
          aad
        ),
        (value) => validateBytesResult(
          value,
          "authenticated decrypted plaintext",
          WASM_PLAINTEXT_MAX_BYTES
        )
      );
    },
    derive_key_hkdf: (ikm, salt, info) => callAfterPreflight(
      () => {
        assertBytes(ikm, "HKDF input key material", WASM_KDF_INPUT_MAX_BYTES, 1);
        if (salt !== null) {
          assertBytes(salt, "HKDF salt", WASM_KDF_INPUT_MAX_BYTES);
        }
        assertBytes(info, "HKDF info", WASM_KDF_INPUT_MAX_BYTES);
      },
      () => raw.derive_key_hkdf(ikm, salt, info),
      (value) => validateBytesResult(value, "HKDF key result", 32, 32)
    ),
    derive_key_hkdf_raw: raw.derive_key_hkdf_raw ? (ikm, salt, info, length) => callAfterPreflight(
      () => {
        assertBytes(
          ikm,
          "HKDF input key material",
          WASM_KDF_INPUT_MAX_BYTES,
          1
        );
        if (salt !== null) {
          assertBytes(salt, "HKDF salt", WASM_KDF_INPUT_MAX_BYTES);
        }
        assertBytes(info, "HKDF info", WASM_KDF_INPUT_MAX_BYTES);
        assertSafeInteger(
          length,
          "HKDF output length",
          1,
          WASM_HKDF_MAX_OUTPUT_BYTES
        );
      },
      () => raw.derive_key_hkdf_raw(ikm, salt, info, length),
      (value) => validateBytesResult(
        value,
        "HKDF raw result",
        WASM_HKDF_MAX_OUTPUT_BYTES,
        length
      )
    ) : void 0,
    derive_key_pbkdf2: (password, salt, iterations) => callAfterPreflight(
      () => pbkdfParameters(password, salt, iterations),
      () => raw.derive_key_pbkdf2(password, salt, iterations),
      (value) => validateBytesResult(value, "PBKDF2 key result", 32, 32)
    ),
    generate_recovery_deck: raw.generate_recovery_deck ? () => callAfterPreflight(
      () => void 0,
      () => raw.generate_recovery_deck(),
      (value) => {
        assertRecoveryDeck(value, "generated recovery deck");
        return value;
      }
    ) : void 0,
    validate_recovery_deck: raw.validate_recovery_deck ? (deck) => {
      try {
        assertRecoveryDeck(deck, "recovery deck");
      } catch {
        return false;
      }
      return assertBoolean(
        raw.validate_recovery_deck(deck),
        "recovery deck validation result"
      );
    } : void 0,
    encode_recovery_deck: raw.encode_recovery_deck ? (deck) => callAfterPreflight(
      () => assertRecoveryDeck(deck, "recovery deck"),
      () => raw.encode_recovery_deck(deck),
      (value) => validateBytesResult(value, "recovery deck encoding", 29, 29)
    ) : void 0,
    derive_recovery_key: raw.derive_recovery_key ? (deck) => callAfterPreflight(
      () => assertRecoveryDeck(deck, "recovery deck"),
      () => raw.derive_recovery_key(deck),
      (value) => validateBytesResult(value, "derived Recovery Key", 32, 32)
    ) : void 0,
    wrap_root_with_recovery_key: raw.wrap_root_with_recovery_key ? (rootKey, recoveryKey) => callAfterPreflight(
      () => {
        assertExactBytes(rootKey, "stable root key", 32);
        assertExactBytes(recoveryKey, "Recovery Key", 32);
      },
      () => raw.wrap_root_with_recovery_key(rootKey, recoveryKey),
      (value) => validateBytesResult(value, "recovery root wrapper", 80, 80)
    ) : void 0,
    unwrap_root_with_recovery_key: raw.unwrap_root_with_recovery_key ? (rootWrapper, recoveryKey) => callAfterPreflight(
      () => {
        assertExactBytes(rootWrapper, "recovery root wrapper", 80);
        assertExactBytes(recoveryKey, "Recovery Key", 32);
      },
      () => raw.unwrap_root_with_recovery_key(rootWrapper, recoveryKey),
      (value) => validateBytesResult(value, "unwrapped stable root key", 32, 32)
    ) : void 0,
    create_recovery_deck: raw.create_recovery_deck ? (rootKey) => callAfterPreflight(
      () => assertExactBytes(rootKey, "stable root key", 32),
      () => raw.create_recovery_deck(rootKey),
      validateRecoveryDeckSetup
    ) : void 0,
    rotate_recovery_deck: raw.rotate_recovery_deck ? (rootWrapper, oldDeck) => callAfterPreflight(
      () => {
        assertExactBytes(rootWrapper, "recovery root wrapper", 80);
        assertRecoveryDeck(oldDeck, "old recovery deck");
      },
      () => raw.rotate_recovery_deck(rootWrapper, oldDeck),
      validateRecoveryDeckSetup
    ) : void 0,
    generate_x25519_key_pair: raw.generate_x25519_key_pair ? (seed) => callAfterPreflight(
      () => {
        if (seed !== void 0 && seed !== null) {
          assertExactBytes(seed, "X25519 seed", 32);
        }
      },
      () => raw.generate_x25519_key_pair(seed),
      validateKeyPair
    ) : void 0,
    x25519_shared_secret: raw.x25519_shared_secret ? (ourPrivateKey, theirPublicKey) => callAfterPreflight(
      () => {
        assertExactBytes(ourPrivateKey, "X25519 private key", 32);
        assertExactBytes(theirPublicKey, "X25519 public key", 32);
        assertNotAllZero(theirPublicKey, "X25519 public key");
      },
      () => raw.x25519_shared_secret(ourPrivateKey, theirPublicKey),
      (value) => {
        const checked = validateBytesResult(
          value,
          "X25519 shared secret result",
          32,
          32
        );
        assertNotAllZero(checked, "X25519 shared secret result");
        return checked;
      }
    ) : void 0,
    derive_key_from_shared_secret: raw.derive_key_from_shared_secret ? (sharedSecret, salt, info) => callAfterPreflight(
      () => {
        assertExactBytes(sharedSecret, "X25519 shared secret", 32);
        assertNotAllZero(sharedSecret, "X25519 shared secret");
        assertUtf8String(
          salt,
          "shared-secret salt context",
          WASM_CONTEXT_MAX_BYTES,
          1
        );
        assertUtf8String(
          info,
          "shared-secret info context",
          WASM_CONTEXT_MAX_BYTES,
          1
        );
      },
      () => raw.derive_key_from_shared_secret(sharedSecret, salt, info),
      (value) => validateBytesResult(
        value,
        "shared-secret derived key result",
        32,
        32
      )
    ) : void 0,
    hash: (data, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => assertBytes(data, "hash input", WASM_PLAINTEXT_MAX_BYTES),
        () => raw.hash(data, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm)
      );
    },
    hash_with_salt: (data, salt, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const dataLength = assertBytes(
            data,
            "salted hash input",
            WASM_PLAINTEXT_MAX_BYTES
          );
          const saltLength = assertBytes(
            salt,
            "salted hash salt",
            WASM_RAW_MAX_BYTES
          );
          if (dataLength > WASM_PLAINTEXT_MAX_BYTES - saltLength - 64) {
            throw new Error("[voided-wasm] salted hash transcript exceeds its size limit");
          }
        },
        () => raw.hash_with_salt(data, salt, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm)
      );
    },
    compare_hashes: (a, b) => callAfterPreflight(
      () => {
        assertBytes(a, "first hash comparison input", 64);
        assertBytes(b, "second hash comparison input", 64);
      },
      () => raw.compare_hashes(a, b),
      (value) => assertBoolean(value, "hash comparison result")
    ),
    generate_hmac: (data, key, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, "HMAC input", WASM_PLAINTEXT_MAX_BYTES);
          assertBytes(key, "HMAC key", WASM_KDF_INPUT_MAX_BYTES, 1);
        },
        () => raw.generate_hmac(data, key, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm, "HMAC result")
      );
    },
    verify_hmac: (data, hmac, key, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, "HMAC verification input", WASM_PLAINTEXT_MAX_BYTES);
          assertBytes(key, "HMAC verification key", WASM_KDF_INPUT_MAX_BYTES, 1);
          assertCanonicalLowerHex(
            hmac,
            "expected HMAC",
            checkedAlgorithm === "sha256" ? 32 : 64,
            checkedAlgorithm === "sha256" ? 32 : 64
          );
        },
        () => raw.verify_hmac(data, hmac, key, checkedAlgorithm),
        (value) => assertBoolean(value, "HMAC verification result")
      );
    },
    hash_with_pbkdf2: (data, salt, iterations) => callAfterPreflight(
      () => pbkdfParameters(data, salt, iterations),
      () => raw.hash_with_pbkdf2(data, salt, iterations),
      (value) => {
        assertCanonicalLowerHex(value, "PBKDF2 hash result", 32, 32);
        return value;
      }
    ),
    verify_pbkdf2: (data, expectedHash, salt, iterations) => callAfterPreflight(
      () => {
        pbkdfParameters(data, salt, iterations);
        assertCanonicalLowerHex(expectedHash, "expected PBKDF2 hash", 32, 32);
      },
      () => raw.verify_pbkdf2(data, expectedHash, salt, iterations),
      (value) => assertBoolean(value, "PBKDF2 verification result")
    ),
    generate_fingerprint: (data, length) => {
      const checkedLength = assertSafeInteger(
        length ?? 8,
        "fingerprint length",
        1,
        32
      );
      return callAfterPreflight(
        () => assertBytes(data, "fingerprint input", WASM_PLAINTEXT_MAX_BYTES),
        () => raw.generate_fingerprint(data, checkedLength),
        (value) => {
          assertCanonicalLowerHex(
            value,
            "fingerprint result",
            checkedLength,
            checkedLength
          );
          return value;
        }
      );
    },
    generate_safety_numbers: (data, groupSize) => {
      const checkedGroupSize = assertSafeInteger(
        groupSize ?? 5,
        "safety-number group size",
        1,
        32
      );
      return callAfterPreflight(
        () => assertBytes(data, "safety-number input", WASM_PLAINTEXT_MAX_BYTES),
        () => raw.generate_safety_numbers(data, checkedGroupSize),
        (value) => assertBoundedString(value, "safety-number result", 160)
      );
    },
    generate_salt: (length) => {
      const checkedLength = assertSafeInteger(
        length ?? 32,
        "salt length",
        16,
        1024
      );
      return callAfterPreflight(
        () => void 0,
        () => raw.generate_salt(checkedLength),
        (value) => validateBytesResult(
          value,
          "generated salt result",
          checkedLength,
          checkedLength
        )
      );
    },
    compress: (data, algorithm, level) => {
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      const checkedLevel = compressionLevel(checkedAlgorithm, level);
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(
            data,
            "compression input",
            WASM_PLAINTEXT_MAX_BYTES
          );
        },
        () => raw.compress(data, checkedAlgorithm, checkedLevel),
        (value) => validateCompressionResult(
          value,
          inputLength,
          checkedAlgorithm
        )
      );
    },
    decompress: (data, algorithm) => {
      if (typeof algorithm !== "string") {
        throw new Error("[voided-wasm] compression algorithm is required");
      }
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      return callAfterPreflight(
        () => assertBytes(
          data,
          "compressed input",
          WASM_PLAINTEXT_MAX_BYTES
        ),
        () => raw.decompress(data, checkedAlgorithm),
        (value) => validateBytesResult(
          value,
          "decompressed output",
          WASM_PLAINTEXT_MAX_BYTES
        )
      );
    },
    decompress_bounded: (data, algorithm, maxOutputBytes) => {
      if (typeof algorithm !== "string") {
        throw new Error("[voided-wasm] compression algorithm is required");
      }
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      let checkedMaxOutputBytes = 0;
      return callAfterPreflight(
        () => {
          assertBytes(
            data,
            "bounded compressed input",
            WASM_BOUNDED_DECOMPRESSION_MAX_BYTES
          );
          checkedMaxOutputBytes = assertSafeInteger(
            maxOutputBytes,
            "bounded decompression output limit",
            0,
            WASM_BOUNDED_DECOMPRESSION_MAX_BYTES
          );
        },
        () => raw.decompress_bounded(
          data,
          checkedAlgorithm,
          checkedMaxOutputBytes
        ),
        (value) => validateBytesResult(
          value,
          "bounded decompressed output",
          checkedMaxOutputBytes
        )
      );
    },
    fuse: (data, key, preset, chunkSize) => {
      const checkedPreset = fusedPreset(preset);
      const checkedChunkSize = optionalChunkSize(chunkSize);
      return callAfterPreflight(
        () => {
          assertBytes(data, "fused shell plaintext", WASM_PLAINTEXT_MAX_BYTES);
          assertExactBytes(key, "fused shell key", 32);
        },
        () => raw.fuse(data, key, checkedPreset, checkedChunkSize),
        (value) => validateBytesResult(
          value,
          "fused shell result",
          WASM_ARTIFACT_MAX_BYTES
        )
      );
    },
    unfuse: (data, key) => callAfterPreflight(
      () => {
        assertBytes(data, "fused shell input", WASM_ARTIFACT_MAX_BYTES);
        assertExactBytes(key, "fused shell key", 32);
        inspectFused2(data);
      },
      () => raw.unfuse(data, key),
      (value) => validateBytesResult(
        value,
        "unfused plaintext",
        WASM_PLAINTEXT_MAX_BYTES
      )
    ),
    inspectFused: inspectFused2,
    protect: (data, key, preset, compression, level, encryption, shellChunkSize) => {
      const expected = validateProtectOptions(
        preset,
        compression,
        level,
        encryption,
        shellChunkSize
      );
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(
            data,
            "protect plaintext",
            WASM_PLAINTEXT_MAX_BYTES
          );
          assertExactBytes(key, "protect key", 32);
        },
        () => raw.protect(
          data,
          key,
          expected.preset,
          expected.compression,
          level,
          expected.encryption,
          shellChunkSize
        ),
        (value) => validateReturnedProtectConfiguration(
          validateProtectResult(
            value,
            inputLength
          ),
          expected
        )
      );
    },
    open: (artifact, key) => callAfterPreflight(
      () => {
        assertBytes(
          artifact,
          "protected artifact input",
          WASM_ARTIFACT_MAX_BYTES
        );
        assertExactBytes(key, "protected artifact key", 32);
        inspectArtifact2(artifact);
      },
      () => raw.open(artifact, key),
      (value) => validateBytesResult(
        value,
        "opened artifact plaintext",
        WASM_PLAINTEXT_MAX_BYTES
      )
    ),
    inspectArtifact: inspectArtifact2,
    repackArtifact: (artifact, key, preset, compression, level, encryption, shellChunkSize) => {
      const expected = validateProtectOptions(
        preset,
        compression,
        level,
        encryption,
        shellChunkSize
      );
      let originalSize = 0;
      return callAfterPreflight(
        () => {
          assertBytes(
            artifact,
            "protected artifact input",
            WASM_ARTIFACT_MAX_BYTES
          );
          assertExactBytes(key, "protected artifact key", 32);
          originalSize = inspectArtifact2(artifact).originalSize;
        },
        () => raw.repackArtifact(
          artifact,
          key,
          expected.preset,
          expected.compression,
          level,
          expected.encryption,
          shellChunkSize
        ),
        (value) => validateReturnedProtectConfiguration(
          validateProtectResult(value, originalSize),
          expected
        )
      );
    },
    random_bytes: (length) => {
      const checkedLength = assertSafeInteger(
        length,
        "random byte length",
        1,
        WASM_RAW_MAX_BYTES
      );
      return callAfterPreflight(
        () => void 0,
        () => raw.random_bytes(checkedLength),
        (value) => validateBytesResult(
          value,
          "random byte result",
          checkedLength,
          checkedLength
        )
      );
    },
    base64_encode: (data) => {
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(data, "base64 input", WASM_RAW_MAX_BYTES);
        },
        () => raw.base64_encode(data),
        (value) => {
          assertCanonicalBase64(
            value,
            "base64 result",
            inputLength,
            inputLength
          );
          return value;
        }
      );
    },
    base64_decode: (encoded) => {
      let decodedLength = 0;
      return callAfterPreflight(
        () => {
          decodedLength = assertCanonicalBase64(
            encoded,
            "base64 input",
            WASM_RAW_MAX_BYTES
          );
        },
        () => raw.base64_decode(encoded),
        (value) => validateBytesResult(
          value,
          "base64 decoded result",
          decodedLength,
          decodedLength
        )
      );
    },
    hex_encode: (data) => {
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(data, "hex input", WASM_RAW_MAX_BYTES);
        },
        () => raw.hex_encode(data),
        (value) => {
          assertCanonicalLowerHex(
            value,
            "hex result",
            inputLength,
            inputLength
          );
          return value;
        }
      );
    },
    hex_decode: (encoded) => {
      let decodedLength = 0;
      return callAfterPreflight(
        () => {
          decodedLength = assertCanonicalLowerHex(
            encoded,
            "hex input",
            WASM_RAW_MAX_BYTES
          );
        },
        () => raw.hex_decode(encoded),
        (value) => validateBytesResult(
          value,
          "hex decoded result",
          decodedLength,
          decodedLength
        )
      );
    }
  };
}

// src/wasm/loader.ts
var configuredWasmGlueUrl = null;
var wasmInitializationStarted = false;
function normalizeWasmGlueUrl(value) {
  let raw;
  if (typeof value === "string") {
    raw = value;
  } else if (typeof URL !== "undefined" && value instanceof URL) {
    raw = value.href;
  } else {
    throw new Error("[voided-wasm] glueUrl must be a string or URL");
  }
  if (raw.length === 0 || raw.length > 4096) {
    throw new Error("[voided-wasm] glueUrl has an invalid length");
  }
  const browserBase = typeof document !== "undefined" && document.baseURI ? document.baseURI : typeof globalThis.location !== "undefined" ? globalThis.location.href : void 0;
  let parsed;
  try {
    parsed = browserBase ? new URL(raw, browserBase) : new URL(raw);
  } catch {
    throw new Error(
      "[voided-wasm] glueUrl must be absolute when no browser base URL is available"
    );
  }
  if (!["https:", "http:", "file:"].includes(parsed.protocol)) {
    throw new Error("[voided-wasm] glueUrl must use http, https, or file");
  }
  if (parsed.username || parsed.password) {
    throw new Error("[voided-wasm] glueUrl must not contain credentials");
  }
  if (!parsed.pathname.endsWith("/voided_wasm.js")) {
    throw new Error("[voided-wasm] glueUrl must end with /voided_wasm.js");
  }
  return parsed.href;
}
function applyWasmLoaderOptions(options, allowSameAfterStart) {
  if (!options || typeof options !== "object" || !Object.prototype.hasOwnProperty.call(options, "glueUrl") || Object.keys(options).length !== 1) {
    throw new Error("[voided-wasm] loader options must contain only glueUrl");
  }
  const normalized = normalizeWasmGlueUrl(options.glueUrl);
  if (wasmInitializationStarted) {
    if (allowSameAfterStart && normalized === configuredWasmGlueUrl) return;
    throw new Error(
      "[voided-wasm] WASM loader configuration cannot change after initialization has started"
    );
  }
  if (configuredWasmGlueUrl !== null && configuredWasmGlueUrl !== normalized) {
    throw new Error("[voided-wasm] WASM glue URL is already configured");
  }
  configuredWasmGlueUrl = normalized;
}
function configureWasmLoader(options) {
  applyWasmLoaderOptions(options, false);
}
function runtimeModuleSpecifier(...segments) {
  return segments.join("/");
}
async function importWasmBindings() {
  if (configuredWasmGlueUrl !== null) {
    try {
      return await import(
        /* @vite-ignore */
        configuredWasmGlueUrl
      );
    } catch {
      throw new Error(
        "[voided-wasm] Could not load the configured WASM glue module; no package-relative fallback was attempted"
      );
    }
  }
  try {
    const nestedBindingsPath = runtimeModuleSpecifier(
      "..",
      "..",
      "wasm",
      "voided_wasm.js"
    );
    return await import(
      /* @vite-ignore */
      nestedBindingsPath
    );
  } catch (nestedError) {
    try {
      const rootBundleBindingsPath = runtimeModuleSpecifier(
        "..",
        "wasm",
        "voided_wasm.js"
      );
      return await import(
        /* @vite-ignore */
        rootBundleBindingsPath
      );
    } catch (rootError) {
      const nestedDetail = nestedError instanceof Error ? nestedError.message : String(nestedError);
      const rootDetail = rootError instanceof Error ? rootError.message : String(rootError);
      throw new Error(
        `[voided-wasm] Could not load packaged WASM bindings (${nestedDetail}; ${rootDetail})`
      );
    }
  }
}
function getExportFn(mod, names) {
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === "function") {
      return candidate;
    }
  }
  throw new Error(`[voided-wasm] Missing WASM export: ${names.join(" | ")}`);
}
function normalizeCompressionResult(result) {
  return {
    compressed: result.compressed,
    algorithm: result.algorithm,
    originalSize: result.originalSize ?? result.original_size,
    compressedSize: result.compressedSize ?? result.compressed_size,
    compressionRatio: result.compressionRatio ?? result.compression_ratio
  };
}
function normalizeFusedShellInfo(result) {
  return {
    version: result.version,
    preset: result.preset,
    chunkSize: result.chunkSize ?? result.chunk_size,
    chunkCount: result.chunkCount ?? result.chunk_count,
    payloadSize: result.payloadSize ?? result.payload_size,
    shellSize: result.shellSize ?? result.shell_size,
    metadataSize: result.metadataSize ?? result.metadata_size,
    tagSize: result.tagSize ?? result.tag_size
  };
}
function normalizeProtectedArtifactInfo(result) {
  return {
    version: result.version,
    preset: result.preset,
    compressionAlgorithm: result.compressionAlgorithm ?? result.compression_algorithm,
    encryptionAlgorithm: result.encryptionAlgorithm ?? result.encryption_algorithm,
    originalSize: result.originalSize ?? result.original_size,
    compressedSize: result.compressedSize ?? result.compressed_size,
    encryptedSize: result.encryptedSize ?? result.encrypted_size,
    protectedSize: result.protectedSize ?? result.protected_size,
    shellChunkSize: result.shellChunkSize ?? result.shell_chunk_size,
    shellChunkCount: result.shellChunkCount ?? result.shell_chunk_count,
    shellNonce: result.shellNonce ?? result.shell_nonce
  };
}
function normalizeProtectResult(result) {
  return {
    artifact: result.artifact,
    ...normalizeProtectedArtifactInfo(result)
  };
}
function normalizeRecoveryDeckSetup(result) {
  return {
    deck: result.deck,
    rootWrapper: result.rootWrapper ?? result.root_wrapper
  };
}
function normalizeWasmModule(mod) {
  const version = getExportFn(mod, ["version", "VERSION"]);
  const generateKey2 = getExportFn(mod, ["generate_key", "generateKey"]);
  const encryptFn = getExportFn(mod, ["encrypt"]);
  const decryptFn = getExportFn(mod, ["decrypt"]);
  const encryptWithAadFn = getExportFn(mod, ["encryptWithAad", "encrypt_with_aad"]);
  const decryptWithAadFn = getExportFn(mod, ["decryptWithAad", "decrypt_with_aad"]);
  const deriveHkdf = getExportFn(mod, ["derive_key_hkdf", "deriveKeyHkdf"]);
  const derivePbkdf2 = getExportFn(mod, ["derive_key_pbkdf2", "deriveKeyPbkdf2"]);
  const hashFn = getExportFn(mod, ["hash"]);
  const hashWithSaltFn = getExportFn(mod, ["hash_with_salt", "hashWithSalt"]);
  const compareHashes2 = getExportFn(
    mod,
    ["compare_hashes", "compareHashes"]
  );
  const generateHmac2 = getExportFn(mod, ["generate_hmac", "generateHmac"]);
  const generateFingerprint2 = getExportFn(mod, ["generate_fingerprint", "generateFingerprint"]);
  const generateSafetyNumbers2 = getExportFn(mod, ["generate_safety_numbers", "generateSafetyNumbers"]);
  const generateSalt2 = getExportFn(mod, ["generate_salt", "generateSalt"]);
  const compressFn = getExportFn(mod, ["compress"]);
  const decompressFn = getExportFn(mod, ["decompress"]);
  const decompressBoundedFn = getExportFn(mod, ["decompressBounded", "decompress_bounded"]);
  const fuseFn = getExportFn(
    mod,
    ["fuse"]
  );
  const unfuseFn = getExportFn(mod, ["unfuse"]);
  const inspectFusedFn = getExportFn(mod, ["inspectFused", "inspect_fused"]);
  const protectFn = getExportFn(mod, ["protect"]);
  const openFn = getExportFn(mod, ["open"]);
  const inspectArtifactFn = getExportFn(mod, ["inspectArtifact", "inspect_artifact"]);
  const repackArtifactFn = getExportFn(mod, ["repackArtifact", "repack_artifact"]);
  const randomBytes2 = getExportFn(mod, ["random_bytes", "randomBytes"]);
  const base64Encode3 = getExportFn(mod, ["base64_encode", "base64Encode"]);
  const base64Decode3 = getExportFn(mod, ["base64_decode", "base64Decode"]);
  const hexEncode2 = getExportFn(mod, ["hex_encode", "hexEncode"]);
  const hexDecode2 = getExportFn(mod, ["hex_decode", "hexDecode"]);
  const deriveHkdfRaw = mod.derive_key_hkdf_raw || mod.deriveKeyHkdfRaw;
  const generateX25519 = mod.generate_x25519_key_pair || mod.generateX25519KeyPair;
  const x25519SharedSecret = mod.x25519_shared_secret || mod.x25519SharedSecret;
  const deriveFromSharedSecret = mod.derive_key_from_shared_secret || mod.deriveKeyFromSharedSecret;
  const generateRecoveryDeck2 = mod.generate_recovery_deck || mod.generateRecoveryDeck;
  const validateRecoveryDeck2 = mod.validate_recovery_deck || mod.validateRecoveryDeck;
  const encodeRecoveryDeck2 = mod.encode_recovery_deck || mod.encodeRecoveryDeck;
  const deriveRecoveryKey2 = mod.derive_recovery_key || mod.deriveRecoveryKey;
  const wrapRootWithRecoveryKey2 = mod.wrap_root_with_recovery_key || mod.wrapRootWithRecoveryKey;
  const unwrapRootWithRecoveryKey2 = mod.unwrap_root_with_recovery_key || mod.unwrapRootWithRecoveryKey;
  const createRecoveryDeck2 = mod.create_recovery_deck || mod.createRecoveryDeck;
  const rotateRecoveryDeck2 = mod.rotate_recovery_deck || mod.rotateRecoveryDeck;
  return {
    version: () => version(),
    generate_key: () => generateKey2(),
    encrypt: (data, key, algorithm) => encryptFn(data, key, algorithm),
    decrypt: (ciphertext, nonce, tag, key, algorithm) => decryptFn({ ciphertext, nonce, tag, algorithm }, key),
    encrypt_with_aad: (data, key, aad, algorithm) => encryptWithAadFn(data, key, aad, algorithm),
    decrypt_with_aad: (ciphertext, nonce, tag, key, algorithm, aad) => decryptWithAadFn({ ciphertext, nonce, tag, algorithm }, key, aad),
    derive_key_hkdf: (ikm, salt, info) => deriveHkdf(ikm, salt, info),
    derive_key_hkdf_raw: deriveHkdfRaw ? (ikm, salt, info, length) => deriveHkdfRaw(ikm, salt, info, length) : void 0,
    derive_key_pbkdf2: (password, salt, iterations) => derivePbkdf2(password, salt, iterations),
    generate_recovery_deck: generateRecoveryDeck2 ? () => generateRecoveryDeck2() : void 0,
    validate_recovery_deck: validateRecoveryDeck2 ? (deck) => validateRecoveryDeck2(deck) : void 0,
    encode_recovery_deck: encodeRecoveryDeck2 ? (deck) => encodeRecoveryDeck2(deck) : void 0,
    derive_recovery_key: deriveRecoveryKey2 ? (deck) => deriveRecoveryKey2(deck) : void 0,
    wrap_root_with_recovery_key: wrapRootWithRecoveryKey2 ? (rootKey, recoveryKey) => wrapRootWithRecoveryKey2(rootKey, recoveryKey) : void 0,
    unwrap_root_with_recovery_key: unwrapRootWithRecoveryKey2 ? (rootWrapper, recoveryKey) => unwrapRootWithRecoveryKey2(rootWrapper, recoveryKey) : void 0,
    create_recovery_deck: createRecoveryDeck2 ? (rootKey) => normalizeRecoveryDeckSetup(createRecoveryDeck2(rootKey)) : void 0,
    rotate_recovery_deck: rotateRecoveryDeck2 ? (rootWrapper, oldDeck) => normalizeRecoveryDeckSetup(rotateRecoveryDeck2(rootWrapper, oldDeck)) : void 0,
    generate_x25519_key_pair: generateX25519 ? (seed) => generateX25519(seed ?? null) : void 0,
    x25519_shared_secret: x25519SharedSecret ? (ourPrivateKey, theirPublicKey) => x25519SharedSecret(ourPrivateKey, theirPublicKey) : void 0,
    derive_key_from_shared_secret: deriveFromSharedSecret ? (sharedSecret, salt, info) => deriveFromSharedSecret(sharedSecret, salt, info) : void 0,
    hash: (data, algorithm) => hashFn(data, algorithm),
    hash_with_salt: (data, salt, algorithm) => hashWithSaltFn(data, salt, algorithm),
    compare_hashes: (a, b) => compareHashes2(a, b),
    generate_hmac: (data, key, algorithm) => generateHmac2(data, key, algorithm),
    verify_hmac: (data, hmac, key, algorithm) => {
      const verify = mod.verify_hmac || mod.verifyHmac;
      if (typeof verify !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: verify_hmac | verifyHmac");
      }
      return verify(data, hmac, key, algorithm);
    },
    hash_with_pbkdf2: (data, salt, iterations) => {
      const hashWithPbkdf2 = mod.hash_with_pbkdf2 || mod.hashWithPbkdf2;
      if (typeof hashWithPbkdf2 !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: hash_with_pbkdf2 | hashWithPbkdf2");
      }
      return hashWithPbkdf2(data, salt, iterations);
    },
    verify_pbkdf2: (data, expectedHash, salt, iterations) => {
      const verifyPbkdf2 = mod.verify_pbkdf2 || mod.verifyPbkdf2;
      if (typeof verifyPbkdf2 !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: verify_pbkdf2 | verifyPbkdf2");
      }
      return verifyPbkdf2(data, expectedHash, salt, iterations);
    },
    generate_fingerprint: (data, length) => generateFingerprint2(data, length),
    generate_safety_numbers: (data, groupSize) => generateSafetyNumbers2(data, groupSize),
    generate_salt: (length) => generateSalt2(length),
    compress: (data, algorithm, level) => normalizeCompressionResult(compressFn(data, algorithm, level)),
    decompress: (data, algorithm) => decompressFn(data, algorithm),
    decompress_bounded: (data, algorithm, maxOutputBytes) => decompressBoundedFn(data, algorithm, maxOutputBytes),
    fuse: (data, key, preset, chunkSize) => fuseFn(data, key, preset, chunkSize),
    unfuse: (data, key) => unfuseFn(data, key),
    inspectFused: (data) => normalizeFusedShellInfo(inspectFusedFn(data)),
    protect: (data, key, preset, compressionAlgorithm2, compressionLevel2, encryptionAlgorithm, shellChunkSize) => normalizeProtectResult(
      protectFn(
        data,
        key,
        preset,
        compressionAlgorithm2,
        compressionLevel2,
        encryptionAlgorithm,
        shellChunkSize
      )
    ),
    open: (artifact, key) => openFn(artifact, key),
    inspectArtifact: (artifact) => normalizeProtectedArtifactInfo(inspectArtifactFn(artifact)),
    repackArtifact: (artifact, key, preset, compressionAlgorithm2, compressionLevel2, encryptionAlgorithm, shellChunkSize) => normalizeProtectResult(
      repackArtifactFn(
        artifact,
        key,
        preset,
        compressionAlgorithm2,
        compressionLevel2,
        encryptionAlgorithm,
        shellChunkSize
      )
    ),
    random_bytes: (length) => randomBytes2(length),
    base64_encode: (data) => base64Encode3(data),
    base64_decode: (encoded) => base64Decode3(encoded),
    hex_encode: (data) => hexEncode2(data),
    hex_decode: (encoded) => hexDecode2(encoded)
  };
}
var wasmModule = null;
var initPromise = null;
var initError = null;
var isNode = typeof window === "undefined" && typeof process !== "undefined" && process.versions?.node;
async function initWasm(options) {
  if (options !== void 0) {
    applyWasmLoaderOptions(options, true);
  }
  if (wasmModule) {
    return wasmModule;
  }
  if (initError) {
    throw initError;
  }
  wasmInitializationStarted = true;
  if (isNode) {
    initError = new Error("WASM not available in Node.js - use TypeScript fallback");
    throw initError;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const mod = await importWasmBindings();
      if (typeof mod.default === "function") {
        await mod.default();
      }
      wasmModule = secureWasmModule(
        normalizeWasmModule(mod)
      );
      return wasmModule;
    } catch (err2) {
      initError = err2 instanceof Error ? err2 : new Error(String(err2));
      throw initError;
    }
  })();
  return initPromise;
}
async function getWasm() {
  if (wasmModule) {
    return wasmModule;
  }
  return initWasm();
}
function isWasmReady() {
  return wasmModule !== null;
}
function getWasmError() {
  return initError;
}
function getWasmSync() {
  if (!wasmModule) {
    throw new Error(
      "[voided-wasm] WASM module not initialized. Call initWasm() or use getWasm() before accessing synchronously."
    );
  }
  return wasmModule;
}

// src/errors.ts
var E2EEError = class extends Error {
  constructor(message, code, recoverable = false) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
    this.name = "E2EEError";
  }
};
var ValidationError = class extends E2EEError {
  constructor(message) {
    super(message, "VALIDATION_ERROR", true);
    this.name = "ValidationError";
  }
};
var CryptoError = class extends E2EEError {
  constructor(message) {
    super(message, "CRYPTO_ERROR", false);
    this.name = "CryptoError";
  }
};
var KeyError = class extends E2EEError {
  constructor(message) {
    super(message, "KEY_ERROR", false);
    this.name = "KeyError";
  }
};
var Validator = class {
  static validateBase64(value, label, maxDecodedBytes) {
    const inspection = inspectCanonicalBase64(value, maxDecodedBytes);
    if (!inspection.ok && inspection.reason === "too-large") {
      throw new ValidationError(`Invalid encrypted blob: ${label} exceeds its size limit`);
    }
    if (!inspection.ok) {
      throw new ValidationError(`Invalid encrypted blob: ${label} is not canonical base64`);
    }
    return inspection.decodedLength;
  }
  /**
   * Validate data for encryption
   */
  static validateData(data) {
    if (typeof data !== "string") {
      throw new ValidationError("Data must be a string");
    }
    if (data.length < this.MIN_DATA_SIZE) {
      throw new ValidationError("Data cannot be empty");
    }
    if (data.length > this.MAX_DATA_SIZE) {
      throw new ValidationError(`Data too large (max ${this.MAX_DATA_SIZE / 1024 / 1024}MB)`);
    }
  }
  /**
   * Validate encrypted blob (supports both chunked and non-chunked data)
   */
  static validateEncryptedBlob(blob) {
    if (!blob || typeof blob !== "object" || Array.isArray(blob)) {
      throw new ValidationError("Invalid encrypted blob: must be an object");
    }
    if (blob.algorithm !== "AES-GCM") {
      throw new ValidationError("Invalid encrypted blob: unsupported algorithm");
    }
    if (blob.version !== "1.1") {
      throw new ValidationError(
        "Invalid encrypted blob: only the authenticated 1.1 envelope is supported"
      );
    }
    this.validateKeyId(blob.keyId);
    if (this.validateBase64(blob.messageId, "messageId", 16) !== 16) {
      throw new ValidationError("Invalid encrypted blob: messageId must contain 16 bytes");
    }
    if (blob.ephemeralPublicKey !== void 0) {
      throw new ValidationError(
        "Invalid encrypted blob: legacy ephemeralPublicKey envelopes are unsupported"
      );
    }
    if (blob.textEncoding !== "utf8" && blob.textEncoding !== "utf16le") {
      throw new ValidationError("Invalid encrypted blob: unsupported text encoding");
    }
    if (!blob.compression || typeof blob.compression !== "object") {
      throw new ValidationError("Invalid encrypted blob: compression info required");
    }
    if (!["gzip", "brotli", "none"].includes(blob.compression.algorithm)) {
      throw new ValidationError("Invalid encrypted blob: unsupported compression algorithm");
    }
    for (const field of ["originalSize", "compressedSize"]) {
      const value = blob.compression[field];
      if (!Number.isSafeInteger(value) || value < 1 || value > this.MAX_DATA_SIZE) {
        throw new ValidationError(`Invalid encrypted blob: invalid ${field}`);
      }
    }
    if (blob.signature !== void 0) {
      this.validateBase64(blob.signature, "signature", 1024);
    }
    let aggregateEncodedSize = 0;
    if (blob.chunkInfo?.isChunked === true) {
      const chunkInfo = blob.chunkInfo;
      if (!Number.isSafeInteger(chunkInfo.totalChunks) || chunkInfo.totalChunks < 1 || chunkInfo.totalChunks > this.MAX_CHUNKS) {
        throw new ValidationError("Invalid encrypted blob: invalid totalChunks");
      }
      if (!Number.isSafeInteger(chunkInfo.chunkSize) || chunkInfo.chunkSize < this.MIN_CHUNK_SIZE || chunkInfo.chunkSize > this.MAX_CHUNK_SIZE) {
        throw new ValidationError("Invalid encrypted blob: invalid chunkSize");
      }
      if (!Array.isArray(blob.chunks) || blob.chunks.length !== chunkInfo.totalChunks) {
        throw new ValidationError(
          "Invalid encrypted blob: chunk count does not match totalChunks"
        );
      }
      if (blob.data !== void 0 || blob.iv !== void 0) {
        throw new ValidationError(
          "Invalid encrypted blob: chunked envelopes cannot contain top-level data or iv"
        );
      }
      let totalPlaintextSize = 0;
      for (let index = 0; index < blob.chunks.length; index++) {
        const chunk = blob.chunks[index];
        if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
          throw new ValidationError(
            `Invalid encrypted blob: chunk ${index} must be an object`
          );
        }
        if (chunk.index !== index) {
          throw new ValidationError(
            `Invalid encrypted blob: chunk ${index} has a non-canonical index`
          );
        }
        if (!Number.isSafeInteger(chunk.plaintextSize) || chunk.plaintextSize < 1 || chunk.plaintextSize > chunkInfo.chunkSize) {
          throw new ValidationError(
            `Invalid encrypted blob: chunk ${index} has invalid plaintextSize`
          );
        }
        const encryptedLength = this.validateBase64(
          chunk.data,
          `chunk ${index} data`,
          this.MAX_CHUNK_SIZE + 12 + 16
        );
        if (encryptedLength !== chunk.plaintextSize + 12 + 16) {
          throw new ValidationError(
            `Invalid encrypted blob: chunk ${index} ciphertext size is inconsistent`
          );
        }
        if (this.validateBase64(chunk.iv, `chunk ${index} iv`, 12) !== 12) {
          throw new ValidationError(
            `Invalid encrypted blob: chunk ${index} iv must contain 12 bytes`
          );
        }
        if (chunk.signature !== void 0) {
          this.validateBase64(
            chunk.signature,
            `chunk ${index} signature`,
            1024
          );
        }
        totalPlaintextSize += chunk.plaintextSize;
        aggregateEncodedSize += chunk.data.length + chunk.iv.length + (chunk.signature?.length ?? 0);
      }
      if (totalPlaintextSize !== blob.compression.compressedSize) {
        throw new ValidationError(
          "Invalid encrypted blob: chunk sizes do not match compressedSize"
        );
      }
    } else {
      if (blob.chunkInfo !== void 0 || blob.chunks !== void 0) {
        throw new ValidationError(
          "Invalid encrypted blob: malformed chunk framing"
        );
      }
      const encryptedLength = this.validateBase64(
        blob.data,
        "data",
        this.MAX_DATA_SIZE + 12 + 16
      );
      if (encryptedLength !== blob.compression.compressedSize + 12 + 16) {
        throw new ValidationError(
          "Invalid encrypted blob: ciphertext size is inconsistent"
        );
      }
      if (this.validateBase64(blob.iv, "iv", 12) !== 12) {
        throw new ValidationError(
          "Invalid encrypted blob: iv must contain 12 bytes"
        );
      }
      aggregateEncodedSize = blob.data.length + blob.iv.length + (blob.signature?.length ?? 0);
    }
    if (aggregateEncodedSize > this.MAX_ENCODED_BLOB_SIZE) {
      throw new ValidationError(
        "Invalid encrypted blob: aggregate encoded size exceeds browser limit"
      );
    }
  }
  /**
   * Validate a current VOF3 monolith protected blob
   */
  static validateProtectedBlob(blob) {
    if (!blob || typeof blob !== "object") {
      throw new ValidationError("Invalid protected blob: must be an object");
    }
    this.validateBase64(blob.artifact, "artifact", this.MAX_ENCODED_BLOB_SIZE);
    this.validateKeyId(blob.keyId);
    if (blob.version !== "2.0") {
      throw new ValidationError("Invalid protected blob: unsupported version");
    }
    if (blob.pipeline !== "compression->encryption->fused-shell") {
      throw new ValidationError("Invalid protected blob: unsupported pipeline");
    }
    const validPresets = ["compact", "balanced", "concealed"];
    if (!validPresets.includes(blob.preset)) {
      throw new ValidationError("Invalid protected blob: unsupported preset");
    }
    if (!blob.compression || typeof blob.compression !== "object") {
      throw new ValidationError("Invalid protected blob: compression info required");
    }
    const validCompressionAlgorithms = ["gzip", "brotli", "none"];
    if (!validCompressionAlgorithms.includes(blob.compression.algorithm)) {
      throw new ValidationError("Invalid protected blob: unsupported compression algorithm");
    }
    if (!Number.isSafeInteger(blob.compression.originalSize) || blob.compression.originalSize < 0 || blob.compression.originalSize > this.MAX_DATA_SIZE) {
      throw new ValidationError("Invalid protected blob: invalid originalSize");
    }
    if (!Number.isSafeInteger(blob.compression.compressedSize) || blob.compression.compressedSize < 0 || blob.compression.compressedSize > this.MAX_ENCODED_BLOB_SIZE) {
      throw new ValidationError("Invalid protected blob: invalid compressedSize");
    }
    const validEncryptionAlgorithms = ["aes-256-gcm", "xchacha20-poly1305"];
    if (!validEncryptionAlgorithms.includes(blob.encryptionAlgorithm)) {
      throw new ValidationError("Invalid protected blob: unsupported encryption algorithm");
    }
    if (!blob.shell || typeof blob.shell !== "object") {
      throw new ValidationError("Invalid protected blob: shell info required");
    }
    if (!Number.isSafeInteger(blob.shell.chunkSize) || blob.shell.chunkSize <= 0 || blob.shell.chunkSize > this.MAX_CHUNK_SIZE) {
      throw new ValidationError("Invalid protected blob: invalid shell chunk size");
    }
    if (!Number.isSafeInteger(blob.shell.chunkCount) || blob.shell.chunkCount < 0 || blob.shell.chunkCount > this.MAX_CHUNKS) {
      throw new ValidationError("Invalid protected blob: invalid shell chunk count");
    }
    if (!Number.isSafeInteger(blob.protectedSize) || blob.protectedSize <= 0 || blob.protectedSize > this.MAX_ENCODED_BLOB_SIZE) {
      throw new ValidationError("Invalid protected blob: invalid protected size");
    }
    if (blob.textEncoding !== void 0 && blob.textEncoding !== "utf8" && blob.textEncoding !== "utf16le") {
      throw new ValidationError("Invalid protected blob: unsupported text encoding");
    }
  }
  /**
   * Validate key string
   */
  static validateKeyString(keyString) {
    if (typeof keyString !== "string") {
      throw new ValidationError("Key must be a string");
    }
    const inspection = inspectCanonicalBase64(keyString, 32);
    if (!inspection.ok || inspection.decodedLength !== 32) {
      throw new ValidationError("Invalid key format (expected canonical 32-byte base64)");
    }
  }
  /**
   * Validate key ID
   */
  static validateKeyId(keyId) {
    if (typeof keyId !== "string") {
      throw new ValidationError("Key ID must be a string");
    }
    if (keyId.length === 0) {
      throw new ValidationError("Key ID cannot be empty");
    }
    if (keyId.length > this.MAX_KEY_ID_LENGTH) {
      throw new ValidationError(`Key ID too long (max ${this.MAX_KEY_ID_LENGTH} characters)`);
    }
    if (keyId.includes("::voided:") || /[\u0000-\u001f\u007f]/.test(keyId)) {
      throw new ValidationError("Key ID contains a reserved namespace or control character");
    }
  }
  /**
   * Validate rotation options
   */
  static validateRotationOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new ValidationError("Rotation options must be an object");
    }
    if ("force" in options && typeof options.force !== "boolean") {
      throw new ValidationError("force option must be a boolean");
    }
    if ("migrate" in options && typeof options.migrate !== "boolean") {
      throw new ValidationError("migrate option must be a boolean");
    }
    if ("cutoffTime" in options) {
      if (!(options.cutoffTime instanceof Date) || !Number.isFinite(options.cutoffTime.getTime())) {
        throw new ValidationError("cutoffTime must be a Date object");
      }
    }
  }
};
Validator.MAX_DATA_SIZE = 100 * 1024 * 1024;
// 100 MiB
Validator.MAX_ENCODED_BLOB_SIZE = 140 * 1024 * 1024;
Validator.MAX_CHUNKS = 128;
Validator.MIN_CHUNK_SIZE = 64 * 1024;
Validator.MAX_CHUNK_SIZE = 8 * 1024 * 1024;
Validator.MIN_DATA_SIZE = 1;
Validator.MAX_KEY_ID_LENGTH = 256;

// src/limits.ts
var CLIENT_MAX_UPLOAD_BYTES = 4294967295;
var CLIENT_MAX_UPLOAD_HUMAN = "4 GiB - 1 byte";
var CLIENT_MAX_IN_MEMORY_BYTES = 100 * 1024 * 1024;
var CLIENT_MAX_ENCODED_BLOB_BYTES = 140 * 1024 * 1024;
var CLIENT_MAX_CHUNKS = 128;
var CLIENT_MIN_CHUNK_BYTES = 64 * 1024;
var CLIENT_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
var CLIENT_CHUNK_CONCURRENCY = 4;
var VOI_FILE_TOO_LARGE = "VOI_FILE_TOO_LARGE";
function assertWithinClientUploadLimit(sizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new E2EEError(
      "Upload size must be a non-negative safe integer.",
      VOI_FILE_TOO_LARGE,
      false
    );
  }
  if (sizeBytes > CLIENT_MAX_UPLOAD_BYTES) {
    throw new E2EEError(
      `Client-side uploads support up to ${CLIENT_MAX_UPLOAD_HUMAN} per file.`,
      VOI_FILE_TOO_LARGE,
      false
    );
  }
}
function assertWithinClientMemoryLimit(sizeBytes, label = "Data") {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new E2EEError(
      `${label} size must be a non-negative safe integer.`,
      VOI_FILE_TOO_LARGE,
      false
    );
  }
  if (sizeBytes > CLIENT_MAX_IN_MEMORY_BYTES) {
    throw new E2EEError(
      `${label} exceeds the ${CLIENT_MAX_IN_MEMORY_BYTES / 1024 / 1024} MiB browser in-memory limit.`,
      VOI_FILE_TOO_LARGE,
      false
    );
  }
}

// src/crypto-service.ts
var toBuffer = (data) => data instanceof Uint8Array ? data : new Uint8Array(data);
var X25519_PKCS8_PREFIX = Uint8Array.from([
  48,
  46,
  2,
  1,
  0,
  48,
  5,
  6,
  3,
  43,
  101,
  110,
  4,
  34,
  4,
  32
]);
var X25519_BASEPOINT = (() => {
  const point = new Uint8Array(32);
  point[0] = 9;
  return point;
})();
var HKDF_SHA256_MAX_OUTPUT = 255 * 32;
var KDF_MAX_INPUT_BYTES = 1024 * 1024;
var SHARED_SECRET_CONTEXT_MAX_BYTES = 1024;
var PBKDF2_MIN_ITERATIONS = 1e5;
var PBKDF2_MAX_ITERATIONS = 1e6;
var PBKDF2_MIN_SALT_BYTES = 16;
var PBKDF2_MAX_SALT_BYTES = 1024;
var MAX_P256_SPKI_BYTES = 1024;
var MAX_P256_SPKI_BASE64_CHARS = 4 * Math.ceil(MAX_P256_SPKI_BYTES / 3);
var AES_GCM_IV_BYTES = 12;
var AES_GCM_TAG_BYTES = 16;
var AES_GCM_FIXED_OVERHEAD_BYTES = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
var CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
var TYPED_ARRAY_BYTE_LENGTH_GETTER2 = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength"
)?.get;
function getUint8ArrayByteLength(value, label) {
  if (!(value instanceof Uint8Array) || !ArrayBuffer.isView(value) || !TYPED_ARRAY_BYTE_LENGTH_GETTER2) {
    throw new CryptoError(`${label} must be a Uint8Array`);
  }
  try {
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER2, value, []);
  } catch {
    throw new CryptoError(`${label} must be a valid Uint8Array`);
  }
}
function getOptionalUint8ArrayByteLength(value, label) {
  return value === void 0 ? 0 : getUint8ArrayByteLength(value, label);
}
function assertAesGcmMemoryBudget(inputBytes, additionalDataBytes, label) {
  assertWithinClientMemoryLimit(
    inputBytes + additionalDataBytes + AES_GCM_FIXED_OVERHEAD_BYTES,
    `${label} plus AES-GCM IV/tag overhead`
  );
}
var X25519AgreementRejectedError = class extends CryptoError {
  constructor(detail) {
    super(`X25519 agreement rejected: ${detail}`);
    this.name = "X25519AgreementRejectedError";
  }
};
var CryptoService = class {
  constructor() {
    this.textEncoder = new TextEncoder();
  }
  /**
   * Generate a new AES-256-GCM encryption key (CryptoKey)
   */
  async generateKey() {
    try {
      return await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        // extractable
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Failed to generate key: ${error}`);
    }
  }
  /**
   * Generate raw key bytes (32 bytes for AES-256)
   */
  generateKeyBytes() {
    return crypto.getRandomValues(new Uint8Array(32));
  }
  /**
   * Export key to base64 string
   */
  async exportKey(key) {
    let rawKey = null;
    try {
      rawKey = await crypto.subtle.exportKey("raw", key);
      return this.arrayBufferToBase64(rawKey);
    } catch (error) {
      throw new CryptoError(`Failed to export key: ${error}`);
    } finally {
      if (rawKey) this.secureWipe(rawKey);
    }
  }
  /**
   * Import key from base64 string
   */
  async importKey(keyString) {
    try {
      if (typeof keyString !== "string" || keyString.length !== 44 || !/^[A-Za-z0-9+/]{43}=$/.test(keyString)) {
        throw new CryptoError("AES-256 key must be canonical base64 encoding exactly 32 bytes");
      }
      const rawKey = this.base64ToArrayBuffer(keyString);
      if (rawKey.byteLength !== 32 || this.arrayBufferToBase64(rawKey) !== keyString) {
        this.secureWipe(rawKey);
        throw new CryptoError("AES-256 key must be canonical base64 encoding exactly 32 bytes");
      }
      try {
        return await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
      } finally {
        this.secureWipe(rawKey);
      }
    } catch (error) {
      throw new CryptoError(`Failed to import key: ${error}`);
    }
  }
  /**
   * Encrypt data with CryptoKey
   */
  async encrypt(data, key, additionalData) {
    try {
      const dataBytes = getUint8ArrayByteLength(data, "Encryption input");
      const additionalDataBytes = getOptionalUint8ArrayByteLength(
        additionalData,
        "Encryption additional data"
      );
      assertAesGcmMemoryBudget(dataBytes, additionalDataBytes, "Encryption input");
      assertWithinClientUploadLimit(dataBytes);
      const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
      const algorithm = {
        name: "AES-GCM",
        iv: toBuffer(iv),
        tagLength: 128
      };
      if (additionalData !== void 0) {
        algorithm.additionalData = toBuffer(additionalData);
      }
      const ciphertext = await crypto.subtle.encrypt(
        algorithm,
        key,
        toBuffer(data)
      );
      const result = new Uint8Array(iv.length + ciphertext.byteLength);
      result.set(iv, 0);
      result.set(new Uint8Array(ciphertext), iv.length);
      return result.buffer;
    } catch (error) {
      throw new CryptoError(`Encryption failed: ${error}`);
    }
  }
  /**
   * Decrypt data with CryptoKey
   */
  async decrypt(encryptedData, iv, key, additionalData, encryptedDataIncludesIv = true) {
    try {
      const encryptedDataBytes = getUint8ArrayByteLength(
        encryptedData,
        "Encrypted input"
      );
      const ivBytes = getUint8ArrayByteLength(iv, "AES-GCM IV");
      const additionalDataBytes = getOptionalUint8ArrayByteLength(
        additionalData,
        "Decryption additional data"
      );
      if (typeof encryptedDataIncludesIv !== "boolean") {
        throw new CryptoError("encryptedDataIncludesIv must be a boolean");
      }
      if (ivBytes !== AES_GCM_IV_BYTES) {
        throw new CryptoError("AES-GCM IV must contain exactly 12 bytes");
      }
      assertAesGcmMemoryBudget(
        encryptedDataBytes,
        additionalDataBytes,
        "Encrypted input"
      );
      const minimumEncryptedBytes = AES_GCM_TAG_BYTES + (encryptedDataIncludesIv ? AES_GCM_IV_BYTES : 0);
      if (encryptedDataBytes < minimumEncryptedBytes) {
        throw new CryptoError(
          `Encrypted payload must contain at least ${minimumEncryptedBytes} bytes including its AES-GCM tag`
        );
      }
      let actualData = encryptedData;
      if (encryptedDataIncludesIv) {
        let difference = 0;
        for (let index = 0; index < AES_GCM_IV_BYTES; index++) {
          difference |= encryptedData[index] ^ iv[index];
        }
        if (difference !== 0) {
          throw new CryptoError("Encrypted IV prefix does not match the envelope IV");
        }
        actualData = encryptedData.subarray(AES_GCM_IV_BYTES);
      }
      const algorithm = {
        name: "AES-GCM",
        iv: toBuffer(iv),
        tagLength: 128
      };
      if (additionalData !== void 0) {
        algorithm.additionalData = toBuffer(additionalData);
      }
      const plaintext = await crypto.subtle.decrypt(
        algorithm,
        key,
        toBuffer(actualData)
      );
      return new Uint8Array(plaintext);
    } catch (error) {
      throw new CryptoError(`Decryption failed: ${error}`);
    }
  }
  /**
   * HKDF-SHA256 key derivation returning an AES-GCM key.
   */
  async hkdfDerive(ikm, salt, info, length = 256) {
    if (![128, 192, 256].includes(length)) {
      throw new CryptoError(
        `HKDF deriveKey requires AES length 128/192/256, received ${length}`
      );
    }
    const [ikmBytes, saltBytes, infoBytes] = this.copyAndValidateKdfInputs(
      ikm,
      salt,
      info
    );
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikmBytes),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );
      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          info: toBuffer(infoBytes)
        },
        baseKey,
        { name: "AES-GCM", length },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`HKDF deriveKey failed: ${error}`);
    } finally {
      this.secureWipe(ikmBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
    }
  }
  /**
   * HKDF-SHA256 key derivation returning raw bytes.
   */
  async hkdfDeriveRaw(ikm, salt, info, lengthBytes = 32) {
    if (!Number.isSafeInteger(lengthBytes) || lengthBytes <= 0 || lengthBytes > HKDF_SHA256_MAX_OUTPUT) {
      throw new CryptoError(
        `HKDF-SHA256 lengthBytes must be an integer from 1 to ${HKDF_SHA256_MAX_OUTPUT}, received ${lengthBytes}`
      );
    }
    const [ikmBytes, saltBytes, infoBytes] = this.copyAndValidateKdfInputs(
      ikm,
      salt,
      info
    );
    try {
      const wasm = this.getReadyWasmModule();
      if (wasm?.derive_key_hkdf_raw) {
        const derived = wasm.derive_key_hkdf_raw(
          ikmBytes,
          saltBytes,
          infoBytes,
          lengthBytes
        );
        try {
          if (derived.length !== lengthBytes) {
            throw new CryptoError(
              `WASM HKDF returned ${derived.length} bytes, expected ${lengthBytes}`
            );
          }
          return this.typedArrayToArrayBuffer(derived);
        } finally {
          this.secureWipe(derived);
        }
      }
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikmBytes),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );
      return await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          info: toBuffer(infoBytes)
        },
        baseKey,
        lengthBytes * 8
      );
    } catch (error) {
      if (error instanceof CryptoError) throw error;
      throw new CryptoError(`HKDF deriveBits failed: ${error}`);
    } finally {
      this.secureWipe(ikmBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
    }
  }
  /**
   * Derive raw key bytes using HKDF (legacy compatibility helper).
   */
  async deriveKey(ikm, salt, info) {
    const derivedBits = await this.hkdfDeriveRaw(ikm, salt, info, 32);
    return new Uint8Array(derivedBits);
  }
  /**
   * Derive key using PBKDF2
   */
  async deriveKeyPbkdf2(password, salt, iterations) {
    if (!Number.isSafeInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
      throw new CryptoError(
        `PBKDF2 iterations must be an integer from ${PBKDF2_MIN_ITERATIONS} to ${PBKDF2_MAX_ITERATIONS}`
      );
    }
    if (!(password instanceof Uint8Array) || password.length < 1 || password.length > KDF_MAX_INPUT_BYTES) {
      throw new CryptoError(
        `PBKDF2 password must contain 1 to ${KDF_MAX_INPUT_BYTES} bytes`
      );
    }
    const saltBytes = this.copyAndValidatePbkdf2Salt(salt);
    const passwordBytes = new Uint8Array(password);
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(passwordBytes),
        "PBKDF2",
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          iterations
        },
        baseKey,
        256
      );
      return new Uint8Array(derivedBits);
    } catch (error) {
      throw new CryptoError(`Key derivation (PBKDF2) failed: ${error}`);
    } finally {
      this.secureWipe(passwordBytes);
      this.secureWipe(saltBytes);
    }
  }
  /**
   * Derive encryption key from password
   */
  async deriveKeyFromPassword(password, salt, iterations) {
    if (!Number.isSafeInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
      throw new CryptoError(
        `PBKDF2 iterations must be an integer from ${PBKDF2_MIN_ITERATIONS} to ${PBKDF2_MAX_ITERATIONS}`
      );
    }
    if (typeof password !== "string") {
      throw new CryptoError("PBKDF2 password must be a string");
    }
    const saltBytes = this.copyAndValidatePbkdf2Salt(salt);
    const passwordBuffer = this.textEncoder.encode(password);
    if (passwordBuffer.length < 1 || passwordBuffer.length > KDF_MAX_INPUT_BYTES) {
      this.secureWipe(passwordBuffer);
      this.secureWipe(saltBytes);
      throw new CryptoError(
        `PBKDF2 password must contain 1 to ${KDF_MAX_INPUT_BYTES} UTF-8 bytes`
      );
    }
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(passwordBuffer),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      return await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          iterations
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Key derivation from password failed: ${error}`);
    } finally {
      this.secureWipe(passwordBuffer);
      this.secureWipe(saltBytes);
    }
  }
  /**
   * Generate random salt
   */
  generateSalt(length = 16) {
    if (!Number.isSafeInteger(length) || length < 16 || length > 64) {
      throw new CryptoError("Salt length must be an integer from 16 to 64 bytes");
    }
    return crypto.getRandomValues(new Uint8Array(length));
  }
  /**
   * Generate ECDSA signing key pair
   */
  async generateSigningKeyPair() {
    try {
      return await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
    } catch (error) {
      throw new CryptoError(`Signing key pair generation failed: ${error}`);
    }
  }
  /**
   * Generate ECDH key agreement key pair
   */
  async generateKeyAgreementKeyPair() {
    try {
      return await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
      );
    } catch (error) {
      throw new CryptoError(`Key agreement key pair generation failed: ${error}`);
    }
  }
  /**
   * Export public key to base64 SPKI format
   */
  async exportPublicKey(key) {
    try {
      const exported = await crypto.subtle.exportKey("spki", key);
      return this.arrayBufferToBase64(exported);
    } catch (error) {
      throw new CryptoError(`Public key export failed: ${error}`);
    }
  }
  /**
   * Import public key from base64 SPKI format
   */
  async importPublicKey(keyString, usage) {
    let keyBuffer = null;
    try {
      if (usage !== "ECDSA" && usage !== "ECDH") {
        throw new CryptoError(
          `Public key usage must be ECDSA or ECDH, received ${String(usage)}`
        );
      }
      if (typeof keyString !== "string" || keyString.length === 0 || keyString.length > MAX_P256_SPKI_BASE64_CHARS || keyString.length % 4 !== 0 || !CANONICAL_BASE64_PATTERN.test(keyString)) {
        throw new CryptoError(
          `P-256 SPKI must be canonical base64 no larger than ${MAX_P256_SPKI_BASE64_CHARS} characters`
        );
      }
      keyBuffer = this.base64ToArrayBuffer(keyString);
      if (keyBuffer.byteLength === 0 || keyBuffer.byteLength > MAX_P256_SPKI_BYTES || this.arrayBufferToBase64(keyBuffer) !== keyString) {
        throw new CryptoError(
          `P-256 SPKI must decode canonically to 1-${MAX_P256_SPKI_BYTES} bytes`
        );
      }
      const algorithm = usage === "ECDSA" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "ECDH", namedCurve: "P-256" };
      return await crypto.subtle.importKey(
        "spki",
        keyBuffer,
        algorithm,
        true,
        usage === "ECDSA" ? ["verify"] : []
      );
    } catch (error) {
      throw new CryptoError(`Public key import failed: ${error}`);
    } finally {
      if (keyBuffer) {
        this.secureWipe(keyBuffer);
      }
    }
  }
  /**
   * Derive shared key using ECDH
   */
  async deriveSharedKey(privateKey, publicKey) {
    try {
      return await crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Shared key derivation failed: ${error}`);
    }
  }
  /**
   * Generate an X25519 key pair.
   * Returns raw 32-byte public/private key material.
   */
  async generateX25519KeyPair(seed) {
    const privateKeyBytes = seed ? this.toUint8ArrayCopy(seed) : crypto.getRandomValues(new Uint8Array(32));
    try {
      if (privateKeyBytes.length !== 32) {
        throw new CryptoError(
          `X25519 private key seed must be 32 bytes, received ${privateKeyBytes.length}`
        );
      }
      try {
        let privateKeyPkcs8 = null;
        let privateKey;
        try {
          privateKeyPkcs8 = this.x25519Pkcs8FromSeed(privateKeyBytes);
          privateKey = await crypto.subtle.importKey(
            "pkcs8",
            toBuffer(privateKeyPkcs8),
            { name: "X25519" },
            false,
            ["deriveBits"]
          );
        } finally {
          if (privateKeyPkcs8) this.secureWipe(privateKeyPkcs8);
        }
        const basepointPublicKey = await crypto.subtle.importKey(
          "raw",
          toBuffer(X25519_BASEPOINT),
          { name: "X25519" },
          false,
          []
        );
        const publicKey = await crypto.subtle.deriveBits(
          { name: "X25519", public: basepointPublicKey },
          privateKey,
          256
        );
        return {
          publicKey,
          privateKey: this.typedArrayToArrayBuffer(privateKeyBytes)
        };
      } catch (error) {
        const wasm = await this.getAnyWasmModule();
        if (wasm?.generate_x25519_key_pair) {
          let privateBytes = null;
          try {
            const pair = wasm.generate_x25519_key_pair(privateKeyBytes);
            const publicBytes = "public_key" in pair ? pair.public_key : pair.publicKey;
            privateBytes = "private_key" in pair ? pair.private_key : pair.privateKey;
            return {
              publicKey: this.typedArrayToArrayBuffer(publicBytes),
              privateKey: this.typedArrayToArrayBuffer(privateBytes)
            };
          } catch (wasmError) {
            throw new CryptoError(
              `X25519 key pair generation failed in WASM fallback: ${wasmError}`
            );
          } finally {
            if (privateBytes) this.secureWipe(privateBytes);
          }
        }
        throw new CryptoError(
          `X25519 key pair generation failed. Ensure runtime supports WebCrypto X25519 or WASM fallback: ${error}`
        );
      }
    } finally {
      this.secureWipe(privateKeyBytes);
    }
  }
  /**
   * Compute an X25519 shared secret (32 bytes).
   */
  async x25519SharedSecret(ourPrivateKey, theirPublicKey) {
    const publicKeyBytes = this.toUint8ArrayCopy(theirPublicKey);
    if (publicKeyBytes.length !== 32) {
      throw new CryptoError(
        `X25519 public key must be 32 bytes, received ${publicKeyBytes.length}`
      );
    }
    if (this.isAllZero(publicKeyBytes)) {
      throw new X25519AgreementRejectedError("peer public key is all zero");
    }
    const privateKeyBytes = this.normalizeX25519PrivateKey(ourPrivateKey);
    try {
      let webCryptoError;
      try {
        const privateKeyPkcs8 = this.x25519Pkcs8FromSeed(privateKeyBytes);
        let privateKey;
        try {
          privateKey = await crypto.subtle.importKey(
            "pkcs8",
            toBuffer(privateKeyPkcs8),
            { name: "X25519" },
            false,
            ["deriveBits"]
          );
        } finally {
          this.secureWipe(privateKeyPkcs8);
        }
        const publicKey = await crypto.subtle.importKey(
          "raw",
          toBuffer(publicKeyBytes),
          { name: "X25519" },
          false,
          []
        );
        const shared = await crypto.subtle.deriveBits(
          { name: "X25519", public: publicKey },
          privateKey,
          256
        );
        this.assertContributoryX25519Secret(shared, "WebCrypto");
        return shared;
      } catch (error) {
        if (error instanceof X25519AgreementRejectedError) {
          throw error;
        }
        webCryptoError = error;
      }
      const wasm = await this.getAnyWasmModule();
      if (wasm?.x25519_shared_secret) {
        let shared = null;
        try {
          shared = wasm.x25519_shared_secret(privateKeyBytes, publicKeyBytes);
          this.assertContributoryX25519Secret(shared, "Voided WASM");
          return this.typedArrayToArrayBuffer(shared);
        } catch (wasmError) {
          if (wasmError instanceof X25519AgreementRejectedError) {
            throw wasmError;
          }
          throw new CryptoError(
            `X25519 shared secret derivation failed in WASM fallback: ${wasmError}`
          );
        } finally {
          if (shared) {
            this.secureWipe(shared);
          }
        }
      }
      throw new CryptoError(
        `X25519 shared secret derivation failed: ${webCryptoError}`
      );
    } finally {
      this.secureWipe(privateKeyBytes);
    }
  }
  /**
   * Derive an AES-256-GCM key from a raw X25519 shared secret.
   */
  async deriveKeyFromSharedSecret(sharedSecret, salt, info) {
    if (typeof salt !== "string" || typeof info !== "string" || salt.length < 1 || salt.length > SHARED_SECRET_CONTEXT_MAX_BYTES || info.length < 1 || info.length > SHARED_SECRET_CONTEXT_MAX_BYTES) {
      throw new CryptoError("Shared-secret salt and info must be strings");
    }
    const secretBytes = this.toUint8ArrayCopy(sharedSecret);
    const saltBytes = this.textEncoder.encode(salt);
    const infoBytes = this.textEncoder.encode(info);
    try {
      this.assertContributoryX25519Secret(
        secretBytes,
        "Caller-provided X25519"
      );
      this.validateSharedSecretContext("salt", saltBytes);
      this.validateSharedSecretContext("info", infoBytes);
      const wasm = this.getReadyWasmModule();
      if (wasm?.derive_key_from_shared_secret) {
        const wasmSecret = new Uint8Array(secretBytes);
        let rawKey = null;
        try {
          rawKey = wasm.derive_key_from_shared_secret(wasmSecret, salt, info);
          if (rawKey.length !== 32) {
            throw new CryptoError(
              `WASM shared-secret derivation returned ${rawKey.length} bytes, expected 32`
            );
          }
          return await crypto.subtle.importKey(
            "raw",
            toBuffer(rawKey),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
        } finally {
          this.secureWipe(wasmSecret);
          if (rawKey) this.secureWipe(rawKey);
        }
      }
      return await this.hkdfDerive(secretBytes, saltBytes, infoBytes, 256);
    } finally {
      this.secureWipe(secretBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
    }
  }
  /**
   * Sign data with ECDSA
   */
  async signData(data, key) {
    try {
      return await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        toBuffer(data)
      );
    } catch (error) {
      throw new CryptoError(`Signing failed: ${error}`);
    }
  }
  /**
   * Verify ECDSA signature
   */
  async verifySignature(data, signature, key) {
    try {
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        toBuffer(data)
      );
    } catch (error) {
      throw new CryptoError(`Signature verification failed: ${error}`);
    }
  }
  /**
   * Get key fingerprint (hex string)
   */
  async getKeyFingerprint(key) {
    let exported = null;
    let hash2 = null;
    try {
      exported = await crypto.subtle.exportKey("raw", key);
      hash2 = await crypto.subtle.digest("SHA-256", exported);
      const hex = this.arrayBufferToHex(hash2);
      return hex.substring(0, 16);
    } catch (error) {
      throw new CryptoError(`Fingerprint generation failed: ${error}`);
    } finally {
      if (exported) this.secureWipe(exported);
      if (hash2) this.secureWipe(hash2);
    }
  }
  /**
   * Get safety numbers for key verification
   */
  async getSafetyNumbers(key) {
    let exported = null;
    let hash2 = null;
    try {
      exported = await crypto.subtle.exportKey("raw", key);
      hash2 = await crypto.subtle.digest("SHA-256", exported);
      const bytes = new Uint8Array(hash2);
      const groups = [];
      for (let i2 = 0; i2 < bytes.length && groups.length < 8; i2 += 2) {
        const num = (bytes[i2] * 256 + (bytes[i2 + 1] || 0)) % 1e3;
        groups.push(num.toString().padStart(3, "0"));
      }
      return groups.join(" ");
    } catch (error) {
      throw new CryptoError(`Safety numbers generation failed: ${error}`);
    } finally {
      if (exported) this.secureWipe(exported);
      if (hash2) this.secureWipe(hash2);
    }
  }
  /**
   * Overwrite mutable byte buffers in place.
   */
  secureWipe(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    bytes.fill(0);
  }
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i2 = 0; i2 < bytes.length; i2++) {
      binary += String.fromCharCode(bytes[i2]);
    }
    return btoa(binary);
  }
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i2 = 0; i2 < binary.length; i2++) {
      bytes[i2] = binary.charCodeAt(i2);
    }
    return bytes.buffer;
  }
  arrayBufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  toUint8ArrayCopy(data) {
    if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
      throw new CryptoError("Cryptographic byte input must be an ArrayBuffer or Uint8Array");
    }
    return data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data.slice(0));
  }
  copyAndValidateKdfInput(label, data, minimumBytes) {
    const bytes = this.toUint8ArrayCopy(data);
    if (bytes.length < minimumBytes || bytes.length > KDF_MAX_INPUT_BYTES) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `${label} must contain ${minimumBytes} to ${KDF_MAX_INPUT_BYTES} bytes`
      );
    }
    return bytes;
  }
  copyAndValidateKdfInputs(ikm, salt, info) {
    const copies = [];
    try {
      copies.push(this.copyAndValidateKdfInput("HKDF input key material", ikm, 1));
      copies.push(this.copyAndValidateKdfInput("HKDF salt", salt, 0));
      copies.push(this.copyAndValidateKdfInput("HKDF info", info, 0));
      return copies;
    } catch (error) {
      for (const copy of copies) this.secureWipe(copy);
      throw error;
    }
  }
  copyAndValidatePbkdf2Salt(salt) {
    if (!(salt instanceof Uint8Array)) {
      throw new CryptoError("PBKDF2 salt must be a Uint8Array");
    }
    const bytes = new Uint8Array(salt);
    if (bytes.length < PBKDF2_MIN_SALT_BYTES || bytes.length > PBKDF2_MAX_SALT_BYTES) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `PBKDF2 salt must contain ${PBKDF2_MIN_SALT_BYTES} to ${PBKDF2_MAX_SALT_BYTES} bytes`
      );
    }
    return bytes;
  }
  validateSharedSecretContext(label, bytes) {
    if (bytes.length < 1 || bytes.length > SHARED_SECRET_CONTEXT_MAX_BYTES) {
      throw new CryptoError(
        `Shared-secret ${label} must contain 1 to ${SHARED_SECRET_CONTEXT_MAX_BYTES} UTF-8 bytes`
      );
    }
  }
  typedArrayToArrayBuffer(bytes) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  }
  x25519Pkcs8FromSeed(seed) {
    if (seed.length !== 32) {
      throw new CryptoError(
        `X25519 private key seed must be 32 bytes, received ${seed.length}`
      );
    }
    const out = new Uint8Array(X25519_PKCS8_PREFIX.length + seed.length);
    out.set(X25519_PKCS8_PREFIX, 0);
    out.set(seed, X25519_PKCS8_PREFIX.length);
    return out;
  }
  normalizeX25519PrivateKey(data) {
    const bytes = this.toUint8ArrayCopy(data);
    if (bytes.length === 32) {
      return bytes;
    }
    if (bytes.length === X25519_PKCS8_PREFIX.length + 32 && X25519_PKCS8_PREFIX.every((value, index) => bytes[index] === value)) {
      const privateKey = bytes.slice(X25519_PKCS8_PREFIX.length);
      this.secureWipe(bytes);
      return privateKey;
    }
    this.secureWipe(bytes);
    throw new CryptoError(
      `X25519 private key must be 32-byte raw seed or PKCS8. Received ${bytes.length} bytes`
    );
  }
  assertContributoryX25519Secret(sharedSecret, backend) {
    const bytes = sharedSecret instanceof Uint8Array ? sharedSecret : new Uint8Array(sharedSecret);
    if (bytes.length !== 32) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `${backend} returned an invalid X25519 shared secret length: ${bytes.length}`
      );
    }
    if (this.isAllZero(bytes)) {
      this.secureWipe(bytes);
      throw new X25519AgreementRejectedError(
        `${backend} produced an all-zero shared secret from a low-order or invalid peer public key`
      );
    }
  }
  isAllZero(bytes) {
    let combined = 0;
    for (const byte of bytes) {
      combined |= byte;
    }
    return combined === 0;
  }
  getReadyWasmModule() {
    if (!isWasmReady()) {
      return null;
    }
    try {
      return getWasmSync();
    } catch {
      return null;
    }
  }
  async getAnyWasmModule() {
    const ready = this.getReadyWasmModule();
    if (ready) {
      return ready;
    }
    try {
      return await getWasm();
    } catch {
      return null;
    }
  }
};
var HashService = class {
  constructor() {
    this.textEncoder = new TextEncoder();
    this.saltedHashDomain = this.textEncoder.encode(
      "voided:hash-with-salt:v2"
    );
  }
  /**
   * Hash data with given algorithm
   */
  async hash(data, algorithm = "sha256") {
    const algorithmName = this.webCryptoHashName(algorithm);
    try {
      const hashBuffer = await crypto.subtle.digest(algorithmName, toBuffer(data));
      return this.arrayBufferToHex(hashBuffer);
    } catch (error) {
      throw new CryptoError(`Failed to generate ${algorithm} hash: ${error}`);
    }
  }
  /**
   * Hash data with salt
   */
  async hashWithSalt(data, salt, algorithm = "sha256") {
    this.webCryptoHashName(algorithm);
    const transcriptLength = this.saltedHashDomain.length + 16 + data.length + salt.length;
    assertWithinClientMemoryLimit(transcriptLength, "Salted hash transcript");
    let transcript = null;
    try {
      transcript = new Uint8Array(transcriptLength);
      let offset = 0;
      transcript.set(this.saltedHashDomain, offset);
      offset += this.saltedHashDomain.length;
      this.writeU64Be(transcript, offset, data.length);
      offset += 8;
      transcript.set(data, offset);
      offset += data.length;
      this.writeU64Be(transcript, offset, salt.length);
      offset += 8;
      transcript.set(salt, offset);
      return await this.hash(transcript, algorithm);
    } catch (error) {
      throw new CryptoError(`Failed to hash with salt: ${error}`);
    } finally {
      transcript?.fill(0);
    }
  }
  /**
   * Compare two byte arrays (constant-time)
   */
  compare(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i2 = 0; i2 < a.length; i2++) {
      result |= a[i2] ^ b[i2];
    }
    return result === 0;
  }
  /**
   * Generate HMAC
   */
  async hmac(data, key, algorithm = "sha256") {
    const algorithmName = this.webCryptoHashName(algorithm);
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(key),
        { name: "HMAC", hash: algorithmName },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, toBuffer(data));
      return this.arrayBufferToHex(signature);
    } catch (error) {
      throw new CryptoError(`Failed to generate HMAC: ${error}`);
    }
  }
  /**
   * Generate fingerprint
   */
  async fingerprint(data, length = 8) {
    this.assertSafeIntegerInRange(length, 1, 32, "Fingerprint length");
    const hash2 = await this.hash(data, "sha256");
    return hash2.substring(0, length * 2);
  }
  /**
   * Generate safety numbers
   */
  async safetyNumbers(data, groupSize = 5) {
    this.assertSafeIntegerInRange(
      groupSize,
      1,
      32,
      "Fingerprint group size"
    );
    const hash2 = await this.hash(data, "sha256");
    const bytes = this.hexToBytes(hash2);
    const groups = [];
    for (let i2 = 0; i2 < bytes.length; i2 += groupSize) {
      const slice = bytes.slice(i2, i2 + groupSize);
      const groupNums = Array.from(slice).map(
        (b) => b.toString().padStart(3, "0")
      );
      groups.push(groupNums.join(" "));
    }
    return groups.join("  ");
  }
  webCryptoHashName(algorithm) {
    switch (algorithm) {
      case "sha256":
        return "SHA-256";
      case "sha512":
        return "SHA-512";
      default:
        throw new CryptoError(
          `Unsupported hash algorithm: ${typeof algorithm === "string" ? algorithm : typeof algorithm}`
        );
    }
  }
  writeU64Be(target, offset, value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CryptoError(`Hash transcript length is invalid: ${value}`);
    }
    let remaining = BigInt(value);
    for (let index = 7; index >= 0; index--) {
      target[offset + index] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
  }
  assertSafeIntegerInRange(value, minimum, maximum, label) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new CryptoError(
        `${label} must be a safe integer from ${minimum} to ${maximum}, received ${value}`
      );
    }
  }
  arrayBufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i2 = 0; i2 < bytes.length; i2++) {
      bytes[i2] = parseInt(hex.substr(i2 * 2, 2), 16);
    }
    return bytes;
  }
};
var cryptoService = new CryptoService();
var hashService = new HashService();

// ../../node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0; i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1; i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (; i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1; i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0; i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0; i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0; i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0; i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0; i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0; i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0; i2 < li; ++i2) {
    var sym = syms[i2];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi); i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0; i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i2 = 0; i2 < 256; ++i2) {
    var c = i2, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i2] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i2 = 0; i2 < d.length; ++i2)
        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
var gzh = function(c, o) {
  var fn = o.filename;
  c[0] = 31, c[1] = 139, c[2] = 8, c[8] = o.level < 2 ? 4 : o.level == 9 ? 2 : 0, c[9] = 3;
  if (o.mtime != 0)
    wbytes(c, 4, Math.floor(new Date(o.mtime || Date.now()) / 1e3));
  if (fn) {
    c[3] = 8;
    for (var i2 = 0; i2 <= fn.length; ++i2)
      c[i2 + 10] = fn.charCodeAt(i2);
  }
};
var gzs = function(d) {
  if (d[0] != 31 || d[1] != 139 || d[2] != 8)
    err(6, "invalid gzip data");
  var flg = d[3];
  var st = 10;
  if (flg & 4)
    st += (d[10] | d[11] << 8) + 2;
  for (var zs = (flg >> 3 & 1) + (flg >> 4 & 1); zs > 0; zs -= !d[st++])
    ;
  return st + (flg & 2);
};
var gzhl = function(o) {
  return 10 + (o.filename ? o.filename.length + 1 : 0);
};
var Inflate = /* @__PURE__ */ (function() {
  function Inflate2(opts, cb) {
    if (typeof opts == "function")
      cb = opts, opts = {};
    this.ondata = cb;
    var dict = opts && opts.dictionary && opts.dictionary.subarray(-32768);
    this.s = { i: 0, b: dict ? dict.length : 0 };
    this.o = new u8(32768);
    this.p = new u8(0);
    if (dict)
      this.o.set(dict);
  }
  Inflate2.prototype.e = function(c) {
    if (!this.ondata)
      err(5);
    if (this.d)
      err(4);
    if (!this.p.length)
      this.p = c;
    else if (c.length) {
      var n = new u8(this.p.length + c.length);
      n.set(this.p), n.set(c, this.p.length), this.p = n;
    }
  };
  Inflate2.prototype.c = function(final) {
    this.s.i = +(this.d = final || false);
    var bts = this.s.b;
    var dt = inflt(this.p, this.s, this.o);
    this.ondata(slc(dt, bts, this.s.b), this.d);
    this.o = slc(dt, this.s.b - 32768), this.s.b = this.o.length;
    this.p = slc(this.p, this.s.p / 8 | 0), this.s.p &= 7;
  };
  Inflate2.prototype.push = function(chunk, final) {
    this.e(chunk), this.c(final);
  };
  return Inflate2;
})();
function gzipSync(data, opts) {
  if (!opts)
    opts = {};
  var c = crc(), l = data.length;
  c.p(data);
  var d = dopt(data, opts, gzhl(opts), 8), s = d.length;
  return gzh(d, opts), wbytes(d, s - 8, c.d()), wbytes(d, s - 4, l), d;
}
var Gunzip = /* @__PURE__ */ (function() {
  function Gunzip2(opts, cb) {
    this.v = 1;
    this.r = 0;
    Inflate.call(this, opts, cb);
  }
  Gunzip2.prototype.push = function(chunk, final) {
    Inflate.prototype.e.call(this, chunk);
    this.r += chunk.length;
    if (this.v) {
      var p = this.p.subarray(this.v - 1);
      var s = p.length > 3 ? gzs(p) : 4;
      if (s > p.length) {
        if (!final)
          return;
      } else if (this.v > 1 && this.onmember) {
        this.onmember(this.r - p.length);
      }
      this.p = p.subarray(s), this.v = 0;
    }
    Inflate.prototype.c.call(this, 0);
    if (this.s.f && !this.s.l) {
      this.v = shft(this.s.p) + 9;
      this.s = { i: 0 };
      this.o = new u8(0);
      this.push(new u8(0), final);
    } else if (final) {
      Inflate.prototype.c.call(this, final);
    }
  };
  return Gunzip2;
})();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}

// src/compression.ts
function hasGzipSupport() {
  return typeof gzipSync === "function" && typeof Gunzip === "function";
}
function assertWellFormedText(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(++index);
      if (!(next >= 56320 && next <= 57343)) {
        throw new TypeError("Compression text contains an unpaired UTF-16 surrogate; supply bytes to preserve it");
      }
    } else if (code >= 56320 && code <= 57343) {
      throw new TypeError("Compression text contains an unpaired UTF-16 surrogate; supply bytes to preserve it");
    }
  }
}
function normalizeRequestedAlgorithm(algorithm) {
  if (!["gzip", "brotli", "none", "auto"].includes(algorithm)) {
    throw new Error("Unsupported compression algorithm");
  }
  if (algorithm === "brotli") {
    throw new Error("Brotli compression requires the Rust WASM backend in e2ee-client");
  }
  return algorithm;
}
function isLikelyCompressible(data) {
  if (data.length < 4096) return true;
  const sampleSize = Math.min(data.length, 64 * 1024);
  const sample = data.subarray(0, sampleSize);
  try {
    if (!hasGzipSupport()) {
      return false;
    }
    const compressedSample = gzipSync(sample, { level: 1 });
    const ratio = compressedSample.length / sample.length;
    return ratio < 0.9;
  } catch {
    return false;
  }
}
function chooseOptimalAlgorithm(data, options) {
  const requestedAlgorithm = normalizeRequestedAlgorithm(options.algorithm ?? "auto");
  const { minSizeThreshold = 100 } = options;
  if (requestedAlgorithm !== "auto") return requestedAlgorithm;
  if (data.length < minSizeThreshold) return "none";
  if (data.length < 2048 && isRepeatingPattern(data)) return "none";
  if (!isLikelyCompressible(data)) return "none";
  if (data.length > 1024) return "gzip";
  return "gzip";
}
function isRepeatingPattern(data) {
  if (data.length < 4) return false;
  const first = data[0];
  let repeatCount = 0;
  for (let i2 = 0; i2 < Math.min(data.length, 100); i2++) {
    if (data[i2] === first) repeatCount++;
  }
  return repeatCount / Math.min(data.length, 100) > 0.9;
}
async function compress(data, options = {}) {
  const {
    algorithm = "auto",
    minSizeThreshold = 100,
    compressionLevel: compressionLevel2 = 6
  } = options;
  const requestedAlgorithm = normalizeRequestedAlgorithm(algorithm);
  if (typeof data === "string") assertWellFormedText(data);
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  assertWithinClientUploadLimit(input.length);
  assertWithinClientMemoryLimit(input.length, "Compression input");
  const originalSize = input.length;
  if (originalSize < minSizeThreshold) {
    return {
      compressed: input,
      algorithm: "none",
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1
    };
  }
  const optimalAlgorithm = chooseOptimalAlgorithm(input, { ...options, algorithm: requestedAlgorithm });
  let adaptiveLevel = compressionLevel2;
  if (optimalAlgorithm === "gzip" && requestedAlgorithm === "auto") {
    if (originalSize <= 1 * 1024 * 1024) {
      adaptiveLevel = 1;
    } else if (originalSize <= 5 * 1024 * 1024) {
      adaptiveLevel = Math.min(compressionLevel2, 3);
    }
  }
  if (optimalAlgorithm === "none") {
    return {
      compressed: input,
      algorithm: "none",
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1
    };
  }
  try {
    let compressed;
    const usedAlgorithm = "gzip";
    if (hasGzipSupport()) {
      compressed = gzipSync(input, { level: adaptiveLevel });
    } else {
      throw new Error("Gzip compression not available");
    }
    const compressedSize = compressed.length;
    const compressionRatio = compressedSize / originalSize;
    if (compressionRatio < 0.9) {
      return {
        compressed,
        algorithm: usedAlgorithm,
        originalSize,
        compressedSize,
        compressionRatio
      };
    }
  } catch (error) {
    if (requestedAlgorithm !== "auto") {
      throw new Error(
        `Explicit ${requestedAlgorithm} compression failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return {
    compressed: input,
    algorithm: "none",
    originalSize,
    compressedSize: originalSize,
    compressionRatio: 1
  };
}
async function decompress(compressedData, algorithm, options = {}) {
  assertWithinClientUploadLimit(compressedData.length);
  assertWithinClientMemoryLimit(compressedData.length, "Compressed input");
  const maxOutputBytes = Math.min(
    options.maxOutputBytes ?? CLIENT_MAX_IN_MEMORY_BYTES,
    CLIENT_MAX_IN_MEMORY_BYTES
  );
  const maxExpansionRatio = options.maxExpansionRatio ?? 4096;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new Error("Invalid decompression output limit");
  }
  if (!Number.isFinite(maxExpansionRatio) || maxExpansionRatio <= 0) {
    throw new Error("Invalid decompression expansion ratio");
  }
  if (algorithm === "none") {
    if (compressedData.length > maxOutputBytes || options.expectedOutputBytes !== void 0 && compressedData.length !== options.expectedOutputBytes) {
      throw new Error("Uncompressed payload size does not match its authenticated metadata");
    }
    return compressedData;
  }
  try {
    if (compressedData.length === 0) {
      throw new Error("Compressed payload cannot be empty");
    }
    if (algorithm === "brotli") {
      throw new Error("Brotli decompression requires the Rust WASM backend in e2ee-client");
    }
    if (!hasGzipSupport()) {
      throw new Error("Gzip decompression not available");
    }
    const chunks = [];
    let total = 0;
    const ratioLimit = Math.max(
      1024,
      Math.ceil(compressedData.length * maxExpansionRatio)
    );
    const effectiveLimit = Math.min(maxOutputBytes, ratioLimit);
    const gunzip = new Gunzip((chunk) => {
      total += chunk.length;
      if (total > effectiveLimit) {
        throw new Error("Decompressed payload exceeds configured output limits");
      }
      chunks.push(chunk);
    });
    const inputChunkSize = 64 * 1024;
    for (let inputOffset = 0; inputOffset < compressedData.length; inputOffset += inputChunkSize) {
      const end = Math.min(inputOffset + inputChunkSize, compressedData.length);
      gunzip.push(
        compressedData.subarray(inputOffset, end),
        end === compressedData.length
      );
    }
    if (options.expectedOutputBytes !== void 0 && total !== options.expectedOutputBytes) {
      throw new Error("Decompressed payload size does not match its authenticated metadata");
    }
    const output = new Uint8Array(total);
    let outputOffset = 0;
    for (const chunk of chunks) {
      output.set(chunk, outputOffset);
      outputOffset += chunk.length;
    }
    return output;
  } catch (error) {
    throw new Error(`Decompression failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// src/crypto-backend.ts
var _useWasm = null;
var _wasm = null;
var _tsCrypto = null;
var _tsHash = null;
var RAW_MAX_BYTES = 16 * 1024 * 1024;
var ENCRYPTION_MAX_BYTES = 100 * 1024 * 1024;
var ENCODED_ENCRYPTION_MAX_BYTES = ENCRYPTION_MAX_BYTES + 16;
var TYPED_ARRAY_BYTE_LENGTH_GETTER3 = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength"
)?.get;
var TYPED_ARRAY_LENGTH_GETTER2 = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "length"
)?.get;
var TYPED_ARRAY_TAG_GETTER2 = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag
)?.get;
var HAS_OWN_PROPERTY2 = Object.prototype.hasOwnProperty;
function hasIntrinsicTypedArrayLength2(value) {
  let current = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "length");
    if (descriptor) {
      return descriptor.get === TYPED_ARRAY_LENGTH_GETTER2 && descriptor.set === void 0;
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}
function getUint8ArrayByteLength2(value, label) {
  if (!TYPED_ARRAY_BYTE_LENGTH_GETTER3 || !TYPED_ARRAY_LENGTH_GETTER2 || !TYPED_ARRAY_TAG_GETTER2) {
    throw new Error(`${label} must be a Uint8Array`);
  }
  try {
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER2, value, []) !== "Uint8Array") {
      throw new Error("wrong typed-array brand");
    }
    const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER3, value, []);
    if (Reflect.apply(HAS_OWN_PROPERTY2, value, ["length"]) || !hasIntrinsicTypedArrayLength2(value) || Reflect.apply(TYPED_ARRAY_LENGTH_GETTER2, value, []) !== length) {
      throw new Error("shadowed typed-array length");
    }
    return length;
  } catch {
    throw new Error(
      `${label} must be a Uint8Array (valid Uint8Array required)`
    );
  }
}
function assertUint8ArrayWithinLimit(value, label, maxBytes) {
  const length = getUint8ArrayByteLength2(value, label);
  if (length > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  return length;
}
function assertAuthenticatedEncryptionAlgorithm(algorithm) {
  if (algorithm !== "xchacha20-poly1305" && algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported authenticated encryption algorithm");
  }
}
function assertExactUint8Array(value, label, expectedBytes) {
  if (getUint8ArrayByteLength2(value, label) !== expectedBytes) {
    throw new Error(`${label} must contain exactly ${expectedBytes} bytes`);
  }
}
async function useWasmBackend() {
  if (_useWasm === null) {
    try {
      _wasm = await getWasm();
      _useWasm = true;
    } catch (error) {
      const isNodeRuntime = typeof window === "undefined" && typeof process !== "undefined" && Boolean(process.versions?.node);
      if (!isNodeRuntime) {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        throw new Error(
          "Voided WASM initialization failed; call forceTypeScriptBackend() explicitly to opt into the TypeScript backend" + detail
        );
      }
      _useWasm = false;
    }
  }
  return _useWasm;
}
function forceTypeScriptBackend() {
  _useWasm = false;
  _wasm = null;
}
async function forceWasmBackend() {
  _wasm = await initWasm();
  _useWasm = true;
}
async function getCurrentBackend() {
  return await useWasmBackend() ? "wasm" : "typescript";
}
function isWasmBackendReady() {
  return isWasmReady();
}
function getTsCrypto() {
  if (!_tsCrypto) {
    _tsCrypto = new CryptoService();
  }
  return _tsCrypto;
}
function getTsHash() {
  if (!_tsHash) {
    _tsHash = new HashService();
  }
  return _tsHash;
}
async function keyToCryptoKey(key) {
  assertExactUint8Array(key, "AES-256 key", 32);
  return crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function generateKey() {
  if (await useWasmBackend()) {
    return _wasm.generate_key();
  }
  return getTsCrypto().generateKeyBytes();
}
async function encrypt(data, key) {
  assertExactUint8Array(key, "AES-256 key", 32);
  let dataBytes;
  if (typeof data === "string") {
    if (utf8ByteLength(data, ENCRYPTION_MAX_BYTES) > ENCRYPTION_MAX_BYTES) {
      throw new Error(`Encryption input exceeds ${ENCRYPTION_MAX_BYTES} bytes`);
    }
    dataBytes = new TextEncoder().encode(data);
  } else {
    assertUint8ArrayWithinLimit(
      data,
      "Encryption input",
      ENCRYPTION_MAX_BYTES
    );
    dataBytes = data;
  }
  const dataLength = assertUint8ArrayWithinLimit(
    dataBytes,
    "Encryption input",
    ENCRYPTION_MAX_BYTES
  );
  if (await useWasmBackend()) {
    const result = _wasm.encrypt(dataBytes, key, "aes-256-gcm");
    if (result.algorithm !== "aes-256-gcm") {
      throw new Error(
        `WASM returned an unexpected encryption algorithm: ${String(result.algorithm)}`
      );
    }
    const nonce = base64ToBytes(result.nonce, 12);
    if (nonce.length !== 12) {
      throw new Error(`WASM returned an invalid AES-GCM IV length: ${nonce.length}`);
    }
    const ciphertext2 = base64ToBytes(result.ciphertext, ENCRYPTION_MAX_BYTES);
    const tag = base64ToBytes(result.tag, 16);
    if (tag.length !== 16) {
      throw new Error(`WASM returned an invalid AEAD tag length: ${tag.length}`);
    }
    const authenticatedCiphertext = new Uint8Array(ciphertext2.length + tag.length);
    authenticatedCiphertext.set(ciphertext2);
    authenticatedCiphertext.set(tag, ciphertext2.length);
    return {
      data: bytesToBase64(authenticatedCiphertext),
      iv: bytesToBase64(nonce),
      keyId: "default",
      algorithm: result.algorithm,
      compressed: false,
      originalSize: dataLength,
      encryptedSize: authenticatedCiphertext.length
    };
  }
  const cryptoKey = await keyToCryptoKey(key);
  const encryptedBuffer = await getTsCrypto().encrypt(dataBytes, cryptoKey);
  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);
  const ivB64 = bytesToBase64(iv);
  const dataB64 = bytesToBase64(ciphertext);
  return {
    data: dataB64,
    iv: ivB64,
    keyId: "default",
    algorithm: "aes-256-gcm",
    compressed: false,
    originalSize: dataLength,
    encryptedSize: ciphertext.length
  };
}
async function decrypt(encrypted, key) {
  if (!encrypted || typeof encrypted !== "object") {
    throw new Error("Encrypted result must be an object");
  }
  if (encrypted.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported encryption algorithm");
  }
  assertExactUint8Array(key, "AES-256 key", 32);
  const ivBytes = base64ToBytes(encrypted.iv, 12);
  const dataBytes = base64ToBytes(encrypted.data, ENCODED_ENCRYPTION_MAX_BYTES);
  if (ivBytes.length !== 12) throw new Error("AES-GCM IV must contain exactly 12 bytes");
  if (dataBytes.length < 16) throw new Error("AES-GCM ciphertext is missing its tag");
  if (await useWasmBackend()) {
    const tagOffset = dataBytes.length - 16;
    return _wasm.decrypt(
      bytesToBase64(dataBytes.subarray(0, tagOffset)),
      encrypted.iv,
      bytesToBase64(dataBytes.subarray(tagOffset)),
      key,
      encrypted.algorithm
    );
  }
  const cryptoKey = await keyToCryptoKey(key);
  return getTsCrypto().decrypt(dataBytes, ivBytes, cryptoKey, void 0, false);
}
async function encryptWithAad(data, key, aad, algorithm = "xchacha20-poly1305") {
  const dataLength = assertUint8ArrayWithinLimit(
    data,
    "Authenticated encryption input",
    ENCRYPTION_MAX_BYTES
  );
  assertExactUint8Array(key, "AES-256 key", 32);
  const aadLength = assertUint8ArrayWithinLimit(
    aad,
    "Authenticated encryption additional data",
    RAW_MAX_BYTES
  );
  assertAuthenticatedEncryptionAlgorithm(algorithm);
  assertAggregateBytes(
    "authenticated encryption working set",
    ENCRYPTION_MAX_BYTES,
    dataLength,
    aadLength,
    algorithm === "xchacha20-poly1305" ? 24 : 12,
    16
  );
  if (await useWasmBackend()) {
    const encrypted2 = _wasm.encrypt_with_aad(data, key, aad, algorithm);
    return {
      ciphertext: encrypted2.ciphertext,
      nonce: encrypted2.nonce,
      tag: encrypted2.tag,
      algorithm: encrypted2.algorithm
    };
  }
  if (algorithm !== "aes-256-gcm") {
    throw new Error(
      "Voided XChaCha20-Poly1305 authenticated-data encryption requires the WASM backend"
    );
  }
  const cryptoKey = await keyToCryptoKey(key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad,
        tagLength: 128
      },
      cryptoKey,
      data
    )
  );
  const tagOffset = encrypted.length - 16;
  return {
    ciphertext: bytesToBase64(encrypted.subarray(0, tagOffset)),
    nonce: bytesToBase64(nonce),
    tag: bytesToBase64(encrypted.subarray(tagOffset)),
    algorithm
  };
}
async function decryptWithAad(encrypted, key, aad) {
  if (!encrypted || typeof encrypted !== "object") {
    throw new Error("Authenticated encrypted result must be an object");
  }
  assertExactUint8Array(key, "AES-256 key", 32);
  const aadLength = assertUint8ArrayWithinLimit(
    aad,
    "Authenticated decryption additional data",
    RAW_MAX_BYTES
  );
  assertAuthenticatedEncryptionAlgorithm(encrypted.algorithm);
  const ciphertextLength = assertCanonicalBase64WithinLimit(
    encrypted.ciphertext,
    ENCRYPTION_MAX_BYTES,
    "Authenticated ciphertext"
  );
  const expectedNonceBytes = encrypted.algorithm === "xchacha20-poly1305" ? 24 : 12;
  if (assertCanonicalBase64WithinLimit(
    encrypted.nonce,
    expectedNonceBytes,
    "AEAD nonce"
  ) !== expectedNonceBytes) {
    throw new Error(`AEAD nonce must contain exactly ${expectedNonceBytes} bytes`);
  }
  if (assertCanonicalBase64WithinLimit(encrypted.tag, 16, "AEAD tag") !== 16) {
    throw new Error("AEAD tag must contain exactly 16 bytes");
  }
  assertAggregateBytes(
    "authenticated decryption working set",
    ENCRYPTION_MAX_BYTES,
    ciphertextLength,
    aadLength,
    expectedNonceBytes,
    16
  );
  if (await useWasmBackend()) {
    return _wasm.decrypt_with_aad(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      key,
      encrypted.algorithm,
      aad
    );
  }
  if (encrypted.algorithm !== "aes-256-gcm") {
    throw new Error(
      "Voided XChaCha20-Poly1305 authenticated-data decryption requires the WASM backend"
    );
  }
  const cryptoKey = await keyToCryptoKey(key);
  const nonce = base64ToBytes(encrypted.nonce, 12);
  const ciphertext = base64ToBytes(encrypted.ciphertext, ENCRYPTION_MAX_BYTES);
  const tag = base64ToBytes(encrypted.tag, 16);
  if (nonce.length !== 12) throw new Error("AES-GCM nonce must contain exactly 12 bytes");
  if (tag.length !== 16) throw new Error("AES-GCM tag must contain exactly 16 bytes");
  const payload = new Uint8Array(ciphertext.length + tag.length);
  payload.set(ciphertext);
  payload.set(tag, ciphertext.length);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad,
        tagLength: 128
      },
      cryptoKey,
      payload
    )
  );
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 32768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
function utf8ByteLength(value, stopAfter) {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 127) bytes += 1;
    else if (code <= 2047) bytes += 2;
    else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}
function assertCanonicalBase64WithinLimit(value, maxDecodedBytes, label = "Base64 value") {
  const inspection = inspectCanonicalBase64(value, maxDecodedBytes);
  if (!inspection.ok && inspection.reason === "too-large") {
    throw new Error(`${label} exceeds its size limit`);
  }
  if (!inspection.ok) {
    throw new Error(`${label} is not canonical base64`);
  }
  return inspection.decodedLength;
}
function base64ToBytes(value, maxDecodedBytes) {
  const decodedLength = assertCanonicalBase64WithinLimit(
    value,
    maxDecodedBytes
  );
  const binary = atob(value);
  if (binary.length !== decodedLength) throw new Error("Base64 value is noncanonical");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes;
}
async function deriveKeyHkdf(ikm, salt, info) {
  assertBytes(
    ikm,
    "HKDF input key material",
    WASM_KDF_INPUT_MAX_BYTES,
    1
  );
  if (salt !== null) {
    assertBytes(salt, "HKDF salt", WASM_KDF_INPUT_MAX_BYTES);
  }
  assertBytes(info, "HKDF info", WASM_KDF_INPUT_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm.derive_key_hkdf(ikm, salt, info);
  }
  return getTsCrypto().deriveKey(ikm, salt || new Uint8Array(), info);
}
async function deriveKeyPbkdf2(password, salt, iterations) {
  pbkdfParameters(password, salt, iterations);
  if (await useWasmBackend()) {
    return _wasm.derive_key_pbkdf2(password, salt, iterations);
  }
  return getTsCrypto().deriveKeyPbkdf2(password, salt, iterations);
}
function recoveryDeckWasm(method) {
  const implementation = _wasm?.[method];
  if (typeof implementation !== "function") {
    throw new Error(
      "Recovery Deck requires a Voided WASM artifact that includes the recovery protocol"
    );
  }
  return implementation;
}
async function requireRecoveryDeckBackend() {
  if (!await useWasmBackend()) {
    throw new Error(
      "Recovery Deck is implemented by Voided Rust/WASM and is unavailable in the TypeScript fallback"
    );
  }
}
async function generateRecoveryDeck() {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("generate_recovery_deck")();
}
async function validateRecoveryDeck(deck) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("validate_recovery_deck")(deck);
}
async function encodeRecoveryDeck(deck) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("encode_recovery_deck")(deck);
}
async function deriveRecoveryKey(deck) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("derive_recovery_key")(deck);
}
async function wrapRootWithRecoveryKey(rootKey, recoveryKey) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("wrap_root_with_recovery_key")(rootKey, recoveryKey);
}
async function unwrapRootWithRecoveryKey(rootWrapper, recoveryKey) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("unwrap_root_with_recovery_key")(
    rootWrapper,
    recoveryKey
  );
}
async function createRecoveryDeck(rootKey) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("create_recovery_deck")(rootKey);
}
async function rotateRecoveryDeck(rootWrapper, oldDeck) {
  await requireRecoveryDeckBackend();
  return recoveryDeckWasm("rotate_recovery_deck")(rootWrapper, oldDeck);
}
async function hash(data, algorithm = "sha256") {
  assertBytes(data, "Hash input", ENCRYPTION_MAX_BYTES);
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm.hash(data, checkedAlgorithm);
  }
  return getTsHash().hash(data, checkedAlgorithm);
}
async function hashWithSalt(data, salt, algorithm = "sha256") {
  const dataLength = assertBytes(
    data,
    "Salted hash input",
    ENCRYPTION_MAX_BYTES
  );
  const saltLength = assertBytes(
    salt,
    "Salted hash salt",
    RAW_MAX_BYTES
  );
  assertAggregateBytes(
    "salted hash transcript",
    ENCRYPTION_MAX_BYTES,
    dataLength,
    saltLength,
    64
  );
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm.hash_with_salt(data, salt, checkedAlgorithm);
  }
  return getTsHash().hashWithSalt(data, salt, checkedAlgorithm);
}
async function compareHashes(a, b) {
  assertBytes(a, "First hash comparison input", 64);
  assertBytes(b, "Second hash comparison input", 64);
  if (await useWasmBackend()) {
    return _wasm.compare_hashes(a, b);
  }
  return getTsHash().compare(a, b);
}
async function generateHmac(data, key, algorithm = "sha256") {
  assertBytes(data, "HMAC input", ENCRYPTION_MAX_BYTES);
  assertBytes(key, "HMAC key", WASM_KDF_INPUT_MAX_BYTES, 1);
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm.generate_hmac(data, key, checkedAlgorithm);
  }
  return getTsHash().hmac(data, key, checkedAlgorithm);
}
async function generateFingerprint(data, length = 8) {
  assertBytes(data, "Fingerprint input", ENCRYPTION_MAX_BYTES);
  const checkedLength = assertSafeInteger(
    length,
    "fingerprint length",
    1,
    32
  );
  if (await useWasmBackend()) {
    return _wasm.generate_fingerprint(data, checkedLength);
  }
  return getTsHash().fingerprint(data, checkedLength);
}
async function generateSafetyNumbers(data, groupSize = 5) {
  assertBytes(data, "Safety-number input", ENCRYPTION_MAX_BYTES);
  const checkedGroupSize = assertSafeInteger(
    groupSize,
    "safety-number group size",
    1,
    32
  );
  if (await useWasmBackend()) {
    return _wasm.generate_safety_numbers(data, checkedGroupSize);
  }
  return getTsHash().safetyNumbers(data, checkedGroupSize);
}
async function compress2(data, algorithm = "gzip") {
  assertUint8ArrayWithinLimit(data, "Compression input", ENCRYPTION_MAX_BYTES);
  if (algorithm !== "gzip" && algorithm !== "brotli") {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (await useWasmBackend()) {
    const result = _wasm.compress(data, algorithm);
    return {
      compressed: new Uint8Array(result.compressed),
      algorithm: result.algorithm,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionRatio: result.compressionRatio
    };
  }
  return compress(data, { algorithm });
}
async function decompress2(data, algorithm) {
  assertUint8ArrayWithinLimit(
    data,
    "Compressed browser input",
    ENCRYPTION_MAX_BYTES
  );
  if (algorithm !== "gzip" && algorithm !== "brotli") {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (await useWasmBackend()) {
    const output = _wasm.decompress(data, algorithm);
    assertUint8ArrayWithinLimit(
      output,
      "Decompressed browser output",
      ENCRYPTION_MAX_BYTES
    );
    return output;
  }
  return decompress(data, algorithm);
}
async function decompressBounded(data, algorithm, maxOutputBytes) {
  assertUint8ArrayWithinLimit(
    data,
    "Bounded compressed browser input",
    WASM_BOUNDED_DECOMPRESSION_MAX_BYTES
  );
  if (algorithm !== "gzip" && algorithm !== "brotli") {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > WASM_BOUNDED_DECOMPRESSION_MAX_BYTES) {
    throw new Error(
      `Bounded decompression output limit must be an integer from 0 to ${WASM_BOUNDED_DECOMPRESSION_MAX_BYTES}`
    );
  }
  if (!await useWasmBackend()) {
    throw new Error(
      "Bounded decompression requires the Rust WASM backend in e2ee-client"
    );
  }
  const output = _wasm.decompress_bounded(
    data,
    algorithm,
    maxOutputBytes
  );
  assertUint8ArrayWithinLimit(
    output,
    "Bounded decompressed browser output",
    maxOutputBytes
  );
  return output;
}
function fusedWasmOnlyError() {
  return new Error(
    "Voided 1.0 Fuse and monolith artifact APIs require the Rust WASM backend in e2ee-client"
  );
}
async function fuse(data, key, preset = "balanced", chunkSize) {
  if (await useWasmBackend()) {
    return _wasm.fuse(data, key, preset, chunkSize);
  }
  throw fusedWasmOnlyError();
}
async function unfuse(data, key) {
  if (await useWasmBackend()) {
    return _wasm.unfuse(data, key);
  }
  throw fusedWasmOnlyError();
}
async function inspectFused(data) {
  if (await useWasmBackend()) {
    return _wasm.inspectFused(data);
  }
  throw fusedWasmOnlyError();
}
async function protect(data, key, options = {}) {
  if (await useWasmBackend()) {
    return _wasm.protect(
      data,
      key,
      options.preset,
      options.compressionAlgorithm,
      options.compressionLevel,
      options.encryptionAlgorithm,
      options.shellChunkSize
    );
  }
  throw fusedWasmOnlyError();
}
async function open(artifact, key) {
  if (await useWasmBackend()) {
    return _wasm.open(artifact, key);
  }
  throw fusedWasmOnlyError();
}
async function inspectArtifact(artifact) {
  if (await useWasmBackend()) {
    return _wasm.inspectArtifact(artifact);
  }
  throw fusedWasmOnlyError();
}
async function repackArtifact(artifact, key, options = {}) {
  if (await useWasmBackend()) {
    return _wasm.repackArtifact(
      artifact,
      key,
      options.preset,
      options.compressionAlgorithm,
      options.compressionLevel,
      options.encryptionAlgorithm,
      options.shellChunkSize
    );
  }
  throw fusedWasmOnlyError();
}
async function randomBytes(length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > RAW_MAX_BYTES) {
    throw new Error(`Random byte length must be an integer from 1 to ${RAW_MAX_BYTES}`);
  }
  if (await useWasmBackend()) {
    return _wasm.random_bytes(length);
  }
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, bytes.length)));
  }
  return bytes;
}
async function generateSalt(length = 16) {
  if (!Number.isSafeInteger(length) || length < 16 || length > 1024) {
    throw new Error("Salt length must be an integer from 16 to 1024 bytes");
  }
  if (await useWasmBackend()) {
    return _wasm.generate_salt(length);
  }
  return randomBytes(length);
}
async function base64Encode(data) {
  assertBytes(data, "Base64 input", RAW_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm.base64_encode(data);
  }
  return bytesToBase64(data);
}
async function base64Decode(encoded) {
  return base64ToBytes(encoded, RAW_MAX_BYTES);
}
async function hexEncode(data) {
  const inputLength = assertBytes(data, "Hex input", RAW_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm.hex_encode(data);
  }
  const encoded = new Uint8Array(inputLength * 2);
  try {
    for (let index = 0; index < inputLength; index++) {
      const byte = data[index];
      const high = byte >>> 4;
      const low = byte & 15;
      encoded[index * 2] = high < 10 ? 48 + high : 97 + high - 10;
      encoded[index * 2 + 1] = low < 10 ? 48 + low : 97 + low - 10;
    }
    return new TextDecoder().decode(encoded);
  } finally {
    encoded.fill(0);
  }
}
async function hexDecode(encoded) {
  const decodedLength = assertCanonicalLowerHex(
    encoded,
    "Hex input",
    RAW_MAX_BYTES
  );
  if (await useWasmBackend()) {
    return _wasm.hex_decode(encoded);
  }
  const bytes = new Uint8Array(decodedLength);
  for (let i2 = 0; i2 < bytes.length; i2++) {
    const highCode = encoded.charCodeAt(i2 * 2);
    const lowCode = encoded.charCodeAt(i2 * 2 + 1);
    const high = highCode <= 57 ? highCode - 48 : highCode - 97 + 10;
    const low = lowCode <= 57 ? lowCode - 48 : lowCode - 97 + 10;
    bytes[i2] = high << 4 | low;
  }
  return bytes;
}

// src/storage-service.ts
var StorageService = class {
  constructor(storage) {
    this.storage = storage;
  }
  /**
   * Get key from storage
   */
  async getKey(keyId) {
    return this.storage.getKey(keyId);
  }
  /**
   * Store key in storage
   */
  async setKey(keyId, key) {
    return this.storage.setKey(keyId, key);
  }
  /**
   * Remove key from storage
   */
  async removeKey(keyId) {
    return this.storage.removeKey(keyId);
  }
  /**
   * Get migration state from storage
   */
  async getMigrationState(keyId) {
    return this.storage.getMigrationState(keyId);
  }
  /**
   * Store migration state
   */
  async setMigrationState(keyId, state) {
    return this.storage.setMigrationState(keyId, state);
  }
  /**
   * Remove migration state
   */
  async removeMigrationState(keyId) {
    return this.storage.removeMigrationState(keyId);
  }
  /**
   * Get key pair from storage
   */
  async getKeyPair(keyId, type) {
    return this.storage.getKeyPair(keyId, type);
  }
  /**
   * Store key pair in storage
   */
  async setKeyPair(keyId, type, keyPair) {
    return this.storage.setKeyPair(keyId, type, keyPair);
  }
  /**
   * Remove key pair from storage
   */
  async removeKeyPair(keyId, type) {
    return this.storage.removeKeyPair(keyId, type);
  }
};

// src/key-manager.ts
var RAW_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
var VERSIONED_KEY_PATTERN = /^([A-Za-z0-9+/]{43}=)\.v([1-9][0-9]*)$/;
var MAX_STORED_KEY_LENGTH = 44 + 2 + String(Number.MAX_SAFE_INTEGER).length;
var KeyManager = class {
  constructor(storage, crypto2, keyId) {
    this.keyPromiseGeneration = 0;
    this.activeReaders = 0;
    this.writerActive = false;
    this.leaseQueue = [];
    this.keyId = keyId;
    this.storage = storage;
    this.crypto = crypto2;
  }
  /**
   * Get current key, generating if necessary
   */
  async getCurrentKey() {
    return await this.withKeyReadLease((lease) => lease.getCurrentKey());
  }
  async getCurrentKeyUnlocked() {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    if (this.keyPromise) {
      return this.keyPromise;
    }
    const loadPromise = this._loadOrGenerateKey();
    const generation = ++this.keyPromiseGeneration;
    this.keyPromise = loadPromise;
    try {
      return await loadPromise;
    } finally {
      if (this.keyPromiseGeneration === generation) {
        this.keyPromise = void 0;
      }
    }
  }
  /**
   * Get key for decryption (current or legacy during migration)
   */
  async getKeyForDecryption(_blobKeyId) {
    return this.withKeyReadLease((lease) => lease.getCurrentKey());
  }
  /**
   * Set key with version
   */
  async setKey(key, version, sidecars = {}) {
    const release = await this.acquireWriteLease();
    try {
      const activeMigration = await this.storage.getMigrationState(this.keyId);
      if (activeMigration?.isActive) {
        throw new Error("Cannot replace the primary key while a migration is active");
      }
      const current = await this.storage.getKey(this.keyId);
      const monotonicVersion = current ? Math.max(version, this.getVersionFromKey(current) + 1) : version;
      if (sidecars.beforeCommit) {
        await sidecars.beforeCommit(monotonicVersion);
      }
      await this.setKeyUnlocked(key, monotonicVersion);
      await this.runPostCommit(sidecars.afterCommit);
    } finally {
      release();
    }
  }
  async setKeyUnlocked(key, version) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Key version must be a positive safe integer");
    }
    const keyString = await this.crypto.exportKey(key);
    const versionedKey = this.addVersionToKey(keyString, version);
    await this.persistAndVerify(this.keyId, versionedKey);
    this.cachedKey = key;
    this.cachedAuthorityValue = versionedKey;
    this.cachedLegacyKey = void 0;
    this.cachedLegacyVersion = void 0;
    this.keyPromise = void 0;
  }
  /**
   * Force rotate key (delete old, generate new)
   */
  async forceRotate(postCommit) {
    const release = await this.acquireWriteLease();
    try {
      const activeMigration = await this.storage.getMigrationState(this.keyId);
      if (activeMigration?.isActive) {
        await this.finalizeMigrationState(activeMigration);
      }
      const currentVersion = await this.getCurrentKeyVersionUnlocked();
      const newVersion = currentVersion + 1;
      this.assertValidKeyVersion(newVersion);
      const newKey = await this.crypto.generateKey();
      const keyString = await this.crypto.exportKey(newKey);
      const versionedKey = this.addVersionToKey(keyString, newVersion);
      const stagedKeyId = this.getVersionedStorageKey(newVersion);
      await this.persistAndVerify(stagedKeyId, versionedKey);
      try {
        await this.persistAndVerify(this.keyId, versionedKey);
      } catch (error) {
        let persistedPrimary = null;
        try {
          persistedPrimary = await this.storage.getKey(this.keyId);
        } catch {
          this.cachedKey = void 0;
          this.keyPromise = void 0;
          throw error;
        }
        if (persistedPrimary !== versionedKey) {
          throw error;
        }
      }
      this.cachedKey = newKey;
      this.cachedAuthorityValue = versionedKey;
      this.keyPromise = void 0;
      this.cachedLegacyKey = void 0;
      this.cachedLegacyVersion = void 0;
      await Promise.allSettled([
        this.storage.removeKey(stagedKeyId),
        this.storage.removeKey(this.getVersionedStorageKey(currentVersion))
      ]);
      await this.runPostCommit(postCommit);
      return await this.crypto.exportKey(newKey);
    } finally {
      release();
    }
  }
  /**
   * Start migration (keep old key, generate new)
   */
  async startMigration(cutoffTime, postCommit) {
    const release = await this.acquireWriteLease();
    try {
      const existingMigration = await this.storage.getMigrationState(this.keyId);
      if (existingMigration?.isActive) {
        throw new Error("A key migration is already active");
      }
      let currentKeyString = await this.storage.getKey(this.keyId);
      if (!currentKeyString) {
        await this.getCurrentKeyUnlocked();
        currentKeyString = await this.storage.getKey(this.keyId);
      }
      if (!currentKeyString) {
        throw new Error("Cannot migrate a key that is not durably stored");
      }
      const currentParsed = this.parseStoredKey(currentKeyString);
      const currentKey = this.cachedAuthorityValue === currentKeyString && this.cachedKey ? this.cachedKey : await this.crypto.importKey(currentParsed.rawKey);
      const currentVersion = currentParsed.version;
      const newVersion = currentVersion + 1;
      this.assertValidKeyVersion(newVersion);
      const newKey = await this.crypto.generateKey();
      const newKeyString = this.addVersionToKey(
        await this.crypto.exportKey(newKey),
        newVersion
      );
      const oldKeyString = this.addVersionToKey(
        currentParsed.rawKey,
        currentVersion
      );
      const oldStorageKey = this.getVersionedStorageKey(currentVersion);
      const newStorageKey = this.getVersionedStorageKey(newVersion);
      try {
        await this.persistAndVerify(oldStorageKey, oldKeyString);
        await this.persistAndVerify(newStorageKey, newKeyString);
      } catch (error) {
        await Promise.allSettled([
          this.storage.removeKey(oldStorageKey),
          this.storage.removeKey(newStorageKey)
        ]);
        throw error;
      }
      const migrationState = {
        isActive: true,
        oldKeyVersion: currentVersion,
        newKeyVersion: newVersion,
        cutoffTime,
        lastProgress: 0,
        createdAt: /* @__PURE__ */ new Date()
      };
      try {
        await this.storage.setMigrationState(this.keyId, migrationState);
        const persistedState = await this.storage.getMigrationState(this.keyId);
        if (!this.matchesMigrationState(persistedState, migrationState)) {
          throw new Error("Migration state storage verification failed");
        }
      } catch (error) {
        let persistedState = null;
        try {
          persistedState = await this.storage.getMigrationState(this.keyId);
        } catch {
          this.clearCache();
          throw error;
        }
        if (!this.matchesMigrationState(persistedState, migrationState)) {
          this.clearCache();
          throw error;
        }
      }
      this.cachedKey = newKey;
      this.cachedAuthorityValue = newKeyString;
      this.cachedLegacyKey = currentKey;
      this.cachedLegacyVersion = currentVersion;
      this.keyPromise = void 0;
      try {
        await this.persistAndVerify(this.keyId, newKeyString);
      } catch {
      }
      await this.runPostCommit(postCommit);
      return await this.crypto.exportKey(newKey);
    } finally {
      release();
    }
  }
  /**
   * Finalize migration (remove old key)
   */
  async finalizeMigration() {
    const release = await this.acquireWriteLease();
    try {
      const migrationState = await this.storage.getMigrationState(this.keyId);
      if (!migrationState?.isActive) {
        throw new Error("No active migration to complete");
      }
      await this.finalizeMigrationState(migrationState);
    } finally {
      release();
    }
  }
  /**
   * Delete current key
   */
  async deleteKey(postCommit) {
    const release = await this.acquireWriteLease();
    try {
      const primaryKeyString = await this.storage.getKey(this.keyId);
      const migrationState = await this.storage.getMigrationState(this.keyId);
      if (migrationState?.isActive) {
        this.assertValidMigrationStateVersions(migrationState);
        await this.storage.removeKey(
          this.getVersionedStorageKey(migrationState.oldKeyVersion)
        );
        await this.storage.removeKey(
          this.getVersionedStorageKey(migrationState.newKeyVersion)
        );
      }
      if (primaryKeyString) {
        await this.storage.removeKey(
          this.getVersionedStorageKey(this.getVersionFromKey(primaryKeyString))
        );
      }
      await this.storage.removeKey(this.keyId);
      await this.storage.removeMigrationState(this.keyId);
      this.clearCache();
      await this.runPostCommit(postCommit);
    } finally {
      release();
    }
  }
  /**
   * Check if key exists
   */
  async hasKey() {
    return this.withKeyReadLease(async () => {
      const key = await this.storage.getKey(this.keyId);
      return key !== null;
    });
  }
  /**
   * Get current key version
   */
  async getCurrentKeyVersion() {
    return this.withKeyReadLease(() => this.getCurrentKeyVersionUnlocked());
  }
  async getCurrentKeyVersionUnlocked() {
    const migrationState = await this.storage.getMigrationState(this.keyId);
    if (migrationState?.isActive) {
      this.assertValidMigrationStateVersions(migrationState);
      const migratedKeyString = await this.storage.getKey(
        this.getVersionedStorageKey(migrationState.newKeyVersion)
      );
      if (!migratedKeyString) {
        throw new Error("Active migration has no valid durable new key");
      }
      return this.parseStoredKey(
        migratedKeyString,
        migrationState.newKeyVersion,
        true
      ).version;
    }
    const keyString = await this.storage.getKey(this.keyId);
    if (keyString) {
      return this.getVersionFromKey(keyString);
    }
    await this.getCurrentKeyUnlocked();
    const persisted = await this.storage.getKey(this.keyId);
    return persisted ? this.getVersionFromKey(persisted) : 1;
  }
  /**
   * Get migration status
   */
  async getMigrationStatus() {
    return this.withKeyReadLease(() => this.storage.getMigrationState(this.keyId));
  }
  /**
   * Get legacy key (if available during migration)
   */
  async getLegacyKey() {
    return this.withKeyReadLease((lease) => lease.getLegacyKey());
  }
  async getLegacyKeyUnlocked() {
    const migrationState = await this.storage.getMigrationState(this.keyId);
    if (!migrationState?.isActive) {
      return null;
    }
    this.assertValidMigrationStateVersions(migrationState);
    const legacyKeyString = await this.storage.getKey(
      this.getVersionedStorageKey(migrationState.oldKeyVersion)
    );
    if (!legacyKeyString) {
      return null;
    }
    const parsedLegacyKey = this.parseStoredKey(
      legacyKeyString,
      migrationState.oldKeyVersion,
      true
    );
    if (this.cachedLegacyKey && this.cachedLegacyVersion === parsedLegacyKey.version) {
      return this.cachedLegacyKey;
    }
    const legacyKey = await this.crypto.importKey(parsedLegacyKey.rawKey);
    this.cachedLegacyKey = legacyKey;
    this.cachedLegacyVersion = migrationState.oldKeyVersion;
    return legacyKey;
  }
  /**
   * Clear cached keys
   */
  clearCache() {
    this.cachedKey = void 0;
    this.cachedAuthorityValue = void 0;
    this.cachedLegacyKey = void 0;
    this.cachedLegacyVersion = void 0;
    this.keyPromise = void 0;
  }
  /** Hold a stable-key read lease for the entire cryptographic operation. */
  async withKeyReadLease(operation) {
    const release = await this.acquireReadLease();
    let active = true;
    const assertActive = () => {
      if (!active) throw new Error("Key read lease has already been released");
    };
    try {
      await this.refreshCacheFromAuthority();
      const lease = {
        getCurrentKey: async () => {
          assertActive();
          return this.getCurrentKeyUnlocked();
        },
        getLegacyKey: async () => {
          assertActive();
          return this.getLegacyKeyUnlocked();
        },
        getMigrationStatus: async () => {
          assertActive();
          return this.storage.getMigrationState(this.keyId);
        },
        getPersistedKeyVersion: async () => {
          assertActive();
          return this.getPersistedKeyVersionUnlocked();
        }
      };
      return await operation(lease);
    } finally {
      active = false;
      release();
    }
  }
  acquireReadLease() {
    return this.enqueueLease("read");
  }
  acquireWriteLease() {
    return this.enqueueLease("write");
  }
  enqueueLease(mode) {
    return new Promise((resolve) => {
      this.leaseQueue.push({ mode, resolve });
      this.drainLeaseQueue();
    });
  }
  drainLeaseQueue() {
    if (this.writerActive) return;
    if (this.activeReaders > 0) return;
    const first = this.leaseQueue[0];
    if (!first) return;
    if (first.mode === "write") {
      this.leaseQueue.shift();
      this.writerActive = true;
      let released = false;
      first.resolve(() => {
        if (released) return;
        released = true;
        this.writerActive = false;
        this.drainLeaseQueue();
      });
      return;
    }
    while (this.leaseQueue[0]?.mode === "read") {
      const reader = this.leaseQueue.shift();
      this.activeReaders++;
      let released = false;
      reader.resolve(() => {
        if (released) return;
        released = true;
        this.activeReaders--;
        if (this.activeReaders === 0) this.drainLeaseQueue();
      });
    }
  }
  /**
   * Load or generate key
   */
  async _loadOrGenerateKey() {
    const migrationState = await this.storage.getMigrationState(this.keyId);
    if (migrationState?.isActive) {
      this.assertValidMigrationStateVersions(migrationState);
      const migratedKeyString = await this.storage.getKey(
        this.getVersionedStorageKey(migrationState.newKeyVersion)
      );
      if (!migratedKeyString) {
        throw new Error("Active migration is missing its durable new key");
      }
      const migratedKey = await this.crypto.importKey(
        this.parseStoredKey(
          migratedKeyString,
          migrationState.newKeyVersion,
          true
        ).rawKey
      );
      this.cachedKey = migratedKey;
      this.cachedAuthorityValue = migratedKeyString;
      return migratedKey;
    }
    const keyString = await this.storage.getKey(this.keyId);
    if (keyString) {
      const parsedKey = this.parseStoredKey(keyString);
      const key = await this.crypto.importKey(parsedKey.rawKey);
      this.cachedKey = key;
      this.cachedAuthorityValue = keyString;
      return key;
    }
    const newKey = await this.crypto.generateKey();
    try {
      await this.setKeyUnlocked(newKey, 1);
      return newKey;
    } catch {
      this.cachedKey = newKey;
      this.cachedAuthorityValue = void 0;
      return newKey;
    }
  }
  async refreshCacheFromAuthority() {
    const migrationState = await this.storage.getMigrationState(this.keyId);
    if (migrationState?.isActive) {
      this.assertValidMigrationStateVersions(migrationState);
    }
    const authorityValue = migrationState?.isActive ? await this.storage.getKey(
      this.getVersionedStorageKey(migrationState.newKeyVersion)
    ) : await this.storage.getKey(this.keyId);
    if (migrationState?.isActive && !authorityValue) {
      this.clearCache();
      throw new Error("Active migration is missing its durable new key");
    }
    const parsedAuthority = authorityValue ? this.parseStoredKey(
      authorityValue,
      migrationState?.isActive ? migrationState.newKeyVersion : void 0,
      Boolean(migrationState?.isActive)
    ) : null;
    if (authorityValue === this.cachedAuthorityValue) return;
    if (!authorityValue || !parsedAuthority) {
      if (this.cachedAuthorityValue !== void 0) this.clearCache();
      return;
    }
    const key = await this.crypto.importKey(parsedAuthority.rawKey);
    this.cachedKey = key;
    this.cachedAuthorityValue = authorityValue;
    this.keyPromise = void 0;
    if (!migrationState?.isActive) {
      this.cachedLegacyKey = void 0;
      this.cachedLegacyVersion = void 0;
    }
  }
  async getPersistedKeyVersionUnlocked() {
    const migrationState = await this.storage.getMigrationState(this.keyId);
    if (migrationState?.isActive) {
      this.assertValidMigrationStateVersions(migrationState);
      const migratedKey = await this.storage.getKey(
        this.getVersionedStorageKey(migrationState.newKeyVersion)
      );
      if (!migratedKey) {
        throw new Error("Active migration is missing its durable new key");
      }
      return this.parseStoredKey(
        migratedKey,
        migrationState.newKeyVersion,
        true
      ).version;
    }
    const keyString = await this.storage.getKey(this.keyId);
    return keyString ? this.getVersionFromKey(keyString) : null;
  }
  getVersionedStorageKey(version) {
    this.assertValidKeyVersion(version);
    return `${this.keyId}::voided:key:v${version}`;
  }
  async persistAndVerify(storageKey, value) {
    try {
      await this.storage.setKey(storageKey, value);
    } catch (writeError) {
      try {
        if (await this.storage.getKey(storageKey) === value) return;
      } catch {
        this.clearCache();
      }
      throw writeError;
    }
    const persisted = await this.storage.getKey(storageKey);
    if (persisted !== value) {
      throw new Error(`Key storage verification failed for ${storageKey}`);
    }
  }
  async runPostCommit(postCommit) {
    if (!postCommit) return;
    try {
      await postCommit();
    } catch {
    }
  }
  async finalizeMigrationState(migrationState) {
    this.assertValidMigrationStateVersions(migrationState);
    const oldStorageKey = this.getVersionedStorageKey(migrationState.oldKeyVersion);
    const newStorageKey = this.getVersionedStorageKey(migrationState.newKeyVersion);
    const newKeyString = await this.storage.getKey(newStorageKey);
    if (!newKeyString) {
      throw new Error("Cannot finalize migration without its durable new key");
    }
    const parsedNewKey = this.parseStoredKey(
      newKeyString,
      migrationState.newKeyVersion,
      true
    );
    await this.persistAndVerify(this.keyId, newKeyString);
    const newKey = await this.crypto.importKey(parsedNewKey.rawKey);
    this.cachedKey = newKey;
    this.cachedAuthorityValue = newKeyString;
    this.keyPromise = void 0;
    try {
      await this.storage.removeMigrationState(this.keyId);
    } catch (error) {
      let persistedState;
      try {
        persistedState = await this.storage.getMigrationState(this.keyId);
      } catch {
        throw error;
      }
      if (persistedState?.isActive) {
        throw error;
      }
    }
    await this.storage.removeKey(oldStorageKey);
    await Promise.allSettled([this.storage.removeKey(newStorageKey)]);
    this.cachedLegacyKey = void 0;
    this.cachedLegacyVersion = void 0;
  }
  matchesMigrationState(actual, expected) {
    return Boolean(
      actual?.isActive && actual.oldKeyVersion === expected.oldKeyVersion && actual.newKeyVersion === expected.newKeyVersion
    );
  }
  assertValidKeyVersion(version) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Key version must be a positive safe integer");
    }
  }
  assertValidMigrationStateVersions(migrationState) {
    this.assertValidKeyVersion(migrationState.oldKeyVersion);
    this.assertValidKeyVersion(migrationState.newKeyVersion);
    if (migrationState.newKeyVersion <= migrationState.oldKeyVersion) {
      throw new Error("Migration new key version must be greater than old key version");
    }
  }
  isCanonicalRawKey(keyString) {
    if (!RAW_KEY_PATTERN.test(keyString)) return false;
    const inspection = inspectCanonicalBase64(keyString, 32);
    return inspection.ok && inspection.decodedLength === 32;
  }
  parseStoredKey(keyString, expectedVersion, requireVersioned = false) {
    if (typeof keyString !== "string" || keyString.length < 44 || keyString.length > MAX_STORED_KEY_LENGTH) {
      throw new Error("Invalid stored encryption key format");
    }
    const versionedMatch = VERSIONED_KEY_PATTERN.exec(keyString);
    let parsed;
    if (versionedMatch) {
      const rawKey = versionedMatch[1];
      const version = Number(versionedMatch[2]);
      if (!this.isCanonicalRawKey(rawKey) || !Number.isSafeInteger(version)) {
        throw new Error("Invalid stored encryption key format");
      }
      parsed = { rawKey, version, isVersioned: true };
    } else if (this.isCanonicalRawKey(keyString)) {
      parsed = { rawKey: keyString, version: 1, isVersioned: false };
    } else {
      throw new Error("Invalid stored encryption key format");
    }
    if (expectedVersion !== void 0) {
      this.assertValidKeyVersion(expectedVersion);
      if (!parsed.isVersioned || parsed.version !== expectedVersion) {
        throw new Error(
          `Stored encryption key version does not match expected slot v${expectedVersion}`
        );
      }
    } else if (requireVersioned && !parsed.isVersioned) {
      throw new Error("Expected a versioned stored encryption key");
    }
    return parsed;
  }
  /** Add a validated version suffix to a canonical 32-byte key. */
  addVersionToKey(keyString, version) {
    if (!this.isCanonicalRawKey(keyString)) {
      throw new Error("Invalid raw encryption key format");
    }
    this.assertValidKeyVersion(version);
    return `${keyString}.v${version}`;
  }
  /** Extract a validated version; an exact bare key is legacy version 1. */
  getVersionFromKey(keyString) {
    return this.parseStoredKey(keyString).version;
  }
  /** Compatibility barrier; full crypto operations must use withKeyReadLease. */
  async waitForRotationComplete() {
    const release = await this.acquireReadLease();
    release();
  }
};

// src/key-ui.ts
var QRCode = null;
try {
  QRCode = require_browser();
} catch {
}
function createUiElement(tagName, className, component, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.setAttribute("data-voideddev-component", component);
  if (text !== void 0) element.textContent = text;
  return element;
}
function createActionButton(className, component, action, text, ariaLabel) {
  const button = createUiElement("button", className, component, text);
  button.type = "button";
  button.setAttribute("data-voideddev-action", action);
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}
function appendLabeledText(container, label, value) {
  const strong = document.createElement("strong");
  strong.textContent = label;
  container.append(strong, document.createTextNode(` ${value}`));
}
function renderQrFallback(container, headline) {
  const fallback = createUiElement(
    "div",
    "voideddev-qr-fallback",
    "qr-fallback"
  );
  fallback.append(
    createUiElement(
      "div",
      "voideddev-qr-fallback-icon",
      "qr-fallback-icon",
      "\u{1F4F1}"
    ),
    createUiElement(
      "div",
      "voideddev-qr-fallback-text",
      "qr-fallback-text",
      headline
    ),
    createUiElement(
      "div",
      "voideddev-qr-fallback-subtext",
      "qr-fallback-subtext",
      "Use text copy instead"
    )
  );
  container.replaceChildren(fallback);
}
var KEY_QR_PREFIX = "voideddev-KEY:";
function parseKeyQrPayload(payload) {
  if (!payload.startsWith(KEY_QR_PREFIX)) {
    throw new Error("QR code is not a Voided encryption key");
  }
  const key = payload.slice(KEY_QR_PREFIX.length).trim();
  if (!key) throw new Error("QR code contains an empty encryption key");
  return key;
}
var VoidedKeyExport = class {
  constructor(client, options = {}) {
    this.modal = null;
    this.overlay = null;
    this.client = client;
    this.options = {
      showQR: true,
      showText: true,
      showShare: true,
      title: "Backup Your Encryption Key",
      className: "voideddev-key-export",
      overlayClassName: "voideddev-overlay",
      modalClassName: "voideddev-modal",
      qrContainerClassName: "voideddev-qr-container",
      textAreaClassName: "voideddev-key-textarea",
      buttonClassName: "voideddev-button",
      copyButtonClassName: "voideddev-copy-button",
      downloadButtonClassName: "voideddev-download-button",
      shareButtonClassName: "voideddev-share-button",
      closeButtonClassName: "voideddev-close-button",
      warningClassName: "voideddev-warning",
      keyIdClassName: "voideddev-key-id",
      ...options
    };
  }
  /**
   * Show the key export modal
   */
  async show() {
    try {
      const key = await this.client.exportKey();
      const keyId = await this.client.getCurrentKeyVersion();
      await this.createModal(key, keyId);
      this.showModal();
    } catch {
      alert("Failed to export key. Please try again.");
    }
  }
  /**
   * Hide the key export modal
   */
  hide() {
    this.hideModal();
  }
  async createModal(key, keyId) {
    this.overlay = document.createElement("div");
    this.overlay.className = this.options.overlayClassName || "voideddev-overlay";
    this.overlay.setAttribute("data-voideddev-component", "key-export-overlay");
    this.modal = document.createElement("div");
    this.modal.className = this.options.modalClassName || "voideddev-modal";
    this.modal.setAttribute("data-voideddev-component", "key-export-modal");
    const header = createUiElement(
      "div",
      "voideddev-modal-header",
      "modal-header"
    );
    header.append(
      createUiElement(
        "h3",
        "voideddev-modal-title",
        "modal-title",
        this.options.title || "Backup Your Encryption Key"
      ),
      createActionButton(
        this.options.closeButtonClassName || "voideddev-close-button",
        "close-button",
        "close",
        "\xD7",
        "Close modal"
      )
    );
    this.modal.append(header);
    const keyIdContainer = createUiElement(
      "div",
      this.options.keyIdClassName || "voideddev-key-id",
      "key-id"
    );
    const keyIdLabel = document.createElement("strong");
    keyIdLabel.textContent = "Key ID:";
    const keyIdValue = document.createElement("span");
    keyIdValue.setAttribute("data-voideddev-key-id", String(keyId));
    keyIdValue.textContent = String(keyId);
    keyIdContainer.append(
      keyIdLabel,
      document.createTextNode(" "),
      keyIdValue
    );
    this.modal.append(keyIdContainer);
    if (this.options.showQR) {
      const qrContainer = createUiElement(
        "div",
        this.options.qrContainerClassName || "voideddev-qr-container",
        "qr-container"
      );
      qrContainer.id = "qr-code";
      this.modal.append(qrContainer);
    }
    if (this.options.showText) {
      const keySection = createUiElement(
        "div",
        "voideddev-key-section",
        "key-section"
      );
      const keyLabel = createUiElement(
        "label",
        "voideddev-key-label",
        "key-label",
        "Encryption Key:"
      );
      const keyTextArea = createUiElement(
        "textarea",
        this.options.textAreaClassName || "voideddev-key-textarea",
        "key-textarea"
      );
      keyTextArea.readOnly = true;
      keyTextArea.value = key;
      keyTextArea.setAttribute("data-voideddev-action", "select-all");
      keyTextArea.setAttribute("aria-label", "Encryption key");
      keySection.append(keyLabel, keyTextArea);
      this.modal.append(keySection);
      const buttonGroup = createUiElement(
        "div",
        "voideddev-button-group",
        "button-group"
      );
      const baseButtonClass = this.options.buttonClassName || "voideddev-button";
      buttonGroup.append(
        createActionButton(
          `${baseButtonClass} ${this.options.copyButtonClassName || "voideddev-copy-button"}`,
          "copy-button",
          "copy",
          "Copy Key"
        ),
        createActionButton(
          `${baseButtonClass} ${this.options.downloadButtonClassName || "voideddev-download-button"}`,
          "download-button",
          "download",
          "Download Key"
        )
      );
      if (this.options.showShare) {
        buttonGroup.append(
          createActionButton(
            `${baseButtonClass} ${this.options.shareButtonClassName || "voideddev-share-button"}`,
            "share-button",
            "share",
            "\u{1F4E4} Share Key"
          )
        );
      }
      this.modal.append(buttonGroup);
    }
    const warning = createUiElement(
      "div",
      this.options.warningClassName || "voideddev-warning",
      "warning"
    );
    appendLabeledText(
      warning,
      "Important:",
      "Keep this key safe. Anyone with this key can decrypt your data."
    );
    this.modal.append(warning);
    this.modal.addEventListener("close", () => this.hide());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    this.modal.addEventListener("click", (e) => {
      const target = e.target;
      const action = target.getAttribute("data-voideddev-action");
      if (!action) return;
      switch (action) {
        case "close":
          this.hide();
          break;
        case "copy":
          this.copyKey(key);
          break;
        case "download":
          this.downloadKey(key, keyId);
          break;
        case "share":
          this.shareKey(key, keyId);
          break;
        case "select-all":
          target.select();
          break;
      }
    });
    if (this.options.showQR) {
      await this.generateQR(key);
    }
    this.overlay.appendChild(this.modal);
  }
  showModal() {
    document.body.appendChild(this.overlay);
    document.body.style.overflow = "hidden";
  }
  hideModal() {
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      document.body.style.overflow = "";
      this.overlay = null;
      this.modal = null;
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
  async copyKey(key) {
    try {
      await navigator.clipboard.writeText(key);
      if (this.options.onCopy) {
        this.options.onCopy();
      } else {
        alert("\u{1F4CB} Key copied to clipboard!");
      }
    } catch {
      alert("\u274C Failed to copy key to clipboard");
    }
  }
  downloadKey(key, keyId) {
    const blob = new Blob([key], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voideddev-key-${keyId}-${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (this.options.onDownload) {
      this.options.onDownload();
    }
  }
  async generateQR(key) {
    const qrContainer = this.modal?.querySelector(
      '[data-voideddev-component="qr-container"]'
    );
    if (!qrContainer) return;
    const qrText = `${KEY_QR_PREFIX}${key}`;
    const qrSize = 200;
    try {
      if (QRCode) {
        const qrDataUrl = await QRCode.toDataURL(qrText, {
          width: qrSize,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#FFFFFF"
          }
        });
        const wrapper = document.createElement("div");
        wrapper.className = "voideddev-qr-wrapper";
        wrapper.setAttribute("data-voideddev-component", "qr-wrapper");
        const image = document.createElement("img");
        image.src = qrDataUrl;
        image.alt = "QR Code";
        image.className = "voideddev-qr-image";
        image.setAttribute("data-voideddev-component", "qr-image");
        const caption = document.createElement("div");
        caption.className = "voideddev-qr-caption";
        caption.setAttribute("data-voideddev-component", "qr-caption");
        caption.textContent = "Scan with any QR code app";
        wrapper.append(image, caption);
        qrContainer.replaceChildren(wrapper);
      } else {
        renderQrFallback(qrContainer, "QR Code Unavailable");
      }
    } catch {
      renderQrFallback(qrContainer, "QR Code Error");
    }
  }
  async shareKey(key, keyId) {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "voideddev Encryption Key",
          text: `My encryption key (ID: ${keyId}): ${key}`,
          url: `data:text/plain;base64,${btoa(key)}`
        });
        if (this.options.onShare) {
          this.options.onShare();
        } else {
          alert("\u2705 Key shared successfully!");
        }
      } else {
        await this.copyKey(key);
      }
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        alert("\u274C Sharing was cancelled");
      } else {
        await this.copyKey(key);
      }
    }
  }
};
var VoidedKeyImport = class {
  constructor(client, options = {}) {
    this.modal = null;
    this.overlay = null;
    this.client = client;
    this.options = {
      title: "Import Encryption Key",
      className: "voideddev-key-import",
      overlayClassName: "voideddev-overlay",
      modalClassName: "voideddev-modal",
      textAreaClassName: "voideddev-key-textarea",
      buttonClassName: "voideddev-button",
      importButtonClassName: "voideddev-import-button",
      scanButtonClassName: "voideddev-scan-button",
      cancelButtonClassName: "voideddev-cancel-button",
      closeButtonClassName: "voideddev-close-button",
      warningClassName: "voideddev-warning",
      showQRScan: true,
      ...options
    };
  }
  /**
   * Show the key import modal
   */
  show() {
    this.createModal();
    this.showModal();
  }
  /**
   * Hide the key import modal
   */
  hide() {
    this.hideModal();
  }
  createModal() {
    this.overlay = document.createElement("div");
    this.overlay.className = this.options.overlayClassName || "voideddev-overlay";
    this.overlay.setAttribute("data-voideddev-component", "key-import-overlay");
    this.modal = document.createElement("div");
    this.modal.className = this.options.modalClassName || "voideddev-modal";
    this.modal.setAttribute("data-voideddev-component", "key-import-modal");
    const header = createUiElement(
      "div",
      "voideddev-modal-header",
      "modal-header"
    );
    header.append(
      createUiElement(
        "h3",
        "voideddev-modal-title",
        "modal-title",
        this.options.title || "Import Encryption Key"
      ),
      createActionButton(
        this.options.closeButtonClassName || "voideddev-close-button",
        "close-button",
        "close",
        "\xD7",
        "Close modal"
      )
    );
    const keySection = createUiElement(
      "div",
      "voideddev-key-section",
      "key-section"
    );
    const keyLabel = createUiElement(
      "label",
      "voideddev-key-label",
      "key-label",
      "Paste your encryption key:"
    );
    const keyInput = createUiElement(
      "textarea",
      this.options.textAreaClassName || "voideddev-key-textarea",
      "key-textarea"
    );
    keyInput.id = "key-input";
    keyInput.placeholder = "Paste your key here...";
    keyInput.setAttribute("aria-label", "Encryption key input");
    keySection.append(keyLabel, keyInput);
    const buttonGroup = createUiElement(
      "div",
      "voideddev-button-group",
      "button-group"
    );
    const baseButtonClass = this.options.buttonClassName || "voideddev-button";
    buttonGroup.append(
      createActionButton(
        `${baseButtonClass} ${this.options.importButtonClassName || "voideddev-import-button"}`,
        "import-button",
        "import",
        "Import Key"
      )
    );
    if (this.options.showQRScan) {
      buttonGroup.append(
        createActionButton(
          `${baseButtonClass} ${this.options.scanButtonClassName || "voideddev-scan-button"}`,
          "scan-button",
          "scan",
          "\u{1F4F7} Scan QR Code"
        )
      );
    }
    buttonGroup.append(
      createActionButton(
        `${baseButtonClass} ${this.options.cancelButtonClassName || "voideddev-cancel-button"}`,
        "cancel-button",
        "close",
        "Cancel"
      )
    );
    const warning = createUiElement(
      "div",
      this.options.warningClassName || "voideddev-warning",
      "warning"
    );
    appendLabeledText(
      warning,
      "Note:",
      "Importing a key will replace your current key. Make sure you have a backup of your current key."
    );
    this.modal.append(header, keySection, buttonGroup, warning);
    this.modal.addEventListener("close", () => this.hide());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    this.modal.addEventListener("click", (e) => {
      const target = e.target;
      const action = target.getAttribute("data-voideddev-action");
      if (!action) return;
      switch (action) {
        case "close":
          this.hide();
          break;
        case "import":
          this.importKey();
          break;
        case "scan":
          this.scanQRCode();
          break;
      }
    });
    this.overlay.appendChild(this.modal);
  }
  showModal() {
    document.body.appendChild(this.overlay);
    document.body.style.overflow = "hidden";
  }
  hideModal() {
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      document.body.style.overflow = "";
      this.overlay = null;
      this.modal = null;
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
  async importKey() {
    const keyInput = this.modal?.querySelector(
      '[data-voideddev-component="key-textarea"]'
    );
    const importBtn = this.modal?.querySelector(
      '[data-voideddev-component="import-button"]'
    );
    if (!keyInput || !importBtn) return;
    const key = keyInput.value.trim();
    if (!key) {
      alert("Please paste a valid key.");
      return;
    }
    try {
      importBtn.disabled = true;
      importBtn.textContent = "Importing...";
      await this.client.importKey(key);
      if (this.options.onSuccess) {
        this.options.onSuccess();
      } else {
        alert("Key imported successfully!");
      }
      this.hide();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to import key";
      if (this.options.onError) {
        this.options.onError(errorMessage);
      } else {
        alert(`Failed to import key: ${errorMessage}`);
      }
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import Key";
    }
  }
  async scanQRCode() {
    const detectorConstructor = globalThis.BarcodeDetector;
    if (!detectorConstructor || typeof createImageBitmap !== "function") {
      alert(
        "QR scanning is not supported by this browser. Please paste the key manually."
      );
      return;
    }
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.setAttribute("capture", "environment");
    fileInput.hidden = true;
    document.body.appendChild(fileInput);
    const cleanup = () => fileInput.remove();
    fileInput.addEventListener("cancel", cleanup, { once: true });
    fileInput.addEventListener(
      "change",
      async () => {
        let image;
        try {
          const file = fileInput.files?.[0];
          if (!file) return;
          image = await createImageBitmap(file);
          const detector = new detectorConstructor({ formats: ["qr_code"] });
          const matches = await detector.detect(image);
          const payload = matches.find(
            (match) => typeof match.rawValue === "string"
          )?.rawValue;
          if (!payload) throw new Error("No QR code was found in that image");
          const key = parseKeyQrPayload(payload);
          const keyInput = this.modal?.querySelector(
            '[data-voideddev-component="key-textarea"]'
          );
          if (!keyInput) throw new Error("The key import field is unavailable");
          keyInput.value = key;
          keyInput.dispatchEvent(new Event("input", { bubbles: true }));
          keyInput.focus();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to scan QR code";
          if (this.options.onError) this.options.onError(message);
          else alert(message);
        } finally {
          image?.close();
          cleanup();
        }
      },
      { once: true }
    );
    fileInput.click();
  }
};
function createKeyExport(client, options) {
  return new VoidedKeyExport(client, options);
}
function createKeyImport(client, options) {
  return new VoidedKeyImport(client, options);
}

// src/recovery-deck-ui.ts
var RECOVERY_DECK_UI_CARD_IDS = Object.freeze([
  "AS",
  "2S",
  "3S",
  "4S",
  "5S",
  "6S",
  "7S",
  "8S",
  "9S",
  "10S",
  "JS",
  "QS",
  "KS",
  "AH",
  "2H",
  "3H",
  "4H",
  "5H",
  "6H",
  "7H",
  "8H",
  "9H",
  "10H",
  "JH",
  "QH",
  "KH",
  "AD",
  "2D",
  "3D",
  "4D",
  "5D",
  "6D",
  "7D",
  "8D",
  "9D",
  "10D",
  "JD",
  "QD",
  "KD",
  "AC",
  "2C",
  "3C",
  "4C",
  "5C",
  "6C",
  "7C",
  "8C",
  "9C",
  "10C",
  "JC",
  "QC",
  "KC"
]);
var CARD_SET = new Set(RECOVERY_DECK_UI_CARD_IDS);
var DEFAULT_STYLE_ID = "voideddev-recovery-deck-default-styles";
var instanceCount = 0;
var SUITS = {
  S: { name: "Spades", symbol: "\u2660", color: "black" },
  H: { name: "Hearts", symbol: "\u2665", color: "red" },
  D: { name: "Diamonds", symbol: "\u2666", color: "red" },
  C: { name: "Clubs", symbol: "\u2663", color: "black" }
};
var RANK_NAMES = {
  A: "Ace",
  J: "Jack",
  Q: "Queen",
  K: "King"
};
var DEFAULT_CLASSES = {
  root: "voideddev-recovery-root",
  overlay: "voideddev-recovery-overlay",
  inline: "voideddev-recovery-inline",
  panel: "voideddev-recovery-panel",
  header: "voideddev-recovery-header",
  title: "voideddev-recovery-title",
  closeButton: "voideddev-recovery-close",
  description: "voideddev-recovery-description",
  warning: "voideddev-recovery-warning",
  hint: "voideddev-recovery-hint",
  deckGrid: "voideddev-recovery-deck-grid",
  card: "voideddev-recovery-card",
  selectedCard: "voideddev-recovery-card-selected",
  cardPosition: "voideddev-recovery-card-position",
  cardRank: "voideddev-recovery-card-rank",
  cardSuit: "voideddev-recovery-card-suit",
  actions: "voideddev-recovery-actions",
  button: "voideddev-recovery-button",
  shuffleButton: "voideddev-recovery-shuffle",
  confirmButton: "voideddev-recovery-confirm",
  error: "voideddev-recovery-error"
};
var DEFAULT_LABELS = {
  title: "Recovery Deck",
  description: "This exact 52-card order is the recovery secret. Record it physically before continuing.",
  warning: "Avoid screenshots, photographs, clipboard tools, cloud notes, and shared printers.",
  reorderHint: "Drag a card, select one card and then its destination, or use the arrow keys.",
  shuffle: "Shuffle",
  shuffling: "Shuffling\u2026",
  confirm: "Use this deck",
  close: "Close",
  invalidDeck: "The deck must contain every standard card exactly once.",
  shuffleError: "A fresh secure deck could not be generated.",
  confirmError: "The deck could not be confirmed. Please try again."
};
var RECOVERY_DECK_DEFAULT_CSS = String.raw`
@layer voideddev-recovery-defaults {
  .voideddev-recovery-root {
    --voided-recovery-surface: #fff;
    --voided-recovery-text: #111;
    --voided-recovery-muted: #666;
    --voided-recovery-border: #ccc;
    --voided-recovery-overlay: rgba(0, 0, 0, 0.55);
    --voided-recovery-red-suit: #a11;
    --voided-recovery-radius: 8px;
    box-sizing: border-box;
    color: var(--voided-recovery-text);
    font: inherit;
  }
  .voideddev-recovery-root *, .voideddev-recovery-root *::before, .voideddev-recovery-root *::after { box-sizing: border-box; }
  .voideddev-recovery-overlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; overflow: auto; background: var(--voided-recovery-overlay); }
  .voideddev-recovery-inline { width: 100%; }
  .voideddev-recovery-panel { width: min(1040px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 20px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); }
  .voideddev-recovery-inline > .voideddev-recovery-panel { max-height: none; }
  .voideddev-recovery-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .voideddev-recovery-title { margin: 0; font: inherit; font-size: 1.4rem; font-weight: 700; }
  .voideddev-recovery-close { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .voideddev-recovery-description, .voideddev-recovery-warning, .voideddev-recovery-hint { margin: 10px 0; line-height: 1.45; }
  .voideddev-recovery-warning { font-weight: 600; }
  .voideddev-recovery-hint { color: var(--voided-recovery-muted); font-size: 0.9rem; }
  .voideddev-recovery-deck-grid { display: grid; grid-template-columns: repeat(13, minmax(46px, 1fr)); gap: 6px; margin-top: 16px; }
  .voideddev-recovery-card { position: relative; min-width: 0; aspect-ratio: 5 / 7; display: grid; place-items: center; padding: 6px 3px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); color: inherit; cursor: grab; font: inherit; }
  .voideddev-recovery-card:active { cursor: grabbing; }
  .voideddev-recovery-card[data-voideddev-color="red"] { color: var(--voided-recovery-red-suit); }
  .voideddev-recovery-card-selected { outline: 2px solid currentColor; outline-offset: 1px; }
  .voideddev-recovery-card-position { position: absolute; top: 4px; left: 5px; color: var(--voided-recovery-muted); font-size: 0.65rem; }
  .voideddev-recovery-card-rank { align-self: end; font-weight: 700; }
  .voideddev-recovery-card-suit { align-self: start; font-size: 1.25rem; line-height: 1; }
  .voideddev-recovery-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .voideddev-recovery-button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--voided-recovery-border); border-radius: var(--voided-recovery-radius); background: var(--voided-recovery-surface); color: inherit; cursor: pointer; font: inherit; }
  .voideddev-recovery-button:disabled { cursor: not-allowed; opacity: 0.5; }
  .voideddev-recovery-confirm { border-color: currentColor; font-weight: 700; }
  .voideddev-recovery-error { min-height: 1.4em; margin: 10px 0 0; color: var(--voided-recovery-red-suit); font-weight: 600; }
  .voideddev-recovery-root :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  @media (max-width: 760px) { .voideddev-recovery-deck-grid { grid-template-columns: repeat(7, minmax(42px, 1fr)); } }
  @media (max-width: 480px) {
    .voideddev-recovery-overlay { padding: 0; place-items: stretch; }
    .voideddev-recovery-overlay > .voideddev-recovery-panel { min-height: 100vh; max-height: none; border: 0; border-radius: 0; }
    .voideddev-recovery-deck-grid { grid-template-columns: repeat(4, minmax(44px, 1fr)); }
  }
}
`.trim();
function mergeClasses(overrides) {
  const merged = { ...DEFAULT_CLASSES };
  if (!overrides) return merged;
  for (const key of Object.keys(overrides)) {
    const custom = overrides[key]?.trim();
    if (custom) merged[key] = `${merged[key]} ${custom}`;
  }
  return merged;
}
function addClass(base, extra) {
  const custom = extra?.trim();
  return custom ? `${base} ${custom}` : base;
}
function createElement(documentRef, tagName, className, component, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.dataset.voideddevComponent = component;
  if (text !== void 0) element.textContent = text;
  return element;
}
function createButton(documentRef, className, component, action, text) {
  const button = createElement(documentRef, "button", className, component, text);
  button.type = "button";
  button.dataset.voideddevAction = action;
  return button;
}
function parseCard(id) {
  if (!CARD_SET.has(id)) throw new Error("Unknown canonical Recovery Deck card");
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  const suitInfo = SUITS[suit];
  return {
    id,
    rank,
    rankName: RANK_NAMES[rank] ?? rank,
    suit,
    suitName: suitInfo.name,
    suitSymbol: suitInfo.symbol,
    color: suitInfo.color
  };
}
function validateRecoveryDeckUICards(deck) {
  if (deck.length !== RECOVERY_DECK_UI_CARD_IDS.length) return false;
  const seen = /* @__PURE__ */ new Set();
  for (const id of deck) {
    if (!CARD_SET.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return seen.size === RECOVERY_DECK_UI_CARD_IDS.length;
}
function moveRecoveryDeckUICard(deck, from, to) {
  if (!validateRecoveryDeckUICards(deck)) {
    throw new Error("Cannot reorder an invalid Recovery Deck");
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= deck.length || to >= deck.length) {
    throw new Error("Recovery Deck card positions are out of range");
  }
  const reordered = [...deck];
  const [card] = reordered.splice(from, 1);
  reordered.splice(to, 0, card);
  return reordered;
}
function installRecoveryDeckDefaultStyles(documentRef = document) {
  if (documentRef.getElementById(DEFAULT_STYLE_ID)) return;
  const style = documentRef.createElement("style");
  style.id = DEFAULT_STYLE_ID;
  style.dataset.voideddevComponent = "recovery-deck-default-styles";
  style.textContent = RECOVERY_DECK_DEFAULT_CSS;
  documentRef.head.append(style);
}
var VoidedRecoveryDeckUI = class {
  constructor(options = {}) {
    this.root = null;
    this.grid = null;
    this.error = null;
    this.shuffleButton = null;
    this.confirmButton = null;
    this.documentRef = null;
    this.presentation = "modal";
    this.selectedIndex = null;
    this.dragIndex = null;
    this.busy = false;
    this.previousBodyOverflow = null;
    this.lifecycleGeneration = 0;
    this.handleDocumentKeydown = (event) => {
      if (this.presentation === "modal" && event.key === "Escape") this.unmount();
    };
    this.handleBackdropClick = (event) => {
      if (this.presentation === "modal" && this.options.closeOnBackdrop !== false && event.target === this.root) {
        this.unmount();
      }
    };
    if (options.deck && !validateRecoveryDeckUICards(options.deck)) {
      throw new Error("Recovery Deck UI requires exactly 52 unique canonical cards");
    }
    this.deck = options.deck ? [...options.deck] : [];
    this.classes = mergeClasses(options.classNames);
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.options = options;
    this.shuffleDeck = options.shuffleDeck ?? generateRecoveryDeck;
  }
  /** Open the component as a modal. */
  async show(parent) {
    if (this.root) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    const documentRef = parent?.ownerDocument ?? document;
    await this.ensureDeck();
    if (lifecycleGeneration !== this.lifecycleGeneration) return;
    const root = createElement(
      documentRef,
      "div",
      addClass(`${this.classes.root} ${this.classes.overlay}`, this.options.rootClassName),
      "recovery-root"
    );
    root.dataset.voideddevPresentation = "modal";
    root.setAttribute("role", "presentation");
    const panel = this.buildPanel(documentRef, "modal");
    root.append(panel);
    const mountPoint = parent ?? documentRef.body;
    mountPoint.append(root);
    this.attach(root, documentRef, "modal");
    if (mountPoint === documentRef.body) {
      this.previousBodyOverflow = documentRef.body.style.overflow;
      documentRef.body.style.overflow = "hidden";
    }
    documentRef.addEventListener("keydown", this.handleDocumentKeydown);
    root.addEventListener("click", this.handleBackdropClick);
    this.focusFirstAction();
  }
  /** Mount the same component inline; the container may be a full page shell. */
  async mount(container) {
    if (this.root) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    await this.ensureDeck();
    if (lifecycleGeneration !== this.lifecycleGeneration) return;
    const documentRef = container.ownerDocument;
    this.presentation = "inline";
    const root = createElement(
      documentRef,
      "section",
      addClass(`${this.classes.root} ${this.classes.inline}`, this.options.rootClassName),
      "recovery-root"
    );
    root.dataset.voideddevPresentation = "inline";
    const panel = this.buildPanel(documentRef, "inline");
    root.append(panel);
    container.append(root);
    this.attach(root, documentRef, "inline");
    this.focusFirstAction();
  }
  /** Remove the component and clear its retained card-order array. */
  unmount(notify = true) {
    this.lifecycleGeneration++;
    if (this.documentRef) {
      this.documentRef.removeEventListener("keydown", this.handleDocumentKeydown);
    }
    this.root?.removeEventListener("click", this.handleBackdropClick);
    this.root?.replaceChildren();
    this.root?.remove();
    if (this.previousBodyOverflow !== null && this.documentRef?.body) {
      this.documentRef.body.style.overflow = this.previousBodyOverflow;
    }
    this.deck.fill("");
    this.deck = [];
    this.root = null;
    this.grid = null;
    this.error = null;
    this.shuffleButton = null;
    this.confirmButton = null;
    this.documentRef = null;
    this.previousBodyOverflow = null;
    this.selectedIndex = null;
    this.dragIndex = null;
    this.busy = false;
    if (notify) this.options.onClose?.();
  }
  destroy() {
    this.unmount(false);
  }
  async ensureDeck() {
    if (validateRecoveryDeckUICards(this.deck)) return;
    await this.replaceWithFreshDeck(false);
  }
  buildPanel(documentRef, presentation) {
    if (this.options.injectDefaultStyles !== false) {
      installRecoveryDeckDefaultStyles(documentRef);
    }
    const panel = createElement(
      documentRef,
      "div",
      this.classes.panel,
      "recovery-panel"
    );
    const header = createElement(
      documentRef,
      "header",
      this.classes.header,
      "recovery-header"
    );
    const title = createElement(
      documentRef,
      "h2",
      this.classes.title,
      "recovery-title",
      this.labels.title
    );
    title.id = `voideddev-recovery-title-${++instanceCount}`;
    header.append(title);
    if (presentation === "modal") {
      const close = createButton(
        documentRef,
        this.classes.closeButton,
        "recovery-close",
        "close",
        this.labels.close
      );
      close.setAttribute("aria-label", this.labels.close);
      close.addEventListener("click", () => this.unmount());
      header.append(close);
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      panel.setAttribute("role", "region");
    }
    panel.setAttribute("aria-labelledby", title.id);
    const description = createElement(
      documentRef,
      "p",
      this.classes.description,
      "recovery-description",
      this.labels.description
    );
    const warning = createElement(
      documentRef,
      "p",
      this.classes.warning,
      "recovery-warning",
      this.labels.warning
    );
    warning.setAttribute("role", "note");
    const hint = createElement(
      documentRef,
      "p",
      this.classes.hint,
      "recovery-reorder-hint",
      this.options.allowReorder === false ? "" : this.labels.reorderHint
    );
    this.grid = createElement(
      documentRef,
      "div",
      this.classes.deckGrid,
      "recovery-deck-grid"
    );
    this.error = createElement(
      documentRef,
      "p",
      this.classes.error,
      "recovery-error"
    );
    this.error.setAttribute("role", "alert");
    const actions = createElement(
      documentRef,
      "div",
      this.classes.actions,
      "recovery-actions"
    );
    if (this.options.showShuffle !== false) {
      this.shuffleButton = createButton(
        documentRef,
        `${this.classes.button} ${this.classes.shuffleButton}`,
        "recovery-shuffle",
        "shuffle",
        this.labels.shuffle
      );
      this.shuffleButton.addEventListener("click", () => {
        void this.replaceWithFreshDeck(true);
      });
      actions.append(this.shuffleButton);
    }
    if (this.options.onConfirm) {
      this.confirmButton = createButton(
        documentRef,
        `${this.classes.button} ${this.classes.confirmButton}`,
        "recovery-confirm",
        "confirm",
        this.labels.confirm
      );
      this.confirmButton.addEventListener("click", () => void this.confirm());
      actions.append(this.confirmButton);
    }
    panel.append(header, description, warning);
    if (hint.textContent) panel.append(hint);
    panel.append(this.grid, this.error, actions);
    this.renderDeck();
    return panel;
  }
  attach(root, documentRef, presentation) {
    this.root = root;
    this.documentRef = documentRef;
    this.presentation = presentation;
  }
  renderDeck(focusPosition) {
    if (!this.grid) return;
    const documentRef = this.grid.ownerDocument;
    this.grid.replaceChildren();
    for (const [position, id] of this.deck.entries()) {
      const card = parseCard(id);
      const selected = position === this.selectedIndex;
      const button = createButton(
        documentRef,
        addClass(this.classes.card, selected ? this.classes.selectedCard : void 0),
        "recovery-card",
        "move-card",
        ""
      );
      button.draggable = this.options.allowReorder !== false;
      button.dataset.voideddevCardId = card.id;
      button.dataset.voideddevPosition = String(position + 1);
      button.dataset.voideddevSuit = card.suit;
      button.dataset.voideddevColor = card.color;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute(
        "aria-label",
        `Position ${position + 1}: ${card.rankName} of ${card.suitName}`
      );
      const customContent = this.options.renderCardContent?.(
        card,
        { position, selected, presentation: this.presentation },
        documentRef
      );
      if (customContent) {
        button.append(customContent);
      } else {
        button.append(
          createElement(
            documentRef,
            "span",
            this.classes.cardPosition,
            "recovery-card-position",
            String(position + 1)
          ),
          createElement(
            documentRef,
            "span",
            this.classes.cardRank,
            "recovery-card-rank",
            card.rank
          ),
          createElement(
            documentRef,
            "span",
            this.classes.cardSuit,
            "recovery-card-suit",
            card.suitSymbol
          )
        );
      }
      if (this.options.allowReorder !== false) {
        button.addEventListener("click", () => this.selectOrMove(position));
        button.addEventListener(
          "keydown",
          (event) => this.handleCardKeydown(event, position)
        );
        button.addEventListener("dragstart", (event) => {
          this.dragIndex = position;
          event.dataTransfer?.setData(
            "application/x-voided-recovery-position",
            String(position)
          );
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
        button.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        button.addEventListener("drop", (event) => {
          event.preventDefault();
          const encoded = event.dataTransfer?.getData(
            "application/x-voided-recovery-position"
          );
          const from = this.dragIndex ?? Number(encoded);
          if (Number.isInteger(from)) this.moveCard(from, position);
        });
        button.addEventListener("dragend", () => {
          this.dragIndex = null;
        });
      }
      this.grid.append(button);
    }
    if (focusPosition !== void 0) {
      this.grid.querySelector(
        `[data-voideddev-position="${focusPosition + 1}"]`
      )?.focus();
    }
  }
  selectOrMove(position) {
    if (this.selectedIndex === null) {
      this.selectedIndex = position;
      this.renderDeck(position);
      return;
    }
    if (this.selectedIndex === position) {
      this.selectedIndex = null;
      this.renderDeck(position);
      return;
    }
    this.moveCard(this.selectedIndex, position);
  }
  handleCardKeydown(event, position) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const target = event.key === "ArrowLeft" ? position - 1 : position + 1;
    if (target >= 0 && target < this.deck.length) this.moveCard(position, target);
  }
  moveCard(from, to) {
    if (from === to) {
      this.selectedIndex = null;
      this.renderDeck(to);
      return;
    }
    const reordered = moveRecoveryDeckUICard(this.deck, from, to);
    this.deck.fill("");
    this.deck = reordered;
    this.selectedIndex = null;
    this.dragIndex = null;
    this.renderDeck(to);
    this.notifyChange("reorder");
  }
  async replaceWithFreshDeck(notify) {
    if (this.busy) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    this.setBusy(true, this.labels.shuffling);
    let generated = null;
    try {
      generated = await this.shuffleDeck();
      if (lifecycleGeneration !== this.lifecycleGeneration) return;
      if (!validateRecoveryDeckUICards(generated)) {
        throw new Error(this.labels.invalidDeck);
      }
      this.deck.fill("");
      this.deck = [...generated];
      this.selectedIndex = null;
      this.renderDeck();
      if (notify) this.notifyChange("shuffle");
    } catch (error) {
      if (this.error) this.error.textContent = this.labels.shuffleError;
      this.options.onError?.(error);
      if (!notify) throw error;
    } finally {
      generated?.fill("");
      if (lifecycleGeneration === this.lifecycleGeneration) {
        this.setBusy(false);
      }
    }
  }
  async confirm() {
    if (!this.options.onConfirm || this.busy || !this.error) return;
    if (!validateRecoveryDeckUICards(this.deck)) {
      this.error.textContent = this.labels.invalidDeck;
      return;
    }
    const lifecycleGeneration = this.lifecycleGeneration;
    const submitted = [...this.deck];
    this.setBusy(true);
    this.error.textContent = "";
    try {
      await this.options.onConfirm(submitted);
      if (lifecycleGeneration !== this.lifecycleGeneration) return;
      const shouldClose = this.options.closeOnConfirm ?? this.presentation === "modal";
      if (shouldClose) this.unmount();
    } catch (error) {
      if (lifecycleGeneration === this.lifecycleGeneration && this.error) {
        this.error.textContent = this.labels.confirmError;
      }
      this.options.onError?.(error);
    } finally {
      submitted.fill("");
      if (lifecycleGeneration === this.lifecycleGeneration && this.root) {
        this.setBusy(false);
      }
    }
  }
  notifyChange(reason) {
    if (!this.options.onChange) return;
    const copy = [...this.deck];
    try {
      Promise.resolve(this.options.onChange(copy, reason)).catch((error) => this.options.onError?.(error)).finally(() => copy.fill(""));
    } catch (error) {
      copy.fill("");
      this.options.onError?.(error);
    }
  }
  setBusy(busy, shuffleLabel) {
    this.busy = busy;
    if (this.shuffleButton) {
      this.shuffleButton.disabled = busy;
      this.shuffleButton.textContent = busy && shuffleLabel ? shuffleLabel : this.labels.shuffle;
    }
    if (this.confirmButton) this.confirmButton.disabled = busy;
  }
  focusFirstAction() {
    this.shuffleButton?.focus();
    if (!this.shuffleButton) this.confirmButton?.focus();
  }
};
function createRecoveryDeckUI(options) {
  return new VoidedRecoveryDeckUI(options);
}

// src/key-sharing.ts
function toUint8Array(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
var MemoryReplayStore = class {
  constructor() {
    this.consumed = /* @__PURE__ */ new Set();
  }
  async consume(id) {
    if (this.consumed.has(id)) return false;
    if (this.consumed.size >= 4096) {
      throw new CryptoError(
        "In-memory key-sharing replay cache is full; use a durable replay store"
      );
    }
    this.consumed.add(id);
    return true;
  }
};
var KeySharing = class {
  constructor(crypto2 = new CryptoService(), replayStore = new MemoryReplayStore()) {
    this.crypto = crypto2;
    this.replayStore = replayStore;
  }
  static createTransferId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  async encryptKeyForRecipient(keyToShare, ourPrivateKey, recipientPublicKey, context) {
    const transcript = this.validateContext(context, "recipient-share");
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      recipientPublicKey
    );
    let rawKey = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-key-share-v2",
        transcript
      );
      rawKey = await crypto.subtle.exportKey("raw", keyToShare);
      return await this.crypto.encrypt(
        new Uint8Array(rawKey),
        exchangeKey,
        new TextEncoder().encode(transcript)
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) this.crypto.secureWipe(rawKey);
    }
  }
  async decryptKeyFromSender(encryptedBlob, ourPrivateKey, senderPublicKey, context) {
    const transcript = this.validateContext(context, "recipient-share");
    const encryptedBytes = this.validateEncryptedKeyBlob(encryptedBlob);
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      senderPublicKey
    );
    let rawKey = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-key-share-v2",
        transcript
      );
      const iv = encryptedBytes.subarray(0, 12);
      rawKey = await this.crypto.decrypt(
        encryptedBytes,
        iv,
        exchangeKey,
        new TextEncoder().encode(transcript)
      );
      if (rawKey.length !== 32) {
        throw new CryptoError("Decrypted key must contain exactly 32 bytes");
      }
      const imported = await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      if (!await this.replayStore.consume(transcript)) {
        throw new CryptoError("Key-sharing transfer was already consumed");
      }
      return imported;
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) this.crypto.secureWipe(rawKey);
    }
  }
  async encryptKeyForTransfer(keyToTransfer, transferKey, context) {
    const transcript = this.validateContext(context, "pre-shared-transfer");
    const raw = await crypto.subtle.exportKey("raw", keyToTransfer);
    try {
      return await this.crypto.encrypt(
        new Uint8Array(raw),
        transferKey,
        new TextEncoder().encode(transcript)
      );
    } finally {
      this.crypto.secureWipe(raw);
    }
  }
  async decryptKeyFromTransfer(encryptedBlob, transferKey, context) {
    const transcript = this.validateContext(context, "pre-shared-transfer");
    const encryptedBytes = this.validateEncryptedKeyBlob(encryptedBlob);
    const iv = encryptedBytes.subarray(0, 12);
    const raw = await this.crypto.decrypt(
      encryptedBytes,
      iv,
      transferKey,
      new TextEncoder().encode(transcript)
    );
    try {
      if (raw.length !== 32) {
        throw new CryptoError("Decrypted key must contain exactly 32 bytes");
      }
      const imported = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      if (!await this.replayStore.consume(transcript)) {
        throw new CryptoError("Key-sharing transfer was already consumed");
      }
      return imported;
    } finally {
      this.crypto.secureWipe(raw);
    }
  }
  async deriveTransferKey(ourPrivateKey, theirPublicKey, context) {
    const transcript = this.validateContext(context, "derived-transfer-key");
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      theirPublicKey
    );
    try {
      return await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-transfer-v2",
        transcript
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
    }
  }
  validateContext(context, purpose) {
    if (!context || typeof context !== "object") {
      throw new CryptoError("Key-sharing context is required");
    }
    for (const [label, value] of Object.entries({
      senderId: context.senderId,
      recipientId: context.recipientId,
      keyId: context.keyId
    })) {
      if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new CryptoError(`Invalid key-sharing ${label}`);
      }
    }
    const transferIdInspection = inspectCanonicalBase64(context.transferId, 16);
    if (!transferIdInspection.ok || transferIdInspection.decodedLength !== 16) {
      throw new CryptoError(
        "Key-sharing transferId must be a canonical base64 16-byte value"
      );
    }
    if (context.salt !== void 0 && (typeof context.salt !== "string" || context.salt.length < 16 || context.salt.length > 256)) {
      throw new CryptoError("Key-sharing salt must contain 16 to 256 characters");
    }
    return JSON.stringify({
      domain: "voided/key-sharing/v2",
      purpose,
      senderId: context.senderId,
      recipientId: context.recipientId,
      keyId: context.keyId,
      transferId: context.transferId
    });
  }
  validateEncryptedKeyBlob(encryptedBlob) {
    const encryptedBytes = toUint8Array(encryptedBlob);
    if (encryptedBytes.length !== 60) {
      throw new CryptoError("Encrypted key blob must contain exactly 60 bytes");
    }
    return encryptedBytes;
  }
};

// src/index.ts
function base64Encode2(bytes) {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
  } catch {
  }
  let binary = "";
  const chunkSize = 32768;
  for (let i2 = 0; i2 < bytes.length; i2 += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i2, i2 + chunkSize)
    );
  }
  return btoa(binary);
}
function base64Decode2(b64, maxDecodedBytes = CLIENT_MAX_ENCODED_BLOB_BYTES) {
  const inspection = inspectCanonicalBase64(b64, maxDecodedBytes);
  if (!inspection.ok && inspection.reason === "too-large") {
    throw new ValidationError("Base64 value exceeds the browser decoding limit");
  }
  if (!inspection.ok) {
    throw new ValidationError("Invalid canonical base64 value");
  }
  const decodedLength = inspection.decodedLength;
  try {
    if (typeof Buffer !== "undefined") {
      const decoded = new Uint8Array(Buffer.from(b64, "base64"));
      if (decoded.length !== decodedLength) {
        throw new ValidationError("Invalid canonical base64 value");
      }
      return decoded;
    }
  } catch {
  }
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i2 = 0; i2 < len; i2++) {
    bytes[i2] = binary.charCodeAt(i2);
  }
  if (bytes.length !== decodedLength) {
    throw new ValidationError("Invalid canonical base64 value");
  }
  return bytes;
}
function concatBytes(...arrays) {
  const total = arrays.reduce((sum, value) => sum + value.length, 0);
  assertWithinClientMemoryLimit(total, "Combined cryptographic transcript");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const value of arrays) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
var IndexedDBStorage = class {
  constructor() {
    this.dbName = "voideddev-e2ee";
    this.keysStoreName = "keys";
    this.migrationStoreName = "migrations";
    this.keyPairsStoreName = "keyPairs";
    this.version = 3;
  }
  // Increment version to add key pairs store
  async getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.keysStoreName)) {
          db.createObjectStore(this.keysStoreName, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(this.migrationStoreName)) {
          db.createObjectStore(this.migrationStoreName, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(this.keyPairsStoreName)) {
          db.createObjectStore(this.keyPairsStoreName, { keyPath: "id" });
        }
      };
    });
  }
  /**
   * An IndexedDB request may succeed and its enclosing transaction may still
   * abort. Resolve reads and writes only after transaction.oncomplete so the
   * caller never treats an uncommitted value (including null) as authoritative.
   */
  awaitTransactionResult(transaction, request, readResult) {
    return new Promise((resolve, reject) => {
      let requestSucceeded = false;
      let value;
      let requestFailure;
      request.onsuccess = () => {
        try {
          value = readResult(request.result);
          requestSucceeded = true;
        } catch (error) {
          requestFailure = error;
          try {
            transaction.abort();
          } catch {
          }
        }
      };
      request.onerror = () => {
        requestFailure = request.error;
      };
      const rejectTransaction = () => {
        try {
          transaction.db.close();
        } catch {
        }
        reject(
          requestFailure ?? transaction.error ?? request.error ?? new Error("IndexedDB transaction failed")
        );
      };
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
      transaction.oncomplete = () => {
        try {
          transaction.db.close();
        } catch {
        }
        if (requestFailure || !requestSucceeded) {
          rejectTransaction();
          return;
        }
        resolve(value);
      };
    });
  }
  async getKey(keyId) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readonly");
      const request = transaction.objectStore(this.keysStoreName).get(keyId);
      return this.awaitTransactionResult(
        transaction,
        request,
        (result) => result ? result.key : null
      );
    } catch (error) {
      throw new Error(
        `Failed to read key from IndexedDB: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async setKey(keyId, key) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readwrite");
      const request = transaction.objectStore(this.keysStoreName).put({ id: keyId, key });
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error("Failed to store key: IndexedDB not available");
    }
  }
  async removeKey(keyId) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readwrite");
      const request = transaction.objectStore(this.keysStoreName).delete(keyId);
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error("Failed to remove key: IndexedDB not available");
    }
  }
  async getMigrationState(keyId) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readonly"
      );
      const request = transaction.objectStore(this.migrationStoreName).get(keyId);
      return this.awaitTransactionResult(transaction, request, (result) => {
        if (!result?.state) return null;
        return {
          ...result.state,
          cutoffTime: new Date(result.state.cutoffTime),
          createdAt: new Date(result.state.createdAt)
        };
      });
    } catch (error) {
      throw new Error(
        `Failed to read migration state from IndexedDB: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async setMigrationState(keyId, state) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.migrationStoreName).put({ id: keyId, state });
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error(
        "Failed to store migration state: IndexedDB not available"
      );
    }
  }
  async removeMigrationState(keyId) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.migrationStoreName).delete(keyId);
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error(
        "Failed to remove migration state: IndexedDB not available"
      );
    }
  }
  async getKeyPair(keyId, type) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readonly"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).get(`${keyId}_${type}`);
      return this.awaitTransactionResult(
        transaction,
        request,
        (result) => result ? result.keyPair : null
      );
    } catch (error) {
      throw new Error(
        `Failed to read key pair from IndexedDB: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async setKeyPair(keyId, type, keyPair) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).put({ id: `${keyId}_${type}`, keyPair });
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error("Failed to store key pair: IndexedDB not available");
    }
  }
  async removeKeyPair(keyId, type) {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).delete(`${keyId}_${type}`);
      return this.awaitTransactionResult(transaction, request, () => void 0);
    } catch (error) {
      throw new Error("Failed to remove key pair: IndexedDB not available");
    }
  }
};
var _VoidedE2EEClient = class _VoidedE2EEClient {
  constructor(config = {}) {
    // Reusable buffers for better memory management
    this.textEncoder = new TextEncoder();
    const configuredStorage = config.storage || new IndexedDBStorage();
    this.keyId = config.keyId || "default";
    this.enableSignatures = config.enableSignatures || false;
    if (config.enableForwardSecrecy) {
      throw new ValidationError(
        "enableForwardSecrecy was removed because the legacy mode was not a forward-secret ratchet"
      );
    }
    this.trustedSigningPublicKey = config.trustedSigningPublicKey;
    this.enableChunking = config.enableChunking !== false;
    this.chunkSize = config.chunkSize ?? 2 * 1024 * 1024;
    this.minChunkThreshold = config.minChunkThreshold ?? 10 * 1024 * 1024;
    Validator.validateKeyId(this.keyId);
    if (!Number.isSafeInteger(this.chunkSize) || this.chunkSize < CLIENT_MIN_CHUNK_BYTES || this.chunkSize > CLIENT_MAX_CHUNK_BYTES) {
      throw new ValidationError(
        `chunkSize must be an integer from ${CLIENT_MIN_CHUNK_BYTES} to ${CLIENT_MAX_CHUNK_BYTES} bytes`
      );
    }
    if (!Number.isSafeInteger(this.minChunkThreshold) || this.minChunkThreshold <= 0 || this.minChunkThreshold > CLIENT_MAX_IN_MEMORY_BYTES) {
      throw new ValidationError(
        `minChunkThreshold must be an integer from 1 to ${CLIENT_MAX_IN_MEMORY_BYTES} bytes`
      );
    }
    this.storage = new StorageService(configuredStorage);
    this.crypto = new CryptoService();
    this.keyManager = new KeyManager(this.storage, this.crypto, this.keyId);
  }
  /**
   * Derive encryption key from password using PBKDF2
   */
  async deriveKeyFromPassword(options) {
    if (!options || typeof options !== "object") {
      throw new KeyError("Key derivation failed: options are required");
    }
    const {
      password,
      salt: suppliedSalt = this.crypto.generateSalt(),
      iterations = _VoidedE2EEClient.PBKDF2_MIN_ITERATIONS
    } = options;
    try {
      if (typeof password !== "string") {
        throw new ValidationError("Password must be a string");
      }
      if (!(suppliedSalt instanceof Uint8Array)) {
        throw new ValidationError("PBKDF2 salt must be a Uint8Array");
      }
      const salt = new Uint8Array(suppliedSalt);
      if (password.length < _VoidedE2EEClient.PASSWORD_MIN_LENGTH) {
        throw new ValidationError(
          `Password must contain at least ${_VoidedE2EEClient.PASSWORD_MIN_LENGTH} characters`
        );
      }
      if (salt.length < 16 || salt.length > 64) {
        throw new ValidationError("PBKDF2 salt must contain 16 to 64 bytes");
      }
      if (!Number.isSafeInteger(iterations) || iterations < _VoidedE2EEClient.PBKDF2_MIN_ITERATIONS || iterations > _VoidedE2EEClient.PBKDF2_MAX_ITERATIONS) {
        throw new ValidationError(
          `PBKDF2 iterations must be an integer from ${_VoidedE2EEClient.PBKDF2_MIN_ITERATIONS} to ${_VoidedE2EEClient.PBKDF2_MAX_ITERATIONS}`
        );
      }
      const derivedKey = await this.crypto.deriveKeyFromPassword(
        password,
        salt,
        iterations
      );
      const keyCommitment = await this.passwordKeyCommitment(derivedKey);
      let record;
      await this.keyManager.setKey(
        derivedKey,
        1,
        {
          beforeCommit: async (keyVersion) => {
            record = {
              version: 2,
              algorithm: "PBKDF2-SHA256",
              salt: base64Encode2(salt),
              iterations,
              keyVersion,
              keyCommitment
            };
            const storageKey = this.getInternalStorageKey("password-kdf");
            const serialized = JSON.stringify(record);
            await this.storage.setKey(storageKey, serialized);
            if (await this.storage.getKey(storageKey) !== serialized) {
              throw new KeyError("Password derivation metadata storage verification failed");
            }
          }
        }
      );
      if (!record) throw new KeyError("Password derivation metadata was not committed");
      return record;
    } catch (error) {
      throw new KeyError(
        `Key derivation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async getPasswordKeyDerivationRecord(options = {}) {
    return this.keyManager.withKeyReadLease(async (lease) => {
      const stored = await this.storage.getKey(
        this.getInternalStorageKey("password-kdf")
      );
      if (!stored) return null;
      let record;
      try {
        record = JSON.parse(stored);
      } catch {
        throw new KeyError("Stored password derivation metadata is invalid");
      }
      if (!record || typeof record !== "object" || ![1, 2].includes(record.version) || record.algorithm !== "PBKDF2-SHA256" || !Number.isSafeInteger(record.iterations) || record.iterations < _VoidedE2EEClient.PBKDF2_MIN_ITERATIONS || record.iterations > _VoidedE2EEClient.PBKDF2_MAX_ITERATIONS || !Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1) {
        throw new KeyError("Stored password derivation metadata is invalid");
      }
      const salt = base64Decode2(
        record.salt,
        64
      );
      if (salt.length < 16) {
        throw new KeyError("Stored password derivation salt is invalid");
      }
      const activeVersion = await lease.getPersistedKeyVersion();
      if (activeVersion !== record.keyVersion) {
        return null;
      }
      const typedRecord = record;
      if (typedRecord.version === 1) {
        if (options.allowUnverifiedLegacy === true) return typedRecord;
        throw new KeyError(
          "Legacy password derivation metadata is not bound to the active key; pass allowUnverifiedLegacy only after independent recovery verification"
        );
      }
      const commitment = inspectCanonicalBase64(typedRecord.keyCommitment, 32);
      if (!commitment.ok || commitment.decodedLength !== 32) {
        throw new KeyError("Stored password derivation key commitment is invalid");
      }
      const currentKey = await lease.getCurrentKey();
      if (typedRecord.keyCommitment !== await this.passwordKeyCommitment(currentKey)) {
        return null;
      }
      return record;
    });
  }
  async passwordKeyCommitment(key) {
    const rawKey = await crypto.subtle.exportKey("raw", key);
    const input = concatBytes(
      this.textEncoder.encode("voided/password-kdf/key-commitment/v2\0"),
      new Uint8Array(rawKey)
    );
    try {
      const digest = await crypto.subtle.digest("SHA-256", input);
      try {
        return base64Encode2(new Uint8Array(digest));
      } finally {
        this.crypto.secureWipe(digest);
      }
    } finally {
      this.crypto.secureWipe(rawKey);
      this.crypto.secureWipe(input);
    }
  }
  hasUnpairedSurrogates(input) {
    for (let i2 = 0; i2 < input.length; i2++) {
      const code = input.charCodeAt(i2);
      if (code >= 55296 && code <= 56319) {
        const next = i2 + 1 < input.length ? input.charCodeAt(i2 + 1) : 0;
        if (!(next >= 56320 && next <= 57343)) return true;
        i2++;
      } else if (code >= 56320 && code <= 57343) {
        const prev = i2 - 1 >= 0 ? input.charCodeAt(i2 - 1) : 0;
        if (!(prev >= 55296 && prev <= 56319)) return true;
      }
    }
    return false;
  }
  /**
   * Generate and store signing key pair for digital signatures
   */
  async generateSigningKeys() {
    try {
      const keyPair = await this.crypto.generateSigningKeyPair();
      const publicKeyString = await this.crypto.exportPublicKey(
        keyPair.publicKey
      );
      this.cachedSigningKeyPair = keyPair;
      return publicKeyString;
    } catch (error) {
      throw new KeyError(
        `Signing key generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Select the peer identity key that signed incoming blobs. Generating a local
   * signing key never implicitly trusts it for incoming data.
   */
  async setTrustedSigningPublicKey(publicKey) {
    const imported = await this.crypto.importPublicKey(publicKey, "ECDSA");
    this.trustedSigningPublicKey = publicKey;
    this.trustedVerificationKey = imported;
  }
  /** Generate an agreement key pair for explicit application key agreement. */
  async generateAgreementKeys() {
    try {
      const keyPair = await this.crypto.generateKeyAgreementKeyPair();
      const publicKeyString = await this.crypto.exportPublicKey(
        keyPair.publicKey
      );
      this.cachedAgreementKeyPair = keyPair;
      return publicKeyString;
    } catch (error) {
      throw new KeyError(
        `Agreement key generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Perform key agreement with another party's public key
   */
  async performKeyAgreement(theirPublicKeyString) {
    try {
      if (!this.cachedAgreementKeyPair) {
        await this.generateAgreementKeys();
      }
      const theirPublicKey = await this.crypto.importPublicKey(
        theirPublicKeyString,
        "ECDH"
      );
      const sharedKey = await this.crypto.deriveSharedKey(
        this.cachedAgreementKeyPair.privateKey,
        theirPublicKey
      );
      await this.keyManager.setKey(
        sharedKey,
        1,
        {
          afterCommit: () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        }
      );
    } catch (error) {
      throw new KeyError(
        `Key agreement failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Get key fingerprint for identity verification
   */
  async getKeyFingerprint() {
    try {
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        return this.crypto.getKeyFingerprint(key);
      });
    } catch (error) {
      throw new KeyError(
        `Fingerprint generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Get safety numbers for identity verification (like Signal)
   */
  async getSafetyNumbers() {
    try {
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        return this.crypto.getSafetyNumbers(key);
      });
    } catch (error) {
      throw new KeyError(
        `Safety numbers generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Verify another party's key fingerprint
   */
  async verifyFingerprint(theirFingerprint) {
    try {
      const { ourFingerprint, ourSafetyNumbers } = await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        return {
          ourFingerprint: await this.crypto.getKeyFingerprint(key),
          ourSafetyNumbers: await this.crypto.getSafetyNumbers(key)
        };
      });
      return {
        fingerprint: ourFingerprint,
        safetyNumbers: ourSafetyNumbers,
        verified: ourFingerprint === theirFingerprint
      };
    } catch (error) {
      throw new KeyError(
        `Fingerprint verification failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Determine if data should be chunked based on size and configuration
   */
  shouldChunk(dataSize) {
    return this.enableChunking && dataSize >= this.minChunkThreshold;
  }
  /**
   * Split bytes into chunks for processing - OPTIMIZED VERSION
   */
  chunkBytes(data) {
    const totalLength = data.length;
    const chunkSize = this.chunkSize;
    const chunkCount = Math.ceil(totalLength / chunkSize);
    if (chunkCount < 1 || chunkCount > CLIENT_MAX_CHUNKS) {
      throw new CryptoError(
        `Chunk count must be between 1 and ${CLIENT_MAX_CHUNKS}`
      );
    }
    const chunks = new Array(chunkCount);
    for (let index = 0; index < chunkCount; index++) {
      const offset = index * chunkSize;
      chunks[index] = data.subarray(
        offset,
        Math.min(offset + chunkSize, totalLength)
      );
    }
    return chunks;
  }
  determineCompressionStrategy(_data, options) {
    return !options?.forceCompression && !options?.compressionAlgorithm;
  }
  getCompressionAlgorithm(options, shouldSkip = false) {
    if (shouldSkip) return "none";
    const requested = options?.compressionAlgorithm ?? (options?.forceCompression ? "auto" : "none");
    if (!["gzip", "brotli", "none", "auto"].includes(requested)) {
      throw new ValidationError("Unsupported compression algorithm");
    }
    return requested;
  }
  createMessageId() {
    return base64Encode2(crypto.getRandomValues(new Uint8Array(16)));
  }
  buildEnvelopeAad(blob, index, plaintextSize) {
    return this.textEncoder.encode(
      JSON.stringify({
        domain: "voided/e2ee-client/aead/v1.1",
        version: blob.version,
        messageId: blob.messageId,
        keyId: blob.keyId,
        algorithm: blob.algorithm,
        compressionAlgorithm: blob.compression.algorithm,
        originalSize: blob.compression.originalSize,
        compressedSize: blob.compression.compressedSize,
        textEncoding: blob.textEncoding,
        chunked: Boolean(blob.chunkInfo?.isChunked),
        totalChunks: blob.chunkInfo?.totalChunks ?? 1,
        chunkSize: blob.chunkInfo?.chunkSize ?? plaintextSize,
        index,
        plaintextSize
      })
    );
  }
  buildSignaturePayload(aad, encryptedData) {
    const domain = this.textEncoder.encode("voided/e2ee-client/signature/v1\0");
    return concatBytes(domain, aad, encryptedData ?? new Uint8Array(0));
  }
  requireSigningKeyForEncryption() {
    if (!this.cachedSigningKeyPair) {
      throw new CryptoError(
        "Signature mode requires generateSigningKeys() before encryption"
      );
    }
    return this.cachedSigningKeyPair.privateKey;
  }
  async getTrustedVerificationKey() {
    if (this.trustedVerificationKey) return this.trustedVerificationKey;
    if (!this.trustedSigningPublicKey) {
      throw new CryptoError(
        "Signature mode requires an explicitly trusted peer signing public key"
      );
    }
    this.trustedVerificationKey = await this.crypto.importPublicKey(
      this.trustedSigningPublicKey,
      "ECDSA"
    );
    return this.trustedVerificationKey;
  }
  async signPayload(payload) {
    const signature = await this.crypto.signData(
      payload,
      this.requireSigningKeyForEncryption()
    );
    return base64Encode2(new Uint8Array(signature));
  }
  async verifyRequiredSignature(payload, signature, label) {
    if (!signature) {
      throw new CryptoError(`Missing required ${label} signature`);
    }
    const verificationKey = await this.getTrustedVerificationKey();
    const signatureBytes = base64Decode2(signature, 1024);
    const valid = await this.crypto.verifySignature(
      payload,
      signatureBytes.buffer.slice(
        signatureBytes.byteOffset,
        signatureBytes.byteOffset + signatureBytes.byteLength
      ),
      verificationKey
    );
    if (!valid) {
      throw new CryptoError(`Invalid ${label} signature`);
    }
  }
  /**
   * Encrypt data with compression and optional digital signature
   */
  async encrypt(data, options) {
    Validator.validateData(data);
    try {
      const prepared = this.encodeAuthenticatedText(data);
      const originalSize = options?.originalSizeBytes ?? prepared.bytes.length;
      assertWithinClientUploadLimit(originalSize);
      if (options?.resumeTokenOriginalSize !== void 0) {
        assertWithinClientUploadLimit(options.resumeTokenOriginalSize);
      }
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        if (this.shouldChunk(prepared.bytes.length)) {
          return this.encryptWithChunking(
            data,
            prepared.bytes,
            prepared.textEncoding,
            key,
            options
          );
        }
        return this.encryptWithoutChunking(
          data,
          prepared.bytes,
          prepared.textEncoding,
          key,
          options
        );
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError || error instanceof E2EEError) {
        throw error;
      }
      throw new CryptoError(
        `Encryption failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Protect data with the Voided 1.0 whole-monolith full flow.
   */
  async protect(data, options = {}) {
    Validator.validateData(data);
    if (this.enableSignatures) {
      throw new CryptoError(
        "VoidedE2EEClient.protect does not yet support signature wrapping"
      );
    }
    try {
      const { bytes, textEncoding } = this.encodeProtectableText(data);
      assertWithinClientUploadLimit(bytes.length);
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        const rawKey = await this.exportRawKeyBytes(key);
        try {
          const protectedArtifact = await protect(bytes, rawKey, {
            preset: options.preset,
            // Compression is opt-in in the high-level browser API because mixing
            // secrets and attacker-controlled data creates a length oracle.
            compressionAlgorithm: options.compressionAlgorithm ?? "none",
            compressionLevel: options.compressionLevel,
            encryptionAlgorithm: options.encryptionAlgorithm,
            shellChunkSize: options.shellChunkSize
          });
          return this.toProtectedBlob(protectedArtifact, textEncoding);
        } finally {
          this.crypto.secureWipe(rawKey);
        }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError || error instanceof E2EEError) {
        throw error;
      }
      throw new CryptoError(
        `Protect failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Encrypt data with bounded chunk concurrency and authenticated framing.
   */
  async encryptWithChunking(data, plaintextBytes, textEncoding, key, options) {
    const originalSize = options?.originalSizeBytes ?? plaintextBytes.length;
    assertWithinClientUploadLimit(originalSize);
    assertWithinClientMemoryLimit(plaintextBytes.length, "Plaintext");
    const shouldSkipCompression = this.determineCompressionStrategy(data, options);
    const compressionResult = await compress(plaintextBytes, {
      algorithm: this.getCompressionAlgorithm(options, shouldSkipCompression),
      minSizeThreshold: shouldSkipCompression ? Infinity : 100,
      compressionLevel: options?.compressionLevel ?? 6
    });
    assertWithinClientMemoryLimit(
      compressionResult.compressed.length,
      "Compressed plaintext"
    );
    const dataChunks = this.chunkBytes(compressionResult.compressed);
    if (this.enableSignatures) this.requireSigningKeyForEncryption();
    const blob = {
      keyId: this.keyId,
      messageId: this.createMessageId(),
      algorithm: "AES-GCM",
      version: "1.1",
      compression: {
        algorithm: compressionResult.algorithm,
        originalSize: plaintextBytes.length,
        compressedSize: compressionResult.compressed.length
      },
      textEncoding,
      chunks: [],
      chunkInfo: {
        totalChunks: dataChunks.length,
        chunkSize: this.chunkSize,
        isChunked: true
      }
    };
    blob.chunks = await mapWithConcurrency(
      dataChunks,
      CLIENT_CHUNK_CONCURRENCY,
      async (chunkBytes, index) => {
        const aad = this.buildEnvelopeAad(blob, index, chunkBytes.length);
        const encrypted = new Uint8Array(
          await this.crypto.encrypt(chunkBytes, key, aad)
        );
        const chunk = {
          data: base64Encode2(encrypted),
          iv: base64Encode2(encrypted.subarray(0, 12)),
          index,
          plaintextSize: chunkBytes.length
        };
        if (this.enableSignatures) {
          chunk.signature = await this.signPayload(
            this.buildSignaturePayload(aad, encrypted)
          );
        }
        return chunk;
      }
    );
    if (this.enableSignatures) {
      const headerAad = this.buildEnvelopeAad(
        blob,
        -1,
        blob.compression.compressedSize
      );
      blob.signature = await this.signPayload(
        this.buildSignaturePayload(headerAad)
      );
    }
    return blob;
  }
  /**
   * Encrypt a single authenticated browser envelope.
   */
  async encryptWithoutChunking(data, plaintextBytes, textEncoding, key, options) {
    const originalSize = options?.originalSizeBytes ?? plaintextBytes.length;
    assertWithinClientUploadLimit(originalSize);
    assertWithinClientMemoryLimit(plaintextBytes.length, "Plaintext");
    const shouldSkipCompression = this.determineCompressionStrategy(data, options);
    const compressionResult = await compress(plaintextBytes, {
      algorithm: this.getCompressionAlgorithm(options, shouldSkipCompression),
      minSizeThreshold: shouldSkipCompression ? Infinity : 100,
      compressionLevel: options?.compressionLevel ?? 6
    });
    assertWithinClientMemoryLimit(
      compressionResult.compressed.length,
      "Compressed plaintext"
    );
    if (this.enableSignatures) this.requireSigningKeyForEncryption();
    const blob = {
      keyId: this.keyId,
      messageId: this.createMessageId(),
      algorithm: "AES-GCM",
      version: "1.1",
      compression: {
        algorithm: compressionResult.algorithm,
        originalSize: plaintextBytes.length,
        compressedSize: compressionResult.compressed.length
      },
      textEncoding
    };
    const aad = this.buildEnvelopeAad(
      blob,
      0,
      compressionResult.compressed.length
    );
    const encrypted = new Uint8Array(
      await this.crypto.encrypt(compressionResult.compressed, key, aad)
    );
    blob.data = base64Encode2(encrypted);
    blob.iv = base64Encode2(encrypted.subarray(0, 12));
    if (this.enableSignatures) {
      blob.signature = await this.signPayload(
        this.buildSignaturePayload(aad, encrypted)
      );
    }
    return blob;
  }
  /**
   * Decrypt data with decompression and optional signature verification
   */
  async decrypt(blob) {
    Validator.validateEncryptedBlob(blob);
    if (blob.keyId !== this.keyId) {
      throw new CryptoError("Encrypted blob keyId does not match this client");
    }
    try {
      return await this.keyManager.withKeyReadLease(async (lease) => {
        if (blob.chunkInfo?.isChunked && blob.chunks) {
          return this.decryptChunkedData(blob, lease);
        }
        return this.decryptNonChunkedData(blob, lease);
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError || error instanceof E2EEError) {
        throw error;
      }
      throw new CryptoError(
        `Decryption failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Open a current VOF3 monolith protected blob.
   */
  async open(blob) {
    Validator.validateProtectedBlob(blob);
    if (blob.keyId !== this.keyId) {
      throw new CryptoError("Protected blob keyId does not match this client");
    }
    try {
      const artifact = base64Decode2(blob.artifact);
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const decryptionKey = await lease.getCurrentKey();
        try {
          const rawKey = await this.exportRawKeyBytes(decryptionKey);
          try {
            const plaintext = await open(artifact, rawKey);
            return this.decodeProtectedText(plaintext, blob.textEncoding);
          } finally {
            this.crypto.secureWipe(rawKey);
          }
        } catch (decryptError) {
          const migrationState = await lease.getMigrationStatus();
          if (migrationState?.isActive) {
            const legacyKey = await lease.getLegacyKey();
            if (legacyKey) {
              const rawLegacyKey = await this.exportRawKeyBytes(legacyKey);
              try {
                const plaintext = await open(artifact, rawLegacyKey);
                return this.decodeProtectedText(plaintext, blob.textEncoding);
              } finally {
                this.crypto.secureWipe(rawLegacyKey);
              }
            }
          }
          throw decryptError;
        }
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError || error instanceof E2EEError) {
        throw error;
      }
      throw new CryptoError(
        `Open failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Inspect a current VOF3 monolith protected blob without opening it.
   */
  async inspectProtected(blob) {
    Validator.validateProtectedBlob(blob);
    try {
      const artifact = base64Decode2(blob.artifact);
      const info = await inspectArtifact(artifact);
      return this.toProtectedBlobInfo(info, blob.keyId);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError(
        `Inspect failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Decrypt chunked data without ever accepting a partial or mixed-key result.
   */
  async decryptChunkedData(blob, lease) {
    if (!blob.chunks || !blob.chunkInfo) {
      throw new CryptoError("Invalid chunked data: missing chunks or chunk info");
    }
    if (this.enableSignatures) {
      const headerAad = this.buildEnvelopeAad(
        blob,
        -1,
        blob.compression.compressedSize
      );
      await this.verifyRequiredSignature(
        this.buildSignaturePayload(headerAad),
        blob.signature,
        "envelope"
      );
      for (const chunk of blob.chunks) {
        const encrypted = base64Decode2(
          chunk.data,
          CLIENT_MAX_CHUNK_BYTES + 12 + 16
        );
        const aad = this.buildEnvelopeAad(
          blob,
          chunk.index,
          chunk.plaintextSize
        );
        await this.verifyRequiredSignature(
          this.buildSignaturePayload(aad, encrypted),
          chunk.signature,
          `chunk ${chunk.index}`
        );
      }
    }
    const currentKey = await lease.getCurrentKey();
    let decryptedChunks;
    try {
      decryptedChunks = await this.decryptChunksWithKey(blob, currentKey);
    } catch (currentError) {
      const legacyKey = await lease.getLegacyKey();
      if (!legacyKey) throw currentError;
      decryptedChunks = await this.decryptChunksWithKey(blob, legacyKey);
    }
    const totalCompressedSize = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    if (totalCompressedSize !== blob.compression.compressedSize) {
      throw new CryptoError(
        "Chunk plaintext total does not match authenticated compression metadata"
      );
    }
    assertWithinClientMemoryLimit(totalCompressedSize, "Chunk plaintext total");
    const compressedBytes = new Uint8Array(totalCompressedSize);
    let offset = 0;
    for (const chunk of decryptedChunks) {
      compressedBytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await this.decompressAndDecode(blob, compressedBytes);
  }
  async decryptChunksWithKey(blob, key) {
    return await mapWithConcurrency(
      blob.chunks,
      CLIENT_CHUNK_CONCURRENCY,
      async (chunk) => {
        const encrypted = base64Decode2(
          chunk.data,
          CLIENT_MAX_CHUNK_BYTES + 12 + 16
        );
        const iv = base64Decode2(chunk.iv, 12);
        if (iv.length !== 12) throw new CryptoError("Invalid AES-GCM IV length");
        const aad = this.buildEnvelopeAad(
          blob,
          chunk.index,
          chunk.plaintextSize
        );
        const decrypted = await this.crypto.decrypt(encrypted, iv, key, aad);
        if (decrypted.length !== chunk.plaintextSize) {
          throw new CryptoError(
            `Chunk ${chunk.index} size does not match authenticated metadata`
          );
        }
        return decrypted;
      }
    );
  }
  async decryptNonChunkedData(blob, lease) {
    if (!blob.data || !blob.iv) {
      throw new CryptoError("Invalid non-chunked data: missing data or IV");
    }
    const encrypted = base64Decode2(
      blob.data,
      CLIENT_MAX_IN_MEMORY_BYTES + 12 + 16
    );
    const iv = base64Decode2(blob.iv, 12);
    if (iv.length !== 12) throw new CryptoError("Invalid AES-GCM IV length");
    const aad = this.buildEnvelopeAad(
      blob,
      0,
      blob.compression.compressedSize
    );
    if (this.enableSignatures) {
      await this.verifyRequiredSignature(
        this.buildSignaturePayload(aad, encrypted),
        blob.signature,
        "envelope"
      );
    }
    const currentKey = await lease.getCurrentKey();
    let decrypted;
    try {
      decrypted = await this.crypto.decrypt(encrypted, iv, currentKey, aad);
    } catch (currentError) {
      const legacyKey = await lease.getLegacyKey();
      if (!legacyKey) throw currentError;
      decrypted = await this.crypto.decrypt(encrypted, iv, legacyKey, aad);
    }
    if (decrypted.length !== blob.compression.compressedSize) {
      throw new CryptoError(
        "Plaintext size does not match authenticated compression metadata"
      );
    }
    return await this.decompressAndDecode(blob, decrypted);
  }
  async decompressAndDecode(blob, compressed) {
    const decompressed = await decompress(
      compressed,
      blob.compression.algorithm,
      {
        expectedOutputBytes: blob.compression.originalSize,
        maxOutputBytes: CLIENT_MAX_IN_MEMORY_BYTES,
        maxExpansionRatio: 512
      }
    );
    if (blob.textEncoding === "utf16le") {
      if (decompressed.length % 2 !== 0) {
        throw new CryptoError("Invalid authenticated UTF-16LE byte length");
      }
      return this.utf16LEBytesToString(decompressed);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(decompressed);
  }
  // UTF-16LE helpers preserve otherwise unpaired JavaScript surrogates.
  utf16LEBytesToString(bytes) {
    let result = "";
    for (let i2 = 0; i2 < bytes.length; i2 += 2) {
      const low = bytes[i2];
      const high = bytes[i2 + 1] || 0;
      const codeUnit = low | high << 8;
      result += String.fromCharCode(codeUnit);
    }
    return result;
  }
  // Also fix the UTF-16LE encoding to ensure it's consistent:
  stringToUtf16LEBytes(input) {
    const out = new Uint8Array(input.length * 2);
    for (let i2 = 0; i2 < input.length; i2++) {
      const code = input.charCodeAt(i2);
      out[i2 * 2] = code & 255;
      out[i2 * 2 + 1] = code >>> 8 & 255;
    }
    return out;
  }
  encodeAuthenticatedText(input) {
    const textEncoding = this.hasUnpairedSurrogates(input) ? "utf16le" : "utf8";
    const byteLength = textEncoding === "utf16le" ? input.length * 2 : this.utf8ByteLength(input, CLIENT_MAX_IN_MEMORY_BYTES);
    assertWithinClientMemoryLimit(byteLength, "Plaintext");
    const bytes = textEncoding === "utf16le" ? this.stringToUtf16LEBytes(input) : this.textEncoder.encode(input);
    if (bytes.length !== byteLength) {
      throw new CryptoError("Text encoding length preflight mismatch");
    }
    return {
      bytes,
      textEncoding
    };
  }
  utf8ByteLength(input, stopAfter) {
    let bytes = 0;
    for (let index = 0; index < input.length; index++) {
      const code = input.charCodeAt(index);
      if (code <= 127) {
        bytes += 1;
      } else if (code <= 2047) {
        bytes += 2;
      } else if (code >= 55296 && code <= 56319) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
      if (bytes > stopAfter) return bytes;
    }
    return bytes;
  }
  encodeProtectableText(input) {
    const domain = this.textEncoder.encode("VOI-TEXT-1");
    const { bytes, textEncoding } = this.encodeAuthenticatedText(input);
    return {
      bytes: concatBytes(
        domain,
        Uint8Array.of(textEncoding === "utf16le" ? 1 : 0),
        bytes
      ),
      textEncoding
    };
  }
  decodeProtectedText(bytes, _textEncoding) {
    const domain = this.textEncoder.encode("VOI-TEXT-1");
    if (bytes.length < domain.length + 1) {
      throw new CryptoError("Protected text envelope is missing");
    }
    for (let i2 = 0; i2 < domain.length; i2++) {
      if (bytes[i2] !== domain[i2]) {
        throw new CryptoError("Protected text envelope is invalid");
      }
    }
    const encoding = bytes[domain.length];
    const plaintext = bytes.subarray(domain.length + 1);
    if (encoding === 1) {
      if (plaintext.length % 2 !== 0) {
        throw new CryptoError("Protected UTF-16LE payload has invalid length");
      }
      return this.utf16LEBytesToString(plaintext);
    }
    if (encoding === 0) {
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    }
    throw new CryptoError("Protected text envelope has an unknown encoding");
  }
  getInternalStorageKey(purpose) {
    return `${this.keyId}::voided:internal:${purpose}`;
  }
  async exportRawKeyBytes(key) {
    return base64Decode2(await this.crypto.exportKey(key));
  }
  toProtectedBlob(result, textEncoding) {
    return {
      artifact: base64Encode2(result.artifact),
      keyId: this.keyId,
      version: "2.0",
      pipeline: "compression->encryption->fused-shell",
      preset: result.preset,
      compression: {
        algorithm: result.compressionAlgorithm,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize
      },
      encryptionAlgorithm: result.encryptionAlgorithm,
      shell: {
        chunkSize: result.shellChunkSize,
        chunkCount: result.shellChunkCount
      },
      protectedSize: result.protectedSize,
      textEncoding
    };
  }
  toProtectedBlobInfo(info, keyId) {
    return {
      keyId,
      version: "2.0",
      pipeline: "compression->encryption->fused-shell",
      preset: info.preset,
      compression: {
        algorithm: info.compressionAlgorithm,
        originalSize: info.originalSize,
        compressedSize: info.compressedSize
      },
      encryptionAlgorithm: info.encryptionAlgorithm,
      shell: {
        chunkSize: info.shellChunkSize,
        chunkCount: info.shellChunkCount
      },
      protectedSize: info.protectedSize
    };
  }
  /**
   * Export current key as base64 string
   */
  async exportKey() {
    try {
      return await this.keyManager.withKeyReadLease(async (lease) => {
        const key = await lease.getCurrentKey();
        return this.crypto.exportKey(key);
      });
    } catch (error) {
      throw new Error(
        `Key export failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Import key from base64 string
   */
  async importKey(keyString) {
    Validator.validateKeyString(keyString);
    try {
      const key = await this.crypto.importKey(keyString);
      await this.keyManager.setKey(
        key,
        1,
        {
          afterCommit: () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        }
      );
    } catch (error) {
      if (error instanceof ValidationError || error instanceof KeyError) {
        throw error;
      }
      throw new KeyError(
        `Key import failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Rotate encryption key
   */
  async rotateKey(options = {}) {
    Validator.validateRotationOptions(options);
    const { force = true, migrate = false, cutoffTime = /* @__PURE__ */ new Date() } = options;
    try {
      let rotatedKey;
      if (force) {
        rotatedKey = await this.keyManager.forceRotate(
          () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        );
      } else if (migrate) {
        rotatedKey = await this.keyManager.startMigration(
          cutoffTime,
          () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        );
      } else {
        throw new ValidationError("Invalid rotation options");
      }
      return rotatedKey;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof KeyError) {
        throw error;
      }
      throw new KeyError(
        `Key rotation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Delete current key and all cached key pairs
   */
  async deleteKey() {
    try {
      await this.keyManager.deleteKey(
        () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
      );
      this.clearCachedKeyPairs();
    } catch (error) {
      throw new Error(
        `Key deletion failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Clear cached keys from memory with secure wiping
   */
  clearCachedKey() {
    this.keyManager.clearCache();
    this.clearCachedKeyPairs();
  }
  /**
   * Clear cached key pairs with secure wiping
   */
  clearCachedKeyPairs() {
    this.cachedSigningKeyPair = void 0;
    this.cachedAgreementKeyPair = void 0;
  }
  /**
   * Check if key exists
   */
  async hasKey() {
    return await this.keyManager.hasKey();
  }
  /**
   * Get migration status
   */
  async getMigrationStatus() {
    return await this.keyManager.getMigrationStatus();
  }
  /**
   * Finalize migration (remove old key)
   */
  async finalizeMigration() {
    try {
      await this.keyManager.finalizeMigration();
    } catch (error) {
      throw new Error(
        `Migration finalization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Get current key version
   */
  async getCurrentKeyVersion() {
    return await this.keyManager.getCurrentKeyVersion();
  }
  /**
   * Get migration info
   */
  async getMigrationInfo() {
    const status = await this.keyManager.getMigrationStatus();
    if (!status) return null;
    return {
      oldKeyVersion: status.oldKeyVersion,
      newKeyVersion: status.newKeyVersion,
      cutoffTime: status.cutoffTime,
      createdAt: status.createdAt
    };
  }
};
_VoidedE2EEClient.PBKDF2_MIN_ITERATIONS = 6e5;
_VoidedE2EEClient.PBKDF2_MAX_ITERATIONS = 1e6;
_VoidedE2EEClient.PASSWORD_MIN_LENGTH = 12;
var VoidedE2EEClient = _VoidedE2EEClient;
var defaultClient = null;
function getDefaultClient() {
  if (!defaultClient) {
    defaultClient = new VoidedE2EEClient();
  }
  return defaultClient;
}
async function encrypt2(data, options) {
  return getDefaultClient().encrypt(data, options);
}
async function decrypt2(blob) {
  return getDefaultClient().decrypt(blob);
}
async function protect2(data, options) {
  return getDefaultClient().protect(data, options);
}
async function open2(blob) {
  return getDefaultClient().open(blob);
}
async function inspectProtected(blob) {
  return getDefaultClient().inspectProtected(blob);
}
async function exportKey() {
  return getDefaultClient().exportKey();
}
async function importKey(keyString) {
  return getDefaultClient().importKey(keyString);
}
async function rotateKey() {
  return getDefaultClient().rotateKey();
}
async function deriveKeyFromPassword(options) {
  return getDefaultClient().deriveKeyFromPassword(options);
}
async function getPasswordKeyDerivationRecord(options = {}) {
  return getDefaultClient().getPasswordKeyDerivationRecord(options);
}
async function getKeyFingerprint() {
  return getDefaultClient().getKeyFingerprint();
}
async function getSafetyNumbers() {
  return getDefaultClient().getSafetyNumbers();
}

export { CryptoService, IndexedDBStorage, KeySharing, RECOVERY_DECK_DEFAULT_CSS, RECOVERY_DECK_UI_CARD_IDS, VoidedE2EEClient, VoidedKeyExport, VoidedKeyImport, VoidedRecoveryDeckUI, configureWasmLoader, createKeyExport, createKeyImport, createRecoveryDeck, createRecoveryDeckUI, crypto_backend_exports as crypto, cryptoService, decompressBounded, decrypt2 as decrypt, deriveKeyFromPassword, deriveRecoveryKey, encodeRecoveryDeck, encrypt2 as encrypt, exportKey, forceTypeScriptBackend, forceWasmBackend, generateRecoveryDeck, getCurrentBackend, getKeyFingerprint, getPasswordKeyDerivationRecord, getSafetyNumbers, getWasm, getWasmError, getWasmSync, hashService, importKey, initWasm, inspectProtected, installRecoveryDeckDefaultStyles, isWasmBackendReady, isWasmReady, moveRecoveryDeckUICard, open2 as open, protect2 as protect, rotateKey, rotateRecoveryDeck, unwrapRootWithRecoveryKey, useWasmBackend, validateRecoveryDeck, validateRecoveryDeckUICards, wrapRootWithRecoveryKey };
