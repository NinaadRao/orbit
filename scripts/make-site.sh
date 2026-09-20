#!/bin/sh
# Copies only what a web host needs into ./dist, so you can upload or drag that one folder.
# It leaves out tests, docs, scripts and .git. Your data is never in this folder anyway.
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir dist
cp -R index.html manifest.webmanifest sw.js js css icons fonts dist/
mkdir dist/data
cp data/foods.json dist/data/
echo "Ready: $(pwd)/dist"
echo "Upload that folder to any https static host (see docs/INSTALL.md)."
