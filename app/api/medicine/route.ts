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

type InputMode = "guidance" | "consultation";

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ConsultationInputClassification = "health-related" | "non-health" | "ambiguous";

type ConsultationValidationResult = {
  classification: ConsultationInputClassification;
  reason: string;
};

type ExtractedMedicineResult = {
  medicineName: string;
  confidence: "high" | "medium" | "low";
  shouldAskClarification: boolean;
};

type ConsultationContext = {
  initialSymptoms?: string;
  followUpAnswers?: string[];
};

const DEFAULT_TEXT = "Information not available.";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const AI_TITLE = "AI Medicine Information System";

const EXTRACTION_MODEL_CHAIN = [
  "anthropic/claude-3.5-haiku",
  "arcee-ai/trinity-mini:free",
];

const CONSULTATION_CLASSIFIER_MODEL_CHAIN = [
  "anthropic/claude-3.5-haiku",
  "arcee-ai/trinity-mini:free",
];

const MEDICINE_SUMMARY_MODEL = "arcee-ai/trinity-mini:free";

function normalizeGuidanceSearchTerm(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(tell|me|about|what|is|the|a|an|for|used|side|effects|of|information|info|on|please|should|can|i|take)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDirectMedicineQuery(input: string): boolean {
  const cleaned = input.trim().toLowerCase();
  if (!cleaned) {
    return false;
  }

  // Single medicine names and short "name + form" inputs should use fast path first.
  if (/^[a-z][a-z0-9-]{2,29}$/.test(cleaned)) {
    return true;
  }

  if (/^[a-z][a-z0-9-]{2,29}\s+(tablet|capsule|syrup|drops|injection)s?$/.test(cleaned)) {
    return true;
  }

  return false;
}

function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    "X-Title": AI_TITLE,
  };
}

async function callOpenRouterWithModelChain(
  modelChain: string[],
  bodyBuilder: (model: string) => Record<string, unknown>,
  apiKey: string,
  timeoutMs = 7000,
): Promise<OpenRouterResponse | null> {
  for (const model of modelChain) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: buildOpenRouterHeaders(apiKey),
        body: JSON.stringify(bodyBuilder(model)),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        continue;
      }

      return (await response.json()) as OpenRouterResponse;
    } catch {
      continue;
    }
  }

  return null;
}

function fallbackExtractMedicineName(userInput: string): string | null {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // Keep this helper deterministic for no-key environments.
  }

  const words = userInput.toLowerCase().trim().split(/\s+/);
  const fillerWords = [
    "tell",
    "me",
    "about",
    "what",
    "is",
    "the",
    "a",
    "an",
    "for",
    "used",
    "side",
    "effects",
    "of",
    "information",
    "info",
    "on",
    "should",
    "i",
    "take",
    "can",
    "please",
    "have",
    "with",
  ];
  const filtered = words.filter((word) => !fillerWords.includes(word));
  if (filtered.length === 0) {
    return null;
  }
  const extracted = filtered.join(" ").trim();
  return extracted.length >= 3 ? extracted : null;
}

