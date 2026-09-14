# Interactive botanical assets

The bean and grass assets were newly generated for AIDUCATION on 2026-09-14. They distinguish three broad bean leaves from a tuft of narrow wild-grass blades so pupils can directly manipulate the two populations in a poem field.

## Image assets

`bean-v1.webp` and `grass-v1.webp` were generated with `gpt-image-2` through the bundled imagegen skill CLI from text-only botanical prompts. Their foreground edges were cleaned locally while preserving thin stems and blades. Each contains true alpha transparency and was checked against light ivory and dark green backgrounds. No stock photograph, external artwork, logo, text, or answer label was supplied or included.

## 3D assets

`bean-v1.glb` and `grass-v1.glb` were generated from the same image references with Tripo `v3.1-20260211`, detailed geometry and PBR texture settings. Original models were retained locally. The web versions were simplified to 8,000 and 3,000 triangles respectively, with three embedded 1024-pixel PBR textures each and no external decoder. They were visually checked in actual WebGL from front, three-quarter, side, and back views.

Both models have their planting point on Y = 0, upward along positive Y, and front facing positive Z. The bean is 0.24 metres high; the grass is 0.20 metres high. Dimensions, SHA-256 hashes, source models, and visual validation are recorded in `plant-manifest-v1.json`. Service task IDs and account usage receipts are retained only in the local source evidence. Account secrets and signed resource URLs are excluded.

## Source and rights record

These are newly AI-generated project assets. Provider account terms apply; no Creative Commons, open-source, or public-domain licence is asserted. Exact prompts, original images, unmodified source GLBs, transparent-edge previews, multiview review images, generation receipts, and optimization scripts are retained in the local `maanshan-work/platform-upgrade-20260914/media` source folder and release backup.
