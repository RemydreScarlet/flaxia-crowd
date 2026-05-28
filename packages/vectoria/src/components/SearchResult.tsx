import { ScoreBar } from "./ScoreBar";

interface SearchResultProps {
  url: string;
  title: string;
  snippet: string;
  score: number;
}

function highlightSnippet(text: string, query: string): string {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
}

function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

export function SearchResult({ url, title, snippet, score }: SearchResultProps) {
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {}

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-0.5">
        <img
          src={getFaviconUrl(domain)}
          alt=""
          className="w-4 h-4 rounded"
          width={16}
          height={16}
        />
        <span className="text-xs text-[#006621] dark:text-[#bdc1c6] truncate">{url}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#1a0dab] dark:text-[#8ab4f8] text-lg font-medium leading-6 hover:underline"
      >
        {title}
      </a>
      <p
        className="text-sm text-[#545454] dark:text-[#bdc1c6] leading-5 mt-0.5"
        dangerouslySetInnerHTML={{ __html: highlightSnippet(snippet, "") }}
      />
      <div className="mt-1">
        <ScoreBar score={score} />
      </div>
    </div>
  );
}
