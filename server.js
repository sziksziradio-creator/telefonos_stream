// Vezérlő szerver: kamerák (telefonok) <-> admin oldal, tally vMix-ből és OBS-ből
const http=require('http'),net=require('net'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=+process.env.PORT||3000,PIN=process.env.ADMIN_PIN||'1234';
const VMIX=process.env.VMIX_HOST||'',OBS=process.env.OBS_URL||'',OBSPW=process.env.OBS_PASSWORD||'';
const cams=new Map(),admins=new Set(),state={vmix:false,obs:false},src={vmix:[],obs:[]};
const rank={off:0,preview:1,live:2};
const send=(ws,o)=>{try{ws.readyState===1&&ws.send(JSON.stringify(o))}catch(e){}};

function tallyFor(name){
  const n=name.toLowerCase();let r='off';
  for(const l of [src.vmix,src.obs])for(const e of l)if(e.t.toLowerCase().includes(n)&&rank[e.s]>rank[r])r=e.s;
  return r;
}
const list=()=>[...cams].map(([name,c])=>({name,tally:c.tally,status:c.status,caps:c.caps,state:c.state}));
let pt=null;
function pushList(){
  if(pt)return;
  pt=setTimeout(()=>{pt=null;const m=JSON.stringify({type:'cams',cams:list(),srcs:{vmix:state.vmix,obs:state.obs,vmixOn:!!VMIX,obsOn:!!OBS}});admins.forEach(a=>a.readyState===1&&a.send(m))},100);
}
function refresh(){
  let ch=false;
  for(const [n,c] of cams){const t=tallyFor(n);if(t!==c.tally){c.tally=t;ch=true;send(c.ws,{type:'tally',state:t})}}
  pushList();
}

/* ---------- vMix (TCP API, 8099) ---------- */
function vmix(){
  if(!VMIX)return;
  let buf=Buffer.alloc(0),titles={},lastTally='',s;
  const attrs=t=>{const o={};for(const m of t.matchAll(/(\w+)="([^"]*)"/g))o[m[1]]=m[2];return o};
  const apply=()=>{
    const l=[];
    [...lastTally].forEach((d,i)=>{const t=titles[i+1];if(t&&d!=='0')l.push({t,s:d==='1'?'live':'preview'})});
    src.vmix=l;refresh();
  };
  const parse=()=>{
    for(;;){
      const i=buf.indexOf('\r\n');if(i<0)return;
      const line=buf.slice(0,i).toString();
      const m=line.match(/^XML (\d+)/);
      if(m){
        const n=+m[1];if(buf.length<i+2+n)return;
        const xml=buf.slice(i+2,i+2+n).toString();buf=buf.slice(i+2+n);
        titles={};for(const t of xml.matchAll(/<input\b[^>]*>/g)){const a=attrs(t[0]);if(a.number)titles[+a.number]=a.title||a.shortTitle||''}
        apply();continue;
      }
      buf=buf.slice(i+2);
      if(line.startsWith('TALLY OK ')){lastTally=line.slice(9).trim();apply()}
    }
  };
  const connect=()=>{
    s=net.connect(8099,VMIX);
    s.on('connect',()=>{state.vmix=true;s.write('SUBSCRIBE TALLY\r\nXML\r\n');pushList()});
    s.on('data',d=>{buf=Buffer.concat([buf,d]);parse()});
    s.on('error',()=>{});
    s.on('close',()=>{state.vmix=false;src.vmix=[];buf=Buffer.alloc(0);refresh();setTimeout(connect,3000)});
  };
  connect();
  setInterval(()=>{if(state.vmix)s.write('XML\r\n')},10000); // átnevezések követése
}

/* ---------- OBS (obs-websocket v5, 4455) ---------- */
function obs(){
  if(!OBS)return;
  let ws,id=0;const pend=new Map();
  const sh=x=>crypto.createHash('sha256').update(x).digest('base64');
  const req=(t,d)=>new Promise((res,rej)=>{
    const i=String(++id);pend.set(i,{res,rej});
    ws.send(JSON.stringify({op:6,d:{requestType:t,requestId:i,requestData:d||{}}}));
    setTimeout(()=>{if(pend.delete(i))rej(new Error('timeout'))},3000);
  });
  async function items(scene,group,depth){
    const out=[scene];
    const r=await req(group?'GetGroupSceneItemList':'GetSceneItemList',{sceneName:scene}).catch(()=>null);
    if(!r)return out;
    for(const it of r.responseData.sceneItems){
      if(!it.sceneItemEnabled)continue;
      out.push(it.sourceName);
      if(depth<3&&(it.isGroup||it.sourceType==='OBS_SOURCE_TYPE_SCENE'))out.push(...await items(it.sourceName,it.isGroup,depth+1));
    }
    return out;
  }
  async function recompute(){
    try{
      const l=[];
      const p=(await req('GetCurrentProgramScene')).responseData;
      (await items(p.currentProgramSceneName||p.sceneName,false,0)).forEach(t=>l.push({t,s:'live'}));
      try{const v=(await req('GetCurrentPreviewScene')).responseData;(await items(v.currentPreviewSceneName||v.sceneName,false,0)).forEach(t=>l.push({t,s:'preview'}))}catch(e){}
      src.obs=l;refresh();
    }catch(e){}
  }
  const connect=()=>{
    ws=new WebSocket(OBS);
    ws.on('message',d=>{
      let m;try{m=JSON.parse(d)}catch(e){return}
      if(m.op===0){
        const o={rpcVersion:1,eventSubscriptions:4|128},a=m.d.authentication;
        if(a)o.authentication=sh(sh(OBSPW+a.salt)+a.challenge);
        ws.send(JSON.stringify({op:1,d:o}));
      }else if(m.op===2){state.obs=true;pushList();recompute()}
      else if(m.op===5){if(['CurrentProgramSceneChanged','CurrentPreviewSceneChanged','SceneItemEnableStateChanged'].includes(m.d.eventType))recompute()}
      else if(m.op===7){const p=pend.get(m.d.requestId);if(p){pend.delete(m.d.requestId);m.d.requestStatus.result?p.res(m.d):p.rej(new Error('req'))}}
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{state.obs=false;src.obs=[];refresh();setTimeout(connect,3000)});
  };
  connect();
}

/* ---------- WebSocket ---------- */
const server=http.createServer((q,r)=>r.end('ok'));
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws,req)=>{
  ws.alive=true;ws.on('pong',()=>ws.alive=true);
  const u=new URL(req.url,'http://x'),role=u.searchParams.get('role');
  if(role==='admin'){
    if(u.searchParams.get('pin')!==PIN){ws.close(4001,'pin');return}
    admins.add(ws);pushList();
    ws.on('message',d=>{let m;try{m=JSON.parse(d)}catch(e){return}
      if(m.type==='cmd'){const c=cams.get(m.to);c&&send(c.ws,{type:'cmd',...m.cmd})}});
    ws.on('close',()=>admins.delete(ws));
    return;
  }
  let name=null;
  ws.on('message',d=>{
    let m;try{m=JSON.parse(d)}catch(e){return}
    if(m.type==='hello'){
      const n=String(m.name||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,32);if(!n)return;
      if(name&&name!==n&&cams.get(name)&&cams.get(name).ws===ws)cams.delete(name);
      const old=cams.get(n);if(old&&old.ws!==ws)try{old.ws.close(4000,'replaced')}catch(e){}
      name=n;const c={ws,status:{},caps:null,tally:tallyFor(n)};cams.set(n,c);
      send(ws,{type:'tally',state:c.tally});pushList();
    }else{
      const c=name&&cams.get(name);if(!c||c.ws!==ws)return;
      if(m.type==='status')c.status=m.data;else if(m.type==='caps')c.caps=m.data;else if(m.type==='state')c.state=m.data;
      pushList();
    }
  });
  ws.on('close',()=>{const c=name&&cams.get(name);if(c&&c.ws===ws){cams.delete(name);pushList()}});
});
setInterval(()=>wss.clients.forEach(w=>{if(!w.alive)return w.terminate();w.alive=false;w.ping()}),15000);
server.listen(PORT,()=>console.log('control szerver: '+PORT,'vMix:',VMIX||'-','OBS:',OBS||'-'));
vmix();obs();
