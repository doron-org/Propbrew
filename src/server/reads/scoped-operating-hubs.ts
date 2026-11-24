import 'server-only';
import { repos } from '@/server/data';
import type { Actor } from '@/lib/authz';
import type { ScopedHubMetric, ScopedHubRow, ScopedHubSection } from '@/components/workspaces/scoped-operating-hub';

const ngnCompact = (minor: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100);
const scoped = (href: string, key: string, value: string, returnTo: string) => `${href}?${new URLSearchParams({ [key]: value, returnTo }).toString()}`;

export function readConstructionProjectHub(actor: Actor, projectId: string) {
  const project = repos.constructionProjects.list(actor, { limit: 100 }).items.find((item) => String(item.id) === projectId);
  if (!project) return null;
  const hub = `/construction/projects/${encodeURIComponent(projectId)}`;
  const link = (href: string) => scoped(href, 'projectId', projectId, hub);
  const tasks = repos.constructionTasks.list(actor, { limit: 500 }).items.filter((item) => item.projectId === projectId);
  const issues = repos.constructionIssues.list(actor, { limit: 200 }).items.filter((item) => item.projectId === projectId && item.status !== 'resolved');
  const workers = repos.constructionWorkers.list(actor, { limit: 300 }).items.filter((item) => item.projectId === projectId);
  const openTasks = tasks.filter((item) => item.status !== 'done');
  const variance = project.percentComplete - project.plannedPercent;
  const metrics: ScopedHubMetric[] = [
    { label: 'Physical progress', value: `${project.percentComplete}%`, hint: `${project.plannedPercent}% baseline`, tone: variance >= 0 ? 'good' : variance >= -5 ? 'warn' : 'risk' },
    { label: 'Approved budget', value: ngnCompact(project.approvedBudget.minor), hint: `Contract ${ngnCompact(project.contractValue.minor)}` },
    { label: 'Open work fronts', value: String(openTasks.length), hint: `${tasks.length} tasks recorded`, tone: openTasks.some((item) => item.status === 'blocked') ? 'risk' : undefined },
    { label: 'Site workforce', value: String(workers.length), hint: 'Assigned workers and subcontractors' },
  ];
  const sections: ScopedHubSection[] = [
    { id: 'planning-controls', label: 'Planning & controls', description: 'Programme, earned value, risk, delay forecasting and evidence-based scenarios.', href: `${hub}/planning-controls`, tools: [
      { label: 'Project setup & mobilisation', description: 'WBS, programme, baselines, team, BOQ, locations and lifecycle.', href: `${hub}/setup?section=programme` }, { label: 'Scheduling & critical path', description: 'Editable tasks, dependencies, milestones and forecast finish.', href: link('/construction/schedule') }, { label: 'Earned value', description: 'CPI, SPI, EAC and cost-to-complete.', href: link('/construction/evm') }, { label: 'Risk radar', description: 'Explainable signals with evidence.', href: link('/construction/risk') }, { label: 'Scenario simulator', description: 'Test recovery options before approval.', href: link('/construction/simulator') },
    ] },
    { id: 'commercial-procurement', label: 'Commercial & procurement', description: 'BOQ, commitments, variations, claims, FX and procurement-to-payment control.', href: `${hub}/commercial-procurement`, tools: [
      { label: 'Procurement', description: 'Request, RFQ, award, PO and delivery.', href: link('/construction/procurement') }, { label: 'Materials', description: 'Stock, issues and leakage evidence.', href: link('/construction/materials') }, { label: 'Budget tracking & BOQ', description: 'Cost codes, approved budget and valuation structure.', href: link('/construction/boq') }, { label: 'Change orders & approvals', description: 'Variations, cost and schedule impact, human approval.', href: link('/construction/approvals') }, { label: 'FX exposure', description: 'Naira restatement of foreign commitments.', href: link('/construction/fx') },
    ] },
    { id: 'site-delivery', label: 'Site delivery', description: 'Offline-ready daily evidence, labour, safety, quality and material execution.', href: `${hub}/site-delivery`, tools: [
      { label: 'Daily site log', description: 'Weather, work fronts, constraints and approvals.', href: link('/construction/site') }, { label: 'Mobile field capture', description: 'Queue evidence when the network fails.', href: link('/construction/field') }, { label: 'Punch list & authority inspections', description: 'Defects, inspections, ownership and closeout evidence.', href: link('/construction/quality') }, { label: 'Workforce & timesheets', description: 'Crews, attendance and posted labour cost.', href: link('/construction/workforce') }, { label: 'Safety & permits', description: 'Incidents, permits and toolbox talks.', href: link('/construction/safety') }, { label: 'Build watch', description: 'Photo evidence and site exceptions.', href: link('/construction/build-watch') },
    ] },
    { id: 'intelligence', label: 'Collaboration & intelligence', description: 'Controlled documents, RFIs, subcontractor performance and grounded AI.', href: `${hub}/intelligence`, tools: [
      { label: 'Drawing versions & RFIs', description: 'Approved revisions, transmittals and technical queries.', href: link('/construction/documents') }, { label: 'Design clash register', description: 'Record conflicting drawings or models and track resolution.', href: link('/construction/quality') }, { label: 'Site twin', description: 'Zone progress and issue overlays.', href: link('/construction/twin') }, { label: 'Subcontractor performance', description: 'Delivery, quality and compliance scorecards.', href: link('/construction/league') }, { label: 'Ask construction Copilot', description: 'Cited answers from authorised project records.', href: link('/construction/copilot') },
    ] },
  ];
  const rows: ScopedHubRow[] = [
    ...issues.slice(0, 4).map((issue) => ({ primary: issue.title, secondary: `${issue.category} · owner ${issue.owner}`, value: issue.dueISO, status: issue.severity, tone: issue.severity === 'critical' || issue.severity === 'high' ? 'risk' as const : 'warn' as const })),
    ...openTasks.filter((task) => task.status === 'blocked').slice(0, 3).map((task) => ({ primary: task.name, secondary: `Blocked work front · ${task.owner}`, value: task.plannedFinishISO, status: 'blocked', tone: 'risk' as const })),
  ];
  return { project, metrics, sections, rows };
}

