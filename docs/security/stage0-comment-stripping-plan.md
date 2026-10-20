# Stage 0 — the comment-stripping correction (CS) — PLAN

**Status: REVIEWED plan. Codex, 2026-10-15: AMEND, direction accepted.**
Codex's rulings are folded in below (§0 lists them). Codex said no further
plan-only round is needed once they are in.
- **Ryan cleared the implementation as local commits** (2026-10-15).
- **Not cleared:** pushing it; any database, staging or production
  operation. This plan needs none.
- It changes test code and one A3-pinned test module.

**Source.** Codex's review of `41153b8` (2026-10-15) and its audit
`reviews/2026-10-15-comment-stripping-audit.md`, with
`reviews/release-41153b8-comment-audit.json` and
`reviews/release-41153b8-comment-audit.mjs`. Codex's plan review is
`reviews/2026-10-15-cs-and-item2-plan-review.md`, with its independent
measurement `reviews/release-41153b8-current-stripper-measurement.json`. All
are in Codex's workspace, outside this repository.

**The ruling on the audit.** CS is a separate corrective change, and did not
block the A–E push (2026-10-15, plan §E13). **It is required before any new
production-window or security clearance that relies on those checks.** It is
listed with items 2, 3, 4(c) and 6 (plan §I; incident record §5;
`CLAUDE.md`).

---

## 0. Codex's rulings (2026-10-15)

| # | question | ruling | where it is folded in |
|---|---|---|---|
| 1 | Mutation extent | **AMEND, an acceptance condition.** Not 47 redundant mutants. Cover **each distinct negative policy or predicate**, every transformed-input pipeline, and the lexical matrix. Include **CANCEL-STEP's forbidden-termination and call-count property**. Do not invent a negative for a positive-only case such as DC-13: verify its positive or runtime control. Keep the real-input preservation and the non-empty and coverage assertions | §3.2, §4 CS-4 |
| 2 | Keep strings in the inventory's view | **ACCEPT.** It can conservatively match DDL-like data; it is not a dynamic-SQL analyzer. Keep or blank is explicit per consumer | §3.5 |
| 3 | Recurse into dollar bodies | **AMEND, an acceptance condition.** Separate lexical segmentation from interpretation: a dollar-quoted value is lexically a string. Recurse only in the code view, for reviewed SQL/PL/pgSQL bodies and embedded executable migration inputs. **The consumer and the input's reviewed role decide what is data; a tag chosen in the input never does.** Unknown roles may fail closed. The pure lexer never calls a valid data literal malformed because its contents are not SQL | §3.3, §3.4 |
| 4 | Explicit `sourceType` | **ACCEPT.** Script or module and JSX chosen explicitly, no fallback, labelled errors; comment ranges blanked with spaces and newlines | §3.1 |
| 5 | Unsupported table names | **AMEND: refuse unsupported forms in CS.** Never derive a partial name. Recognize the supported complete CREATE/DROP target forms, or report unsupported syntax. Controls for a quoted name, a non-`public` qualified name and multiple targets. Apply the same policy to protected-name discovery and to the applied-state and snapshot checks. No general SQL grammar | §3.5, §4 CS-3 |
| 6 | The CS-6 guard | **ACCEPT.** A limited regression check for named forms, with an empty exemption list and required-failing mutants made from the old implementations. Not a sandbox; unrelated regex use is not redesigned | §3.6 |
| 7 | Order | **ACCEPT: CS → 2 → 6 → 3 → 4(c).** CS is reviewed before new probe checks rely on its SQL handling | §7 |

**The four further corrections:**
1. **A valid token-boundary fixture.** `a/**/b` is not a valid program, and
   acorn rejects it. The fixture is `let/**/x = 1;`: it must parse fully,
   with its tokens intact (§4 CS-2).
2. **Build equivalence, worded and done correctly.** Unchanged source trees
   do not make ordinary builds byte-identical: `vite.config.js` embeds
   `new Date().toISOString()` and the commit, deploy and context values.
   §6 uses input invariance plus a review-only harness with the dependencies,
   environment and build clock all fixed. Vite's production behaviour is not
   changed (§6).
3. **A bounded SQL scanner.** The required PostgreSQL string mode, the
   behaviour on unsupported forms, and the recursion and size bounds are
   stated. Code and strings keep their identity except for intentional
   comment blanking. Concatenating the segments back is necessary, but it
   proves no lexical correctness on its own (§3.3, §4).
