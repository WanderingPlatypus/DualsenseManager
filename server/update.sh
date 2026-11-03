#!/usr/bin/env bash
# Pulls the latest PadBench from GitHub and reinstalls it. Your data in /var/lib/padbench is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
before=$(git rev-parse HEAD)
git pull --ff-only -q
[ "$(git rev-parse HEAD)" = "$before" ] && [ "${1:-}" != "--force" ] && { echo 'PadBench is already up to date.'; exit 0; }
bash server/install-lxc.sh
