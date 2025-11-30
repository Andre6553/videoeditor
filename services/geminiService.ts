
import { GoogleGenAI, Type } from "@google/genai";

// Lazily initialize the AI client to avoid checking for API_KEY on module load.
// This prevents a startup crash if the key is injected later.
let ai: GoogleGenAI | null = null;

const getAiClient = () => {
  if (ai) {
    return ai;
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error("API_KEY environment variable is not set");
    throw new Error("API_KEY is not configured.");
  }
  
  ai = new GoogleGenAI({ apiKey: API_KEY });
  return ai;
}


export const getCaptionIdeas = async (topic: string): Promise<string[]> => {
  try {
    const client = getAiClient();
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate 5 short, catchy, and trendy Instagram Reel captions for a video about: "${topic}". Include 2-3 relevant hashtags in each caption. Format the response as a JSON array of strings.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            description: "A single Instagram caption with hashtags.",
          },
        },
      },
    });

    const jsonString = response.text.trim();
    const ideas = JSON.parse(jsonString);
    
    if (Array.isArray(ideas) && ideas.every(item => typeof item === 'string')) {
      return ideas;
    } else {
      console.error("Parsed JSON is not an array of strings:", ideas);
      return ["Error: Could not parse captions correctly."];
    }

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to generate caption ideas.");
  }
};
