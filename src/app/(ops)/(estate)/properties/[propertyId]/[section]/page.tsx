import { notFound } from 'next/navigation';
import { PropertyOperatingHub } from '@/components/workspaces/property-operating-hub';
import { withDurableRead } from '@/server/data/durable-records';
import { requireCapability } from '@/server/guard';
import { readEstatePropertyOperating } from '@/server/reads/estate-property-operating';

export const dynamic = 'force-dynamic';

const sectionTabs = {
  operations: 'operations',
  'asset-care': 'asset-care',
  'building-services': 'building-services',
  'community-governance': 'community',
  'finance-commerce': 'finance',
  intelligence: 'intelligence',
} as const;

export default async function EstatePropertySectionPage({ params }: { params: Promise<{ propertyId: string; section: string }> }) {
  return withDurableRead(async () => {
    const { actor } = await requireCapability('assets_ppm', 'read', 'estate');
    const { propertyId, section } = await params;
    const defaultSection = sectionTabs[section as keyof typeof sectionTabs];
    if (!defaultSection) notFound();
    const { property, permissions } = readEstatePropertyOperating(actor, propertyId);
    if (!property) notFound();
    if ((section === 'asset-care' || section === 'building-services') && !permissions.facility) notFound();
    return <PropertyOperatingHub property={property} permissions={permissions} defaultSection={defaultSection} />;
  });
}
