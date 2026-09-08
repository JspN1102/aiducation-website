# Reading Art Sources

Fetched and verified on 2026-09-08. These assets support the supplied poem paintings; they are not replacement poem illustrations. Reference website logos, characters, photographs, and screenshots are not included here.

## Paper Texture

- File: `white-paper.webp`, 512 x 300 pixels, 1,244 bytes.
- Source: [Paper 001 from ambientCG](https://ambientcg.com/a/Paper001).
- Downloaded package: [Paper001_1K-JPG.zip](https://ambientcg.com/get?file=Paper001_1K-JPG.zip).
- Original package member: `Paper001_1K-JPG_Color.jpg`, 1024 x 600 pixels.
- License: [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- Official license statement: https://docs.ambientcg.com/license/ . It explicitly covers downloadable asset files and permits modification and redistribution.
- Full license text: `../licenses/ambientcg-cc0.txt`.
- Changes: Downsampled with the original aspect ratio and encoded as WebP. No colour changes.
- Suggested credit: Created using Paper 001 from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License.

## Reading Stickers

Twemoji graphics by Twitter and contributors, maintained in [jdecked/twemoji](https://github.com/jdecked/twemoji). Pinned version: **16.0.1**. Graphics use [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), separately from the project's MIT-licensed code. The three PNGs are copied unchanged from that release.

| File | Original Asset | Dimensions | Bytes |
| --- | --- | --- | --- |
| `book.png` | [U+1F4D6](https://github.com/jdecked/twemoji/blob/v16.0.1/assets/72x72/1f4d6.png) | 72 x 72 | 647 |
| `seedling.png` | [U+1F331](https://github.com/jdecked/twemoji/blob/v16.0.1/assets/72x72/1f331.png) | 72 x 72 | 470 |
| `sparkles.png` | [U+2728](https://github.com/jdecked/twemoji/blob/v16.0.1/assets/72x72/2728.png) | 72 x 72 | 752 |

- Full graphics license, copied unchanged from the release: `../licenses/twemoji-graphics.txt`.
- Upstream attribution guidance: https://github.com/jdecked/twemoji/blob/v16.0.1/README.md#attribution-requirements . It permits a project README, About section, footer, or HTML/JS source attribution.
- Suggested website credit: Twemoji graphics by Twitter and contributors, licensed under CC BY 4.0. Images are unmodified.
- Use these as small optional reading/progress illustrations. Existing Lucide icons remain the functional control family.

Total image transfer size for all four files: **3,113 bytes**, before HTTP compression.

## Fluent Reading Decorations

Added on 2026-09-08 from [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji). These are the official 3D PNG assets, licensed under the **MIT License**, Copyright (c) Microsoft Corporation. Source commit: `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`.

The complete official MIT copyright and permission notice is preserved unchanged in `../licenses/fluent-emoji-mit.txt`. These images are copied unchanged from the pinned official source. Their SHA-256 hashes match the downloaded originals; no resizing, recolouring, cropping, or added shadows were applied to the files.

| File | Pinned Official Source | Dimensions | Bytes |
| --- | --- | --- | --- |
| `fluent-open-book.png` | [Open book](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Open%20book/3D/open_book_3d.png) | 256 x 256 | 23,903 |
| `fluent-pencil.png` | [Pencil](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Pencil/3D/pencil_3d.png) | 256 x 256 | 21,796 |
| `fluent-cherry-blossom.png` | [Cherry blossom](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Cherry%20blossom/3D/cherry_blossom_3d.png) | 256 x 256 | 35,200 |
| `fluent-kite.png` | [Kite](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Kite/3D/kite_3d.png) | 256 x 256 | 29,944 |
| `fluent-cloud.png` | [Cloud](https://github.com/microsoft/fluentui-emoji/blob/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Cloud/3D/cloud_3d.png) | 256 x 256 | 18,854 |

Combined Fluent PNG size: **129,697 bytes** (126.7 KiB). The five files are well below the 250 KiB allocation. The whole reading-art image collection now totals 132,810 bytes.

All five PNGs were decoded and visually inspected. Each uses RGBA, has fully transparent corners and exterior areas, and has partially transparent antialiased edges. They have no opaque rectangular background.

Suggested visible placements:

- Put the open book beside the actual home-page title at 64 px desktop / 52 px mobile. Its supplied transparent top margin means the visible book is smaller than the image box; align the visual book with the title, not the empty top edge.
- Use the pencil at 44 px desktop / 36 px mobile as a small companion near a writing activity or the footer.
- Use the cherry blossom at 36-40 px in a footer group or one title-adjacent accent.
- Use the kite at 56-64 px desktop / 44-48 px mobile near the opposite end of that group.
- Keep the 40-48 px cloud as an optional companion where the background gives its pale edge enough contrast.

Use a few visible placements in the normal page, not only in an empty state. Decorative images should have `alt=""` and should not intercept pointer events. Keep them out of the supplied poem artwork and functional button hit areas. Retain Lucide for controls and keep the existing poem paintings as the main images.
