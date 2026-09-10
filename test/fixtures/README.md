# Native replay fixtures

These unmodified public samples come from [zbrachinara/viewtris](https://github.com/zbrachinara/viewtris/tree/master/samples).

- `viewtris-40l.ttr`: upstream `_40l.ttr`, a 102-piece, 40-line solo recording.
- `viewtris-match.ttrm`: upstream `HBSQabUhSS.ttrm`, eight rounds with two player perspectives each.

Tests reconstruct the input timeline and validate available final statistics and board state. Both files exercise actual TETR.IO exports rather than files emitted by this trainer. The multiplayer recording also covers legacy nested garbage events and recorded hole columns.

`example-config.ttc` is the user's supplied TETR.IO config. It exercises custom uppercase key codes, all current handling fields, numeric-string opacity values, and retained audio, video, game, desktop and notification options. It is used by both parser and browser import tests.
