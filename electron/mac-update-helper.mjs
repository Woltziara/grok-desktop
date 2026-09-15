/**
 * Detached macOS installer. Production passes absolute system command paths;
 * tests pass isolated substitutes so this exact script can exercise failures.
 */
export const MAC_UPDATE_HELPER_SCRIPT = `#!/bin/bash
set -u
LOG="$1"
APP_PID="$2"
STAGED_ROOT="$3"
DEST="$4"
APP_NAME="$(basename "$DEST")"
EXPECTED_BUNDLE_ID="$5"
EXPECTED_VERSION="$6"
EXPECTED_ARCH="$7"
WAIT_POLLS="$8"
WAIT_INTERVAL="$9"
OPEN_BIN="\${10}"
INSTALL_BIN="\${11}"
LIPO_BIN="\${12}"
PLUTIL_BIN="\${13}"
DIALOG_BIN="\${14}"

show_failure() {
  "$DIALOG_BIN" -e 'display dialog "The update could not be installed. Grok Desktop kept or restored the previous version. You can keep working and try again later." buttons {"OK"} default button "OK" with title "Grok Desktop"' >/dev/null 2>&1 || true
}

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) mac update helper ===="
echo "pid=$APP_PID staged=$STAGED_ROOT dest=$DEST bundle=$EXPECTED_BUNDLE_ID version=$EXPECTED_VERSION arch=$EXPECTED_ARCH"

cleanup() {
  case "$(basename "$STAGED_ROOT")" in
    grok-desktop-update-stage-*) rm -rf "$STAGED_ROOT" ;;
  esac
  rm -f "$0"
}
trap cleanup EXIT

if [ -z "$EXPECTED_BUNDLE_ID" ] || [ -z "$EXPECTED_VERSION" ] || [ -z "$EXPECTED_ARCH" ]; then
  echo "ERROR: missing expected identity; not replacing"
  show_failure
  exit 1
fi

exited=0
i=1
while [ "$i" -le "$WAIT_POLLS" ]; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "app exited after \${i} polls"
    exited=1
    break
  fi
  sleep "$WAIT_INTERVAL"
  i=$((i + 1))
done
if [ "$exited" -ne 1 ]; then
  echo "ERROR: app still running after wait; not replacing"
  show_failure
  exit 1
fi

reopen_current() {
  if [ -d "$DEST" ] && ! "$OPEN_BIN" "$DEST"; then
    echo "ERROR: could not reopen the preserved app; open it manually at $DEST"
  fi
  show_failure
}

if [ ! -d "$STAGED_ROOT" ]; then
  echo "ERROR: staged update missing: $STAGED_ROOT"
  reopen_current
  exit 1
fi

NEW_APP="$STAGED_ROOT/$APP_NAME"
if [ ! -d "$NEW_APP" ]; then
  echo "ERROR: expected $APP_NAME is not present in the update"
  reopen_current
  exit 1
fi

PLIST="$NEW_APP/Contents/Info.plist"
ACTUAL_BUNDLE_ID="$("$PLUTIL_BIN" -extract CFBundleIdentifier raw -o - "$PLIST" 2>/dev/null || true)"
ACTUAL_VERSION="$("$PLUTIL_BIN" -extract CFBundleShortVersionString raw -o - "$PLIST" 2>/dev/null || true)"
ACTUAL_EXECUTABLE="$("$PLUTIL_BIN" -extract CFBundleExecutable raw -o - "$PLIST" 2>/dev/null || true)"
case "$ACTUAL_EXECUTABLE" in
  ""|.|..|*/*) echo "ERROR: invalid CFBundleExecutable; not replacing"; reopen_current; exit 1 ;;
esac
EXEC_BIN="$NEW_APP/Contents/MacOS/$ACTUAL_EXECUTABLE"
if [ ! -f "$EXEC_BIN" ] || [ ! -x "$EXEC_BIN" ]; then
  echo "ERROR: CFBundleExecutable does not name an executable file; not replacing"
  reopen_current
  exit 1
fi
if ! ACTUAL_ARCH="$("$LIPO_BIN" -archs "$EXEC_BIN" 2>/dev/null)" || [ -z "$ACTUAL_ARCH" ]; then
  echo "ERROR: could not read the update executable architecture; not replacing"
  reopen_current
  exit 1
fi
if [ -z "$ACTUAL_BUNDLE_ID" ] || [ -z "$ACTUAL_VERSION" ]; then
  echo "ERROR: could not read new app identity; not replacing"
  reopen_current
  exit 1
fi
if [ "$ACTUAL_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]; then
  echo "ERROR: bundle id mismatch expected=$EXPECTED_BUNDLE_ID actual=$ACTUAL_BUNDLE_ID"
  reopen_current
  exit 1
fi
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "ERROR: version mismatch expected=$EXPECTED_VERSION actual=$ACTUAL_VERSION"
  reopen_current
  exit 1
fi
ARCH_OK=0
case "$EXPECTED_ARCH" in
  arm64|aarch64) case " $ACTUAL_ARCH " in *" arm64 "*) ARCH_OK=1 ;; esac ;;
  x64|x86_64|amd64) case " $ACTUAL_ARCH " in *" x86_64 "*) ARCH_OK=1 ;; esac ;;
esac
if [ "$ARCH_OK" -ne 1 ]; then
  echo "ERROR: arch mismatch expected=$EXPECTED_ARCH actual=$ACTUAL_ARCH"
  reopen_current
  exit 1
fi

BACKUP="\${DEST}.pre-update"
if [ -e "$BACKUP" ]; then
  BACKUP="\${DEST}.pre-update.$(date -u +%Y%m%dT%H%M%SZ).$$"
fi
if [ -d "$DEST" ] && ! mv "$DEST" "$BACKUP"; then
  echo "ERROR: could not preserve the current app"
  reopen_current
  exit 1
fi

restore_backup() {
  rm -rf "$DEST" 2>/dev/null || true
  if [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$DEST" || echo "ERROR: automatic restore failed; preserved app remains at $BACKUP"
  fi
}

if ! "$INSTALL_BIN" "$NEW_APP" "$DEST"; then
  echo "ERROR: install failed; restoring current app"
  restore_backup
  reopen_current
  exit 1
fi

xattr -cr "$DEST" 2>/dev/null || true
echo "launching $DEST"
if ! "$OPEN_BIN" "$DEST"; then
  echo "ERROR: launch failed; restoring current app"
  restore_backup
  reopen_current
  exit 1
fi
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) launched; previous app kept at $BACKUP ===="
`;
