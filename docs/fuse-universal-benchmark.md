# Universal Fuse Benchmark

This benchmark is meant to compare Voided fuse implementations through the real package surface instead of through lab-only copies. It calls `voided_core::shell::fuse_bytes` and `voided_core::shell::unfuse_bytes`, using the balanced preset and deterministic nonces so runs are repeatable.

The scoring is deliberately more generic than the compression-lab research boards. It does not inspect Voided-specific geometry, controller choices, or internal map/monolith features. It measures the artifact as bytes:

- `encode_mib_s` and `decode_mib_s`: throughput over the original input size.
- `overhead_bytes` and `overhead_pct`: serialized fused output growth over the input.
- `entropy_bits_per_byte`: byte entropy of the serialized fused artifact.
- `chi_square_z`: byte-distribution uniformity against a 256-bucket uniform distribution.
- `bit_one_ratio`: bit balance, where random-looking output should be near `0.5`.
- `serial_correlation`: adjacent-byte correlation, where random-looking output should be near `0`.
- `avalanche_ratio`: output bit-change ratio after flipping one input bit under the same key and nonce, where `0.5` is ideal.
- `security_score`: weighted byte-statistical opacity score.
- `efficiency_score`: throughput score with encode weighted more heavily than decode.
- `size_score`: overhead penalty score.
- `universal_value_score`: combined `security_score`, `efficiency_score`, `size_score`, and roundtrip correctness.

The benchmark also emits warning flags for outliers: failed roundtrip, high overhead, low entropy, byte-uniformity outliers, bit-balance outliers, serial-correlation outliers, avalanche outliers, and slow encode.

Fetch the public corpus:

```bash
bash scripts/fetch-public-fuse-corpus.sh /tmp/voided-public-fuse-corpus
```

Run the benchmark:

```bash
cargo run -p voided-core --example fuse_universal_public_bench --features backend --release -- \
  --corpus-dir /tmp/voided-public-fuse-corpus \
  --candidate voided-fuse-current \
  --commit "$(git rev-parse --short HEAD)" \
  --json-out reports/fuse-universal-public/current.json \
  --markdown-out reports/fuse-universal-public/current.md
```

To compare an older commit without changing the working tree, export that commit to a temporary directory, copy this example into the exported `crates/voided-core/examples/` directory, and run the same command there with the old commit label.

Useful future baseline candidates are ordinary AEAD/file-token systems, not Voided-shaped internals: RustCrypto `chacha20poly1305`/`XChaCha20Poly1305`, libsodium `secretbox` or `XChaCha20-Poly1305`, age-style file encryption, Fernet-style tokens, and PASETO local tokens. Those candidates can be added by wrapping their public encrypt/decrypt calls in the same artifact interface and feeding their serialized output through this benchmark.
