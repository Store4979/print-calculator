# Deploy inventory — retained deployments and what they hold

Stage 0 step 3 of `release-2-data-path-plan.md` (§4.2): every Netlify
deployment is an **immutable bundle with the environment it captured at
build**. A deploy preview that was built while `SUPABASE_SERVICE_ROLE_KEY`
was available to its context keeps that key for as long as its permalink
answers, whatever the dashboard says today. This file lists them, with the
probe that established each row, and is refreshed at each cutover.

**Probe method (write-free).** `POST {}` with `content-type: application/json`
to `/.netlify/functions/start-upload`. The legacy handler checks the key
BEFORE parsing the body and stops at body validation AFTER creating the
client, so the answer distinguishes key presence without any database or
storage call: `400 fileName required` = key present; `500 Service role key
not configured` = key absent; `404` = the deploy has no functions; `502` =
the bundle crashes at module scope (pre-CLAUDE.md-gotcha era), key state
unknown. `deploy-context` is stage 0's diagnostic route; only bundles built
from `6c47eb6` or later carry it.

Enumerated from the public Netlify API, 150 deploys on the production
site, 79 of them deploy previews. Probed 2026-09-23T15:41:50Z.

## Production site `printcalculator2` (site id `03ff880d-eb73-4035-8b71-3588b22a0b20`)

### PR #48 preview — the stage 0 probe target (0b)