export function readFacilitySiteHub(actor: Actor, siteId: string) {
  // Facility teams may operate assets at an estate property as well as at a
  // standalone facility site. The route still requires the Facility grant.
  const site = repos.sites.all(actor).find((item) => String(item.id) === siteId && (item.kind === 'facility' || item.kind === 'estate'));
  if (!site) return null;
  const hub = `/facility/sites/${encodeURIComponent(siteId)}`;
  const link = (href: string) => scoped(href, 'siteId', siteId, hub);
  const assets = repos.assets.list(actor, { limit: 500 }).items.filter((item) => String(item.siteId) === siteId);
  const workOrders = repos.workOrders.list(actor, { limit: 500 }).items.filter((item) => String(item.siteId) === siteId);
  const open = workOrders.filter((item) => item.status !== 'resolved' && item.status !== 'closed');
  const metrics: ScopedHubMetric[] = [
    { label: 'Buildings', value: String(site.buildingCount), hint: `${site.unitCount} managed spaces` },
    { label: 'Assets', value: String(assets.length), hint: 'In the authorised register' },
    { label: 'Open work orders', value: String(open.length), hint: `${workOrders.length} total records`, tone: open.some((item) => item.priority === 'emergency') ? 'risk' : undefined },
    { label: 'Asset availability', value: `${assets.length ? Math.round(assets.filter((item) => item.status === 'operational').length / assets.length * 100) : 0}%`, hint: 'Recorded operational status', tone: 'good' },
  ];
  const sections: ScopedHubSection[] = [
    { id: 'operations', label: 'Operations', description: 'Requests, dispatch, mobile execution and vendor coordination.', href: `${hub}/operations`, tools: [{ label: 'Work orders', description: 'Priorities, assignments, SLA and closure.', href: link('/property-management/work-orders') }, { label: 'Mobile jobs', description: 'Technician execution and field evidence.', href: link('/field') }, { label: 'Vendors', description: 'Onboarding, compliance and performance.', href: link('/vendors') }] },
    { id: 'asset-care', label: 'Asset care', description: 'Asset lifecycle, planned maintenance, compliance and spares.', href: `${hub}/asset-care`, tools: [{ label: 'Asset register', description: 'Criticality, condition and service history.', href: link('/assets') }, { label: 'Maintenance plans', description: 'Preventive schedules and service triggers.', href: link('/ppm') }, { label: 'Inspections', description: 'Compliance evidence and follow-up.', href: link('/inspections') }, { label: 'Inventory', description: 'Parts, stock levels and movements.', href: link('/inventory') }] },
    { id: 'building-services', label: 'Building services', description: 'Utilities, access, safety, spaces and supplier SLAs.', href: `${hub}/building-services`, tools: [{ label: 'Energy & utilities', description: 'Grid, generators, diesel and water.', href: link('/energy') }, { label: 'Safety & permits', description: 'Permits and incidents.', href: link('/safety') }, { label: 'Access & visitors', description: 'Gates, passes and access events.', href: link('/access') }, { label: 'Contracts & SLAs', description: 'Renewals and service obligations.', href: link('/contracts') }] },
    { id: 'intelligence', label: 'Intelligence', description: 'Live operating signals and grounded property AI.', href: `${hub}/intelligence`, tools: [{ label: 'Control centre', description: 'Operational overview and exceptions.', href: link('/control-center') }, { label: 'Property performance', description: 'Maintenance and authorised commercial metrics.', href: link('/property-management/reports') }, { label: 'Ask Property Copilot', description: 'Evidence-backed answers for this site.', href: link('/property-management/copilot') }, { label: 'Building priority actions', description: 'Review operational signals before any recorded action.', href: link('/copilot') }] },
  ];
  const rows: ScopedHubRow[] = open.slice(0, 6).map((order) => ({ primary: order.title, secondary: `${order.ref} · ${order.priority} priority`, value: order.status.replaceAll('_', ' '), status: order.priority, tone: order.priority === 'emergency' || order.priority === 'high' ? 'risk' : 'warn' }));
  return { site, metrics, sections, rows };
}

