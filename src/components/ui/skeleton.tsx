interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-surface-container-high ${className ?? ""}`}
    />
  );
}

const HEADER_KEYS = ["h-a", "h-b", "h-c", "h-d", "h-e", "h-f", "g-h", "h-i"];
const ROW_KEYS = [
  "r-a",
  "r-b",
  "r-c",
  "r-d",
  "r-e",
  "r-f",
  "r-g",
  "r-h",
  "r-i",
  "r-j",
];
const CELL_KEYS = ["c-a", "c-b", "c-c", "c-d", "c-e", "c-f", "c-g", "c-h"];

interface TableSkeletonProps {
  columns?: number;
  rows?: number;
}

export function TableSkeleton({ columns = 5, rows = 6 }: TableSkeletonProps) {
  return (
    <div
      aria-busy="true"
      className="animate-pulse overflow-hidden rounded-2xl bg-surface-container-low p-4"
      role="status"
    >
      <div className="mb-3 flex gap-6 px-2">
        {HEADER_KEYS.slice(0, columns).map((k) => (
          <Skeleton className="h-3 w-20" key={k} />
        ))}
      </div>
      {ROW_KEYS.slice(0, rows).map((rowKey) => (
        <div
          className="flex items-center gap-6 rounded-xl px-2 py-3.5"
          key={rowKey}
        >
          {CELL_KEYS.slice(0, columns).map((cellKey, c) => (
            <Skeleton
              className={`h-4 ${c === 0 ? "w-28" : "w-16"}`}
              key={cellKey}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={`animate-pulse rounded-2xl bg-surface-container-low p-6 ${className ?? ""}`}
      role="status"
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-8 w-48" />
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
    </div>
  );
}

export default Skeleton;
