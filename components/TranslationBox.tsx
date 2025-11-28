
import React, { useState, useRef } from 'react';
import { TranslationRecord, LanguageCode, LoadingState } from '../types';
import { translateTextStream, enrichTranslationMetadata, generateSpeech, translateText } from '../services/geminiService';
import { generateCacheKey, getCachedTranslation, setCachedTranslation } from '../services/cacheService';
import InputArea from './InputArea';
import ResultDisplay from './ResultDisplay';
import { Zap } from 'lucide-react';

interface TranslationBoxProps {
  onNewTranslation: (record: TranslationRecord) => void;
}

const TranslationBox: React.FC<TranslationBoxProps> = ({ onNewTranslation }) => {
  const [loadingState, setLoadingState] = useState<LoadingState>({ status: 'idle' });
  const [currentResult, setCurrentResult] = useState<TranslationRecord | null>(null);
  
  // Track the ID of the active request to prevent race conditions
  const activeRequestIdRef = useRef<number>(0);

  const handleSwapContent = (newRecord: TranslationRecord) => {
      setCurrentResult(newRecord);
      // We also update the history with this "new" (swapped) record so it persists
      onNewTranslation(newRecord);
  };

  const handleTranslate = async (input: string | Blob, source: LanguageCode, target: LanguageCode) => {
    // 1. Generate new Request ID
    const requestId = Date.now();
    activeRequestIdRef.current = requestId;

    setLoadingState({ status: 'translating_text' });
    
    // Reset result only if this is a fresh start (not typing continuation)
    if (activeRequestIdRef.current === requestId) {
        setCurrentResult(null);
    }

    const isText = typeof input === 'string';
    const cacheKey = isText ? generateCacheKey(input as string, source, target) : null;
    const cachedData = cacheKey ? getCachedTranslation(cacheKey) : null;
    
    let finalText = "";
    let originalText = isText ? (input as string) : "Audio Input";

    try {
      // --- Strategy A: Cache Hit (Full) ---
      if (cachedData && cachedData.audioData) {
        if (activeRequestIdRef.current !== requestId) return;

        const cachedRecord: TranslationRecord = {
          id: requestId.toString(),
          originalText,
          translatedText: cachedData.slang,
          imagePrompt: cachedData.visual_description,
          tags: cachedData.tags,
          timestamp: Date.now(),
          sourceLang: source,
          targetLang: target,
          audioData: cachedData.audioData
        };
        setCurrentResult(cachedRecord);
        setLoadingState({ status: 'success' });
        onNewTranslation(cachedRecord);
        return;
      }

      // --- Strategy B: Streaming (Fresh Gen) or Partial Cache ---
      if (cachedData) {
        finalText = cachedData.slang;
      } else {
        // Initialize partial state
        if (activeRequestIdRef.current === requestId) {
            setCurrentResult({
                id: requestId.toString(),
                originalText: isText ? (input as string) : 'Processing Audio...',
                translatedText: "", 
                tags: [], 
                timestamp: Date.now(),
                sourceLang: source,
                targetLang: target,
            });
        }

        // Stream Text
        const stream = translateTextStream(input, source, target);
        
        for await (const chunk of stream) {
            if (activeRequestIdRef.current !== requestId) return;
            finalText += chunk;
            setCurrentResult(prev => prev ? { ...prev, translatedText: finalText } : null);
        }
      }

      // Check abort before heavy lifting
      if (activeRequestIdRef.current !== requestId) return;

      setLoadingState({ status: 'loading_assets' });

      // Initialize the master record state that we will incrementally update.
      // If we had cached tags but no audio, preserve them.
      let currentRecordState: TranslationRecord = {
        id: requestId.toString(),
        originalText,
        translatedText: finalText,
        tags: cachedData?.tags || [],
        imagePrompt: cachedData?.visual_description,
        timestamp: Date.now(),
        sourceLang: source,
        targetLang: target,
        audioData: undefined
      };

      // Push baseline to UI (Text Complete)
      setCurrentResult(currentRecordState);

      // --- Parallel Independent Execution ---
      
      // Task 1: Audio Generation (Updates UI immediately when done)
      const audioPromise = generateSpeech(finalText)
        .then(audioBase64 => {
            if (activeRequestIdRef.current !== requestId) throw new Error("Stale request");
            
            // Update local state copy
            currentRecordState = { ...currentRecordState, audioData: audioBase64 };
            
            // Update UI State independently
            setCurrentResult(prev => prev ? { ...prev, audioData: audioBase64 } : null);
            
            return audioBase64;
        })
        .catch(e => {
            console.warn("Audio gen failed", e);
            return undefined;
        });

      // Task 2: Metadata Enrichment (Updates UI immediately when done)
      const metadataPromise = (async () => {
         if (cachedData?.tags && cachedData?.visual_description) {
             return { tags: cachedData.tags, visual_description: cachedData.visual_description };
         }
         return enrichTranslationMetadata(originalText, finalText, target);
      })().then(meta => {
         if (activeRequestIdRef.current !== requestId) throw new Error("Stale request");

         // Update local state copy
         currentRecordState = { ...currentRecordState, tags: meta.tags, imagePrompt: meta.visual_description };
         
         // Update UI State independently
         setCurrentResult(prev => prev ? { ...prev, tags: meta.tags, imagePrompt: meta.visual_description } : null);
         
         return meta;
      }).catch(e => {
         console.warn("Metadata failed", e);
         return { tags: [], visual_description: "" };
      });

      // --- Finalization ---
      // Wait for all background tasks to settle before saving to history/cache
      await Promise.allSettled([audioPromise, metadataPromise]);

      if (activeRequestIdRef.current !== requestId) return;

      // Save complete record to History
      onNewTranslation(currentRecordState);
      
      // Update Cache
      if (cacheKey) {
        setCachedTranslation(cacheKey, { 
            slang: finalText, 
            tags: currentRecordState.tags, 
            visual_description: currentRecordState.imagePrompt || "",
            audioData: currentRecordState.audioData 
        });
      }

      setLoadingState({ status: 'success' });

    } catch (error) {
      if (activeRequestIdRef.current !== requestId) return; 

      console.error("Translation Flow Error:", error);
      // Fallback logic for complete failure...
      if (!currentResult?.translatedText) {
          try {
             // ... legacy fallback code could go here ...
             const legacyData = await translateText(input, source, target);
             if (activeRequestIdRef.current === requestId) {
                 const legacyRecord: TranslationRecord = {
                    id: requestId.toString(),
                    originalText,
                    translatedText: legacyData.slang,
                    tags: legacyData.tags,
                    timestamp: Date.now(),
                    sourceLang: source,
                    targetLang: target,
                 };
                 setCurrentResult(legacyRecord);
                 onNewTranslation(legacyRecord);
                 setLoadingState({ status: 'success' });
             }
          } catch(e) {
             setLoadingState({ status: 'error', message: 'Translation failed.' });
          }
      } else {
          setLoadingState({ status: 'error', message: 'Asset generation incomplete.' });
      }
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <InputArea 
        onTranslate={handleTranslate} 
        loadingStatus={loadingState.status} 
        currentResult={currentResult}
        onSwapContent={handleSwapContent}
      />
      
      {loadingState.status === 'error' && (
        <div className="p-4 bg-red-900/20 border border-red-500/50 rounded text-red-400 text-center flex items-center justify-center gap-2">
          <Zap size={16} /> {loadingState.message}
        </div>
      )}

      {currentResult && (
        <ResultDisplay 
          result={currentResult} 
          isAssetsLoading={loadingState.status === 'loading_assets' || loadingState.status === 'translating_text'}
        />
      )}
    </div>
  );
};

export default TranslationBox;
