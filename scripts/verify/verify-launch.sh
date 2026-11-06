#!/usr/bin/env bash
# scripts/verify/verify-launch.sh — runs the verification tools as a commit holds them.
#
#   bash scripts/verify/verify-launch.sh --repo <repo> --tooling <full hash> --out <dir> --label <label> -- <driver mode and its arguments>
#
# It writes each file of scripts/verify at the tooling commit, from its blob, into the new
# directory <out>/verify-<label>-tooling, refuses to go on when this file differs from
# that commit's copy, and runs the driver from there, so an edit in the working tree
# during a long run reaches nothing it runs. The driver's exit status is this file's
# exit status, and nothing runs after it that could change that.
set -u
REPO=""; TOOLING=""; OUT=""; LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?}"; shift 2 ;;
    --tooling) TOOLING="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --label) LABEL="${2:?}"; shift 2 ;;
    --) shift; break ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
[ -n "$REPO" ] && [ -n "$TOOLING" ] && [ -n "$OUT" ] && [ -n "$LABEL" ] && [ $# -gt 0 ] || { echo "usage: verify-launch.sh --repo <repo> --tooling <full hash> --out <dir> --label <label> -- <driver mode and its arguments>"; exit 2; }
[[ "$TOOLING" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full hash: $TOOLING"; exit 2; }
[[ "$LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "not a label: $LABEL"; exit 2; }
TR="$OUT/verify-$LABEL-tooling"
[ -e "$TR" ] && { echo "$TR exists: every run gets a new directory"; exit 2; }
PATHS="$(git -C "$REPO" ls-tree -r --name-only "$TOOLING" -- scripts/verify)" || { echo "the tooling commit does not read: $TOOLING"; exit 1; }
[ -n "$PATHS" ] || { echo "the tooling commit holds no scripts/verify"; exit 1; }
mkdir -p "$TR/scripts/verify" || exit 2
while IFS= read -r p; do
  case "$p" in
    scripts/verify/*/*) echo "a tool in a subdirectory is not supported: $p"; exit 1 ;;
  esac
  git -C "$REPO" cat-file blob "$TOOLING:$p" > "$TR/$p" || { echo "$p does not read at the tooling commit"; exit 1; }
done <<< "$PATHS"
cmp -s "${BASH_SOURCE[0]}" "$TR/scripts/verify/verify-launch.sh" || { echo "this launcher is not the tooling commit's: refusing"; exit 1; }
bash "$TR/scripts/verify/verify-driver.sh" "$@" --label "$LABEL" --out "$OUT" --repo "$REPO" --tooling "$TOOLING"
rc=$?
echo "verify-launch: the driver exited $rc"
exit "$rc"
