export type CanonicalBase64Inspection =
  | { ok: true; decodedLength: number }
  | { ok: false; reason: "not-canonical" | "too-large" };

function base64SextetValue(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  return code === 43 ? 62 : code === 47 ? 63 : -1;
}

/**
 * Validate canonical padded RFC 4648 base64 and calculate its decoded size
 * without decoding or allocating a byte buffer.
 */
export function inspectCanonicalBase64(
  value: unknown,
  maxDecodedBytes: number
): CanonicalBase64Inspection {
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
  if (
    value.length % 4 !== 0
  ) {
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
  if (
    (padding === 2 &&
      (base64SextetValue(value[value.length - 3]) & 0x0f) !== 0) ||
    (padding === 1 &&
      (base64SextetValue(value[value.length - 2]) & 0x03) !== 0)
  ) {
    return { ok: false, reason: "not-canonical" };
  }

  const decodedLength = (value.length / 4) * 3 - padding;
  if (
    !Number.isSafeInteger(decodedLength) ||
    decodedLength < 0 ||
    decodedLength > maxDecodedBytes
  ) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, decodedLength };
}