export function readShortletPropertyHub(actor: Actor, propertyId: string) {
  const property = repos.shortletProperties.list(actor, { limit: 100 }).items.find((item) => String(item.id) === propertyId);
  if (!property) return null;
  const hub = `/shortlet/properties/${encodeURIComponent(propertyId)}`;
  const link = (href: string) => scoped(href, 'propertyId', propertyId, hub);
  const apartments = repos.shortletApartments.list(actor, { limit: 200 }).items.filter((item) => item.propertyId === propertyId);
  const bookings = repos.shortletBookings.list(actor, { limit: 500 }).items.filter((item) => item.propertyId === propertyId);
  const active = bookings.filter((item) => item.status === 'checked_in' || item.status === 'confirmed');
  const receivableMinor = bookings.reduce((sum, booking) => sum + Math.max(0, booking.total.minor - booking.paid.minor), 0);
  const metrics: ScopedHubMetric[] = [
    { label: 'Units', value: String(apartments.length), hint: `${apartments.filter((item) => item.status === 'active').length} active listings` },
    { label: 'Live & upcoming stays', value: String(active.length), hint: 'Checked-in and confirmed bookings' },
    { label: 'Receivables', value: ngnCompact(receivableMinor), hint: 'Recorded unpaid booking value', tone: receivableMinor > 0 ? 'warn' : 'good' },
    { label: 'Channel coverage', value: String(new Set(apartments.flatMap((item) => item.channels)).size), hint: 'Connected channel types' },
  ];
  const sections: ScopedHubSection[] = [
    { id: 'reservations', label: 'Reservations', description: 'Availability, direct booking and channel-safe reservation lifecycle.', href: `${hub}/reservations`, tools: [{ label: 'Bookings', description: 'Enquiry to checkout lifecycle.', href: link('/shortlet/bookings') }, { label: 'Availability calendar', description: 'Unit availability and collision controls.', href: link('/shortlet/calendar') }, { label: 'Direct booking page', description: 'Property-specific direct conversion.', href: link('/shortlet/booking-page') }] },
    { id: 'guest-operations', label: 'Guest operations', description: 'Verification, arrival, turnover, damages and WhatsApp service.', href: `${hub}/guest-operations`, tools: [{ label: 'Guests & verification', description: 'Identity, preferences and stay history.', href: link('/shortlet/guests') }, { label: 'Check-in & turnover', description: 'Arrival, departure and housekeeping handoff.', href: link('/shortlet/operations') }, { label: 'Inspections & damages', description: 'Evidence, deposit deductions and approval.', href: link('/shortlet/inspections') }, { label: 'Guest messaging', description: 'Templates, reminders and WhatsApp conversations.', href: link('/shortlet/whatsapp') }] },
    { id: 'revenue-growth', label: 'Revenue & growth', description: 'NGN pricing, reconciliation, channels and occupancy forecasting.', href: `${hub}/revenue-growth`, tools: [{ label: 'Pricing', description: 'Rates, rules and AI recommendations.', href: link('/shortlet/pricing') }, { label: 'Expenses & reconciliation', description: 'Property spend and settlement matching.', href: link('/shortlet/expenses') }, { label: 'Channels', description: 'Airbnb and Booking.com sync foundation.', href: link('/shortlet/channels') }, { label: 'Analytics', description: 'Revenue, occupancy and forecast.', href: link('/shortlet/analytics') }] },
    { id: 'intelligence', label: 'Team & intelligence', description: 'Property roles, approvals and AI-assisted operations.', href: `${hub}/intelligence`, tools: [{ label: 'Team & approvals', description: 'Property-scoped staff roles.', href: link('/shortlet/team') }, { label: 'Agents', description: 'Agent attribution and commission.', href: link('/shortlet/agents') }, { label: 'Ask shortlet Copilot', description: 'Grounded answers and message drafts.', href: link('/shortlet/copilot') }] },
  ];
  const rows: ScopedHubRow[] = active.slice(0, 6).map((booking) => ({ primary: booking.guestName, secondary: `${booking.ref} · ${booking.source.replaceAll('_', ' ')}`, value: `${booking.checkIn} → ${booking.checkOut}`, status: booking.status.replaceAll('_', ' '), tone: booking.status === 'checked_in' ? 'good' : undefined }));
  return { property, metrics, sections, rows };
}
