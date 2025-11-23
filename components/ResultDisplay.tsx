
import React, { useState, useRef, useEffect } from 'react';
import { TranslationRecord } from '../types';
import { Volume2, Copy, Check, Zap, ImageOff } from 'lucide-react';
import { decodeAudioData } from '../services/geminiService';
import ShadowingPractice from './ShadowingPractice';

interface ResultDisplayProps {
  result: TranslationRecord;
  isAssetsLoading: boolean;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, isAssetsLoading }) => {
  const [copied, setCopied] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => { audioContextRef.current?.close(); };
  }, []);

  const playAudio = async () => {
    if (!result.audioData) return;
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
      console.error("Playback error", e);
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

  return (
    <div className="relative animate-in fade-in slide-in-from-bottom-4 duration-500 mt-6">
      <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-cyber-secondary"></div>
      <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-cyber-secondary"></div>
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-cyber-secondary"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-cyber-secondary"></div>

      <div className="bg-cyber-surface/30 backdrop-blur-sm border border-cyber-secondary/30 rounded-lg p-0 overflow-hidden min-h-[120px]">
        <div className="flex flex-col md:flex-row">
          
          {/* Visual Side - DISABLED for Performance
          <div className="w-full md:w-1/3 min-h-[250px] bg-slate-900/50 relative border-b md:border-b-0 md:border-r border-slate-700/50 flex items-center justify-center overflow-hidden">
             {result.imageUrl ? (
               <img 
                 src={result.imageUrl} 
                 alt="Abstract Representation" 
                 className="w-full h-full object-cover animate-in fade-in duration-1000 hover:scale-110 transition-transform duration-700"
               />
             ) : isAssetsLoading ? (
               <div className="flex flex-col items-center gap-2">
                 <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-cyber-secondary animate-spin"></div>
                 <div className="text-slate-600 font-mono text-xs text-center animate-pulse">
                   RENDERING_VISUALS...
                 </div>
               </div>
             ) : (
                <div className="flex flex-col items-center gap-2 text-slate-700 opacity-50">
                   <ImageOff size={32} />
                   <span className="text-[10px] font-mono tracking-widest">VISUAL_SIGNAL_LOST</span>
                </div>
             )}
          </div>
          */}

          {/* Content Side */}
          <div className="w-full p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-mono text-cyber-secondary uppercase tracking-widest">
                  RESULT &rarr; {result.targetLang}
                </span>
                
                <div className="flex gap-2 z-20 relative">
                   {isAssetsLoading ? (
                     <div className="p-2 rounded bg-slate-800 animate-pulse">
                       <Volume2 size={20} className="text-slate-600"/>
                     </div>
                   ) : (
                     <button 
                        onClick={playAudio}
                        className={`p-2 rounded transition-colors ${result.audioData ? 'bg-cyber-primary/20 text-cyber-primary hover:bg-cyber-primary hover:text-black cursor-pointer shadow-lg' : 'bg-slate-800 text-slate-600'}`}
                        disabled={!result.audioData}
                      >
                        <Volume2 size={20} />
                     </button>
                   )}
                   <button onClick={handleCopy} className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white">
                     {copied ? <Check size={20} className="text-green-400"/> : <Copy size={20}/>}
                   </button>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                 <div className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 leading-tight break-words">
                  {result.translatedText}
                </div>
                <div className="h-1 w-20 bg-cyber-secondary/50 rounded-full"></div>
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
