# 絕句 game art (`media/jue-ju/game/`)

Used only by `poem-games/couplet.mjs` (`mountCouplet`, 草堂窗前畫春景). The user supplied the stage pictures
`media/jue-ju/scene-1.webp` (willow and the two orioles), `scene-2.webp` (adds the line of egrets),
`scene-3.webp` (adds the snowy western hills) and `scene-4.webp` (adds the moored boats). They are used
unmodified and are not part of this folder.

The folder holds 21 files, 450,994 bytes in total, and each file is under 120 KB (the largest is
117,918 bytes). Every file is loaded by the game.

## AI-generated art

Licence for every file in this section:
AI-generated project asset (gpt-image-2 via project account), prompt summary, date 2026-10-05. Provider account terms apply; no Creative Commons or public-domain licence asserted.

| File | Size | Where it is used |
|---|---|---|
| `oriole-fly-a.webp` | 230×175 | The first oriole flying in to the willow at step 1 (兩個黃鸝鳴翠柳). |
| `oriole-fly-b.webp` | 230×244 | The second oriole flying in at step 1. |
| `brush.webp` | 27×320 | The brush that follows the finger while the child paints the willow green at step 1. |
| `egret-0.webp` | 233×183 | Two egrets standing on the river bank at step 2 (一行白鷺上青天), waiting to fly into the line. |
| `egret-1.webp` | 187×241 | Two more egrets on the bank at step 2. |
| `egret-2.webp` | 300×188 | Two more egrets on the bank at step 2. |
| `egret-3.webp` | 108×180 | The last single egret on the bank at step 2. |
| `window-frame.webp` | 440×464 | The window frame the child moves to frame the snowy hills at step 3 (窗含西嶺千秋雪). |
| `shutter-l.webp` | 186×360 | Left shutter leaf of that window; it swings open at step 3. |
| `shutter-r.webp` | 180×360 | Right shutter leaf of that window. |
| `boat.webp` | 560×406 | The cargo boat the child rows from far away to the door at step 4 (門泊東吳萬里船). |
| `post.webp` | 85×240 | The mooring post the boat is tied to at step 4. |
| `oriole-gap.webp` | 268×215 | Covers the two painted orioles in scene-1 until the birds fly in at step 1. |

How these were made:

- **Five generations.** All were made with gpt-image-2 (1536×1024, high quality) through the project account on 2026-10-05. The first four put separate objects on a flat chroma background, and each object was then cut out with a colour key and trimmed.
- **Orioles and brush.** Prompt summary: three isolated objects in the style of the reference.
  - Left and middle: a black-naped oriole flying to the right, in two different wing poses. Same species and colours as the two birds in the reference.
  - Right: an upright Chinese writing brush with a bamboo handle and a willow-green tip.
  - Rules: no branches, no sky, no people and no text.
  - Style reference: a crop of the user's `scene-1.webp` (the willow and orioles). Background: magenta.
- **Egrets.** Prompt summary: four isolated groups of little egrets, standing, not flying.
  - The groups are two side by side, two with necks up and down, two with one on one leg and one lifting its wings, and one alone. That matches the 2 + 2 + 2 + 1 egrets flying in the user's `scene-2.webp`.
  - Rules: no water, no plants, no people and no text.
  - Style reference: a crop of the egrets in the user's `scene-2.webp`. Background: chroma green.
- **Window.** Prompt summary: three isolated objects.
  - An empty weathered wooden window frame, seen straight on.
  - Two closed lattice shutter leaves backed with window paper, one the mirror of the other, each with an iron ring handle.
  - Rules: no wall, no people and no text.
  - Style reference: a crop of the cottage window in the user's `scene-1.webp`. Background: chroma green.
- **Boat and post.** Prompt summary: two isolated objects.
  - The same kind of wooden cargo boat as the big boat in the user's `scene-4.webp`. Its bow points left. It has a woven bamboo-mat cabin, a furled sail, bales, crates, red chests and blue-and-white jars, and a coil of rope at the stern.
  - A thick wooden mooring post with rope loops near the top.
  - Rules: no pier, no water, no people and no text.
  - Style reference: a crop of the user's `scene-4.webp` (boat and pier). Background: chroma green.
