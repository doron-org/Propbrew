import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PropbrewLogo } from '@/components/brand/propbrew-logo';
import { brand } from '@/config/brand';
import { constructionArchived } from '@/config/module-archive';

const COLUMNS = [
  {
    title: 'Explore',
    links: [
      { href: '#platform', label: 'The platform' },
      { href: '#intelligence', label: 'Propbrew intelligence' },
      { href: '#why', label: 'Why Propbrew' },
      { href: '#faq', label: 'Your questions' },
    ],
  },
  {
    title: 'Operate',
    links: [
      { href: '/control-center', label: 'Facilities & estates' },
      { href: '/construction', label: 'Construction' },
      { href: '/collections', label: 'Collections & finance' },
      { href: '/shortlet', label: 'Short lets' },
    ],
  },
  {
    title: 'Connect',
    links: [
      { href: '/portfolio', label: 'Portfolio & investors' },
      { href: '/portal', label: 'Resident experience' },
      { href: '#intelligence', label: 'People + AI' },
      { href: '#why', label: 'Made for our market' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { href: '/dashboard', label: 'Explore the demo' },
      { href: '/login', label: 'Sign in' },
      { href: '/admin/overview', label: 'Platform admin' },
      { href: '#faq', label: 'Pilot & onboarding' },
    ],
  },
];

export function SiteFooter({ websiteOnly = false }: { websiteOnly?: boolean }) {
  const columns = COLUMNS.map((column) => ({
    ...column,
    links: column.links
      .filter((link) => (!constructionArchived() || link.href !== '/construction') && (!websiteOnly || (link.href !== '/login' && !link.href.startsWith('/admin'))))
      .map((link) => ({
        ...link,
        href: websiteOnly && link.href.startsWith('/') ? '/#platform' : link.href,
        label: websiteOnly && link.href === '/dashboard' ? 'Explore the preview' : link.label,
      })),
  }));

  return (
    <footer className="pb-footer">
      <div className="pb-footer-inner">
        <div className="pb-footer-top">
          <div className="pb-footer-intro">
            <PropbrewLogo light />
            <p>A little more connected.<br />A whole lot more possible.</p>
            <Link href={websiteOnly ? '/#platform' : '/dashboard'} className="pb-footer-cta">{websiteOnly ? 'Explore the preview' : 'Explore the demo'} <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
          <nav className="pb-footer-columns" aria-label="Footer navigation">
            {columns.map((column) => (
              <div className="pb-footer-column" key={column.title}>
                <h2>{column.title}</h2>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}><Link href={link.href}>{link.label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="pb-footer-wordmark" aria-hidden="true">{brand.name.toLowerCase()}</div>
        <div className="pb-footer-bottom">
          <p>© {new Date().getFullYear()} {brand.name}. Made with possibility in Lagos, Nigeria.</p>
          <p>{websiteOnly ? 'Interactive website preview. Sample data. Operational access requires activation.' : 'Interactive product demo. Figures shown are sample data.'}</p>
        </div>
      </div>
    </footer>
  );
}
