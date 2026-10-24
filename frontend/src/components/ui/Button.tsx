import React, { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-all duration-150 select-none disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00A63E] focus-visible:ring-offset-1 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-[#00A63E] text-white hover:bg-[#009236] shadow-sm",
        outline: "border border-[#00A63E] text-[#00A63E] bg-white hover:bg-[#EAF6EE]",
        secondary: "bg-[#F4F5F6] text-[#111827] hover:bg-[#E5E7EB]",
        ghost: "bg-transparent text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]",
        danger: "bg-[#DC2626] text-white hover:bg-[#B91C1C]"
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-full",
        md: "h-10 px-5 text-sm rounded-full",
        lg: "h-12 px-6 text-base rounded-full",
        icon: "h-9 w-9 rounded-full p-0"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
