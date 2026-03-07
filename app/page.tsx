"use client";

import { FormEvent, useMemo, useState, useRef, useEffect } from "react";
import { Layers, User, XCircle, Loader2, Send } from "lucide-react";

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
  source: "openfda";
  summary: MedicineSummary;
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
};

const RESULT_SECTIONS: Array<{ key: keyof MedicineSummary; label: string }> = [
  { key: "medicineName", label: "Medicine Name" },
  { key: "primaryUses", label: "Primary Uses" },
  { key: "howItWorks", label: "How It Works" },
  { key: "commonSideEffects", label: "Common Side Effects" },
  { key: "warningsPrecautions", label: "Warnings / Precautions" },
  { key: "importantNotes", label: "Important Notes" },
];

export default function Home() {
  const [medicineName, setMedicineName] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await fetch("/api/medicine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ medicineName: userMessage }),
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

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: `Here's the information about ${payload.summary.medicineName}:`,
        summary: payload.summary,
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
                What is ibuprofen used for?
              </button>
              <button
                className="example-prompt"
                onClick={() => setMedicineName("aspirin")}
              >
                Tell me about aspirin
              </button>
              <button
                className="example-prompt"
                onClick={() => setMedicineName("paracetamol")}
              >
                Paracetamol side effects
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
                        {message.summary && (
                          <div className="summary-grid">
                            {RESULT_SECTIONS.map((section) => (
                              <div className="summary-section" key={section.key}>
                                <h3>{section.label}</h3>
                                <p>{message.summary![section.key]}</p>
                              </div>
                            ))}
                          </div>
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
            <div className="input-box">
              <input
                ref={inputRef}
                type="text"
                value={medicineName}
                onChange={(e) => setMedicineName(e.target.value)}
                placeholder="Ask about a medicine..."
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
          {messages.length === 0 && (
            <p className="input-disclaimer">
              AI-powered medicine information from FDA data. Always consult a healthcare professional.
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
