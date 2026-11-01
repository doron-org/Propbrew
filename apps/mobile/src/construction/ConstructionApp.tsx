import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import type { ConstructionBootstrap, ConstructionCapture, ConstructionTask } from './types';
import {
  discardConstructionCapture, flushConstructionCaptures, listConstructionCaptures,
  queueConstructionCapture, retryConstructionCapture, stageConstructionPhoto,
} from './outbox';

type Tab = 'projects' | 'tasks' | 'check_in' | 'outbox';
const blue = '#315cff', ink = '#090a0c', paper = '#f3f3f1', muted = '#656b76';
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: 'business-outline' },
  { id: 'tasks', label: 'Tasks', icon: 'checkbox-outline' },
  { id: 'check_in', label: 'Check in', icon: 'location-outline' },
  { id: 'outbox', label: 'Outbox', icon: 'cloud-upload-outline' },
];
const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });

export function ConstructionApp({ data, cached, onRefresh, onSwitch, onSignOut }: {
  data: ConstructionBootstrap; cached: boolean; onRefresh: () => Promise<void>; onSwitch?: () => void; onSignOut: () => void;
}) {
  const owner = data.profile.owner;
  const [tab, setTab] = useState<Tab>('projects');
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? '');
  const [captures, setCaptures] = useState<ConstructionCapture[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const project = data.projects.find((row) => row.id === projectId) ?? data.projects[0];
  const selectedId = project?.id ?? '';
  const tasks = data.tasks.filter((row) => row.projectId === selectedId);
  const pending = captures.filter((row) => row.status === 'queued').length;
  const attention = captures.filter((row) => row.status === 'needs_attention').length;
  const todayWAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const checkedInToday = data.checkIns.some((row) => row.projectId === selectedId && row.dateISO === todayWAT)
    || captures.some((row) => row.kind === 'field_check_in' && row.payload.projectId === selectedId);

  const reload = useCallback(async () => setCaptures(await listConstructionCaptures(owner)), [owner]);
  const syncNow = useCallback(async () => {
    try {
      const result = await flushConstructionCaptures(owner);
      await reload();
      if (!result.offline && !result.sessionExpired) await onRefresh();
      if (result.sessionExpired) setMessage('Your access needs to be checked again. Sign in before syncing.');
      else if (result.needsAttention) setMessage('Some captures need review. Open the Outbox to resolve them.');
      else if (result.offline) setMessage('Sync is unavailable. Captures are safe on this device and will retry when the service is reachable.');
      else if (result.synced) setMessage(`${result.synced} capture${result.synced === 1 ? '' : 's'} synced to the project.`);
    } catch { setMessage('Sync could not finish. Your device copies are still in the Outbox.'); }
  }, [owner, reload, onRefresh]);

  useEffect(() => {
    const timer = setTimeout(() => { void reload(); void syncNow(); }, 0);
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void syncNow();
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => { clearTimeout(timer); network.remove(); foreground.remove(); };
  }, [reload, syncNow]);

  async function queue(kind: ConstructionCapture['kind'], payload: Record<string, unknown>, photoUri?: string, id = randomUUID(), capturedISO = new Date().toISOString()) {
    const capture: ConstructionCapture = { id, owner, kind, capturedISO, payload, status: 'queued', photoUri };
    await queueConstructionCapture(capture);
    await reload();
    setMessage('Saved on this device. Sync will confirm it with the project.');
    void syncNow();
  }

  async function checkIn() {
    if (!project) return;
    if (!project.sites.length) return Alert.alert('Site not configured', 'A project manager must add site coordinates in Project Setup first.');
    if (checkedInToday) return Alert.alert('Already checked in', 'This project already has a check-in recorded or waiting to sync today.');
    setWorking(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow precise location to check in at this site.');
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const accuracy = fix.coords.accuracy;
      if (!accuracy || accuracy > 75) throw new Error('Location accuracy is too low. Move into open sky and retry.');
      await queue('field_check_in', {
        projectId: project.id, latitude: fix.coords.latitude, longitude: fix.coords.longitude,
        accuracyMeters: accuracy, locationAtISO: new Date(fix.timestamp).toISOString(),
      }, undefined, randomUUID(), new Date(fix.timestamp).toISOString());
    } catch (error) { Alert.alert('Check-in not saved', error instanceof Error ? error.message : 'Try again.'); }
    finally { setWorking(false); }
  }

  async function addEvidence(task: ConstructionTask, source: 'camera' | 'library') {
    setWorking(true);
    try {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow photo access to capture site evidence.');
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.85 });
      if (picked.canceled || !picked.assets[0]) return;
      const id = randomUUID();
      const image = await ImageManipulator.manipulate(picked.assets[0].uri).renderAsync();
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      const photoUri = stageConstructionPhoto(jpeg.uri, id);
      try {
        await queue('evidence_pack', { projectId: task.projectId, mediaRefs: [], subject: 'task',
          subjectRef: task.id, title: `${task.name} · site photo` }, photoUri, id);
      } catch (error) {
        const staged = new File(photoUri);
        if (staged.exists) staged.delete();
        throw error;
      }
    } catch (error) { Alert.alert('Photo not saved', error instanceof Error ? error.message : 'Try again.'); }
    finally { setWorking(false); }
  }

  return <SafeAreaView style={styles.app}>
    <View style={styles.header}>
      <View style={styles.brand}><View style={styles.mark}><Ionicons name="construct" size={20} color="#fff" /></View><View><Text style={styles.brandName}>Propbrew Field</Text><Text style={styles.muted}>{data.profile.displayName} · {data.profile.role.replaceAll('-', ' ')}</Text></View></View>
      {onSwitch ? <Pressable accessibilityRole="button" accessibilityLabel="Switch to Estate" style={styles.switch} onPress={onSwitch}><Ionicons name="swap-horizontal" size={20} color={blue} /></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" style={styles.switch} onPress={onSignOut}><Ionicons name="log-out-outline" size={20} color={blue} /></Pressable>
    </View>
    <View style={styles.statusBar}><View style={[styles.dot, { backgroundColor: cached ? '#c9852b' : '#198c65' }]} /><Text style={styles.statusText}>{cached ? 'Offline copy · reconnect to confirm changes' : 'Connected to your company workspace'}</Text></View>
    {message ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss field message" onPress={() => setMessage('')} style={styles.message}><Text style={styles.messageText}>{message}</Text><Ionicons name="close" size={16} color={ink} /></Pressable> : null}
    <View style={styles.body}>
      {tab === 'projects' ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Your sites, in focus.</Text><Text style={styles.intro}>Only projects assigned to your company role appear here. Select one to work on its tasks.</Text>
        <View style={styles.metrics}><Metric value={String(data.projects.length)} label="Projects" /><Metric value={String(data.tasks.length)} label="Assigned tasks" /><Metric value={String(pending)} label="Awaiting sync" /></View>
        {data.projects.length ? data.projects.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Open ${row.name}`} style={[styles.projectCard, row.id === selectedId && styles.selected]} onPress={() => { setProjectId(row.id); setTab('tasks'); }}>
          <View style={styles.cardTop}><Text style={styles.cardKicker}>{row.code}</Text><Ionicons name="arrow-forward" size={18} color={blue} /></View>
          <Text style={styles.cardTitle}>{row.name}</Text><Text style={styles.muted}>{row.status.replaceAll('_', ' ')} · {data.tasks.filter((task) => task.projectId === row.id).length} assigned tasks · {row.sites.length} mapped site{row.sites.length === 1 ? '' : 's'}</Text>
        </Pressable>) : <Empty title="No assigned projects" copy="Ask your company administrator to assign a construction project in Team & access." />}
      </ScrollView> : null}
      {tab === 'tasks' ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Assigned work</Text><Text style={styles.intro}>{project?.name ?? 'Choose a project'} · progress is confirmed only after sync.</Text>
        <ProjectPicker data={data} selectedId={selectedId} select={setProjectId} />
        {tasks.length ? tasks.map((task) => <TaskCard key={`${task.id}:${task.percentComplete}`} task={task} pending={captures.some((row) => row.kind === 'task_progress' && row.payload.taskId === task.id)}
          busy={working} onProgress={async (percent) => {
            try { await queue('task_progress', { projectId: task.projectId, taskId: task.id, percentComplete: percent, mediaRefs: [] }); }
            catch (error) { Alert.alert('Progress not saved', error instanceof Error ? error.message : 'Try again.'); }
          }} onPhoto={addEvidence} />)
          : <Empty title="No assigned tasks" copy="The project manager can assign tasks to your field role in Team & access." />}
      </ScrollView> : null}
      {tab === 'check_in' ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Site check-in</Text><Text style={styles.intro}>Confirm your location at the assigned project. A device location check is reviewed by the server; it is not proof of physical presence.</Text>
        <ProjectPicker data={data} selectedId={selectedId} select={setProjectId} />
        <View style={styles.darkCard}><Ionicons name="location" size={30} color="#fff" /><Text style={styles.darkTitle}>{project?.name ?? 'No project selected'}</Text><Text style={styles.darkCopy}>{project?.sites.length ? project.sites.map((site) => site.name).join(' · ') : 'No site coordinates are configured.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Capture site check-in" disabled={working || !project || !project.sites.length || checkedInToday} style={[styles.primary, (working || !project?.sites.length || checkedInToday) && styles.disabled]} onPress={() => void checkIn()}><Text style={styles.primaryText}>{working ? 'Finding location…' : checkedInToday ? 'Check-in recorded or queued' : 'Check in at site'}</Text></Pressable></View>
        <Text style={styles.section}>Your recorded check-ins</Text>
        {data.checkIns.filter((row) => row.projectId === selectedId).map((row) => <View style={styles.row} key={row.id}><Ionicons name="checkmark-circle" size={22} color={blue} /><View style={styles.grow}><Text style={styles.rowTitle}>{day(row.capturedAtISO)}</Text><Text style={styles.muted}>{Math.round(row.distanceMeters)} m from site · ±{Math.round(row.accuracyMeters)} m accuracy</Text></View></View>)}
        {captures.filter((row) => row.payload.projectId === selectedId && row.kind === 'field_check_in').map((row) => <View style={styles.row} key={row.id}><Ionicons name="time-outline" size={22} color={blue} /><Text style={styles.rowTitle}>Check-in awaiting server confirmation</Text></View>)}
      </ScrollView> : null}
      {tab === 'outbox' ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Offline outbox</Text><Text style={styles.intro}>Your device keeps captures until the server confirms them. Conflicts stay here for review.</Text>
        <View style={styles.metrics}><Metric value={String(pending)} label="Queued" /><Metric value={String(attention)} label="Needs review" /></View>
        <Pressable accessibilityRole="button" disabled={working} style={styles.primary} onPress={() => { setWorking(true); void syncNow().finally(() => setWorking(false)); }}><Text style={styles.primaryText}>{working ? 'Syncing…' : 'Sync now'}</Text></Pressable>
        {captures.length ? captures.map((row) => <View style={styles.row} key={row.id}><Ionicons name={row.kind === 'evidence_pack' ? 'camera-outline' : row.kind === 'field_check_in' ? 'location-outline' : 'checkbox-outline'} size={22} color={row.status === 'needs_attention' ? '#bd5d2d' : blue} /><View style={styles.grow}><Text style={styles.rowTitle}>{row.kind.replaceAll('_', ' ')}</Text><Text style={styles.muted}>{day(row.capturedISO)} · {row.status.replaceAll('_', ' ')}</Text>{row.error ? <Text style={styles.error}>{row.error}</Text> : null}<View style={styles.rowActions}>{row.status === 'needs_attention' ? <Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => { void retryConstructionCapture(owner, row.id).then(reload).then(syncNow); }}><Text style={styles.actionText}>Retry</Text></Pressable> : null}<Pressable accessibilityRole="button" style={styles.smallAction} onPress={() => Alert.alert('Discard device copy?', 'This removes the local capture. It will not change a record already accepted by the server.', [{ text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => void discardConstructionCapture(owner, row.id).then(reload) }])}><Text style={styles.actionText}>Discard</Text></Pressable></View></View></View>) : <Empty title="Everything is synced" copy="New task updates, photos and check-ins will appear here until confirmed." />}
      </ScrollView> : null}
    </View>
    <View style={styles.nav}>{tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} accessibilityLabel={item.label} style={[styles.navItem, tab === item.id && styles.navSelected]} onPress={() => setTab(item.id)}><Ionicons name={item.icon as never} size={20} color={tab === item.id ? '#fff' : muted} /><Text style={[styles.navLabel, tab === item.id && styles.navLabelSelected]}>{item.label}</Text>{item.id === 'outbox' && captures.length > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{captures.length}</Text></View> : null}</Pressable>)}</View>
  </SafeAreaView>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <View style={styles.empty}><Ionicons name="layers-outline" size={30} color={blue} /><Text style={styles.cardTitle}>{title}</Text><Text style={styles.intro}>{copy}</Text></View>; }
function ProjectPicker({ data, selectedId, select }: { data: ConstructionBootstrap; selectedId: string; select: (id: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.picker}>{data.projects.map((project) => <Pressable key={project.id} accessibilityRole="button" accessibilityState={{ selected: project.id === selectedId }} style={[styles.chip, selectedId === project.id && styles.chipSelected]} onPress={() => select(project.id)}><Text style={[styles.chipText, selectedId === project.id && styles.chipTextSelected]}>{project.name}</Text></Pressable>)}</ScrollView>;
}
function TaskCard({ task, pending, busy, onProgress, onPhoto }: { task: ConstructionTask; pending: boolean; busy: boolean; onProgress: (percent: number) => Promise<void>; onPhoto: (task: ConstructionTask, source: 'camera' | 'library') => Promise<void> }) {
  const [value, setValue] = useState(String(task.percentComplete));
  const percent = Number(value);
  const valid = Number.isInteger(percent) && percent >= task.percentComplete && percent <= 100;
  return <View style={styles.projectCard}><View style={styles.cardTop}><Text style={styles.cardKicker}>{task.priority} priority · due {day(task.plannedFinishISO)}</Text><Text style={styles.cardKicker}>{task.percentComplete}%</Text></View><Text style={styles.cardTitle}>{task.name}</Text><Text style={styles.muted}>{task.status.replaceAll('_', ' ')}{pending ? ' · update awaiting sync' : ''}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, task.percentComplete))}%` }]} /></View><View style={styles.taskActions}><TextInput accessibilityLabel={`Progress for ${task.name}, percent`} keyboardType="number-pad" style={styles.percentInput} value={value} onChangeText={setValue} maxLength={3} /><Text style={styles.percentLabel}>%</Text><Pressable accessibilityRole="button" disabled={!valid || pending || busy || percent === task.percentComplete} style={[styles.smallPrimary, (!valid || pending || busy || percent === task.percentComplete) && styles.disabled]} onPress={() => void onProgress(percent)}><Text style={styles.smallPrimaryText}>Save progress</Text></Pressable></View><View style={styles.taskActions}><Pressable accessibilityRole="button" disabled={busy} style={styles.smallAction} onPress={() => void onPhoto(task, 'camera')}><Ionicons name="camera-outline" size={18} color={blue} /><Text style={styles.actionText}>Take photo</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} style={styles.smallAction} onPress={() => void onPhoto(task, 'library')}><Ionicons name="images-outline" size={18} color={blue} /><Text style={styles.actionText}>Choose photo</Text></Pressable></View></View>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: paper }, header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }, mark: { width: 42, height: 42, borderRadius: 14, backgroundColor: blue, alignItems: 'center', justifyContent: 'center' }, brandName: { fontSize: 18, fontWeight: '800', color: ink }, muted: { color: muted, fontSize: 12, lineHeight: 18 },
  switch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, statusBar: { minHeight: 34, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff' }, dot: { width: 7, height: 7, borderRadius: 4 }, statusText: { fontSize: 11, color: muted },
  message: { marginHorizontal: 16, marginTop: 8, padding: 12, backgroundColor: '#e8edff', borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }, messageText: { flex: 1, color: ink, fontSize: 12, lineHeight: 17 },
  body: { flex: 1 }, content: { padding: 18, paddingBottom: 28, gap: 12 }, title: { color: ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 }, intro: { color: muted, fontSize: 13, lineHeight: 20 },
  metrics: { flexDirection: 'row', gap: 8, marginVertical: 8 }, metric: { flex: 1, padding: 12, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4e5e9' }, metricValue: { fontSize: 22, fontWeight: '800', color: ink },
  projectCard: { padding: 17, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e4e5e9', gap: 8 }, selected: { borderColor: blue }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, cardKicker: { color: blue, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, cardTitle: { color: ink, fontSize: 18, fontWeight: '800' },
  empty: { minHeight: 190, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd2e0', justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8 }, picker: { gap: 8, paddingVertical: 5 }, chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e4e5e9' }, chipSelected: { backgroundColor: ink, borderColor: ink }, chipText: { color: ink, fontWeight: '700', fontSize: 12 }, chipTextSelected: { color: '#fff' },
  progressTrack: { height: 7, borderRadius: 5, backgroundColor: '#e8ecf3', overflow: 'hidden' }, progressFill: { height: 7, borderRadius: 5, backgroundColor: blue }, taskActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, percentInput: { width: 62, minHeight: 44, borderWidth: 1, borderColor: '#cbd2e0', borderRadius: 12, textAlign: 'center', fontSize: 15, color: ink, backgroundColor: '#fff' }, percentLabel: { color: muted }, smallPrimary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, backgroundColor: blue, alignItems: 'center', justifyContent: 'center' }, smallPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 12 }, smallAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dce1e9', flexDirection: 'row', alignItems: 'center', gap: 5 }, actionText: { color: blue, fontSize: 12, fontWeight: '700' }, disabled: { opacity: 0.45 },
  darkCard: { backgroundColor: ink, borderRadius: 26, padding: 22, gap: 14 }, darkTitle: { color: '#fff', fontSize: 20, fontWeight: '800' }, darkCopy: { color: '#b7bac3', fontSize: 13, lineHeight: 20 }, primary: { minHeight: 48, paddingHorizontal: 18, backgroundColor: blue, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#fff', fontWeight: '800' }, section: { fontSize: 17, color: ink, fontWeight: '800', marginTop: 8 },
  row: { padding: 15, borderRadius: 16, backgroundColor: '#fff', flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, grow: { flex: 1 }, rowTitle: { color: ink, fontSize: 14, fontWeight: '700' }, rowActions: { flexDirection: 'row', gap: 8, marginTop: 9 }, error: { color: '#a13f25', fontSize: 12, marginTop: 5 },
  nav: { minHeight: 72, paddingHorizontal: 7, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e6e8ef', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, navItem: { minWidth: 72, minHeight: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2 }, navSelected: { backgroundColor: ink }, navLabel: { color: muted, fontSize: 10, fontWeight: '700' }, navLabelSelected: { color: '#fff' }, badge: { position: 'absolute', right: 4, top: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: blue, alignItems: 'center', justifyContent: 'center' }, badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
