# 🏎️ Nitro Horizon — 3D Traffic Racer

**Outrun the traffic. Own the night.**

[![Play](https://img.shields.io/badge/▶%20PLAY-live%20demo-4be1ff?style=for-the-badge)](https://bekhruztursunboev.github.io/NitroHorizon/)
[![three.js](https://img.shields.io/badge/three.js-r185-black?style=for-the-badge&logo=three.js)](https://threejs.org)
[![License](https://img.shields.io/badge/license-MIT-ffc850?style=for-the-badge)](LICENSE)

> **Enable the live demo:** repo **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save.**
> The game is a static site with no build step, so Pages needs no extra configuration.

A slick, fast, fully 3D endless traffic racer built as a pure **HTML5 web game** with [Three.js](https://threejs.org). Weave through highway traffic at 300 km/h, chain near-miss combos, grab coins, slam the nitro — and watch the world cycle from golden dawn through blazing noon into a neon-soaked night with working headlights, street lamps and a glowing city skyline.

> **Zero external assets. Zero build step. Zero dependencies to install.**
> Every texture, model, sound effect and the synthwave soundtrack is generated procedurally in code. The only vendored file is `lib/three.min.js`. That means the game works completely offline — exactly what web-game portals like CrazyGames and Yandex Games want.

---

## ✨ Features

- **Three.js r185 (latest) as native ES modules** with an import map — no deprecated global build, no bundler, no build step
- **Real post-processing** — `EffectComposer` + `UnrealBloomPass` + a custom radial **speed-blur / vignette / grade** pass: true HDR bloom on headlights, taillights, street lamps and nitro flames, plus the image streaking outward from the vanishing point as speed rises (tapered to keep the car sharp), all dynamically scaled by time of day, boost and slip
- **Fixed-timestep simulation (120 Hz)** — physics are decoupled from the render rate with an accumulator, so handling is identical whether you're at 30, 60 or 144 fps
- **Arcade attract-mode menu** — the game world is the backdrop, framed by cabinet-style corner brackets, a cinematic dolly camera on the car, and a scrolling tip ticker
- **Installable (PWA)** — web-app manifest with fullscreen landscape display, so it can be added to a phone's home screen
- **Genuine vehicle physics** — force-based longitudinal model (engine torque curve vs. quadratic aero drag + rolling resistance + brake force), a **6-speed gearbox** with audible shifts and RPM-driven engine note, and a **lateral tyre model with slip**: overdrive the grip and the car drifts, smokes and howls, with body yaw following the slide
- **Ghost replay** — your best run is recorded and replayed as a translucent car you race side-by-side (toggleable in the menu)
- **Real 3D graphics** — dynamic sun with soft shadows, ACES filmic tone mapping, PBR car paint with clearcoat, environment reflections, distance fog
- **Sculpted car bodies** — every vehicle (player + 4 traffic types) is an extruded side-profile with beveled, rounded edges: real hoods, raked windshields, kamm tails — not stacked boxes; plus soft contact shadows that ground every car
- **Suspension physics** — the chassis pitches under braking/nitro (weight transfer), rolls into steering, and hums with speed-dependent road bumps over planted, spinning, front-steering wheels; lateral inertia makes the car feel heavy at 300 km/h
- **Overhead sign gantries** — "NITRO CITY 24" style highway signs sweep overhead as speed landmarks (self-lit at night)
- **Full day/night cycle** (~3.5 min) — sunrise, noon, sunset, starry night; street lamps, headlights, neon underglow and lit skyscraper windows fade in automatically
- **Endless highway** — 4 lanes, recycled traffic with lane-based speeds (trucks keep right), guard rails, dunes, palms, rocks, mountains, drifting clouds
- **Arcade feel** — near-miss combo scoring, coin rows, nitro pickups + boost with FOV kick, speed lines, crash slow-mo with tumbling wreck physics and debris
- **Detailed supercar** — low wide stance with tapered greenhouse, carbon splitter & rear diffuser, flared arches, swan-neck wing, side mirrors, hood vents, quad chrome exhausts, full-width LED taillight bar, staggered wheels with alloy rims, brake discs and red calipers
- **DRIFT scoring** — break traction and hold the slide to bank points (paid out when you land it), leaving real rubber skid marks on the asphalt
- **Survivable side-swipes** — a glancing hit no longer instantly kills you: both cars get shoved apart in a shower of sparks, you lose speed and your combo, and you fight to keep it straight. Only proper head-on impacts are fatal
- **Traffic AI** — drivers notice you closing fast in their mirror and edge aside to let you through, then drift back to their lane
- **OVERDRIVE mode** — chain 4+ near-misses to trigger a 7-second ×2 score frenzy with orange underglow
- **Brake control** (`S`/`↓`/BRAKE button) — with glowing brake lights and skid audio; nitro slowly self-regenerates; +500 bonus at every kilometre milestone
- **Cheap-bloom glow sprites** — sun halo, street-lamp glows, headlight/taillight blooms and night-time taillight light-trails, all without post-processing
- **FPS counter + dynamic resolution scaling** — the renderer automatically drops/restores internal resolution to hold 60 fps on weak devices
- Fun extra: force the time of day with a URL hash — `#dawn`, `#day`, `#sunset`, `#night`
- **Procedural audio** — engine + wind synthesis tied to speed, coin/nitro/crash SFX, and a generative synthwave music loop (WebAudio, no audio files)
- **Desktop + mobile** — keyboard on desktop, hold-to-steer touch zones + N₂O button on phones
- **3 quality presets** — pixel ratio / shadow resolution / draw distance (auto-defaults to MED on touch devices)
- **Portal-ready** — CrazyGames & Yandex Games SDKs auto-detected at runtime (init, loading-ready, gameplayStart/Stop, happytime)
- Pause on tab blur, safe `localStorage` (works in sandboxed iframes), high-score persistence

## 🎮 Controls

| Action | Desktop | Mobile |
|---|---|---|
| Steer | `A` / `D` or `←` / `→` | Hold left / right side of screen |
| Nitro | `Shift`, `N` or `Space` | Hold the N₂O button |
| Brake | `S` or `↓` | Hold the BRAKE button |
| Pause | `P` or `Esc` | — |
| Start / Retry | `Enter` | Tap button |

**Scoring:** distance × speed + 25 per coin + 50 × combo per near-miss + banked drift points + 500 per kilometre. Nitro gives a 1.5× score rate; OVERDRIVE doubles everything.

**Pro tip:** brake *into* a lane change to load the front tyres, then get back on the power — you'll break traction and bank drift points while you thread the gap.

## 🚀 Run it

It's a static site — any web server works:

```bash
npx serve .          # or: python3 -m http.server 8080
```

Open `http://localhost:3000`. (ES modules require http — `file://` will be blocked by CORS.)

## 📁 Project layout

```
index.html              page shell, import map, HUD/menu UI, portal SDK comments
style.css               all UI styling
js/main.js              the entire game (~1,750 lines, heavily sectioned)
lib/three.module.min.js Three.js r185 core (vendored — keeps the game offline-capable)
lib/three.core.min.js   r185 internals (imported by the above)
lib/jsm/…               official post-processing addons (EffectComposer, UnrealBloom, …)
build-preview.mjs       dev helper: bundles everything into dist/preview.html for QA
```

Because the game ships as ES modules, open it through a web server (`npx serve .`) rather than `file://`.

Tuning lives at the top of the relevant sections in `js/main.js`: lane positions, speeds, day-cycle palette (`RAW_STOPS`), spawn distances, quality presets.

---

## 🕹️ Publishing to CrazyGames

1. Zip the game: `zip -r nitro-horizon.zip index.html style.css js lib`
2. Create an account at [developer.crazygames.com](https://developer.crazygames.com) → **Submit game** → HTML5.
3. Upload the zip. Entry point is `index.html`. Recommended category: Driving / Racing.
4. *(Recommended)* Enable the CrazyGames SDK: uncomment this line in `index.html`:
   ```html
   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
   ```
   The game auto-detects it and already calls `init()`, `loadingStop()`, `gameplayStart()/gameplayStop()` and `happytime()` (on new best score) — see the `Portal` object in `js/main.js`. Hook rewarded ads there if you want revive/double-coins mechanics.
5. Pass the QA tool (the game already satisfies the usual checks: loads fast, works in an iframe, no external requests, pauses on blur, touch support).

## 🕹️ Publishing to Yandex Games

1. In `index.html`, uncomment the Yandex SDK line (the path is served by Yandex itself):
   ```html
   <script src="/sdk.js"></script>
   ```
2. Zip the folder (same as above) — all resources are local, which Yandex **requires** (no external CDNs; that's why Three.js is vendored).
3. Go to the [Yandex Games Console](https://games.yandex.com/console) → create a draft → upload the zip.
4. The game auto-calls `YaGames.init()` and `features.LoadingAPI.ready()` after the first rendered frame — both are required for moderation.
5. Fill in the game card (RU + EN descriptions recommended), add screenshots, submit for moderation.

## 🌐 Publishing to GitHub Pages (instant demo link)

Repo **Settings → Pages → Source: Deploy from a branch → `main` / root**. Your game goes live at `https://<user>.github.io/nitro-horizon/`.

---

## 🛡️ Stability

The game is built to survive the messy realities of running in a browser tab:

- **Swept collision detection** — at 300 km/h a frame advances ~4 m, so simple overlap tests let cars and coins tunnel straight through you. Cars, coins and pickups all test the *path* travelled during the frame, not just the end position.
- **Crash-proof frame loop** — an exception in one frame is logged and skipped instead of freezing the game; if the render call itself fails, post-processing is dropped rather than stopping the draw.
- **WebGL context loss recovery** — backgrounding a mobile tab or a driver reset used to leave a permanently black canvas; the context is now released cleanly and the game resumes when it returns.
- **Input safety** — held keys and touch controls are released on blur/pause (pointer capture keeps a finger sliding off a button from sticking the throttle on), and key-repeat can't rapid-toggle pause.
- **Audio hygiene** — the music sequencer re-anchors after a tab suspend instead of dumping a burst of stacked notes, and leaving the pause screen always restores audio.
- **State hygiene** — starting a run or returning to the menu clears traffic, coins, particles, skid marks, popups and every transient flag, so nothing bleeds between runs.
- Corrupt saved data (high score, ghost replay) is validated and ignored rather than crashing the game.

Add `#debug` to the URL to surface the on-screen error reporter while testing.

## 🧠 Tech notes

- Single scrolling-texture road/ground/rails (no geometry recycling for the road = fewer draw calls); pooled + recycled traffic, lamps, scenery, coins (InstancedMesh), particles (InstancedMesh), speed lines
- No allocations in the frame loop; ~190 draw calls typical; designed to hold 60 fps on mid-range phones at MED
- The sky is a custom shader dome (gradient + sun disc + twinkling stars) that participates in the same tone-mapping pipeline as the scene, so fog always blends seamlessly
- Crash uses a slow-mo timescale, impulse tumble and instanced debris

## 📄 License

MIT — do whatever you like. A credit link is appreciated but not required.
