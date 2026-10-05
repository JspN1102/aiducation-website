# 七步詩 game art (`media/qi-bu-shi/game/`)

Used only by `poem-games/seven-steps.mjs` (`mountSevenSteps`). The three scene paintings
`media/qi-bu-shi/scene-1.webp`, `scene-2.webp` and `scene-3.webp` were supplied by the user. They are
used unmodified as the stage backgrounds and are not part of this folder.

Bytes, SHA-256 and pixel sizes for every file are in `asset-manifest.json`. There are 7 files,
234,266 bytes in total, and every file is under 60 KB.

## Patches cut from an AI edit of the user scene

| File | Size | Where it is used |
|---|---|---|
| `pot-water.webp` | 516×120 | Overlaid on scene-1 at step 0: the 釜 holds only steaming water. |
| `strainer-empty.webp` | 390×130 | Overlaid on scene-1 at steps 0–1: an empty 竹篩. |
| `basin-empty.webp` | 435×152 | Overlaid on scene-1 at steps 0–1: an empty, dry basin. |

How these were made:

1. The user's `scene-1.webp` was edited with gpt-image-2 through the project account on 2026-10-05.
   The prompt kept the whole painting the same and only removed three things: the beans in the pot,
   the bean mash in the strainer, and the liquid in the basin.
2. The edited pixels were cut out with feathered masks. Each mask covers one object only, so
   everything around the patches is the user's original painting.
3. The patches were saved as RGBA WebP at quality 88. The game places them by percentage over the
   1600×900 scene. When the child acts, the patch fades away and the user's original painting
   (beans, mash, bean juice) shows through.

The source scene file itself was not modified.

## AI-generated sprites

| File | Size | Where it is used |
|---|---|---|
| `bean-basket.webp` | 473×282 | 一籃黃豆 at step 1, and the art on the 豆 card at step 6. |
| `gourd-ladle.webp` | 553×237 | 一瓢豆湯 at step 2, and the pouring animation. |
| `bean-stalks.webp` | 560×254 | 豆子的莖／豆萁 at steps 3–4, the push-into-the-stove animation, and the art on the 萁 card at step 6. |
| `firewood.webp` | 560×271 | 木柴, the wrong fuel choice at step 3. |

How these were made:

- They were generated with gpt-image-2 through the project account on 2026-10-05, as one 2×2 sheet
  on a flat chroma-green background.
- The user's `scene-1.webp` was given as a style reference, so the brushwork and palette match.
- The prompt summary: four isolated objects in soft Chinese ink-and-watercolour — a basket of dry
  soybeans, a gourd ladle of bean broth, a tied bundle of dried bean stalks with empty pods, and a
  tied bundle of split firewood. No text, no shadows.
- The green was keyed out and the green spill removed. Each object was cropped and scaled to at
  most 560 px, then saved as RGBA WebP at quality 88.

## Licence

These are AI-generated or AI-edited project assets, made with gpt-image-2 through the project
account. The provider's account terms apply. No Creative Commons or public-domain licence is
asserted. No third-party stock images, fonts or external URLs are used.

The avatar in the footprint strip is the existing `media/qi-bu-shi/avatar.webp`, and it is not
part of this folder.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| basin-empty.webp | 435×152 | 17644 | `24dd049a36b2974b` |
| bean-basket.webp | 473×282 | 47298 | `4f7d293febbfa926` |
| bean-stalks.webp | 560×254 | 59666 | `d2af0b598208124d` |
| firewood.webp | 560×271 | 50788 | `60a3e4194b3aaba9` |
| gourd-ladle.webp | 553×237 | 25824 | `564e804a5d560d83` |
| pot-water.webp | 516×120 | 12238 | `4dfcad0ccd4a3d0f` |
| strainer-empty.webp | 390×130 | 20808 | `c095d15079949380` |
