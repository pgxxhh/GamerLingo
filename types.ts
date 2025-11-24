
export interface TranslationRecord {
  id: string;
  originalText: string;
  translatedText: string;
  imagePrompt?: string;
  imageUrl?: string;
  audioData?: string;
  tags: string[]; // e.g., ["Toxic", "Hype", "Neutral"]
  timestamp: number;
  sourceLang: string; // Added for reverse translation context
  targetLang: string;
}

export interface TranslationResultPartial {
  slang: string;
  visual_description: string;
  tags: string[];
  audioData?: string; // Added for caching
}

export interface LoadingState {
  status: 'idle' | 'recording' | 'translating_text' | 'loading_assets' | 'success' | 'error';
  message?: string;
}

export interface SlangResponse {
  slang: string;
  visual_description: string;
  tags: string[];
}

export interface ShadowResult {
  score: number;
  feedback: string;
}

export type LanguageCode = 'auto' | 'zh' | 'en' | 'jp' | 'kr' | 'es' | 'fr' | 'ru' | 'id' | 'ms' | 'th' | 'vi' | 'tl';

export interface LanguageOption {
  code: LanguageCode;
  label: string;
}
