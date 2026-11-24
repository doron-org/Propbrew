import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ClipboardCheck, CloudOff, FileCheck2, Globe2, HardHat, LockKeyhole, MessageCircle, ShieldCheck, Sparkles, Users, Wallet, Wrench } from 'lucide-react';
import { Hero } from '@/components/marketing/hero';
import { ProductTour } from '@/components/marketing/product-tour';
import { PropbrewMark } from '@/components/brand/propbrew-logo';
import { SITE_URL } from '@/config/site';
import { websiteOnlyEnabled } from '@/lib/website-release';
import { constructionArchived } from '@/config/module-archive';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Propbrew | Great places. Better run.',
  description: 'Connect estate management, facility operations and your community in one intelligent property workspace. Built for Nigeria and a brighter property future.',
  openGraph: {
    type: 'website',
    siteName: 'Propbrew',
    locale: 'en_NG',
    title: 'Propbrew | Great places. Better run.',
    description: 'Your buildings, teams and communities. One connected workspace for a brighter property future.',
    images: [{ url: '/brand/propbrew-social.png', width: 1200, height: 630, alt: 'Propbrew — Great places. Better run.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Propbrew | Great places. Better run.',
    description: 'Your buildings, teams and communities. One connected workspace for a brighter property future.',
    images: [{ url: '/brand/propbrew-social.png', alt: 'Propbrew — Great places. Better run.' }],
  },
};

const FAQ = [
  { question: 'What is Propbrew?', answer: 'Propbrew connects facility and estate management, resident services, short-let and portfolio reporting. Teams can follow the work, the people and the money without piecing together separate tools.' },
  { question: 'Can I explore it before committing?', answer: 'Yes. Explore the demo to see the product using a sample portfolio. Figures and properties in the tour are illustrative. Production onboarding includes infrastructure setup, provider configuration and user acceptance testing.', previewAnswer: 'Yes. Explore the interactive sample preview on this page and switch between Operate and Serve. Its properties, figures and AI examples are illustrative. The operational platform is activated separately after infrastructure setup, provider configuration and user acceptance testing.' },
  { question: 'Is it built for Nigerian property teams?', answer: 'Yes. Propbrew includes naira-based records, generator and water asset workflows, field capture for intermittent connectivity, and communication workflows suited to estate teams. Payments and messaging providers are configured during deployment.' },
  { question: 'What can the AI help with?', answer: 'The copilot helps teams understand their records, review operational risks and prepare the next action. Sensitive actions and outbound AI-generated communications require human approval.' },
  { question: 'Does every team need every module?', answer: 'No. Start with the operations you need, then add short-let or portfolio views as your business grows. Role and estate scopes determine what each person can see and do.' },
  { question: 'What happens when the connection drops?', answer: 'Supported field-capture workflows save updates on the device and queue them for syncing when connectivity returns. Media and conflicts have their own sync states so teams can see what still needs attention.' },
];

export default function LandingPage() {
  const websiteOnly = websiteOnlyEnabled(process.env.PROPBREW_WEBSITE_ONLY, process.env.NODE_ENV);
  const productHref = (href: string) => websiteOnly ? '/#platform' : href;
  const demoLabel = websiteOnly ? 'Explore the preview' : 'Explore the demo';

  return (
    <>
      <Hero websiteOnly={websiteOnly} />
      <section id="platform" className="pb-platform pb-section">
        <div className="pb-content-container">
          <div className="pb-section-heading"><h2>Everything connects.<br /><span>Everyone moves forward.</span></h2><p>Less chasing updates. More making progress. Give every team a clear view of the property, and a clear next step.</p></div>
          <ProductTour websiteOnly={websiteOnly} />
        </div>
      </section>

      <section id="modules" className="pb-outcomes pb-section">
        <div className="pb-content-container">
          <div className="pb-outcomes-heading"><h2>A better everyday.<br />For everyone involved.</h2><p>From the first site visit to the people who call it home.</p></div>
          <div className="pb-outcome-grid">
            <article className="pb-outcome pb-outcome-operations">
              <div className="pb-outcome-icon"><Wrench size={21} aria-hidden="true" /></div>
              <h3>Stay ahead of<br />the next repair.</h3><p>Assets, maintenance and work orders connected. Your team knows what needs attention, who owns it and what happens next.</p>
              <div className="pb-maintenance-demo" aria-label="Illustrative work order workflow"><div><span className="pb-maintenance-icon"><Wrench size={18} aria-hidden="true" /></span><div><strong>Generator service</strong><small>Plant room / Planned maintenance</small></div><span className="pb-status pb-status-info">Assigned</span></div><ol><li><Check size={13} aria-hidden="true" />Issue logged</li><li><Check size={13} aria-hidden="true" />Team assigned</li><li><ClipboardCheck size={13} aria-hidden="true" />Evidence & review</li></ol></div>
              <Link className="pb-card-link" href={productHref('/work-orders')}>Explore facility operations<ArrowUpRight size={17} aria-hidden="true" /></Link>
            </article>
            <article className="pb-outcome pb-outcome-finance">
              <div className="pb-outcome-icon"><Wallet size={21} aria-hidden="true" /></div><h3>Know where<br />the money stands.</h3><p>Service charges, arrears and payment records in one view. Move from chasing balances to understanding collections.</p>
              <div className="pb-finance-demo"><span>Sample collection overview</span><strong>₦58.4<span>m</span></strong><div className="pb-finance-bars" aria-hidden="true">{[36, 46, 41, 68, 58, 77, 73, 88, 82, 96, 87, 100].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="pb-finance-axis"><span>Service charges</span><span>Clearer decisions</span></div></div>
              <Link className="pb-card-link" href={productHref('/collections')}>Explore collections<ArrowUpRight size={17} aria-hidden="true" /></Link>
            </article>
            <article className="pb-outcome pb-outcome-community"><div className="pb-outcome-icon"><Users size={21} aria-hidden="true" /></div><h3>A place to live.<br />A community to belong to.</h3><p>Requests, announcements, bookings and visitor passes. Residents can see progress. Managers can keep the conversation moving.</p><div className="pb-community-demo"><span className="pb-community-avatar">T</span><div><strong>Your maintenance request</strong><p>Your technician has been assigned.<br />You can follow the progress in your portal.</p><span><CheckCheck size={14} aria-hidden="true" />A clearer update. A better day.</span></div></div><Link className="pb-card-link" href={productHref('/portal')}>Explore the resident portal<ArrowUpRight size={17} aria-hidden="true" /></Link></article>
            {!constructionArchived() && <article className="pb-outcome pb-outcome-build"><div className="pb-outcome-icon"><HardHat size={21} aria-hidden="true" /></div><h3>Build with<br />the bigger picture.</h3><p>Bring schedules, procurement, site evidence and cost exposure together. Keep every milestone connected to the decisions behind it.</p><div className="pb-build-demo"><span>From programme to handover</span><div><i /><i /><i /><i /></div><p><span>Plan</span><span>Procure</span><span>Build</span><span>Deliver</span></p></div><Link className="pb-card-link" href={productHref('/construction')}>Explore construction<ArrowUpRight size={17} aria-hidden="true" /></Link></article>}
          </div>
          <div className="pb-expansion"><span>And room for what comes next.</span><Link href={productHref('/shortlet')}>Short-let operations<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href={productHref('/portfolio')}>Portfolio intelligence<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href={productHref('/investors')}>Investor reporting<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        </div>
      </section>

      <section id="intelligence" className="pb-intelligence pb-section">
        <div className="pb-content-container pb-ai-grid">
          <div className="pb-ai-copy"><span className="pb-ai-label"><Sparkles size={16} aria-hidden="true" />PROPBREW INTELLIGENCE</span><h2>See the signal.<br /><span>Make your next move.</span></h2><p>Ask better questions of your property. Get assistance grounded in your records, with evidence you can review and decisions that stay in your hands.</p><ul><li><FileCheck2 size={19} aria-hidden="true" /><span>Answers with a source</span></li><li><ShieldCheck size={19} aria-hidden="true" /><span>Human review before sensitive actions</span></li><li><LockKeyhole size={19} aria-hidden="true" /><span>Your workspace. Your data scope.</span></li></ul><Link className="pb-button pb-button-lime" href={productHref('/copilot')}>Meet your copilot<ArrowUpRight size={18} aria-hidden="true" /></Link></div>
          <div className="pb-ai-conversation" aria-label="Illustrative copilot conversation"><div className="pb-ai-window-title"><PropbrewMark className="pb-ai-mark" /><span>Intelligence that knows the context.</span><Sparkles size={18} aria-hidden="true" /></div><div className="pb-ai-question">What needs my attention at Lekki Gardens?</div><div className="pb-ai-answer"><span className="pb-ai-response-label"><Sparkles size={15} aria-hidden="true" />Propbrew Intelligence</span><p>Start with the generator service. It is overdue, and the asset history should be reviewed before assigning the job.</p><div className="pb-ai-source"><FileCheck2 size={17} aria-hidden="true" /><div><strong>Generator 2 / Maintenance record</strong><small>Sample source record</small></div><ArrowUpRight size={15} aria-hidden="true" /></div><p className="pb-ai-action-copy">Suggested next step</p><Link href={productHref('/work-orders')} className="pb-ai-suggested">Review the work order<ArrowRight size={16} aria-hidden="true" /></Link><span className="pb-ai-human"><Check size={13} aria-hidden="true" />You review. You decide.</span></div><div className="pb-ai-disclosure">{websiteOnly ? 'Illustrative conversation. AI assistance is activated with your operational workspace.' : 'Illustrative conversation. Explore the copilot to use workspace records.'}</div></div>
        </div>
      </section>

      <section id="why" className="pb-local pb-section">
        <div className="pb-content-container"><div className="pb-local-heading"><p className="pb-eyebrow">BUILT FOR THE WAY WE WORK</p><h2>Rooted in Nigeria.<br /><span>Looking forward.</span></h2><p>Real property needs more than a beautiful dashboard. It needs to fit the realities of the place, the people and the work.</p></div><div className="pb-local-grid"><figure className="pb-local-image"><Image src="/brand/neighborhood.webp" alt="Illustrative contemporary tropical apartments with planted terraces and shared gardens" fill sizes="(max-width: 760px) 100vw, 50vw" /><figcaption>An optimistic vision of places that work better.</figcaption></figure><div className="pb-local-points"><div><span className="pb-local-icon">₦</span><div><h3>Think in naira. See the whole picture.</h3><p>Local collections and foreign commitments, with exchange-rate exposure visible where it matters.</p></div></div><div><CloudOff size={23} aria-hidden="true" /><div><h3>The work continues when the signal stops.</h3><p>Supported field workflows queue updates and evidence, ready to sync when connectivity returns.</p></div></div><div><MessageCircle size={23} aria-hidden="true" /><div><h3>Keep people in the conversation.</h3><p>Resident updates and provider-ready communication workflows, with preferences and approvals built in.</p></div></div><div><Globe2 size={23} aria-hidden="true" /><div><h3>Start here. Grow from here.</h3><p>One estate or a growing portfolio. Add teams and capabilities around the way your business works.</p></div></div></div></div></div>
      </section>

      <section id="faq" className="pb-faq pb-section"><div className="pb-content-container pb-faq-grid"><div><h2>A few things<br />you might be wondering.</h2><p>A clear picture before your next step.</p><Link className="pb-text-link" href={productHref('/dashboard')}>{demoLabel}<ArrowUpRight size={17} aria-hidden="true" /></Link></div><div className="pb-faq-list">{FAQ.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={19} aria-hidden="true" /></summary><p>{websiteOnly && 'previewAnswer' in item ? item.previewAnswer : item.answer}</p></details>)}</div></div></section>

      <section className="pb-final-cta"><div className="pb-content-container"><div className="pb-cta-pattern" aria-hidden="true" /><div className="pb-cta-copy"><h2>The future of property<br />starts with a better today.</h2><p>Take a look around. See what a connected workspace could mean for your buildings, your team and your community.</p><Link className="pb-button pb-button-lime" href={productHref('/dashboard')}>{demoLabel}<ArrowUpRight size={18} aria-hidden="true" /></Link></div><PropbrewMark className="pb-cta-mark" /></div></section>
    </>
  );
}
