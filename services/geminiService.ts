
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION, RESPONSE_SCHEMA } from "../constants";
import { SlangResponse, ShadowResult, TranslationResultPartial } from "../types";

const getAiClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// --- Utilities ---

// Retry wrapper for high availability/flaky connections
async function retryOperation<T>(operation: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const decodeAudioData = async (base64Data: string, audioContext: AudioContext): Promise<AudioBuffer> => {
  try {
    if (!base64Data) throw new Error("Audio data is empty");
    
    // Polyfill cleanup for binary string
    const binaryString = atob(base64Data.replace(/\s/g, ''));
    const len = binaryString.length;
    
    if (len === 0) throw new Error("Audio data length is zero");

    const alignedLen = len % 2 === 0 ? len : len - 1;
    const bytes = new Uint8Array(alignedLen);
    
    for (let i = 0; i < alignedLen; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcm16 = new Int16Array(bytes.buffer);
    if (pcm16.length === 0) throw new Error("PCM data empty");

    // Create buffer (Mono, 24kHz standard for Gemini TTS)
    const audioBuffer = audioContext.createBuffer(1, pcm16.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768.0;
    }
    
    return audioBuffer;
  } catch (e) {
    console.warn("Audio Decoding Failed (Recovering gracefully):", e);
    // Return 1-second silent buffer to prevent crash
    return audioContext.createBuffer(1, 24000, 24000); 
  }
};

const cleanJsonString = (str: string): string => {
  // Remove Markdown code blocks ```json ... ``` or ``` ... ```
  return str.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
};

// --- Step 1: Translate Text (Critical Path) ---

export const translateText = async (
  input: string | Blob,
  sourceLang: string,
  targetLang: string
): Promise<TranslationResultPartial> => {
  const ai = getAiClient();
  
  return retryOperation(async () => {
    const contents = [];
    const languageInstruction = `Src: ${sourceLang}. Tgt: ${targetLang}.`;
    
    if (typeof input === 'string') {
      contents.push({ text: `${languageInstruction} Input: "${input}"` });
    } else {
      const audioBase64 = await blobToBase64(input);
      contents.push({
        inlineData: { mimeType: input.type || 'audio/wav', data: audioBase64 }
      });
      contents.push({ text: `${languageInstruction} Translate audio.` });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const textResult = response.text;
    if (!textResult) throw new Error("Empty response from AI");

    try {
      const cleaned = cleanJsonString(textResult);
      const parsed = JSON.parse(cleaned);
      return {
        slang: parsed.slang || "Error",
        visual_description: parsed.visual_description || "Abstract shape",
        tags: Array.isArray(parsed.tags) ? parsed.tags : []
      };
    } catch (e) {
      console.error("JSON Parse Error", e);
      throw new Error("Invalid format from AI");
    }
  });
};

// --- Step 2: Generate Audio (Async) ---

export const generateSpeech = async (text: string): Promise<string> => {
  if (!text) return "";
  const ai = getAiClient();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    return part?.inlineData?.data || "";
  } catch (e) {
    console.error("TTS Gen Failed:", e);
    return "";
  }
};

// --- Step 3: Generate Image (Async) ---

export const generateImage = async (prompt: string): Promise<string> => {
  if (!prompt) return "";
  const ai = getAiClient();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        // Simplified prompt for faster processing
        parts: [{ text: `Sticker style vector art. Bold lines, flat colors. Abstract metaphor: ${prompt}` }],
      },
      config: {
        imageConfig: { 
          aspectRatio: "1:1",
        }
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) return part.inlineData.data;
    }
    return "";
  } catch (e) {
    console.error("Image Gen Failed:", e);
    return "";
  }
};

// --- Evaluation ---

export const evaluatePronunciation = async (
  userAudioBlob: Blob,
  targetText: string
): Promise<ShadowResult> => {
  const ai = getAiClient();
  const audioBase64 = await blobToBase64(userAudioBlob);

  const prompt = `Role: Gamer Tutor. Task: Rate pronunciation of "${targetText}". Return JSON: {score(0-100), feedback(short slang)}.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'audio/webm', data: audioBase64 } },
        { text: prompt }
      ]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER },
          feedback: { type: Type.STRING }
        },
        required: ["score", "feedback"]
      }
    }
  });

  if (response.text) return JSON.parse(cleanJsonString(response.text)) as ShadowResult;
  throw new Error("Evaluation Failed");
};
