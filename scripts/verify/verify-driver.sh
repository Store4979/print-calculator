#!/usr/bin/env bash
# scripts/verify/verify-driver.sh — the clean verification of one commit (README.md here).
#
#   verify-launch.sh ... -- verify --commit <full hash> --pglite <dir> --expect-tests <n>
#   verify-launch.sh ... -- selftest --codes "<exit code>..." [--skip-last]
#
# verify-launch.sh runs this file from the tooling commit's own blobs. It passes
# --label, --out, --repo and --tooling.
#
# THE RULE: a failure in ANY required step makes the whole run exit nonzero, even when
# later steps, the replay included, pass. It keeps going, so one run reports everything;
# only failed pins, a failed clone, a failed isolation-before or a failed powershell-before
# stop it early, since nothing after them can be relied on, and the steps after them run the
# tested commit's code. A required step that never ran fails the run too, and the summary names it. Nothing
# after finish decides the exit status. A summary with no RESULT line means the run did not
# finish.
#
# It unsets the node options, the token and the stage-0 session, and runs under a new
# synthetic home, so that the default guard store resolves there. check-isolation.mjs
# reads that path and checks nothing is created at it. No check here can show that a
# test did not name another path.
#
# THE PER-USER LOCATIONS (VT3). Windows PowerShell 5.1 places its module analysis cache under
# the known folder LocalApplicationData, which Windows builds from USERPROFILE; it does not read
# LOCALAPPDATA. Under a synthetic home with no AppData\Local that folder reads empty, the
# cache's place is the RELATIVE Microsoft\Windows\PowerShell\ModuleAnalysisCache, and a
# PowerShell alive past the save (about 10 s) writes it into its working directory: before
# VT3, G-27's window did so in the tested clone and in each replay checkout. So the home holds
# AppData\Local and AppData\Roaming, LOCALAPPDATA and APPDATA name them, and
# PSModuleAnalysisCachePath names the cache file, in a directory of its own beside the logs,
# all before anything starts PowerShell. Each name is first unset under every spelling: Windows
# reads names without regard to case, and bash hands a Windows child two spellings as two
# entries. Children inherit these; a child given an environment of its own does not, and the
# tree-after step is what shows a write that reached the tree.
#
# It never deletes anything: each run takes a new clone, new logs and a new home, and
# refuses a name that exists.
set -u
unset NODE_OPTIONS NODE_V8_COVERAGE STAGE0_SESSION SUPABASE_ACCESS_TOKEN STAGE0_MANIFEST
# Git for Windows' bash gives node no usable path from a plain pwd when the path holds a
# quote, so it asks for the C:/ form where that exists.
abspath() { (cd "$1" && { pwd -W 2>/dev/null || pwd; }); }
TOOLS="$(abspath "$(dirname "${BASH_SOURCE[0]}")")"
ROOT="$(abspath "$(dirname "${BASH_SOURCE[0]}")/../..")"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

FAILED=""
RAN=""
step() {
  local name="$1"; shift
  local t0 rc
  t0=$(now)
  "$@" > "$LOGS-$name.txt" 2>&1
  rc=$?
  echo "$name exit $rc ($t0 -> $(now))" >> "$SUMMARY"
  RAN="$RAN $name"
  if [ "$rc" != 0 ]; then FAILED="$FAILED $name"; fi
  return 0
}
finish() {
  local missing="" r
  for r in $REQUIRED; do
    case " $RAN " in
      *" $r "*) ;;
      *) missing="$missing $r" ;;
    esac
  done
  if [ -n "$FAILED" ] || [ -n "$missing" ]; then
    echo "RESULT FAILED: required steps failed:${FAILED:- none}; not run:${missing:- none} ($(now))" >> "$SUMMARY"
    cat "$SUMMARY"
    exit 1
  fi
  echo "RESULT PASSED: every required step exited 0 ($(now))" >> "$SUMMARY"
  cat "$SUMMARY"
  exit 0
}

