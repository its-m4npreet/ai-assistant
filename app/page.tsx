"use client";

import { FormEvent, useMemo, useState, useRef, useEffect } from "react";
import { Layers, User, XCircle, Loader2, Send } from "lucide-react";
import { useLanguage } from "./context/LanguageContext";
import LanguageSelector from "./components/LanguageSelector";

type MedicineSummary = {
  medicineName: string;
  primaryUses: string;
  howItWorks: string;
  commonSideEffects: string;
  warningsPrecautions: string;
  importantNotes: string;
};

type ApiSuccessResponse = {
  success: true;
  source: "openfda" | "ai-generated";
  summary: MedicineSummary;
  mode?: "guidance" | "consultation";
  assistantMessage?: string;
  disclaimer?: string;
};

type ApiErrorResponse = {
  success: false;
  error: string;
  code?: string;
};

type Message = {
  id: string;
  type: "user" | "assistant" | "error";
  content: string;
  summary?: MedicineSummary;
  mode?: "guidance" | "consultation";
  source?: "openfda" | "ai-generated";
  disclaimer?: string;
};

const GUIDANCE_RESULT_SECTIONS: Array<{ key: keyof MedicineSummary; label: string }> = [
  { key: "medicineName", label: "Medicine Name" },
  { key: "primaryUses", label: "Primary Uses" },
  { key: "howItWorks", label: "How It Works" },
  { key: "commonSideEffects", label: "Common Side Effects" },
  { key: "warningsPrecautions", label: "Warnings / Precautions" },
  { key: "importantNotes", label: "Important Notes" },
];

const CONSULTATION_CHAT_SECTIONS: Array<{ key: keyof MedicineSummary; label: string }> = [
  { key: "medicineName", label: "Possible Conditions" },
  { key: "primaryUses", label: "Common Medicines" },
  { key: "howItWorks", label: "Precautions" },
  { key: "commonSideEffects", label: "Advice" },
  { key: "warningsPrecautions", label: "Disclaimer" },
  { key: "importantNotes", label: "Follow-Up Questions" },
];

