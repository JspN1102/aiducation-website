# Optional process callback

`mountPoemGame`, each active game mount, and `mountExploration` accept
`onResearch(type, fields)`. The parent supplies the session, pupil, poem,
attempt, timestamp, sequence and version envelope. Callback rejection or
throwing never stops gameplay. Destruction disables subsequent callbacks.

All child events use `context.itemType: "microgame"`. Games leave `mode`
unset so the parent retains `standard`, `advanced`, or `review`. Exploration
uses `free`; the rain game's explicit replay uses `free` as well. Correct and
incorrect steps always have `score: null` and describe client-observed process
feedback, never speech or assessment scores. The parent owns `activity_end`;
the child's completion is one `item_interacted` with `choiceId: "completed"`.
Restored completion or revealing a solution does not create a fresh success.

| Activity | Stable child item IDs | Responses |
| --- | --- | --- |
| Goose colour game | `game.goose.feather`, `.palm`, `.water` | `white`, `red`, `green` |
| Farewell story | `game.farewell.boat`, `.beat.0`–`.beat.3`, `.ticket.0`–`.ticket.2` | `water` / `outside-water`, `left` / `right`, `ticket.N` |
| Mountain photography | `game.mountain.ridge`, `.peak` | `ridge`, `middle`, `peak`; no capture/image data |
| River puzzle | `game.river.slot.0`–`.slot.5` | `piece.0`–`piece.5` |
| Garden tending | `game.garden.bean-a`–`.bean-c`, `.weed-a`–`.weed-h` | `pull`; weed correct, bean incorrect |
| Rain character catcher | `game.rain.word.0`–`.word.4` | `option.N`, indexed in the original round options; `optionOrder` records shuffled display order |
| Exploration | `pN.explore.observation.0`, `.observation.1` | `choice.N`, indexed in that observation's choices |

`item_presented` records an actual step presentation; re-rendering cannot
duplicate it. A new rain wave does present its shuffled options again.
`answer_submitted` and `feedback_shown` describe each attempt. `attemptNo` is
the local count for that child step; repeated attempts emit `retry`. This
does not create another parent challenge attempt. Incorrect attempts with
an explanatory clue emit `hint_used`; requested audio/demo/reveal have their
own hint kinds. Loading failure and retry use stable `assets`, `model`,
`image`, `audio`, or `module` suffixes and approved error codes.

Camera rotation is recorded at range `change`, pointer release, keyboard
release, or OrbitControls `end`. Zoom and reset buttons emit one action.
There are no pointer paths, coordinates, angles, frames, audio, handwriting,
free text, pupil names, or images in these payloads. Ordinary scene state and
the pre-existing `onState` callback remain independent of this event channel.

Validation:

```powershell
node --test server/poem-games-research.test.cjs
$env:PLAYWRIGHT_MODULE = '<local Playwright package path>'
node server/poem-games-research.browser.test.cjs
```

The browser check completes all six games and exploration, validates every
event with the actual server schema, and checks that process correctness is
excluded from assessment aggregates. It stubs the mountain game model loader
to isolate game interactions; camera gesture checks use actual Three.js and
OrbitControls with a local test cube. It does not call speech, AI, or account
APIs and does not write production research records.
