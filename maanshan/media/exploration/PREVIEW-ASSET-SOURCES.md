# Preview poems 7-12: observation assets

The `yong-xue`, `hua-ji`, `qi-bu-shi`, `jue-ju`, `zheng-ren-mai-lu` and `ke-zhi` folders were made for AIDUCATION on 2026-10-05 for the second round of six poems. They are shown only to the accounts that load `poems-preview.json`.

On 2026-10-06 the `yong-xue`, `hua-ji` and `qi-bu-shi` folders (grades 1-3) were removed from the platform, because grades 1-3 have no AR activity. Their records below and in `preview-manifest-20261005.json` are kept as provenance; the files are no longer deployed and are kept in the project's local backup.

## Scene pictures

Each `scene.webp` is a crop of one of the illustrations supplied by the school for the poem (the last picture of the poem, or the one that shows the observed object most clearly). They were cropped and re-encoded locally; nothing was added or redrawn.

## 3D models

Each object was designed from the poem's teaching PDF and its supplied illustration: a snowy white plum branch on a rock, a white rooster with a red comb, a mud stove and pot with burning bean stalks, a thatched cottage window with two orioles on a willow, a wooden seat with a knotted measuring cord and a pair of shoes, and a thatched cottage with a flower path and reed gate by spring water. A single reference picture was first generated with `gpt-image-2` from a text prompt that used the supplied illustration only as a colour and style guide; no stock photograph, logo, text or answer label was included. Each reference was turned into a model with Tripo `v3.1-20260211` (image to model, detailed geometry and texture, PBR).

The web versions (`model-20261005.glb`) were simplified with glTF-Transform from about 75,000 to 65,000 triangles. Each is one self-contained GLB of 2.1-2.6 MB with three embedded 1024-pixel JPEG textures and no Draco, meshopt or KTX2 decoder. All six pass the Khronos glTF validator with no errors, and were checked in actual WebGL from the front, three-quarter, side and back views.

Sizes, SHA-256 hashes, triangle counts and the source model hashes are recorded in `preview-manifest-20261005.json`. Prompts, reference pictures, unmodified source GLBs, generation receipts and optimisation logs are kept in the local `maanshan-work/round2-ar-20261005` source folder. Account keys, task IDs and signed resource URLs are excluded.

## Source and rights record

The models and reference pictures are newly AI-generated project assets. Provider account terms apply; no Creative Commons, open-source or public-domain licence is asserted. The scene pictures remain the school's supplied material.
