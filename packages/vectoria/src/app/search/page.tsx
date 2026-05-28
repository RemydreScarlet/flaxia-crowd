"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import { SearchBar } from "@/components/SearchBar";
import { SearchResult } from "@/components/SearchResult";
import { ThemeToggle } from "@/components/ThemeToggle";

interface SearchResultData {
  docId: string;
  score: number;
  metadata: { title: string; url: string; snippet: string };
}

function SearchResultsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") || "";
  const lucky = searchParams.get("lucky") === "1";

  const [results, setResults] = useState<SearchResultData[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) return;

    setLoading(true);
    setError(null);

    fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, topK: 10 }),
    })
      .then((res) => res.json())
      .then((data) => {
        setResults(data.results || []);
        setTotalResults(data.totalResults || 0);
        setDuration(data.searchDurationMs || 0);

        if (lucky && data.results?.length > 0) {
          const top = data.results[0];
          window.open(top.metadata.url, "_blank");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  const handleSearch = (q: string) => {
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#202124]">
      <header className="sticky top-0 bg-white/95 dark:bg-[#202124]/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 z-10">
        <div className="max-w-[652px] mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="text-xl font-bold text-[#4285f4] shrink-0">
            Vectoria
          </a>
          <div className="flex-1">
            <SearchBar initialQuery={query} onSearch={handleSearch} />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-[652px] mx-auto px-4 pt-4 pb-12">
        {loading && (
          <div className="space-y-6 animate-pulse">
            <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-5 w-96 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-red-500 dark:text-red-400 p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
            {error}
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {totalResults} 件 ({duration} ms)
            </p>
            {results.map((r) => (
              <SearchResult
                key={r.docId}
                url={r.metadata.url}
                title={r.metadata.title}
                snippet={r.metadata.snippet}
                score={r.score}
              />
            ))}
          </>
        )}

        {!loading && !error && query && results.length === 0 && (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            <p className="text-lg mb-2">検索結果が見つかりませんでした</p>
            <p className="text-sm">
              「{query}」に一致するインデックスが見つかりません。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white dark:bg-[#202124] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-[#4285f4] border-t-transparent rounded-full" />
      </div>
    }>
      <SearchResultsInner />
    </Suspense>
  );
}
