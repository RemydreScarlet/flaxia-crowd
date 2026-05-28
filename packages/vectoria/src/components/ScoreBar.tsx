interface ScoreBarProps {
  score: number;
}

export function ScoreBar({ score }: ScoreBarProps) {
  const color = score > 0.6 ? "#34a853" : score > 0.3 ? "#fbbc04" : "#ea4335";

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <div className="w-20 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(score * 100, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span>{Math.round(score * 100)}%</span>
    </div>
  );
}
