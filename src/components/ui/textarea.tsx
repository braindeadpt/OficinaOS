interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={[
        "w-full resize-none rounded-xl border-none bg-surface-container-lowest px-4 py-3.5 text-sm transition-all",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
