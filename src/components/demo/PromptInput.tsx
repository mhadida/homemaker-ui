"use client";

import { useState, useCallback } from "react";

interface PromptInputProps {
  onApply: (prompt: string) => void;
  isLoading: boolean;
}

const SUGGESTIONS = [
  "2-storey modern house",
  "fancy 3-storey with slate roof",
  "courtyard building",
  "halifax-style arcade",
];

/**
 * Floating prompt pill — fixed to the bottom-center of the viewport. Sits
 * over the 3D canvas without taking up sidebar real estate. Suggestion
 * chips appear above the input on focus / when empty, to scaffold first-
 * time users without dominating the screen.
 */
export default function PromptInput({ onApply, isLoading }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (prompt.trim() && !isLoading) {
        onApply(prompt.trim());
        setPrompt("");
      }
    },
    [prompt, isLoading, onApply],
  );

  const showSuggestions = (focused || !prompt) && !isLoading;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-20 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2">
      {showSuggestions && (
        <div className="pointer-events-auto mb-2 flex flex-wrap justify-center gap-1.5 px-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setPrompt(s);
                onApply(s);
              }}
              disabled={isLoading}
              className="rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/85 backdrop-blur-md transition-colors hover:bg-black/70 disabled:opacity-30"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="pointer-events-auto relative rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/10 shadow-2xl"
      >
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Describe your building — e.g. 3-storey fancy with slate roof"
          disabled={isLoading}
          className="w-full bg-transparent px-5 py-3 pr-12 text-sm text-white placeholder:text-white/45 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Generate building from prompt"
        >
          {isLoading ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
