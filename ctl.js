/* Közös kamera-vezérlő panel (telefon + admin). S = állapot, send(ch) = változás küldése */
function expTime(c,fps,u){const mn=c.exposureTime.min,mx=Math.max(mn*1.01,Math.min(c.exposureTime.max,10000/fps));return mn*Math.pow(mx/mn,u)}
function isoVal(c,u){return c.iso.min+(c.iso.max-c.iso.min)*u}
function buildCtl(box,d,S,send){
  const c=d.c||{},fps=+((d.cfg&&d.cfg.fps)||30),W=[];
  box.innerHTML='';
  const mk=h=>{const x=document.createElement('div');x.innerHTML=h;box.append(x);return x};
  function sld(label,min,max,step,key,fmt,onuse,dimKey,dimVal){
    const x=mk('<label>'+label+' <b></b></label><input type="range" min="'+min+'" max="'+max+'" step="'+step+'">');
    const i=x.querySelector('input'),b=x.querySelector('b');let t=0;
    i.oninput=()=>{t=Date.now();b.textContent=fmt(+i.value);send(Object.assign({[key]:+i.value},onuse||{}))};
    W.push(()=>{const v=S[key];b.textContent=fmt(v);if(Date.now()-t>1500)i.value=v;if(dimKey)x.style.opacity=S[dimKey]===dimVal?1:.45});
  }
  function seg(label,key,opts){
    const x=mk('<label>'+label+'</label>');
    const bs=opts.map(([v,t])=>{const b=document.createElement('button');b.className='cb';b.textContent=t;b.onclick=()=>send({[key]:v});x.append(b);return[v,b]});
    W.push(()=>bs.forEach(([v,b])=>b.classList.toggle('on',S[key]===v)));
  }
  const z=c.zoom;
  if(z&&z.max>z.min)sld('Zoom',z.min,z.max,z.step||.1,'zoom',v=>(+v).toFixed(1)+'×');
  const ec=c.exposureCompensation,hasM=c.exposureMode&&c.exposureMode.includes('manual')&&c.exposureTime;
  if(hasM)seg('Fényerő (expozíció)','expMode',[['auto','Auto'],['manual','Kézi']]);
  if(ec&&ec.max>ec.min)sld('Fényerő korrekció (EV)',ec.min,ec.max,ec.step||.1,'ev',v=>(v>0?'+':'')+(+v).toFixed(1),{expMode:'auto'},'expMode','auto');
  if(hasM){
    sld('Zársebesség',0,1,.005,'exT',u=>'1/'+Math.round(1e4/expTime(c,fps,u)),{expMode:'manual'},'expMode','manual');
    if(c.iso&&c.iso.max>c.iso.min)sld('ISO',0,1,.005,'iso',u=>Math.round(isoVal(c,u)),{expMode:'manual'},'expMode','manual');
  }
  const k=c.colorTemperature;
  if(k&&c.whiteBalanceMode&&c.whiteBalanceMode.includes('manual')){
    seg('Fehéregyensúly','wbMode',[['auto','Auto'],['manual','Kézi']]);
    sld('Színhőmérséklet',k.min,k.max,k.step||100,'wbK',v=>Math.round(v)+' K',{wbMode:'manual'},'wbMode','manual');
  }
  if(c.focusMode&&c.focusMode.length){
    if(c.focusDistance){
      seg('Fókusz (koppints a képre a ponthoz)','fMode',[['auto','AF'],['manual','MF']]);
      sld('Fókusztáv: közel ↔ távol',0,1,.005,'fu',v=>Math.round(v*100)+'%',{fMode:'manual'},'fMode','manual');
      const x=mk('<label>Sima fókuszváltás</label>');
      const B=(t,fn)=>{const b=document.createElement('button');b.className='cb';b.textContent=t;b.onclick=fn;x.append(b);return b};
      const bA=B('A mentés',()=>send({act:'saveA'})),bB=B('B mentés',()=>send({act:'saveB'}));
      const b1=B('A → B',()=>send({act:'rackAB'})),b2=B('B → A',()=>send({act:'rackBA'}));
      const sel=document.createElement('select');sel.innerHTML='<option value="1">1 mp</option><option value="2">2 mp</option><option value="4">4 mp</option>';
      sel.onchange=()=>send({sec:+sel.value});x.append(sel);
      W.push(()=>{
        bA.classList.toggle('set',!!S.A);bB.classList.toggle('set',!!S.B);
        bA.textContent=S.A?'A ✓ mentve':'A mentés';bB.textContent=S.B?'B ✓ mentve':'B mentés';
        b1.style.opacity=b2.style.opacity=(S.A&&S.B)?1:.4;sel.value=String(S.sec);
      });
    }else seg('Fókusz (koppints a képre a ponthoz)','fMode',[['auto','AF']]);
  }else mk('<label>Ez a telefon böngészőből nem enged fókuszt állítani.</label>');
  return{sync:()=>W.forEach(f=>f())};
}
