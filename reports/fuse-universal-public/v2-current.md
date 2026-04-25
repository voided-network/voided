# Universal Fuse Benchmark: voided-fuse-v2-current

- package_surface: `voided_core::shell::fuse_bytes/unfuse_bytes`
- preset: `balanced`
- commit: `73f2f8f`
- corpus_dir: `/tmp/voided-public-fuse-corpus.8zuTjZ`

| fixture | bytes | out bytes | overhead | enc MiB/s | dec MiB/s | entropy | chi z | bit1 | serial | avalanche | security | efficiency | size | value | flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| alice-wonderland.gutenberg.txt | 174314 | 174395 | 81 (0.05%) | 56.17 | 54.91 | 7.9985 | 4.26 | 0.4998 | -0.0059 | 0.2483 | 79.66 | 52.39 | 99.81 | 78.90 | avalanche-outlier |
| commonmark-spec.md | 206108 | 206197 | 89 (0.04%) | 62.32 | 22.65 | 7.9985 | 7.95 | 0.4996 | -0.0066 | 0.2493 | 76.30 | 44.29 | 99.83 | 75.36 | avalanche-outlier |
| hamlet.gutenberg.txt | 206898 | 206987 | 89 (0.04%) | 68.00 | 58.32 | 7.9989 | 2.68 | 0.5007 | -0.0024 | 0.2487 | 81.93 | 57.39 | 99.83 | 81.17 | avalanche-outlier |
| iris.csv | 3858 | 3900 | 42 (1.09%) | 56.06 | 56.16 | 7.9435 | 2.46 | 0.5084 | 0.0081 | 0.2402 | 81.07 | 52.67 | 95.83 | 78.61 | avalanche-outlier |
| moby-dick.gutenberg.txt | 1276266 | 1276616 | 350 (0.03%) | 83.62 | 65.91 | 7.9998 | 3.49 | 0.4994 | -0.0052 | 0.2501 | 80.75 | 63.71 | 99.89 | 82.24 | avalanche-outlier |
| openapi-petstore.yaml | 23156 | 23200 | 44 (0.19%) | 67.47 | 58.46 | 7.9867 | 7.76 | 0.5014 | -0.0866 | 0.2421 | 74.72 | 57.25 | 99.25 | 77.75 | serial-correlation-outlier, avalanche-outlier |
| rfc8446-tls13.txt | 337736 | 337857 | 121 (0.04%) | 53.24 | 36.17 | 7.9991 | 6.85 | 0.5009 | 0.0061 | 0.2495 | 77.10 | 45.80 | 99.86 | 76.11 | avalanche-outlier |
| us-constitution.gutenberg.txt | 48329 | 48379 | 50 (0.10%) | 55.56 | 53.97 | 7.9957 | 1.35 | 0.4988 | -0.0138 | 0.2452 | 83.94 | 51.92 | 99.59 | 80.65 | avalanche-outlier |

## Aggregate

| fixtures | input bytes | output bytes | avg overhead | avg enc MiB/s | avg dec MiB/s | weighted enc MiB/s | weighted dec MiB/s | security | efficiency | size | value |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 2276665 | 2277531 | 0.20% | 62.80 | 50.82 | 70.39 | 49.62 | 79.43 | 53.18 | 99.23 | 78.85 |
