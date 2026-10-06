# Sound market assets

Created for the AIDUCATION Maanshan poetry learning platform on 2026-09-14.

## Images

`sound-market-v1.webp` is a neutral illustrated market stall. `sound-pod-v1.webp` is a wooden listening capsule. Both were generated with `gpt-image-2` through the bundled imagegen skill CLI, then had their backgrounds extracted locally. The retained WebP files contain real alpha transparency and were inspected on ivory and dark teal backgrounds. Neither image contains letters, words, pinyin, numbers, or question answers.

The visual direction is restrained sage teal, ivory canvas, honey oak, natural fibres, and finely textured surfaces. The stall serves as the actual listening-and-sorting play space; the capsule serves as a sound playback control.

## Interactive model

`sound-pod-v1.glb` was generated from the new capsule reference image with Tripo `v3.1-20260211`, detailed geometry and PBR textures. The original output was retained locally. The web version has 35,000 triangles and three embedded 1024-pixel material textures, totals approximately 1.24 MB, and needs no external geometry decoder. Its brass sound opening faces positive Z and its cord loop points upward along Y. The final object was inspected from front, three-quarter, side, and back views in WebGL.

## Provenance and rights record

These are newly generated project assets, not copied open-source illustrations. No external reference photographs, characters, logos, stock imagery, or third-party artwork were supplied to the generator. They are recorded as AI-generated material under the generation providers' applicable account terms; no Creative Commons or public-domain licence is asserted.

Original outputs, exact generation prompts, extraction scripts, alpha checks, and service receipts are retained in the project's local `maanshan-work/challenge-redesign-20260914/media` source folder and release backup. Service credentials and signed download URLs are excluded from this public directory.

## Poetry observation and field assets

The four mountain/early-spring WebP observation pictures were rendered from this site's existing Tripo models with their original geometry and PBR materials. Mountain cameras show the X and Z directions; the early-spring cameras compare a low distant view and a closer downward inspection of the same patch. Pictures have no answer captions. `field-soil-v1.webp` is the 512-pixel rendition of the existing GPT Image 2 soil material embedded in the approved fifth-grade field model. The adjustable plant display is original code, with stable positions and visibly different plant densities; it is a learning illustration rather than a geographical or botanical reconstruction.

## Sound question forms (2026-10-06)

The listening multiple-choice questions use two story forms. Round one (poems 1-6) is a little doctor's clinic: `clinic-v1.webp` shows a poorly bunny patient who is tapped to hear the sound, `clinic-well-v1.webp` shows the same patient recovered after a correct answer, and `clinic-bottles-v1.webp` is a four-cell sprite of blank medicine bottles whose white labels carry the on-screen answer text. Round two (poems 7-12) is a police line-up: `police-v1.webp` shows a puppy officer holding a walkie-talkie, `police-caught-v1.webp` shows the same officer after the suspect is caught, and `police-lineup-v1.webp` is a four-cell sprite of animal suspects holding blank placards.

All six were generated with `gpt-image-2` (1536x1024, high quality) through the local image helper; `clinic-well` and `police-caught` were edits of the matching base scene so the character stays the same. They were then cropped, resized, background-extracted (bottles only) and encoded as WebP locally with Pillow. No image contains letters, words, pinyin, numbers or answers; labels and tone marks are drawn by the page. The same provenance and rights record as above applies.

## Sound question forms: wrong-answer scenes (2026-10-07)

After a wrong (or skipped) answer the listening scene now cross-fades to a sad version of the same character instead of staying on the base scene. `clinic-cry-v1.webp` shows the round-one bunny patient crying (ears drooping, tears, a paw rubbing one eye) and `police-sad-v1.webp` shows the round-two puppy officer looking very sad (drooping ears, a small tear, walkie-talkie lowered onto the desk). A correct answer still shows `clinic-well-v1.webp` / `police-caught-v1.webp`.

Both were generated with `gpt-image-2` (1536x1024, high quality) through the local image helper as edits of `clinic-v1` and `police-v1`, so the room, camera and character stay the same, then resized to 1152x768 and encoded as WebP (quality 76) locally with Pillow, exactly like the other scenes. No image contains letters, words, pinyin, numbers or answers. The same provenance and rights record as above applies.

## Sound question forms: treasure chest and supermarket (2026-10-07)

Two more listening forms join the police line-up and the clinic. The beach treasure hunt: `chest-v1.webp` shows a little fox explorer holding a seashell to its ear, `chest-found-v1.webp` shows the same fox holding an open chest of treasure after a right answer, `chest-trap-v1.webp` shows the fox startled by a joke spring trap after a wrong or skipped one, and `chest-boxes-v1.webp` is a four-cell sprite of closed chests with blank name plates. The supermarket: `shop-v1.webp` shows a kitten with a shopping list and a trolley, `shop-happy-v1.webp` the same kitten happy with the right item, `shop-sad-v1.webp` the kitten sad holding the wrong item, and `shop-goods-v1.webp` is a four-cell sprite of goods on a shelf with blank hanging tags.

All eight were generated with `gpt-image-2` (1536x1024, high quality) through the local image helper; the found/trap and happy/sad scenes were edits of the matching base scene so the place and character stay the same. They were then resized to 1152x768 (scenes, WebP quality 76) or cut into label-centred cells (chests background-extracted to transparency, quality 82; goods quality 80) locally with Pillow. No image contains letters, words, pinyin, numbers or answers; plate and tag text and tone marks are drawn by the page. The same provenance and rights record as above applies.
