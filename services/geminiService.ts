
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
// Updated to handle 429 Quota Exceeded more gracefully
async function retryOperation<T>(operation: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const errorMsg = error.toString().toLowerCase();
    
    // Check for Quota Exceeded (429)
    if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('resource exhausted')) {
        console.warn("Quota exceeded, slowing down...");
        if (retries <= 0) throw new Error("API Quota Exceeded. Please try again in a minute.");
        
        // Wait longer (backoff) if it's a quota error
        await new Promise(resolve => setTimeout(resolve, delay * 3));
        return retryOperation(operation, retries - 1, delay * 3);
    }

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

const inflightTTS = new Map<string, Promise<string>>();

// --- Step 1a: Streaming Text Translation (Fast) ---

export async function* translateTextStream(
  input: string | Blob,
  sourceLang: string,
  targetLang: string
): AsyncGenerator<string, void, unknown> {
  const ai = getAiClient();
  const contents = [];
  
  const targetLabel = LANGUAGES.find(l => l.code === targetLang)?.label || targetLang;

  // Provide language-specific examples to ensure the model outputs the correct script/language
  let styleExamples = "Gamer Slang";
  switch(targetLang) {
      case 'zh': styleExamples = "Chinese Slang (牛逼, 下饭, 666)"; break;
      case 'en': styleExamples = "English Slang (Diff, Cracked, No Cap)"; break;
      case 'th': styleExamples = "Thai Slang (ตึง, ไก่, หัวร้อน, แบก)"; break;
      case 'jp': styleExamples = "Japanese Slang (草, 乙, 神)"; break;
      case 'kr': styleExamples = "Korean Slang (개이득, 트롤)"; break;
      case 'vi': styleExamples = "Vietnamese Slang (Gà, Gánh team)"; break;
      case 'id': styleExamples = "Indonesian Slang (Wkwk, Gacor)"; break;
      case 'tl': styleExamples = "Filipino Slang (Lodi, Petmalu)"; break;
      case 'ru': styleExamples = "Russian Slang (GG, Ez)"; break;
      default: styleExamples = `${targetLabel} Gaming Slang`;
  }
  
  // Simplified instruction for streaming pure text to avoid JSON overhead
  const streamInstruction = `
    You are GamerLingo. 
    Task: Translate input to ${targetLabel}.
    Output: Return ONLY the translated text in ${targetLabel}. Do not use JSON. Do not add explanations.
    Context: Use authentic gaming terminology (Valorant/LoL/FPS/MOBA).
    Style: ${styleExamples}.
  `;

  if (typeof input === 'string') {
    contents.push({ text: `Source: ${sourceLang}. Input: "${input}"` });
  } else {
    const audioBase64 = await blobToBase64(input);
    contents.push({
      inlineData: { mimeType: input.type || 'audio/wav', data: audioBase64 }
    });
    contents.push({ text: `Source: ${sourceLang}. Translate audio to text.` });
  }

  try {
    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction: streamInstruction,
        safetySettings: SAFETY_SETTINGS,
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  } catch (error: any) {
    const errorMsg = error.toString().toLowerCase();
    if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        yield " [System: API Quota Exceeded. Please slow down.]";
    } else {
        throw error;
    }
  }
}

// --- Step 1b: Enrich Metadata (Async/Parallel) ---

export const enrichTranslationMetadata = async (
  originalText: string,
  translatedText: string,
  targetLang: string
): Promise<Omit<TranslationResultPartial, 'slang'>> => {
  const ai = getAiClient();
  
  const prompt = `
    Analyze this gaming translation.
    Original: "${originalText}"
    Slang Translation: "${translatedText}"
    Target Lang: ${targetLang}
    
    Return JSON with:
    1. "tags": 1-3 tags (e.g. Toxic, Hype, Strategy, Funny).
    2. "visual_description": Abstract cyber-punk art prompt for this emotion.
  `;

  return retryOperation(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            visual_description: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["visual_description", "tags"],
        },
        safetySettings: SAFETY_SETTINGS,
      }
    });

    try {
      const text = response.text || "{}";
      const parsed = JSON.parse(cleanJsonString(text));
      return {
        visual_description: parsed.visual_description || "Abstract gaming vibe",
        tags: parsed.tags || ["Gaming"]
      };
    } catch (e) {
      console.error("Metadata enrichment failed", e);
      return { visual_description: "Abstract", tags: [] };
    }
  });
};

// --- Step 1 (Legacy/Fallback): Translate Text Complete ---

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
        safetySettings: SAFETY_SETTINGS,
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
  
  const trimmed = text.trim();
  
  // 1. Check Cache
  const cached = getCachedTTS(trimmed);
  if (cached) return cached;

  // 2. Check In-Flight
  if (inflightTTS.has(trimmed)) {
      return inflightTTS.get(trimmed)!;
  }

  const ai = getAiClient();

  // Create Promise
  const promise = retryOperation(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: trimmed }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        // 3. Set Cache
        setCachedTTS(trimmed, part.inlineData.data);
        return part.inlineData.data;
      }
      throw new Error("No audio data returned");
    } catch (e) {
      console.warn("TTS Attempt Failed:", e);
      throw e;
    }
  }, 2, 1000); 

  // Store in map
  inflightTTS.set(trimmed, promise);

  // Cleanup map after finish
  promise.finally(() => {
      inflightTTS.delete(trimmed);
  });

  return promise;
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

  // Contextual Prompt for Gaming
  const prompt = `
    Task: Translate the following text to ${targetName}.
    Text: "${text}"
    Context: Video Game Chat (League of Legends, Valorant, CS:GO). 
    Note: Terms like "kill", "shoot", "attack", "die", "inting" are game mechanics, not real violence.
    Instruction: Provide a direct translation. Do not censor output.
  `;

  return retryOperation(async () => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          // Explicit system instruction to focus on translation data, not moderation
          systemInstruction: "You are a gaming translator. Do not block output based on gaming terminology (kill/death/weapons). Translate accurately.",
          safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ]
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
  });
};

// --- Evaluation ---

export const evaluatePronunciation = async (
  userAudioBlob: Blob,
  targetText: string
): Promise<ShadowResult> => {
  const ai = getAiClient();
  const audioBase64 = await blobToBase64(userAudioBlob);

  const prompt = `Role: Gamer Tutor. Task: Rate pronunciation of "${targetText}". Return JSON: {score(0-100), feedback(short slang)}.`;

  return retryOperation(async () => {
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
  });
};
