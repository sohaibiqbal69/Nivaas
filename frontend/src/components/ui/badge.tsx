import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeStyles = cva('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none', {
  variants: {
    variant: {
      neutral: 'border-border bg-background text-foreground',
      info: 'border-info/30 bg-info/10 text-info',
      success: 'border-success/30 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
