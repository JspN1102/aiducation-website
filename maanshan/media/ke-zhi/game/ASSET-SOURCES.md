# 客至 game art (`media/ke-zhi/game/`)

Used only by `poem-games/guest.mjs` (`mountGuest`, 草堂待客). The user supplied the stage pictures
`media/ke-zhi/scene-2.webp` (flower path and the 蓬門), `scene-3.webp` (Du Fu and the guest at the table) and
`scene-4.webp` (the neighbour at the fence). They are used unmodified and are not part of this folder.

`asset-manifest.json` lists the bytes, SHA-256 and pixel size of every file. The folder holds 7 files,
425,418 bytes in total, and each file is under 150 KB (the largest is 103,836 bytes). Every file is loaded
by the game.

## AI-generated art

Licence for every file in this section:
AI-generated project asset (gpt-image-2 via project account), prompt summary, date 2026-10-05. Provider account terms apply; no Creative Commons or public-domain licence asserted.

| File | Size | Where it is used |
|---|---|---|
| `door.webp` | 415×560 | The two leaves of the 蓬門 over the doorway in scene-2. They swing open at step 2 (蓬門今始為君開). |
| `broom.webp` | 241×700 | The broom that sweeps the flower path at step 1 (花徑不曾緣客掃). |
| `dish-home.webp` | 544×293 | Choice card 一盤家常菜, the right answer at step 3 (盤飧市遠無兼味). |
| `dish-feast.webp` | 640×422 | Choice card 山珍海味, the wrong answer at step 3. |
| `wine-old.webp` | 500×426 | Choice card 家裏的舊醅, the right answer at step 4 (樽酒家貧只舊醅). |
| `wine-new.webp` | 346×483 | Choice card 新釀美酒, the wrong answer at step 4. |

How these were made:

- **Two generations.** Both were made with gpt-image-2 (1536×1024, high quality) through the project account on 2026-10-05. Each puts the separate objects on a flat chroma background, and each object was then cut out with a colour key and trimmed.
- **Door and broom.** Prompt summary: two isolated objects in the style of the reference.
  - Left: a closed, humble double door of a thatched cottage, seen from the front, with no frame. It is made of bamboo poles on twine-tied rails, with reed and straw woven between them.
  - Right: an upright bamboo-twig broom bound with faded red twine.
  - Rules: no people and no text.
  - Style reference: the user's `scene-2.webp`. Background: chroma green.
- **Food and wine.** Prompt summary: four isolated objects in a 2×2 grid.
  - A worn earthenware plate of stir-fried greens.
  - A lavish red-lacquer banquet tray with fish, duck, abalone, prawns and bird's-nest soup.
  - An old, dusty earthenware wine jar with a clay cup of cloudy home-made wine.
  - A new blue-and-white porcelain wine ewer with gold trim and a red bow.
  - Rules: no people and no text.
  - Style reference: the user's `scene-3.webp`. Background: magenta.
  - Each quadrant became one choice card.

## Derived from a user scene

| File | Size | Source |
|---|---|---|
| `broom-gap.webp` | 160×292 | Cut from the user-supplied `media/ke-zhi/scene-2.webp` |

How `broom-gap.webp` was made:

- It is a patch from the 1600×900 scene, box x 370–530, y 420–712.
- The painted broom in that box was covered with pixels cloned from the same scene, 130 px to the left. The alpha channel is the broom mask, so only the patched area shows.
- It sits over scene-2 at the same place. When the child picks up the broom sprite, the painted broom disappears.
- It is not AI-generated, and the same terms as the user's scene apply.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| broom.webp | 241×700 | 32936 | `c3df136dd8363df9` |
| broom-gap.webp | 160×292 | 16842 | `3ced333ae0eccca9` |
| door.webp | 415×560 | 103722 | `2986ad61b30dca16` |
| dish-home.webp | 544×293 | 57544 | `1ae73c0ced91d883` |
| dish-feast.webp | 640×422 | 103836 | `0cd014b399792a74` |
| wine-old.webp | 500×426 | 58898 | `321d37103a60313b` |
| wine-new.webp | 346×483 | 51640 | `955656cd64dc7553` |
