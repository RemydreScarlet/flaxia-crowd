"use client";

import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/SearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function HomePage() {
  const router = useRouter();

  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const handleLucky = () => {
    const queries = ["hello world", "next.js", "typescript", "vector search"];
    router.push(`/search?q=${encodeURIComponent(queries[Math.floor(Math.random() * queries.length)])}&lucky=1`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-[#4285f4]">
          Vectoria
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Decentralized Vector Search
        </p>
      </div>

      <SearchBar onSearch={handleSearch} autoFocus />

      <div className="flex gap-3 mt-8">
        <button
          onClick={() => handleSearch((document.querySelector("input") as HTMLInputElement)?.value || "")}
          className="px-4 py-2 text-sm bg-[#f8f9fa] dark:bg-[#303134] text-[#3c4043] dark:text-[#e8eaed]
                     border border-[#f8f9fa] dark:border-[#303134] rounded-md
                     hover:border-[#dadce0] dark:hover:border-[#5f6368] hover:shadow-sm transition"
        >
          Vectoria Search
        </button>
        <button
          onClick={handleLucky}
          className="px-4 py-2 text-sm bg-[#f8f9fa] dark:bg-[#303134] text-[#3c4043] dark:text-[#e8eaed]
                     border border-[#f8f9fa] dark:border-[#303134] rounded-md
                     hover:border-[#dadce0] dark:hover:border-[#5f6368] hover:shadow-sm transition"
        >
          I&apos;m Feeling Lucky
        </button>
      </div>

      <footer className="absolute bottom-4 text-xs text-gray-500 dark:text-gray-400">
        Flaxia Crowd 分散検索エンジン
      </footer>
    </div>
  );
}
