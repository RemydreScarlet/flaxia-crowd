"use client";

import { useState, useCallback, useRef } from "react";

interface SearchBarProps {
  initialQuery?: string;
  autoFocus?: boolean;
  onSearch: (query: string) => void;
}

export function SearchBar({ initialQuery = "", autoFocus = false, onSearch }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) onSearch(trimmed);
    },
    [query, onSearch],
  );

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[584px] mx-auto">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-full border border-[#dfe1e5] dark:border-[#5f6368]
                    bg-[#f1f3f4] dark:bg-[#303134] hover:bg-[#e8eaed] dark:hover:bg-[#3c4043]
                    focus-within:border-[#4285f4] dark:focus-within:border-[#8ab4f8]
                    focus-within:shadow-[0_1px_6px_rgba(32,33,36,0.28)]
                    transition-all"
      >
        <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
          className="flex-1 bg-transparent outline-none text-base text-[#222] dark:text-[#e8eaed] placeholder-gray-500"
          placeholder="Search or type URL..."
        />
      </div>
    </form>
  );
}