4. **Unchanged:**
   - every applied migration and rollback SQL blob, every assembler output
     and the sender policy;
   - the inventory and its new lexer are re-pinned through the existing A3
     import-closure check.

   The before/after comparison keeps reviewed pin-metadata changes apart
   from policy verdicts. A genuine semantic difference is inspected, not
   forced back to an old false result (§6).

**Codex's review of the implementation, G `9333448` (2026-10-16): AMEND.**
Three blocking lexer-preservation defects were corrected in H, on top of G,
each with a required-failing regression:

| # | defect | the correction |
|---|---|---|
| CS-R1 | an SQL `--` comment ended only at LF, so a lone CR hid the next statement | it ends at LF or CR; views keep both; the bytes are lexed as they are (§3.3) |
| CS-R2 | a continued E-string's next segment lost its escape mode | continuation keeps the mode (§3.3) |
| CS-R3 | JS blanking dropped U+2028/U+2029 from comments, changing ASI with equal tokens | every line terminator is kept; CS-5 compares ASTs (§3.1) |

The CS-4 coverage is stated exactly: six wrapper combinations are skipped
(§3.2). The line-anchored import predicates are a separate tracked item.

**Codex's review of H `1c4d8a4` (2026-10-18): AMEND, one blocker.**
- **Accepted:** CS-R1, CS-R3, the coverage wording, the re-pins, a Unicode
  audit of everything since `7181b42`, and ordinary continuation
  (identical on all 75 real inputs).
- **CS-R2's recognizer omitted vertical tab** before the first newline.
  Commit I takes every whitespace and newline set from scan.l (§3.3) and
  adds the regressions for each `non_newline_space` character before and
  after LF, CRLF and CR, with and without a line comment, through both
  consumers.

## 1. What is required

**From Codex:**
- **JavaScript.** JavaScript/JSX-aware lexical or AST handling that
  preserves code, strings and token boundaries.
  - Literal values survive where a policy checks a string token (the
    `getDocument` guard).
  - The cases to cover: JSX, URLs, regex literals, templates, a `/*` in a
    line comment, real block comments, line endings, and token boundaries.
- **The shared helper and its inline copy are replaced together.**
- **SQL is handled separately:** line comments, nested block comments,
  quoted strings and identifiers, and dollar quoting.
- **Reversing the two regex passes is not a fix.**
- **Explicit behaviour on a parse failure.** A failure, or empty derived
  input, never silently licenses a negative-only check.
- **Fixtures:** the named negative fixtures kept; mutations that prove
  forbidden code stays visible next to comment-like text; Codex's
  reproduced cases.

**From Ryan (2026-10-15):**
1. JS/JSX-aware handling for the six consumers of `source-util.mjs` and the
   inline copy in `sw-clear-caches.test.js`.
2. Separate SQL handling for the inventory's `sqlWithoutComments` and the
   manifest checker's M-6/M-6b pipeline.
3. Explicit behaviour on a parse failure, so empty input can never pass a
   negative-only check.
4. Codex's reproduced cases as fixtures.

## 2. What exists today (at `41153b8`)

### 2.1 The JavaScript stripper and its readers

`scripts/tests/source-util.mjs` is three lines. It normalizes CRLF, deletes
every `/\*[\s\S]*?\*/` match, then deletes each line from its first `//`.
It does not know what a string, a regex literal, a template or JSX is.

| file | what it strips | Codex's finding |
|---|---|---|
| `pdf-safe.test.js` | `:40` every `src/**/*.js(x)` but `pdfSafe.js`; `:54` the evasion fixtures | `:40` is negative-only: **a whole file can vanish** (reproduced) |
| `build-stamp.test.js` | `buildStamp.js`, `vite.config.js`, `App.jsx`, `EmployeeLogin.jsx`, `main.jsx`, `inject-sw-manifest.mjs`; `:131` every `scripts/tests/*.test.js` | `:131` negative-only (reproduced); `:31` and `:39` partial erasure passes the negatives (reproduced) |
| `release2-deploy-context.test.js` | `netlify/lib/deploy-context.js`, `netlify/lib/release2.js`, `netlify/functions/deploy-context.js`, `inject-sw-manifest.mjs` | DC-6 can pass on empty text; DC-7, DC-20 and DC-24 can lose a forbidden part. DC-13 and DC-22 are positive-only on source |
| `release2-endpoints.test.js` | the eight slice-2 handlers and `release2-auth.js`, through `read()` | partial erasure can hide negative properties |
| `release2-inventory.test.js` | `inventory-check.mjs` (INV-5) | the negative snapshot-dependency assertion can miss erased code |
| `sw-cache.test.js` | `public/sw.js`; `:190`'s CRLF fixtures | the negative checks can pass on erased input |
| `sw-clear-caches.test.js` | `public/sw.js`, with an **inline copy** of the two regexes (lines 90–91) | its required patterns reject total erasure |

