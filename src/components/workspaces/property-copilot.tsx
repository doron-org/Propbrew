'use client';

import { Fragment, useRef, useState } from 'react';
import { PageTabs } from '@/components/ui/page-tabs';
import { StatusPill } from '@/components/ui';
import {
  CopilotComposer, CopilotConversation, CopilotEmpty, CopilotFrame, CopilotLayout,
  CopilotMessage, CopilotPanel, CopilotSafeguards, CopilotSuggestions, CopilotSummary,
} from '@/components/ai/copilot-reference';
import { CopilotStreamReply } from '@/components/ai/copilot-stream-reply';
import { useCopilotAutoScroll, useCopilotStream } from '@/components/ai/use-copilot-stream';

const suggestions = [
  'Which maintenance jobs need attention?',
  'What do our assets and planned maintenance show?',
  'What is the collection position in recorded NGN?',
  'Which resident and building issues overlap?',
];

export function PropertyCopilot({ module, siteId, propertyName }: { module: 'estate' | 'facility'; siteId?: string; propertyName?: string }) {
  const [question, setQuestion] = useState('');
  const endpoint = `/api/property-management/copilot${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`;
  const { exchanges, busy, submit, stop, retry } = useCopilotStream({ endpoint, module });
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useCopilotAutoScroll(log, exchanges);
  const ask = (value: string) => { if (!value.trim() || busy) return; setQuestion(''); void submit(value.trim()); };
  return <CopilotFrame>
    <CopilotSummary eyebrow="Property Management · permission-aware AI" title={propertyName ? `Ask about ${propertyName}` : 'Ask about your properties'} description="Explore resident, commercial and building records together where your role permits." note="Answers use a bounded authorised snapshot. Check linked records before making a decision; questions never change data." />
    <PageTabs label="Property Copilot sections" items={[
      { id: 'assistant', label: 'Ask Copilot', content: <CopilotLayout conversation={<CopilotPanel title="Property conversation" subtitle="Estate and building evidence are kept distinct in each answer." action={<StatusPill status={busy ? 'Answering' : 'Ready'} tone={busy ? 'progress' : 'neutral'} />}>
        <CopilotConversation label="Property Copilot conversation" busy={busy} logRef={log}>
          {exchanges.length ? exchanges.map((exchange) => <Fragment key={exchange.id}><CopilotMessage speaker="you"><p>{exchange.question}</p></CopilotMessage><CopilotStreamReply exchange={exchange} name="Property Copilot" busy={busy} onRetry={(id) => { void retry(id); }} /></Fragment>) : <CopilotEmpty title="Ask a property question" description="Ask about the records available to your role, then review the cited registers and coverage notices." />}
        </CopilotConversation>
        <CopilotComposer label="Ask Property Copilot" value={question} onChange={setQuestion} onSubmit={ask} busy={busy} onStop={stop} inputRef={composer} placeholder="e.g. What should we prioritise at this property?" hint="AI can make mistakes. It cannot approve payments, dispatch help or change records." />
      </CopilotPanel>} sidebar={<CopilotSuggestions items={suggestions} disabled={busy} onSelect={(value) => { setQuestion(value); composer.current?.focus(); }} />} /> },
      { id: 'safeguards', label: 'Sources & safeguards', content: <CopilotSafeguards items={[
        { title: 'Property boundary', text: 'A selected property narrows the evidence to records assigned to that site. Company-wide records without a site are excluded.' },
        { title: 'Human review', text: 'Answers are advisory. Review the linked work order and reporting registers before acting.' },
        { title: 'Native currencies', text: 'Amounts retain their recorded currency. The assistant must not combine naira with another currency without an explicit, verified conversion.' },
      ]} /> },
    ]} />
  </CopilotFrame>;
}
