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

async function fetchOpenFda(medicineName: string): Promise<StructuredOpenFdaData | null> {
  const encodedMedicine = encodeURIComponent(medicineName);
  const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:${encodedMedicine}&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

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
}

async function summarizeWithOpenRouter(payload: StructuredOpenFdaData): Promise<MedicineSummary> {
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
  });

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
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { medicineName?: string };
    const medicineName = body?.medicineName?.trim();

    if (!medicineName) {
      return NextResponse.json(
        {
          success: false,
          code: "VALIDATION_ERROR",
          error: "medicineName is required.",
        },
        { status: 400 },
      );
    }

    const structuredData = await fetchOpenFda(medicineName);

    if (!structuredData) {
      return NextResponse.json(
        {
          success: false,
          code: "NOT_FOUND",
          error: "No official OpenFDA label data found for the provided medicine.",
        },
        { status: 404 },
      );
    }

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