# 畫雞 game art (`media/hua-ji/game/`)

Used only by `poem-games/rooster.mjs` (`mountRooster`, 雄雞報曉). The stage pictures
`media/hua-ji/scene-2.webp` (daytime rooster), `scene-3.webp` (night) and `scene-4.webp` (sunrise, crowing)
were supplied by the user. They are used unmodified and are not part of this folder.

There are 7 files, 328,582 bytes in total, and each file is under 100 KB. Sizes, bytes and SHA-256 are in
the file list at the end.

## AI-generated art

| File | Size | Where it is used |
|---|---|---|
| `lane.webp` | 900×280 | The village lane under the stage (dawn and door steps). Its four doorways are open and lamp-lit. |
| `door.webp` | 360×595 | The closed door leaves. Each doorway in the lane gets the left half and the right half of this picture as two leaves. They swing open when the child taps that house after the rooster crows (一叫千門萬戶開). |
| `villagers.webp` | 496×220 | A sheet of four 124×220 cells: grandpa stretching, a girl waving, a farmer with a hoe, a grandma with a lantern. Each one steps into its doorway when that door opens. |
| `roosters.webp` | 532×150 | A sheet of four 133×150 cells: red, golden, black and speckled village roosters. Each one hops onto its roof and answers 喔喔！ when its door opens, and all four crow together at the end. |
| `rooster-plate.webp` | 540×596 | A background patch laid over the white rooster in `scene-2.webp`, so the cut-out rooster can strut in from the side without a second rooster showing. |

How these were made:

- All were generated with gpt-image-2 through the project account. `lane` and `door` were made on
  2026-10-05 in round 1; `villagers`, `roosters` and `rooster-plate` were made on 2026-10-05 in round 2.
- Style references: `scene-4.webp` for `lane`, `door` and `roosters`; `lane.webp` for `villagers`; the left
  900×900 square of `scene-2.webp` for `rooster-plate`. The brushwork and palette match the stage pictures.
- Prompt summary for `lane.webp`: one row of four small Jiangnan cottages seen straight from the front,
  with whitewashed walls, grey tiled roofs and a large open doorway with warm lamplight in each. No people,
  no text and no seals.
- Prompt summary for `door.webp`: one pair of closed traditional wooden double doors, seen straight on,
  with iron ring knockers and studs. No frame, no wall, no text, no door gods and no couplets.
- Prompt summary for `villagers.webp`: four cheerful Ming-dynasty villagers in plain cotton clothes, full
  body from the front, as if just stepping out of their door at sunrise, evenly spaced on flat chroma green.
  No text and no seals.
- Prompt summary for `roosters.webp`: four small village roosters (red, golden, black, speckled), side view,
  crowing with heads raised, all the same size, evenly spaced on flat chroma green. No ground, no text.
- Prompt summary for `rooster-plate.webp`: an edit of the `scene-2.webp` square that removes the white
  rooster and repaints only the pine, mist, hills, grass and slope behind it. Nothing else changed.
- For `lane`, `door`, `villagers` and `roosters` the green was keyed out locally and the green spill removed.
  Each subject was cropped out and resized, and the figures were packed into equal-height sheets, then saved
  as RGBA WebP.
- For `rooster-plate`, only the area behind the rooster was kept. A difference mask between `scene-2.webp`
  and the edited picture, widened and feathered, became the alpha. The patch was scaled by 0.75.

The game tints the lane, villagers and roosters darker at night with CSS, using the same dawn value as the
stage, and lightens them as the sun rises. The images themselves are not changed.

## Cut from the user's pictures (no generation)

| File | Size | Where it is used |
|---|---|---|
| `rooster-walk.webp` | 511×548 | The white rooster from `scene-2.webp` as a separate sprite. It struts in (走將來) at the start and struts again when tapped. |
| `night-head.webp` | 322×161 | Two 161×161 cells from `scene-3.webp`. The left cell is the night sky with the rooster's head removed; the right cell is the head alone. The game swaps them in and shakes the head when the child asks the rooster to crow before dawn. |

- `rooster-walk`: a u2net (rembg) mask of `scene-2.webp` was refined with the difference mask described for
  `rooster-plate`, then the rooster was cropped and scaled by 0.75. Pixels are the user's own.
- `night-head`: a u2net mask of `scene-3.webp` was cut to the head and neck. For the empty cell, that area
  was filled with OpenCV Telea inpainting and lightly blurred so it reads as soft night sky. Both cells were
  scaled by 0.75 and the edges feathered.

No other files are stored here. Generation receipts and working files are kept outside the repository.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| door.webp | 360×595 | 67480 | `0a8378f0c17497df` |
| lane.webp | 900×280 | 92838 | `58e3a0f3a012a3d9` |
| night-head.webp | 322×161 | 10880 | `41122811217ccd77` |
| rooster-plate.webp | 540×596 | 39202 | `2d27f1988d76e173` |
| rooster-walk.webp | 511×548 | 46270 | `919a06892c29b064` |
| roosters.webp | 532×150 | 36396 | `f8ad0233113d436a` |
| villagers.webp | 496×220 | 35516 | `fbf7fced2685b633` |
