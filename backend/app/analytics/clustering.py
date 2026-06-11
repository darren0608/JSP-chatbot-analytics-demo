"""Unsupervised clustering of query embeddings (brief §9.4).

Implementation: greedy agglomerative "leader" clustering on cosine similarity
in NumPy — no fixed k, density-style behaviour at prototype scale, zero heavy
dependencies. Seam: swap `cluster_embeddings` for HDBSCAN/BERTopic when the
ML stack is installed (the interface returns plain label arrays either way).

Each run gets a run_id; history is kept so trends are comparable across runs.
Cluster labels come from the LLM provider's `complete` (local provider gives a
deterministic keyword label; an approved external LLM gives a fluent one).
"""
import uuid

import numpy as np

from ..config import settings


def cluster_embeddings(embeddings: list[list[float]],
                       threshold: float | None = None,
                       min_size: int | None = None) -> list[int]:
    """Returns a cluster label per row; -1 = noise (unclustered)."""
    threshold = threshold or settings.cluster_similarity_threshold
    min_size = min_size or settings.cluster_min_size
    if not embeddings:
        return []
    X = np.array(embeddings, dtype=float)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms

    centroids: list[np.ndarray] = []
    members: list[list[int]] = []
    for i, vec in enumerate(X):
        if centroids:
            sims = np.array([float(np.dot(vec, c) / (np.linalg.norm(c) or 1.0)) for c in centroids])
            best = int(np.argmax(sims))
            if sims[best] >= threshold:
                members[best].append(i)
                # incremental centroid update
                centroids[best] = X[members[best]].mean(axis=0)
                continue
        centroids.append(vec.copy())
        members.append([i])

    labels = [-1] * len(X)
    next_label = 0
    for group in members:
        if len(group) >= min_size:
            for idx in group:
                labels[idx] = next_label
            next_label += 1
    return labels


def new_run_id() -> str:
    return str(uuid.uuid4())


def project_2d(embeddings: list[list[float]]) -> list[tuple[float, float]]:
    """2D projection for the intent-explorer scatter. PCA via SVD (deterministic,
    dependency-free). Seam: replace with UMAP for better cluster separation."""
    if not embeddings:
        return []
    X = np.array(embeddings, dtype=float)
    X = X - X.mean(axis=0)
    if X.shape[0] < 3:
        return [(float(i), 0.0) for i in range(X.shape[0])]
    U, S, _ = np.linalg.svd(X, full_matrices=False)
    pts = U[:, :2] * S[:2]
    return [(round(float(x), 4), round(float(y), 4)) for x, y in pts]
