
import React, { useState, useRef } from 'react';
import { Mic, Square, Star, Trophy, Repeat } from 'lucide-react';
import { ShadowResult } from '../types';
import { evaluatePronunciation } from '../services/geminiService';

interface ShadowingPracticeProps {
  targetText: string;
}

const ShadowingPractice: React.FC<ShadowingPracticeProps> = ({ targetText }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ShadowResult | null>(null);
  
  const recorderRef = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size > 500) {
          setLoading(true);
          try {
            const res = await evaluatePronunciation(blob, targetText);
            setResult(res);
          } catch (e) {
            console.error(e);
          } finally {
            setLoading(false);
          }
        }
      };

      recorder.start();
      setIsRecording(true);
      setResult(null);
    } catch (e) {
      console.error("Shadow Mic Error", e);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-[#00ff9d]';
    if (score >= 70) return 'text-cyber-accent';
    if (score >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-700/50">
      <div className="flex items-center justify-between mb-2">
         <div className="text-xs font-mono text-slate-500 uppercase flex items-center gap-1">
           <Repeat size={12} /> Practice & Score
         </div>
      </div>
      
      <div className="flex items-center gap-4 bg-slate-900/40 p-3 rounded-lg border border-slate-800">
         {isRecording ? (
            <button 
              onClick={stopRecording}
              className="p-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-full animate-pulse hover:bg-red-500 hover:text-white transition-colors"
            >
              <Square size={18} fill="currentColor" />
            </button>
         ) : (
            <button 
              onClick={startRecording}
              disabled={loading}
              className={`p-2 rounded-full border transition-all ${loading ? 'bg-slate-800 text-slate-600 border-slate-700' : 'bg-slate-700 text-cyber-accent border-cyber-accent/50 hover:bg-cyber-accent hover:text-black hover:shadow-[0_0_10px_rgba(6,182,212,0.4)]'}`}
            >
              <Mic size={18} />
            </button>
         )}

         <div className="flex-grow">
            {loading ? (
               <span className="text-xs font-mono text-cyber-accent animate-pulse">Analyzing pronunciation...</span>
            ) : result ? (
               <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                     <div className={`text-lg font-bold ${getScoreColor(result.score)} flex items-center gap-1`}>
                       {result.score}% MATCH
                       {result.score === 100 && <Trophy size={16} className="text-yellow-400"/>}
                     </div>
                     <div className="text-xs text-slate-400 italic">"{result.feedback}"</div>
                  </div>
                  <div className="text-right">
                     <Star size={16} className={getScoreColor(result.score)} fill="currentColor" fillOpacity={result.score / 100} />
                  </div>
               </div>
            ) : (
               <span className="text-xs text-slate-500">Click mic to record & compare.</span>
            )}
         </div>
      </div>
    </div>
  );
};

export default ShadowingPractice;
