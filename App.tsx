
import React, { useState, useEffect } from 'react';
import TranslationBox from './components/TranslationBox';
import HistoryList from './components/HistoryList';
import { TranslationRecord } from './types';
import { Gamepad2, Github } from 'lucide-react';

const App: React.FC = () => {
  const [history, setHistory] = useState<TranslationRecord[]>(() => {
    const saved = localStorage.getItem('gamerlingo_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('gamerlingo_history', JSON.stringify(history));
  }, [history]);

  const handleNewTranslation = (record: TranslationRecord) => {
    setHistory((prev) => [record, ...prev].slice(0, 50)); // Keep last 50
  };

  const handleClearHistory = () => {
    setHistory([]);
  };

  const handleCopyHistoryItem = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-cyber-darker text-slate-200 selection:bg-cyber-primary selection:text-cyber-darker font-sans flex flex-col">
      {/* Background Grid Effect */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-20" 
           style={{ 
             backgroundImage: 'linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)', 
             backgroundSize: '40px 40px' 
           }}>
      </div>
      
      {/* Radial Gradient overlay for focus */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/0 via-cyber-darker/80 to-cyber-darker"></div>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex flex-col items-center px-4 py-8 md:py-16 max-w-4xl mx-auto w-full">
        
        {/* Header */}
        <header className="mb-12 text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-slate-900/50 border border-slate-700/50 backdrop-blur mb-4 shadow-[0_0_30px_-5px_rgba(0,255,157,0.3)]">
            <Gamepad2 className="w-8 h-8 text-cyber-primary mr-2" />
            <h1 className="text-3xl md:text-5xl font-black tracking-tighter text-white">
              Gamer<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyber-primary to-cyber-accent">Lingo</span>
            </h1>
          </div>
          <p className="text-slate-400 font-mono text-sm md:text-base max-w-lg mx-auto">
            Translation Assistant <span className="text-cyber-secondary">[Demo Version]</span>. 
            Calibrated for toxicity, hype, and authentic gaming comms.
          </p>
        </header>

        {/* Translation Module */}
        <TranslationBox onNewTranslation={handleNewTranslation} />

        {/* History Module */}
        <HistoryList 
          history={history} 
          onClear={handleClearHistory} 
          onCopy={handleCopyHistoryItem}
          copiedId={copiedId}
        />

      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-slate-600 text-xs font-mono space-y-2">
        <p>Contact: <span className="text-cyber-primary/50">975022570yp@gmail.com</span></p>
      </footer>

    </div>
  );
};

export default App;