export default function Home() {
  const [medicineName, setMedicineName] = useState("");
  const [inputMode, setInputMode] = useState<"guidance" | "consultation">("guidance");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { language } = useLanguage();

  const inputPlaceholder =
    inputMode === "guidance"
      ? "Ask for medicine guidance..."
      : "Ask a consultation question...";

  const isDisabled = useMemo(
    () => loading || medicineName.trim().length === 0,
    [loading, medicineName],
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function translateText(text: string, targetLang: string): Promise<string> {
    if (targetLang === "en") return text;
    
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          targetLanguage: targetLang,
          sourceLanguage: "en",
        }),
      });

      const data = await response.json();
      return data.success ? data.translation : text;
    } catch (error) {
      console.error("Translation error:", error);
      return text;
    }
  }

  async function translateSummary(summary: MedicineSummary, targetLang: string): Promise<MedicineSummary> {
    if (targetLang === "en") return summary;

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary,
          targetLanguage: targetLang,
          sourceLanguage: "en",
        }),
      });

      const data = await response.json();
      return data.success && data.summary ? data.summary : summary;
    } catch (error) {
      console.error("Translation error:", error);
      return summary;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDisabled) return;

    const userMessage = medicineName.trim();
    setMedicineName("");

    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      type: "user",
      content: userMessage,
      mode: inputMode,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const requestBody =
        inputMode === "consultation"
          ? {
              medicineName: userMessage,
              mode: inputMode,
            }
          : {
              medicineName: userMessage,
              mode: inputMode,
            };

      const response = await fetch("/api/medicine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as ApiSuccessResponse | ApiErrorResponse;

      if (!response.ok || !payload.success) {
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          type: "error",
          content: "error" in payload ? payload.error : "Request failed. Please try again.",
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      // Translate the summary to the selected language
      const translatedSummary = await translateSummary(payload.summary, language.code);
      const assistantMessage = payload.assistantMessage ||
        (inputMode === "guidance"
          ? `Here's the information about ${payload.summary.medicineName}:`
          : "Here is consultation guidance related to your question:");
      const translatedMessage = await translateText(
        assistantMessage,
        language.code
      );

      // Translate disclaimer if present
      let translatedDisclaimer: string | undefined;
      if (payload.disclaimer) {
        translatedDisclaimer = await translateText(payload.disclaimer, language.code);
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: translatedMessage,
        summary: translatedSummary,
        mode: payload.mode ?? inputMode,
        source: payload.source,
        disclaimer: translatedDisclaimer,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: "error",
        content: "Unexpected network error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="chat-container">
      {/* Header */}
      <header className="chat-header">
        <div className="header-content">
          <div className="header-title">
            <div className="logo-icon">
              <Layers size={24} />
            </div>
            <h1>AI Assistant</h1>
          </div>
          <LanguageSelector />
        </div>
      </header>

      {/* Messages Area */}
      <main className="messages-container">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-icon">
              <Layers size={48} />
            </div>
            <h2>AI Assistant for Medicine Information</h2>
            <p className="welcome-subtitle">
              Ask me about any medicine to get FDA-verified information
            </p>
            <div className="example-prompts">
              <button
                className="example-prompt"
                onClick={() => setMedicineName("ibuprofen")}
              >
                ibuprofen
              </button>
              <button
                className="example-prompt"
                onClick={() => setMedicineName("aspirin")}
              >
                aspirin
              </button>
              <button
                className="example-prompt"
                onClick={() => setMedicineName("paracetamol")}
              >
                Paracetamol
              </button>
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message-wrapper ${message.type === "user" ? "user-message" : "assistant-message"}`}
              >
                <div className="message-content">
                  {message.type === "user" ? (
                    <div className="user-avatar">
                      <User size={20} />
                    </div>
                  ) : (
                    <div className="assistant-avatar">
                      <Layers size={20} />
                    </div>
                  )}

                  <div className="message-text">
                    {message.type === "error" ? (
                      <div className="error-message">
                        <XCircle size={18} />
                        <span>{message.content}</span>
                      </div>
                    ) : (
                      <>
                        <p>{message.content}</p>
                        {message.disclaimer && (
                          <div className="disclaimer-badge">
                            <span className="disclaimer-icon">ℹ️</span>
                            <span>{message.disclaimer}</span>
                          </div>
                        )}
                        {message.summary && (
                          message.mode === "consultation" ? (
                            <div className="consultation-chat" role="region" aria-label="Consultation guidance">
                              {CONSULTATION_CHAT_SECTIONS.map((section) => (
                                <div className="consultation-block" key={section.key}>
                                  <h3>{section.label}</h3>
                                  <p>{message.summary![section.key]}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="summary-grid">
                              {GUIDANCE_RESULT_SECTIONS.map((section) => (
                                <div className="summary-section" key={section.key}>
                                  <h3>{section.label}</h3>
                                  <p>{message.summary![section.key]}</p>
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="message-wrapper assistant-message">
                <div className="message-content">
                  <div className="assistant-avatar">
                    <Layers size={20} />
                  </div>
                  <div className="message-text">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="input-container">
        <div className="input-wrapper">
          <form onSubmit={handleSubmit} className="input-form">
            <div className="input-label-row" aria-label="Input categories">
              <button
                type="button"
                className={`input-label-pill ${inputMode === "guidance" ? "active" : ""}`}
                onClick={() => setInputMode("guidance")}
                aria-pressed={inputMode === "guidance"}
              >
                Guidance
              </button>
              <button
                type="button"
                className={`input-label-pill ${inputMode === "consultation" ? "active" : ""}`}
                onClick={() => setInputMode("consultation")}
                aria-pressed={inputMode === "consultation"}
              >
                Consultation
              </button>
            </div>
            <div className="input-box">
              <input
                ref={inputRef}
                type="text"
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
                placeholder={inputPlaceholder}
                autoComplete="off"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={isDisabled}
                className="send-button"
                aria-label="Send message"
              >
                {loading ? (
                  <Loader2 className="spinner" size={20} />
                ) : (
                  <Send size={20} />
                )}
              </button>
            </div>
          </form>
          
            <p className="input-disclaimer">
              AI-powered medicine information from FDA data. Always consult a healthcare professional before consuming any medication.
            </p>
      
        </div>
      </footer>
    </div>
  );
}
