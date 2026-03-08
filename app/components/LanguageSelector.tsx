"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useLanguage, LANGUAGES } from "../context/LanguageContext";

export default function LanguageSelector() {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="language-selector" ref={dropdownRef}>
      <button
        className="language-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select language"
      >
        <Globe size={18} />
        <span className="language-flag">{language.flag}</span>
        <span className="language-name">{language.name}</span>
        <ChevronDown size={16} className={isOpen ? "chevron-open" : ""} />
      </button>

      {isOpen && (
        <div className="language-dropdown">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              className={`language-option ${lang.code === language.code ? "selected" : ""}`}
              onClick={() => {
                setLanguage(lang);
                setIsOpen(false);
              }}
            >
              <span className="option-flag">{lang.flag}</span>
              <span className="option-name">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
