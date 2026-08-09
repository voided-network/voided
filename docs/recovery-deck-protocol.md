# Recovery Deck Protocol

Recovery Deck is a stateless recovery-key primitive owned by Voided. One
cryptographically shuffled standard 52-card deck deterministically derives one
Recovery Key, which can unwrap a stable user/account root. Applications remain
isolated below that root and do not need one deck per application.

The deck is not identity, authentication, an application data key, or a device
transfer format. Voided implements the primitive; a product such as Slipner is
responsible for display, entry, physical-backup guidance, warnings, and its own
authentication integration.

## Initial protocol constants

These values are permanent for this protocol. An incompatible future scheme
must use a separate protocol and domain rather than changing them in place.

- Card indices `0..51` use suits in `S, H, D, C` order.
- Ranks within a suit use `A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K` order.
- Canonical IDs are ASCII concatenations such as `AS`, `10H`, and `KC`.
- Encoding is the permutation's zero-based Lehmer rank as exactly 29
  big-endian bytes, including leading zero bytes.
- Recovery-key derivation is HKDF-SHA256 with no salt, the canonical 29-byte
  rank as input key material, and exact info bytes
  `voided/recovery/deck`.
- Root wrapping uses XChaCha20-Poly1305 with exact AAD bytes
  `voided/recovery/deck/root-wrap`.
- A root is exactly 32 bytes. Its wrapper uses recovery-wrapper schema 1 and is
  exactly 80 bytes.

The canonical ordered deck therefore encodes to 29 zero bytes and derives this
fixed protocol vector:

```text
7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c
```

The 256-bit output does not add entropy. A uniformly random deck contains
approximately `log2(52!) = 225.58` bits.

## Persistence boundary

The implementation is stateless. Do not persist, log, serialize to durable
state, send to telemetry, or place on a clipboard:

- the ordered deck
- the 29-byte permutation rank
- the derived Recovery Key
- a human-readable card sequence

Only the opaque authenticated root wrapper is designed for persistence. A
backend may store that wrapper without learning the deck or Recovery Key. The
library never writes a deck or derived key to IndexedDB, a database, Slipner,
or any other storage system.

JavaScript strings cannot be reliably zeroized by an application. Browser and
Node consumers should minimize references and lifetime, never stringify the
deck, keep it out of framework state persistence/devtools, and dispose of UI
state immediately after setup or recovery. Rust deck state, canonical rank
buffers, binding input copies, and derived key objects are zeroized on drop or
immediately after use where the language permits.

## APIs

The Rust core, Node native binding, and current browser WASM artifact expose:

```text
generateRecoveryDeck()
validateRecoveryDeck(deck)
encodeRecoveryDeck(deck)
deriveRecoveryKey(deck)
wrapRootWithRecoveryKey(rootKey, recoveryKey)
unwrapRootWithRecoveryKey(rootWrapper, recoveryKey)
createRecoveryDeck(rootKey)
rotateRecoveryDeck(rootWrapper, oldDeck)
```

`createRecoveryDeck` returns the fresh deck and opaque root wrapper without
persisting either. Callers show the deck, verify the physical backup, discard
the in-memory deck, and persist only the wrapper.

`rotateRecoveryDeck` first reconstructs the old Recovery Key and unwraps the
same stable root, then generates a wholly new CSPRNG deck and wrapper. The
caller must atomically replace the persisted old wrapper with the new wrapper.
It does not change application keys or re-encrypt data. Rearranging the old
deck is not a secure rotation.

Replacement invalidates the old deck only at the wrapper-distribution layer.
An attacker who already copied both the old deck and its old wrapper can still
unwrap that offline forever; no stateless wrapping scheme can revoke an
already copied credential without changing the protected root. Products must
control wrapper access, remove the old persisted wrapper atomically, and choose
a broader root/data-key rotation when their threat model includes compromise
of both values.

The browser helpers require the Rust/WASM protocol. They fail closed when an
older WASM artifact or the TypeScript fallback is active; there is no alternate
JavaScript derivation that could silently diverge from the permanent mapping.

## Security boundary

Generation uses the operating-system CSPRNG and `rand`'s uniform Fisher-Yates
shuffle. Validation occurs before ranking or derivation and requires exactly
52 known cards, each exactly once. Wrappers authenticate the root and the fixed
recovery purpose. A wrong deck, modified wrapper, or wrong Recovery Key fails
authentication.

Brute force is not the practical risk. Product integrations must defend the
plaintext deck from screenshots, screen recording, photographs, malware,
clipboard capture, logs, analytics, crash reports, browser persistence,
accidental sync, and unnecessary memory copies.
