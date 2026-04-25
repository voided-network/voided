# Voided Fuse Universal Public Corpus Comparison

This report compares the real Voided package fuse surface at commit `8266ff8` against the current package fuse surface at commit `73f2f8f`. Both runs used the same public corpus, balanced preset, deterministic nonces, and the same benchmark harness.

| metric | v1 package | v2 current | v2 delta |
|---|---:|---:|---:|
| fixtures | 8 | 8 |  |
| total input bytes | 2276665 | 2276665 | 0 |
| total output bytes | 2276969 | 2277531 | 562 |
| avg overhead % | 0.163 | 0.197 | 0.035 |
| weighted encode MiB/s | 105.71 | 70.39 | -35.32 |
| weighted decode MiB/s | 108.03 | 49.62 | -58.41 |
| security score | 72.89 | 79.43 | 6.54 |
| efficiency score | 73.26 | 53.18 | -20.08 |
| size score | 99.37 | 99.23 | -0.14 |
| universal value score | 80.96 | 78.85 | -2.11 |
| avg avalanche ratio | 0.000 | 0.247 | 0.246 |
| avg entropy bits | 7.992 | 7.990 | -0.002 |
| avg abs chi-square z | 0.866 | 4.600 | 3.734 |

## Fixture Detail

| fixture | v1 enc | v2 enc | v1 overhead % | v2 overhead % | v1 security | v2 security | v1 value | v2 value |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| alice-wonderland.gutenberg.txt | 96.69 | 56.17 | 0.02 | 0.05 | 73.15 | 79.66 | 81.40 | 78.90 |
| commonmark-spec.md | 108.58 | 62.32 | 0.02 | 0.04 | 71.15 | 76.30 | 81.10 | 75.36 |
| hamlet.gutenberg.txt | 108.42 | 68.00 | 0.02 | 0.04 | 74.53 | 81.93 | 82.62 | 81.17 |
| iris.csv | 76.86 | 56.06 | 0.98 | 1.09 | 73.81 | 81.07 | 78.30 | 78.61 |
| moby-dick.gutenberg.txt | 107.29 | 83.62 | 0.00 | 0.03 | 72.38 | 80.75 | 81.62 | 82.24 |
| openapi-petstore.yaml | 102.06 | 67.47 | 0.16 | 0.19 | 72.63 | 74.72 | 81.15 | 77.75 |
| rfc8446-tls13.txt | 108.72 | 53.24 | 0.01 | 0.04 | 73.34 | 77.10 | 82.13 | 76.11 |
| us-constitution.gutenberg.txt | 74.59 | 55.56 | 0.08 | 0.10 | 72.09 | 83.94 | 79.34 | 80.65 |

## Read

V1 is still the speed/size leader on this public corpus. V2 is the byte-security leader, mostly because avalanche is materially better, but this universal score does not let that automatically erase the speed/size loss. That is the intended behavior: the report keeps security, efficiency, size, and combined value separated.
