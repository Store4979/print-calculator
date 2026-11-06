# The verification tooling

These tools make the clean verification of one commit before a review asks for a push. They give no operational authority, and they are separate from the sender's guard chain: nothing here reaches a database, a token or a guard store.

## Running it

```bash
bash scripts/verify/verify-launch.sh --repo <repo> --tooling <full hash> --out <dir> --label <label> -- verify --commit <full hash> --pglite <dir> --expect-tests <n>
```

`--tooling` names the commit whose `scripts/verify` runs. `--commit` names the commit under test, and its `scripts/verify` must be the same tree. On Windows, give `--repo`, `--out` and `--pglite` in the `C:/...` form, so that the synthetic home reads the same to node and to bash.

## What is here

- **`verify-launch.sh`** writes the tools into a new directory from the tooling commit's blobs, and runs the driver from there. It refuses if it is not itself that commit's copy. Its exit status is the driver's.
- **`verify-driver.sh`** runs every required step, in order. A failure in any of them makes the run exit 1, even when later steps pass. Failed pins, a failed clone or a failed `isolation-before` stop it at once, and the summary names every later step as not run. A required step that did not run fails the run too. A summary with no `RESULT` line means the run did not finish.
- **`check-pins.mjs`** checks the pin set `verification-pins.json` before each run: the files are exactly the pinned ones, each is the tooling commit's blob, and the tested commit carries the same tools. After changing a tool, run `node scripts/verify/check-pins.mjs generate --root .`.
- **`check-isolation.mjs`** checks that the run's home is the synthetic one, that the default guard store resolves under it, and that nothing was created there. It cannot show that a test did not name another path: review is that control.
- **`compare-fixtures.mjs`** compares the two local harnesses' output with the commit's fixtures, read as Git blobs. Its header says what may differ.
- **`check-tap.mjs`** checks the TAP logs, and checks the replay's states against the reviewed set for the tested commit's recorded state.

## The dependency closure is a source-review item

Pins say which bytes ran. They do not say what those bytes load, and no run-time check here does:

- **At run time,** `check-pins.mjs` also runs a raw-text regression check. It matches a line-start, double-quoted import, a dynamic import, the CommonJS loader, a `$TOOLS/<name>` in a script, and a command that deletes or moves files. A single-quoted import, an import after another statement, a multiline import and a re-export all pass it. It is not a language boundary.
- **At commit time,** VT-2b in `scripts/tests/verify-tooling.test.js` parses each module with acorn, and holds its static imports, re-exports and dynamic imports to `node:` builtins, with `check-isolation.mjs`'s one named exception. Acorn is a dev dependency of the tests, so this check is not in the tools themselves.
- **By review:** the two shell scripts, which no parser here reads, and anything a module could assemble at run time. A reviewer reads what each tool loads, whenever a tool changes.

The tools load only `node:` builtins, except that `check-isolation.mjs` imports the file its `--guard` names, the tested commit's guard module, for its default path.

## What each run records

`<out>/verify-<label>-summary.txt` holds:

- the tested commit and tree;
- the tooling commit and tree, and the pin set's and each tool's hashes;
- the required step set and the expected test count;
- each step's exit and times;
- the final result.

Every step's own log is beside it, as `verify-<label>-<step>.txt`.

Nothing deletes a run's output. A run refuses a clone, summary or home whose name exists, so a failed run's evidence stays where it is and the next run takes a new label.

## The replay's states

`replay.sets` in the pin set holds the reviewed list of replay states for each recorded state: which migrations the manifest records as applied, and how many rollback records it holds. A commit that changes the recorded state fails `replay-counts` until the tooling brings a reviewed set for the new state.
