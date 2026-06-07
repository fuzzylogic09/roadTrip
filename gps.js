/* ===================================================
   GPS
=================================================== */
function startGPS(){ if(!('geolocation'in navigator)){ toast('Geolocation not supported','err'); return; } S.watchId=navigator.geolocation.watchPosition(pos=>setGPos(L.latLng(pos.coords.latitude,pos.coords.longitude)),err=>toast('GPS: '+err.message,'err'),{enableHighAccuracy:true,maximumAge:4000,timeout:15000}); S.gps=true; qs('#gdot').classList.add('on'); qs('#glbl').textContent='GPS active'; qs('#btn-gon').disabled=true; qs('#btn-goff').disabled=false; qs('#gbadge').classList.add('on'); toast('GPS started','ok'); }
function stopGPS(){ if(S.watchId) navigator.geolocation.clearWatch(S.watchId); if(S.gpsMk){ map.removeLayer(S.gpsMk); S.gpsMk=null; } clearLines(); S.gps=false; S.gposLL=null; qs('#gdot').classList.remove('on'); qs('#glbl').textContent='GPS inactive'; qs('#gsub').textContent='Enable to track location'; qs('#btn-gon').disabled=false; qs('#btn-goff').disabled=true; qs('#gbadge').classList.remove('on'); renderNearby(); }
function setGPos(ll){ S.gposLL=ll; if(!S.gpsMk) S.gpsMk=L.marker(ll,{icon:mkGps(),zIndexOffset:1000}).addTo(map); else S.gpsMk.setLatLng(ll); qs('#gsub').textContent=ll.lat.toFixed(5)+', '+ll.lng.toFixed(5); qs('#gbt').textContent=ll.lat.toFixed(4)+', '+ll.lng.toFixed(4); renderNearby(); if(S.drawLines) updateLines(); }
function togglePoiLines(){ S.drawLines=!S.drawLines; const t=qs('#tog-lines'); if(t) t.classList.toggle('on',S.drawLines); if(!S.drawLines) clearLines(); else if(S.gposLL) updateLines(); else toast('Start GPS first',''); }
function clearLines(){ S.poiLines.forEach(l=>map.removeLayer(l)); S.poiLines=[]; }
function updateLines(){ clearLines(); if(!S.gposLL||!S.drawLines) return; S.pois.forEach(p=>{ const dist=S.gposLL.distanceTo(L.latLng(p.lat,p.lng)); if(dist>50000) return; const color=dist<5000?'#15803d':dist<20000?'#d4920a':'#c81e1e'; const opacity=Math.max(0.25,1-(dist/50000)*0.7); const line=L.polyline([[S.gposLL.lat,S.gposLL.lng],[p.lat,p.lng]],{color,weight:1.5,opacity,dashArray:'5 4'}).addTo(map); const km=(dist/1000).toFixed(dist<1000?0:1); const lbl=L.marker([(S.gposLL.lat+p.lat)/2,(S.gposLL.lng+p.lng)/2],{icon:L.divIcon({className:'',html:'<div style="background:rgba(255,255,255,.85);border:1px solid '+color+';border-radius:4px;padding:1px 4px;font-size:.56rem;font-weight:700;color:'+color+';white-space:nowrap;">'+km+'km</div>',iconSize:[null,null],iconAnchor:[0,0]})}).addTo(map); S.poiLines.push(line,lbl); }); }
function renderNearby(){ const el=qs('#nearby'); if(!S.gposLL||!S.pois.length){ el.innerHTML='<div style="font-size:.72rem;color:var(--muted);">Start GPS to see nearby POIs.</div>'; return; } const sorted=S.pois.map(p=>({p,dist:S.gposLL.distanceTo(L.latLng(p.lat,p.lng))})).sort((a,b)=>a.dist-b.dist).slice(0,10); el.innerHTML=sorted.map(({p,dist},i)=>{ const d=dist<1000?Math.round(dist)+' m':(dist/1000).toFixed(1)+' km'; return'<div class="nri"><div class="nrr '+(dist<2000?'cl':'')+'">'+( i+1)+'</div><div style="flex:1;"><div style="font-size:.76rem;font-weight:700;">'+(CATS[p.cat]||'📍')+' '+esc(p.name)+'</div><div style="font-size:.62rem;color:var(--acc2);font-weight:700;">'+d+'</div></div><button class="btn bg bic bsm" onclick="focusPOI('+p.id+')">👁</button></div>'; }).join(''); }

