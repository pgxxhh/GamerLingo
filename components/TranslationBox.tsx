
import React, { useState } from 'react';
import { TranslationRecord, LanguageCode, LoadingState } from '../types';
import { translateText, generateSpeech /*, generateImage */ } from '../services/geminiService';
import { generateCacheKey, getCachedTranslation, setCachedTranslation } from '../services/cacheService';
import InputArea from './InputArea';
import ResultDisplay from './ResultDisplay';
import { Zap } from 'lucide-react';

interface TranslationBoxProps {
  onNewTranslation: (record: TranslationRecord) => void;
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
};

const TranslationBox: React.FC<TranslationBoxProps> = ({ onNewTranslation }) => {
  const [loadingState, setLoadingState] = useState<LoadingState>({ status: 'idle' });
  const [currentResult, setCurrentResult] = useState<TranslationRecord | null>(null);

  const handleTranslate = async (input: string | Blob, source: LanguageCode, target: LanguageCode) => {
    setLoadingState({ status: 'translating_text' });
    setCurrentResult(null);

    const isText = typeof input === 'string';
    const cacheKey = isText ? generateCacheKey(input as string, source, target) : null;
    let cachedData = cacheKey ? getCachedTranslation(cacheKey) : null;

    try {
      // Step 1: Text Translation (or Cache Hit)
      let textData;
      if (cachedData) {
        textData = cachedData;
      } else {
        textData = await translateText(input, source, target);
        if (cacheKey) setCachedTranslation(cacheKey, textData);
      }

      // Initialize Record immediately so user sees text
      const newRecord: TranslationRecord = {
        id: Date.now().toString(),
        originalText: isText ? (input as string) : '[Voice Input]',
        translatedText: textData.slang,
        imagePrompt: textData.visual_description,
        tags: textData.tags,
        timestamp: Date.now(),
        sourceLang: source, // Store source language
        targetLang: target,
        imageUrl: undefined, // Loading
        audioData: cachedData?.audioData // Use cached audio if available!
      };

      setCurrentResult(newRecord);

      // If we already have audio from cache, we are essentially done.
      // Otherwise, we load assets.
      if (newRecord.audioData) {
        onNewTranslation(newRecord);
        setLoadingState({ status: 'success' });
        return;
      }

      setLoadingState({ status: 'loading_assets' });

      // Step 2: Parallel Asset Generation (Async)
      // IMAGE GENERATION DISABLED TEMPORARILY FOR PERFORMANCE
      const [audioBase64] = await Promise.all([
        generateSpeech(textData.slang).catch(e => {
            console.warn("Audio gen failed, UI will fallback", e);
            return ""; 
        }),
        // withTimeout(generateImage(textData.visual_description), 10000, "") 
      ]);

      const finalRecord = {
        ...newRecord,
        audioData: audioBase64 || undefined, // undefined triggers browser fallback
        imageUrl: undefined
      };

      // Update Cache with audio data for next time
      if (cacheKey && audioBase64) {
        setCachedTranslation(cacheKey, { ...textData, audioData: audioBase64 });
      }

      setCurrentResult(finalRecord);
      onNewTranslation(finalRecord);
      setLoadingState({ status: 'success' });

    } catch (error) {
      console.error("Translation Flow Error:", error);
      setLoadingState({ status: 'error', message: 'Translation failed. Please try again.' });
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <InputArea onTranslate={handleTranslate} loadingStatus={loadingState.status} />
      
      {loadingState.status === 'error' && (
        <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-400 text-center flex items-center justify-center gap-2">
          <Zap size={16} /> {loadingState.message}
        </div>
      )}

      {currentResult && (
        <ResultDisplay 
          result={currentResult} 
          isAssetsLoading={loadingState.status === 'loading_assets'}
        />
      )}
    </div>
  );
};

export default TranslationBox;
