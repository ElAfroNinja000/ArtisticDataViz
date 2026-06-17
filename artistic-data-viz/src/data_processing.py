import pandas as pd
import umap
import warnings
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

columns_to_keep = ['track_id', 'artist_name', 'track_name', 'genre',
                   'acousticness', 'danceability', 'energy', 'instrumentalness',
                   'liveness', 'speechiness', 'valence', 'tempo']
features = ['acousticness', 'danceability', 'energy', 'instrumentalness',
            'liveness', 'speechiness', 'valence', 'tempo']

# Rows the front-end renders. Must match MAX_POINTS in src/main.js.
FRONTEND_POINTS = 5000

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message="n_jobs value 1 overridden*")


def clean_data(max_rows = 45000):
    df = pd.read_csv("spotify_data/spotify_raw_data.csv")

    df = df[~df['genre'].isin(['Movie', 'Comedy'])]
    df_filtered = df[columns_to_keep].dropna()
    n_samples = min(max_rows, len(df_filtered))
    df_sample = df_filtered.sample(n=n_samples, random_state=42)

    scaler = StandardScaler()
    df_sample[features] = scaler.fit_transform(df_sample[features])

    return df_sample

def cluster_data(df, n_clusters = 10):
    kmeans = KMeans(n_clusters=n_clusters, random_state=42)
    df["cluster"] = kmeans.fit_predict(df[features])

    return df

def add_3d_coords(df):
    features_scaled = StandardScaler().fit_transform(df[features])

    # Réduction 3D avec UMAP
    reducer = umap.UMAP(n_components=3, random_state=42)
    coords = reducer.fit_transform(features_scaled)

    center = coords.mean(axis=0)
    coords_centered = coords - center

    scale = 10
    df["x"] = coords_centered[:, 0] * scale
    df["y"] = coords_centered[:, 1] * scale
    df["z"] = coords_centered[:, 2] * scale

    # Full dataset kept as the canonical archive (committed, never served).
    df.to_json("../data/spotify_clustered_3d.full.json", orient="records", force_ascii=False)
    # Lightweight subset the Vite front-end actually fetches at runtime.
    df.head(FRONTEND_POINTS).to_json("../public/spotify_clustered_3d.json", orient="records", force_ascii=False)
    print(f"✅ Exported {len(df)} rows (archive) + {min(FRONTEND_POINTS, len(df))} rows (front-end).")

def process_data():
    df = clean_data()
    df_clustered = cluster_data(df)
    add_3d_coords(df_clustered)


if __name__ == "__main__":
    process_data()