- **Oriole gap.** Prompt summary: repaint the attached crop of the user's `scene-1.webp` with the same composition and brushwork but with both yellow birds removed, continuing the willow branch, leaves and sky behind them.
  - The crop was box x 350–770, y 130–410 of the 1600×900 scene.
  - The result was scaled back to that box and colour-matched to the scene around the birds.
  - The alpha channel is the two bird shapes, widened by 9 px and feathered, so only the patched area shows.
  - It sits over scene-1 at x 415, y 156.

## Derived from a user scene

These files are not AI-generated, except where they include the oriole-gap patch as noted. The same terms as the user's scenes apply.

| File | Size | Source |
|---|---|---|
| `oriole-a.webp` | 124×153 | Cut from the user-supplied `media/jue-ju/scene-1.webp` |
| `oriole-b.webp` | 104×141 | Cut from `scene-1.webp` |
| `egret-fly-0.webp` | 196×105 | Cut from the user-supplied `media/jue-ju/scene-2.webp` |
| `egret-fly-1.webp` | 168×85 | Cut from `scene-2.webp` |
| `egret-fly-2.webp` | 142×74 | Cut from `scene-2.webp` |
| `egret-fly-3.webp` | 33×30 | Cut from `scene-2.webp` |
| `pale-willow.webp` | 1200×675 | Recoloured from `scene-1.webp` with the oriole-gap patch applied |
| `pale-rest.webp` | 1200×675 | Recoloured from `scene-1.webp` with the oriole-gap patch applied |

How they were made:

- **`oriole-a.webp` and `oriole-b.webp`.** These are the two painted orioles in scene-1. Each bird outline was widened by 4 px and feathered.
  - They sit at the same place: x 423, y 163 and x 571, y 222.
  - They are the perched birds the child taps to make them sing.
- **`egret-fly-0.webp` to `egret-fly-3.webp`.** These are the seven flying egrets of scene-2 in four groups (2, 2, 2 and 1).
  - Each was separated from the sky with a colour key, and its holes were filled.
  - They are the line slots the child fills at step 2.
  - They rise to their places in the painting before scene-2 fades in.
- **`pale-willow.webp` and `pale-rest.webp`.** These are the view outside the window in scene-1, turned into a pale sketch: 18% colour, 82% grey, then mixed 42:58 with paper colour, and scaled to 1200×675.
  - `pale-willow.webp` keeps only the willow canopy. The child brushes it away at step 1 to make the willow 翠綠.
  - `pale-rest.webp` keeps the rest of the view, with the gaps of sky between the leaves. It fades when the egrets reach the sky at step 2 (上青天).

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| oriole-gap.webp | 268×215 | 14120 | `1387f9f9b941c46d` |
| oriole-a.webp | 124×153 | 5358 | `f6b3ae684a4149b5` |
| oriole-b.webp | 104×141 | 5530 | `b9b90b7668a1147c` |
| oriole-fly-a.webp | 230×175 | 13238 | `268fb0c22ff67a50` |
| oriole-fly-b.webp | 230×244 | 15920 | `c1615f62173f08ce` |
| brush.webp | 27×320 | 5098 | `8499d689312f203a` |
| pale-willow.webp | 1200×675 | 90828 | `3d3b6010cbd570b4` |
| pale-rest.webp | 1200×675 | 117918 | `3c48af39788e9732` |
| egret-0.webp | 233×183 | 11996 | `f03fdae50b1b0b76` |
| egret-1.webp | 187×241 | 11852 | `2587aa70fd30a17c` |
| egret-2.webp | 300×188 | 15398 | `30f74385544019e8` |
| egret-3.webp | 108×180 | 6086 | `4b1213fd73bc7972` |
| egret-fly-0.webp | 196×105 | 4000 | `2c6eead83ed47b13` |
| egret-fly-1.webp | 168×85 | 2790 | `04762e3f862af7b0` |
| egret-fly-2.webp | 142×74 | 2266 | `d09529ef9ce42150` |
| egret-fly-3.webp | 33×30 | 658 | `838c191be1516a2f` |
| window-frame.webp | 440×464 | 34394 | `a853f8ab21fad807` |
| shutter-l.webp | 186×360 | 20356 | `4139aed5f0965084` |
| shutter-r.webp | 180×360 | 20042 | `900ce9bb3b966911` |
| boat.webp | 560×406 | 44420 | `4f2b41a5dc71da54` |
| post.webp | 85×240 | 8726 | `1c8530e3979af75e` |