/* ===== SEARCH ===== */
const PC2={};
async function fetchPhotos(name,ll){ const k=name+'|'+ll.lat.toFixed(3)+'|'+ll.lng.toFixed(3); if(PC[k]!==undefined) return PC[k]; PC[k]=[]; try{ const r=await fetch('https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord='+ll.lat+'%7C'+ll.lng+'&gsradius=500&gslimit=3&format=json&origin=*'); const d=await r.json(); const pages=(d.query&&d.query.geosearch)||[]; const imgs=[]; for(const pg of pages.slice(0,2)){ const ir=await fetch('https://en.wikipedia.org/w/api.php?action=query&pageids='+pg.pageid+'&prop=pageimages&pithumbsize=200&format=json&origin=*'); const id2=await ir.json(); const p2=id2.query&&id2.query.pages&&id2.query.pages[pg.pageid]; if(p2&&p2.thumbnail) imgs.push(p2.thumbnail.source); } PC[k]=imgs.slice(0,3); }catch(e){ PC[k]=[]; } return PC[k]; }
function ph(arr,cls){ return arr.map(u=>'<img class="'+cls+'" src="'+u+'" loading="lazy" onerror="this.style.display=\'none\'">').join(''); }

let srchT;
function doSearch(q){ clearTimeout(srchT); const el=qs('#srdr'); if(!q.trim()){ el.style.display='none'; return; } srchT=setTimeout(async()=>{ try{ const r=await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&format=json&limit=5',{headers:{'Accept-Language':'en'}}); const d=await r.json(); if(!d.length){ el.style.display='none'; return; } el.style.display='block'; el.innerHTML=''; d.forEach(x=>{ const div=document.createElement('div'); div.className='sri'; div.innerHTML='<b>'+esc(x.display_name.split(',')[0])+'</b><span>'+esc(x.display_name.split(',').slice(1,3).join(',').trim())+'</span>'; div.addEventListener('click',()=>pickSR(x.lat,x.lon,x.display_name.split(',')[0])); div.addEventListener('mouseenter',()=>{ if(div.querySelector('.poi-photos')) return; fetchPhotos(x.display_name.split(',')[0],L.latLng(+x.lat,+x.lon)).then(imgs=>{ if(imgs.length){ const phEl=document.createElement('div'); phEl.className='poi-photos'; phEl.style.marginTop='4px'; phEl.innerHTML=ph(imgs.slice(0,2),'poi-photo'); div.appendChild(phEl); } }); },{once:true}); el.appendChild(div); }); }catch(e){} },400); }
function pickSR(lat,lon,name){ qs('#srdr').style.display='none'; qs('#psrch').value=name; S.pendLL=L.latLng(+lat,+lon); hideForMap(); map.flyTo([lat,lon],15,{duration:.8}); openModal(S.pendLL,name); }

/* ===================================================
   MODAL
=================================================== */
function refMDay(){ const o='<option value="">— Not assigned —</option>'+S.days.map(d=>'<option value="'+d.id+'">'+esc(d.title)+(d.date?' ('+d.date+')':'')+'</option>').join(''); const mdEl=qs('#m-day'); if(mdEl) mdEl.innerHTML=o; }
function renderMDayCheckboxes(selectedIds){
  const el=qs('#m-days-list'); if(!el) return;
  if(!S.days.length){ el.innerHTML=''; updateDayBadges(); return; }
  el.innerHTML=S.days.map((d,di)=>{
    const checked=selectedIds.includes(d.id)?'checked':'';
    const c=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    return'<label class="mday-row" style="display:none;"><input type="checkbox" value="'+d.id+'" '+checked+' onchange="updateCostTypeUI();updateDayBadges()"></label>';
  }).join('');
  updateCostTypeUI(); updateDayBadges();
}
function getSelectedDayIds(){ return qsa('#m-days-list input[type=checkbox]:checked').map(cb=>Number(cb.value)); }

// Cost type toggle
function setCostType(type){
  S.costType = type;
  qs('#ctt-total').classList.toggle('on', type==='total');
  qs('#ctt-perday').classList.toggle('on', type==='perday');
  updateCostTypeUI();
}
function updateCostTypeUI(){
  const cnt = getSelectedDayIds().length;
  const daySpan = qs('#ctt-days-count'); if(daySpan) daySpan.textContent = cnt||1;
  const cost = parseFloat(qs('#m-cost').value)||0;
  const computed = qs('#ctt-computed');
  if(!computed) return;
  if(S.costType==='perday' && cnt>1){
    computed.textContent = '= $'+(cost*cnt).toFixed(2)+' total ('+cnt+' days)';
  } else { computed.textContent=''; }
}

function openModal(ll,name){
  S.pendLL=ll;
  if(!S.editing){
    qs('#m-name').value=name||''; qs('#m-desc').value=''; qs('#m-cat').value='general';
    qs('#m-cost').value='';
    selCol('#c94f14'); qs('#m-hd').textContent='New POI'; qs('#m-ico').textContent='📍';
    setCostType('total'); renderMDayCheckboxes([]);
    const propRow=qs('#m-propagate-row'); if(propRow) propRow.style.display='none';
    const propCb=qs('#m-propagate'); if(propCb) propCb.checked=true;
  }
  refMDay();
  qs('#mbk').classList.add('on'); setTimeout(()=>qs('#m-name').focus(),80);
}
function closeModal(){ qs('#mbk').classList.remove('on'); S.editing=null; restoreDrawer(); }
function selCol(c){
  S.col=c;
  qsa('.csw').forEach(s=>s.classList.toggle('on',s.dataset.c===c));
  const h=qs('#m-color-hint'); if(h) h.textContent='(custom)';
  const prev=qs('#m-color-preview'); if(prev) prev.style.background=c;
}
function selColAuto(){
  qsa('.csw[data-c]').forEach(s=>s.classList.remove('on'));
  const h=qs('#m-color-hint'); if(h) h.textContent='(auto from day)';
  const prev=qs('#m-color-preview'); if(prev) prev.style.background='var(--border2)';
}

const FORM_COLORS=['#c94f14','#1d56d4','#15803d','#d4920a','#7c22d4','#c81e1e','#0e7eb5','#b01e6a','#e91e8c','#00796b'];
function openFormColorPicker(){
  const m=qs('#form-cpick-modal'); if(!m) return;
  qs('#form-cpick-swatches').innerHTML=FORM_COLORS.map(c=>'<div class="cpick-swatch'+(S.col===c?' cpick-on':'')+'" style="background:'+c+';" onclick="applyFormColor(\''+c+'\')"></div>').join('');
  qs('#form-cpick-hex').value='';
  m.style.display='flex';
}
function applyFormColor(c){ selCol(c); qs('#form-cpick-hex').value=c; qs('#form-cpick-swatches').querySelectorAll('.cpick-swatch').forEach(s=>s.classList.toggle('cpick-on',s.style.background===c||s.style.backgroundColor===c)); }
function closeFormColorPicker(){ const m=qs('#form-cpick-modal'); if(m) m.style.display='none'; }

function updateDayBadges(){
  const badges=qs('#m-days-badges'); if(!badges) return;
  const ids=getSelectedDayIds();
  if(!ids.length){ badges.innerHTML='<span style="font-size:.63rem;color:var(--muted);">No day assigned</span>'; return; }
  badges.innerHTML=ids.map(id=>{ const d=S.days.find(x=>x.id===id); if(!d) return''; const di=S.days.indexOf(d); const c=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length]; return'<span style="background:'+c+';color:#fff;border-radius:8px;padding:1px 7px;font-size:.6rem;font-weight:700;">'+esc(d.title)+'</span>'; }).join('');
}
function openFormDaysModal(){
  const m=qs('#form-days-modal'); if(!m) return;
  const selectedIds=getSelectedDayIds();
  qs('#form-days-list').innerHTML=S.days.map((d,di)=>{
    const checked=selectedIds.includes(d.id)?'checked':'';
    const c=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const fd=fmtDate(d.date);
    return'<label class="dayassign-row">'
      +'<input type="checkbox" value="'+d.id+'" '+checked+' style="accent-color:'+c+';cursor:pointer;width:16px;height:16px;" onchange="syncFormDay('+d.id+',this.checked)">'
      +'<span class="dayassign-dot" style="background:'+c+';"></span>'
      +'<span class="dayassign-name">'+esc(d.title)+(fd?' <span style="color:var(--muted2);font-size:.6rem;">'+fd+'</span>':'')+'</span>'
      +'</label>';
  }).join('');
  m.style.display='flex';
}
function syncFormDay(dayId, checked){
  const cb=qs('#m-days-list input[type=checkbox][value="'+dayId+'"]'); if(cb) cb.checked=checked;
  updateCostTypeUI(); updateDayBadges();
}
function closeFormDaysModal(){ const m=qs('#form-days-modal'); if(m) m.style.display='none'; updateDayBadges(); }
function selRtColAuto(){ qsa('.csw[data-rc]').forEach(s=>s.classList.remove('on')); }
function selRtCol2Auto(){ qsa('.csw[data-rc2]').forEach(s=>s.classList.remove('on')); }
function renderLinks(links){ const el=qs('#m-links'); el.innerHTML=''; (links.length?links:[{label:'',url:''}]).forEach(lk=>{ const row=document.createElement('div'); row.className='lrow'; row.innerHTML='<input class="inp" style="width:76px;flex-shrink:0;" placeholder="Label" value="'+(lk.label||'')+'"><input class="inp" style="flex:1;" placeholder="https://..." value="'+(lk.url||'')+'"><button class="btn br bic bsm" onclick="this.parentNode.remove()">✕</button>'; el.appendChild(row); }); }
function getLinks(){ return qsa('.lrow').map(row=>{ const i=row.querySelectorAll('input'); return{label:i[0].value.trim(),url:i[1].value.trim()}; }).filter(l=>l.url); }

/* ===== GOOGLE DRIVE ===== */
let gdTC=null;
function gdInit(){ if(GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID')) return; try{ gdTC=google.accounts.oauth2.initTokenClient({client_id:GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',callback:async r=>{ if(r.error){ toast('Sign-in failed','err'); return; } S.gd.token=r.access_token; await gdFetchUser(); gdShowIn(); toast('Signed in!','ok'); }}); }catch(e){} }
function gdSignIn(){ if(GOOGLE_CLIENT_ID.includes('YOUR_CLIENT_ID')){ toast('Add your Google Client ID in config','err'); return; } if(!gdTC){ toast('Google script not ready','err'); return; } gdTC.requestAccessToken(); }
async function gdFetchUser(){ try{ const r=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:'Bearer '+S.gd.token}}); S.gd.user=await r.json(); }catch(e){} }
function gdShowIn(){ const u=S.gd.user||{}; qs('#gd-out').style.display='none'; qs('#gd-in').style.display='block'; qs('#gd-name').textContent=u.name||''; qs('#gd-email').textContent=u.email||''; const av=qs('#gd-av'); av.innerHTML=u.picture?'<img src="'+u.picture+'" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\'">':(u.name||'?')[0].toUpperCase(); }
function gdSignOut(){ S.gd={token:null,user:null,folderId:null}; qs('#gd-out').style.display='block'; qs('#gd-in').style.display='none'; toast('Signed out','ok'); }
async function gdFolder(){ if(S.gd.folderId) return S.gd.folderId; const qr=await fetch("https://www.googleapis.com/drive/v3/files?q=name='"+DRIVE_FOLDER+"' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)",{headers:{Authorization:'Bearer '+S.gd.token}}); const qd=await qr.json(); if(qd.files&&qd.files.length){ S.gd.folderId=qd.files[0].id; return S.gd.folderId; } const cr=await fetch('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{Authorization:'Bearer '+S.gd.token,'Content-Type':'application/json'},body:JSON.stringify({name:DRIVE_FOLDER,mimeType:'application/vnd.google-apps.folder'})}); const cd=await cr.json(); S.gd.folderId=cd.id; return S.gd.folderId; }
async function gdSave(){ if(!S.gd.token){ toast('Sign in to Google first','err'); return; } toast('Saving...',''); try{ const fid=await gdFolder(); const name=qs('#tname').value.replace(/\s+/g,'_')+'.json'; const content=JSON.stringify(tripData(),null,2); const qr=await fetch("https://www.googleapis.com/drive/v3/files?q=name='"+name+"' and '"+fid+"' in parents and trashed=false&fields=files(id)",{headers:{Authorization:'Bearer '+S.gd.token}}); const qd=await qr.json(); let resp; if(qd.files&&qd.files.length){ resp=await fetch('https://www.googleapis.com/upload/drive/v3/files/'+qd.files[0].id+'?uploadType=media',{method:'PATCH',headers:{Authorization:'Bearer '+S.gd.token,'Content-Type':'application/json'},body:content}); }else{ const b2='rtp_b'; const body='--'+b2+'\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify({name,parents:[fid]})+'\r\n--'+b2+'\r\nContent-Type: application/json\r\n\r\n'+content+'\r\n--'+b2+'--'; resp=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',{method:'POST',headers:{Authorization:'Bearer '+S.gd.token,'Content-Type':'multipart/related; boundary='+b2},body}); } if(resp.ok) toast('Saved → '+DRIVE_FOLDER+'/'+name,'ok'); else toast('Drive save failed','err'); }catch(e){ toast('Drive error: '+e.message,'err'); } }
async function gdList(){ if(!S.gd.token){ toast('Sign in first','err'); return; } const el=qs('#gd-files'); el.innerHTML='<div style="font-size:.68rem;color:var(--muted);">Loading...</div>'; try{ const fid=await gdFolder(); const r=await fetch("https://www.googleapis.com/drive/v3/files?q='"+fid+"' in parents and trashed=false&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc",{headers:{Authorization:'Bearer '+S.gd.token}}); const d=await r.json(); if(!d.files||!d.files.length){ el.innerHTML='<div style="font-size:.68rem;color:var(--muted);">No saved trips yet.</div>'; return; } el.innerHTML=d.files.map(f=>'<div class="gdrive-file" onclick="gdLoad(\''+f.id+'\',\''+esc(f.name)+'\')">🗺️ <span class="gdrive-file-name">'+esc(f.name)+'</span><span class="gdrive-file-date">'+new Date(f.modifiedTime).toLocaleDateString()+'</span></div>').join(''); }catch(e){ el.innerHTML='<div style="font-size:.68rem;color:var(--red);">Failed.</div>'; } }
async function gdLoad(fid,name){ toast('Loading...',''); try{ const r=await fetch('https://www.googleapis.com/drive/v3/files/'+fid+'?alt=media',{headers:{Authorization:'Bearer '+S.gd.token}}); loadData(await r.text()); toast('Loaded: '+name,'ok'); }catch(e){ toast('Load failed','err'); } }

/* ===== SAVE / LOAD ===== */
function tripData(){
  const fp=getFP();
  return{appVersion:APP_VERSION,savedAt:new Date().toISOString(),tripName:qs('#tname').value,
    fuelSettings:{consump:fp.c,price:fp.p},
    settings:Object.assign({},CFG),
    eatingDefault:S.eatingDefault,
    eatingBudgets:Object.assign({},S.eatingBudgets),
    dayVisibility:Object.assign({},S.dayVisibility),
    poiVisibility:Object.assign({},S.poiVisibility),
    allPOIsHidden:S.allPOIsHidden||false,
    pois:S.pois.map(p=>({id:p.id,name:p.name,desc:p.desc,cat:p.cat,color:p.color,rating:p.rating,links:p.links,tags:p.tags,lat:p.lat,lng:p.lng,locked:p.locked,dayIds:p.dayIds||[],cost:p.cost||0,costType:p.costType||'total',propagateAccom:p.propagateAccom!==false,colorLocked:p.colorLocked||false})),
    routes:S.routes.map(r=>({id:r.id,fromId:r.fromId,toId:r.toId,fromName:r.fromName,toName:r.toName,mode:r.mode,dist:r.dist,dur:r.dur,dayId:r.dayId,fixedCost:r.fixedCost||0,color:r.color||'#1d56d4',colorLocked:r.colorLocked||false})),
    days:S.days.map(d=>({id:d.id,title:d.title,date:d.date||'',color:d.color||'',items:d.items.map(i=>Object.assign({},i))}))};
}
function saveTrip(){ const data=tripData(); const b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=data.tripName.replace(/\s+/g,'_')+'_v'+APP_VERSION+'.json'; a.click(); toast('Saved!','ok'); }
async function loadData(json){
  try{
    const d=JSON.parse(json); clearAll(true);
    qs('#tname').value=d.tripName||d.name||'';
    if(d.fuelSettings){ if(d.fuelSettings.consump) qs('#f-consump').value=d.fuelSettings.consump; if(d.fuelSettings.price) qs('#f-price').value=d.fuelSettings.price; }
    // Restore settings — don't overwrite fontScale if it differs, respect user's device preference
    if(d.settings){ Object.assign(CFG, d.settings); saveCFG(); applySettings(); }
    S.eatingDefault = +(d.eatingDefault||0);
    if(d.eatingBudgets) Object.assign(S.eatingBudgets, d.eatingBudgets);
    if(d.dayVisibility) Object.assign(S.dayVisibility, d.dayVisibility);
    if(d.poiVisibility) Object.assign(S.poiVisibility, d.poiVisibility);
    S.allPOIsHidden = !!d.allPOIsHidden;
    (d.days||[]).forEach(day=>S.days.push({id:Number(day.id),title:day.title,date:day.date||'',color:day.color||'',items:(day.items||[]).map(i=>Object.assign({},i))}));
    (d.pois||[]).forEach(p=>{ const dayIds=p.dayIds||(p.dayId?[Number(p.dayId)]:[]); addPOI({lat:p.lat,lng:p.lng},{id:Number(p.id),name:p.name,desc:p.desc,cat:p.cat,color:p.color,rating:p.rating,links:p.links,tags:p.tags,locked:p.locked,dayIds:dayIds.map(Number),cost:+(p.cost||0),costType:p.costType||'total',propagateAccom:p.propagateAccom!==false,colorLocked:p.colorLocked||false}); });
    fillRS('rf','rt','rd');
    const routes=d.routes||[];
    if(routes.length){ toast('Recalculating '+routes.length+' route(s)…','');
      for(const r of routes){ const savedCol=r.color||'#1d56d4'; const cl=r.colorLocked||false; S.rtCol=savedCol;
        if(r.mode==='manual'){ const from=S.pois.find(p=>p.id===Number(r.fromId)),to=S.pois.find(p=>p.id===Number(r.toId)); if(from&&to){ const coords=[[from.lat,from.lng],[to.lat,to.lng]]; const poly=L.polyline(coords,{color:savedCol,weight:3,opacity:.8,dashArray:'10 6'}).addTo(map); const rt=Object.assign({},r,{id:Number(r.id),fromId:Number(r.fromId),toId:Number(r.toId),dayId:r.dayId?Number(r.dayId):null,fixedCost:+(r.fixedCost||0),color:savedCol,colorLocked:cl,coords,poly,hourDotMarkers:[]}); S.routes.push(rt); bindRouteHover(rt); placeHourDots(rt); if(rt.poly) rt.poly.setStyle({color:getRouteColor(rt)}); } }
        else{ await calcRoute(Number(r.fromId),Number(r.toId),r.mode,r.dayId?Number(r.dayId):null,Number(r.id),+(r.fixedCost||0),null,cl); const rt=S.routes.find(x=>x.id===Number(r.id)); if(rt){ rt.color=savedCol; rt.colorLocked=cl; if(rt.poly) rt.poly.setStyle({color:getRouteColor(rt)}); placeHourDots(rt); } } }
    }
    ra();
    if(S.pois.length) map.fitBounds(L.latLngBounds(S.pois.map(p=>[p.lat,p.lng])),{padding:[50,50]});
    toast('Loaded (v'+(d.appVersion||'?')+', '+(d.savedAt?new Date(d.savedAt).toLocaleDateString():'?')+')','ok');
  }catch(e){ toast('Invalid JSON','err'); console.error(e); }
}
function clearAll(s){
  S.pois.forEach(p=>map.removeLayer(p.marker));
  S.routes.forEach(r=>{ if(r.poly) map.removeLayer(r.poly); clearRouteHourDots(r); });
  clearLines(); poiLabelLayer.clearLayers();
  S.dayOrderLines.forEach(l=>map.removeLayer(l)); S.dayOrderLines=[];
  S.pois.length=0; S.routes.length=0; S.days.length=0;
  S.eatingBudgets={}; S.eatingDefault=0; S.dayVisibility={}; S.poiVisibility={}; S.allPOIsHidden=false;
  getZoneSvg().innerHTML=''; ra(); if(!s) toast('Cleared','ok');
}
function expGPX(){ const w=S.pois.map(p=>'  <wpt lat="'+p.lat+'" lon="'+p.lng+'"><name>'+esc(p.name)+'</name></wpt>').join('\n'); const t=S.routes.map(r=>'  <trk><name>'+esc(r.fromName)+'→'+esc(r.toName)+'</name><trkseg>'+r.coords.map(c=>'<trkpt lat="'+c[0]+'" lon="'+c[1]+'"></trkpt>').join('')+'</trkseg></trk>').join('\n'); const b=new Blob(['<?xml version="1.0"?>\n<gpx version="1.1">\n'+w+'\n'+t+'\n</gpx>'],{type:'application/gpx+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='roadtrip.gpx'; a.click(); toast('GPX exported','ok'); }