function parseAiExtraction(content: string): ExtractedMedicineResult | null {
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<ExtractedMedicineResult>;
    const medicineName = typeof parsed.medicineName === "string" ? parsed.medicineName.trim() : "";
    if (!medicineName) {
      return null;
    }

    const confidence: ExtractedMedicineResult["confidence"] =
      parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : "low";

    return {
      medicineName: medicineName
        .replace(/^["']|["']$/g, "")
        .replace(/\.$/, "")
        .replace(/^(the|a|an)\s+/i, "")
        .split("\n")[0]
        .trim(),
      confidence,
      shouldAskClarification: Boolean(parsed.shouldAskClarification),
    };
  } catch {
    return null;
  }
}

async function extractMedicineName(userInput: string): Promise<ExtractedMedicineResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const fallback = fallbackExtractMedicineName(userInput);
    return fallback
      ? {
          medicineName: fallback,
          confidence: "low",
          shouldAskClarification: false,
        }
      : null;
  }

  const prompt = `You classify medicine-related user text.
Task:
1) Extract the MOST LIKELY medicine name from user text (brand or generic).
2) Correct obvious spelling errors in the extracted medicine name.
3) If no medicine is mentioned, set shouldAskClarification=true.

Rules:
- Return ONLY valid JSON.
- Never include explanation text outside JSON.
- Keep medicineName as a short phrase.

JSON schema:
{
  "medicineName": "string",
  "confidence": "high|medium|low",
  "shouldAskClarification": true|false
}

Examples:
- "what is ibuprofin used for" => {"medicineName":"ibuprofen","confidence":"high","shouldAskClarification":false}
- "I have headache should I take paracetamool" => {"medicineName":"paracetamol","confidence":"high","shouldAskClarification":false}
- "I have headache and fever" => {"medicineName":"","confidence":"low","shouldAskClarification":true}

User input: "${userInput}"`;

  const data = await callOpenRouterWithModelChain(
    EXTRACTION_MODEL_CHAIN,
    (model) => ({
      model,
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "You are a strict medical text parser. Extract and spell-correct medicine names from mixed user input. Output JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
    apiKey,
  );

  const extractedRaw = data?.choices?.[0]?.message?.content?.trim();
  if (extractedRaw) {
    const parsed = parseAiExtraction(extractedRaw);
    if (parsed && parsed.medicineName) {
      return parsed;
    }
    if (parsed?.shouldAskClarification) {
      return parsed;
    }
  }

  const fallback = fallbackExtractMedicineName(userInput);
  return fallback
    ? {
        medicineName: fallback,
        confidence: "low",
        shouldAskClarification: false,
      }
    : null;
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

const consultationValidationPrompt = [
  "You are a health-query classifier.",
  "Classify user input into exactly one category:",
  "- health-related: clear symptom, medicine, body discomfort, or health concern",
  "- ambiguous: vague but could be health (e.g. 'I feel weird', 'not feeling good')",
  "- non-health: clearly unrelated (math, jokes, politics, coding, weather, sports)",
  "Return ONLY valid JSON with keys: classification, reason.",
  "Do not reject vague symptom statements; mark them ambiguous.",
  "If text contains any physical discomfort or illness concern, it is health-related or ambiguous.",
].join(" ");

const consultationAssistantPrompt = `You are a careful, empathetic clinical assistant for general education.
Use plain language and provide thorough but safe guidance.

Respond ONLY as valid JSON with these string keys:
medicineName, primaryUses, howItWorks, commonSideEffects, warningsPrecautions, importantNotes

Field requirements:
1) medicineName: 2-4 bullet points of likely condition categories and short reason.
  Format each bullet as: "• Condition - why this may fit"
  Do not present as confirmed diagnosis.

2) primaryUses: 3-5 bullet points of common OTC options.
  Include simple dosage-hint language such as adult typical interval/range when broadly safe.
  Never prescribe for a specific person. Include pediatric/pregnancy caution where relevant.

3) howItWorks: 3-5 bullet points of precautions + home/lifestyle care.
  Include hydration, rest, food, trigger avoidance, symptom monitoring as appropriate.

4) commonSideEffects: 3-5 bullet points for red flags and escalation.
  Include what requires urgent care/emergency.

5) warningsPrecautions: Keep EXACTLY this text:
  "This is for informational purposes only and not a diagnosis. For severe, persistent, or worsening symptoms, consult a licensed doctor. Seek emergency care for red-flag symptoms."

6) importantNotes: 4-6 targeted follow-up questions to refine risk and advice.
  If user input is vague, ask more clarifying questions.

Safety:
- No definitive diagnosis.
- No controlled drug recommendations.
- No personalized prescribing.
- Keep tone professional, empathetic, practical.`;

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
  const normalizeField = (value: unknown): string => {
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

function splitBulletLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function toBullets(lines: string[]): string {
  if (lines.length === 0) {
    return DEFAULT_TEXT;
  }
  return lines.map((line) => `• ${line}`).join("\n");
}

function normalizeMedicineName(medicineString: string): string {
  // Extract the primary medicine name from a medicine string
  // Examples:
  // "Paracetamol (for fever and pain relief)" -> "Paracetamol"
  // "ORS / Oral rehydration salts" -> "ORS"
  // "Cetirizine or non-drowsy antihistamine category" -> "Cetirizine"
  return medicineString
    .split(/\s*\(|category|or\s+/i)[0] // Take first part before "(" or "category" or " or "
    .trim()
    .split("/")[0] // Take first part before "/"
    .trim();
}

function deduplicateMedicines(medicines: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  
  for (const medicine of medicines) {
    const normalized = normalizeMedicineName(medicine).toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      unique.push(medicine);
    }
  }
  
  return unique;
}

function enforceConsultationMedicineSection(summary: MedicineSummary): MedicineSummary {
  const medicineHints = [
    "paracetamol",
    "acetaminophen",
    "ibuprofen",
    "cetirizine",
    "loperamide",
    "ors",
    "oral rehydration",
    "probiotic",
    "zinc",
    "antacid",
    "famotidine",
    "domperidone",
    "ondansetron",
    "saline",
    "syrup",
    "tablet",
    "capsule",
    "drops",
  ];

  const nonMedicineHints = [
    "rest",
    "hydration",
    "hydrate",
    "drink",
    "fluids",
    "sleep",
    "diet",
    "exercise",
    "lifestyle",
    "avoid oily",
    "monitor",
    "track",
  ];

  const primaryLines = splitBulletLines(summary.primaryUses);
  const medicineLines: string[] = [];
  const shiftedPrecautionLines: string[] = [];

  for (const line of primaryLines) {
    const lowered = line.toLowerCase();
    const hasMedicineHint = medicineHints.some((hint) => lowered.includes(hint));
    const hasNonMedicineHint = nonMedicineHints.some((hint) => lowered.includes(hint));

    if (hasMedicineHint && !hasNonMedicineHint) {
      medicineLines.push(line);
      continue;
    }

    shiftedPrecautionLines.push(line);
  }

  const existingPrecautions = splitBulletLines(summary.howItWorks);
  const mergedPrecautions = Array.from(new Set([...existingPrecautions, ...shiftedPrecautionLines]));

  return {
    ...summary,
    primaryUses:
      medicineLines.length > 0
        ? toBullets(medicineLines)
        : "• Please consult a doctor or pharmacist for symptom-specific medicine options.",
    howItWorks: toBullets(mergedPrecautions),
  };
}

function detectMentionedSymptoms(question: string): string[] {
  const normalized = question.toLowerCase();
  const symptomMatchers: Array<{ symptom: string; pattern: RegExp }> = [
    { symptom: "fever", pattern: /\bfever\b|high temperature/ },
    { symptom: "cough", pattern: /\bcough\b/ },
    { symptom: "sore throat", pattern: /sore throat|throat pain/ },
    { symptom: "runny nose", pattern: /runny nose|nasal discharge/ },
    { symptom: "breathing difficulty", pattern: /shortness of breath|breathing trouble|breathless/ },
    { symptom: "chest pain", pattern: /chest pain|chest tightness/ },
    { symptom: "headache", pattern: /\bheadache\b|head pain/ },
    { symptom: "migraine", pattern: /\bmigraine\b/ },
    { symptom: "dizziness", pattern: /\bdizziness\b|lightheaded/ },
    { symptom: "nausea", pattern: /\bnausea\b/ },
    { symptom: "vomiting", pattern: /\bvomit|\bvomiting\b/ },
    { symptom: "diarrhea", pattern: /diarrhea|loose motion|loose motions/ },
    { symptom: "stomach pain", pattern: /stomach pain|abdominal pain|abdomen pain/ },
    { symptom: "acidity", pattern: /acidity|heartburn|acid reflux|gas/ },
    { symptom: "rash", pattern: /\brash\b|hives/ },
    { symptom: "itching", pattern: /\bitch\b|itching/ },
    { symptom: "sneezing", pattern: /\bsneezing\b|sneeze/ },
    { symptom: "body pain", pattern: /body pain|body ache|muscle pain/ },
  ];

  return symptomMatchers
    .filter((item) => item.pattern.test(normalized))
    .map((item) => item.symptom);
}

function fallbackConsultationValidation(userInput: string): ConsultationValidationResult {
  const normalized = userInput.toLowerCase().trim();

  const clearNonHealthPatterns = [
    /\b\d+\s*[+\-*/]\s*\d+\b/,
    /\b(joke|meme|bitcoin|stock|president|prime minister|cricket score|football score|movie|song lyrics)\b/,
    /\b(write code|javascript|python|react|nextjs|programming)\b/,
    /\b(weather|temperature today|time now|date today|news headlines)\b/,
  ];

  if (clearNonHealthPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      classification: "non-health",
      reason: "Input appears clearly unrelated to health.",
    };
  }

  if (/\b(feel weird|not feeling good|not well|uneasy|off today)\b/.test(normalized)) {
    return {
      classification: "ambiguous",
      reason: "Could describe a health concern but lacks details.",
    };
  }

  return {
    classification: "health-related",
    reason: "Likely a symptom or health concern.",
  };
}

async function classifyConsultationInput(userInput: string): Promise<ConsultationValidationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return fallbackConsultationValidation(userInput);
  }

  const data = await callOpenRouterWithModelChain(
    CONSULTATION_CLASSIFIER_MODEL_CHAIN,
    (model) => ({
      model,
      temperature: 0,
      max_tokens: 90,
      messages: [
        {
          role: "system",
          content: consultationValidationPrompt,
        },
        {
          role: "user",
          content: `Classify this input: "${userInput}"`,
        },
      ],
      response_format: { type: "json_object" },
    }),
    apiKey,
    10000,
  );

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return fallbackConsultationValidation(userInput);
  }

  try {
    const parsed = JSON.parse(content) as Partial<ConsultationValidationResult>;
    if (
      parsed.classification === "health-related" ||
      parsed.classification === "non-health" ||
      parsed.classification === "ambiguous"
    ) {
      return {
        classification: parsed.classification,
        reason: typeof parsed.reason === "string" ? parsed.reason : "AI classification result.",
      };
    }
  } catch {
    return fallbackConsultationValidation(userInput);
  }

  return fallbackConsultationValidation(userInput);
}

