interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <input
      className={[
        "h-5 min-h-[44px] w-5 min-w-[44px] rounded border-none bg-surface-container-highest text-primary",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="checkbox"
      {...props}
    />
  );
}
