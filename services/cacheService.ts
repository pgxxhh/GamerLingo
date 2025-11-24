
import { TranslationRecord, TranslationResultPartial } from "../types";

const MAX_CACHE_SIZE = 50;
const MAX_REVERSE_CACHE_SIZE = 100; // Store more short phrases
const MAX_TTS_CACHE_SIZE = 50;

interface CacheEntry {
  data: TranslationResultPartial;
  timestamp: number;
}

const translationCache = new Map<string, CacheEntry>();
const reverseTranslationCache = new Map<string, string>();
const ttsCache = new Map<string, string>();

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

  // Merge with existing if available (e.g., adding audio to existing text cache)
  const existing = translationCache.get(key);
  const newData = existing ? { ...existing.data, ...data } : data;

  translationCache.set(key, {
    data: newData,
    timestamp: Date.now()
  });
};

// --- Reverse Translation Cache ---

export const getCachedReverseTranslation = (text: string, targetLang: string): string | null => {
  const key = `${targetLang}:${text.trim()}`;
  return reverseTranslationCache.get(key) || null;
};

export const setCachedReverseTranslation = (text: string, targetLang: string, result: string) => {
  const key = `${targetLang}:${text.trim()}`;
  if (reverseTranslationCache.size >= MAX_REVERSE_CACHE_SIZE) {
    // Simple FIFO eviction for string map since we don't track timestamps here for simplicity
    const firstKey = reverseTranslationCache.keys().next().value;
    if (firstKey) reverseTranslationCache.delete(firstKey);
  }
  reverseTranslationCache.set(key, result);
};

// --- TTS Cache ---

export const getCachedTTS = (text: string): string | null => {
  return ttsCache.get(text.trim()) || null;
};

export const setCachedTTS = (text: string, base64: string) => {
  if (ttsCache.size >= MAX_TTS_CACHE_SIZE) {
    const firstKey = ttsCache.keys().next().value;
    if (firstKey) ttsCache.delete(firstKey);
  }
  ttsCache.set(text.trim(), base64);
};
