# Tetris Trainer

This finesse trainer supports 40L, configurable solo modes and replay fault practice.

------

**FUNCTIONS TL;DR:**

1. Finesse practice mode;
2. Finesse auto detection and rollback mechanism;
3. Supports tetrio recording import.

------

> *Allllright! That's it for HackerRouter, now it's GPT-6 Astra's turn!*


# 40 Lines Trainer

Run `npm install`, then `npm run dev`. Open http://127.0.0.1:5173.

## Game modes and live finesse switch

Choose 40L Sprint or Custom / Zen on the main page. During a running game, selecting another mode prepares the next start; the current game's label and rules stay visible until then. Custom rules opens the custom session editor. Save and start saves the rules locally and starts a session with the configured countdown. Cancel resumes the previous session when appropriate.

Perfect finesse is a switch on the main page, outside Settings. It applies immediately, including partway through a piece, and is saved separately for Sprint, Custom and fault practice. Sprint and fault practice default to on; Custom defaults to off. Turning it off removes a pending finesse retry outline and allows extra inputs without rollback. Turning it back on keeps the current piece's input history. Replays include `finesse-setting` events. Fault practice still requires each scene's target when checking is off, but accepts inefficient routes to that target.

Custom provides Zen / free play, 40-line challenge, downstack and two-minute presets. It defaults to endless play with no gravity, manual locking, unlimited hold, undo and automatic board clearing on top out. Options include gravity, lock delay and reset limit, manual-only locking, hold, infinite hold, 180° rotation, 0–6 previews, eight randomizers, a fixed seed, starting garbage and hole messiness, and line / piece / time goals. Zero disables a goal; reaching any enabled goal ends the session. Handling, bindings, display and countdown are shared with Settings. Loading a preset preserves the mode's finesse preference.

Clear board preserves the queue, hold, piece / line totals and elapsed time, respawns the active piece, and resets the active combo and B2B chains. Manual clears can be undone with their timer and board state. Automatic top-out clears continue without resetting the clock; the alternative top-out rule ends the session. Finish session ends endless play and saves a result. Board-clear counts record actions, including ones later undone. Custom JSON recordings include mode rules and support fault practice, including sessions recorded with finesse off. Disabled 180° rotation is respected by the detector and imported practice hints.

The **Garbage clear / endless downstack** preset keeps ten garbage rows on the board and has no completion goal. After each accepted placement, missing garbage rows are added at the bottom; this is a cheese layer, not an incoming attack that can be canceled. Set **Advanced rules ? Garbage and solo pressure ? Garbage refill rows** to change the layer size or to 0 to disable it. Starting garbage and authored maps initialize the field; refill fills any shortfall. **Incoming interval** independently enables timed attack packets. Board clearing rebuilds the configured garbage layer. The game displays garbage rows cleared. Retry and undo restore the refill generator, board and timer; waiting for input cannot generate more rows. Fault practice reuses the saved board without replenishing it. This follows the archived client's `survivalmode: "layer"` / `UpdateCheeseLayer` design; it does not add its optional total-generation cap or minimum-layer variants. Reload the preset to apply the new endless defaults to an older saved custom configuration.

