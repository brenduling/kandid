const cache = new Map();

export function getCachedValue(key, maxAgeMs = 5 * 60 * 1000) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() - item.timestamp > maxAgeMs) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

export function setCachedValue(key, value) {
  cache.set(key, {
    value,
    timestamp: Date.now(),
  });
  return value;
}

export function clearCachedValue(key) {
  cache.delete(key);
}

export function clearSessionCache() {
  cache.clear();
}
