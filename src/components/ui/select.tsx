interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={[
        "w-full cursor-pointer appearance-none rounded-xl border-none bg-surface-container-highest px-4 py-3.5 text-sm transition-all focus:bg-surface-container-lowest",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
