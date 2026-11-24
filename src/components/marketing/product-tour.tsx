'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Bell, Building2, Check, ChevronDown, CircleHelp, ClipboardList, HardHat, LayoutDashboard, Search, Sparkles, Users, Wallet, Wrench } from 'lucide-react';
import { PropbrewMark } from '@/components/brand/propbrew-logo';
import { constructionArchived } from '@/config/module-archive';

const ALL_WORKSPACES = [
  {
    name: 'Operate', icon: Wrench, title: 'A good day starts with a clear picture.', subtitle: 'Facility control center', href: '/control-center',
    metrics: [{ label: 'Assets tracked', value: '240', detail: 'Across the portfolio' }, { label: 'Open work orders', value: '18', detail: 'Every job has an owner' }, { label: 'PPM compliance', value: '78%', detail: 'Planned maintenance' }],
    heading: 'Needs your attention', rows: [
      { name: 'Generator 2 service', detail: 'Lekki Gardens / Plant room', status: 'Overdue', tone: 'warn' },
      { name: 'Lift A quarterly inspection', detail: 'Victoria Court / Due Friday', status: 'Scheduled', tone: 'info' },
      { name: 'Borehole pump vibration', detail: 'Technician report / Under review', status: 'In review', tone: 'success' },
    ], insight: 'Generator 2 needs a service. Review the asset history and assign the next work order.', insightHref: '/work-orders', insightLabel: 'Review work orders',
  },
  {
    name: 'Build', icon: HardHat, title: 'Keep the site and the numbers together.', subtitle: 'Construction command center', href: '/construction',
    metrics: [{ label: 'Active projects', value: '2', detail: 'One connected programme' }, { label: 'Open PO value', value: '₦843.6m', detail: 'Procurement commitments' }, { label: 'Critical signals', value: '6', detail: 'Evidence behind each signal' }],
    heading: 'Delivery radar', rows: [
      { name: 'Y16 reinforcement bar', detail: 'PO-3012 / 0 of 40 tonnes received', status: 'Delayed', tone: 'warn' },
      { name: 'Cement 42.5R', detail: 'PO-3008 / 800 of 1,200 bags', status: 'Partial', tone: 'info' },
      { name: 'Passenger lifts', detail: 'PO-3021 / Foreign commitment', status: 'Track FX', tone: 'success' },
    ], insight: 'The steel delivery is delayed. Check the critical path before adjusting the programme.', insightHref: '/construction/schedule', insightLabel: 'Review the schedule',
  },
  {
    name: 'Serve', icon: Users, title: 'Happier communities. Clearer collections.', subtitle: 'Estate collections', href: '/collections',
    metrics: [{ label: 'Collected', value: '₦58.4m', detail: 'Service charges' }, { label: 'Residents', value: '312', detail: 'A connected community' }, { label: 'Open requests', value: '7', detail: 'Progress residents can follow' }],
    heading: 'Community at a glance', rows: [
      { name: 'Q3 service charges', detail: '284 of 312 units settled', status: 'On track', tone: 'success' },
      { name: 'Arrears over 60 days', detail: '9 units / ₦2.1m outstanding', status: 'Follow up', tone: 'warn' },
      { name: 'Payment plans', detail: 'Agreed with 5 residents', status: 'Active', tone: 'info' },
    ], insight: 'Nine units need a collections follow-up. Review balances before preparing a reminder.', insightHref: '/collections', insightLabel: 'Review collections',
  },
] as const;
const WORKSPACES = ALL_WORKSPACES.filter((workspace) => !constructionArchived() || workspace.name !== 'Build');

export function ProductTour({ websiteOnly = false }: { websiteOnly?: boolean }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const workspace = WORKSPACES[active];

  function changeTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACES.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + WORKSPACES.length) % WORKSPACES.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className="pb-tour">
      <div className="pb-tour-controls">
        <div className="pb-tour-tabs" role="tablist" aria-label="Explore Propbrew workspaces">
          {WORKSPACES.map((item, index) => (
            <button key={item.name} id={`tour-tab-${index}`} type="button" role="tab" aria-selected={active === index} aria-controls="tour-panel" tabIndex={active === index ? 0 : -1} ref={(node) => { buttons.current[index] = node; }} onKeyDown={(event) => changeTab(event, index)} onClick={() => setActive(index)} className={active === index ? 'is-active' : ''}>
              <item.icon size={17} aria-hidden="true" />{item.name}
            </button>
          ))}
        </div>
        <span className="pb-tour-disclosure">Interactive preview / Sample data</span>
      </div>
      <div className="pb-product-window" id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${active}`} tabIndex={0}>
        <aside className="pb-product-sidebar" aria-label="Preview navigation">
          <div className="pb-product-brand"><PropbrewMark className="pb-preview-mark" /><span>propbrew</span></div>
          <div className="pb-product-company"><span className="pb-estate-avatar">LG</span><div>Sample portfolio<small>Lagos, Nigeria</small></div><ChevronDown size={13} aria-hidden="true" /></div>
          <div className="pb-preview-nav"><span className="is-active"><LayoutDashboard size={16} aria-hidden="true" />Overview</span><span><Building2 size={16} aria-hidden="true" />Properties</span><span><ClipboardList size={16} aria-hidden="true" />Work orders</span><span><Wallet size={16} aria-hidden="true" />Collections</span><span><Users size={16} aria-hidden="true" />Community</span></div>
          <div className="pb-sidebar-bottom"><Sparkles size={17} aria-hidden="true" />Intelligence, in context.</div>
        </aside>
        <div className="pb-product-main">
          <div className="pb-product-topbar"><span>{workspace.subtitle}</span><div><Search size={16} aria-hidden="true" /><CircleHelp size={16} aria-hidden="true" /><Bell size={16} aria-hidden="true" /><span className="pb-profile-avatar">AO</span></div></div>
          <div className="pb-product-content" key={workspace.name}>
            <div className="pb-product-greeting"><div><p>Your portfolio, in focus</p><h3>{workspace.title}</h3></div><span className="pb-preview-date">Lagos workspace</span></div>
            <div className="pb-preview-metrics">{workspace.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}</div>
            <div className="pb-preview-columns">
              <div className="pb-preview-table"><h4>{workspace.heading}<span>3 items</span></h4>{workspace.rows.map((row) => <div className="pb-preview-row" key={row.name}><span className="pb-row-check"><Check size={12} aria-hidden="true" /></span><div><strong>{row.name}</strong><small>{row.detail}</small></div><span className={`pb-status pb-status-${row.tone}`}>{row.status}</span></div>)}</div>
              <div className="pb-preview-insight"><div><Sparkles size={17} aria-hidden="true" /><span>Propbrew Intelligence</span></div><h4>A useful next step.</h4><p>{workspace.insight}</p><span className="pb-evidence-label"><Check size={12} aria-hidden="true" />Grounded in sample records</span><Link href={websiteOnly ? '/#platform' : workspace.insightHref}>{websiteOnly ? 'Explore the preview' : workspace.insightLabel}<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
            </div>
          </div>
        </div>
      </div>
      <div className="pb-tour-bottom"><p>Different perspectives. The same connected property.</p><Link href={websiteOnly ? '/#platform' : workspace.href}>{websiteOnly ? 'Explore the preview' : `Open ${workspace.name.toLowerCase()} workspace`}<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    </div>
  );
}
