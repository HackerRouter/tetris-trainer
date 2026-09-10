# Tetris Trainer

Unfortunately i only play 40L rn.
so this finesse trainer only supports 40L mode.

but yes, I'll consider to ask astra to add a blank mode with adjustable settings, like the zen mode in tetrio.

------

**FUNCTIONS TL;DR:**

1. Finesse practice mode;
2. Finesse auto detection and rollback mechanism;
3. Supports tetrio recording import.

------

> *Allllright! That's it for HackerRouter, now it's GPT-6 Astra's turn!*


# 40 Lines Trainer

Run `npm install`, then `npm run dev`. Open http://127.0.0.1:5173.

Settings supports ARR, DAS, DCD, SDF, DAS cancellation, safe lock, initial rotation and hold, physical key bindings, grid and ghost options. Timings use 60 Hz frames. ARR 0 is instant; SDF 41 is instant soft drop. Changes apply at the next game. Opening Settings pauses the current game; Cancel discards edits. Settings persist locally and can be imported or exported as JSON.

The default controls are arrow keys for movement, Up for clockwise rotation, Z for counterclockwise rotation, A for 180°, C for hold, Space for hard drop, Escape for pause, and R for restart. Click a key binding to capture a physical key. Duplicate assignments are rejected.

## TETR.IO config import

Click Import TETR.IO config, use Settings → Import JSON / TTC, or drop a `.ttc` file anywhere on the page. Import opens a settings draft and pauses the current game. Save settings applies it at the next start or restart; Cancel leaves the saved settings unchanged. Trainer settings JSON uses the same importer. Files are read locally, with a 1 MB limit.

The importer maps all nine handling fields: ARR, DAS, DCD, SDF, safe lock, DAS cancellation, prefer soft drop over movement (`may20g`), IRS and IHS. Custom, Guideline and WASD keyboard layouts are supported. Uppercase TETR.IO key codes are converted to physical browser key codes. Alternate keys and intentionally unbound actions are preserved; keys shared between different gameplay actions are rejected. Native Exit maps to Pause / resume, and Retry maps to Restart. Clicking a binding replaces its entire key list; Clear selected binding removes it. Ctrl + Z is reserved for undo only while undo is enabled.

Supported display mappings are grid opacity, board opacity, ghost opacity, colored ghost and dimming the locked Hold piece. Zero ghost or grid opacity disables that display layer. Native numeric strings are accepted for opacity and handling values. Training preferences are preserved because TETR.IO's pro-mode and restart options do not describe the trainer's retry behavior.

Import details distinguish mapped fields from retained-only fields. Audio, gamepad controls, advanced rendering and animation, native game modes, desktop integration, notifications and social options are retained without being activated. Unsupported keyboard codes are reported and preserved in the original config. Unknown future fields are also retained. Settings export includes the original config under `tetrioConfig`; this is a trainer JSON export, not a rewritten native `.ttc` file.

`src/tetrio-config.ts` provides the extension points. `readTetrioSection(settings, 'volume')` returns an isolated copy of the original section, or `null` when absent. `readTetrioOption(settings, 'video.particles')` reads an individual original value, or `null`. `tetrioConfigAdapters` registers the active field adapters; future features can add an adapter and validation when their runtime behavior exists. Reading a retained field does not activate it or fetch any URLs it contains. These readers return the imported source values, while the ordinary settings fields contain subsequent edits.

The visual layout places Hold at the board's upper left, Pieces / Lines / Time at the lower left, and the next five pieces on the right. Time is displayed as `0:00.000`. The layout follows the supplied TETR.IO screenshot; the existing block colors and textures remain in use.

Target outlines are gray. Cells shared with a visible ghost use a darker version of that ghost's outline color at the selected ghost opacity. The renderer draws the shared outline once, so overlapping layers cannot brighten it. Disabling the ghost restores the plain gray target outline.

## Training settings

Start and restart use a three-second countdown. Settings → Training → Start countdown accepts 0–10 seconds in 0.1-second steps; zero starts immediately. The timer and board do not advance during the countdown. Holding left or right precharges DAS; when the game begins, a fully charged direction immediately uses ARR, including an instant wall shift at ARR 0. A late hold retains its partial charge and waits only the remaining DAS after the initial move. A direction already held when restarting remains held, including alternate bindings. Releasing the key cancels that direction's charge. Direction switching follows the engine's DAS cancellation setting. Pause, focus loss and opening Settings pause the countdown and clear the held-input buffer. Hard drop, soft drop, rotation and Hold presses during the countdown are not buffered into the first piece.

Each direction carried into play counts once toward input and finesse statistics. Precharge does not advance the displayed or engine clock. Replays include a `das-precharge` event with the initial charge and carried inputs, alongside the complete placement snapshots.