### 2.2 Measured at `41153b8`: what the helper already deletes from the test views

Claude measured this, and Codex measured it independently
(`release-41153b8-current-stripper-measurement.json`). Both used parses
that blank comments only.

- **All 68 files** the consumers read parse with acorn (`acorn-jsx` for
  `.jsx`; `script` for `public/sw.js`).
- **The old helper deletes non-comment, non-whitespace characters from 22
  of the 68.**

**These are deletions from the tests' VIEWS of the source, not from the
deployed bundle.** The examples:
- **`src/App.jsx`: five spans, about 200 lines, 5,348 characters.** Each
  starts at an `image/*` inside a string and runs to the next real `*/`.
  The first (lines 165–176) holds `callQueueFn` and its `fetch`.
- **`src/UploadApp.jsx`: lines 26–48**, with `callFn`'s `fetch`.
- **`src/DataMerge.jsx`: lines 806–862.**
- **`public/sw.js`:** three CDN URL strings, from `//` to the end of the
  line.
- **`scripts/inject-sw-manifest.mjs`:**
  - line 35's string `"/*__BUILD_ASSETS__*/"`;
  - the rest of line 79, after a regex literal ending `\//`.
- **`scripts/tests/inventory-check.mjs`:** its import block (lines 143–151)
  and four regex literals.
- **Sixteen test files** read by `build-stamp:131`.

