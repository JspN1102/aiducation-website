# 鄭人買履 game art (`media/zheng-ren-mai-lu/game/`)

Used only by `poem-games/shoe-market.mjs` (`mountShoeMarket`). The user supplied the four scene
paintings `media/zheng-ren-mai-lu/scene-1.webp` to `scene-4.webp`. They are used unmodified as
the stage pictures and are not part of this folder.

Bytes, SHA-256 and pixel sizes for every file are in `asset-manifest.json`. There are 5 files,
253,296 bytes in total, and every file is under 82 KB. Every file in this folder is used by the game.

## AI-generated sprites

| File | Size | Where it is used |
|---|---|---|
| `foot.webp` | 900×680 | The man's bare foot. At the measuring step the cord is pulled along it from heel to toe (度其足). It appears again in the try-on box (用自己的腳試). |
| `shoe.webp` | 900×316 | One empty cloth shoe. The tray shows it three times, scaled as the small, middle and big shoes. |

How these were made:

- Both were generated with gpt-image-2 through the project account on 2026-10-05, at 1536×1024
  and high quality. Each was a single object on a flat chroma-green background.
- The user's `scene-2.webp` (the market) was given as a style reference, so the ink outlines,
  palette and the cloth shoes match the paintings.
- The prompts, in summary:
  - **Foot:** a picture-book illustration in soft ink and watercolour of a single bare adult right
    foot in side profile. The toes point right, the sole is flat, and an off-white trouser hem
    sits above the ankle.
  - **Shoe:** a single empty traditional Chinese cloth shoe in side profile. It has a charcoal
    cloth upper, a softly upturned toe and a thick, layered, off-white sole, and the toe points
    right.
  - Both prompts asked for no text, no shadow and no floor line.
- The green was keyed out and the green spill removed. Each sprite was scaled to 900 px wide and
  saved as RGBA WebP at quality 88. The foot also got a soft alpha fade along its top edge so the
  trouser hem does not end in a hard line.

## Derived from the AI shoe

| File | Size | Where it is used |
|---|---|---|
| `shoe-worn.webp` | 900×316 | Drawn over the foot when the child tries a shoe on in the try-on box. |

This is `shoe.webp` with the inside lining made transparent, so the foot shows inside the shoe.
Only the alpha channel was changed and no new pixels were painted. It was saved as RGBA WebP at
quality 88.

## Cut from the user's scene-1

| File | Size | Where it is used |
|---|---|---|
| `ruler.webp` | 849×54 | The measuring cord (度). It is the cord you drag at the measuring step, it sits on the 量好的尺碼 card, and it is the badge on the moral card. |
| `mat-patch.webp` | 309×71 | Laid over scene-1 during the measure and place steps, so the seat (坐) is empty until the child puts the measure there. It fades away once the measure is placed. |

How these were made:

- **`ruler.webp`:** the painted ruler that lies on the seat in `scene-1.webp` was cropped and
  upscaled 3×. It was then rotated to horizontal and cut out with a soft mask. The pixels are
  the user's own painting.
- **`mat-patch.webp`:** the mat texture next to the ruler in `scene-1.webp` was copied over the
  ruler's position, with soft edges. When the patch is on, the seat in the painting looks empty.
  It was saved as RGBA WebP at quality 90.
- `scene-1.webp` itself was not modified. Both files are placed over it at runtime.

## Licence

`foot.webp` and `shoe.webp` are AI-generated project assets, made with gpt-image-2 through the
project account, and the provider's account terms apply. `shoe-worn.webp` is an edit of
`shoe.webp`. `ruler.webp` and `mat-patch.webp` are cut from the user-supplied scene painting.
No Creative Commons or public-domain licence is asserted.

No third-party stock images, fonts or external URLs are used.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| foot.webp | 900×680 | 81552 | `2ddc3cdce92651d1` |
| mat-patch.webp | 309×71 | 6620 | `c8ed39684a687b1a` |
| ruler.webp | 849×54 | 12534 | `f5f92b7bf56b7a0a` |
| shoe-worn.webp | 900×316 | 73192 | `40309fd1e0714982` |
| shoe.webp | 900×316 | 79398 | `eee526c762352070` |