| field | value |
|---|---|
| alias | `https://deploy-preview-48--printcalculator2.netlify.app` (moves to the latest #48 build) |
| immutable URL | `https://6ab3efa301777b0008a746f1--printcalculator2.netlify.app` |
| deploy id | `6ab3efa301777b0008a746f1` |
| commit | `b294791db2451f84239af1994478af6d7afbee4c` (`security/release-2-stage-0`) |
| context (from the bundle) | `deploy-preview` — `deploy-context` body recorded in `scripts/manual/staging-probes.md` 0b |
| `RELEASE2_ENABLED` | **absent** (`flagPresent: false`) |
| service-role key | **absent** (`500 Service role key not configured`) |
| legacy routes | present: `register-job` (GET reports its algorithm), `start-upload`, `fetch-link-job`, `get-download-url`, `complete-job`, `send-print-job` (405 on GET) — all refuse work for want of the key |
| Release 2 routes | `csrf-bootstrap` → `404` with no Origin, with the staging Origin, with its own Origin. **Masked**: the production-ref refusal fires first on this site, so these 404s are NOT evidence for the context condition. Recorded as §4.1 evidence **(b)** (context = deploy-preview) and the flag-absence half of **(d)** only. |

### Every PR #48 preview so far — none holds the key (probed 2026-09-23 17:49Z)

| deploy id | commit | built (UTC) | service-role key | `deploy-context` |
|---|---|---|---|---|
| `6ab40f88d8322c00084cf8d9` | `8821573` | 17:42 | absent | `deploy-preview`, flag absent |
| `6ab40e674e6ec500087de9bc` | `fcb5da6` | 17:37 | absent | `deploy-preview`, flag absent |
| `6ab3f40c055a620008aec356` | `47551b4` | 15:45 | absent | `deploy-preview`, flag absent |
| `6ab3efa301777b0008a746f1` | `b294791` | 15:26 | absent | `deploy-preview`, flag absent |

### Retained previews that HOLD the key — 56 deployments

Live legacy writers, reachable by permalink, each with the production
service-role key captured at build. This is the "older deployments" writer
class of plan §4.2 step 3 / §6.1 (T1). Retirement is by one of exactly three
mechanisms (deletion, verified access restriction, credential rotation), each
recorded here per URL when taken. **None taken yet.**

| deploy id (permalink `<id>--printcalculator2.netlify.app`) | PR | commit | built (UTC) | state | service-role key | `deploy-context` |
|---|---|---|---|---|---|---|
| `6ab01d907071af0008909199` | #47 | `73abb2a3b9b9` | 2026-09-20T17:53 | ready | PRESENT | no route |
| `6aad54ddafc4080008f11279` | #46 | `cefda591556a` | 2026-09-18T15:12 | ready | PRESENT | no route |
| `6aa994ab65368c000995736a` | #45 | `8e575986a9a2` | 2026-09-15T18:55 | ready | PRESENT | no route |
| `6aa963505b88680008939395` | #45 | `e833e886891e` | 2026-09-15T15:25 | ready | PRESENT | no route |
| `6aa94db75638680009babccc` | #45 | `2627687bf815` | 2026-09-15T13:52 | ready | PRESENT | no route |
| `6aa94ce90ab9280008e1c5d3` | #45 | `d0391f1c94cd` | 2026-09-15T13:49 | ready | PRESENT | no route |
| `6aa8292e7fad050007292c3d` | #45 | `34a69ec7e401` | 2026-09-14T17:04 | ready | PRESENT | no route |
| `6aa827595766b400089ca6ec` | #45 | `aea456ee3dc7` | 2026-09-14T16:56 | ready | PRESENT | no route |
| `6aa8177f0933cc00077e5b76` | #45 | `3ac5b05c4adf` | 2026-09-14T15:49 | ready | PRESENT | no route |
| `6aa80f6f16ae3c0008f47628` | #45 | `0a9c61a15236` | 2026-09-14T15:14 | ready | PRESENT | no route |
| `6aa80ed4ce8bfb00080b9b91` | #45 | `6eb57551eb0e` | 2026-09-14T15:12 | ready | PRESENT | no route |
| `6aa802021f0c9f00085e4466` | #45 | `c61905368829` | 2026-09-14T14:17 | ready | PRESENT | no route |
| `6aa5bf17ff6f6f000874b0fa` | #45 | `00f78e081187` | 2026-09-12T21:07 | ready | PRESENT | no route |
| `6aa58d3cc9d46f000897cae2` | #44 | `9c99bbfaeaeb` | 2026-09-12T17:34 | ready | PRESENT | no route |
| `6aa588e86320810008f82544` | #44 | `10b6e04f5177` | 2026-09-12T17:16 | ready | PRESENT | no route |
| `6aa587d57345c3000893fea4` | #44 | `b2ac88a27608` | 2026-09-12T17:11 | ready | PRESENT | no route |
| `6aa5845cb3e9800008232379` | #44 | `85502dec479d` | 2026-09-12T16:57 | ready | PRESENT | no route |
| `6aa5594dff6f6f00086665c0` | #44 | `95a0b8c9b0c4` | 2026-09-12T13:53 | ready | PRESENT | no route |
| `6aa555a46d1d0c0008be7650` | #44 | `02636ea8f992` | 2026-09-12T13:37 | ready | PRESENT | no route |
| `6aa55539a321d0000894f9b6` | #44 | `f90a2639ef83` | 2026-09-12T13:35 | ready | PRESENT | no route |
| `6aa5503a9922850008784086` | #44 | `9051c0e23ba5` | 2026-09-12T13:14 | ready | PRESENT | no route |
| `6aa4a6e773d1830009f60e59` | #44 | `6c3c1470c0df` | 2026-09-12T01:12 | ready | PRESENT | no route |
| `6aa4a1c3122c5c0007ba84c6` | #44 | `68ea008f61fc` | 2026-09-12T00:50 | ready | PRESENT | no route |
| `6aa49f8e89ac8a00081a2f44` | #44 | `88ec2c70aa18` | 2026-09-12T00:40 | ready | PRESENT | no route |
| `6aa49a680044aa000871e75a` | #44 | `406933676717` | 2026-09-12T00:18 | ready | PRESENT | no route |
| `6aa48b888b63af0008c2be72` | #44 | `57d69f928f06` | 2026-09-11T23:15 | ready | PRESENT | no route |
| `6aa4897e6cc424000833a95b` | #44 | `2cae8bd9cd9d` | 2026-09-11T23:06 | ready | PRESENT | no route |
| `6aa42b3c60fee800089edb4c` | #44 | `81d33dabfe98` | 2026-09-11T16:24 | ready | PRESENT | no route |
| `6aa41f5b5b99fc0009345539` | #43 | `1ce78491a47c` | 2026-09-11T15:33 | ready | PRESENT | no route |
| `6aa41eb8cae4590008947e65` | #43 | `1905b88c83a0` | 2026-09-11T15:31 | ready | PRESENT | no route |
| `6aa418133948e70008fb1e40` | #43 | `62a943233bd9` | 2026-09-11T15:02 | ready | PRESENT | no route |
| `6aa31186185cb4000850775a` | #43 | `83294a28ca91` | 2026-09-10T20:22 | ready | PRESENT | no route |
| `6aa2d85fe22b1f000826f8a5` | #43 | `6d8a405e1044` | 2026-09-10T16:18 | ready | PRESENT | no route |
| `6aa2ba87034ae30009eb7e5b` | #42 | `69d4bfb26610` | 2026-09-10T14:11 | ready | PRESENT | no route |
| `6aa2ba6c4723f800096e2b82` | #37 | `748f45aec40a` | 2026-09-10T14:10 | ready | PRESENT | no route |
| `6aa2b806bd19220008cd2350` | #41 | `92df7d9ad441` | 2026-09-10T14:00 | ready | PRESENT | no route |
| `6aa1efb8817b7c0008ef56df` | #41 | `f5cf2302a735` | 2026-09-09T23:46 | ready | PRESENT | no route |
| `6aa18ebcc0615a000840cdef` | #40 | `f4e4509f3e0a` | 2026-09-09T16:52 | ready | PRESENT | no route |
| `6aa1873eee13c70008d2aba7` | #39 | `88438578ddb5` | 2026-09-09T16:20 | ready | PRESENT | no route |
| `6aa184fc3061e80007eb907d` | #39 | `288d184a7e08` | 2026-09-09T16:10 | ready | PRESENT | no route |
| `6aa05237dde06400074428ac` | #38 | `3fe3ce3d125a` | 2026-09-08T18:21 | ready | PRESENT | no route |
| `6a6a99aa7965770008feab95` | #37 | `6e45bd7912d1` | 2026-07-30T00:24 | ready | PRESENT | no route |
| `6a6a55d651b30500085a2ad5` | #37 | `8205d226ba05` | 2026-07-29T19:34 | ready | PRESENT | no route |
| `6a6a55bd4aa3d200086629b6` | #36 | `f9765696e77d` | 2026-07-29T19:34 | ready | PRESENT | no route |
| `6a6a147d13108b0008d28634` | #35 | `b4b3852d13ea` | 2026-07-29T14:55 | ready | PRESENT | no route |
| `6a69535a83be0b0009bf8453` | #35 | `6507fd8e4147` | 2026-07-29T01:11 | ready | PRESENT | no route |
| `6a69521ae77b8e0008cab8b9` | #35 | `0ef7a657b162` | 2026-07-29T01:06 | ready | PRESENT | no route |
| `6a6951343b4b0100093a4aad` | #35 | `65b87e322e48` | 2026-07-29T01:02 | ready | PRESENT | no route |
| `6a694837be66d2000814c691` | #35 | `2ee6f0bbc52e` | 2026-07-29T00:24 | ready | PRESENT | no route |
| `6a6670dd935a640009132e26` | #34 | `b1f51871fad6` | 2026-07-26T20:41 | ready | PRESENT | no route |
| `6a615ce014582d00082b8fc9` | #33 | `fdf63aedb99a` | 2026-07-23T00:14 | ready | PRESENT | no route |
| `6a612672813cd600081bb9bb` | #32 | `6535717fd878` | 2026-07-22T20:22 | ready | PRESENT | no route |
| `6a60df7c72b06b00095706c9` | #31 | `c5f9a91ea909` | 2026-07-22T15:19 | ready | PRESENT | no route |
| `6a609d9b6e2b010008e4701d` | #31 | `5fe358c2fbe2` | 2026-07-22T10:38 | ready | PRESENT | no route |
| `6a601121c7f43600080ace91` | #30 | `bef94cc16a5f` | 2026-07-22T00:38 | ready | PRESENT | no route |
| `6a5fb25be785700008594817` | #29 | `fdc31c3066ab` | 2026-07-21T17:54 | ready | PRESENT | no route |

### Previews WITHOUT the key — 1 deployments

| deploy id (permalink `<id>--printcalculator2.netlify.app`) | PR | commit | built (UTC) | state | service-role key | `deploy-context` |
|---|---|---|---|---|---|---|
| `6ab3efa301777b0008a746f1` | #48 | `b294791db245` | 2026-09-23T15:26 | ready | absent | route present |

The #48 preview lacks the key while every ready preview from #29 to #47 holds
it. **Cause, recorded 2026-09-23:** Ryan cleared `SUPABASE_SERVICE_ROLE_KEY`
from the production site's **Deploy Previews** context that day, before #48
built. Every preview built before that change captured the key and keeps it
(the table above); every preview built after it does not. This is plan §4.2
step 3's "future previews lack the key" — done, and observed. (#25–#28
answered 500 with an older handler's wording and are listed under "neither"
as `unknown (500)`; they predate the key being set at all.)

