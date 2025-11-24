
import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, Mic, Square, ArrowRightLeft, Globe, Terminal } from 'lucide-react';
import { LanguageCode, LoadingState } from '../types';
import { LANGUAGES } from '../constants';

interface InputAreaProps {
  onTranslate: (text: string | Blob, source: LanguageCode, target: LanguageCode) => void;
  loadingStatus: LoadingState['status'];
}

const InputArea: React.FC<InputAreaProps> = ({ onTranslate, loadingStatus }) => {
  const [inputText, setInputText] = useState('');
  const [sourceLang, setSourceLang] = useState<LanguageCode>('auto');
  const [targetLang, setTargetLang] = useState<LanguageCode>('zh');
  const [isRecording, setIsRecording] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [inputText]);

  const handleSwap = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang === 'auto' ? 'en' : sourceLang);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone not supported.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        
        if (blob.size > 500) { // Avoid tiny empty clicks
           onTranslate(blob, sourceLang, targetLang);
        }
        setIsRecording(false);
      };

      recorder.start();
      setIsRecording(true);
    } catch (e) {
      console.error("Mic error", e);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleTextSubmit = () => {
    if (inputText.trim()) onTranslate(inputText, sourceLang, targetLang);
  };

  const isLoading = loadingStatus !== 'idle' && loadingStatus !== 'success' && loadingStatus !== 'error';

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-cyber-primary to-cyber-accent rounded-lg blur opacity-30 group-hover:opacity-60 transition duration-500"></div>
      <div className="relative bg-cyber-darker rounded-lg border border-slate-800 p-4">
        
        {/* Toolbar */}
        <div className="flex flex-wrap gap-4 justify-between items-center mb-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500 shrink-0">
             <Terminal size={12}/> 
             <span className="hidden sm:inline">INPUT_STREAM</span>
             <span className="sm:hidden">INPUT</span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-900 rounded px-2 py-1 border border-slate-700 w-28 sm:w-auto">
              <Globe size={12} className="text-slate-400 shrink-0"/>
              <select 
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value as LanguageCode)}
                className="bg-transparent text-xs text-slate-300 focus:outline-none uppercase font-mono cursor-pointer w-full text-ellipsis"
              >
                {LANGUAGES.map(l => <option key={`src-${l.code}`} value={l.code}>{l.label}</option>)}
              </select>
            </div>
            
            <button onClick={handleSwap} className="p-1.5 rounded-full hover:bg-slate-800 text-slate-600 hover:text-cyber-primary transition-all shrink-0">
              <ArrowRightLeft size={14} />
            </button>

            <div className="flex items-center gap-2 bg-slate-900 rounded px-2 py-1 border border-cyber-primary/30 shadow-[0_0_5px_rgba(0,255,157,0.1)] w-28 sm:w-auto">
              <Globe size={12} className="text-cyber-primary shrink-0"/>
              <select 
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value as LanguageCode)}
                className="bg-transparent text-xs text-cyber-primary font-bold focus:outline-none uppercase font-mono cursor-pointer w-full text-ellipsis"
              >
                {LANGUAGES.filter(l => l.code !== 'auto').map(l => <option key={`tgt-${l.code}`} value={l.code}>{l.label}</option>)}
              </select>
            </div>
          </div>
        </div>
        
        {/* Input Area */}
        <div className="flex gap-4 items-end">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleTextSubmit())}
            placeholder="Type or speak..."
            className="w-full bg-transparent text-slate-100 placeholder-slate-600 focus:outline-none resize-none min-h-[60px] text-lg md:text-xl font-sans"
            rows={1}
            disabled={isRecording || isLoading}
          />
          
          <div className="flex flex-col justify-end gap-2 shrink-0 pb-1">
             {isRecording ? (
               <button
                 type="button"
                 onClick={stopRecording}
                 className="p-3 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white border border-red-500 animate-pulse-fast transition-all"
               >
                 <Square size={20} fill="currentColor" />
               </button>
             ) : (
               <button
                 type="button"
                 onClick={startRecording}
                 disabled={isLoading}
                 className={`p-3 rounded-full border transition-all ${isLoading ? 'bg-slate-800 text-slate-600' : 'bg-slate-700 text-[#00ff9d] border-[#00ff9d] hover:bg-[#00ff9d] hover:text-black shadow-[0_0_10px_rgba(0,255,157,0.2)]'}`}
               >
                 <Mic size={20} />
               </button>
             )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleTextSubmit}
            disabled={isLoading || (!inputText.trim() && !isRecording)}
            className={`
              flex items-center gap-2 px-6 py-2 rounded font-bold uppercase tracking-wider text-sm transition-all duration-300
              ${isLoading || (!inputText.trim() && !isRecording)
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                : 'bg-cyber-primary text-cyber-darker hover:bg-cyber-accent hover:shadow-[0_0_15px_rgba(6,182,212,0.5)] active:scale-95'
              }
            `}
          >
            {loadingStatus === 'recording' ? 'Listening...' : 
             loadingStatus === 'translating_text' ? 'Decoding...' : 
             loadingStatus === 'loading_assets' ? 'Rendering...' : (
              <>Translate <ArrowRight size={16} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputArea;
