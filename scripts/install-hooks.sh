#!/bin/sh
# Installs the privacy checks as git hooks for this clone. Safe to run more than once.
set -e
cd "$(dirname "$0")/.."
[ -d .git ] || { echo "Run 'git init' first."; exit 1; }
mkdir -p .git/hooks
for h in pre-commit pre-push; do
  cp "scripts/hooks/$h" ".git/hooks/$h"
  chmod +x ".git/hooks/$h"
done
echo "Installed pre-commit and pre-push privacy checks."
echo "Optional: list words you never want committed (your name, measurements) in ~/.orbit-private-terms, one per line."
