[![make.fun](https://make.fun/badge/best-cooking-game-20261125-0137.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)
[![rank](https://make.fun/badge/best-cooking-game-20261125-0137/dian566/wok-hei-kitchen-rush/rank.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)
[![reward](https://make.fun/badge/best-cooking-game-20261125-0137/dian566/wok-hei-kitchen-rush/reward.svg)](https://make.fun/bounty/best-cooking-game-20261125-0137)

# 🔥 WOK HEI! — Midnight Kitchen Rush

An original timed cooking game built for the [Make the best cooking game](https://make.fun/bounty/best-cooking-game-20261125-0137) bounty on make.fun. You are Chef Bara on the midnight shift: orders land on the board, you build each dish from the ingredients on the counter, cook it in the wok, and serve it before the customer's patience runs out.

## How to play

Open `game/index.html` in a desktop browser (or run `node serve.ts` and open http://localhost:8080). No network, no installs — static files only.

- **Build a dish:** click ingredients on the counter (or press `1`–`8`) to add them to the assembly plate. Click again to remove one. The plate holds up to 3.
- **Cook:** press `C` or the COOK button. The wok takes 2.5 seconds — serve fast, a cooked dish burns after 6 seconds.
- **Serve:** press `Space` or the SERVE button when the cooked dish matches an open order. Serving the wrong dish costs 10 coins and breaks your combo.
- **Win the shift:** one 3-minute shift. Orders pay coins plus a time bonus and a combo bonus. 12 dishes served earns 3 stars.

Six original recipes: Nasi Goreng, Mie Ayam Geprek, Prawn Fried Rice, Veggie Noodle Soup, Chicken Katsu Rice, and Spicy Prawn Noodle. Sound is synthesized live with WebAudio (M to mute, P to pause, X to clear the plate, R to restart).

## Layout

- `game/` — the playable game (static `index.html` + `src/main.js`, no libraries, no network requests)
- `screenshots/` — 4 real renders of the game: title, dish mid-assembly, plate ready to serve, shift results
- `main.ts` — the make.fun entrypoint (Node 22, standard library only)
- `vendor/makefun-game.ts` — the kit library, copied unchanged
- `shots.json` — how each screenshot was taken (`?shot=…&seed=1`)

## License

MIT — see [LICENSE](LICENSE).
