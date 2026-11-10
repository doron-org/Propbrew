'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { Popover } from './popover';
import { markNotificationsRead } from '@/server/actions/inbox';
import type { Notification } from '@/server/data/inbox';

const DOT: Record<string, string> = {
  info: 'var(--tone-info)',
  success: 'var(--tone-success)',
  warn: 'var(--tone-warn)',
  danger: 'var(--tone-danger)',
};

export function NotificationsMenu({ notifications, unread, readOnly = false }: { notifications: Notification[]; unread: number; readOnly?: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();

  const markRead = () => { if (!readOnly) start(async () => { await markNotificationsRead(); router.refresh(); }); };

  return (
    <Popover
      width={380}
      trigger={({ toggle, open }) => (
        <IconButton
          title="Notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          onClick={() => { if (!open && unread > 0) markRead(); toggle(); }}
        >
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-lg bg-[#b91c1c] text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface">
              {unread}
            </span>
          )}
        </IconButton>
      )}
    >
      {({ close }) => (
        <div>
          <div className="flex items-center justify-between px-4 h-12 border-b border-border">
            <span className="text-[13.5px] font-semibold">Notifications</span>
            {!readOnly && <button onClick={markRead} className="text-[12px] text-primary hover:underline flex items-center gap-1">
              <Check size={13} /> Mark all read
            </button>}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {notifications.length === 0 && <div className="p-6 text-center text-[13px] text-text-3">You’re all caught up.</div>}
            {notifications.map((n) => {
              const Row = (
                <div className={`flex gap-3 px-4 py-3 border-b border-border last:border-0 ${n.read ? '' : 'bg-primary-weak/40'} hover:bg-surface-2 transition-colors`}>
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-none" style={{ background: n.read ? 'var(--border-2)' : DOT[n.kind] }} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-snug">{n.title}</div>
                    <div className="text-[12px] text-text-3 mt-0.5 leading-snug">{n.body}</div>
                    <div className="text-[12px] text-text-3 mt-1">{when(n.at)}</div>
                  </div>
                </div>
              );
              return n.href ? (
                <Link key={n.id} href={n.href} onClick={close} className="block">{Row}</Link>
              ) : (
                <div key={n.id}>{Row}</div>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}

function when(iso: string): string {
  const mins = Math.round((Date.parse('2026-07-26T09:00:00Z') - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
