import { LemmaClient } from 'lemma-sdk'

// Shared Lemma client for this app. Config (podId / apiUrl / authUrl) is injected
// by the Lemma host as `window.__LEMMA_CONFIG__` when the app is served, so the
// SAME build runs on any pod/server — nothing pod-specific is baked in. During
// `vite dev` the host isn't in the loop, so the SDK falls back to the
// VITE_LEMMA_* values in .env.local (written by `lemma apps init`).
export const lemmaClient = new LemmaClient()
