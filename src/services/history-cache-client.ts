/**
 * history-cache-client.ts
 *
 * Thin IndexedDB wrapper for caching EventGraphBundle results by topic slug.
 * Uses the `idb` library (already a project dependency).
 *
 * Stale threshold: 7 days. Callers receive `isStale: true` when the cached
 * record is older than that; they decide whether to re-fetch.
 */

import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { EventGraphBundle } from './history-graph-adapter';

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = 'perspective-os-history';
const STORE_NAME = 'topic-graphs';
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── DB schema ────────────────────────────────────────────────────────────────

interface TopicGraphRecord {
  slug: string;
  bundle: EventGraphBundle;
  cachedAt: number; // ms since epoch
}

// ─── Lazy DB open (module-level promise cache) ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- idb generic typing is handled via IDBPDatabase
let dbPromise: Promise<IDBPDatabase<any>> | null = null;

function getDB(): Promise<IDBPDatabase<any>> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slug' });
        }
      },
    });
  }
  return dbPromise;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve a cached EventGraphBundle for the given slug.
 * Returns null if no record exists.
 * Returns `{ bundle, isStale: true }` when the record is older than 7 days.
 */
export async function getCachedTopicGraph(
  slug: string,
): Promise<{ bundle: EventGraphBundle; isStale: boolean } | null> {
  try {
    const db = await getDB();
    const record: TopicGraphRecord | undefined = await db.get(STORE_NAME, slug);
    if (!record) return null;
    const isStale = Date.now() - record.cachedAt > STALE_THRESHOLD_MS;
    return { bundle: record.bundle, isStale };
  } catch {
    // IndexedDB unavailable (e.g. private browsing mode with strict settings)
    return null;
  }
}

/**
 * Write an EventGraphBundle to the cache under the given slug.
 * Overwrites any existing record.
 */
export async function setCachedTopicGraph(
  slug: string,
  bundle: EventGraphBundle,
): Promise<void> {
  const db = await getDB();
  const record: TopicGraphRecord = { slug, bundle, cachedAt: Date.now() };
  await db.put(STORE_NAME, record);
}

/**
 * Delete the cached record for the given slug.
 * No-op if no record exists.
 */
export async function clearCachedTopicGraph(slug: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, slug);
  } catch {
    // Best-effort — ignore errors
  }
}
