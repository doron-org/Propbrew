'use client';

/**
 * Env-gated identity switcher. The single most useful scaffold in the plan:
 * without it, eight of nine roles are unreviewable until real auth exists, and
 * the client cannot sign off on the §7 surfaces during Phase-1 discovery.
 *
 * Rendered ONLY when NEXT_PUBLIC_DEV_IDENTITY=1 (the server never mounts it
 * otherwise), and every switch goes through a server action that itself refuses
 * to run in production.
 */

import { useTransition } from 'react';
import { DEV_IDENTITIES } from '@/server/identities';
import { switchIdentity } from '@/server/actions/dev-identity';

export function RoleSwitcher({ currentKey }: { currentKey: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="block mb-2">
      <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-text-2 mb-1 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-[tms-pulse_2s_ease-in-out_infinite]" />
        Dev · viewing as
      </span>
      <select
        aria-label="Switch acting identity"
        defaultValue={currentKey}
        disabled={pending}
        onChange={(e) => startTransition(() => switchIdentity(e.target.value))}
        className="w-full h-8 px-2 rounded-lg border border-border-2 bg-surface-2 text-[12px] font-medium cursor-pointer outline-none focus:border-primary transition-colors disabled:opacity-50"
      >
        {DEV_IDENTITIES.map((i) => (
          <option key={i.key} value={i.key}>
            {i.roleSummary} — {i.label.split(' — ')[0]}
          </option>
        ))}
      </select>
    </label>
  );
}
