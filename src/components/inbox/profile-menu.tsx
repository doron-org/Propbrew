'use client';

import { useId, useRef, useTransition } from 'react';
import Link from 'next/link';
import { ChevronRight, LogOut } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { Icon } from '@/components/icon';
import type { Workspace } from '@/config/workspaces';
import { Popover } from './popover';
import { signOut } from '@/server/actions/auth';
import { switchDemoPersona } from '@/server/actions/demo-auth';
import { DEMO_PERSONAS, type DemoPersonaId } from '@/config/demo-personas';

export function ProfileMenu({ name, roleSummary, tenantLabel, workspace, companyAccount, canManageTeam, demoPersonaId }: {
  name: string;
  roleSummary: string;
  tenantLabel: string;
  workspace?: Pick<Workspace, 'id' | 'name' | 'icon'>;
  companyAccount?: boolean;
  canManageTeam?: boolean;
  demoPersonaId?: DemoPersonaId;
}) {
  const [pending, start] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const activePersona = demoPersonaId ? DEMO_PERSONAS.find((persona) => persona.id === demoPersonaId) : undefined;
  const accountPersonas = DEMO_PERSONAS.filter((persona) => Object.keys(persona.modules).length > 1);
  const workspacePersonas = (id: 'estate' | 'facility' | 'shortlet' | 'construction') => DEMO_PERSONAS.filter((persona) =>
    Object.keys(persona.modules).length === 1 && id in persona.modules && Boolean(persona.modules[id]));

  return (
    <Popover
      width={demoPersonaId ? 300 : 260}
      trigger={({ open, toggle }) => (
        <button
          ref={trigger}
          type="button"
          onClick={toggle}
          aria-label={`Account menu — ${name.split(' ')[0]}`}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex items-center gap-2.5 h-[38px] pl-[3px] pr-3 border border-border rounded-[20px] bg-surface hover:bg-surface-2 transition-colors max-[560px]:pr-1.5"
        >
          <Avatar name={name} size={30} />
          <span className="font-medium text-sm max-[560px]:hidden">{name.split(' ')[0]}</span>
        </button>
      )}
    >
      {({ close }) => (
        <div id={panelId} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            trigger.current?.focus();
          }
        }}>
          <div className="flex items-center gap-3 p-3.5 border-b border-border">
            <Avatar name={name} size={40} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold truncate">{name}</div>
              <div className="text-[12px] text-text-3 truncate">{roleSummary}</div>
              <div className="text-[12px] text-text-3 truncate">{tenantLabel}</div>
            </div>
          </div>
          {workspace && (
            <div className="p-1.5 border-b border-border">
              <Link href={`/workspaces?from=${workspace.id}`} onClick={close}
                aria-label={`Switch workspace, current ${workspace.name}`}
                className="flex items-center gap-3 min-h-14 p-3 rounded-lg hover:bg-surface-2 transition-colors">
                <span className="grid place-items-center size-9 shrink-0 rounded-lg bg-primary-weak text-primary" aria-hidden="true">
                  <Icon name={workspace.icon} className="size-[18px]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{workspace.name} workspace</span>
                  <span className="block mt-0.5 text-[12px] text-text-2">Switch workspace</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-text-2" aria-hidden="true" />
              </Link>
            </div>
          )}
          {activePersona && (
            <div className="p-3.5 border-b border-border">
              <label className="grid gap-1.5 text-[12px] font-medium text-text-2">
                Demo user type
                <select
                  aria-label="Switch demo user type"
                  value={activePersona.id}
                  disabled={pending}
                  onChange={(event) => start(() => switchDemoPersona(event.target.value))}
                  className="pb-form-control w-full"
                >
                  <optgroup label="Company-wide">
                    {accountPersonas.map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
                  </optgroup>
                  <optgroup label="Estate user types">
                    {workspacePersonas('estate').map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
                  </optgroup>
                  <optgroup label="Facility user types">
                    {workspacePersonas('facility').map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
                  </optgroup>
                  <optgroup label="Shortlet user types">
                    {workspacePersonas('shortlet').map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
                  </optgroup>
                  <optgroup label="Construction user types">
                    {workspacePersonas('construction').map((persona) => <option key={persona.id} value={persona.id}>{persona.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <p className="mt-2 text-[11.5px] leading-5 text-text-3">{pending ? 'Switching user type…' : activePersona.description}</p>
            </div>
          )}
          <div className="p-1.5">
            {companyAccount && <div className="grid gap-1 border-b border-border pb-2 mb-2">
              <Link className="px-2.5 py-2 rounded-lg text-sm hover:bg-surface-2" href="/companies" onClick={close}>Switch company</Link>
              {canManageTeam && <Link className="px-2.5 py-2 rounded-lg text-sm hover:bg-surface-2" href="/company/team" onClick={close}>Team & access</Link>}
              <Link className="px-2.5 py-2 rounded-lg text-sm hover:bg-surface-2" href="/account/security" onClick={close}>Account security</Link>
            </div>}
            <button
              type="button"
              onClick={() => start(async () => { close(); await signOut(); })}
              disabled={pending}
              className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-sm font-medium text-negative hover:bg-surface-2 transition-colors disabled:opacity-60"
            >
              <LogOut size={16} />
              {pending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
