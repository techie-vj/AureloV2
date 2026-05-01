#!/bin/sh
set -eu

APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PROPS="$APP_HOME/gradle/wrapper/gradle-wrapper.properties"

if command -v gradle >/dev/null 2>&1; then
  exec gradle "$@"
fi

if [ ! -f "$PROPS" ]; then
  echo "ERROR: $PROPS is missing." >&2
  exit 1
fi

DIST_URL=$(sed -n 's/^distributionUrl=//p' "$PROPS" | sed 's#\\:#:#')
DIST_NAME=$(basename "$DIST_URL" .zip)
DIST_DIR_NAME=$(printf '%s\n' "$DIST_NAME" | sed 's/-bin$//' | sed 's/-all$//')
CACHE_DIR="$APP_HOME/.gradle/wrapper-cache"
DIST_DIR="$CACHE_DIR/$DIST_DIR_NAME"
GRADLE_BIN="$DIST_DIR/bin/gradle"

if [ ! -x "$GRADLE_BIN" ]; then
  mkdir -p "$CACHE_DIR"
  ZIP="$CACHE_DIR/$DIST_NAME.zip"
  if [ ! -f "$ZIP" ]; then
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$DIST_URL" -o "$ZIP"
    elif command -v python3 >/dev/null 2>&1; then
      python3 - "$DIST_URL" "$ZIP" <<'PY'
import sys, urllib.request
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])
PY
    else
      echo "ERROR: need curl or python3 to download Gradle." >&2
      exit 1
    fi
  fi
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ZIP" -d "$CACHE_DIR"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$ZIP" "$CACHE_DIR" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(sys.argv[2])
PY
  else
    echo "ERROR: need unzip or python3 to extract Gradle." >&2
    exit 1
  fi
fi

exec "$GRADLE_BIN" "$@"
