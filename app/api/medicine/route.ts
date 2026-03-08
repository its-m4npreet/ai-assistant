import { NextRequest, NextResponse } from "next/server";

type OpenFdaLabelResult = {
  active_ingredient?: string[];
  purpose?: string[];
  indications_and_usage?: string[];
  warnings?: string[];
  adverse_reactions?: string[];
  do_not_use?: string[];
  ask_doctor?: string[];
  stop_use?: string[];
  dosage_and_administration?: string[];
  inactive_ingredient?: string[];
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
  };
};

type OpenFdaResponse = {
  results?: OpenFdaLabelResult[];
};

type MedicineSummary = {
  medicineName: string;
  primaryUses: string;
  howItWorks: string;
  commonSideEffects: string;
  warningsPrecautions: string;
  importantNotes: string;
};

type StructuredOpenFdaData = {
  medicineName: string;
  activeIngredient: string;
  purpose: string;
  indicationsAndUsage: string;
  warnings: string;
  doNotUse: string;
  askDoctor: string;
  stopUse: string;
  dosageAndAdministration: string;
  adverseReactions: string;
  inactiveIngredients: string;
};

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const DEFAULT_TEXT = "Information not available.";

async function extractMedicineName(userInput: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // Fallback: simple extraction
    const words = userInput.toLowerCase().trim().split(/\s+/);
    // Remove common filler words
    const fillerWords = ['tell', 'me', 'about', 'what', 'is', 'the', 'a', 'an', 'for', 'used', 'side', 'effects', 'of'];
    const filtered = words.filter(word => !fillerWords.includes(word));
    return filtered.length > 0 ? filtered.join(' ') : userInput.trim();
  }

  try {
    const prompt = `Extract the medicine name from this user query. If there's a spelling mistake, correct it. Return ONLY the medicine name, nothing else. Do not add extra words.

Examples:
- "tell me about aspirin" → aspirin
- "what is ibuprofin used for" → ibuprofen
- "paracetamol side effects" → paracetamol
- "i need info on amoxicilin" → amoxicillin
- "crocin tablets" → crocin
- "tylenol" → tylenol
- "advil" → advil

User query: "${userInput}"

Extracted medicine name (single word or phrase, no explanation):`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

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
        temperature: 0.0,
        max_tokens: 20,
        messages: [
          {
            role: "system",
            content: "You are a medicine name extractor. Extract and correct medicine names from user queries. Return ONLY the corrected medicine name, nothing else. No explanations, no punctuation, just the name.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as OpenRouterResponse;
      let extractedName = data.choices?.[0]?.message?.content?.trim();
      
      if (extractedName) {
        // Clean up the response - remove any quotes, periods, or extra text
        extractedName = extractedName
          .replace(/^["']|["']$/g, '') // Remove quotes
          .replace(/\.$/, '') // Remove trailing period
          .replace(/^(the|a|an)\s+/i, '') // Remove articles
          .split('\n')[0] // Take only first line
          .trim();
        
        if (extractedName && extractedName.length > 0) {
          return extractedName;
        }
      }
    }
  } catch (error) {
    console.error("Name extraction failed, using fallback:", error);
  }

  // Fallback: simple extraction
  const words = userInput.toLowerCase().trim().split(/\s+/);
  const fillerWords = ['tell', 'me', 'about', 'what', 'is', 'the', 'a', 'an', 'for', 'used', 'side', 'effects', 'of', 'information', 'info', 'on'];
  const filtered = words.filter(word => !fillerWords.includes(word));
  return filtered.length > 0 ? filtered.join(' ') : userInput.trim();
}

const strictSystemPrompt = [
  "You are a friendly medical information assistant that explains medicine information in simple, clear language.",
  "Use only the provided OpenFDA fields to create an easy-to-understand summary for everyday people.",
  "Write in plain English, avoiding complex medical jargon. Use bullet points and short sentences.",
  "Extract information from activeIngredient, purpose, indicationsAndUsage, warnings, doNotUse, askDoctor, stopUse, dosageAndAdministration, adverseReactions, and inactiveIngredients fields.",
  "Do not guess, infer, hallucinate, or add external knowledge.",
  `If a field is missing or empty, output exactly: ${DEFAULT_TEXT}`,
  "Do not provide diagnosis, treatment recommendations, or personal medical advice.",
  "Respond ONLY as valid JSON object with these string keys:",
  "medicineName, primaryUses, howItWorks, commonSideEffects, warningsPrecautions, importantNotes",
  "For primaryUses: Summarize what this medicine treats in 2-3 short bullet points. Start each with '• '",
  "For howItWorks: Explain in 1-2 simple sentences how the medicine works in the body. Mention the active ingredient in plain terms.",
  "For commonSideEffects: List 4-6 most common side effects as bullet points. Start each with '• '. Keep it brief.",
  "For warningsPrecautions: Summarize key warnings in 3-4 bullet points. Include who should not use it and when to see a doctor. Start each with '• '",
  "For importantNotes: Give 2-3 simple tips about how to take the medicine correctly. Start each with '• '",
  "Keep all explanations concise, friendly, and easy to read. Maximum 2-3 sentences per bullet point.",
].join(" ");

function pickFirst(values?: string[]): string {
  if (!values || values.length === 0) {
    return DEFAULT_TEXT;
  }
  const cleaned = values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return cleaned.length ? cleaned : DEFAULT_TEXT;
}

function normalizeSummary(summary: Partial<MedicineSummary>): MedicineSummary {
  const normalizeField = (value: any): string => {
    if (typeof value === 'string') {
      return value.trim() || DEFAULT_TEXT;
    }
    if (Array.isArray(value)) {
      return value.join('\n').trim() || DEFAULT_TEXT;
    }
    if (value && typeof value === 'object') {
      return JSON.stringify(value);
    }
    return DEFAULT_TEXT;
  };

  return {
    medicineName: normalizeField(summary.medicineName),
    primaryUses: normalizeField(summary.primaryUses),
    howItWorks: normalizeField(summary.howItWorks),
    commonSideEffects: normalizeField(summary.commonSideEffects),
    warningsPrecautions: normalizeField(summary.warningsPrecautions),
    importantNotes: normalizeField(summary.importantNotes),
  };
}

function parseAiJson(content: string): MedicineSummary {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Invalid AI response shape");
  }

  const jsonSlice = content.slice(start, end + 1);
  const parsed = JSON.parse(jsonSlice) as Partial<MedicineSummary>;
  return normalizeSummary(parsed);
}

async function fetchOpenFda(medicineName: string, retries = 2): Promise<StructuredOpenFdaData | null> {
  const encodedMedicine = encodeURIComponent(medicineName);
  const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodedMedicine}&limit=1`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`OpenFDA attempt ${attempt + 1}/${retries + 1}...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }

        throw new Error(`OpenFDA request failed with status ${response.status}`);
      }

      const data = (await response.json()) as OpenFdaResponse;
      const first = data.results?.[0];

      if (!first) {
        return null;
      }

      const resolvedName =
        first.openfda?.generic_name?.[0] || first.openfda?.brand_name?.[0] || medicineName;

      return {
        medicineName: resolvedName,
        activeIngredient: pickFirst(first.active_ingredient),
        purpose: pickFirst(first.purpose),
        indicationsAndUsage: pickFirst(first.indications_and_usage),
        warnings: pickFirst(first.warnings),
        doNotUse: pickFirst(first.do_not_use),
        askDoctor: pickFirst(first.ask_doctor),
        stopUse: pickFirst(first.stop_use),
        dosageAndAdministration: pickFirst(first.dosage_and_administration),
        adverseReactions: pickFirst(first.adverse_reactions),
        inactiveIngredients: pickFirst(first.inactive_ingredient),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      console.error(`OpenFDA attempt ${attempt + 1} failed:`, lastError.message);
      
      // If it's a 404 or null result, don't retry
      if (lastError.message.includes("404")) {
        return null;
      }
      
      // Retry on network errors
      if (attempt < retries && (lastError.message.includes("timeout") || lastError.message.includes("fetch failed") || lastError.message.includes("ECONNREFUSED") || lastError.message.includes("aborted"))) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Retrying OpenFDA in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // On last attempt or non-retryable error, check if we should return null or throw
      if (attempt === retries) {
        console.warn(`OpenFDA failed after ${retries + 1} attempts, will try AI generation`);
        return null; // Return null to trigger AI fallback
      }
    }
  }

  return null; // Fallback to AI generation
}

