#!/usr/bin/env bash
# Pulls the latest PadBench from GitHub and reinstalls it. Your data in /var/lib/padbench is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
bash server/install-lxc.sh
