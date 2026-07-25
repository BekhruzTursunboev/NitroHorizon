# Pushing Nitro Horizon to GitHub

The connected GitHub integration can **read** repos and **push files**, but it does not
have permission to **create** repositories (`POST /user/repos` → 403). So the repo has to
exist first. Two options:

---

## Option A — let the agent push (fastest)

1. Go to **https://github.com/new**
2. Repository name: **`nitro-horizon`**
3. Visibility: **Public** (required for free GitHub Pages)
4. ✅ Tick **"Add a README file"** — this creates the `main` branch the agent pushes to
5. Click **Create repository**
6. Tell the agent *"repo created"* — it pushes every file in one commit

If your GitHub App is limited to selected repositories, also add the new repo at
**https://github.com/settings/installations** → *Configure* → *Repository access*.

---

## Option B — push it yourself

Download the zip from the chat (or use this folder), then:

```bash
cd nitro-horizon
git init -b main
git add .
git commit -m "feat: Nitro Horizon — 3D traffic racer (Three.js r185)"
git remote add origin https://github.com/<your-user>/nitro-horizon.git
git push -u origin main
```

### Turn on the live demo

Repo **Settings → Pages → Source: Deploy from a branch → `main` / `root` → Save**.

Your game goes live at `https://<your-user>.github.io/nitro-horizon/` in about a minute.
(The game is a static site with no build step, so Pages needs no configuration.)

---

## What gets pushed

```
index.html                    entry point (import map + UI)
style.css                     all styling
js/main.js                    the whole game (~2,000 lines)
lib/three.module.min.js       Three.js r185 core
lib/three.core.min.js         r185 internals
lib/jsm/…                     official post-processing addons
build-preview.mjs             dev helper (builds dist/preview.html for QA)
README.md, LICENSE, .gitignore
```

`lib/three.cjs.js` and `dist/` are only used by the preview bundler and are excluded from
the portal zip — they're harmless to commit but not required at runtime.
