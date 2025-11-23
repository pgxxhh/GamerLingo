
import React, { useRef } from 'react';
import { TranslationRecord } from '../types';
import { Clock, Trash2, Copy, Check, Volume2, Image as ImageIcon } from 'lucide-react';
import { decodeAudioData } from '../services/geminiService';

interface HistoryListProps {
  history: TranslationRecord[];
  onClear: () => void;
  onCopy: (text: string) => void;
  copiedId: string | null;
}

const HistoryList: React.FC<HistoryListProps> = ({ history, onClear, onCopy, copiedId }) => {
  const audioContextRef = useRef<AudioContext | null>(null);

  if (history.length === 0) return null;

  const playHistoryAudio = async (base64?: string) => {
    if (!base64) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      
      const buffer = await decodeAudioData(base64, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (e) {
      console.error("Audio Error", e);
    }
  };

  const getTagColor = (tag: string) => {
    const lower = tag.toLowerCase();
    if (['toxic', 'bad', 'cringe', 'salt'].some(k => lower.includes(k))) return 'text-red-400 border-red-500/30 bg-red-900/20';
    if (['hype', 'good', 'w', 'cracked'].some(k => lower.includes(k))) return 'text-green-400 border-green-500/30 bg-green-900/20';
    return 'text-slate-400 border-slate-700 bg-slate-800';
  };

  return (
    <div className="w-full mt-12 border-t border-slate-800 pt-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-cyber-accent font-bold text-lg flex items-center gap-2">
          <Clock size={18} />
          Recent Comms
        </h3>
        <button 
          onClick={onClear}
          className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1 uppercase tracking-wider font-mono"
        >
          <Trash2 size={12} /> Clear Log
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {history.map((item) => (
          <div 
            key={item.id} 
            className="bg-cyber-surface/50 border border-slate-700 hover:border-cyber-primary/50 rounded-lg overflow-hidden transition-all duration-200 group flex"
          >
            {/* Thumbnail - Only show if image exists */}
            {item.imageUrl && (
              <div className="w-20 bg-slate-900 shrink-0 relative overflow-hidden">
                <img src={item.imageUrl} alt="" className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {/* Content */}
            <div className="p-3 flex-grow min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-1">
                   <div className="text-cyber-primary font-bold text-lg truncate pr-2">
                    {item.translatedText}
                   </div>
                   <div className="flex gap-1 shrink-0">
                     {item.audioData && (
                       <button
                         onClick={() => playHistoryAudio(item.audioData)}
                         className="text-slate-500 hover:text-cyber-secondary p-1 rounded"
                       >
                         <Volume2 size={14} />
                       </button>
                     )}
                     <button
                      onClick={() => onCopy(item.translatedText)}
                      className="text-slate-500 hover:text-white p-1 rounded"
                     >
                       {copiedId === item.translatedText ? <Check size={14} /> : <Copy size={14} />}
                     </button>
                   </div>
                </div>
                <div className="text-slate-500 text-xs font-mono truncate mb-2">
                  {item.originalText}
                </div>
              </div>
              
              <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                {item.tags && item.tags.slice(0, 3).map((tag, idx) => (
                  <span key={idx} className={`text-[9px] px-1.5 py-0.5 rounded border ${getTagColor(tag)}`}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HistoryList;
