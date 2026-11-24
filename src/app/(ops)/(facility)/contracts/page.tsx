import { operatingClock } from '@/server/operating-clock';
import { PageHeader } from '@/components/ui/page-header';
import { facilityMoney } from '@/components/facility/facility-format';
import { FacilityKpi } from '@/components/facility/facility-ui';
import { Card, CardHeader, EmptyState, StatusPill } from '@/components/ui';
import layout from '@/components/ui/workspace-layout.module.css';
import facilityStyles from '@/components/facility/facility-workspaces.module.css';
import { requireCapability } from '@/server/guard';
import { repos } from '@/server/data';

import { contractStatus, coverageGap, CATEGORY_LABEL } from '@/domain/facility';
import { toneVar } from '@/lib/status-tones';
import { PageTabs } from '@/components/ui/page-tabs';
import { FileText, CalendarClock, Wallet, Gauge, ShieldAlert } from 'lucide-react';
import { withDurableRead } from '@/server/data/durable-records';
import { allPropertyRows, atProperty, selectedProperty, type PropertyQuery } from '@/server/reads/property-management-scope';


/** Contracts & SLAs — service/AMC contracts with a renewal runway, SLA
 *  target-vs-actual, total commitment, and a coverage-gap radar (which system
 *  categories have no active contract). */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<PropertyQuery> }) {
  return withDurableRead(async () => {
  const { actor } = await requireCapability('assets_ppm', 'read', 'facility');
  const site = selectedProperty(actor, await searchParams);
  const clock = operatingClock();
  const contracts = atProperty(allPropertyRows((cursor) => repos.facilityContracts.list(actor, { cursor, limit: 200 })), site);
  const sites = new Map<string, string>(repos.sites.all(actor).filter((entry) => !site || entry.id === site.id).map((s) => [s.id, s.name]));

  const active = contracts.filter((c) => contractStatus(c, clock.nowMs).daysLeft >= 0);
  const expiring = contracts.filter((c) => { const d = contractStatus(c, clock.nowMs).daysLeft; return d >= 0 && d <= 45; });
  const annualValues = new Map<string, number>();
  for (const contract of contracts) annualValues.set(contract.value.currency, (annualValues.get(contract.value.currency) ?? 0) + contract.value.minor);
  const annualValue = [...annualValues].map(([currency, minor]) => facilityMoney(minor, currency)).join(' · ') || '—';
  const avgSla = contracts.length ? Math.round(contracts.reduce((n, c) => n + c.slaActualPct, 0) / contracts.length) : 0;
  const gaps = coverageGap(contracts, clock.nowMs);
  const sorted = [...contracts].sort((a, b) => contractStatus(a, clock.nowMs).daysLeft - contractStatus(b, clock.nowMs).daysLeft);

  return (
    <div className="pb-page">
      <PageHeader title="Contracts &amp; SLAs" subtitle="Service agreements, renewal dates and coverage gaps." />
      <PageTabs label="Contracts and SLA sections" defaultTab="register" items={[
        { id: 'overview', label: 'Coverage & commitments', content: <div className={layout.layout}>
      <div className={layout.metrics}>
        <Kpi label="Active contracts" value={`${active.length}/${contracts.length}`} tone="success" icon={<FileText size={16} />} />
        <Kpi label="Expiring ≤45d" value={String(expiring.length)} tone={expiring.length ? 'warn' : 'success'} icon={<CalendarClock size={16} />} />
        <Kpi label="Annual value · native currencies" value={annualValue} tone="progress" icon={<Wallet size={16} />} />
        <Kpi label="Avg SLA" value={`${avgSla}%`} tone={avgSla >= 95 ? 'success' : 'warn'} icon={<Gauge size={16} />} />
      </div>

      {/* Coverage gap radar */}
      <Card>
        <CardHeader title="Coverage gaps" subtitle="Categories without an active agreement in the recorded snapshot" action={<ShieldAlert size={20} style={{ color: toneVar(gaps.length ? 'warn' : 'success') }} />} />
        {gaps.length === 0 ? <p className={layout.body}>Every system category has an active contract recorded.</p> : (
          <div className={layout.filters}>
            {gaps.map((g) => <StatusPill key={g} status={CATEGORY_LABEL[g] + ' · No active cover'} tone="warn" />)}
          </div>
        )}
        <p className={layout.footnote}>Contract dates and recorded performance are not independent confirmation of insurance, supplier attendance or statutory compliance.</p>
      </Card>

        </div> },
        { id: 'register', label: 'Contract register & SLAs', count: contracts.length, content: (
      <div className={layout.layout}>
        <p className={layout.metadata}>Recorded snapshot · {new Date(clock.nowMs).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })} · Agreements are ordered by renewal urgency. Native currencies remain separate.</p>
        {sorted.length === 0 && <Card><EmptyState title="No contracts in your scope" description="Recorded service agreements and their renewal dates will appear here." /></Card>}
        {sorted.map((c) => {
          const st = contractStatus(c, clock.nowMs);
          const slaOk = c.slaActualPct >= c.slaTargetPct;
          return (
            <Card key={c.id} className={layout.panel}>
              <CardHeader title={c.service} subtitle={c.vendorName + ' · ' + (sites.get(c.siteId) ?? 'Site not recorded')} action={<StatusPill status={st.label} tone={st.band} />} />
              <dl className={layout.analytics}>
                <div><dt className={layout.metadata}>Annual commitment · {c.value.currency}</dt><dd className={layout.sectionTitle}>{facilityMoney(c.value.minor, c.value.currency)}</dd></div>
                <div><dt className={layout.metadata}>Recorded contract period</dt><dd className={layout.body}>{c.startISO} → {c.endISO}</dd></div>
              </dl>
              <div className={layout.analytics + ' mt-6 pt-6 border-t border-border'}>
                <div className={layout.stack}>
                  <div className={layout.toolbar}><span className={layout.title}>Renewal runway</span><span className={layout.body} style={{ color: toneVar(st.band) }}>{st.daysLeft < 0 ? `${-st.daysLeft} days overdue` : `${st.daysLeft} days remaining`}</span></div>
                  <progress max={365} value={Math.max(0, Math.min(365, st.daysLeft))} className={facilityStyles.progress} style={{ color: toneVar(st.band) }} aria-label={c.service + ' renewal runway, capped at one year'} />
                  <p className={layout.metadata}>{st.daysLeft < 0 ? 'The recorded agreement has expired. Verify renewal with the supplier.' : 'Review renewal before the recorded end date.'}</p>
                </div>
                <div className={layout.stack}>
                  <div className={layout.toolbar}><span className={layout.title}>Recorded SLA performance</span><StatusPill status={c.slaActualPct + '% · target ' + c.slaTargetPct + '%'} tone={slaOk ? 'success' : 'danger'} /></div>
                  <progress max={100} value={Math.max(0, Math.min(100, c.slaActualPct))} className={facilityStyles.progress} style={{ color: toneVar(slaOk ? 'success' : 'danger') }} aria-label={c.service + ' recorded SLA actual, target ' + c.slaTargetPct + '%'} />
                  <p className={layout.metadata}>{slaOk ? 'Recorded performance meets target' : `${c.slaTargetPct - c.slaActualPct} percentage points below target`}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
        ) },
      ]} />
    </div>
  );
  });
}

const Kpi = FacilityKpi;
