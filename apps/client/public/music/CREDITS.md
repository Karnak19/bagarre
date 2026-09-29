# Music credits

The music was generated with [Suno](https://suno.com) on the **free plan**.
On that plan Suno owns the songs and licenses them for **non-commercial use
only**. This is unlike the sound effects (`../sfx/CREDITS.md`), which are all
CC0: the game can ship these songs only while it stays non-commercial, and
they can't be reused elsewhere for anything commercial. A commercial release
would have to replace them.

The files were cut into seamless loops, levelled to the same loudness and
encoded to MP3 by `apps/client/scripts/music/build.sh`, which lists the exact
cut points (found with `find-loop.ts` next to it).

| Output | Source title | Suno id | Used for |
| --- | --- | --- | --- |
| `menu.mp3` | Warm Analog Groove | `417112a1-58c0-4f43-bbd9-a5769b82fd3a` | Menu, Maps page |
| `match_1.mp3` | Arcade Rush | `fd69c61b-e3c0-4af6-98d8-a5a01d5d6e42` | Matches |
| `match_2.mp3` | Arcade Rush (a second song of that name) | `9c97163a-3d64-4f25-b55e-144f51b5c997` | Matches |
| `match_3.mp3` | arcade shooter | `6fd92360-44f8-4c7c-93a6-0bb13937ddce` | Matches |
| `match_4.mp3` | arcade shooter energy | `3f41d708-820e-49b8-a216-ee4ee8f969cb` | Matches |

A song's page is `https://suno.com/song/<id>`.
