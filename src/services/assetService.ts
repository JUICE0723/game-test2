import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateGameAssets() {
  const model = "gemini-2.5-flash-image";

  const forestPrompt = "Pixel art background of a dense, mysterious forest, 16-bit style, lush greenery, dappled sunlight, vertical orientation, high quality.";
  const catPrompt = "Pixel art character of a cute cat wearing a banana suit, 16-bit style, standing pose, isolated on a solid lime green background, high quality.";
  const flagPrompt = "Pixel art of a red finish line flag, 16-bit style, isolated on a solid lime green background, high quality.";
  const crowPrompt = "Pixel art of a black crow flying, 16-bit style, isolated on a solid lime green background, high quality.";
  const flowerPrompt = "Pixel art of a toxic purple flower, 16-bit style, isolated on a solid lime green background, high quality.";
  const jetpackPrompt = "Pixel art of a futuristic jetpack, 16-bit style, isolated on a solid lime green background, high quality.";

  try {
    const [forestRes, catRes, flagRes, crowRes, flowerRes, jetpackRes] = await Promise.all([
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: forestPrompt }] },
        config: { imageConfig: { aspectRatio: "9:16" } }
      }),
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: catPrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      }),
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: flagPrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      }),
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: crowPrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      }),
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: flowerPrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      }),
      ai.models.generateContent({
        model,
        contents: { parts: [{ text: jetpackPrompt }] },
        config: { imageConfig: { aspectRatio: "1:1" } }
      })
    ]);

    const extractImage = (response: any) => {
      if (!response || !response.candidates || !response.candidates[0]) return null;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      return null;
    };

    return {
      background: extractImage(forestRes),
      character: extractImage(catRes),
      flag: extractImage(flagRes),
      crow: extractImage(crowRes),
      flower: extractImage(flowerRes),
      jetpack: extractImage(jetpackRes),
    };
  } catch (error) {
    console.warn("AI Asset generation failed (likely quota limit). Using fallback assets.", error);
    return {
      background: null,
      character: null,
      flag: null,
      crow: null,
      flower: null,
      jetpack: null,
    };
  }
}
