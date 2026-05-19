"use client";

import { useState, useCallback } from "react";

interface PromptInputProps {
  onApply: (prompt: string) => void;
  isLoading: boolean;
}

export default function PromptInput({ onApply, isLoading }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (prompt.trim() && !isLoading) {
        onApply(prompt.trim());
      }
    },
    [prompt, isLoading, onApply]
  );

  const suggestions = [
    "2-storey modern house with pitched roof",
    "3-storey courtyard building",
    "Simple 1-storey bungalow",
    "Fancy 4-storey with flat roof",
    "Halifax-style 2-storey building",
    "Cinema-style 3-storey",
  ];

  return (
    <div className="space-y-3">
      <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
        Describe your building
      </label>

      <form onSubmit={handleSubmit} className="relative">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. 3-storey courtyard building with pitched roof"
          disabled={isLoading}
          className="w-full bg-[var(--border)] text-[var(--foreground)] rounded-lg px-4 py-3 pr-12 text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Generate building from prompt"
        >
          {isLoading ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          )}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => {
              setPrompt(s);
              onApply(s);
            }}
            disabled={isLoading}
            className="px-2 py-1 rounded text-[11px] bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-zinc-700 disabled:opacity-30 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}