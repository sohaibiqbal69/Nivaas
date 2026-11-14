import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { createMotionScope, prefersReducedMotion, revertMotionScope } from '@/lib/motion';
import { cn } from '@/lib/utils';

type ProgressTrackProps = {
  value: number;
  max: number;
  label: string;
  valueText?: string;
  className?: string;
};

export function ProgressTrack({ value, max, label, valueText, className }: ProgressTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const valid = Number.isFinite(value) && Number.isFinite(max) && max > 0 && value >= 0;
  const ratio = valid ? Math.max(0, Math.min(1, value / max)) : 0;
  const percentage = Math.round(ratio * 100);

  useEffect(() => {
    if (!valid || !trackRef.current || !fillRef.current) return undefined;
    const scope = createMotionScope(trackRef.current);
    if (!scope) return undefined;

    const fill = fillRef.current;
    const reveal = () => {
      if (prefersReducedMotion()) return;
      scope.add(() => {
        animate(fill, {
          scaleX: [0, ratio],
          duration: 760,
          ease: 'out(3)',
        });
      });
    };

    if (typeof IntersectionObserver === 'undefined') {
      reveal();
      return () => revertMotionScope(scope);
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      reveal();
    }, { threshold: 0.1 });
    observer.observe(trackRef.current);
    return () => {
      observer.disconnect();
      revertMotionScope(scope);
    };
  }, [ratio, valid]);

  if (!valid) return null;

  return (
    <div
      ref={trackRef}
      className={cn('nivaas-progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      aria-valuetext={valueText ?? `${percentage}%`}
    >
      <span ref={fillRef} className="nivaas-progress-fill" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
}
