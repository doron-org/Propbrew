import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, bootstrap, constructionBootstrap, hasSessionCookie, mutate, signIn, signOut, verifySecondFactor } from './src/api';
import { ConstructionApp } from './src/construction/ConstructionApp';
import { clearAllConstructionLocal, countAllConstructionCaptures, lastCachedConstruction, saveConstructionCache } from './src/construction/outbox';
import type { ConstructionBootstrap } from './src/construction/types';

type Screen = 'home'|'payments'|'visitors'|'requests'|'community'|'profile';
type Bootstrap = { profile:{firstName:string;activeUnitId:string};summary:{wallet:{minor:number;currency:string};pending:{minor:number;currency:string}[];openRequests:number};announcements:{id:string;title:string;body?:string}[];invoices:{id:string;ref:string;description:string;status:string;amount:{minor:number;currency:string};paid:{minor:number;currency:string}}[];requests:{id:string;ref:string;title:string;status:string}[] };
const blue='#315cff', ink='#090a0c', paper='#f3f3f1';
const ngn=(n:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(n/100);

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [construction, setConstruction] = useState<ConstructionBootstrap | null>(null);
  const [mode, setMode] = useState<'estate' | 'construction'>('construction');
  const [screen, setScreen] = useState<Screen>('home');
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [offlineCopy, setOfflineCopy] = useState(false);
  const [accessError, setAccessError] = useState('');

  const refresh = useCallback(async () => {
    const [estateResult, constructionResult] = await Promise.allSettled([bootstrap<Bootstrap>(), constructionBootstrap()]);
    const estateData = estateResult.status === 'fulfilled' ? estateResult.value : null;
    const constructionData = constructionResult.status === 'fulfilled' ? constructionResult.value : null;
    if (constructionData) {
      await saveConstructionCache(constructionData).catch(() => undefined);
      setConstruction(constructionData);
      setOfflineCopy(false);
    } else if (constructionResult.status === 'rejected' && constructionResult.reason instanceof ApiError && [401, 403].includes(constructionResult.reason.status)) setConstruction(null);
    if (estateData) setData(estateData);
    else if (estateResult.status === 'rejected' && estateResult.reason instanceof ApiError && [401, 403].includes(estateResult.reason.status)) setData(null);
    if (estateData || constructionData) {
      setAuthenticated(true); setAccessError('');
      setMode((current) => current === 'estate' && estateData ? 'estate' : constructionData ? 'construction' : 'estate');
    } else {
      const errors = [estateResult, constructionResult].filter((item): item is PromiseRejectedResult => item.status === 'rejected').map((item) => item.reason);
      const noConstructionNetwork = constructionResult.status === 'rejected' && !(constructionResult.reason instanceof ApiError);
      const cached = noConstructionNetwork && await hasSessionCookie() ? await lastCachedConstruction() : null;
      if (cached) { setConstruction(cached); setOfflineCopy(true); setAuthenticated(true); setMode('construction'); setAccessError(''); }
      else {
        setAuthenticated(false);
        setAccessError(errors.every((error) => error instanceof ApiError && error.status === 403)
          ? 'This account has no Estate resident or Construction field access. Ask your company administrator to assign a mobile role.' : '');
      }
    }
    setLoading(false);
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(timer); }, [refresh]);

  function exit() {
    void (async () => {
      const unsynced = await countAllConstructionCaptures();
      Alert.alert('Sign out of Propbrew?', unsynced
        ? `${unsynced} unsynced construction capture${unsynced === 1 ? '' : 's'} will be removed from this device. Sync them first if you need to keep them.`
        : 'Your private device copy will be removed.', [
        { text: 'Keep working', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { void (async () => {
          try { await signOut(); } catch {} finally {
            try { await clearAllConstructionLocal(); }
            finally { setConstruction(null); setData(null); setAuthenticated(false); setAccessError(''); }
          }
        })(); } },
      ]);
    })();
  }

  if (loading) return <SafeAreaView style={s.center}><ActivityIndicator color={blue} /></SafeAreaView>;
  if (!authenticated) return <Login onDone={refresh} error={accessError} />;
  if (mode === 'construction' && construction) return <ConstructionApp data={construction} cached={offlineCopy} onRefresh={refresh}
    onSwitch={data ? () => setMode('estate') : undefined} onSignOut={exit} />;
  if (!data) return <SafeAreaView style={s.center}><Text>No mobile workspace is assigned to this account.</Text></SafeAreaView>;
  return <SafeAreaView style={s.app}><StatusBar barStyle="dark-content" />
    <View style={s.workspaceBar}><Text style={s.workspaceName}>Estate</Text>{construction ? <Pressable accessibilityRole="button" style={s.workspaceAction} onPress={() => setMode('construction')}><Text style={s.workspaceActionText}>Construction field →</Text></Pressable> : null}<Pressable accessibilityRole="button" accessibilityLabel="Sign out" style={s.workspaceAction} onPress={exit}><Ionicons name="log-out-outline" size={20} color={blue} /></Pressable></View>
    <View style={s.body}>{screen === 'home' ? <Home data={data} go={setScreen} /> : screen === 'payments' ? <Payments data={data} back={() => setScreen('home')} refresh={refresh} /> : screen === 'requests' ? <Requests data={data} back={() => setScreen('home')} refresh={refresh} /> : <Simple title={screen.charAt(0).toUpperCase() + screen.slice(1)} back={() => setScreen('home')} />}</View>
    <View style={s.nav}>{([['home', 'home'], ['payments', 'receipt'], ['visitors', 'people'], ['community', 'chatbubble'], ['profile', 'person']] as const).map(([id, icon]) => <Pressable key={id} onPress={() => setScreen(id)} style={[s.navItem, screen === id && s.navActive]}><Ionicons name={icon} size={20} color={screen === id ? blue : '#fff'} /></Pressable>)}</View>
  </SafeAreaView>;
}
function Login({onDone,error}:{onDone():Promise<void>;error?:string}){
  const [e,setE]=useState(''), [p,setP]=useState(''), [code,setCode]=useState('');
  const [busy,setBusy]=useState(false), [secondFactor,setSecondFactor]=useState(false), [backup,setBackup]=useState(false);
  async function submit(){
    setBusy(true);
    try {
      if (secondFactor) { await verifySecondFactor(code.trim(),backup); await onDone(); }
      else { const result=await signIn(e.trim(),p); if(result.twoFactorRedirect){setSecondFactor(true);setCode('');} else await onDone(); }
    } catch(x) { Alert.alert(secondFactor?'Code not verified':'Could not sign in',x instanceof Error?x.message:'Try again.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={s.login}><View style={s.mark}><Ionicons name={secondFactor?'shield-checkmark':'business'} size={24} color="#fff"/></View>
    <Text style={s.loginTitle}>{secondFactor?'Verify it’s you.':'Welcome home.'}</Text>
    <Text style={s.sub}>{secondFactor?'Enter your authenticator or recovery code to finish signing in.':'Sign in with the same Propbrew company account you use on the web.'}</Text>
    {error ? <Text style={s.sub}>{error}</Text> : null}
    {secondFactor ? <><TextInput style={s.input} value={code} onChangeText={setCode} keyboardType={backup?'default':'number-pad'} autoCapitalize="none" autoCorrect={false} placeholder={backup?'Recovery code':'Six-digit code'} maxLength={backup?128:6} accessibilityLabel={backup?'Recovery code':'Authenticator code'} />
      <Pressable accessibilityRole="button" style={s.workspaceAction} onPress={()=>{setBackup(!backup);setCode('')}}><Text style={s.workspaceActionText}>{backup?'Use authenticator code':'Use recovery code'}</Text></Pressable></>
      : <><TextInput style={s.input} value={e} onChangeText={setE} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" accessibilityLabel="Email address"/><TextInput style={s.input} value={p} onChangeText={setP} secureTextEntry placeholder="Password" accessibilityLabel="Password"/></>}
    <Pressable accessibilityRole="button" style={[s.primary,busy&&{opacity:0.5}]} disabled={busy || (secondFactor && !code.trim())} onPress={()=>void submit()}><Text style={s.primaryText}>{busy?'Checking…':secondFactor?'Verify and continue':'Sign in securely'}</Text></Pressable>
    {secondFactor ? <Pressable accessibilityRole="button" style={s.workspaceAction} onPress={()=>{setSecondFactor(false);setCode('');setBackup(false)}}><Text style={s.workspaceActionText}>Back to sign in</Text></Pressable> : null}
  </SafeAreaView>;
}
function Home({data,go}:{data:Bootstrap;go(x:Screen):void}){const due=data.summary.pending.find(x=>x.currency==='NGN')?.minor??0;return <ScrollView style={s.home}><View style={s.top}><View style={s.row}><View style={s.avatar}><Text style={s.avatarText}>{data.profile.firstName.slice(0,2).toUpperCase()}</Text></View><View style={s.grow}><Text style={s.hello}>Hello, {data.profile.firstName}</Text><Text style={s.meta}>Your Propbrew home</Text></View><Circle icon="notifications"/></View><View style={s.search}><Ionicons name="search" size={18}/><Text style={s.meta}>Search your home</Text></View><View style={s.cards}><Pressable style={s.blueCard} onPress={()=>go('payments')}><Text style={s.cardValue}>{ngn(due)}</Text><Text style={s.cardCopy}>Outstanding dues</Text></Pressable><Pressable style={s.blueCard} onPress={()=>go('requests')}><Text style={s.cardValue}>{data.summary.openRequests}</Text><Text style={s.cardCopy}>Open requests</Text></Pressable></View></View><View style={s.dark}><Text style={s.section}>Announcements</Text>{data.announcements.slice(0,2).map(a=><View style={s.notice} key={a.id}><Text style={s.noticeTitle}>{a.title}</Text><Text style={s.noticeCopy}>{a.body??'Open the update for full details.'}</Text></View>)}<Text style={s.section}>Quick actions</Text><View style={s.quick}>{[['visitors','person-add','Add visitor'],['requests','construct','Report issue'],['payments','receipt','Pay dues'],['community','calendar','Book amenity']].map(([id,icon,label])=><Pressable key={id} style={s.quickCard} onPress={()=>go(id as Screen)}><Ionicons name={icon as never} size={21} color="#fff"/><Text style={s.quickText}>{label}</Text></Pressable>)}</View></View></ScrollView>}
function Payments({data,back,refresh}:{data:Bootstrap;back():void;refresh():void}){const due=data.summary.pending.find(x=>x.currency==='NGN')?.minor??0;return <ScrollView contentContainerStyle={s.page}><Header title="Payments" back={back}/><View style={s.payPanel}><Text style={s.dim}>Total pending</Text><Text style={s.payTotal}>{ngn(due)}</Text><Pressable style={s.primary} onPress={async()=>{const invoice=data.invoices.find(i=>i.status!=='paid');if(!invoice)return;try{await mutate({op:'invoice.pay',ref:invoice.ref});await refresh()}catch(x){Alert.alert('Payment not completed',x instanceof Error?x.message:'Try again.')}}}><Text style={s.primaryText}>Pay from wallet</Text></Pressable></View><Text style={s.sectionDark}>Charges</Text>{data.invoices.map(i=><View style={s.listRow} key={i.id}><Ionicons name="receipt" size={20} color={blue}/><View style={s.grow}><Text style={s.listTitle}>{i.description}</Text><Text style={s.meta}>{i.ref} · {i.status.replaceAll('_',' ')}</Text></View><Text style={s.listTitle}>{ngn(Math.max(0,i.amount.minor-i.paid.minor))}</Text></View>)}</ScrollView>}
function Requests({data,back,refresh}:{data:Bootstrap;back():void;refresh():void}){const[title,setTitle]=useState('');return <ScrollView contentContainerStyle={s.page}><Header title="Maintenance" back={back}/><View style={s.requestIntro}><Ionicons name="construct" size={28} color="#fff"/><Text style={s.requestTitle}>What needs attention?</Text><Text style={s.dim}>We’ll keep the issue, SLA and responsibility record together.</Text></View><TextInput style={s.input} placeholder="Describe the issue" value={title} onChangeText={setTitle}/><Pressable style={s.primary} onPress={async()=>{if(!title.trim())return;try{await mutate({op:'request.create',title});setTitle('');await refresh()}catch(x){Alert.alert('Request not sent',x instanceof Error?x.message:'Try again.')}}}><Text style={s.primaryText}>Send request</Text></Pressable>{data.requests.map(r=><View style={s.listRow} key={r.id}><Ionicons name="construct" size={20} color={blue}/><View><Text style={s.listTitle}>{r.title}</Text><Text style={s.meta}>{r.ref} · {r.status}</Text></View></View>)}</ScrollView>}
function Simple({title,back}:{title:string;back():void}){return <ScrollView contentContainerStyle={s.page}><Header title={title} back={back}/><View style={s.empty}><Ionicons name="sparkles" size={34} color={blue}/><Text style={s.loginTitle}>{title}</Text><Text style={s.sub}>This native surface is connected to the same tenant capability and data boundary as Propbrew web.</Text></View></ScrollView>}
function Header({title,back}:{title:string;back():void}){return <View style={s.header}><Pressable onPress={back}><Ionicons name="arrow-back" size={21}/></Pressable><Text style={s.headerTitle}>{title}</Text><View style={{width:21}}/></View>};function Circle({icon}:{icon:string}){return <View style={s.circle}><Ionicons name={icon as never} size={18}/></View>}
const s=StyleSheet.create({app:{flex:1,backgroundColor:paper},workspaceBar:{minHeight:48,paddingHorizontal:16,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:12},workspaceName:{flex:1,color:ink,fontSize:15,fontWeight:'800'},workspaceAction:{minHeight:44,justifyContent:'center',paddingHorizontal:6},workspaceActionText:{color:blue,fontSize:12,fontWeight:'700'},body:{flex:1},center:{flex:1,justifyContent:'center',alignItems:'center'},login:{flex:1,padding:28,justifyContent:'center',backgroundColor:paper},mark:{width:48,height:48,borderRadius:15,backgroundColor:blue,alignItems:'center',justifyContent:'center'},loginTitle:{fontSize:30,fontWeight:'800',letterSpacing:-1,marginTop:18},sub:{fontSize:14,color:'#6d7178',lineHeight:21,marginVertical:10},input:{backgroundColor:'#fff',borderRadius:16,padding:15,marginTop:10,borderWidth:1,borderColor:'#e2e2e2'},primary:{backgroundColor:blue,borderRadius:20,padding:16,alignItems:'center',marginTop:14},primaryText:{color:'#fff',fontWeight:'800'},home:{backgroundColor:ink},top:{backgroundColor:paper,padding:18,borderBottomLeftRadius:34,borderBottomRightRadius:34},row:{flexDirection:'row',alignItems:'center',gap:10},avatar:{width:46,height:46,borderRadius:23,backgroundColor:blue,alignItems:'center',justifyContent:'center'},avatarText:{color:'#fff',fontWeight:'800'},grow:{flex:1},hello:{fontSize:17,fontWeight:'800'},meta:{fontSize:11,color:'#777',marginTop:3},circle:{width:40,height:40,borderRadius:20,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},search:{height:46,borderRadius:23,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:15,marginVertical:16},cards:{flexDirection:'row',gap:9},blueCard:{flex:1,backgroundColor:blue,borderRadius:19,padding:14},cardValue:{color:'#fff',fontWeight:'800',fontSize:17},cardCopy:{color:'#fff',fontSize:11,marginTop:4},dark:{padding:18,paddingBottom:110},section:{color:'#fff',fontSize:18,fontWeight:'700',marginVertical:14},notice:{backgroundColor:'#1e2022',borderRadius:20,padding:15,marginBottom:9},noticeTitle:{color:'#fff',fontWeight:'700'},noticeCopy:{color:'#b7b9bd',fontSize:12,lineHeight:18,marginTop:8},quick:{flexDirection:'row',flexWrap:'wrap',gap:9},quickCard:{width:'48%',height:92,backgroundColor:'#1c1e20',borderRadius:20,padding:15},quickText:{color:'#fff',fontSize:11,marginTop:11},nav:{position:'absolute',bottom:22,left:48,right:48,backgroundColor:'#858789ee',borderRadius:34,padding:7,flexDirection:'row',justifyContent:'space-between'},navItem:{width:48,height:48,borderRadius:24,alignItems:'center',justifyContent:'center',backgroundColor:'#6668'},navActive:{backgroundColor:ink},page:{padding:18,paddingBottom:110,backgroundColor:paper,minHeight:'100%'},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},headerTitle:{fontSize:17,fontWeight:'800'},payPanel:{backgroundColor:'#1c1e20',borderRadius:30,padding:23,marginTop:8},dim:{color:'#aeb0b5',fontSize:12},payTotal:{color:'#fff',fontSize:42,fontWeight:'800',marginVertical:12},sectionDark:{fontSize:18,fontWeight:'700',marginVertical:18},listRow:{backgroundColor:'#fff',borderRadius:18,padding:14,marginBottom:9,flexDirection:'row',alignItems:'center',gap:12},listTitle:{fontWeight:'700',fontSize:12},requestIntro:{backgroundColor:ink,borderRadius:28,padding:24,alignItems:'center',marginBottom:10},requestTitle:{color:'#fff',fontWeight:'800',fontSize:24,marginVertical:10},empty:{alignItems:'center',paddingVertical:100}});
