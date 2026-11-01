import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { ApiError, bootstrap, forgetSession, getLastOwner, hasSession, rememberOwner, signIn, verifyTotp } from './src/api';
import { cacheBootstrap, drainOutbox, queueCheckIn, queueEvidence, queueTaskProgress, readCachedBootstrap, readOutbox, retryCapture } from './src/outbox';
import type { Bootstrap, FieldOp, Task } from './src/types';

type Tab = 'today' | 'tasks' | 'capture' | 'outbox';
const color = { blue: '#3d46f5', ink: '#17191e', text: '#343b46', muted: '#798393', paper: '#f5f6f8', white: '#fff', line: '#e4e8ef', success: '#117d62', danger: '#bc493f' };
const icon = (name: React.ComponentProps<typeof Ionicons>['name'], size = 20, tint = color.ink) => <Ionicons name={name} size={size} color={tint} />;

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [outbox, setOutbox] = useState<FieldOp[]>([]);
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState<Tab>('today');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const previousOwner = await getLastOwner();
    if (previousOwner) {
      const cached = await readCachedBootstrap(previousOwner);
      if (cached) { setData(cached); setProjectId((current) => current || cached.projects[0]?.id || ''); setOutbox(await readOutbox(previousOwner)); }
    }
    if (!await hasSession()) { setBooting(false); return; }
    try {
      const remote = await bootstrap();
      await rememberOwner(remote.profile.owner);
      await cacheBootstrap(remote);
      setData(remote);
      setProjectId((current) => remote.projects.some((project) => project.id === current) ? current : remote.projects[0]?.id || '');
      setOutbox(await readOutbox(remote.profile.owner));
      setOffline(false);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) { await forgetSession(); setData(null); }
      else { setOffline(true); setError(cause instanceof Error ? cause.message : 'Could not refresh assigned work.'); }
    } finally { setBooting(false); }
  }, []);

  useEffect(() => { const timer = setTimeout(() => { void load().catch((cause) => { setError(cause instanceof Error ? cause.message : 'Could not open saved field records.'); setBooting(false); }); }, 0); return () => clearTimeout(timer); }, [load]);
  const sync = useCallback(async () => {
    if (!data) return;
    try {
      setOutbox(await drainOutbox(data.profile.owner, setOutbox));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sync paused. Your captures are saved on this device.'); }
  }, [data, load]);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => { void sync(); }, 20_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void sync(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [data, sync]);

  const doCapture = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { const result = await action(); if (result === false) return; setOutbox(await readOutbox(data!.profile.owner)); Alert.alert('Saved on this device', success); void sync(); }
    catch (cause) { Alert.alert('Could not save capture', cause instanceof Error ? cause.message : 'Try again.'); }
    finally { setBusy(false); }
  };
  const checkIn = () => doCapture(async () => {
    if (!data || !projectId) throw new Error('Choose a project first.');
    const project = data.projects.find((item) => item.id === projectId);
    if (!project?.sites.length) throw new Error('This project needs site coordinates set up by the project manager before a location check-in.');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new Error('Location permission is needed for a site check-in.');
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, mayShowUserSettingsDialog: true });
    if (location.coords.accuracy == null || location.coords.accuracy > 75) throw new Error('Location accuracy is too low. Move into open sky and try again.');
    await queueCheckIn(data, projectId, { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracyMeters: location.coords.accuracy, locationAtISO: new Date(location.timestamp).toISOString() });
  }, 'Your location check-in is queued. It will be accepted only if it is within the configured site radius.');

  if (booting) return <SafeAreaView style={s.center}><ActivityIndicator color={color.blue} /><Text style={s.muted}>Opening your field workspace…</Text></SafeAreaView>;
  if (!data) return <Login onDone={load} error={error} />;
  const project = data.projects.find((item) => item.id === projectId);
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const queued = outbox.filter((op) => op.status !== 'synced').length;
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const checkedIn = data.checkIns.some((item) => item.projectId === projectId && item.dateISO === todayISO) || outbox.some((item) => item.kind === 'field_check_in' && item.payload.projectId === projectId && item.status !== 'conflict');

  return <SafeAreaView style={s.shell}>
    <StatusBar barStyle="dark-content" backgroundColor={color.white} />
    <View style={s.topbar}><View style={s.brandMark}>{icon('construct', 20, color.white)}</View><View style={{ flex: 1 }}><Text style={s.brand}>Propbrew Field</Text><Text style={s.brandSub}>{data.profile.displayName} · {data.profile.role.replaceAll('-', ' ')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Sync saved captures" onPress={() => void sync()} style={s.iconButton}>{icon('sync')}</Pressable></View>
    <ScrollView style={s.content} contentContainerStyle={s.scrollBody} keyboardShouldPersistTaps="handled">
      <View style={s.pageHead}><Text style={s.eyebrow}>CONSTRUCTION FIELD</Text><Text style={s.pageTitle}>{selectedTask ? 'Task detail' : tab === 'today' ? 'Today on site' : tab === 'tasks' ? 'Assigned tasks' : tab === 'capture' ? 'Site capture' : 'Sync outbox'}</Text><Text style={s.muted}>{offline ? 'Offline view · saved work remains on this device' : 'Connected to your company workspace'}</Text></View>
      {error ? <View style={s.warning}><Text style={s.warningText}>{error}</Text></View> : null}
      <ProjectPicker data={data} selected={projectId} onSelect={(value) => { setProjectId(value); setSelectedTaskId(null); }} />
      {selectedTask ? <TaskDetail key={`${selectedTask.id}:${selectedTask.percentComplete}`} task={selectedTask} data={data} busy={busy} back={() => setSelectedTaskId(null)} capture={doCapture} /> : tab === 'today' ? <>
        <View style={s.hero}><View style={s.heroIcon}>{icon('location', 23, color.white)}</View><Text style={s.heroTitle}>{project?.name ?? 'Choose a project'}</Text><Text style={s.heroCopy}>{project?.sites.length ? `Configured site: ${project.sites.map((site) => site.name).join(', ')}` : 'Site location has not been configured.'}</Text><Pressable accessibilityRole="button" disabled={busy || checkedIn || !project} onPress={() => void checkIn()} style={[s.heroButton, checkedIn && s.disabled]}><Text style={s.heroButtonText}>{checkedIn ? 'Check-in saved today' : busy ? 'Getting location…' : 'Check in at site'}</Text>{icon(checkedIn ? 'checkmark-circle' : 'arrow-forward', 18, color.white)}</Pressable><Text style={s.heroNote}>Uses a fresh device location and the project site radius. Location can be spoofed and is reviewed as an attestation.</Text></View>
        <Section title="Work needing attention" aside={`${tasks.filter((task) => task.status !== 'done').length} tasks`} />
        {tasks.filter((task) => task.status !== 'done').slice(0, 6).map((task) => <TaskRow key={task.id} task={task} open={() => setSelectedTaskId(task.id)} />)}
        {!tasks.length ? <Empty title="No assigned tasks" copy="Your project manager can assign tasks to this account on the web." /> : null}
        <View style={s.summaryRow}><MiniStat iconName="cloud-upload" value={String(queued)} label="Waiting to sync" /><MiniStat iconName="checkmark-done" value={String(outbox.filter((item) => item.status === 'synced').length)} label="Synced captures" /></View>
      </> : tab === 'tasks' ? <>
        <Section title="Your project tasks" aside={`${tasks.length} assigned`} />
        {tasks.map((task) => <TaskRow key={task.id} task={task} open={() => setSelectedTaskId(task.id)} />)}
        {!tasks.length ? <Empty title="No assigned tasks" copy="Tasks appear here once a project manager assigns them to you." /> : null}
      </> : tab === 'capture' ? <>
        <View style={s.card}><Text style={s.cardTitle}>Capture work where it happens</Text><Text style={s.muted}>Open an assigned task to record progress and attach a photo. Each capture is saved before the app attempts to send it.</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={() => setTab('tasks')}><Text style={s.actionText}>Browse assigned tasks</Text>{icon('arrow-forward', 18, color.white)}</Pressable></View>
        <View style={s.card}><Text style={s.cardTitle}>Site attendance</Text><Text style={s.muted}>Check in with a fresh device location at a configured project site. A manual attendance entry is shown separately on the web.</Text><Pressable accessibilityRole="button" disabled={busy || checkedIn} style={[s.outlineButton, checkedIn && s.disabled]} onPress={() => void checkIn()}><Text style={s.outlineText}>{checkedIn ? 'Check-in saved today' : 'Capture site check-in'}</Text></Pressable></View>
      </> : <>
        <View style={s.card}><Text style={s.cardTitle}>Saved on this device</Text><Text style={s.muted}>Captures keep their original ID across retries. Photos stay here until the server confirms the evidence record.</Text><Pressable accessibilityRole="button" style={s.actionButton} onPress={() => void sync()}><Text style={s.actionText}>Sync now</Text>{icon('sync', 18, color.white)}</Pressable></View>
        {outbox.map((item) => <View key={item.id} style={s.card}><View style={s.row}><View style={{ flex: 1 }}><Text style={s.cardTitle}>{item.label}</Text><Text style={s.muted}>{item.kind.replaceAll('_', ' ')} · {new Date(item.capturedISO).toLocaleString('en-NG')}</Text></View><Text style={[s.status, item.status === 'synced' ? s.statusSuccess : item.status === 'conflict' ? s.statusDanger : null]}>{item.status}</Text></View>{item.error ? <Text style={s.errorText}>{item.error}</Text> : null}{item.status === 'conflict' ? <Pressable accessibilityRole="button" style={s.back} onPress={() => void retryCapture(data.profile.owner, item.id).then((rows) => { setOutbox(rows); void sync(); }).catch((cause) => Alert.alert('Retry unavailable', cause instanceof Error ? cause.message : 'Try again.'))}><Text style={s.backText}>Retry after resolving this issue</Text></Pressable> : null}{item.photos.length ? <Text style={s.meta}>{item.photos.length} photo · {item.photos.filter((photo) => photo.uploadedUrl).length} uploaded</Text> : null}</View>)}
        {!outbox.length ? <Empty title="Nothing queued" copy="Your task progress, photos, and check-ins will appear here." /> : null}
      </>}
      <View style={s.account}><Text style={s.meta}>Company: {data.profile.companyId}</Text><Pressable accessibilityRole="button" style={s.accountAction} onPress={() => Alert.alert('Sign out?', 'Saved captures stay on this device and remain tied to this account.', [{ text: 'Cancel' }, { text: 'Sign out', style: 'destructive', onPress: async () => { await forgetSession(); setData(null); setOutbox([]); setProjectId(''); } }])}><Text style={s.signOut}>Sign out</Text></Pressable></View>
    </ScrollView>
    <View style={s.nav}>{([['today', 'today', 'sunny-outline'], ['tasks', 'tasks', 'checkbox-outline'], ['capture', 'capture', 'camera-outline'], ['outbox', queued ? `outbox ${queued}` : 'outbox', 'cloud-upload-outline']] as const).map(([value, label, name]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setSelectedTaskId(null); }} style={[s.navItem, tab === value && s.navSelected]}>{icon(name, 21, tab === value ? color.blue : color.muted)}<Text style={[s.navText, tab === value && s.navTextSelected]}>{label}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function Login({ onDone, error }: { onDone(): Promise<void>; error: string }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [totpRequired, setTotpRequired] = useState(false), [busy, setBusy] = useState(false);
  return <SafeAreaView style={s.login}><StatusBar barStyle="dark-content" /><View style={s.loginMark}>{icon('construct', 28, color.white)}</View><Text style={s.loginTitle}>{totpRequired ? 'Confirm it’s you.' : 'The site moves with you.'}</Text><Text style={s.loginCopy}>{totpRequired ? 'Enter the six-digit code from your authenticator app.' : 'Sign in with your Propbrew company account to see only your construction projects and assigned work.'}</Text>{error ? <Text style={s.errorText}>{error}</Text> : null}{totpRequired ? <TextInput accessibilityLabel="Authenticator code" style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Six-digit code" maxLength={6} /> : <><TextInput accessibilityLabel="Email address" style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Work email" autoComplete="email" /><TextInput accessibilityLabel="Password" style={s.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" autoComplete="current-password" /></>}<Pressable accessibilityRole="button" disabled={busy || (totpRequired ? code.length !== 6 : !email || !password)} style={[s.actionButton, busy && s.disabled]} onPress={async () => { setBusy(true); try { if (totpRequired) { await verifyTotp(code); await onDone(); } else { const step = await signIn(email, password); if (step === 'totp') setTotpRequired(true); else await onDone(); } } catch (cause) { Alert.alert('Could not sign in', cause instanceof Error ? cause.message : 'Try again.'); } finally { setBusy(false); } }}><Text style={s.actionText}>{busy ? 'Checking…' : totpRequired ? 'Verify and continue' : 'Open field workspace'}</Text>{icon('arrow-forward', 18, color.white)}</Pressable>{totpRequired ? <Pressable accessibilityRole="button" style={s.back} onPress={() => { setTotpRequired(false); setCode(''); }}><Text style={s.backText}>Use a different account</Text></Pressable> : null}<Text style={s.loginNote}>This app uses the same company records as Propbrew on the web. Offline captures remain isolated to your account.</Text></SafeAreaView>;
}

function ProjectPicker({ data, selected, onSelect }: { data: Bootstrap; selected: string; onSelect(value: string): void }) {
  return <View><Text style={s.fieldLabel}>PROJECT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.projectStrip}>{data.projects.map((project) => <Pressable key={project.id} accessibilityRole="button" accessibilityState={{ selected: project.id === selected }} onPress={() => onSelect(project.id)} style={[s.projectChip, project.id === selected && s.projectChipSelected]}><Text style={[s.projectChipText, project.id === selected && s.projectChipTextSelected]} numberOfLines={1}>{project.name}</Text></Pressable>)}</ScrollView>{!data.projects.length ? <Empty title="No project access" copy="Ask your company administrator to assign you to a construction project." /> : null}</View>;
}
function Section({ title, aside }: { title: string; aside: string }) { return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text><Text style={s.meta}>{aside}</Text></View>; }
function TaskRow({ task, open }: { task: Task; open(): void }) { return <Pressable accessibilityRole="button" onPress={open} style={s.taskRow}><View style={s.taskIcon}>{icon(task.status === 'done' ? 'checkmark' : 'hammer-outline', 19, color.blue)}</View><View style={{ flex: 1 }}><Text style={s.taskTitle}>{task.name}</Text><Text style={s.meta}>{task.status.replaceAll('_', ' ')} · {task.percentComplete}% complete</Text><View style={s.progressTrack}><View style={[s.progressFill, { width: `${task.percentComplete}%` }]} /></View></View>{icon('chevron-forward', 17, color.muted)}</Pressable>; }
function MiniStat({ iconName, value, label }: { iconName: React.ComponentProps<typeof Ionicons>['name']; value: string; label: string }) { return <View style={s.miniStat}>{icon(iconName, 19, color.blue)}<Text style={s.miniValue}>{value}</Text><Text style={s.meta}>{label}</Text></View>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <View style={s.empty}>{icon('file-tray-outline', 30, color.muted)}<Text style={s.cardTitle}>{title}</Text><Text style={s.muted}>{copy}</Text></View>; }

function TaskDetail({ task, data, busy, back, capture }: { task: Task; data: Bootstrap; busy: boolean; back(): void; capture(action: () => Promise<unknown>, success: string): Promise<void> }) {
  const [percent, setPercent] = useState(String(task.percentComplete));
  const [caption, setCaption] = useState('');
  return <><Pressable accessibilityRole="button" style={s.back} onPress={back}>{icon('arrow-back', 18, color.blue)}<Text style={s.backText}>All tasks</Text></Pressable><View style={s.card}><Text style={s.detailTitle}>{task.name}</Text><Text style={s.muted}>{task.status.replaceAll('_', ' ')} · {task.priority ?? 'standard'} priority</Text><View style={s.progressTrack}><View style={[s.progressFill, { width: `${task.percentComplete}%` }]} /></View><Text style={s.meta}>{task.percentComplete}% recorded on the server</Text></View>
    <View style={s.card}><Text style={s.cardTitle}>Record progress</Text><Text style={s.muted}>Progress cannot decrease. The server checks task dependencies when this syncs.</Text><TextInput accessibilityLabel="Percent complete" style={s.input} value={percent} onChangeText={setPercent} keyboardType="number-pad" placeholder="0 to 100" /><Pressable accessibilityRole="button" disabled={busy} style={[s.actionButton, busy && s.disabled]} onPress={() => void capture(async () => { const value = Number(percent); if (!Number.isInteger(value) || value < task.percentComplete || value > 100) throw new Error(`Enter a whole number from ${task.percentComplete} to 100.`); await queueTaskProgress(data, task.id, value); }, 'Progress is queued and will sync when connected.')}><Text style={s.actionText}>Save progress</Text>{icon('arrow-forward', 18, color.white)}</Pressable></View>
    <View style={s.card}><Text style={s.cardTitle}>Photo evidence</Text><Text style={s.muted}>Take a site photo. The original stays on your phone until the server acknowledges it.</Text><TextInput accessibilityLabel="Photo caption" style={s.input} value={caption} onChangeText={setCaption} placeholder="What does this photo show?" maxLength={200} /><Pressable accessibilityRole="button" disabled={busy} style={[s.outlineButton, busy && s.disabled]} onPress={() => void capture(async () => { if (!caption.trim()) throw new Error('Describe what this photo shows.'); const permission = await ImagePicker.requestCameraPermissionsAsync(); if (permission.status !== 'granted') throw new Error('Allow camera access to capture site evidence.'); const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75, allowsEditing: false }); if (result.canceled) return false; const image = result.assets[0]; if (!image) throw new Error('No photo was captured.'); await queueEvidence(data, task.id, image.uri, image.mimeType ?? 'image/jpeg', caption); setCaption(''); }, 'Photo evidence is queued for upload and review.')}><Text style={s.outlineText}>Open camera and save evidence</Text>{icon('camera-outline', 19, color.blue)}</Pressable></View>
  </>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: color.paper }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }, topbar: { minHeight: 68, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.white, borderBottomWidth: 1, borderBottomColor: color.line }, brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: color.blue, alignItems: 'center', justifyContent: 'center' }, brand: { fontWeight: '800', fontSize: 16, color: color.ink }, brandSub: { color: color.muted, fontSize: 11, marginTop: 2, textTransform: 'capitalize' }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: color.paper }, content: { flex: 1 }, scrollBody: { paddingHorizontal: 18, paddingBottom: 32 }, pageHead: { paddingTop: 22, paddingBottom: 18 }, eyebrow: { color: color.blue, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }, pageTitle: { fontSize: 28, fontWeight: '800', color: color.ink, letterSpacing: -0.7, marginTop: 4 }, muted: { fontSize: 12, lineHeight: 19, color: color.muted, marginTop: 5 }, fieldLabel: { color: color.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 8 }, projectStrip: { gap: 8, paddingBottom: 15 }, projectChip: { minHeight: 44, maxWidth: 230, paddingHorizontal: 15, borderRadius: 14, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, justifyContent: 'center' }, projectChipSelected: { borderColor: color.blue, backgroundColor: '#ebedff' }, projectChipText: { color: color.text, fontWeight: '700', fontSize: 12 }, projectChipTextSelected: { color: color.blue }, hero: { backgroundColor: color.ink, borderRadius: 24, padding: 20, marginBottom: 12 }, heroIcon: { width: 42, height: 42, backgroundColor: color.blue, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, heroTitle: { color: color.white, fontSize: 23, fontWeight: '800', marginTop: 18 }, heroCopy: { color: '#c7cbd2', fontSize: 12, lineHeight: 18, marginTop: 5 }, heroButton: { minHeight: 48, borderRadius: 14, backgroundColor: color.blue, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 20 }, heroButtonText: { color: color.white, fontSize: 13, fontWeight: '800' }, heroNote: { color: '#aab0bd', fontSize: 10, lineHeight: 15, marginTop: 12 }, disabled: { opacity: 0.55 }, section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 10 }, sectionTitle: { fontSize: 17, fontWeight: '800', color: color.ink }, meta: { fontSize: 10, color: color.muted, marginTop: 4 }, taskRow: { minHeight: 80, padding: 14, marginBottom: 9, backgroundColor: color.white, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: color.line }, taskIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#eceeff', alignItems: 'center', justifyContent: 'center' }, taskTitle: { color: color.ink, fontSize: 13, fontWeight: '700' }, progressTrack: { height: 5, backgroundColor: color.line, borderRadius: 4, overflow: 'hidden', marginTop: 11 }, progressFill: { height: 5, backgroundColor: color.blue, borderRadius: 4 }, summaryRow: { flexDirection: 'row', gap: 9, marginTop: 9 }, miniStat: { flex: 1, backgroundColor: color.white, borderRadius: 17, padding: 15, borderWidth: 1, borderColor: color.line }, miniValue: { color: color.ink, fontSize: 24, fontWeight: '800', marginTop: 8 }, card: { padding: 18, borderRadius: 19, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, marginBottom: 10 }, cardTitle: { fontSize: 14, fontWeight: '800', color: color.ink }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, actionButton: { minHeight: 48, borderRadius: 14, backgroundColor: color.blue, marginTop: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, actionText: { color: color.white, fontSize: 13, fontWeight: '800' }, outlineButton: { minHeight: 48, borderRadius: 14, backgroundColor: color.white, borderWidth: 1, borderColor: color.blue, marginTop: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, outlineText: { color: color.blue, fontSize: 13, fontWeight: '800' }, status: { fontSize: 10, fontWeight: '800', color: color.blue, textTransform: 'capitalize', backgroundColor: '#eceeff', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 }, statusSuccess: { color: color.success, backgroundColor: '#e4f4ef' }, statusDanger: { color: color.danger, backgroundColor: '#f9ecea' }, errorText: { color: color.danger, fontSize: 12, lineHeight: 18, marginTop: 9 }, warning: { backgroundColor: '#fff5e8', borderRadius: 12, padding: 12, marginBottom: 12 }, warningText: { color: '#966724', fontSize: 11, lineHeight: 17 }, empty: { alignItems: 'center', justifyContent: 'center', padding: 26, backgroundColor: color.white, borderRadius: 18, gap: 5, marginBottom: 10 }, account: { marginTop: 18, borderTopWidth: 1, borderTopColor: color.line, paddingTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, accountAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, signOut: { color: color.blue, fontWeight: '800', fontSize: 12 }, nav: { minHeight: 69, paddingHorizontal: 7, flexDirection: 'row', justifyContent: 'space-around', backgroundColor: color.white, borderTopWidth: 1, borderTopColor: color.line }, navItem: { minWidth: 68, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 3, borderTopWidth: 3, borderTopColor: 'transparent' }, navSelected: { borderTopColor: color.blue }, navText: { fontSize: 10, fontWeight: '700', color: color.muted, textTransform: 'capitalize' }, navTextSelected: { color: color.blue }, login: { flex: 1, backgroundColor: color.paper, justifyContent: 'center', padding: 26 }, loginMark: { width: 58, height: 58, borderRadius: 17, backgroundColor: color.blue, alignItems: 'center', justifyContent: 'center' }, loginTitle: { color: color.ink, fontWeight: '900', fontSize: 32, letterSpacing: -1, marginTop: 22 }, loginCopy: { color: color.muted, fontSize: 14, lineHeight: 22, marginVertical: 14 }, loginNote: { color: color.muted, fontSize: 11, lineHeight: 17, marginTop: 20 }, input: { minHeight: 48, borderWidth: 1, borderColor: color.line, backgroundColor: color.white, borderRadius: 13, paddingHorizontal: 14, marginTop: 10, color: color.ink }, back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }, backText: { color: color.blue, fontWeight: '800', fontSize: 12 }, detailTitle: { color: color.ink, fontSize: 20, fontWeight: '800' },
});
