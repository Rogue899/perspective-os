/**
 * api/_lib/slug.js
 * Canonical slug normalizer for topic-graph cache keys.
 * Pure ES module — no external deps.
 */

/**
 * Normalize a free-text query into a stable cache slug.
 * Steps:
 *  1. Lowercase
 *  2. Strip non-letter / non-number / non-space / non-hyphen characters (Unicode-aware)
 *  3. Collapse whitespace
 *  4. Trim
 *  5. Sort tokens alphabetically (canonical form — "Iran West" ≡ "West Iran")
 *  6. Join with hyphens
 *
 * @param {string} query
 * @returns {string}
 */
export function normalizeSlug(query) {
  if (typeof query !== 'string') throw new Error('query must be a string');
  const cleaned = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) throw new Error('query cannot be empty');
  return cleaned.split(' ').sort().join('-');
}
