#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist

# core pages
cp -v index.html dist/ 2>/dev/null || true
cp -v meter.v2.html dist/ 2>/dev/null || true
cp -v inverter_analytics.html dist/ 2>/dev/null || true
cp -v inverter_data_overview.html dist/ 2>/dev/null || true
cp -v inverter_faults.html dist/ 2>/dev/null || true
cp -v maintenance.html dist/ 2>/dev/null || true
cp -v about.html dist/ 2>/dev/null || true

# assets / shared UI
cp -v favicon.ico dist/ 2>/dev/null || true
cp -v styles.css dist/ 2>/dev/null || true
cp -v nav.css dist/ 2>/dev/null || true
cp -v nav.html dist/ 2>/dev/null || true
cp -v nav.js dist/ 2>/dev/null || true
cp -rv assets dist/assets 2>/dev/null || true

# SWA config (routes/headers)
cp -v staticwebapp.config.json dist/ 2>/dev/null || true
