# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Working agreement (directives from the project owner)

- **Stay strictly in scope.** Implement only what was explicitly requested. If a task
  seems to require any change outside the agreed scope, **stop and flag it for approval
  first** — do not make out-of-scope changes on your own initiative.
- **Never deploy.** The owner handles all deployments. Do **not** push to `master`
  (it auto-deploys to Vercel) and never trigger a redeploy by any means. Commit work to
  a feature branch and let the owner deploy on their own schedule.

## Project overview

**ArtisticDataViz** is an interactive, artistic 3D visualization of Spotify track
data. It has two distinct halves:

1. **Python data pipeline** — cleans raw Spotify data, clusters it, and reduces it
   to 3D coordinates for rendering.
2. **JavaScript front-end** — a Three.js scene (bundled with Vite) that renders each
   track as an animated sphere, with hover labels and click-to-play via YouTube.

The web app lives in the `artistic-data-viz/` subdirectory. The Python pipeline lives
in `artistic-data-viz/src/`.

## Repository layout

```
artistic-data-viz/
  index.html                  # Vite entry point
  package.json                # Vite + three deps
  public/
    spotify_clustered_3d.json # 5k-row subset served at site root, fetched at runtime
  data/
    spotify_clustered_3d.full.json # full 45k dataset, committed archive (never served)
  src/
    main.js                   # Three.js scene: InstancedMesh of tracks, hover, click->YouTube
    background.js             # Shader gradient background (separate ortho scene)
    yt_player.js             # YouTube IFrame player + playerReady promise
    data_processing.py       # Python pipeline: clean -> KMeans -> UMAP -> JSON (full + subset)
    style.css
    spotify_data/            # (gitignored) raw input CSV only
      spotify_raw_data.csv
  requirements.txt            # Python deps for the pipeline
  .env.example                # template for VITE_YT_API_KEY (copy to .env)
  .env                        # (gitignored) real YouTube API key
README.md
```

## Commands

Run all JS commands from `artistic-data-viz/`:

```bash
cd artistic-data-viz
npm install          # install deps (vite, three)
cp .env.example .env # then fill in VITE_YT_API_KEY (required for click-to-play)
npm run dev          # start Vite dev server
npm run build        # production build
npm run preview      # preview the build
```

Python data pipeline (run from `artistic-data-viz/src/` so the relative
`spotify_data/...` paths resolve):

```bash
cd artistic-data-viz/src
python data_processing.py   # CSV -> ../data/...full.json (45k archive) + ../public/...json (5k served)
```

The pipeline writes two files: the full dataset to `data/` (canonical archive) and a
`FRONTEND_POINTS`-row subset to `public/` (what the app fetches). Keep `FRONTEND_POINTS`
in `data_processing.py` in sync with `MAX_POINTS` in `src/main.js`.

Install deps with `pip install -r artistic-data-viz/requirements.txt`
(`pandas`, `scikit-learn`, `umap-learn`).

## How it works

**Data pipeline** (`data_processing.py`):
- Keeps 8 audio features (`acousticness`, `danceability`, `energy`,
  `instrumentalness`, `liveness`, `speechiness`, `valence`, `tempo`).
- Drops `Movie`/`Comedy` genres, samples up to 45k rows, standardizes features.
- `KMeans(n_clusters=10)` assigns a `cluster` to each track.
- `UMAP(n_components=3)` reduces features to centered, scaled `x/y/z` coordinates.
- Exports the full set to `data/...full.json` (archive) and a 5k subset to
  `public/spotify_clustered_3d.json` (fetched at runtime by `main.js`).

**Front-end** (`main.js`):
- `fetch`es the JSON from the site root at runtime (top-level await), shows a loading
  overlay until it resolves (or an error message on failure), slices to `MAX_POINTS`
  (5000) as a safety net, then builds one `THREE.InstancedMesh` of spheres. Kept out of
  the bundle to stay small.
- Uses `MeshBasicMaterial` (no lighting) and per-frame buffers are reused (no per-frame
  allocations); the hover projection pass is skipped when the mouse hasn't moved.
- Each instance is colored by its `cluster` (10-color spectral palette).
- Per-frame animation: vertical sine "float" + color flicker.
- Hover detection projects every point to screen space and picks the nearest within
  a pixel threshold, then shows a `CSS2DObject` label (`artist - title, genre`).
- Click queries the YouTube Data API for the hovered track and loads it into the
  embedded player (`yt_player.js`).

## Conventions & gotchas

- The JSON is loaded via `fetch(\`${import.meta.env.BASE_URL}spotify_clustered_3d.json\`)`
  from `public/`, which Vite serves at the site root. Both the `public/` subset and the
  `data/` archive are committed (so deploys work and the full dataset is preserved); only
  the raw CSV in `spotify_data/` and `.env` are gitignored.
- The full dataset (`data/...full.json`) is the canonical artifact — never delete it to
  "save space"; the served `public/` file is a regenerable 5k subset of it.
- **Secret hygiene:** the YouTube API key is read from `import.meta.env.VITE_YT_API_KEY`
  (set in `.env`, never committed). Do not inline keys in source. Note: the previously
  committed key in git history is compromised and should be rotated in the Google Cloud
  console.
- Comments and console messages mix French and English; match the surrounding file.

## Deployment (Vercel)

Static Vite build. In the Vercel project settings:
- **Root Directory:** `artistic-data-viz` (the app is in a subdirectory).
- Framework preset **Vite** is auto-detected (build `npm run build`, output `dist`).
- Add env var **`VITE_YT_API_KEY`**. Note `VITE_*` vars are inlined into the client
  bundle, so the key is public regardless — restrict it by HTTP referrer (the
  `*.vercel.app` domain) in the Google Cloud console instead of relying on secrecy.
- **Gotcha:** `VITE_*` vars are inlined **at build time**. If `VITE_YT_API_KEY` is
  missing (or added after the live build), the deployed bundle ships `key=undefined`,
  YouTube returns `403`, and every click shows "Vidéo non trouvée". Setting the var
  requires a **fresh redeploy** to take effect.