### Neither (no functions, or crashing) — 22 deployments

| deploy id (permalink `<id>--printcalculator2.netlify.app`) | PR | commit | built (UTC) | state | service-role key | `deploy-context` |
|---|---|---|---|---|---|---|
| `6ab018331b0a1500089d0930` | #47 | `d7fdbc9adb66` | 2026-09-20T17:30 | error | no functions | no route |
| `6aa31078e880ab0008667901` | #43 | `7a7ac41284bd` | 2026-09-10T20:18 | error | no functions | no route |
| `6a5fa9f509d2e20008af92f7` | #28 | `ae7de2c31dcf` | 2026-07-21T17:18 | ready | unknown (500) | no route |
| `6a455d60436d82000807ff9a` | #27 | `e28925c49578` | 2026-07-01T18:33 | ready | unknown (500) | no route |
| `6a455b30299f480008ad8966` | #27 | `55cb34eaca23` | 2026-07-01T18:23 | error | no functions | no route |
| `6a42d40ffc7e2f0008473eac` | #26 | `ea84ed944150` | 2026-06-29T20:22 | ready | unknown (500) | no route |
| `6a42c8fb300b08000832da74` | #25 | `095ea8c5dac5` | 2026-06-29T19:35 | ready | unknown (500) | no route |
| `6a42b788c1f1b100087b57e0` | #24 | `574b964dd0e2` | 2026-06-29T18:20 | ready | unknown (502: module-scope crash) | no route |
| `6a42b71cec4580000819f132` | #24 | `5bd2b6682027` | 2026-06-29T18:19 | ready | unknown (502: module-scope crash) | no route |
| `6a318658f5c12a00089f5503` | #23 | `71c6b236ca77` | 2026-06-16T17:22 | ready | no functions | no route |
| `6a185ed1be36c9000881c63d` | #22 | `16bea086a782` | 2026-05-28T15:27 | ready | no functions | no route |
| `69fb769ac450950007f5b98d` | #20 | `0ae0878c8ba5` | 2026-05-06T17:12 | ready | no functions | no route |
| `69fa1b469fbd70000868cee0` | #18 | `3aa6ada3e83b` | 2026-05-05T16:31 | ready | no functions | no route |
| `69f369e52acce10008262e67` | #15 | `b9c640d67d26` | 2026-04-30T14:40 | ready | no functions | no route |
| `69f22d71db945f0008a8eebf` | #9 | `4b88e2298bc4` | 2026-04-29T16:10 | ready | no functions | no route |
| `69f22a286a5db200082f0034` | #8 | `396136d15aa6` | 2026-04-29T15:56 | ready | no functions | no route |
| `69f224a66e778d00095dbdf0` | #7 | `ee39103cb850` | 2026-04-29T15:32 | ready | no functions | no route |
| `69f21ff79dceb3000872bbb3` | #6 | `6e70f8038bf8` | 2026-04-29T15:12 | ready | no functions | no route |
| `69f1405fb03e030008ea5b28` | #5 | `686202cfd5c5` | 2026-04-28T23:18 | ready | no functions | no route |
| `69f11e8031a04e0008a5ca65` | #4 | `85790b25c1aa` | 2026-04-28T20:54 | ready | no functions | no route |
| `69efa06d0258150009c4415a` | #3 | `35642cccffe9` | 2026-04-27T17:44 | ready | no functions | no route |
| `69ea366eb345cb0008d4de89` | #2 | `1e909012f5b5` | 2026-04-23T15:10 | ready | no functions | no route |

