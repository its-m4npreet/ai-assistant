import { NextRequest, NextResponse } from "next/server";

type MedicineSummary = {
  medicineName: string;
  primaryUses: string;
  howItWorks: string;
  commonSideEffects: string;
  warningsPrecautions: string;
  importantNotes: string;
};

type TranslationRequest = {
  text?: string;
  summary?: MedicineSummary;
  targetLanguage: string;
  sourceLanguage?: string;
};

type OpenRouterMessage = {
  role: "system" | "user";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TranslationRequest;
    const { text, summary, targetLanguage, sourceLanguage = "en" } = body;

    if ((!text && !summary) || !targetLanguage) {
      return NextResponse.json(
        {
          success: false,
          error: "Text/summary and target language are required.",
        },
        { status: 400 }
      );
    }

    // If target language is English, return as is
    if (targetLanguage === "en" || targetLanguage === sourceLanguage) {
      return NextResponse.json(
        {
          success: true,
          translation: text,
          summary: summary,
        },
        { status: 200 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.warn("OPENROUTER_API_KEY not configured, returning original text");
      return NextResponse.json(
        {
          success: true,
          translation: text,
          summary: summary,
          warning: "Translation service not configured",
        },
        { status: 200 }
      );
    }

    const targetLangName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

    let userContent: string;
    let systemPrompt: string;

    if (summary) {
      // Batch translation for entire summary
      systemPrompt = `You are a professional medical translator. Translate the given JSON object to ${targetLangName}. 
Preserve all JSON structure, formatting including bullet points (•), line breaks, and field names must remain in English.
Only translate the VALUES, not the keys. Maintain medical accuracy and terminology.
Return ONLY valid JSON with the same structure.`;
      userContent = JSON.stringify(summary);
    } else {
      systemPrompt = `You are a professional translator. Translate the given text to ${targetLangName}. Preserve formatting including bullet points (•), line breaks, and structure. Only output the translation, nothing else. Maintain medical accuracy and terminology.`;
      userContent = text || "";
    }

    const messages: OpenRouterMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    // Retry logic with exponential backoff
    let lastError: Error | null = null;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Translation attempt ${attempt + 1}/${maxRetries + 1}...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
            "X-Title": "AI Medicine Information System",
          },
          body: JSON.stringify({
            model: "arcee-ai/trinity-mini:free",
            temperature: 0.3,
            messages,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error response:", errorText);
          throw new Error(`Translation API failed with status ${response.status}: ${errorText}`);
        }

        const data = (await response.json()) as OpenRouterResponse;
        const translationContent = data.choices?.[0]?.message?.content;

        if (!translationContent) {
          throw new Error("No translation returned from API");
        }

        // If summary was provided, parse the JSON response
        if (summary) {
          try {
            // Extract JSON from response (in case there's extra text)
            const jsonMatch = translationContent.match(/\{[\s\S]*\}/);
            const translatedSummary = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(translationContent);
            
            return NextResponse.json(
              {
                success: true,
                summary: translatedSummary,
              },
              { status: 200 }
            );
          } catch (parseError) {
            console.error("Failed to parse translated summary:", parseError);
            throw new Error("Invalid translation format");
          }
        }

        return NextResponse.json(
          {
            success: true,
            translation: translationContent.trim(),
          },
          { status: 200 }
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        console.error(`Translation attempt ${attempt + 1} failed:`, lastError.message);
        
        // Don't retry on non-network errors or if it's the last attempt
        if (attempt < maxRetries && (lastError.message.includes("timeout") || lastError.message.includes("fetch failed") || lastError.message.includes("ECONNREFUSED") || lastError.message.includes("aborted"))) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Throw on last attempt or non-retryable errors
        throw lastError;
      }
    }

    throw lastError || new Error("Translation failed after all retries");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Translation failed";
    console.error("Translation error:", message);

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