Custom separates mode definitions, board setup and completion conditions, informed by the [Jstris Usermode ruleset, map, queue and trigger design](https://github.com/jezevec10/jstris-guide/blob/master/usermode.md). It does not import Jstris files. Implemented building blocks and compatibility work are tracked in [TODO.md](TEMP/TODO.md).

## TETR.IO room presets

Choose **Custom / Zen → Custom rules → Load a preset → TETR.IO room presets · Solo**, then **Save and start**. The ten presets were extracted as literal configuration data from the supplied official client archive, captured on **2026-07-18**, client build `20260714T182728`. This is a reproducible archive snapshot, not a claim about today's live catalog. [src/room-presets.json](src/room-presets.json) records every original field, the client URL and SHA-256. The extraction script reads JavaScript as text and never executes it.

| Preset | Main solo rules |
| --- | --- |
| DEFAULT | SRS+, all-mini+ spins, B2B charging, increasing gravity |
| TETRA LEAGUE | Current archived season's spin, all clear, B2B and gravity settings |
| TETRA LEAGUE (SEASON 1) | T-spins, B2B chaining, ten-line all clear attack |
| ENFORCED DELAYS | SRS without 180°, 7f entry / 35f clear delay, ARR 2 / DAS 9 / SDF 10 |
| 4-WIDE | Empty **4 × 26** board, SRS-X, handheld spins, growing garbage cap |
| 100 BATTLE ROYALE | SRS without 180°, six previews, 6f / 25f delays, ARR 2 / DAS 12 / SDF 6 |
| CLASSIC | Classic randomizer, NRS, one preview, no Hold / ghost / hard drop / 180°, 5f lock |
| ARCADE | ARS, three previews, no ghost / 180°, 27f / 25f delays, 18f lock |
| BOMBS | 7+2 bag, bomb garbage and its native attack parameters |
| LEGACY QUICK PLAY | SRS+, T-spins, 0.05G initial gravity, B2B chaining |

These are single-player adaptations. Room matchmaking, opponents, team / target selection, badges and match rounds are not simulated. Battle Royale's delayed garbage entry stages and attack cap are retained in exports but not applied. Native recordings that require those stages are rejected. Incoming garbage is off by default for these presets except BOMBS: its solo adaptation adds six starting bomb rows and two incoming rows every five seconds. Both can be adjusted or disabled. Preset loading retains the Custom finesse switch; ordinary player bindings remain active even when a room enforces ARR / DAS / SDF.

The native **4-WIDE** preset is an empty four-column field. It is different from a ten-column board with walls and starting residue, such as the map generator in the public [TETR.IO Custom Presets script](https://greasyfork.org/en/scripts/447571-tetr-io-custom-presets/code). No extra walls or residue are silently added. Board maps can author a separate well drill.

Advanced rules expose 4–16 columns, 10–40 visible rows, eight engine rotation systems, spin / combo rules, B2B chaining / charging, all clear attack, bomb garbage, growing attack multipliers and garbage caps. The session display shows current gravity, attack, sent attack and pending garbage. The engine handles cancellation and insertion on lock. Timed solo pressure is independently configurable by first packet time, interval and row count; it is a training source, not an opponent AI.

Entry and line clear delays use 60 Hz frames. Line clear ARE replaces ordinary ARE. The next piece is hidden and hard drop is blocked during the delay; held movement charges DAS, and IRS / IHS follow the player's settings. Gravity progression, pressure schedules, garbage readiness, queue randomness, board, delay and timer are restored together by retry or undo. Pausing also pauses the pressure clock.

Authored maps use top-to-bottom rows: `IJLOSTZ` for colored tiles, `.` / `_` for empty, `#` for garbage and `*` for a bomb tile. Every row must match the configured width; leave at least two empty rows above the map. Bomb detonation requires Bomb garbage. A map overrides Starting garbage. Fixed sequences use `IJLOSTZ`, start with the active piece and can repeat indefinitely; otherwise the seeded randomizer follows the authored prefix. Hold and undo preserve the sequence position.

Import preset / Export preset uses `{ format: "tetrio-trainer-preset", version: 1, rules, source }`. Import validates the entire draft before applying it and does not start a game until Save and start. Export includes the original room preset fields and archive fingerprint where applicable. Trainer recordings also save that fingerprint, effective rules, runtime delay / pressure state and complete placement snapshots. These JSON formats are local trainer formats, not native TETR.IO room-file exports.

To refresh the catalog from another supported archive:

```powershell
npm run presets:import -- "D:\CODE_PROJECT\TETRIO_OFFLINE\offline-data\archive"
```

## Local TETR.IO audio and UI resources

Sound effects, Config / HUN / ProFont fonts, board and Hold / Next atlas frames, menu textures and mode icons were extracted from the supplied `TETRIO_OFFLINE` archive. The native mino and ghost atlases now drive block and shadow rendering. Background images and music are not loaded.

Movement, rotation, soft / hard drop, hold, locking, clears, spins, combos, B2B, all clear, countdown, retry failures, completion, pause, undo and menu clicks trigger local audio. Settings → Audio controls enablement, volume and menu sounds; Preview sound auditions the draft volume. Audio unlocks after a click or key press. Missing audio does not block play. Voices and repeated movement sounds are limited. Replay analysis is silent.

`public/tetrio/sound-pack.json` contains 49 selected effects in a roughly 1.4 MB resource pack: sprite timings plus a base64-encoded, 57-second Opus atlas. The browser fetches ordinary JSON and decodes the audio bytes in memory using Web Audio. It never requests a standalone audio URL, creates an audio Blob URL or uses a media element, avoiding IDM's interception of the former `.ogg` request. IDM and browser settings do not need to change. The extractor removes the obsolete standalone audio assets. `sources.json` records source URLs, archive timestamps and hashes. Extraction follows tRSD 1.0 as documented by [TETR.IO PLUS's public sound filter](https://gitlab.com/UniQMG/tetrio-plus/-/blob/master/source/filters/sfx/sfx-request-filter.js). Resources were also checked against [TETR.IO's personalization FAQ](https://tetrio.github.io/faq/personalization.html).

Extracted assets are already present. To refresh them, with FFmpeg on PATH, run:

```powershell
npm run assets:import -- "D:\CODE_PROJECT\TETRIO_OFFLINE\offline-data\archive"
```

The extractor only reads the archive and writes this project's assets. The running trainer needs no connection to TETR.IO or the offline launcher.

## Mechanics and compatibility

This is a standalone trainer using Triangle.js 4.2.7. Sprint uses a 10 × 20 board with 20 hidden rows, seven-bag, SRS+, hold, 180° rotation, gravity of 0.02 cells per frame, a 30-frame lock delay and 15 lock resets. Fresh handling defaults are ARR 0, DAS 6, DCD 0 and instant SDF. Importing a TTC applies the player's supported preferences. These are this trainer's explicit values, not a claim that every current TETR.IO factory default matches them.

Movement is intended to feel like TETR.IO, including countdown DAS precharge, but exact engine-version parity is not guaranteed. Finesse follows d-002, and automatic rollback / timer rewind is trainer behavior. Custom includes the archived room presets and free practice; it does not implement TETR.IO Zen progression, network battles, native scoreboards / replay export or full rendering parity. Native replay reconstruction checks available final statistics and board state and rejects incompatible recordings.

Settings supports ARR, DAS, DCD, SDF, DAS cancellation, safe lock, initial rotation and hold, physical key bindings, grid and ghost options. Timings use 60 Hz frames. ARR 0 is instant; SDF 41 is instant soft drop. Changes apply at the next game. Opening Settings pauses the current game; Cancel discards edits. Settings persist locally and can be imported or exported as JSON.

The default controls are arrow keys for movement, Up for clockwise rotation, Z for counterclockwise rotation, A for 180°, C for hold, Space for hard drop, Escape for pause, and R for restart. Click a key binding to capture a physical key. Duplicate assignments are rejected.

## TETR.IO config import

Click Import TETR.IO config, use Settings → Import JSON / TTC, or drop a `.ttc` file anywhere on the page. Import opens a settings draft and pauses the current game. Save settings applies it at the next start or restart; Cancel leaves the saved settings unchanged. Trainer settings JSON uses the same importer. Files are read locally, with a 1 MB limit.

The importer maps all nine handling fields: ARR, DAS, DCD, SDF, safe lock, DAS cancellation, prefer soft drop over movement (`may20g`), IRS and IHS. Custom, Guideline and WASD keyboard layouts are supported. Uppercase TETR.IO key codes are converted to physical browser key codes. Alternate keys and intentionally unbound actions are preserved; keys shared between different gameplay actions are rejected. Native Exit maps to Pause / resume, and Retry maps to Restart. Clicking a binding replaces its entire key list; Clear selected binding removes it. Ctrl + Z is reserved for undo only while undo is enabled.

Supported display mappings are grid opacity, board opacity, ghost opacity, colored ghost and dimming the locked Hold piece. Zero ghost or grid opacity disables that display layer. Native numeric strings are accepted for opacity and handling values. Training preferences are preserved because TETR.IO's pro-mode and restart options do not describe the trainer's retry behavior.

Import details distinguish mapped fields from retained-only fields. `volume.sfx` and `volume.disable` control sound volume and mute. Other audio options, gamepad controls, advanced rendering and animation, native game modes, desktop integration, notifications and social options are retained without being activated. Unsupported keyboard codes are reported and preserved in the original config. Unknown future fields are also retained. Settings export includes the original config under `tetrioConfig`; this is a trainer JSON export, not a rewritten native `.ttc` file.

`src/tetrio-config.ts` provides the extension points. `readTetrioSection(settings, 'volume')` returns an isolated copy of the original section, or `null` when absent. `readTetrioOption(settings, 'video.particles')` reads an individual original value, or `null`. `tetrioConfigAdapters` registers the active field adapters; future features can add an adapter and validation when their runtime behavior exists. Reading a retained field does not activate it or fetch any URLs it contains. These readers return the imported source values, while the ordinary settings fields contain subsequent edits.

The visual layout places Hold at the board's upper left, Pieces / Lines / Time at the lower left, and the next five pieces on the right. Time is displayed as `0:00.000`. The layout follows the supplied TETR.IO screenshot; the existing block colors and textures remain in use.

Target outlines are gray. Cells shared with a visible ghost use a darker version of that ghost's outline color at the selected ghost opacity. The renderer draws the shared outline once, so overlapping layers cannot brighten it. Disabling the ghost restores the plain gray target outline.

## Training settings

Start and restart use a three-second countdown. Settings → Training → Start countdown accepts 0–10 seconds in 0.1-second steps; zero starts immediately. The timer and board do not advance during the countdown. Holding left or right precharges DAS; when the game begins, a fully charged direction immediately uses ARR, including an instant wall shift at ARR 0. A late hold retains its partial charge and waits only the remaining DAS after the initial move. A direction already held when restarting remains held, including alternate bindings. Releasing the key cancels that direction's charge. Direction switching follows the engine's DAS cancellation setting. Pause, focus loss and opening Settings pause the countdown and clear the held-input buffer. Hard drop, soft drop, rotation and Hold presses during the countdown are not buffered into the first piece.

Each direction carried into play counts once toward input and finesse statistics. Precharge does not advance the displayed or engine clock. Replays include a `das-precharge` event with the initial charge and carried inputs, alongside the complete placement snapshots.

- Perfect finesse: now on the main page, saved separately for each mode. Turning it off allows normal placements without finesse retries. Recorded placements can still be analyzed later for fault practice.
- Allow a different target after a fault: on by default. Turning it off requires the outlined destination before continuing. Hold is temporarily blocked while a target is required so the piece cannot be replaced with an incompatible shape.
- Allow undo with Ctrl + Z: off by default. Ctrl + Z or the Undo placement button restores the previous piece, board, queue, hold, accepted-placement statistics and timer. Repeated undo is supported.
- Allow unlimited hold: off by default. When enabled, the piece and hold slot can be swapped repeatedly before lock.
- Fault practice: clear all scenes in one attempt: off by default. A finesse fault restarts the entire practice set when enabled.

Training preferences persist and support settings import / export. Older settings files receive the new defaults while retaining their existing handling and bindings. The page's finesse switch applies immediately; other training changes apply on the next start or restart.

The engine is Triangle.js 4.2.7, imported through `@haelp/teto/engine`. The renderer uses its absolute block coordinates and piece previews. Keyboard down and up events go through its frame input interface so DAS, ARR and SDF use engine timing rather than browser key repeat.

Finesse uses the placement table and input-count rule from [d-002/finesse](https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js), pinned to revision `e223b32`. Each movement key press or rotation, including 180°, costs one input. DAS repeats do not add inputs. Hard drop, soft drop and hold are excluded from the finesse count. The physical occupied cells determine the target, so equivalent I/S/Z/O orientations share a placement. Any sequence within the reference input budget is accepted; inherited DAS or initial rotation may use fewer fresh presses. A successful hold starts a new piece's input count.

Hints use the upstream sequence when it reaches the target on a ten-column SRS / SRS+ board. Missing entries, incorrect upstream I-piece hints, other board widths and alternate rotation systems use a search with the active engine's kicks and the same input costs. Direct hard-drop routes are checked first, even if lowering the piece would permit fewer movement inputs. Only when no direct route reaches the target does the search allow soft drop for tucks and spins. Instant SDF hints lower to the current surface and release; finite SDF also allows partial descents. A mode that disables hard drop instead ends its guide with soft drop and automatic locking. Initial rotations are evaluated from the actual spawn state. Every suggested route is checked against the board before the placement and before line clears.

A rejected placement restores the piece, board, hold, bag and displayed timer to the current piece's checkpoint. Fault and attempt history remain recorded. The outline is advisory by default, and can be made mandatory in Settings. Replays record the rule revision, actual piece inputs, input count, route, complete scene snapshots and whether soft drop was required. The replay frame timeline stays monotonic; retry and undo events include the restored timer value. `result.timeMs` is the displayed time, and `result.sessionTimeMs` includes discarded attempts. This extends d-002's empty-board drills to 40L stacks; it is not a claim of exact TETR.IO finesse parity. Placements outside the supported movement search are recorded as unverified rather than perfect.

After a finesse retry, a target-mismatch retry or Undo, the restored timer and game simulation wait for a fresh allowed game-key press. Movement, rotation, drop or available Hold resumes timing and executes that same input once. Waiting freezes gravity, lock timers, entry delay and incoming garbage; the guide still animates and can be replayed. Key releases, held-key browser repeats, unbound keys, blocked controls, menu clicks and guide playback do not resume timing. Opening and closing Settings preserves the wait. This applies to Sprint, Custom / room presets and fault practice, including strict practice resets. Normal starts retain their configured countdown. The pause/update separation follows [Tetr.js's game loop](https://github.com/simonlc/tetr.js/blob/master/tetris.js); waiting after rollback is a trainer extension.

The page shows `Timer paused. Press a game key to continue.` while waiting. Recordings include `waitingForInput` in runtime and retry / undo data and an `input-resume` event naming the key and restored time. Neither the displayed timer nor the engine's session frame clock advances during this review period.

Download replay exports settings, mode rules, seed, input events, retry snapshots, placements and statistics as training JSON. This JSON preserves the complete training history. The separate TETR.IO export button produces a native event envelope for compatible sessions, as described below. The app uses the bundled local UI and sound resources described above.

## Fault practice

After a game, click Practice last replay to load its mistakes. Load replay file accepts trainer JSON, TETR.IO solo `.ttr`, and multiplayer `.ttrm`. Multiplayer files expose a Player / round selector. Each scene restores the board immediately before a faulty placement and outlines its destination. Practice requires its target and checks finesse by default. Its page switch can allow inefficient routes without changing Sprint or Custom preferences. Hold and undo are unavailable during these drills. Back to 40L returns to sprint mode.

A finesse fault opens an animated guide in every mode with Perfect finesse enabled: Sprint, Custom / room presets and fault practice. It automatically loops the correct route at a slower pace, with a pause at the completed placement. Click the guide to replay it or close it with ×; a new fault opens a fresh guide. The compact guide sits in the side panel so it cannot cover controls or downloads. Turning finesse off dismisses it. In fault practice, the one-attempt setting also resets progress and practice time to scene one. Otherwise it retries the current scene. Older trainer replays can recover scenes from their retry snapshots.

The guide also keeps the complete numbered route visible before, during and after playback. Each step names the current key bindings, explains taps versus holds and when to release, and finishes with hard drop when enabled or automatic locking otherwise. Consecutive partial soft drops are grouped by row count. The current animation step is highlighted and completed steps are marked. The normal retry coach shares the same instructions. Demo and practice boards use the recorded custom dimensions and rotation system; practice disables the original session's goals and timed garbage source.

Native import rebuilds the recorded input timeline and reevaluates placements using this trainer's finesse rules. It accepts the engine's supported randomizers and rotation systems on 4–16-column, 10–40-row boards, including legacy and current multiplayer envelopes, bombs, room handling and entry / line clear delays. Existing real fixtures verify standard 10 × 20 SRS / SRS+ native recordings; trainer recordings verify the added custom dimensions. Acceptance of a mode configuration is not a guarantee of parity with every native client version. Legacy garbage events retain their recorded hole columns. Available final placement counts, line counts and board state are checked against the simulation before import succeeds. Unsupported modes, delayed Battle Royale garbage, incompatible game versions or mismatched recordings report an error rather than importing misleading scenes. Files are analyzed locally; maximum file size is 20 MB and maximum native recording duration is one hour.

## Validation

`npm run build` checks TypeScript and produces the production bundle. `npm test` checks all 162 empty-board placements, finesse, input timing, timer rollback, countdown, target enforcement, undo, unlimited hold, practice resets, replay validation and real native replay fixtures. `npm run test:browser` checks settings, layout, keyboard input, countdown, animation playback and replay import in Chromium. Install its browser once with `npx playwright install chromium` if needed.

Config tests also cover the supplied `.ttc`, settings migration, retained-field round trips, presets, alternate keys, invalid-file recovery, file-picker and drop imports, complete guidance, and canvas pixels for overlapping target and ghost outlines.

Custom tests cover all randomizers, deterministic garbage and seeds, manual and automatic locking, hold / rotation restrictions, every goal type, automatic and manual board clears, undo, live finesse changes and Custom replay practice. Browser checks cover per-mode switches, custom editor validation and persistence, native font / texture loading, real audio-sprite playback, mute and mobile layout.

Room tests compare all ten catalog entries with initialized engine rules and exercise 4-WIDE retries / replay practice, Classic automatic-lock guidance, entry-delay DAS / IRS, line-clear timing, garbage progression rollback, bomb detonation, authored queues across refills / Hold / undo, preset validation and import / export. Browser tests cover the preset selector, variable-size board layout, universal guide playback, replay import and narrow-screen editing. Audio regression tests block standalone media requests and verify an actual nonzero Web Audio signal after volume control.

## References used

- [Triangle.js engine and snapshots](https://github.com/halp1/triangle/tree/main/src/engine)
- [Official TETR.IO room mechanics reference](https://tetrio.github.io/faq/mechanics.html)
- [Archived official client preset data and provenance](src/room-presets.json)
- [Public TETR.IO Custom Presets script](https://greasyfork.org/en/scripts/447571-tetr-io-custom-presets/code)
- [Jstris authored maps, queues and triggers](https://github.com/jezevec10/jstris-guide/blob/master/usermode.md)
- [d-002 finesse table, input counting and hints](https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js)
- [Triangle.js input and handling types](https://github.com/halp1/triangle/blob/main/src/types/game.ts)
- [MinoMuncher lock analysis](https://github.com/MinoMuncher/minomuncher-core/blob/main/src/replayParser/lockResult.ts)
- [Finesse movement sequences](https://four.lol/mid-game/finesse/)
- [Core Block Mac 2 retry interaction](https://github.com/aktue/Core-Block-Mac-2)
- [Tetr.js panel layout and countdown state](https://github.com/simonlc/tetr.js/blob/master/tetris.js)
- [MinoMuncher replay event simulation and configuration](https://github.com/MinoMuncher/minomuncher-core/tree/main/src/replayParser)
- [Triangle.js replay engine tests](https://github.com/halp1/triangle/blob/main/test/engine/replay.ts)
- [Viewtris native formats, legacy garbage reconstruction and sample replays](https://github.com/zbrachinara/viewtris)
- [Four-tris independent scenario practice](https://github.com/fiorescarlatto/four-tris)
- [Alex Ong Finesse replay and undo approach](https://github.com/alex-ong/Finesse/blob/master/src/ReplayMaker.java)
- [Public native config example with multiple keyboard bindings](https://gist.github.com/chm-dev/cee7b27b65f77fe2c30eadbe7af8115f)
- [TETR.IO's published Guideline / WASD controls and handling labels](https://tetr.io/)
- [MDN file drag-and-drop example](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop)

Audio mappings were checked against the supplied client: soft-drop movement uses `softdrop`; piece locking uses `floor`, with `harddrop` added for a hard drop. `boardlock` belongs to the Zenith revival board effect and is not a piece-lock sound. Pausing and resuming use the menu click and respect the UI sound toggle.


## Just think

The main-page switch defaults to off. Its default style, **Think before each piece**, freezes the board and timer until a fresh game key, runs that piece normally, then freezes again after placement. **Run only while operating** advances on input events and while a game key is held; releasing all keys lets the player think. Both styles freeze gravity, lock delay and solo pressure together with the clock. Finesse retry waiting remains active independently of this switch. Settings and guide clicks do not resume a retry.

## Drill, statistics and replay pages

Navigation now includes **Play**, **Finesse drills**, **Statistics** and **Replays**. Moving away from Play pauses gameplay. Left-clicking a manually paused board resumes it; a finesse retry still waits for a fresh game key.

Pure finesse drills generate all 162 unique empty-board placements, with piece, leftmost-column and rotation filters, plus endless or finite sessions. The field resets after each successful target. Statistics can select specific frequent faults for an endless focused drill. New pure and focused sets start with Perfect finesse enabled, including when a previous practice session disabled it. The page switch can still disable it explicitly, and restarting that set retains the choice. Empty-board practice isolates the placement habit; **Use original boards** preserves stack-dependent tucks and spins. Mixed board dimensions or kick systems are rejected with an explanation.

Statistics persist sessions and recordings in IndexedDB, separately from the last-replay localStorage slot. They include average faults and excess inputs per session, perfect-attempt percentage, fault rankings, mode / completion filters and session playback. Repeated retries count separately; unchecked placements are evaluated when saved. Pure and fault practice are included. History is periodically saved during play and when changing sessions or pages. Backups export full recordings; backup imports validate the complete batch before one database transaction. Session IDs prevent duplicate entries. Deletion asks for confirmation and does not immediately recreate the active recording through autosave.

The replay page accepts trainer JSON and native `.ttr` / `.ttrm`, via file picker or drag and drop. It supports player / round selection, play / pause, 0.25x to 4x speed, seeking, frame stepping, and Hold / Next display. It reconstructs recorded engine frames, including trainer rollback markers. Thinking time and manual pauses are omitted from the playback timeline. Native playback shares the validated importer and its mode compatibility limits.

## Native replay export

**Export TETR.IO replay (.ttr)** creates a local, unverified format-version-1 file with `users`, `gamemode`, `replay.options`, `replay.events` and `replay.results`. Initial boards use the native map format. Retried and undone branches are removed. Export runs the generated file through local replay simulation and checks piece count, line count and final tiles before downloading. This is not TETR.IO server verification or a leaderboard submission. The trainer does not track native score; the required result score field is currently zero.

Native export currently covers ordinary Sprint and Custom sessions, including initial maps without bomb tiles. Scene practice, authored queues, timed solo packets, refill / board clearing and countdown DAS precharge report an explicit compatibility message. Use trainer JSON for the exact complete recording of those features. `npm run test:native` checks exported Sprint / Hold, retry / undo, and 4-column map / line-clear cases against the supplied official client's loader and headless game engine. It verifies final pieces, lines and board tiles. This requires the local archive; it does not contact TETR.IO or reuse a browser profile. Compatibility with other client versions remains to be checked. Investigation notes are in [REPLAY-COMPATIBILITY.md](TEMP/REPLAY-COMPATIBILITY.md).

## Materials and effects

The original TETR.IO mino atlas and ghost atlas are now used for active pieces, the stack, Hold, Next and ghost outlines. Atlas coordinates and piece colors follow the archived client's simple-skin loader. Ghosts are tinted using its original white outline texture. Targets remain gray, with darker ghost-colored overlaps. Lock flashes, hard-drop beams and line-clear flashes approximate the native presentation in Canvas; they are not a complete port of the original particle renderer. Motion effects respect the browser's reduced-motion preference. Retry uses a 0.22-second excerpt of the native finesse-fault sound with a short fade; loading still uses the IDM-resistant JSON sound pack.

AI helper candidates and implementation order are documented in [AI-TRAINING-RESEARCH.md](TEMP/AI-TRAINING-RESEARCH.md). Stricter finesse metrics are no longer planned. No strategic AI is activated yet. Research and temporary documents belong in `TEMP/`.
