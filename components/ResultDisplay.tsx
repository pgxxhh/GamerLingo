
import React, { useState, useRef, useEffect } from 'react';
import { TranslationRecord } from '../types';
import { Volume2, Copy, Check, Zap, ImageOff, Loader2 } from 'lucide-react';
import { decodeAudioData } from '../services/geminiService';
import ShadowingPractice from './ShadowingPractice';
import ReverseTranslationPopup from './ReverseTranslationPopup';

interface ResultDisplayProps {
  result: TranslationRecord;
  isAssetsLoading: boolean;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, isAssetsLoading }) => {
  const [copied, setCopied] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Popup State
  const [selectionState, setSelectionState] = useState<{
    text: string;
    position: { x: number; y: number };
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => { audioContextRef.current?.close(); };
  }, []);

  // Selection Handler for Mouse, Touch, and Keyboard
  const handleSelectionChange = () => {
    // Add a small delay to ensure the OS/Browser has updated the selection state
    // This is critical for mobile devices where 'touchend' might fire before selection is finalized.
    setTimeout(() => {
        const selection = window.getSelection();
        
        if (!selection || selection.isCollapsed || !containerRef.current) {
            // Only clear selection if the new selection is empty (user clicked elsewhere/cleared it)
            // If the user selects something outside, we might want to keep or clear depending on UX.
            // Here we clear it if the selection is collapsed (empty).
            if (!selection?.toString()) {
                 setSelectionState(null); 
            }
            return;
        }

        const text = selection.toString().trim();
        if (text.length < 1) {
            setSelectionState(null);
            return;
        }

        // Check if selection is inside our specific text container
        if (!containerRef.current.contains(selection.anchorNode)) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Calculate position relative to the DOCUMENT (for Portal rendering)
        // We use window.scrollX/Y to account for scrolling, as the Portal is absolute to body
        setSelectionState({
          text,
          position: {
            x: rect.left + window.scrollX + (rect.width / 2),
            y: rect.top + window.scrollY
          }
        });
    }, 50);
  };

  const playAudio = async () => {
    // Strategy 1: Play Gemini Audio if available
    if (result.audioData) {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        
        const buffer = await decodeAudioData(result.audioData, ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (e) {
        console.error("Gemini Playback error", e);
        // Fallback to browser if decoding fails
        playBrowserTTS();
      }
    } else {
      // Strategy 2: Fallback to Browser Speech Synthesis
      playBrowserTTS();
    }
  };

  const playBrowserTTS = () => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(result.translatedText);
      // Try to find a voice matching the target lang (simple match)
      const voices = window.speechSynthesis.getVoices();
      const langCode = result.targetLang === 'zh' ? 'zh-CN' : result.targetLang;
      const voice = voices.find(v => v.lang.startsWith(langCode));
      if (voice) utterance.voice = voice;
      
      utterance.rate = 1.1; // Slightly faster for gaming vibe
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn("No TTS available");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result.translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTagColor = (tag: string) => {
    const lower = tag.toLowerCase();
    if (['toxic', 'bad', 'cringe', 'salt'].some(k => lower.includes(k))) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (['hype', 'good', 'w', 'cracked', 'wholesome'].some(k => lower.includes(k))) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (['funny', 'meme', 'lol'].some(k => lower.includes(k))) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-cyber-secondary/20 text-cyber-secondary border-cyber-secondary/30';
  };

  // The button is clickable if we have audio data OR if we aren't loading assets anymore (implies fallback is ready)
  const isPlayable = !!result.audioData || !isAssetsLoading;

  return (
    <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-500 mt-6">
      <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-cyber-secondary"></div>
      <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-cyber-secondary"></div>
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-cyber-secondary"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-cyber-secondary"></div>

      <div className="bg-cyber-surface/30 backdrop-blur-sm border border-cyber-secondary/30 rounded-lg p-0 overflow-hidden min-h-[120px]">
        <div className="flex flex-col md:flex-row">
          
          {/* Content Side */}
          <div className="w-full p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-mono text-cyber-secondary uppercase tracking-widest">
                  RESULT &rarr; {result.targetLang}
                </span>
                
                <div className="flex gap-2 z-20 relative">
                   {isAssetsLoading ? (
                     <div className="p-2 rounded bg-slate-800 border border-slate-700">
                       <Loader2 size={20} className="text-cyber-primary animate-spin"/>
                     </div>
                   ) : (
                     <button 
                        onClick={playAudio}
                        disabled={!isPlayable}
                        className={`p-2 rounded transition-all duration-200 ${isPlayable ? 'bg-cyber-primary/20 text-cyber-primary hover:bg-cyber-primary hover:text-black cursor-pointer shadow-lg hover:shadow-[0_0_15px_rgba(0,255,157,0.4)]' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                      >
                        <Volume2 size={20} />
                     </button>
                   )}
                   <button onClick={handleCopy} className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
                     {copied ? <Check size={20} className="text-green-400"/> : <Copy size={20}/>}
                   </button>
                </div>
              </div>

              {/* TEXT CONTAINER with Selection Tracking */}
              <div 
                  className="space-y-4 mb-6 relative" 
                  ref={containerRef} 
                  onMouseUp={handleSelectionChange}
                  onTouchEnd={handleSelectionChange}
                  onKeyUp={handleSelectionChange}
              >
                 <div className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 leading-tight break-words selection:bg-cyber-primary selection:text-black cursor-text">
                  {result.translatedText}
                </div>
                <div className="h-1 w-20 bg-cyber-secondary/50 rounded-full"></div>

                {/* Inline Popup - NOW RENDERED VIA PORTAL IN COMPONENT */}
                {selectionState && (
                    <ReverseTranslationPopup 
                        text={selectionState.text}
                        targetLangCode={result.sourceLang || 'en'} // Fallback if sourceLang missing from old history
                        position={selectionState.position}
                        onClose={() => setSelectionState(null)}
                    />
                )}
              </div>

              <div className="flex flex-wrap gap-2 mb-6">
                {result.tags?.map((tag, idx) => (
                  <span key={idx} className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border ${getTagColor(tag)}`}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <ShadowingPractice targetText={result.translatedText} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultDisplay;