MODE="${1:-}"
[ -n "$MODE" ] && shift
LABEL=""; OUT=""; REPO=""; TOOLING=""; H=""; PG=""; EXPECT=""; CLONE_NAME=""; CODES=""; SKIP_LAST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --repo) REPO="${2:?}"; shift 2 ;;
    --tooling) TOOLING="${2:?}"; shift 2 ;;
    --commit) H="${2:?}"; shift 2 ;;
    --pglite) PG="${2:?}"; shift 2 ;;
    --expect-tests) EXPECT="${2:?}"; shift 2 ;;
    --clone-name) CLONE_NAME="${2:?}"; shift 2 ;;
    --codes) CODES="${2:?}"; shift 2 ;;
    --skip-last) SKIP_LAST="1"; shift ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
[ -n "$LABEL" ] && [ -n "$OUT" ] && [ -n "$REPO" ] && [ -n "$TOOLING" ] || { echo "--label, --out, --repo and --tooling are required: use verify-launch.sh"; exit 2; }
[[ "$LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "not a label: $LABEL"; exit 2; }
[[ "$TOOLING" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full hash: $TOOLING"; exit 2; }
LOGS="$OUT/verify-$LABEL"
SUMMARY="$LOGS-summary.txt"
SYNTHETIC_HOME="$LOGS-home"
PSCACHE="$LOGS-pscache"
ISOLATED="HOME USERPROFILE LOCALAPPDATA APPDATA PSModuleAnalysisCachePath"

# Every exported variable whose name is $1 in any case.
unset_spellings() {
  local want="${1,,}" n
  for n in $(compgen -e); do
    if [ "${n,,}" = "$want" ]; then unset "$n"; fi
  done
}

begin() { # tested commit
  [ -e "$SUMMARY" ] && { echo "$SUMMARY exists: every run gets new logs"; exit 2; }
  [ -e "$SYNTHETIC_HOME" ] && { echo "$SYNTHETIC_HOME exists: every run gets a new home"; exit 2; }
  [ -e "$PSCACHE" ] && { echo "$PSCACHE exists: every run gets a new cache directory"; exit 2; }
  mkdir -p "$SYNTHETIC_HOME/AppData/Local" "$SYNTHETIC_HOME/AppData/Roaming" "$PSCACHE" || exit 2
  local home cache n
  home="$(abspath "$SYNTHETIC_HOME")" || exit 2
  cache="$(abspath "$PSCACHE")/ModuleAnalysisCache" || exit 2
  for n in $ISOLATED; do unset_spellings "$n"; done
  export HOME="$home" USERPROFILE="$home" LOCALAPPDATA="$home/AppData/Local" APPDATA="$home/AppData/Roaming" PSModuleAnalysisCachePath="$cache"
  : > "$SUMMARY"
  echo "run $LABEL started $(now)" >> "$SUMMARY"
  echo "tools run from $ROOT" >> "$SUMMARY"
  echo "node $(node --version), git $(git --version)" >> "$SUMMARY"
  for n in $ISOLATED TEMP TMP; do echo "variable $n=${!n-<unset>}" >> "$SUMMARY"; done
  REQUIRED="$(node "$TOOLS/check-pins.mjs" required --root "$ROOT")" || REQUIRED=""
}

case "$MODE" in
  verify)
    [ -n "$H" ] && [ -n "$PG" ] && [ -n "$EXPECT" ] || { echo "verify needs --commit, --pglite and --expect-tests"; exit 2; }
    [[ "$H" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full hash: $H"; exit 2; }
    [[ "$EXPECT" =~ ^[0-9]+$ ]] || { echo "not a test count: $EXPECT"; exit 2; }
    V="$OUT/${CLONE_NAME:-verify-${H:0:7}}"
    [ -e "$V" ] && { echo "$V exists: every run gets a new directory"; exit 2; }
    begin
    if [ -z "$REQUIRED" ]; then echo "RESULT FAILED: the required step set does not read ($(now))" >> "$SUMMARY"; cat "$SUMMARY"; exit 1; fi
    echo "required steps: $REQUIRED" >> "$SUMMARY"
    echo "expected tests: $EXPECT" >> "$SUMMARY"
    step pins node "$TOOLS/check-pins.mjs" verify --repo "$REPO" --tooling "$TOOLING" --root "$ROOT" --commit "$H" --record "$SUMMARY"
    if [ -n "$FAILED" ]; then finish; fi
    clone() { git clone --no-checkout "$REPO" "$V" && git -C "$V" checkout --detach "$H" && git -C "$V" log -1 --format='HEAD %H tree %T' && [ "$(git -C "$V" rev-parse HEAD)" = "$H" ]; }
    step clone clone
    if [ -n "$FAILED" ]; then finish; fi
    cd "$V" || exit 2
    step isolation-before node "$TOOLS/check-isolation.mjs" before --home "$SYNTHETIC_HOME" --pscache "$PSCACHE/ModuleAnalysisCache" --tree "$V" --guard "$V/scripts/manual/stage0-guard.mjs"
    if [ -n "$FAILED" ]; then finish; fi
    step powershell-before node "$TOOLS/check-isolation.mjs" powershell --pscache "$PSCACHE/ModuleAnalysisCache" --tree "$V"
    if [ -n "$FAILED" ]; then finish; fi
    step install yarn install --frozen-lockfile
    step test yarn test
    step test-counts node "$TOOLS/check-tap.mjs" --file "$LOGS-test.txt" --expect "$EXPECT"
    step build yarn build
    step manifest node scripts/manual/stage0-manifest-generate.mjs --check
    step m13 node --test --test-name-pattern="M-13" scripts/tests/stage0-manifest.test.js
    targeted() { node --test scripts/tests/stage0-manifest*.test.js scripts/tests/stage0-guard*.test.js scripts/tests/stage0-item3*.test.js scripts/tests/stage0-send*.test.js scripts/tests/stage0-4c*.test.js scripts/tests/stage0-classify*.test.js scripts/tests/verify-*.test.js; }
    step targeted targeted
    step targeted-counts node "$TOOLS/check-tap.mjs" --file "$LOGS-targeted.txt"
    step harness env PGLITE_DIR="$PG" node scripts/manual/stage0-item4c-local-pglite.mjs --out "$LOGS-harness-out"
    step writing env PGLITE_DIR="$PG" node scripts/manual/stage0-item4c-writing-local-pglite.mjs --out "$LOGS-writing-out"
    step fixtures node "$TOOLS/compare-fixtures.mjs" --clone "$V" --commit "$H" --writing-out "$LOGS-writing-out" --x2-out "$LOGS-harness-out" --report "$LOGS-fixtures-report.json"
    export STAGE0_REPLAY_KEEP=1
    step replay node --test scripts/tests/replay/stage0-record-replay.test.js
    unset STAGE0_REPLAY_KEEP
    step replay-counts node "$TOOLS/check-tap.mjs" --replay "$V/.stage0-replay" --summary "$V/.stage0-replay-summary.json" --pins "$TOOLS/verification-pins.json" --clone "$V" --expect "$EXPECT"
    step isolation-after node "$TOOLS/check-isolation.mjs" after --home "$SYNTHETIC_HOME"
    step tree-after node "$TOOLS/check-isolation.mjs" tree --tree "$V"
    finish
    ;;
  selftest)
    # The same begin, step and finish on trivial commands, for the regression tests
    # and the demonstrations: one step per exit code, and pins first.
    [ -n "$CODES" ] || { echo "selftest needs --codes"; exit 2; }
    begin
    if [ -z "$REQUIRED" ]; then echo "RESULT FAILED: the required step set does not read ($(now))" >> "$SUMMARY"; cat "$SUMMARY"; exit 1; fi
    REQUIRED="pins"; i=0
    for c in $CODES; do i=$((i + 1)); REQUIRED="$REQUIRED s$i"; done
    echo "required steps: $REQUIRED" >> "$SUMMARY"
    step pins node "$TOOLS/check-pins.mjs" verify --repo "$REPO" --tooling "$TOOLING" --root "$ROOT" --commit "$TOOLING" --record "$SUMMARY"
    if [ -n "$FAILED" ]; then finish; fi
    i=0; n=$(echo $CODES | wc -w)
    for c in $CODES; do
      i=$((i + 1))
      if [ -n "$SKIP_LAST" ] && [ "$i" = "$n" ]; then continue; fi
      step "s$i" node -e "process.exit($c)"
    done
    finish
    ;;
  *)
    echo "usage: verify-launch.sh ... -- verify --commit <full hash> --pglite <dir> --expect-tests <n> | selftest --codes \"<exit code>...\" [--skip-last]"
    exit 2
    ;;
esac