**What raw-source checks show (the scope of "no current conclusion is
wrong").** This holds only for the named forbidden-pattern and anchor
checks below, read against raw source. It is not a proof of application
correctness:
- no `getDocument` outside `src/lib/pdfSafe.js`;
- no `../../dist` or `/dist/assets/` in any test file;
- `public/sw.js` names `startsWith("/upload")` only in a comment;
- these lose nothing:
  - the eight handlers and `release2-auth.js`;
  - `netlify/lib/deploy-context.js`, `netlify/lib/release2.js` and
    `netlify/functions/deploy-context.js`;
  - `buildStamp.js`, `vite.config.js`, `EmployeeLogin.jsx` and `main.jsx`;
- what `inject-sw-manifest.mjs` and INV-5's slice lose holds none of their
  tests' forbidden patterns.

The new lexers and the consumer controls set the corrected baseline.

### 2.3 The SQL pipelines

- **`inventory-check.mjs:374`, `sqlWithoutComments`** (block regex, then
  `--` regex) feeds `appliedReleaseState`: INV-6 and the lifecycle checks.
  - Codex reproduced a migration whose `CREATE TABLE` sits between `-- …/*`
    and `-- */`. The present set came back empty, and `readTablesSnapshot`
    accepted a snapshot that omits the table.
  - **The table-name pattern can derive a partial name.**
    `(?:public\.)?([a-z_][a-z0-9_]*)` reads `other.t` as table `other`, and
    `foo$bar` as `foo`.
  - `createdTables` (the protected names) reads raw SQL with a
    similar pattern.
  - **The file is A3-pinned.**
- **`stage0-manifest-check.mjs` M-6/M-6b, lines 263–305:** `--[^\n]*` and
  `^--.*$` (no block pass), plus `'[^']*'`, for these checks:
  - STATE read-only and recovery names;
  - CANCEL-INSPECT read-only and non-empty;
  - CANCEL-STEP call count, termination, filters and refusal order;
  - LOCKPROBE confinement;
  - SIZE-PROBE outside its literal.

  `select '--'; drop table …` loses the DROP. The byte bindings (blob
  embedding, md5/bytes gates, output pins, send policy) are exact-string
  checks and are not touched. The checker itself is not pinned.

### 2.4 Not affected

- the inventory's AST reach scan, and E's `localImportClosure`;
- every runtime test that executes code instead of reading it.

## 3. Design

### 3.1 JavaScript: `jsCode()` in `scripts/tests/source-util.mjs`

```js
jsCode(src, { label, jsx = /\.jsx$/.test(label), sourceType = "module", allowEmpty = false })
```

- **`label` is required.** Every error names it.
- **Normalize.** `\r\n` and lone `\r` become `\n`.
- **Parse** with the pinned `acorn` 8.18.0 (`ecmaVersion: "latest"`),
  extended by the pinned `acorn-jsx` 5.3.2 when `jsx` is set. Comments are
  collected through `onComment`, JSX `{/* … */}` included.
- **The result** is the normalized text with every comment character
  replaced by a space, except a **line terminator: LF, U+2028 or U+2029**.
  CR and CRLF are LF by then. A line terminator is kept (Codex's review of
  `9333448`, CS-R3):
  - the same length, lines and columns;
  - strings, templates, regex literals and JSX text are kept verbatim;
  - a comment between two tokens becomes whitespace, so tokens never join;
  - a comment that held a line break still holds it, so automatic
    semicolon insertion is unchanged. `return /*<U+2028>*/ 1` returns
    undefined in the source and in the view. Token equality cannot show
    this, so CS-5 compares ASTs.
- **A parse failure throws:**
  `<label>: does not parse as <module|script>[+jsx]: <acorn message>`.
  - No partial result, no regex fallback, and no retry with another
    `sourceType`.
  - `public/sw.js` is a classic worker script, and its readers say
    `sourceType: "script"`.
- **An empty result throws** unless `allowEmpty: true`. Only comment-only
  controls pass it.
- **`stripComments` is deleted, not aliased.** Every call site is changed
  and reviewed, and a forgotten import fails loudly.

### 3.2 The JavaScript consumers, and their negative predicates

**Each consumer reads through `jsCode` with its path as the label:**
- `build-stamp.test.js`: seven reads;
- `pdf-safe.test.js`: the `src/` walk;
- `release2-deploy-context.test.js`: seven reads;
- `release2-endpoints.test.js`: through its `read()`;
- `release2-inventory.test.js`: INV-5;
- `sw-cache.test.js` and `sw-clear-caches.test.js`: `public/sw.js`, as a
  `script`.

The inline copy in `sw-clear-caches.test.js` is deleted.

**Every negative source predicate is registered (Codex Q1).** Each
consumer file declares its negative source predicates in one table:
- an id;
- the view it reads;
- the predicate (a regex, or a function such as DC-7's env-read set or
  DC-20's import list);
- a **hit**: a valid top-level statement that violates the predicate.

The original assertions use the table's predicates, so the control and the
assertion test the same thing.

**What each file's CS-4 control does:**
- **(a)** Every registered predicate passes on its real view.
- **(b)** For each hit and each **hiding wrapper**, the mutant (the real
  source plus the wrapped hit) parses, and the predicate catches it. The
  wrappers:
  - a `/*` in a line comment, closed by `// */`;
  - an `"image/*"` string, closed by a real `/* */`;
  - a URL string, then the hit on the same line;
  - a regex literal ending `\//`, then the hit;
  - a template holding `//` and `/*`.

  A predicate anchored at the start of a line skips the three same-line
  wrappers, and those combinations are **not exercised**.
  - Two predicates are line-anchored: build-stamp's `stampImport` and
    deploy-context's `importsOf`/`dc20Imports`. That makes **six skipped
    combinations**.
  - Their same-line gap (`x = 1; import y from "z"` evades them) is a
    matching defect, not a lexing one. It is tracked as its own item,
    which replaces them with AST import declarations.
- **(c)** A coverage check parses the test file itself. Every
  `assert.doesNotMatch` (or equivalent negative) on a source view must take
  its predicate from the table, so a new unregistered negative fails.

**Positive-only source tests** (DC-13, DC-22, and the anchor and order
checks) get no invented negative. Their positive or runtime controls stand,
and CS-5 proves their inputs keep all their code.

**Real-input preservation and coverage stay:**
- `pdf-safe:40` and `build-stamp:131` assert that the scanned set equals
  the directory walk and is non-empty;
- INV-5 asserts both slice anchors are found, with end after start, before
  its negative. Today a missing anchor silently slices the wrong text;
- DC-6 first asserts the reader's export is in the view.

### 3.3 SQL lexing: `scripts/tests/sql-lexer.mjs` (new), pure segmentation

```js
lexSql(text, { label })   // → [{ kind, start, end, tag?, bodyStart?, bodyEnd? }]
```

**The required string mode is PostgreSQL's default,
`standard_conforming_strings = on`.** A backslash in `'…'` is literal. A
code segment that names `standard_conforming_strings` is refused as
unsupported, because it could change the rule.

**The segment kinds:**
- `line-comment`: `--` to the first **LF or CR**, PostgreSQL's newline
  (CS-R1). The text is lexed as it is: no line ending is rewritten, and a
  view keeps every LF and CR;
- `block-comment`: `/* … */`, **nested**, counted by depth as PostgreSQL
  does;
- `string`: `'…'` with `''`. The prefixes `U&'`, `B'`, `X'` and `N'` end by
  the same rule, so the prefix lexes as code before a plain string;
- `e-string`: `E'…'` (`E` as a whole token), with backslash escapes and
  `''`;
- **string continuation** (scan.l's `quotecontinue`; CS-R2): a quote that
  follows a closed string across whitespace holding a newline, with `--`
  comments counted as whitespace, continues that string **in its mode**.
  - A continued E-string's next segment is an `e-string` with
    `continues: true`, and takes backslash escapes. So
    `E'a'⏎'it\'s -- x'; drop …` hides nothing.
  - An ordinary string's continuation is ordinary.
  - Rejecting continuation was not available: the real inputs use
    ordinary continuation 148 times, in multi-line `comment on … is '…'`
    texts, `release2_01` and the pending 02–05 among them. None uses
    E-string continuation;
  - **every whitespace and newline set** in the recognizer is copied from
    scan.l at `REL_17_5` (md5 `ce6026b9…`, identical to `REL_17_STABLE` on
    2026-10-20). Those definitions are `space`, `non_newline_space`
    (`[ \t\f\v]`), `newline`, `non_newline`, `comment`,
    `special_whitespace`, `non_newline_whitespace`,
    `whitespace_with_newline` and `quotecontinue`.
    - The first version's hand list left out vertical tab before the
      newline (Codex's review of `1c4d8a4`, CS-R2), which I corrects.
    - A review-only differential check against PostgreSQL 17.5 (PGlite,
      outside the repository) compares the consumers with what
      PostgreSQL actually does over generated continuation inputs;
- `quoted-ident`: `"…"` with `""` (and `U&"…"` likewise);
- `dollar`: `$tag$…$tag$`, where the tag is empty or
  `[A-Za-z_][A-Za-z0-9_]*`. **Lexically it is a string.** The lexer never
  looks inside it, so a data literal is never "malformed SQL";
- `code`: everything else.
  - An identifier starts with an ASCII letter, `_` or any code unit from
    0x80 up, and continues with those, digits and `$`, so
    the `$` in `a$b$` belongs to the identifier.
  - `$` plus a digit is a parameter.

**Unsupported forms throw, with the label and offset:**
- an unterminated string, identifier, dollar quote or block comment;
- a `$` that opens neither a parameter nor a dollar quote (including a
  non-ASCII tag);
- `standard_conforming_strings` in code.

**Bounds:**
- input at most 4 MiB. The largest real input is SIZE-PROBE's 241,149
  bytes;
- block-comment nesting at most 64;
- work linear in the input: each character is visited once, and a dollar
  quote's end is found with one `indexOf`.

**Invariant, checked on every call:** the segments are contiguous and cover
the input exactly. That is necessary, not sufficient: the lexical
correctness is in the CS-3 matrix.

### 3.4 SQL interpretation: `sqlCode()`, roles decided by the consumer

```js
sqlCode(text, { label, strings: "keep" | "blank", bodies })
```

`bodies` is **required**:
- `"code"` means every dollar body in this text is executable SQL or
  PL/pgSQL;
- otherwise it is a function the consumer writes: `(segment, context) →
  "code" | "data"`, deciding by the input's reviewed role and position,
  **never by the tag alone**.

Any other answer throws (fail closed).

**The view keeps the input's length:**
- **Comments:** every character becomes a space, except **LF and CR**,
  which are kept, at every depth.
- **Strings, e-strings and quoted identifiers:** kept verbatim, or blanked
  between their delimiters (`strings: "blank"`), by the consumer's
  explicit choice.
- **A `code` dollar body:** its delimiters are kept, and its body is
  replaced by `sqlCode(body)` with the same options, recursively.
  - The depth is at most 8, and a deeper body throws.
  - A body that does not lex throws, labelled with its path
    (`label > $tag$ at offset N`).
  - This is the interpretation layer: the consumer has declared the body
    executable.
- **A `data` dollar body:** kept, or blanked whole, by the `strings`
  option.

**The identity property (tested in CS-5).** With `strings: "keep"`, every
character outside a comment is unchanged in the view, at every depth. Every
comment character is a space or `\n`.

### 3.5 The SQL consumers

**`inventory-check.mjs`:**
- **One view for both uses.** `appliedReleaseState` and `createdTables`
  read `sqlCode(raw, { strings: "keep", bodies: "code" })`.
  - Strings are kept (Codex Q2), so a DDL text in an `execute '…'` string
    stays visible. That can also match DDL-like data; it is conservative,
    not a dynamic-SQL analyzer.
  - Every dollar body in a release2 migration is a function or `DO` body
    (`$fn$`, `$guard$`, `$post$` today).
- **One target parser for both, `ddlTargets(view, label)`** (Codex Q5).
  It finds every `create … table` and `drop … table` and accepts only
  these complete forms:
  - `create table [if not exists] [public.]<name> (`
  - `drop table [if exists] [public.]<name>` followed by `;`, `cascade` or
    `restrict`

  where `<name>` is `[a-z_][a-z0-9_]*` (folded to lower case) and is
  followed by whitespace, `(`, `;` or the end.
- **Everything else is an error, never a partial name:**
  - a modifier (`temp`, `temporary`, `unlogged`, `foreign`, `global`,
    `local`);
  - a quoted name;
  - a schema other than `public`;
  - an identifier character after the name (`foo$bar`);
  - `if exists` on a CREATE, or `if not exists` on a DROP;
  - more than one target (`drop table a, b`);
  - a CREATE not followed by `(`.
- **The errors surface everywhere the names are used:**
  - `protectedNamesByState` gains `errors`;
  - `runInventory` reports them;
  - `readTablesSnapshot` returns the first, as it already does for
    `appliedReleaseState`.
- **`createdTables` moves from raw text to the comment-blanked view.**
  - A name that appears only in a comment is no longer protected.
  - The before/after comparison (§6) reports any difference in the
    protected set at HEAD and at every replay state.

**`stage0-manifest-check.mjs`.** Each check becomes an exported pure
predicate that M-6 calls, and that the tests can call:

| predicate | view | strings | bodies |
|---|---|---|---|
| `readOnlyViolations(text, keywords)`: STATE; CANCEL-INSPECT (with `do`, `pg_cancel_backend`, `pg_terminate_backend`); empty CANCEL-INSPECT is a problem | `sqlCode` | blanked | `"code"` |
| STATE's recovery names (positive) | `sqlCode` | kept | `"code"` |
| `cancelStepProblems(text)`: exactly one `pg_cancel_backend(`, no `pg_terminate_backend`; the filter and refusal-order patterns | `sqlCode` | kept (the patterns match string contents) | `"code"` |
| `lockprobeOutside(text)`: DDL targets outside `stage0_lockprobe` | `sqlCode` | kept | `"code"` (`$g$`, `$c$`, `$stage0_wrap$` bodies; `$stage0_file$` is the executed input) |
| `sizeProbeOutsideProblems(head, tail)`: one statement, no write keyword | `sqlCode` on `HEAD + TAIL` | blanked | a function: **data only** for the one dollar segment that starts exactly at `HEAD.length − 7`, has tag `probe` and an empty body (the reviewed junction). Every other dollar body is code. If that junction is missing, that is a problem |

- **A lex error is a `say()`, never a pass.**
- **Unchanged:** every byte binding (blob embedding, md5/bytes gates,
  output pins, send policy M-12), every SQL file, every assembler output.

### 3.6 One implementation each: CS-6, the guard

Every `scripts/**/*.{js,mjs}` is parsed with acorn. The guard fails on any
regex literal that is the first argument of `.replace` or `.replaceAll` and
whose source contains `\/\*`, `\/\/` or `--`. Its exemption list is empty.
- **Required-failing controls:** the three old implementations, verbatim,
  must each trip it. They are the old `stripComments`, the
  `sw-clear-caches` inline copy, and `sqlWithoutComments`.
- **The limit, stated in the test:** it catches the named regex-literal
  forms only. A stripper built with `new RegExp("…")` passes it. It is a
  regression check, not a proof that no custom stripper exists.

## 4. Tests and fixtures

**CS-1. Codex's reproductions, with verbatim inputs from the audit JSON:**
- **a.** `// netlify/functions/*.js\nlib.getDocument({ data });\n// */\n`:
  the `getDocument` predicate is true.
- **b.** The stamp probe: the required
  `typeof __PC_BUILD__ !== "undefined"` is kept, **and**
  `fetch("/server-stamp")` is visible to `:31`'s predicate.
- **c.** The dist probe:
  `readFileSync("../../dist/assets/main.js", "utf8")` is visible to
  `:131`'s predicate.
- **d.** The SQL CREATE/snapshot case, in an isolated fixture root:
  - `appliedReleaseState(root).present` contains `audit_hidden`;
  - `readTablesSnapshot` refuses the snapshot that omits it.
- **e.** `select '--'; drop table public.audit_hidden;`:
  `readOnlyViolations` reports the DROP.

**CS-2. The JavaScript matrix, through `jsCode`.** Each case is LF, CRLF
and lone CR:

| case | expected |
|---|---|
| a URL string, then a call on the same line | the call is visible |
| a regex literal holding `/*`, or ending `\//`, then a call | visible |
| a template holding `//` and `/*`; a comment inside `${ }` | the template kept; that comment blanked |
| JSX text holding `http://` and `/*` (a `.jsx` label); `{/* … */}` | the text visible; the comment blanked |
| `accept="image/*,application/pdf"`, code, then a real `/* x */` | the code between is visible |
| real block and line comments naming `getDocument` | invisible |
| **`let/**/x = 1;`** | parses; the view is `let    x = 1;`; its tokens equal the source's (`let`, `x`, `=`, `1`, `;`) |
| `const = ;` | throws, naming the label |
| `// only a comment` | throws; with `allowEmpty`, whitespace only |

**CS-3. The SQL matrix:**

| case | expected |
|---|---|
| `/* a /* b */ create table x (id int); */ create table y (id int);` | only `y` |
| a `$fn$ … -- drop table z ⏎ … $fn$` body, `bodies: "code"` | `z` invisible: a comment inside the body |
| `$fn$ … drop table w … $fn$`, `bodies: "code"` | `w` visible |
| the same body under a consumer `data` role | not interpreted; kept or blanked whole |
| a data literal that is not SQL (`$d$ it's $d$`) | `lexSql` returns one dollar segment and no error |
| `'$$'`, `$1`, `a$b$` | none opens a dollar quote |
| `select E'it\'s -- x'; drop table v;` | the DROP is visible |
| `select 'a\'; drop table d; --'` | the DROP is visible, and `--'` is a comment |
| `select "a--b"; drop table c;` and `"a/*b"`; `U&"d--"` | the DROP is visible |
| an unterminated `'`, `E'`, `"`, `$x$`, `/*` (and `/* /* */`) | throws; the M-6 predicates report it |
| `$é$`, a bare `$x`, `set standard_conforming_strings = off` | throws as unsupported |
| nesting deeper than 64; a body deeper than 8; input over 4 MiB | throws |
| item 2's `ENVELOPE-PROBE-2` shape: `do $$ begin execute E'select 1;\n-- line two\nselect 1/0;'; end $$;` | `select 1/0` visible with strings kept, blanked with strings blanked |
| **table targets (Codex Q5):** `create table "Audit" (…)`; `create table other.t (…)`; `drop table a, b;`; `create unlogged table public.t (…)`; `create table public.t as select 1`; `create table foo$bar (…)`; `drop table if not exists t;` | each an error, in `createdTables`, `appliedReleaseState` and `readTablesSnapshot` alike, and never a partial name |
| `CREATE TABLE IF NOT EXISTS Public.T (…)`; `drop table if exists public.t cascade;` | supported, name `t` |

**CS-4. The negative-predicate controls (§3.2).** Per JS consumer file:
- the registry, with its real-view pass;
- every hit under every applicable hiding wrapper;
- the coverage check.

**SQL:**
- `readOnlyViolations` for STATE and for CANCEL-INSPECT, on the real texts
  (none) and on mutants hiding `delete from`, `drop table`, `truncate` and
  `pg_terminate_backend` behind each SQL wrapper. The SQL wrappers are a
  `-- …/*` collision, a literal `'--'`, an E-string, a quoted identifier,
  and a dollar body with `--` in it;
- an empty CANCEL-INSPECT;
- **`cancelStepProblems`**: the real template is clean. Mutants hiding a
  `pg_terminate_backend(…)`, or a second `pg_cancel_backend(…)`, are
  caught;
- `lockprobeOutside`: a hidden `drop table public.employees`, and a hidden
  `alter table public.employees`;
- `sizeProbeOutsideProblems`: a hidden second statement, a hidden write
  keyword, a moved junction, and a second dollar body planted to hide a
  write (it is code, so the write is caught);
- the inventory: CS-1d, and the table-target cases above.

**CS-5. Real-input invariants:**
- every file a JS consumer reads parses (68 at `41153b8`);
- re-parsing `jsCode`'s output gives exactly the source's tokens (type,
  value, start, end), **the same AST** (CS-R3: tokens alone cannot show an
  ASI change), and **zero** comments;
- every SQL text the inventory or M-6 reads lexes;
- `sqlCode` keeps code and string identity (§3.4), checked on every real
  input, at every depth.

**CS-6.** The guard, with its three required-failing old implementations.

**The before-run.** Each CS-1, CS-2, CS-3 and CS-4 mutant is also run once
against `41153b8`'s helpers, by a throwaway script outside the repository.
- The review request records which ones the old helpers get wrong.
- A fixture the old helpers already handle is labelled a regression
  fixture, not evidence of the fix.

## 5. What changes, and what does not

**Changes:**
- `source-util.mjs`: `jsCode`; `stripComments` deleted;
- new `sql-lexer.mjs`;
- the seven JS consumer test files;
- `inventory-check.mjs`;
- `stage0-manifest-check.mjs`, with its predicates exported;
- new `scripts/tests/comment-lexing.test.js` (CS-1…3, CS-5, CS-6);
- the CS-4 controls, in their consumers' files;
- `CLAUDE.md`'s SOURCE-STRING paragraph.

**The manifest, regenerated.** A3 re-pins `inventory-check.mjs` and newly
pins `sql-lexer.mjs`, which M-7b requires because it enters the inventory's
import closure. **That is all:** no migration, rollback, proofs, assembler,
sender, output or send-policy value moves.

**Does not change:**
- `src/`, `netlify/` and `public/`, nor any other A3 build input;
- any SQL file or pinned text;
- Vite's configuration;
- no database, staging or production operation.

## 6. Verification

1. **A clean clone of the staged tree:** `yarn install`, `yarn test` (the
   count), `yarn build`.
2. **Build equivalence (Codex correction 2):**
   - **Input invariance:** `git diff 41153b8 <CS> --` over every A3 tree
     and every A3 blob except the two test-only modules is empty.
   - **A review-only harness:**
     - one `yarn install`, junctioned into clones of `41153b8` and of CS;
     - the same environment, with `COMMIT_REF`, `DEPLOY_ID` and `CONTEXT`
       unset;
     - **the build clock fixed** by a `node --import` preload that pins
       `Date`;
     - then `vite build` in each, and the `dist/` file lists and md5s
       compared.

     The harness changes nothing in the repository.
   - **Ordinary builds are not claimed to be byte-identical:** the build
     stamp's time and the hash cascade differ.
3. **The full-suite record replay** (14 states from 01).
   `inventory-check.mjs` and the inventory fixtures change, and INV-6 runs
   at every state.
4. **Before and after**, by a throwaway script, at `41153b8` and at CS, and
   at HEAD and every replay state. The **policy verdicts**:
   - `protectedNamesByState`;
   - `appliedReleaseState`;
   - `readTablesSnapshot`;
   - every M-6/M-6b predicate;
   - every JS negative predicate on its real input.

   **Kept apart:** the reviewed **pin metadata** changes (the manifest's A3
   entries). A verdict that differs is inspected and explained, not forced
   back.
5. **Codex's audit script** imports `stripComments`, which CS deletes. CS-1
   carries its inputs.
6. **Commit.** The commit is made from the verified index, and nothing is
   pushed.

## 7. Order

**Accepted by Codex: CS → 2 → 6 → 3 → 4(c).** Item 2's implementation starts
only after Codex accepts CS: its `ENVELOPE-PROBE` checks rely on CS's SQL
handling (`ENVELOPE-PROBE-2` carries `-- line two` inside an `E'…'` string).

## 8. Out of scope

- items 2, 3, 4(c) and 6;
- the inventory's AST reach scan, and E's import closure;
- SQL grammar beyond the CREATE/DROP target forms of §3.5;
- `alter table … rename`, which the inventory does not track;
- runtime behaviour tests.

## 9. Questions for Codex — answered 2026-10-15

The seven questions are answered in §0 and folded into §3–§7.