async function summarizeWithOpenRouter(payload: StructuredOpenFdaData, retries = 2): Promise<MedicineSummary> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: strictSystemPrompt,
    },
    {
      role: "user",
      content: JSON.stringify(payload),
    },
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`OpenRouter attempt ${attempt + 1}/${retries + 1}...`);
      
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
          temperature: 0.2,
          messages,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const failureText = await response.text();
        throw new Error(`OpenRouter request failed (${response.status}): ${failureText}`);
      }

      const responseData = (await response.json()) as OpenRouterResponse;
      const content = responseData.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("OpenRouter returned an empty completion");
      }

      return parseAiJson(content);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      console.error(`OpenRouter attempt ${attempt + 1} failed:`, lastError.message);
      
      // Don't retry on non-network errors
      if (attempt < retries && (lastError.message.includes("timeout") || lastError.message.includes("fetch failed") || lastError.message.includes("ECONNREFUSED"))) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If it's the last attempt or a non-retryable error, throw
      if (attempt === retries) {
        throw new Error(`OpenRouter API error after ${retries + 1} attempts: ${lastError.message}`);
      }
    }
  }

  throw lastError || new Error("OpenRouter API error: Unknown error");
}

async function generateMedicineInfoWithAI(medicineName: string, retries = 2): Promise<MedicineSummary> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const aiPrompt = `You are a knowledgeable medical information assistant. Provide accurate, general information about the medicine: ${medicineName}

IMPORTANT: 
- Only provide information if this is a real, known medicine
- If you're not certain this is a valid medicine name, state that clearly
- Do not make up information - only provide well-known, general medical information
- Include standard warnings and disclaimers
- Format as bullet points with • for easy reading

Respond ONLY as valid JSON with these string keys:
medicineName, primaryUses, howItWorks, commonSideEffects, warningsPrecautions, importantNotes

For primaryUses: List what this medicine typically treats (2-3 bullet points starting with '• ')
For howItWorks: Explain how it works in 1-2 simple sentences
For commonSideEffects: List 4-6 common side effects (bullet points starting with '• ')
For warningsPrecautions: Key warnings and who should avoid it (3-4 bullet points starting with '• ')
For importantNotes: General usage tips (2-3 bullet points starting with '• ')

If this is not a valid medicine name, set all fields except medicineName to: "Unable to provide information. Please verify the medicine name or consult a healthcare professional."`;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: "You are a medical information assistant that provides accurate, general information about medicines. Always respond with valid JSON. Never fabricate information about unknown medicines.",
    },
    {
      role: "user",
      content: aiPrompt,
    },
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`AI generation attempt ${attempt + 1}/${retries + 1}...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        const failureText = await response.text();
        throw new Error(`AI generation failed (${response.status}): ${failureText}`);
      }

      const responseData = (await response.json()) as OpenRouterResponse;
      const content = responseData.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("AI returned empty response");
      }

      return parseAiJson(content);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      console.error(`AI generation attempt ${attempt + 1} failed:`, lastError.message);
      
      if (attempt < retries && (lastError.message.includes("timeout") || lastError.message.includes("fetch failed") || lastError.message.includes("ECONNREFUSED"))) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      if (attempt === retries) {
        throw new Error(`AI generation failed after ${retries + 1} attempts: ${lastError.message}`);
      }
    }
  }

  throw lastError || new Error("AI generation failed: Unknown error");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { medicineName?: string };
    const userInput = body?.medicineName?.trim();

    if (!userInput) {
      return NextResponse.json(
        {
          success: false,
          code: "VALIDATION_ERROR",
          error: "medicineName is required.",
        },
        { status: 400 },
      );
    }

    // Extract and correct medicine name from user input
    console.log(`Processing user input: ${userInput}`);
    const extractedName = await extractMedicineName(userInput);
    
    if (!extractedName) {
      return NextResponse.json(
        {
          success: false,
          code: "VALIDATION_ERROR",
          error: "Could not extract medicine name from input.",
        },
        { status: 400 },
      );
    }

    console.log(`Extracted medicine name: ${extractedName}`);
    console.log(`Fetching data for medicine: ${extractedName}`);
    const structuredData = await fetchOpenFda(extractedName);

    if (!structuredData) {
      // Fall back to AI-generated information
      console.log("No OpenFDA data found, generating with AI...");
      try {
        const aiSummary = await generateMedicineInfoWithAI(extractedName);
        
        return NextResponse.json(
          {
            success: true,
            source: "ai-generated",
            summary: aiSummary,
            disclaimer: "This information is AI-generated as no official FDA data was found. Please consult a healthcare professional for accurate medical advice.",
          },
          { status: 200 },
        );
      } catch (aiError) {
        console.error("AI generation also failed:", aiError);
        return NextResponse.json(
          {
            success: false,
            code: "NOT_FOUND",
            error: "Unable to find information about this medicine. Please verify the medicine name or consult a healthcare professional.",
          },
          { status: 404 },
        );
      }
    }

    console.log("Summarizing with OpenRouter...");
    const summary = await summarizeWithOpenRouter(structuredData);

    return NextResponse.json(
      {
        success: true,
        source: "openfda",
        summary,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json(
      {
        success: false,
        code: "INTERNAL_SERVER_ERROR",
        error: message,
      },
      { status: 500 },
    );
  }
}