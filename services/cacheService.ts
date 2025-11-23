
import { TranslationRecord, TranslationResultPartial } from "../types";

const MAX_CACHE_SIZE = 50;

interface CacheEntry {
  data: TranslationResultPartial;
  timestamp: number;
}

const translationCache = new Map<string, CacheEntry>();

export const generateCacheKey = (text: string, sourceLang: string, targetLang: string): string => {
  return `${sourceLang}:${targetLang}:${text.trim().toLowerCase()}`;
};

export const getCachedTranslation = (key: string): TranslationResultPartial | null => {
  const entry = translationCache.get(key);
  if (entry) {
    // Refresh timestamp (LRU behavior)
    entry.timestamp = Date.now();
    return entry.data;
  }
  return null;
};

export const setCachedTranslation = (key: string, data: TranslationResultPartial) => {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest
    let oldestKey = '';
    let oldestTime = Infinity;
    
    for (const [k, v] of translationCache.entries()) {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey) translationCache.delete(oldestKey);
  }

  translationCache.set(key, {
    data,
    timestamp: Date.now()
  });
};
