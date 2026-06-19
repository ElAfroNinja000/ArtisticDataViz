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
    spotify_clustered_3d.json # full 45k dataset served at site root, fetched at runtime
  data/
    spotify_clustered_3d.full.json # full 45k dataset, committed archive
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
python data_processing.py   # CSV -> ../data/...full.json (45k archive) + ../public/...json (served)
```

The pipeline writes two files: the full dataset to `data/` (canonical archive) and a
`FRONTEND_POINTS`-row subset to `public/` (what the app fetches). `FRONTEND_POINTS` is
currently `45000`, so `public/` holds the whole set; the front-end then caps how many
of those actually render via a UI slider ("Capacity", default 50%).

Install deps with `pip install -r artistic-data-viz/requirements.txt`
(`pandas`, `scikit-learn`, `umap-learn`).

## How it works

**Data pipeline** (`data_processing.py`):
- Keeps 8 audio features (`acousticness`, `danceability`, `energy`,
  `instrumentalness`, `liveness`, `speechiness`, `valence`, `tempo`).
- Drops `Movie`/`Comedy` genres, samples up to 45k rows, standardizes features.
- `KMeans(n_clusters=10)` assigns a `cluster` to each track.
- `UMAP(n_components=3)` reduces features to centered, scaled `x/y/z` coordinates.
- Exports the full set to `data/...full.json` (archive) and to
  `public/spotify_clustered_3d.json` (fetched at runtime by `main.js`). With
  `FRONTEND_POINTS = 45000` the two files are currently identical.

**Front-end** (`main.js`):
- `fetch`es the JSON from the site root at runtime (top-level await), with a loading
  overlay (and an error message on failure). Kept out of the bundle.
- Builds one `THREE.InstancedMesh` allocated for the **full** dataset; positions and
  per-`cluster` colors (10-color spectral palette) are set **once**.
- **Animation runs on the GPU**: `MeshBasicMaterial.onBeforeCompile` injects a `uTime`
  uniform driving the vertical float + brightness flicker, and a `uSelected` uniform that
  scales/whitens the active sphere. The render loop only updates `uTime` — flat per-frame
  CPU cost regardless of how many spheres show. (This is what makes 45k viable; the old
  per-frame CPU rebuild capped out around 5–8k.)
- **How many render is user-controlled**: `instancedMesh.count` is driven by a
  bottom-right "Capacity" slider (chip ⇄ panel) shown as a percentage of the full
  dataset (default 50%). Changing it is instant (just sets `.count`).
- **Picking** is a depth-aware `Raycaster` against the InstancedMesh (front-most wins,
  occlusion handled). Hover raycast runs at most once per frame; touch probes a few
  offsets around the tap for a forgiving hit. The tooltip follows the cursor (upper-right).
- Click/tap queries the YouTube Data API and plays the track in a **hidden** iframe
  (`yt_player.js`); a "now playing" banner shows artist/title/genre + play-pause and a
  button that copies the `https://youtu.be/<id>` link. On mobile (≤600px) the banner
  becomes a full-width top band and the Capacity control sits bottom-right.

## Conventions & gotchas

- The JSON is loaded via `fetch(\`${import.meta.env.BASE_URL}spotify_clustered_3d.json\`)`
  from `public/`, which Vite serves at the site root. Both the `public/` subset and the
  `data/` archive are committed (so deploys work and the full dataset is preserved); only
  the raw CSV in `spotify_data/` and `.env` are gitignored.
- The full dataset (`data/...full.json`) is the canonical artifact — never delete it to
  "save space"; the served `public/` file is regenerable from it (currently the full set).
- **Secret hygiene:** the YouTube API key is read from `import.meta.env.VITE_YT_API_KEY`
  (set in `.env`, never committed). Do not inline keys in source. Note: the previously
  committed key in git history is compromised and should be rotated in the Google Cloud
  console.
- The UI and user-facing strings are in English. The Python pipeline still has some
  French comments; new front-end code should be English.

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
