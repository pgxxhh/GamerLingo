
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Volume2, X } from 'lucide-react';
import { getReverseTranslation, generateSpeech, playBase64Audio } from '../services/geminiService';
import { LANGUAGES } from '../constants';

interface PopupProps {
  text: string;
  targetLangCode: string; // The language we are translating TO
  position: { x: number; y: number } | null;
  onClose: () => void;
}

const ReverseTranslationPopup: React.FC<PopupProps> = ({ text, targetLangCode, position, onClose }) => {
  const [translation, setTranslation] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [targetAudioLoading, setTargetAudioLoading] = useState(false);
  const [sourceAudioLoading, setSourceAudioLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const getLangLabel = (code: string) => {
    if (code === 'auto') return 'Detected';
    const lang = LANGUAGES.find(l => l.code === code);
    // clean label "Chinese (Slang)" -> "Chinese"
    return lang ? lang.label.split(' ')[0].toUpperCase() : code.toUpperCase();
  };

  const targetLabel = getLangLabel(targetLangCode);

  useEffect(() => {
    let isMounted = true;
    
    const fetchTranslation = async () => {
      if (!text) return;
      setLoading(true);
      setTranslation("");
      
      try {
        const res = await getReverseTranslation(text, targetLangCode);
        if (isMounted) {
            setTranslation(res);
            setLoading(false);
        }
      } catch (e) {
        if (isMounted) {
            setTranslation("Error");
            setLoading(false);
        }
      }
    };

    fetchTranslation();

    return () => { isMounted = false; };
  }, [text, targetLangCode]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Gemini TTS for Source Text
  const playSourceAudio = async () => {
    if (!text || sourceAudioLoading) return;
    setSourceAudioLoading(true);
    try {
      const base64 = await generateSpeech(text);
      await playBase64Audio(base64);
    } catch (e) {
      console.error("Source Audio failed", e);
    } finally {
      setSourceAudioLoading(false);
    }
  };

  // Gemini TTS for Translated Text
  const playTargetAudio = async () => {
    if (!translation || targetAudioLoading) return;
    setTargetAudioLoading(true);
    try {
      const base64 = await generateSpeech(translation);
      await playBase64Audio(base64);
    } catch (e) {
      console.error("Target Audio failed", e);
    } finally {
      setTargetAudioLoading(false);
    }
  };

  if (!position || !text) return null;

  const content = (
    <div
      ref={popupRef}
      className="absolute z-[9999] w-80 bg-slate-900 border border-cyber-primary/50 shadow-[0_0_30px_rgba(0,0,0,0.5)] rounded-lg animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
      style={{
        top: position.y,
        left: position.x,
        transform: 'translate(-50%, -125%)'
      }}
    >
        {/* Decorative Arrow */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 border-b border-r border-cyber-primary/50 rotate-45"></div>

        {/* Close Button */}
        <button 
           onClick={(e) => { e.stopPropagation(); onClose(); }}
           className="absolute top-2 right-2 text-slate-500 hover:text-red-400 transition-colors z-10"
        >
           <X size={14} />
        </button>

        <div className="flex flex-col">
            {/* Top Section: Original Selection */}
            <div className="p-3 bg-slate-800/50 border-b border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                   <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Selected</span>
                </div>
                <div className="flex gap-3 items-start">
                    <button 
                        onClick={playSourceAudio} 
                        disabled={sourceAudioLoading}
                        className={`mt-0.5 transition-colors shrink-0 ${sourceAudioLoading ? 'text-cyber-primary/50' : 'text-cyber-primary hover:text-white'}`}
                        title="Listen"
                    >
                        {sourceAudioLoading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                    </button>
                    <p className="text-sm text-slate-200 font-medium leading-relaxed line-clamp-2 italic">
                        "{text}"
                    </p>
                </div>
            </div>

            {/* Bottom Section: Result */}
            <div className="p-3 bg-slate-900/80 relative overflow-hidden min-h-[80px]">
                {/* Background glow for result */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyber-primary/5 rounded-full blur-2xl pointer-events-none"></div>

                <div className="flex items-center gap-2 mb-2">
                   <span className="text-[10px] font-mono text-cyber-secondary uppercase tracking-wider">{targetLabel}</span>
                </div>
                
                <div className="min-h-[28px]">
                    {loading ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                            <Loader2 size={14} className="animate-spin" /> Decoding slang...
                        </div>
                    ) : (
                        <div className="flex gap-3 items-start animate-in slide-in-from-bottom-2 duration-300">
                             <button 
                                onClick={playTargetAudio} 
                                disabled={targetAudioLoading}
                                className={`mt-1 transition-colors shrink-0 ${targetAudioLoading ? 'text-cyber-secondary/50 cursor-wait' : 'text-cyber-secondary hover:text-white'}`}
                                title="Listen (High Quality)"
                            >
                                {targetAudioLoading ? <Loader2 size={18} className="animate-spin"/> : <Volume2 size={18} />}
                            </button>
                            <p className="text-lg font-bold text-white leading-tight">
                                {translation}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default ReverseTranslationPopup;
