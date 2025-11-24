
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResultDisplay from '../components/ResultDisplay';
import { TranslationRecord } from '../types';

// Explicitly declare Jest globals to satisfy TypeScript in environments where @types/jest is missing or not included
declare const jest: any;
declare const describe: any;
declare const it: any;
declare const expect: any;

// Mock Gemini Service
jest.mock('../services/geminiService', () => ({
  decodeAudioData: jest.fn(),
  getReverseTranslation: jest.fn(() => Promise.resolve("Mock Reverse Translation")),
  evaluatePronunciation: jest.fn()
}));

// Mock Child Components to isolate ResultDisplay logic
// Note: paths are relative to this test file
jest.mock('../components/ShadowingPractice', () => () => <div data-testid="shadowing-practice">Practice</div>);
jest.mock('../components/ReverseTranslationPopup', () => (props: any) => (
  <div data-testid="reverse-popup">
    {props.text} - {props.targetLangCode}
    <button onClick={props.onClose}>Close</button>
  </div>
));

const mockRecord: TranslationRecord = {
  id: '1',
  originalText: 'Hello',
  translatedText: 'Hola Mundo',
  tags: ['Neutral'],
  timestamp: 123456789,
  sourceLang: 'en',
  targetLang: 'es',
  audioData: 'mockBase64'
};

describe('ResultDisplay Component', () => {
  
  it('renders translated text correctly', () => {
    render(<ResultDisplay result={mockRecord} isAssetsLoading={false} />);
    expect(screen.getByText('Hola Mundo')).toBeInTheDocument();
    expect(screen.getByText('#Neutral')).toBeInTheDocument();
  });

  it('shows copy button and handles click', () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn(),
      },
    });
    
    render(<ResultDisplay result={mockRecord} isAssetsLoading={false} />);
    // Checking for the copy icon container or button
    expect(document.querySelector('.text-slate-400')).toBeInTheDocument();
  });

  it('displays reverse translation popup on text selection', async () => {
    render(<ResultDisplay result={mockRecord} isAssetsLoading={false} />);
    
    const textContainer = screen.getByText('Hola Mundo').closest('div');
    
    // Mock window.getSelection
    const mockGetSelection = jest.fn().mockReturnValue({
      toString: () => 'Mundo',
      isCollapsed: false,
      anchorNode: textContainer?.firstChild, // Simulate being inside
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 100, top: 100, width: 50, height: 20 }),
      }),
    });
    window.getSelection = mockGetSelection;
    
    // Trigger MouseUp
    if (textContainer) {
      fireEvent.mouseUp(textContainer);
    }

    await waitFor(() => {
      expect(screen.getByTestId('reverse-popup')).toBeInTheDocument();
      expect(screen.getByText('Mundo - en')).toBeInTheDocument();
    });
  });

  it('handles empty selection gracefully', () => {
    render(<ResultDisplay result={mockRecord} isAssetsLoading={false} />);
    const textContainer = screen.getByText('Hola Mundo').closest('div');
    
    window.getSelection = jest.fn().mockReturnValue({
      toString: () => '',
      isCollapsed: true,
    });

    if (textContainer) {
      fireEvent.mouseUp(textContainer);
    }

    expect(screen.queryByTestId('reverse-popup')).not.toBeInTheDocument();
  });
});
