# voided-bench

Raw Voided artifact benchmark.

This benchmark intentionally does not emit a capped "security score." Security
gates are reported as counts, artifact statistics are reported as raw measured
values, and performance/size are reported directly.

Run the synthetic corpus:

```sh
cargo run -p voided-bench --release --
```

Run a real corpus directory:

```sh
cargo run -p voided-bench --release -- --corpus /path/to/corpus
```

Output formats:

```sh
cargo run -p voided-bench --release -- --format markdown
cargo run -p voided-bench --release -- --format json
cargo run -p voided-bench --release -- --format csv
```

Useful knobs:

```sh
cargo run -p voided-bench --release -- --samples 7 --details
```

Columns are intentionally not normalized to 100. Natural bounded values, like
avalanche percentage, stay percentages. Everything else stays in its native unit.
