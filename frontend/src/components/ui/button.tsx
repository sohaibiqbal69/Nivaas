import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonStyles = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        primary: 'bg-secondary text-secondary-foreground hover:bg-info',
        outline: 'border border-border bg-background text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
      },
      size: { default: '', icon: 'size-11 shrink-0 p-0' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}
