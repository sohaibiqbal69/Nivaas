import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeStyles = cva('inline-flex items-center gap-1.5 rounded-none border-0 border-l-2 px-2 py-1 text-xs font-semibold leading-none transition-[color,border-color,background-color] duration-200 motion-reduce:transition-none', {
  variants: {
    variant: {
      neutral: 'border-l-neutral bg-transparent text-foreground',
      info: 'border-l-info bg-transparent text-info',
      success: 'border-l-success bg-transparent text-success',
      warning: 'border-l-warning bg-transparent text-warning',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
