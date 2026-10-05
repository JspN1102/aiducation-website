# 畫雞 game art (`media/hua-ji/game/`)

Used only by `poem-games/rooster.mjs` (`mountRooster`, 雄雞報曉). The stage pictures
`media/hua-ji/scene-2.webp` (daytime rooster), `scene-3.webp` (night) and `scene-4.webp` (sunrise, crowing)
were supplied by the user. They are used unmodified and are not part of this folder.

Bytes, SHA-256 and pixel sizes for every file are in `asset-manifest.json`. There are 2 files,
160,318 bytes in total, and each file is under 100 KB.

## AI-generated art

| File | Size | Where it is used |
|---|---|---|
| `lane.webp` | 900×280 | The village lane under the stage (dawn and door steps). Its four doorways are open and lamp-lit. |
| `door.webp` | 360×595 | The closed door leaves. Each doorway in the lane gets the left half and the right half of this picture as two leaves. They swing open one by one after the rooster crows (一叫千門萬戶開). |

How these were made:

- Both were generated with gpt-image-2 through the project account on 2026-10-05. Each is a separate
  image on a flat chroma-green background.
- The user's `scene-4.webp` was given as a style reference, so the ink-and-watercolour brushwork and the
  sunrise palette match the stage pictures.
- Prompt summary for `lane.webp`: one row of four small Jiangnan cottages seen straight from the front,
  with whitewashed walls, grey tiled roofs and a large open doorway with warm lamplight in each. No people,
  no text and no seals.
- Prompt summary for `door.webp`: one pair of closed traditional wooden double doors, seen straight on,
  with iron ring knockers and studs. No frame, no wall, no text, no door gods and no couplets.
- The green was keyed out locally and the green spill removed. Each image was cropped to its subject and
  resized (lane 1536×478 to 900×280, doors 835×1381 to 360×595), then saved as RGBA WebP.

The game tints the lane darker at night with CSS, using the same dawn value as the stage, and lightens it as
the sun rises. The images themselves are not changed.

No other files are stored here. Generation receipts and working files are kept outside the repository.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| door.webp | 360×595 | 67480 | `0a8378f0c17497df` |
| lane.webp | 900×280 | 92838 | `58e3a0f3a012a3d9` |