- Enable finesse detection: on by default. Turning it off allows normal 40L play. Its recorded placements can still be analyzed later for fault practice.
- Allow a different target after a fault: on by default. Turning it off requires the outlined destination before continuing. Hold is temporarily blocked while a target is required so the piece cannot be replaced with an incompatible shape.
- Allow undo with Ctrl + Z: off by default. Ctrl + Z or the Undo placement button restores the previous piece, board, queue, hold, accepted-placement statistics and timer. Repeated undo is supported.
- Allow unlimited hold: off by default. When enabled, the piece and hold slot can be swapped repeatedly before lock.
- Fault practice: clear all scenes in one attempt: off by default. A finesse fault restarts the entire practice set when enabled.

Training preferences persist and support settings import / export. Older settings files receive the new defaults while retaining their existing handling and bindings. Changes apply on the next start or restart.

The engine is Triangle.js 4.2.7, imported through `@haelp/teto/engine`. The renderer uses its absolute block coordinates and piece previews. Keyboard down and up events go through its frame input interface so DAS, ARR and SDF use engine timing rather than browser key repeat.

Finesse uses the placement table and input-count rule from [d-002/finesse](https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js), pinned to revision `e223b32`. Each movement key press or rotation, including 180°, costs one input. DAS repeats do not add inputs. Hard drop, soft drop and hold are excluded from the finesse count. The physical occupied cells determine the target, so equivalent I/S/Z/O orientations share a placement. Any sequence within the reference input budget is accepted; inherited DAS or initial rotation may use fewer fresh presses. A successful hold starts a new piece's input count.

Hints use the upstream sequence when it reaches the target on the current board. Missing entries and incorrect upstream I-piece hints are resolved with an SRS+ search. Direct hard-drop routes are checked first, even if lowering the piece would permit fewer movement inputs. Only when no direct route reaches the target does the search allow soft drop for tucks and spins. Instant SDF hints lower to the current surface and release; finite SDF also allows partial descents. Initial rotations are evaluated from the actual spawn state. Every suggested route is checked against the board before the placement and before line clears.

A rejected placement restores the piece, board, hold, bag and displayed timer to the current piece's checkpoint. Fault and attempt history remain recorded. The outline is advisory by default, and can be made mandatory in Settings. Replays record the rule revision, actual piece inputs, input count, route, complete scene snapshots and whether soft drop was required. The replay frame timeline stays monotonic; retry and undo events include the restored timer value. `result.timeMs` is the displayed time, and `result.sessionTimeMs` includes discarded attempts. This extends d-002's empty-board drills to 40L stacks; it is not a claim of exact TETR.IO finesse parity. Placements outside the supported movement search are recorded as unverified rather than perfect.

Download replay exports settings, seed, input events, retry snapshots, placements and statistics as training JSON. It is not a native TETR.IO `.ttr` export. No official asset files are required.

## Fault practice

After a game, click Practice last replay to load its mistakes. Load replay file accepts trainer JSON, TETR.IO solo `.ttr`, and multiplayer `.ttrm`. Multiplayer files expose a Player / round selector. Each scene restores the board immediately before a faulty placement and outlines its destination. Clear that target with correct finesse to advance. Practice always checks finesse and requires its target; Hold and undo are unavailable during these drills. Back to 40L returns to sprint mode.

A practice finesse fault opens a small animated guide for that failed scene. It automatically plays the correct route once, then stops. Click the guide to replay it or close it with ×. With the one-attempt setting enabled, a fault also resets progress and practice time to scene one. Otherwise it retries the current scene. Older trainer replays can recover scenes from their retry snapshots.

The guide also keeps the complete numbered route visible before, during and after playback. Each step names the current key bindings, explains taps versus holds and when to release, and finishes with hard drop. Consecutive partial soft drops are grouped by row count. The current animation step is highlighted and completed steps are marked. The normal retry coach shares the same instructions.

Native import rebuilds the recorded input timeline and reevaluates placements using this trainer's d-002 rules. It supports standard 10 × 20, seven-bag, SRS / SRS+ recordings, including legacy and current multiplayer envelopes. Legacy garbage events retain their recorded hole columns. Available final placement counts, line counts and board state are checked against the simulation before import succeeds. Unsupported modes, incompatible game versions or mismatched recordings report an error rather than importing misleading scenes. Files are analyzed locally; maximum file size is 20 MB and maximum native recording duration is one hour.

## Validation

`npm run build` checks TypeScript and produces the production bundle. `npm test` checks all 162 empty-board placements, finesse, input timing, timer rollback, countdown, target enforcement, undo, unlimited hold, practice resets, replay validation and real native replay fixtures. `npm run test:browser` checks settings, layout, keyboard input, countdown, animation playback and replay import in Chromium. Install its browser once with `npx playwright install chromium` if needed.

Config tests also cover the supplied `.ttc`, settings migration, retained-field round trips, presets, alternate keys, invalid-file recovery, file-picker and drop imports, complete guidance, and canvas pixels for overlapping target and ghost outlines.

## References used

- [Triangle.js engine and snapshots](https://github.com/halp1/triangle/tree/main/src/engine)
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
