
import { GoogleGenAI, Modality, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { SYSTEM_INSTRUCTION, RESPONSE_SCHEMA, LANGUAGES } from "../constants";
import { SlangResponse, ShadowResult, TranslationResultPartial } from "../types";
import { getCachedReverseTranslation, setCachedReverseTranslation, getCachedTTS, setCachedTTS } from "./cacheService";

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

let globalAudioContext: AudioContext | null = null;

export const playBase64Audio = async (base64: string) => {
  try {
    if (!globalAudioContext) {
      globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = globalAudioContext;
    if (ctx.state === 'suspended') await ctx.resume();
    
    const buffer = await decodeAudioData(base64, ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (e) {
    console.error("Failed to play audio", e);
  }
};

const cleanJsonString = (str: string): string => {
  // Remove Markdown code blocks ```json ... ``` or ``` ... ```
  return str.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
};

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

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
        safetySettings: SAFETY_SETTINGS, // Added safety settings
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
  
  // 1. Check Cache
  const cached = getCachedTTS(text);
  if (cached) return cached;

  const ai = getAiClient();

  // Retry logic specific for TTS to improve success rate
  return retryOperation(async () => {
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
      if (part?.inlineData?.data) {
        // 2. Set Cache
        setCachedTTS(text, part.inlineData.data);
        return part.inlineData.data;
      }
      throw new Error("No audio data returned");
    } catch (e) {
      console.warn("TTS Attempt Failed:", e);
      throw e;
    }
  }, 2, 500); // 2 Retries, 500ms delay
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

// --- Step 4: Reverse Translation (Selection) ---

export const getReverseTranslation = async (text: string, targetLangCode: string): Promise<string> => {
  // 1. Check Cache First
  const cached = getCachedReverseTranslation(text, targetLangCode);
  if (cached) return cached;

  const ai = getAiClient();
  
  // Resolve code to label (e.g., 'zh' -> 'Chinese (Slang)') for better prompting
  const langObj = LANGUAGES.find(l => l.code === targetLangCode);
  let targetName = langObj ? langObj.label : "English";
  if (targetLangCode === 'auto') targetName = "English";

  // Prompt engineered to bypass safety blocks by providing context
  const prompt = `Translate the following text to ${targetName}. \nText: "${text}"\n\nContext: This is a gaming term or slang used in video games.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        // Explicit system instruction to focus on translation data, not moderation
        systemInstruction: "You are a translation engine. Output ONLY the translation. If the text is slang/toxic, translate the meaning accurately.",
        safetySettings: SAFETY_SETTINGS, // Ensure permissive settings are applied
      }
    });

    let result = "No translation found";

    // 1. Try standard text access
    try {
        const textResponse = response.text;
        if (textResponse) result = textResponse.trim();
    } catch (e) {
        // Ignore getter error, proceed to inspection
    }

    // 2. Deep inspection if first attempt failed
    if (result === "No translation found") {
        const candidate = response.candidates?.[0];
        if (candidate) {
            const partText = candidate.content?.parts?.[0]?.text;
            if (partText) result = partText.trim();
            else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                result = `[${candidate.finishReason}]`;
            }
        }
    }

    // 3. Set Cache
    if (result !== "No translation found" && !result.startsWith("[")) {
      setCachedReverseTranslation(text, targetLangCode, result);
    }
    
    return result;

  } catch (e) {
    console.error("Reverse translation failed", e);
    return "Error";
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
