#!/usr/bin/env bash
set -e

# Ensure dist folder exists
mkdir -p dist

# Copy main HTML pages
cp -r index.html meter.v2.html inverter_analytics.html inverter_data_overview.html inverter_faults.html maintenance.html dist/

# Copy assets & common folders
cp -r assets dist/
cp -r common dist/

# ?? Ensure nav.html exists in both paths so header loads correctly on Azure
mkdir -p dist/assets
mkdir -p dist/common
cp assets/nav.html dist/assets/nav.html
cp assets/nav.html dist/common/nav.html

# Copy staticwebapp.config.json
cp staticwebapp.config.json dist/

# Force redeploy trigger 2025-10-28 00:48:37

# redeploy trigger 2025-10-28_011029