function isMedicineRelatedInput(userInput: string): boolean {
  const normalized = userInput.toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  const unrelatedPatterns = [
    /\b(weather|temperature today|time now|date today|news|sports|movie|song|joke|bitcoin|stock|cricket score)\b/,
    /\b(code|coding|program|javascript|python|react|nextjs)\b/,
    /^\b(hi|hello|hey|who are you|how are you|thanks|thank you)\b/,
  ];

  if (unrelatedPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const medicineKeywords = /(medicine|medication|drug|tablet|capsule|syrup|injection|dose|dosage|side effect|uses|treatment|relief|antibiotic|painkiller)/;
  const symptomCount = detectMentionedSymptoms(normalized).length;

  // Single-token medicine names like "ibuprofen" should be accepted.
  if (/^[a-z][a-z0-9-]{2,29}$/.test(normalized)) {
    return true;
  }

  return medicineKeywords.test(normalized) || symptomCount > 0;
}

function enforceConsultationMedicineCoverage(summary: MedicineSummary, question: string): MedicineSummary {
  const symptoms = detectMentionedSymptoms(question);
  const hasDigestive = symptoms.some((s) => ["diarrhea", "vomiting", "nausea", "stomach pain", "acidity"].includes(s));
  const hasRespiratory = symptoms.some((s) => ["cough", "sore throat", "runny nose", "breathing difficulty", "chest pain"].includes(s));
  const hasAllergy = symptoms.some((s) => ["rash", "itching", "sneezing"].includes(s));
  const hasPainFever = symptoms.some((s) => ["fever", "headache", "migraine", "body pain"].includes(s));

  const requiredByCategory: string[] = [];
  if (hasPainFever) {
    requiredByCategory.push("Paracetamol (for pain and fever)");
  }
  if (hasRespiratory) {
    requiredByCategory.push("Cough syrup or expectorant");
  }
  if (hasDigestive) {
    if (symptoms.includes("acidity") && !symptoms.includes("diarrhea") && !symptoms.includes("vomiting")) {
      requiredByCategory.push("Antacid");
    } else {
      requiredByCategory.push("Electrolyte drink (ORS)");
      requiredByCategory.push("Anti-diarrheal or anti-nausea support");
    }
  }
  if (hasAllergy) {
    requiredByCategory.push("Antihistamine (like Cetirizine)");
  }

  const existing = splitBulletLines(summary.primaryUses);
  const merged = Array.from(new Set([...existing, ...requiredByCategory]));

  // Keep list concise: 2-4 medicine options, no duplicates, simple clear names
  let capped = merged.slice(0, 4);
  if (capped.length < 2) {
    const fallbackLines = [
      "Paracetamol (for pain and fever)",
      "Electrolyte drink (ORS)",
    ];
    capped = Array.from(new Set([...capped, ...fallbackLines])).slice(0, 4);
  }

  return {
    ...summary,
    primaryUses: toBullets(capped),
  };
}

function enforceSymptomCoverage(summary: MedicineSummary, question: string): MedicineSummary {
  const mentionedSymptoms = detectMentionedSymptoms(question);
  if (mentionedSymptoms.length === 0) {
    return summary;
  }

  const combinedText = [
    summary.medicineName,
    summary.primaryUses,
    summary.howItWorks,
    summary.commonSideEffects,
    summary.warningsPrecautions,
  ]
    .join("\n")
    .toLowerCase();

  const missingSymptoms = mentionedSymptoms.filter((symptom) => !combinedText.includes(symptom));
  if (missingSymptoms.length === 0) {
    return summary;
  }

  const adviceLines = splitBulletLines(summary.commonSideEffects);
  const appendedLines = missingSymptoms.map(
    (symptom) => `For ${symptom}: monitor this symptom specifically and seek doctor review if it worsens or does not improve.`
  );

  return {
    ...summary,
    commonSideEffects: toBullets(Array.from(new Set([...adviceLines, ...appendedLines]))),
  };
}

function buildConsultationMergedInput(
  currentInput: string,
  context?: ConsultationContext,
): { mergedInput: string; hasFollowUp: boolean } {
  const initialSymptoms = context?.initialSymptoms?.trim() || currentInput.trim();
  const answers = (context?.followUpAnswers || [])
    .map((item) => item.trim())
    .filter(Boolean);

  if (answers.length === 0) {
    return { mergedInput: initialSymptoms, hasFollowUp: false };
  }

  const mergedInput = [
    `Initial symptoms: ${initialSymptoms}`,
    "Follow-up answers:",
    ...answers.map((answer, index) => `${index + 1}. ${answer}`),
    `Latest user message: ${currentInput.trim()}`,
  ].join("\n");

  return { mergedInput, hasFollowUp: true };
}

function escapeOpenFdaValue(value: string): string {
  return value.replace(/"/g, "\\\"").trim();
}

function buildOpenFdaQueries(term: string): string[] {
  const cleaned = term.toLowerCase().trim().replace(/\s+/g, " ");
  const escaped = escapeOpenFdaValue(cleaned);
  const parts = cleaned.split(" ").filter(Boolean);
  const firstToken = parts[0] || cleaned;

  const queries = [
    `openfda.generic_name:\"${escaped}\"`,
    `openfda.brand_name:\"${escaped}\"`,
    `openfda.substance_name:\"${escaped}\"`,
    `openfda.generic_name:${escaped}*`,
    `openfda.brand_name:${escaped}*`,
  ];

  if (firstToken && firstToken !== cleaned) {
    const escapedToken = escapeOpenFdaValue(firstToken);
    queries.push(`openfda.generic_name:${escapedToken}*`);
    queries.push(`openfda.brand_name:${escapedToken}*`);
  }

  return Array.from(new Set(queries));
}

async function fetchOpenFda(
  medicineName: string,
  retries = 1,
  requestTimeoutMs = 10000,
): Promise<StructuredOpenFdaData | null> {
  const searchQueries = buildOpenFdaQueries(medicineName);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`OpenFDA attempt ${attempt + 1}/${retries + 1}...`);

      for (const query of searchQueries) {
        const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(query)}&limit=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

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
            // Try next query pattern before giving up.
            continue;
          }

          throw new Error(`OpenFDA request failed with status ${response.status}`);
        }

        const data = (await response.json()) as OpenFdaResponse;
        const first = data.results?.[0];

        if (!first) {
          continue;
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

      // None of the query patterns matched.
      return null;
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

async function summarizeWithOpenRouter(
  payload: StructuredOpenFdaData,
  retries = 1,
  requestTimeoutMs = 12000,
): Promise<MedicineSummary> {
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
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: buildOpenRouterHeaders(apiKey),
        body: JSON.stringify({
          model: MEDICINE_SUMMARY_MODEL,
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

async function generateMedicineInfoWithAI(
  medicineName: string,
  retries = 1,
  requestTimeoutMs = 12000,
): Promise<MedicineSummary> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const aiPrompt = `You are a knowledgeable medical information assistant. Provide accurate, general information about the medicine: ${medicineName}

IMPORTANT: 
- Only provide information if this is a real, known medicine
- If you're not fully certain, provide conservative high-level guidance and ask user to verify spelling
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

If this appears to be an invalid medicine name, return:
- medicineName as the provided name
- practical verification guidance in all other fields (pharmacist check, spelling check, package photo, avoid self-medication), not blank text.`;

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
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: buildOpenRouterHeaders(apiKey),
        body: JSON.stringify({
          model: MEDICINE_SUMMARY_MODEL,
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

function buildConsultationFallback(question: string): MedicineSummary {
  const normalized = question.toLowerCase();
  const emergencyKeywords = ["chest pain", "shortness of breath", "breathing", "faint", "unconscious", "stroke", "seizure", "heavy bleeding", "suicidal", "overdose"];
  const isUrgent = emergencyKeywords.some((keyword) => normalized.includes(keyword));
  const hasDigestiveSymptoms = /(diarrhea|loose motion|loose motions|vomit|vomiting|nausea|stomach pain|stomach upset|abdomen|abdominal|gas|acidity|heartburn)/.test(normalized);
  const hasRespiratorySymptoms = /(cold|cough|throat|sore throat|runny nose|flu|fever)/.test(normalized);
  const hasHeadacheSymptoms = /(headache|migraine|head pain)/.test(normalized);
  const hasAllergySymptoms = /(allergy|allergic|itch|itching|rash|hives|sneezing|watery eyes)/.test(normalized);

  // STRICT: Only include conditions directly related to detected symptoms
  let possibleConditions = "";
  if (hasDigestiveSymptoms) {
    possibleConditions = "• Stomach upset\n• Digestive issue";
    if (normalized.includes("acidity") || normalized.includes("gas") || normalized.includes("heartburn")) {
      possibleConditions = "• Acidity\n• Indigestion";
    }
  } else if (hasRespiratorySymptoms) {
    possibleConditions = "• Cold\n• Cough/respiratory symptoms";
  } else if (hasHeadacheSymptoms) {
    possibleConditions = "• Headache\n• Migraine";
  } else if (hasAllergySymptoms) {
    possibleConditions = "• Allergy\n• Allergic reaction";
  } else {
    // Fallback for unmapped symptoms
    possibleConditions = "• Symptom-related concern\n• Needs medical evaluation";
  }

  const medicineOptions: string[] = [];
  if (hasRespiratorySymptoms || hasHeadacheSymptoms) {
    medicineOptions.push("Paracetamol (for pain and fever)");
  }
  if (hasRespiratorySymptoms) {
    medicineOptions.push("Cough syrup or expectorant");
  }
  if (hasAllergySymptoms) {
    medicineOptions.push("Antihistamine (like Cetirizine)");
  }
  if (hasDigestiveSymptoms) {
    medicineOptions.push("Electrolyte drink (ORS)");
    if (normalized.includes("diarrhea") || normalized.includes("loose motion") || normalized.includes("loose motions")) {
      medicineOptions.push("Anti-diarrheal support");
    }
    if (normalized.includes("vomit") || normalized.includes("vomiting") || normalized.includes("nausea")) {
      medicineOptions.push("Anti-nausea support");
    }
    if (normalized.includes("acidity") || normalized.includes("gas") || normalized.includes("heartburn")) {
      medicineOptions.push("Antacid");
    }
  }

  if (medicineOptions.length === 0) {
    medicineOptions.push("Paracetamol (for pain and fever)");
    medicineOptions.push("Symptom-specific medicine by doctor or pharmacist");
  }

  const uniqueMedicines = deduplicateMedicines(medicineOptions).slice(0, 4);
  const commonMedicines = toBullets(uniqueMedicines);

  // STRICT: Only symptom-specific follow-up questions - no generic questions
  let followUpQuestions: string[] = [];

  if (hasDigestiveSymptoms) {
    followUpQuestions = [
      "How many loose stools or vomiting episodes in the last 24 hours?",
      "Are you able to keep fluids/food down?",
      "Any blood in stool/vomit or severe abdominal pain?",
      "Did this start after new food, travel, or medicine?",
    ];
  } else if (hasRespiratorySymptoms) {
    followUpQuestions = [
      "Is cough dry or with mucus? If mucus, what color?",
      "Any breathing difficulty or chest pain?",
      "How many days have cold/cough symptoms lasted?",
      "Any recent sick contact or environmental triggers?",
    ];
  } else if (hasAllergySymptoms) {
    followUpQuestions = [
      "What specific allergy signs: rash, itch, sneezing, swelling, or watery eyes?",
      "Did symptoms start after a specific trigger (food, dust, medicine, skin product)?",
      "Any lip/tongue swelling or breathing changes?",
      "Have you used anti-allergy medicine? Did it help?",
    ];
  } else if (hasHeadacheSymptoms) {
    followUpQuestions = [
      "Where is the pain located: front, back, one side, or all over?",
      "Is it throbbing, pressure, or sharp?",
      "Any nausea, vision changes, weakness, or confusion?",
      "What triggers it: stress, sleep loss, dehydration, or skipped meals?",
    ];
  }

  // Fallback if no symptom category matched
  if (followUpQuestions.length === 0) {
    followUpQuestions = [
      "When exactly did symptoms start?",
      "What is the current severity on scale 1-10?",
    ];
  }

  let adviceBlock = "• See a doctor if symptoms last more than 2-3 days\n• Seek urgent help if symptoms suddenly worsen";
  if (isUrgent) {
    adviceBlock = "• Consult emergency care immediately due to concerning symptoms\n• This requires urgent medical attention";
  }

  let precautionsBlock = "• Rest and hydration can help recovery\n• Track symptom progression and triggers\n• Avoid combining multiple OTC medicines without checking labels\n• Seek in-person review if symptoms persist or worsen";
  if (hasDigestiveSymptoms) {
    precautionsBlock = "• Take frequent small sips of ORS/water to prevent dehydration\n• Prefer light, easy-to-digest food and avoid oily/spicy meals\n• Avoid anti-diarrheal medicines if high fever or blood in stool is present\n• Seek urgent care if blood in stool, persistent vomiting, or reduced urine output";
  } else if (hasRespiratorySymptoms) {
    precautionsBlock = "• Wear a mask and reduce close contact if cough/fever is present\n• Use warm fluids and throat care for irritation when needed\n• Rest voice and avoid smoke/dust exposure\n• Seek urgent care for breathing difficulty, persistent high fever, or chest pain";
  } else if (hasHeadacheSymptoms) {
    precautionsBlock = "• Rest in a dark, low-noise room and reduce screen exposure\n• Avoid known triggers such as poor sleep, dehydration, or missed meals\n• Limit caffeine overuse and maintain regular meals\n• Seek urgent care for severe sudden headache, weakness, confusion, or vision changes";
  }

  return {
    medicineName: possibleConditions,
    primaryUses: commonMedicines,
    howItWorks: precautionsBlock,
    commonSideEffects: adviceBlock,
    warningsPrecautions:
      "This is for informational purposes only and not a diagnosis. For severe, persistent, or worsening symptoms, consult a licensed doctor. Seek emergency care for red-flag symptoms.",
    importantNotes: `• To give more relevant advice, please reply with:\n${followUpQuestions.map((item) => `• ${item}`).join("\n")}`,
  };
}

async function generateConsultationAdviceWithAI(
  question: string,
  consultationContext?: ConsultationContext,
  retries = 2,
): Promise<MedicineSummary> {
  const { mergedInput, hasFollowUp } = buildConsultationMergedInput(question, consultationContext);
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    const fallbackSummary = enforceConsultationMedicineCoverage(buildConsultationFallback(mergedInput), mergedInput);
    return enforceSymptomCoverage(fallbackSummary, mergedInput);
  }

  const prompt = `You are a helpful medical consultation assistant.
The user first shared initial symptoms and then provided follow-up answers.
You must use BOTH initial symptoms and follow-up answers to refine your response.
Do not ignore previous context.

${hasFollowUp ? "Context-rich consultation input:" : "User consultation input:"}
"${mergedInput}"

Respond ONLY as valid JSON with string keys:
medicineName, primaryUses, howItWorks, commonSideEffects, warningsPrecautions, importantNotes

Follow this output contract exactly:
${consultationAssistantPrompt}`;

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: "You are a medical consultation support assistant. Provide only safe, general advice. Always return valid JSON.",
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: buildOpenRouterHeaders(apiKey),
        body: JSON.stringify({
          model: MEDICINE_SUMMARY_MODEL,
          temperature: 0.3,
          messages,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const failureText = await response.text();
        throw new Error(`Consultation generation failed (${response.status}): ${failureText}`);
      }

      const responseData = (await response.json()) as OpenRouterResponse;
      const content = responseData.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("Consultation generation returned empty response");
      }

      const aiSummary = parseAiJson(content);
      const medicineOnlyChecked = enforceConsultationMedicineSection(aiSummary);
      const medicineCoverageChecked = enforceConsultationMedicineCoverage(medicineOnlyChecked, mergedInput);
      const medicineChecked = medicineCoverageChecked;
      medicineChecked.warningsPrecautions =
        "This is for informational purposes only and not a diagnosis. For severe, persistent, or worsening symptoms, consult a licensed doctor. Seek emergency care for red-flag symptoms.";
      return enforceSymptomCoverage(medicineChecked, mergedInput);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      if (
        attempt < retries &&
        (lastError.message.includes("timeout") ||
          lastError.message.includes("fetch failed") ||
          lastError.message.includes("ECONNREFUSED"))
      ) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (attempt === retries) {
        const fallbackSummary = enforceConsultationMedicineCoverage(buildConsultationFallback(mergedInput), mergedInput);
        return enforceSymptomCoverage(fallbackSummary, mergedInput);
      }
    }
  }

  const fallbackSummary = enforceConsultationMedicineCoverage(buildConsultationFallback(mergedInput), mergedInput);
  return enforceSymptomCoverage(fallbackSummary, mergedInput);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      medicineName?: string;
      mode?: InputMode;
      consultationContext?: ConsultationContext;
    };
    const userInput = body?.medicineName?.trim();
    const mode: InputMode = body?.mode === "consultation" ? "consultation" : "guidance";

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

    if (mode === "consultation") {
      const consultationValidation = await classifyConsultationInput(userInput);
      if (consultationValidation.classification === "non-health") {
        return NextResponse.json(
          {
            success: false,
            error:
              "⚠️ Please ask a health-related question (symptoms, discomfort, illness concern, or medicines) so I can help safely.",
          },
          { status: 422 },
        );
      }

      const consultationSummary = await generateConsultationAdviceWithAI(userInput, body.consultationContext);
      const hasFollowUp = Boolean(body.consultationContext?.followUpAnswers?.length);
      const isAmbiguous = consultationValidation.classification === "ambiguous";
      return NextResponse.json(
        {
          success: true,
          source: "ai-generated",
          mode,
          assistantMessage: hasFollowUp
            ? "Refined Consultation Guidance\nI used your original symptoms and follow-up answers to refine conditions, medicines, and advice."
            : isAmbiguous
              ? "Consultation Guidance\nYour symptoms are a bit broad, so I included targeted follow-up questions to make advice more precise."
              : "Consultation Guidance\nBased on your problem, here are possible relief medicines, care steps, and follow-up questions.",
          summary: consultationSummary,
          disclaimer: "This is general guidance only and not a medical diagnosis. Please consult a licensed healthcare professional for personalized care.",
        },
        { status: 200 },
      );
    }

    // Guidance fast path: for direct medicine-style inputs, try OpenFDA first without waiting for extraction AI.
    console.log(`Processing user input: ${userInput}`);
    const normalizedInput = normalizeGuidanceSearchTerm(userInput);
    const tryDirectFirst = looksLikeDirectMedicineQuery(userInput) || normalizedInput.split(" ").length <= 2;

    let structuredData: StructuredOpenFdaData | null = null;
    let extractedName = normalizedInput || userInput;

    if (tryDirectFirst && normalizedInput) {
      structuredData = await fetchOpenFda(normalizedInput, 0, 7000);
      if (structuredData) {
        extractedName = structuredData.medicineName || normalizedInput;
      }
    }

    let extracted: ExtractedMedicineResult | null = null;
    if (!structuredData) {
      extracted = await extractMedicineName(userInput);
    }
    
    if (!structuredData && (!extracted || extracted.shouldAskClarification || !extracted.medicineName)) {
      return NextResponse.json(
        {
          success: false,
          code: "VALIDATION_ERROR",
          error:
            "I could not confidently identify the medicine name. Please provide the medicine name directly (for example: ibuprofen 200 mg tablet).",
        },
        { status: 422 },
      );
    }

    extractedName = structuredData ? extractedName : extracted!.medicineName;

    console.log(`Extracted medicine name: ${extractedName}`);
    console.log(`Fetching data for medicine: ${extractedName}`);
    if (!structuredData) {
      structuredData = await fetchOpenFda(extractedName, 1, 10000);
    }

    // If extraction was imperfect, retry OpenFDA using cleaned original input.
    if (!structuredData && extractedName.toLowerCase() !== userInput.toLowerCase()) {
      const fallbackTerm = userInput.toLowerCase().replace(/\b(tell|me|about|what|is|the|a|an|for|used|side|effects|of|information|info|on|please)\b/g, " ").replace(/\s+/g, " ").trim();
      if (fallbackTerm) {
        console.log(`Retrying OpenFDA with fallback term: ${fallbackTerm}`);
        structuredData = await fetchOpenFda(fallbackTerm, 0, 7000);
      }
    }

    if (!structuredData) {
      // Fall back to AI-generated information
      console.log("No OpenFDA data found, generating with AI...");
      try {
        const aiSummary = await generateMedicineInfoWithAI(extractedName, 0, 12000);
        
        return NextResponse.json(
          {
            success: true,
            source: "ai-generated",
            mode,
            assistantMessage: `Here's the information about ${aiSummary.medicineName}:`,
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
    const summary = await summarizeWithOpenRouter(structuredData, 1, 12000);

    return NextResponse.json(
      {
        success: true,
        source: "openfda",
        mode,
        assistantMessage: `Here's the information about ${summary.medicineName}:`,
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