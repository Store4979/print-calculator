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

## Production-context deploys — classification and proposed deletion (2026-09-24T15:25:07Z)

Every deploy on the production site with context `production`, all states
(71: 62 ready, 9 errored). These were never previews, so the
Deploy Previews key scoping never reached them: each ready one carries the
environment of the production context at its build.

**Method.** Ancestry only, as for the previews: cleanup-stale-jobs fix
`9c99bbf` / `7f89876`, PR #43 recipient fix `1ce7849` / `10235f2`, by
`git merge-base --is-ancestor`. **Nothing was called** that deletes or sends —
no `cleanup-stale-jobs`, no `send-print-job`. Key presence by the same
write-free probe (`POST {}` to `start-upload`); every historical version of
that handler (three blobs, 06-29 to today) returns `400 fileName required`
before any storage call, and `createClient` makes no request, so the probe
touches no database or storage on any bundle. The response wording is
classified precisely: the key guard runs FIRST, so `Supabase URL not
configured` and a Node-20 client-init failure both mean **the key is present**
in that bundle even though no working client can be built today.

**Kept (4), and why.** The published deploy `6ab020c50a788b0008d430c9`, re-read from the API, and
the three most recent ready deploys carrying both fixes, as rollback targets.
All four hold the production key with live legacy writers; that exposure ends
only with credential rotation (stage 0 production half), after which a
rollback is a fresh build of the old commit, never a republish.

**Proposed for deletion: 28** — every non-kept deploy whose bundle holds
the key or whose key state is unknown (a 502 crash says nothing about the key;
unknown is not absent). All are tier 1 (missing the cleanup-stale-jobs fix).
**Not proposed: 39** deploys with no functions (static-only or errored builds): no
server-side writer exists in them. **Nothing deleted.**

<!-- PRODUCTION-KEEP:BEGIN — the script refuses every id here even if it is also listed for deletion; one row: id | commit | reason -->
```production-keep
6ab020c50a788b0008d430c9 | 7ec5af48666e | published
6aad56a391c0cf0008d215fd | 993772878de1 | rollback-target
6aa994d535444e0008272512 | 89de03e59b66 | rollback-target
6aa59114f573770008fb8dd5 | 7f898762a958 | rollback-target
```
<!-- PRODUCTION-KEEP:END -->

<!-- PRODUCTION-DELETE-LIST:BEGIN — machine-read by scripts/manual/delete-preview-deploys.mjs --list production; one row per deploy: id | commit | tier -->
```production-delete-list
6a42b7af51f12900086b01c0 | 425fbaa54cbb | 1
6a42ba25aaa964cde8bb6fd8 | 425fbaa54cbb | 1
6a42bb4f95e09b00c346c3fc | 425fbaa54cbb | 1
6a42c425aaebbd039d736cce | 425fbaa54cbb | 1
6a42cae0bf86150008cb36b4 | 8335021b28b4 | 1
6a42ccc4e91dd82d98ec8018 | 8335021b28b4 | 1
6a42d450ca36420008de3940 | ba0420c496eb | 1
6a455d9bcc330d0008b7fdb4 | 6a8cbf23bd72 | 1
6a5f98b2917ca300082af0fa | 978aa6b22002 | 1
6a5f9c98458e6b00080b7bdc | 0544ae25afc7 | 1
6a5fa0bee7857000085539af | 57a984e92a09 | 1
6a5fa2ce9815480008a94637 | faf88afd8826 | 1
6a5faa2868a64b000851bd97 | cacaafcabd2f | 1
6a5fb28ec14bc4000740a26b | 0246b385e0ff | 1
6a609aa8e4d2e80008e46bf1 | 2e1ae104610a | 1
6a60e3d1c0843b000897a8e8 | 6f2b84e1acbe | 1
6a615b2b14582d00082af10b | ed19f818ee04 | 1
6a63504d37f78c000852fe53 | 348f0b44974a | 1
6a68f0141e03f20008ee523b | 26a96fa32cf4 | 1
6a6a19c52a46b700086d87b9 | efc9437878a8 | 1
6aa0abcd0e533100082027aa | 5355b72aead1 | 1
6aa18b8254579d0008d97355 | 8671abea45ad | 1
6aa1d54707143100081a9628 | ccfbc536f9e3 | 1
6aa2b91d4d43680008e2b639 | 23d30e706745 | 1
6aa2ba97369bba0008edf3bc | 30a0aa666b89 | 1
6aa2bd5fde9af700082b6ffa | 61862a690e15 | 1
6aa428f787d412000849dbaf | 10235f21c881 | 1
6aa58ff7fa3838616077bdf7 | 10235f21c881 | 1
```
<!-- PRODUCTION-DELETE-LIST:END -->

