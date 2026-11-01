import Image from 'next/image';
import type { AuditEntry, Issue } from '@/domain/construction/types';
import styles from './bcf-issue-evidence.module.css';

type Bcf = NonNullable<Issue['bcf']>;
const dateLabel = (value: string) => new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });
const vector = (value: [number, number, number]) => value.map((part) => part.toFixed(3)).join(' · ');

export function BcfIssueEvidence({ issueId, bcf, history }: { issueId: string; bcf?: Bcf; history: AuditEntry[] }) {
  if (!bcf && !history.length) return null;
  const timeline = [
    ...(bcf?.exchangeHistory ?? []).map((event) => ({ id: `${event.action}-${event.atISO}`, atISO: event.atISO,
      title: `BCF ${event.action}`, detail: `${event.actor} · ${event.commentCount} comments · ${event.viewpointCount} viewpoints · external status ${event.status}${event.previousStatus && event.previousStatus !== event.status ? ` (was ${event.previousStatus})` : ''}` })),
    ...(bcf?.commentRevisions ?? []).map((event) => ({ id: `comment-${event.previous.guid}-${event.savedAtISO}`, atISO: event.savedAtISO,
      title: 'Earlier comment version retained', detail: `${event.previous.author}: ${event.previous.text ?? 'Viewpoint only'}` })),
    ...history.map((event) => ({ id: event.id, atISO: event.atISO, title: event.summary,
      detail: [event.actorName, event.before && event.after ? `${event.before} → ${event.after}` : '', event.note].filter(Boolean).join(' · ') })),
  ].sort((a, b) => b.atISO.localeCompare(a.atISO));
  return <section className={styles.root} aria-label="BIM exchange and issue history">
    {bcf && <>
      <div className={styles.head}><strong>External BIM exchange</strong><span>BCF topic {bcf.guid}</span></div>
      <p className={styles.meta}>Source status: {bcf.externalStatus ?? 'Unknown'} · Created {bcf.createdAtISO ? dateLabel(bcf.createdAtISO) : 'before this import'}{bcf.createdAuthor ? ` by ${bcf.createdAuthor}` : ''}{bcf.modifiedAtISO ? ` · Modified ${dateLabel(bcf.modifiedAtISO)}${bcf.modifiedAuthor ? ` by ${bcf.modifiedAuthor}` : ''}` : ''}</p>
      {bcf.description && <p className={styles.description}>{bcf.description}</p>}
      <div className={styles.grid}>
        <div className={styles.section}><h4>Viewpoints <span>{bcf.viewpoints?.length ?? 0}</span></h4>
          {(bcf.viewpoints ?? []).length ? bcf.viewpoints!.map((view, index) => <article className={styles.viewpoint} key={view.guid}>
            <div className={styles.viewHead}><strong>View {view.index ?? index + 1}</strong><span>{view.camera?.kind ?? 'Model'} camera</span></div>
            {view.snapshot && <Image unoptimized className={styles.snapshot} src={`/api/construction/bcf/snapshots/${encodeURIComponent(issueId)}/${encodeURIComponent(view.guid)}`} alt={`BIM viewpoint ${view.index ?? index + 1} snapshot`} width={480} height={270} />}
            {view.camera && <dl className={styles.facts}><div><dt>Camera</dt><dd>{vector(view.camera.position)}</dd></div><div><dt>Direction</dt><dd>{vector(view.camera.direction)}</dd></div><div><dt>Up vector</dt><dd>{vector(view.camera.up)}</dd></div><div><dt>Aspect</dt><dd>{view.camera.aspectRatio.toFixed(2)}</dd></div>{view.camera.fieldOfView && <div><dt>Field of view</dt><dd>{view.camera.fieldOfView}°</dd></div>}{view.camera.viewToWorldScale && <div><dt>View scale</dt><dd>{view.camera.viewToWorldScale} m</dd></div>}</dl>}
            <p className={styles.meta}>{view.componentIds.length} selected model elements · {view.bitmaps?.length ?? 0} bitmap overlays</p>
            {view.componentIds.length > 0 && <p className={styles.ids}>Selected: {view.componentIds.join(', ')}</p>}
            {view.xml && <details className={styles.xml}><summary>Full viewpoint data</summary><pre>{view.xml}</pre></details>}
          </article>) : <p className={styles.empty}>No viewpoint was included in the exchange.</p>}
        </div>
        <div className={styles.section}><h4>Comments <span>{bcf.comments?.length ?? 0}</span></h4>
          {(bcf.comments ?? []).length ? bcf.comments!.map((comment) => <article className={styles.comment} key={comment.guid}>
            <div className={styles.viewHead}><strong>{comment.author}</strong><time dateTime={comment.dateISO}>{dateLabel(comment.dateISO)}</time></div>
            <p>{comment.text ?? 'Comment attached to a viewpoint.'}</p>
            {comment.viewpointGuid && <small>Viewpoint {comment.viewpointGuid}</small>}
            {comment.modifiedAtISO && <small>Edited {dateLabel(comment.modifiedAtISO)}{comment.modifiedAuthor ? ` by ${comment.modifiedAuthor}` : ''}</small>}
          </article>) : <p className={styles.empty}>No comments were included in the exchange.</p>}
        </div>
      </div>
    </>}
    {timeline.length > 0 && <div className={styles.section}><h4>Issue history</h4><ol className={styles.timeline}>{timeline.map((event) => <li key={event.id}><time dateTime={event.atISO}>{dateLabel(event.atISO)}</time><strong>{event.title}</strong><span>{event.detail}</span></li>)}</ol></div>}
  </section>;
}
