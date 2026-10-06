interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={[
        "oos-field min-h-20 w-full resize-none px-3 py-2.5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