### Classification of the 56 key-bearing previews, by commit ancestry only

Two fixes matter for what a retained legacy bundle can do with the key it
holds. Both are judged by `git merge-base --is-ancestor` against the fix
commit on its own branch AND its landing commit on `main` (squash merges put
the fix under a different SHA on `main`): **nothing was called** on any of
these deployments — a `cleanup-stale-jobs` call deletes data and a
`send-print-job` call sends mail.

- **cleanup-stale-jobs secret fix** — `9c99bbf` on `security/release-2-plan`
  ("ROW 41 FAILS: cleanup-stale-jobs was an unauthenticated destructive URL"),
  landed as squash `7f89876` (PR #44). A bundle WITHOUT it exposes an
  unauthenticated destructive URL.
- **PR #43 send-print-job recipient fix** — `1ce7849` on
  `security/audit-2026-09-10` (recipient resolved server-side, body cannot
  choose it), landed by merge `10235f2`. A bundle WITHOUT it lets the request
  body choose the mail recipient.

Four commits are **unresolvable**: force-pushed away, on no ref GitHub still
serves (`refs/pull/N/head` and every branch were fetched). They are judged as
holding the key (probed) and as lacking both fixes (unknown ≠ fixed).

**Grouped by PR, every deploy id listed.** Deleting only a PR's latest deploy
makes `deploy-preview-N--printcalculator2.netlify.app` fall back to the next
older one, which also holds the key — so a PR is retired only when every id
in its row is gone.

| PR | deploys (newest first) | cleanup fix | recipient fix |
|---|---|---|---|
| #29 | `6a5fb25be785700008594817` (`fdc31c30`) | no | no |
| #30 | `6a601121c7f43600080ace91` (`bef94cc1`) | no | no |
| #31 | `6a60df7c72b06b00095706c9` (`c5f9a91e`)<br>`6a609d9b6e2b010008e4701d` (`5fe358c2`) | no<br>no | no<br>no |
| #32 | `6a612672813cd600081bb9bb` (`6535717f`) | no | no |
| #33 | `6a615ce014582d00082b8fc9` (`fdf63aed`) | no | no |
| #34 | `6a6670dd935a640009132e26` (`b1f51871`) | no | no |
| #35 | `6a6a147d13108b0008d28634` (`b4b3852d`)<br>`6a69535a83be0b0009bf8453` (`6507fd8e`)<br>`6a69521ae77b8e0008cab8b9` (`0ef7a657`)<br>`6a6951343b4b0100093a4aad` (`65b87e32`)<br>`6a694837be66d2000814c691` (`2ee6f0bb`) | no<br>no<br>no<br>no<br>no | no<br>no<br>no<br>no<br>no |
| #36 | `6a6a55bd4aa3d200086629b6` (`f9765696`) | no | no |
| #37 | `6aa2ba6c4723f800096e2b82` (`748f45ae`)<br>`6a6a99aa7965770008feab95` (`6e45bd79`)<br>`6a6a55d651b30500085a2ad5` (`8205d226`) | no<br>unresolvable<br>unresolvable | no<br>unresolvable<br>unresolvable |
| #38 | `6aa05237dde06400074428ac` (`3fe3ce3d`) | no | no |
| #39 | `6aa1873eee13c70008d2aba7` (`88438578`)<br>`6aa184fc3061e80007eb907d` (`288d184a`) | no<br>no | no<br>no |
| #40 | `6aa18ebcc0615a000840cdef` (`f4e4509f`) | no | no |
| #41 | `6aa2b806bd19220008cd2350` (`92df7d9a`)<br>`6aa1efb8817b7c0008ef56df` (`f5cf2302`) | no<br>no | no<br>no |
| #42 | `6aa2ba87034ae30009eb7e5b` (`69d4bfb2`) | no | no |
| #43 | `6aa41f5b5b99fc0009345539` (`1ce78491`)<br>`6aa41eb8cae4590008947e65` (`1905b88c`)<br>`6aa418133948e70008fb1e40` (`62a94323`)<br>`6aa31186185cb4000850775a` (`83294a28`)<br>`6aa2d85fe22b1f000826f8a5` (`6d8a405e`) | no<br>unresolvable<br>no<br>no<br>no | **yes**<br>unresolvable<br>no<br>no<br>no |
| #44 | `6aa58d3cc9d46f000897cae2` (`9c99bbfa`)<br>`6aa588e86320810008f82544` (`10b6e04f`)<br>`6aa587d57345c3000893fea4` (`b2ac88a2`)<br>`6aa5845cb3e9800008232379` (`85502dec`)<br>`6aa5594dff6f6f00086665c0` (`95a0b8c9`)<br>`6aa555a46d1d0c0008be7650` (`02636ea8`)<br>`6aa55539a321d0000894f9b6` (`f90a2639`)<br>`6aa5503a9922850008784086` (`9051c0e2`)<br>`6aa4a6e773d1830009f60e59` (`6c3c1470`)<br>`6aa4a1c3122c5c0007ba84c6` (`68ea008f`)<br>`6aa49f8e89ac8a00081a2f44` (`88ec2c70`)<br>`6aa49a680044aa000871e75a` (`40693367`)<br>`6aa48b888b63af0008c2be72` (`57d69f92`)<br>`6aa4897e6cc424000833a95b` (`2cae8bd9`)<br>`6aa42b3c60fee800089edb4c` (`81d33dab`) | **yes**<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>unresolvable<br>no<br>no | no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>no<br>unresolvable<br>no<br>no |
| #45 | `6aa994ab65368c000995736a` (`8e575986`)<br>`6aa963505b88680008939395` (`e833e886`)<br>`6aa94db75638680009babccc` (`2627687b`)<br>`6aa94ce90ab9280008e1c5d3` (`d0391f1c`)<br>`6aa8292e7fad050007292c3d` (`34a69ec7`)<br>`6aa827595766b400089ca6ec` (`aea456ee`)<br>`6aa8177f0933cc00077e5b76` (`3ac5b05c`)<br>`6aa80f6f16ae3c0008f47628` (`0a9c61a1`)<br>`6aa80ed4ce8bfb00080b9b91` (`6eb57551`)<br>`6aa802021f0c9f00085e4466` (`c6190536`)<br>`6aa5bf17ff6f6f000874b0fa` (`00f78e08`) | **yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes** | **yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>**yes**<br>no |
| #46 | `6aad54ddafc4080008f11279` (`cefda591`) | **yes** | **yes** |
| #47 | `6ab01d907071af0008909199` (`73abb2a3`) | **yes** | **yes** |

Totals: 56 key-bearing previews; **44 lack at least one of the two
fixes**; 12 carry both (all PR #45 from `c619053` on, #46, #47) and still hold the
production service-role key with live legacy writers.

### Proposed deletion list — proposal only, nothing deleted

Delete **all 56 key-bearing preview deploys**, every id per PR, so no alias
can fall back onto a surviving key-holder. Order of urgency:

1. **Missing the cleanup-stale-jobs fix** (42 deploys: PRs #29–#44 and the four
   unresolvable): each is an unauthenticated destructive URL with the production key.
2. **Missing the recipient fix but carrying the cleanup fix** (2): body-chosen mail recipient.
3. **Carrying both fixes** (12): no known defect, but a live service-role writer set on a permalink
   nobody needs; the plan's retirement rule applies to the class, not the defect.

**The approved list (2026-09-23, Ryan): all 56 key-bearing previews.**
Tier 1 = missing the cleanup-stale-jobs fix (42), tier 2 = missing only the
recipient fix (2), tier 3 = carrying both (12). This block is the ONLY source
`scripts/manual/delete-preview-deploys.mjs` reads ids from; an id not in it
cannot be deleted by the script. Changing it is a reviewed commit.

<!-- DELETE-LIST:BEGIN — machine-read by scripts/manual/delete-preview-deploys.mjs; one row per deploy: id | PR | commit | tier -->
```delete-list
6a5fb25be785700008594817 | 29 | fdc31c3066ab | 1
6a601121c7f43600080ace91 | 30 | bef94cc16a5f | 1
6a609d9b6e2b010008e4701d | 31 | 5fe358c2fbe2 | 1
6a60df7c72b06b00095706c9 | 31 | c5f9a91ea909 | 1
6a612672813cd600081bb9bb | 32 | 6535717fd878 | 1
6a615ce014582d00082b8fc9 | 33 | fdf63aedb99a | 1
6a6670dd935a640009132e26 | 34 | b1f51871fad6 | 1
6a694837be66d2000814c691 | 35 | 2ee6f0bbc52e | 1
6a6951343b4b0100093a4aad | 35 | 65b87e322e48 | 1
6a69521ae77b8e0008cab8b9 | 35 | 0ef7a657b162 | 1
6a69535a83be0b0009bf8453 | 35 | 6507fd8e4147 | 1
6a6a147d13108b0008d28634 | 35 | b4b3852d13ea | 1
6a6a55bd4aa3d200086629b6 | 36 | f9765696e77d | 1
6a6a55d651b30500085a2ad5 | 37 | 8205d226ba05 | 1
6a6a99aa7965770008feab95 | 37 | 6e45bd7912d1 | 1
6aa2ba6c4723f800096e2b82 | 37 | 748f45aec40a | 1
6aa05237dde06400074428ac | 38 | 3fe3ce3d125a | 1
6aa184fc3061e80007eb907d | 39 | 288d184a7e08 | 1
6aa1873eee13c70008d2aba7 | 39 | 88438578ddb5 | 1
6aa18ebcc0615a000840cdef | 40 | f4e4509f3e0a | 1
6aa1efb8817b7c0008ef56df | 41 | f5cf2302a735 | 1
6aa2b806bd19220008cd2350 | 41 | 92df7d9ad441 | 1
6aa2ba87034ae30009eb7e5b | 42 | 69d4bfb26610 | 1
6aa2d85fe22b1f000826f8a5 | 43 | 6d8a405e1044 | 1
6aa31186185cb4000850775a | 43 | 83294a28ca91 | 1
6aa418133948e70008fb1e40 | 43 | 62a943233bd9 | 1
6aa41eb8cae4590008947e65 | 43 | 1905b88c83a0 | 1
6aa41f5b5b99fc0009345539 | 43 | 1ce78491a47c | 1
6aa42b3c60fee800089edb4c | 44 | 81d33dabfe98 | 1
6aa4897e6cc424000833a95b | 44 | 2cae8bd9cd9d | 1
6aa48b888b63af0008c2be72 | 44 | 57d69f928f06 | 1
6aa49a680044aa000871e75a | 44 | 406933676717 | 1
6aa49f8e89ac8a00081a2f44 | 44 | 88ec2c70aa18 | 1
6aa4a1c3122c5c0007ba84c6 | 44 | 68ea008f61fc | 1
6aa4a6e773d1830009f60e59 | 44 | 6c3c1470c0df | 1
6aa5503a9922850008784086 | 44 | 9051c0e23ba5 | 1
6aa55539a321d0000894f9b6 | 44 | f90a2639ef83 | 1
6aa555a46d1d0c0008be7650 | 44 | 02636ea8f992 | 1
6aa5594dff6f6f00086665c0 | 44 | 95a0b8c9b0c4 | 1
6aa5845cb3e9800008232379 | 44 | 85502dec479d | 1
6aa587d57345c3000893fea4 | 44 | b2ac88a27608 | 1
6aa588e86320810008f82544 | 44 | 10b6e04f5177 | 1
6aa58d3cc9d46f000897cae2 | 44 | 9c99bbfaeaeb | 2
6aa5bf17ff6f6f000874b0fa | 45 | 00f78e081187 | 2
6aa802021f0c9f00085e4466 | 45 | c61905368829 | 3
6aa80ed4ce8bfb00080b9b91 | 45 | 6eb57551eb0e | 3
6aa80f6f16ae3c0008f47628 | 45 | 0a9c61a15236 | 3
6aa8177f0933cc00077e5b76 | 45 | 3ac5b05c4adf | 3
6aa827595766b400089ca6ec | 45 | aea456ee3dc7 | 3
6aa8292e7fad050007292c3d | 45 | 34a69ec7e401 | 3
6aa94ce90ab9280008e1c5d3 | 45 | d0391f1c94cd | 3
6aa94db75638680009babccc | 45 | 2627687bf815 | 3
6aa963505b88680008939395 | 45 | e833e886891e | 3
6aa994ab65368c000995736a | 45 | 8e575986a9a2 | 3
6aad54ddafc4080008f11279 | 46 | cefda591556a | 3
6ab01d907071af0008909199 | 47 | 73abb2a3b9b9 | 3
```
<!-- DELETE-LIST:END -->

Not proposed: the 22 previews with no functions or a module-scope crash (no
writer exists), and #48's preview (no key). Deletion is one of the three
retirement mechanisms; after each deletion the permalink is probed and the
result recorded here per URL (§4.2 step 3). Deletion of a preview does not
touch production's published deploy or its database.

## Retirement record — deletion, verified independently (2026-09-24T14:49:26Z)

**Action:** Ryan ran `scripts/manual/delete-preview-deploys.mjs --apply` over all
56 listed deploys on 2026-09-24 (reported: 0 refused, script read-back 404 on
each, published deploy `6ab020c5` checked before every delete and untouched,
token revoked afterwards). **That report is not the evidence below.**

**Probe (this session, write-free):** `GET /` on each permalink — the site
root only, no function route — plus the public API record for each id. A
permalink is **verified retired** only when all three hold: HTTP 404, the body
is Netlify's own `Not Found - Request ID` page (not the app shell), and the
public API reports `state: "deleted"`. A never-existing deploy id on the same
site gives the same 404 (control). None of the 56 ids is in the site's deploy
list any more.

Note on the API: the unauthenticated `GET /api/v1/deploys/<id>` still answers
**200** for a deleted deploy, with `state: "deleted"`; the operator's
authenticated read-back saw 404. The two are consistent (a soft-deleted
record); `state` is what is recorded here.

**Result: 56 of 56 permalinks verified retired.**

| deploy id | PR | tier | `GET /` | body | API `state` | verdict |
|---|---|---|---|---|---|---|
| `6a5fb25be785700008594817` | #29 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a601121c7f43600080ace91` | #30 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a609d9b6e2b010008e4701d` | #31 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a60df7c72b06b00095706c9` | #31 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a612672813cd600081bb9bb` | #32 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a615ce014582d00082b8fc9` | #33 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6670dd935a640009132e26` | #34 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a694837be66d2000814c691` | #35 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6951343b4b0100093a4aad` | #35 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a69521ae77b8e0008cab8b9` | #35 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a69535a83be0b0009bf8453` | #35 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6a147d13108b0008d28634` | #35 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6a55bd4aa3d200086629b6` | #36 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6a55d651b30500085a2ad5` | #37 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6a6a99aa7965770008feab95` | #37 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa2ba6c4723f800096e2b82` | #37 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa05237dde06400074428ac` | #38 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa184fc3061e80007eb907d` | #39 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa1873eee13c70008d2aba7` | #39 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa18ebcc0615a000840cdef` | #40 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa1efb8817b7c0008ef56df` | #41 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa2b806bd19220008cd2350` | #41 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa2ba87034ae30009eb7e5b` | #42 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa2d85fe22b1f000826f8a5` | #43 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa31186185cb4000850775a` | #43 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa418133948e70008fb1e40` | #43 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa41eb8cae4590008947e65` | #43 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa41f5b5b99fc0009345539` | #43 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa42b3c60fee800089edb4c` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa4897e6cc424000833a95b` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa48b888b63af0008c2be72` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa49a680044aa000871e75a` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa49f8e89ac8a00081a2f44` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa4a1c3122c5c0007ba84c6` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa4a6e773d1830009f60e59` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa5503a9922850008784086` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa55539a321d0000894f9b6` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa555a46d1d0c0008be7650` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa5594dff6f6f00086665c0` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa5845cb3e9800008232379` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa587d57345c3000893fea4` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa588e86320810008f82544` | #44 | 1 | 404 | netlify-not-found | deleted | **retired** |
| `6aa58d3cc9d46f000897cae2` | #44 | 2 | 404 | netlify-not-found | deleted | **retired** |
| `6aa5bf17ff6f6f000874b0fa` | #45 | 2 | 404 | netlify-not-found | deleted | **retired** |
| `6aa802021f0c9f00085e4466` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa80ed4ce8bfb00080b9b91` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa80f6f16ae3c0008f47628` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa8177f0933cc00077e5b76` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa827595766b400089ca6ec` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa8292e7fad050007292c3d` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa94ce90ab9280008e1c5d3` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa94db75638680009babccc` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa963505b88680008939395` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aa994ab65368c000995736a` | #45 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6aad54ddafc4080008f11279` | #46 | 3 | 404 | netlify-not-found | deleted | **retired** |
| `6ab01d907071af0008909199` | #47 | 3 | 404 | netlify-not-found | deleted | **retired** |

**PR aliases.** An alias `deploy-preview-N--printcalculator2.netlify.app` falls
back to an older deploy of its PR if any survived, so each was probed too:
**19 of 19 aliases (#29–#47) answer Netlify's 404** — no surviving
deploy of any of those PRs serves. (The two errored builds, #43 `6aa31078` and
#47 `6ab01833`, were never on the list; they had no functions and serve nothing.)

| alias | `GET /` | body |
|---|---|---|
| `deploy-preview-29` | 404 | netlify-not-found |
| `deploy-preview-30` | 404 | netlify-not-found |
| `deploy-preview-31` | 404 | netlify-not-found |
| `deploy-preview-32` | 404 | netlify-not-found |
| `deploy-preview-33` | 404 | netlify-not-found |
| `deploy-preview-34` | 404 | netlify-not-found |
| `deploy-preview-35` | 404 | netlify-not-found |
| `deploy-preview-36` | 404 | netlify-not-found |
| `deploy-preview-37` | 404 | netlify-not-found |
| `deploy-preview-38` | 404 | netlify-not-found |
| `deploy-preview-39` | 404 | netlify-not-found |
| `deploy-preview-40` | 404 | netlify-not-found |
| `deploy-preview-41` | 404 | netlify-not-found |
| `deploy-preview-42` | 404 | netlify-not-found |
| `deploy-preview-43` | 404 | netlify-not-found |
| `deploy-preview-44` | 404 | netlify-not-found |
| `deploy-preview-45` | 404 | netlify-not-found |
| `deploy-preview-46` | 404 | netlify-not-found |
| `deploy-preview-47` | 404 | netlify-not-found |

**Controls — must still answer normally:**

| URL | `GET /` | body |
|---|---|---|
| production — `printcalculator2.netlify.app` | 200 | APP SHELL |
| production published permalink — `6ab020c50a788b0008d430c9--printcalculator2.netlify.app` | 200 | APP SHELL |
| #48 alias — `deploy-preview-48--printcalculator2.netlify.app` | 200 | APP SHELL |
| #48 b294791 — `6ab3efa301777b0008a746f1--printcalculator2.netlify.app` | 200 | APP SHELL |
| #48 47551b4 — `6ab3f40c055a620008aec356--printcalculator2.netlify.app` | 200 | APP SHELL |
| #48 fcb5da6 — `6ab40e674e6ec500087de9bc--printcalculator2.netlify.app` | 200 | APP SHELL |
| #48 8821573 — `6ab40f88d8322c00084cf8d9--printcalculator2.netlify.app` | 200 | APP SHELL |

The published production deploy is still `6ab020c50a788b0008d430c9`
(re-read from the API after the probes).

The key-bearing-preview class on the production site is **closed**: every
member is deleted and verified. What remains of the "older deployments" class
is historical PRODUCTION permalinks (`<deploy-id>--printcalculator2.netlify.app`
for past production deploys), which were never previews and are outside both
the key scoping and this list — plan §4.2 step 3's credential rotation is the
only control that reaches those.

## Staging site `printcalculator2-staging`

**Update 2026-09-24:** after branch deploys were enabled, the push of `513b622` built branch deploy `6ab53d545ba8250008cd98c1` and PR #48 preview `6ab53d569ac3b20008d444e8` on the staging site; both hold the STAGING key by design and refuse Release 2 by context (0b-staging, probe doc). History of the earlier attempts: no **branch deploy** of `security/release-2-stage-0` was built at first: pushes at 17:37:42Z (`fcb5da6`) and 17:42:29Z (`8821573`) each rebuilt PR #48's production-site preview within seconds and the staging site's own production branch, but produced no staging branch deploy (polled to 17:48:45Z) — the staging site is not building that branch. No deploy preview was built for PR #48 either (polled 15:16–15:40Z; the site's only
previews ever are PR #45's, 2026-09-14/15). **Recorded as missing.** The
staging-preview half of 0b — `deploy-context` reporting `deploy-preview` under
the staging site name, and `csrf-bootstrap` 404 with and without an Origin
header as the context-denial evidence unmasked by any ref refusal — is
therefore **not yet observed**. The old #45 artefact was not probed as a
substitute: it predates stage 0 and its endpoints answer 401 (live), which is
the F2 hazard, not evidence against it.

Staging's production-context deploys (the plain URL) are not in scope here:
they carry the staging key by design and are refreshed on every push.
