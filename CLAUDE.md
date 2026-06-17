# CLAUDE.md

Guidance for Claude Code when working in this repository.

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
    spotify_clustered_3d.json # generated data, served at site root, fetched at runtime
  src/
    main.js                   # Three.js scene: InstancedMesh of tracks, hover, click->YouTube
    background.js             # Shader gradient background (separate ortho scene)
    yt_player.js             # YouTube IFrame player + playerReady promise
    data_processing.py       # Python pipeline: clean -> KMeans -> UMAP -> JSON
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
python data_processing.py   # reads spotify_data/spotify_raw_data.csv -> writes ../public/spotify_clustered_3d.json
```

Install deps with `pip install -r artistic-data-viz/requirements.txt`
(`pandas`, `scikit-learn`, `umap-learn`).

## How it works

**Data pipeline** (`data_processing.py`):
- Keeps 8 audio features (`acousticness`, `danceability`, `energy`,
  `instrumentalness`, `liveness`, `speechiness`, `valence`, `tempo`).
- Drops `Movie`/`Comedy` genres, samples up to 45k rows, standardizes features.
- `KMeans(n_clusters=10)` assigns a `cluster` to each track.
- `UMAP(n_components=3)` reduces features to centered, scaled `x/y/z` coordinates.
- Exports records to `public/spotify_clustered_3d.json` (fetched at runtime by `main.js`).

**Front-end** (`main.js`):
- `fetch`es the JSON from the site root at runtime (top-level await), then builds one
  `THREE.InstancedMesh` of spheres. Kept out of the bundle to stay small.
- Each instance is colored by its `cluster` (10-color spectral palette).
- Per-frame animation: vertical sine "float" + color flicker.
- Hover detection projects every point to screen space and picks the nearest within
  a pixel threshold, then shows a `CSS2DObject` label (`artist - title, genre`).
- Click queries the YouTube Data API for the hovered track and loads it into the
  embedded player (`yt_player.js`).

## Conventions & gotchas

- The JSON is loaded via `fetch(\`${import.meta.env.BASE_URL}spotify_clustered_3d.json\`)`
  from `public/`, which Vite serves at the site root. It is committed (so deploys work);
  the raw CSV in `spotify_data/` and `.env` are gitignored.
- After re-running the pipeline, the fresh JSON lands in `public/` directly — no copy step.
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
