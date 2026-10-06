# 鄭人買履 game art (`media/zheng-ren-mai-lu/game/`)

Used only by `poem-games/shoe-market.mjs` (`mountShoeMarket`). The user supplied the four scene
paintings `media/zheng-ren-mai-lu/scene-1.webp` to `scene-4.webp`. They are used unmodified as
the stage pictures and are not part of this folder.

There are 5 files, 296,266 bytes in total, and every file is under 105 KB. Every file in this
folder is used by the game. Pixel sizes, bytes and the start of each SHA-256 are in the file list
at the end of this page.

## AI-generated sprites

| File | Size | Where it is used |
|---|---|---|
| `foot.webp` | 900×680 | The man's bare foot. At the measuring step the child marks its heel and then its toe tip on the ruler (度其足). It appears again in the try-on box (何不試之以足). |
| `bu-lu.webp` | 900×455 | One empty cloth shoe (布履). The tray shows it three times at three sizes (big, small and just right). In the try-on box it is the back layer, behind the foot. |

How `foot.webp` was made:

- It was generated with gpt-image-2 through the project account on 2026-10-05, at 1536×1024 and
  high quality, as a single object on a flat chroma-green background. The user's `scene-2.webp`
  (the market) was given as a style reference, so the ink outlines and palette match the paintings.
- **Prompt summary:** a picture-book illustration in soft ink and watercolour of a single bare
  adult right foot in side profile. The toes point right, the sole is flat, and an off-white
  trouser hem sits above the ankle. No text, shadow or floor line.
- The green was keyed out and the green spill removed. It was scaled to 900 px wide and saved as
  RGBA WebP at quality 88, with a soft alpha fade along its top edge so the trouser hem does not
  end in a hard line.

How `bu-lu.webp` was made:

- It was generated with gpt-image-2 through the project account on 2026-10-06, at 1536×1024 and
  high quality. There were two input images. The first was `foot.webp` on chroma green, so the
  shoe was drawn at the same position and scale as the foot it has to fit. The second was the
  user's `scene-2.webp`, used as a style reference.
- **Prompt summary:** one empty traditional Chinese cloth shoe (布履) in exact side view, with the
  toe pointing right and the sole flat. It has:
  - a tall, rounded heel counter that wraps the whole heel
  - a deep closed vamp that covers all the toes
  - an oval opening with the off-white cotton lining visible
  - a charcoal-indigo woven cotton upper with thin off-white piping
  - a thick layered off-white sole with stitch dots
  - a softly upturned toe

  The background was flat chroma green, with no foot, text, shadow or floor line.
- The green was keyed out and the spill removed. The shoe was cropped to 998×505 and scaled to
  900×455, then saved as RGBA WebP at quality 88.

## Derived from the AI shoe

| File | Size | Where it is used |
|---|---|---|
| `bu-lu-front.webp` | 900×455 | Drawn over the foot in the try-on box, so the foot looks as if it is inside the shoe. |

This is `bu-lu.webp` with the inside lining and the far rim above it made transparent, feathered
by 0.7 px. The foot is drawn between `bu-lu.webp` and this layer. Only the alpha channel was
changed and no new pixels were painted. It was saved as RGBA WebP at quality 88.

The try-on box scales the same pair of layers to make the three sizes:

- **Small:** the heel sticks out behind the shoe.
- **Big:** there is an empty gap behind the heel.
- **Just right:** the shoe covers the heel and all the toes.

## Cut from the user's scene-1

| File | Size | Where it is used |
|---|---|---|
| `ruler.webp` | 849×54 | The ruler (度). The child marks the heel and the toe tip on it at the measuring step. Then it flies onto the seat in the home picture (而置之其坐). |
| `mat-patch.webp` | 309×71 | Laid over scene-1 during the measuring step, so the seat (坐) is empty until the measured ruler lands there. It fades away once the ruler is placed. |

How these were made:

- **`ruler.webp`:** the painted ruler that lies on the seat in `scene-1.webp` was cropped and
  upscaled 3×. It was then rotated to horizontal and cut out with a soft mask. The pixels are
  the user's own painting.
- **`mat-patch.webp`:** the mat texture next to the ruler in `scene-1.webp` was copied over the
  ruler's position, with soft edges. When the patch is on, the seat in the painting looks empty.
  It was saved as RGBA WebP at quality 90.
- `scene-1.webp` itself was not modified. Both files are placed over it at runtime.

## Licence

`foot.webp` and `bu-lu.webp` are AI-generated project assets (gpt-image-2 via project account).
`bu-lu-front.webp` is an alpha-only edit of `bu-lu.webp`. Provider account terms apply; no
Creative Commons or public-domain licence asserted.

`ruler.webp` and `mat-patch.webp` are cut from the user-supplied scene painting.

No third-party stock images, fonts or external URLs are used.

## File list

| File | Size (px) | Bytes | SHA-256 (first 16) |
|---|---|---|---|
| bu-lu-front.webp | 900×455 | 92370 | `27603259c31d3baf` |
| bu-lu.webp | 900×455 | 103190 | `37a064d7adf93bfa` |
| foot.webp | 900×680 | 81552 | `2ddc3cdce92651d1` |
| mat-patch.webp | 309×71 | 6620 | `c8ed39684a687b1a` |
| ruler.webp | 849×54 | 12534 | `f5f92b7bf56b7a0a` |
