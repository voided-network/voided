# Universal Fuse Benchmark: voided-fuse-v1-package

- package_surface: `voided_core::shell::fuse_bytes/unfuse_bytes`
- preset: `balanced`
- commit: `8266ff8`
- corpus_dir: `/tmp/voided-public-fuse-corpus.8zuTjZ`

| fixture | bytes | out bytes | overhead | enc MiB/s | dec MiB/s | entropy | chi z | bit1 | serial | avalanche | security | efficiency | size | value | flags |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| alice-wonderland.gutenberg.txt | 174314 | 174352 | 38 (0.02%) | 96.69 | 108.19 | 7.9989 | 0.77 | 0.5004 | 0.0001 | 0.0000 | 73.15 | 74.02 | 99.91 | 81.40 | avalanche-outlier |
| commonmark-spec.md | 206108 | 206146 | 38 (0.02%) | 108.58 | 107.92 | 7.9990 | 1.75 | 0.4995 | 0.0013 | 0.0000 | 71.15 | 76.41 | 99.93 | 81.10 | avalanche-outlier |
| hamlet.gutenberg.txt | 206898 | 206936 | 38 (0.02%) | 108.42 | 108.24 | 7.9991 | 0.17 | 0.5007 | 0.0005 | 0.0000 | 74.53 | 76.42 | 99.93 | 82.62 | avalanche-outlier |
| iris.csv | 3858 | 3896 | 38 (0.98%) | 76.86 | 76.93 | 7.9511 | 0.24 | 0.4984 | 0.0239 | 0.0022 | 73.81 | 64.13 | 96.21 | 78.30 | avalanche-outlier |
| moby-dick.gutenberg.txt | 1276266 | 1276304 | 38 (0.00%) | 107.29 | 108.16 | 7.9999 | -1.13 | 0.4998 | -0.0014 | 0.0000 | 72.38 | 76.19 | 99.99 | 81.62 | avalanche-outlier |
| openapi-petstore.yaml | 23156 | 23194 | 38 (0.16%) | 102.06 | 103.20 | 7.9928 | -0.94 | 0.5009 | 0.0047 | 0.0004 | 72.63 | 74.51 | 99.35 | 81.15 | avalanche-outlier |
| rfc8446-tls13.txt | 337736 | 337774 | 38 (0.01%) | 108.72 | 108.72 | 7.9995 | -0.67 | 0.4998 | -0.0031 | 0.0000 | 73.34 | 76.53 | 99.96 | 82.13 | avalanche-outlier |
| us-constitution.gutenberg.txt | 48329 | 48367 | 38 (0.08%) | 74.59 | 104.67 | 7.9966 | -1.25 | 0.4990 | -0.0001 | 0.0002 | 72.09 | 67.90 | 99.69 | 79.34 | avalanche-outlier |

## Aggregate

| fixtures | input bytes | output bytes | avg overhead | avg enc MiB/s | avg dec MiB/s | weighted enc MiB/s | weighted dec MiB/s | security | efficiency | size | value |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 2276665 | 2276969 | 0.16% | 97.90 | 103.25 | 105.71 | 108.03 | 72.89 | 73.26 | 99.37 | 80.96 |
