#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-target/public-fuse-corpus}"
mkdir -p "${OUT_DIR}"

fetch() {
  local name="$1"
  local url="$2"
  printf 'fetching %s\n' "${name}"
  curl -fsSL "${url}" -o "${OUT_DIR}/${name}"
}

fetch "alice-wonderland.gutenberg.txt" "https://www.gutenberg.org/ebooks/11.txt.utf-8"
fetch "hamlet.gutenberg.txt" "https://www.gutenberg.org/ebooks/1524.txt.utf-8"
fetch "us-constitution.gutenberg.txt" "https://www.gutenberg.org/ebooks/5.txt.utf-8"
fetch "moby-dick.gutenberg.txt" "https://www.gutenberg.org/ebooks/2701.txt.utf-8"
fetch "rfc8446-tls13.txt" "https://www.rfc-editor.org/rfc/rfc8446.txt"
fetch "commonmark-spec.md" "https://raw.githubusercontent.com/commonmark/commonmark-spec/master/spec.txt"
fetch "iris.csv" "https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv"
fetch "openapi-petstore.yaml" "https://raw.githubusercontent.com/swagger-api/swagger-petstore/master/src/main/resources/openapi.yaml"

printf 'public fuse corpus written to %s\n' "${OUT_DIR}"
