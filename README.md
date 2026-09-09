# 40 Lines Trainer

Run `npm install`, then `npm run dev`. Open http://127.0.0.1:5173.

Settings supports ARR, DAS, DCD, SDF, DAS cancellation, safe lock, initial rotation and hold, physical key bindings, grid and ghost options. Timings use 60 Hz frames. ARR 0 is instant; SDF 41 is instant soft drop. Changes apply at the next game. Opening Settings pauses the current game; Cancel discards edits. Settings persist locally and can be imported or exported as JSON.

The default controls are arrow keys for movement, Up for clockwise rotation, Z for counterclockwise rotation, A for 180°, C for hold, Space for hard drop, Escape for pause, and R for restart. Click a key binding to capture a physical key. Duplicate assignments are rejected.

The engine is Triangle.js 4.2.7, imported through `@haelp/teto/engine`. The renderer uses its absolute block coordinates and piece previews. Keyboard down and up events go through its frame input interface so DAS, ARR and SDF use engine timing rather than browser key repeat.

Finesse uses the placement table and input-count rule from [d-002/finesse](https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js), pinned to revision `e223b32`. Each movement key press or rotation, including 180°, costs one input. DAS repeats do not add inputs. Hard drop, soft drop and hold are excluded from the finesse count. The physical occupied cells determine the target, so equivalent I/S/Z/O orientations share a placement. Any sequence within the reference input budget is accepted; inherited DAS or initial rotation may use fewer fresh presses. A successful hold starts a new piece's input count.

Hints use the upstream sequence when it reaches the target on the current board. Missing entries and incorrect upstream I-piece hints are resolved with an SRS+ search. Direct hard-drop routes are checked first, even if lowering the piece would permit fewer movement inputs. Only when no direct route reaches the target does the search allow soft drop for tucks and spins. Instant SDF hints lower to the current surface and release; finite SDF also allows partial descents. Initial rotations are evaluated from the actual spawn state. Every suggested route is checked against the board before the placement and before line clears.

A rejected placement restores the piece, board, hold and bag state while retaining elapsed training time and attempt statistics. The outline is advisory: the next attempt can use another destination. Replays record the rule revision, actual piece inputs, input count, route and whether soft drop was required. This extends d-002's empty-board drills to 40L stacks; it is not a claim of exact TETR.IO finesse parity. Placements outside the supported movement search are recorded as unverified rather than perfect.

Download replay exports settings, seed, input events, retry snapshots, placements and statistics as training JSON. It is not a native TETR.IO `.ttr` export. No official asset files are required.

## Validation

`npm run build` checks TypeScript and produces the production bundle. `npm test` checks every upstream table entry, all 162 distinct empty-board placements, hard-drop priority over a cheaper soft-drop route, obstructed tucks, rotation counting, hold and retry boundaries, settings and input timing. `npm run test:browser` checks settings, real key input, 180° coaching and replay export in Chromium. Install its browser once with `npx playwright install chromium` if needed.

## References used

- [Triangle.js engine and snapshots](https://github.com/halp1/triangle/tree/main/src/engine)
- [d-002 finesse table, input counting and hints](https://github.com/d-002/finesse/blob/e223b32a26195333ffdc7dd7ab0221b9b2103375/script.js)
- [Triangle.js input and handling types](https://github.com/halp1/triangle/blob/main/src/types/game.ts)
- [MinoMuncher lock analysis](https://github.com/MinoMuncher/minomuncher-core/blob/main/src/replayParser/lockResult.ts)
- [Finesse movement sequences](https://four.lol/mid-game/finesse/)
- [Core Block Mac 2 retry interaction](https://github.com/aktue/Core-Block-Mac-2)
