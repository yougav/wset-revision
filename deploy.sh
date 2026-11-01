#!/bin/bash
# Usage: ./deploy.sh "what changed"
set -e
cd "$(dirname "$0")"
MSG="${1:-update}"
V=$(grep -o "wsetrev-v[0-9.]*" sw.js | head -1)
git add -A
git commit -m "$MSG ($V)" || { echo "Nothing to commit."; exit 0; }
git push
echo "Deployed $V. On the iPhone: open the app, close it, open again to pick up the update."
