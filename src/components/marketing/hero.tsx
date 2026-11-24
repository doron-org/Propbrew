import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Building2, HardHat, Users, Wrench } from 'lucide-react';
import { constructionArchived } from '@/config/module-archive';

export function Hero({ websiteOnly = false }: { websiteOnly?: boolean }) {
  return (
    <section className="pb-hero" aria-labelledby="hero-title">
      <div className="pb-hero-grid pb-container">
        <div className="pb-hero-copy">
          <p className="pb-eyebrow">THE PROPERTY OPERATING SYSTEM</p>
          <h1 id="hero-title">Great places.<br /><span>Better run.</span></h1>
          <p className="pb-hero-description">Your buildings, teams and communities. One connected workspace for a brighter property future.</p>
          <div className="pb-hero-actions">
            <Link className="pb-button pb-button-primary" href={websiteOnly ? '/#platform' : '/dashboard'}>{websiteOnly ? 'Explore the preview' : 'Explore the demo'} <ArrowUpRight size={18} aria-hidden="true" /></Link>
            <a className="pb-text-link" href="#platform">See how it connects <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <div className="pb-hero-note"><span className="pb-note-line" aria-hidden="true" />Built for Nigeria. Ready to think bigger.</div>
        </div>
        <figure className="pb-hero-visual">
          <Image src="/brand/neighborhood.webp" alt="An illustrated vision of a sunny tropical neighbourhood with contemporary apartments, green courtyards and rooftop gardens" fill sizes="(max-width: 760px) 100vw, 52vw" preload className="pb-hero-image" />
          <div className="pb-visual-caption"><Building2 size={16} aria-hidden="true" /><span>A future worth building.</span><span className="pb-concept-label">Architectural concept</span></div>
        </figure>
      </div>
      <div className="pb-lifecycle pb-container">
        <p>One platform.<br /><strong>A whole world of property.</strong></p>
        <div><Wrench size={18} aria-hidden="true" /><span>Facilities</span></div>
        <div><Users size={18} aria-hidden="true" /><span>Estates & communities</span></div>
        {!constructionArchived() && <div><HardHat size={18} aria-hidden="true" /><span>Construction</span></div>}
        <div><Building2 size={18} aria-hidden="true" /><span>Portfolios</span></div>
      </div>
    </section>
  );
}
