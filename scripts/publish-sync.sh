#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

VERSION="$1"
ROOT=${ROOT:-/opt/pulzz-hotupdate}
SRC="$ROOT/cdn/pulzz-gameres/wxmini/$VERSION"
DST="$ROOT/cdn/hotupdate/StreamingAssets/com.smartdog.bbqgame/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/$VERSION"

if [ ! -d "$SRC" ]; then
  echo "source not found: $SRC"
  exit 2
fi

mkdir -p "$(dirname "$DST")"
rm -rf "$DST"
cp -a "$SRC" "$DST"

echo "synced $VERSION"
