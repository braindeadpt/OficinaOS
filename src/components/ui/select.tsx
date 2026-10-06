interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={[
        "oos-field oos-select h-10 pointer-coarse:h-12 w-full cursor-pointer appearance-none ps-3 pe-9",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
