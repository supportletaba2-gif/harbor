import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-sm border bg-bg px-3 font-mono text-base text-fg outline-none placeholder:text-faint focus-visible:border-line-strong",
        invalid ? "border-danger" : "border-line",
        className,
      )}
      {...props}
    />
  );
}