<details><summary>All 71 production-context deploys (newest first)</summary>

| deploy id | commit | built (UTC) | state | cleanup fix | recipient fix | key (write-free probe) | disposition |
|---|---|---|---|---|---|---|---|
| `6ab020c50a788b0008d430c9` | `7ec5af48` | 2026-09-20T18:07 | ready | **yes** | **yes** | PRESENT, writer live | KEEP — the PUBLISHED deploy |
| `6aad56a391c0cf0008d215fd` | `99377287` | 2026-09-18T15:20 | ready | **yes** | **yes** | PRESENT, writer live | KEEP — rollback target (one of the three most recent ready deploys carrying both fixes) |
| `6aa994d535444e0008272512` | `89de03e5` | 2026-09-15T18:56 | ready | **yes** | **yes** | PRESENT, writer live | KEEP — rollback target (one of the three most recent ready deploys carrying both fixes) |
| `6aa59114f573770008fb8dd5` | `7f898762` | 2026-09-12T17:51 | ready | **yes** | **yes** | PRESENT, writer live | KEEP — rollback target (one of the three most recent ready deploys carrying both fixes) |
| `6aa58ff7fa3838616077bdf7` | `10235f21` | 2026-09-12T17:46 | ready | no | **yes** | PRESENT, writer live | **delete** (tier 1) |
| `6aa428f787d412000849dbaf` | `10235f21` | 2026-09-11T16:14 | ready | no | **yes** | PRESENT, writer live | **delete** (tier 1) |
| `6aa2bd5fde9af700082b6ffa` | `61862a69` | 2026-09-10T14:23 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6aa2ba97369bba0008edf3bc` | `30a0aa66` | 2026-09-10T14:11 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6aa2b91d4d43680008e2b639` | `23d30e70` | 2026-09-10T14:05 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6aa1d54707143100081a9628` | `ccfbc536` | 2026-09-09T21:53 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6aa18b8254579d0008d97355` | `8671abea` | 2026-09-09T16:38 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6aa0abcd0e533100082027aa` | `5355b72a` | 2026-09-09T00:43 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a6a19c52a46b700086d87b9` | `efc94378` | 2026-07-29T15:18 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a68f0141e03f20008ee523b` | `26a96fa3` | 2026-07-28T18:08 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a63504d37f78c000852fe53` | `348f0b44` | 2026-07-24T11:45 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a615b2b14582d00082af10b` | `ed19f818` | 2026-07-23T00:07 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a60e3d1c0843b000897a8e8` | `6f2b84e1` | 2026-07-22T15:37 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a609aa8e4d2e80008e46bf1` | `2e1ae104` | 2026-07-22T10:25 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a5fb28ec14bc4000740a26b` | `0246b385` | 2026-07-21T17:55 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a5faa2868a64b000851bd97` | `cacaafca` | 2026-07-21T17:19 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a5fa2ce9815480008a94637` | `faf88afd` | 2026-07-21T16:48 | ready | no | no | PRESENT, writer live | **delete** (tier 1) |
| `6a5fa0bee7857000085539af` | `57a984e9` | 2026-07-21T16:39 | ready | no | no | PRESENT (client init fails on Node 20) | **delete** (tier 1) |
| `6a5f9c98458e6b00080b7bdc` | `0544ae25` | 2026-07-21T16:21 | ready | no | no | PRESENT (client init fails on Node 20) | **delete** (tier 1) |
| `6a5f98b2917ca300082af0fa` | `978aa6b2` | 2026-07-21T16:05 | ready | no | no | PRESENT (client init fails on Node 20) | **delete** (tier 1) |
| `6a455d9bcc330d0008b7fdb4` | `6a8cbf23` | 2026-07-01T18:34 | ready | no | no | PRESENT (client init fails on Node 20) | **delete** (tier 1) |
| `6a42d450ca36420008de3940` | `ba0420c4` | 2026-06-29T20:23 | ready | no | no | PRESENT (client init fails on Node 20) | **delete** (tier 1) |
| `6a42ccc4e91dd82d98ec8018` | `8335021b` | 2026-06-29T19:51 | ready | no | no | UNKNOWN (502 crash: Node 20 WebSocket) | **delete** (tier 1) |
| `6a42cae0bf86150008cb36b4` | `8335021b` | 2026-06-29T19:43 | ready | no | no | PRESENT (URL absent; no working client) | **delete** (tier 1) |
| `6a42c425aaebbd039d736cce` | `425fbaa5` | 2026-06-29T19:14 | ready | no | no | UNKNOWN (502 crash: supabaseUrl is required) | **delete** (tier 1) |
| `6a42bb4f95e09b00c346c3fc` | `425fbaa5` | 2026-06-29T18:37 | ready | no | no | UNKNOWN (502 crash: supabaseUrl is required) | **delete** (tier 1) |
| `6a42ba25aaa964cde8bb6fd8` | `425fbaa5` | 2026-06-29T18:32 | ready | no | no | UNKNOWN (502 crash: supabaseUrl is required) | **delete** (tier 1) |
| `6a42b7af51f12900086b01c0` | `425fbaa5` | 2026-06-29T18:21 | ready | no | no | UNKNOWN (502 crash: supabaseUrl is required) | **delete** (tier 1) |
| `6a3186871b78390008bc6769` | `f5c1287b` | 2026-06-16T17:23 | ready | no | no | no functions | not proposed (no functions) |
| `6a185f5f4ea61b00089dbd24` | `8e94f58a` | 2026-05-28T15:29 | ready | no | no | no functions | not proposed (no functions) |
| `6a185e3a9454ad3908173c59` | `32e3311e` | 2026-05-28T15:24 | ready | no | no | no functions | not proposed (no functions) |
| `69fb76a1ed26cb0008cf35f6` | `17e3812c` | 2026-05-06T17:13 | ready | no | no | no functions | not proposed (no functions) |
| `69fa1be4edf1e30008441400` | `0c1179de` | 2026-05-05T16:33 | ready | no | no | no functions | not proposed (no functions) |
| `69fa0b4a68636e0008d4c737` | `1b352edc` | 2026-05-05T15:22 | ready | no | no | no functions | not proposed (no functions) |
| `69fa0ad99c9e0d00085e127e` | `6e499757` | 2026-05-05T15:20 | ready | no | no | no functions | not proposed (no functions) |
| `69f4c3e411d0ab0008f2bf06` | `99f96074` | 2026-05-01T15:16 | ready | no | no | no functions | not proposed (no functions) |
| `69f38269259b900008acf551` | `0683428d` | 2026-04-30T16:25 | ready | no | no | no functions | not proposed (no functions) |
| `69f3807a7b6dab0008ba11b0` | `c76c05a5` | 2026-04-30T16:16 | ready | no | no | no functions | not proposed (no functions) |
| `69f369ebdc0e0b0008f80a3c` | `d8c7ddd1` | 2026-04-30T14:40 | ready | no | no | no functions | not proposed (no functions) |
| `69f22d7881e2640008efa7d9` | `44725df8` | 2026-04-29T16:10 | ready | no | no | no functions | not proposed (no functions) |
| `69f22a441f1e470008c2035f` | `05c31f42` | 2026-04-29T15:56 | ready | no | no | no functions | not proposed (no functions) |
| `69f224adedf71d0008d9e594` | `646c5050` | 2026-04-29T15:33 | ready | no | no | no functions | not proposed (no functions) |
| `69f22000a432d10009e94ae1` | `83a388e5` | 2026-04-29T15:13 | ready | no | no | no functions | not proposed (no functions) |
| `69f14065910c4b0008582fab` | `bfab350b` | 2026-04-28T23:19 | ready | no | no | no functions | not proposed (no functions) |
| `69f11eb4e3abcc0008c5cbd0` | `780b63c0` | 2026-04-28T20:55 | ready | no | no | no functions | not proposed (no functions) |
| `69efa0b08ea1ab000890255c` | `235b4f6f` | 2026-04-27T17:45 | ready | no | no | no functions | not proposed (no functions) |
| `69ea36aeb2dda00008e70a72` | `daabfd80` | 2026-04-23T15:11 | ready | no | no | no functions | not proposed (no functions) |
| `69e6536d7b02de000824ae43` | `e33b9b27` | 2026-04-20T16:25 | ready | no | no | no functions | not proposed (no functions) |
| `69e6520f6159c30007ba6b36` | `f2baa5db` | 2026-04-20T16:19 | ready | no | no | no functions | not proposed (no functions) |
| `69e650e7e079d80009425b45` | `0e29ae53` | 2026-04-20T16:14 | ready | no | no | no functions | not proposed (no functions) |
| `69e64f040b7f8300089fa0bf` | `b017062e` | 2026-04-20T16:06 | ready | no | no | no functions | not proposed (no functions) |
| `69e64dfa39d3bb0008010262` | `578708f3` | 2026-04-20T16:02 | ready | no | no | no functions | not proposed (no functions) |
| `69e64c05c1c063000825700f` | `88f31d9f` | 2026-04-20T15:53 | ready | no | no | no functions | not proposed (no functions) |
| `69cab0a9cfbad00008128a4d` | `a2a8ed19` | 2026-03-30T17:19 | ready | no | no | no functions | not proposed (no functions) |
| `69caae5146f24d000830080b` | `ae703568` | 2026-03-30T17:09 | ready | no | no | no functions | not proposed (no functions) |
| `69c6c1671a9e6f000891e745` | `87812bc8` | 2026-03-27T17:41 | ready | no | no | no functions | not proposed (no functions) |
| `69c6b4d439268d0008bc94b7` | `a08643d9` | 2026-03-27T16:48 | ready | no | no | no functions | not proposed (no functions) |
| `69c6b480e4663f0007358bb6` | `dae35957` | 2026-03-27T16:46 | ready | no | no | no functions | not proposed (no functions) |
| `69c573c01a6eb9152a1e0e05` | `8b2161af` | 2026-03-26T17:58 | error | no | no | no functions | not proposed (no functions) |
| `69c5734f1e03310008689787` | `8b2161af` | 2026-03-26T17:56 | error | no | no | no functions | not proposed (no functions) |
| `69c569ee8754e500090821b7` | `5e321192` | 2026-03-26T17:16 | error | no | no | no functions | not proposed (no functions) |
| `69c569d84bf26d00081f4a2f` | `04944ff7` | 2026-03-26T17:16 | error | no | no | no functions | not proposed (no functions) |
| `69c56530b3100d1602a74815` | `7aba99f9` | 2026-03-26T16:56 | error | no | no | no functions | not proposed (no functions) |
| `69c5627ff2336c0aa76e1c82` | `7aba99f9` | 2026-03-26T16:44 | error | no | no | no functions | not proposed (no functions) |
| `69c561f0fc880f0009e2689c` | `7aba99f9` | 2026-03-26T16:42 | error | no | no | no functions | not proposed (no functions) |
| `69c561d114d0b10008682845` | `100874de` | 2026-03-26T16:41 | error | no | no | no functions | not proposed (no functions) |
| `69c41cd74c2bc80007f8564c` | `ec0db90e` | 2026-03-25T17:35 | error | no | no | no functions | not proposed (no functions) |

</details>

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
