import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-opacity duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg active:opacity-80",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg",
        quiet: "bg-subtle text-fg",
        ghost: "bg-transparent text-muted hover:text-fg",
        danger: "border border-line bg-transparent text-danger",
      },
      size: {
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
