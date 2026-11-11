import { AlertCircle, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { INFO_NOTICE_CODES } from '@/sense/sources/presage';

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn'; children: ReactNode; className?: string }) {
  const Icon = tone === 'warn' ? AlertCircle : Info;
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-xl px-4 py-3 text-sm leading-relaxed',
        tone === 'info' ? 'bg-white/5 text-muted-foreground' : 'bg-amber-500/10 text-amber-100',
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Session-level problems: errors, the cardio fallback notice, and auto-pause messages. */
export function SessionNotices({ error, stopReason }: { error: { code: string; message: string } | null; stopReason: string | null }) {
  return (
    <>
      {error && (
        <Notice tone={INFO_NOTICE_CODES.has(error.code) ? 'info' : 'warn'}>{error.message}</Notice>
      )}
      {stopReason && <Notice>{stopReason}</Notice>}
    </>
  );
}
