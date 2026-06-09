/* ===================================================
   POIs
=================================================== */
function addPOI(ll, data){
  const id = (data.id!=null) ? Number(data.id) : nid();
  const dayIds = data.dayIds || (data.dayId ? [Number(data.dayId)] : []);
  const p = {
    id, name:data.name||'POI', desc:data.desc||'', cat:data.cat||'general',
    color:data.color||'#c94f14', rating:data.rating||'', links:data.links||[],
    tags:data.tags||[], lat:ll.lat, lng:ll.lng, locked:data.locked!==false,
    dayIds, cost:+(data.cost||0), costType:data.costType||'total',
    propagateAccom: data.propagateAccom!==false && isAccomCat(data.cat||'general'),
    colorLocked: !!data.colorLocked,
    marker:null
  };
  const mk = L.marker([p.lat,p.lng],{icon:mkPin(getPoiColor(p),CATS[p.cat]||'📍'),draggable:false}).addTo(map);
  mk.bindPopup('',{minWidth:195});
  mk.on('click',()=>{ mk.setPopupContent(popH(p)); mk.openPopup(); fetchPhotos(p.name,L.latLng(p.lat,p.lng)).then(imgs=>{ if(!imgs.length) return; const pop=mk.getPopup(); if(pop&&pop.isOpen()){ const pw=qs('.pop-photos',pop.getElement()); if(pw) pw.innerHTML=ph(imgs,'pop-photo'); } }); });
  mk.on('dragend',e2=>{ p.lat=e2.target.getLatLng().lat; p.lng=e2.target.getLatLng().lng; refreshRt(p.id).then(()=>ra()); });
  p.marker = mk; S.pois.push(p);
  dayIds.forEach(did=>syncPD(p,did));
  return p;
}

// Accommodation categories that propagate to the next day
function isAccomCat(cat){ return ['hotel','camping'].includes(cat); }

/**
 * For a given day, return the ghost-propagated accommodation items from the PREVIOUS days:
 * Any hotel/camping POI assigned to the PREVIOUS day that has propagateAccom=true.
 * Returns array of {type:'ghost', poiId}.
 * These appear at position 0 in the day's visual list and cannot be moved above.
 */
function getGhostItemsForDay(dayIdx){
  if(dayIdx===0) return [];
  const prevDay=S.days[dayIdx-1];
  if(!prevDay) return [];
  const ghosts=[];
  prevDay.items.forEach(it=>{
    if(it.type==='poi'){
      const p=S.pois.find(x=>x.id===it.id);
      if(p&&isAccomCat(p.cat)&&p.propagateAccom) ghosts.push({type:'ghost',poiId:p.id});
    }
  });
  return ghosts;
}
function syncPD(p,did){ const d=S.days.find(x=>x.id===did); if(d&&!d.items.some(i=>i.type==='poi'&&i.id===p.id)) d.items.push({type:'poi',id:p.id}); }
function setPOIDays(p,newDayIds){
  (p.dayIds||[]).forEach(did=>{ if(!newDayIds.includes(did)){ const od=S.days.find(d=>d.id===did); if(od) od.items=od.items.filter(i=>!(i.type==='poi'&&i.id===p.id)); } });
  newDayIds.forEach(did=>syncPD(p,did));
  p.dayIds=newDayIds;
  if(p.marker) p.marker.closePopup();
  if(!p.colorLocked&&p.marker) p.marker.setIcon(mkPin(getPoiColor(p),CATS[p.cat]||'📍'));
}
/** Called from map popup checkbox — toggles one day assignment without closing popup */
function quickTogglePOIDay(poiId, dayId, add){
  const p=S.pois.find(x=>x.id===poiId); if(!p) return;
  const days=p.dayIds||[];
  const newDays=add ? [...new Set([...days,dayId])] : days.filter(x=>x!==dayId);
  setPOIDays(p,newDays);
  p.dayIds=newDays;
  // Refresh the popup content live (the popup stays open)
  if(p.marker&&p.marker.getPopup()&&p.marker.getPopup().isOpen()){
    p.marker.setPopupContent(popH(p));
  }
  ra();
  toast((add?'📅 Added to ':'📅 Removed from ')+(S.days.find(x=>x.id===dayId)||{title:'?'}).title,'ok');
}
function popH(p){
  const eff=poiEffectiveCost(p);
  const costStr = p.costType==='perday' && (p.dayIds||[]).length>1
    ? '$'+p.cost.toFixed(2)+'/day × '+(p.dayIds||[]).length+' = $'+eff.toFixed(2)
    : '$'+eff.toFixed(2);
  const assignedDays=(p.dayIds||[]).map(did=>{ const d=S.days.find(x=>x.id===did); if(!d) return null; const fd=fmtDate(d.date); return {title:esc(d.title),date:fd}; }).filter(Boolean);
  const dayBadge=assignedDays.length
    ? assignedDays.map(({title,date})=>'<span style="background:var(--surf3);border:1px solid var(--border2);border-radius:8px;padding:1px 6px;font-size:.6rem;font-weight:700;">'+title+(date?' <span style="font-weight:400;color:var(--muted2);">'+date+'</span>':'')+'</span>').join(' ')
    : '<span style="font-size:.6rem;color:var(--muted);">No day assigned</span>';
  const poiColor=getPoiColor(p);
  return '<div class="pt" style="display:flex;align-items:center;gap:6px;">'
    +'<span>'+(CATS[p.cat]||'📍')+' '+esc(p.name)+'</span>'
    +'<span class="pop-color-dot" style="background:'+poiColor+';width:12px;height:12px;border-radius:50%;flex-shrink:0;cursor:pointer;border:2px solid rgba(0,0,0,.15);display:inline-block;" onclick="openPoiColorPicker('+p.id+')" title="Change color"></span>'
    +'</div>'
    +(eff?'<div class="pr">💰 <b style="color:var(--gold);">'+costStr+'</b></div>':'')
    +(p.desc?'<div class="pd">'+esc(p.desc)+'</div>':'')
    +'<div class="pr pop-day-row" style="margin-top:4px;gap:5px;align-items:center;">'
    +'<span style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted2);">📅</span>'
    +dayBadge
    +(S.days.length?'<button class="btn bg bsm" style="font-size:.6rem;padding:1px 6px;" onclick="openDayAssignModal('+p.id+')">✎</button>':'')
    +'</div>'
    +'<div class="pop-photos"></div>'
    +'<div class="pr" style="font-size:.61rem;color:var(--muted);margin-top:2px;">'+p.lat.toFixed(5)+', '+p.lng.toFixed(5)+' · '+(p.locked?'🔒':'🔓')+'</div>'
    +'<div class="pa">'
    +_routeDepBtn(p.id)
    +'<button class="btn bg bsm" onclick="editPOI('+p.id+')">✏️ Edit</button>'
    +'<button class="btn bg bsm" onclick="toggleLock('+p.id+')">'+(p.locked?'🔓 Unlock':'🔒 Lock')+'</button>'
    +'<button class="btn br bsm" onclick="delPOI('+p.id+')">🗑</button></div>';
}

const POI_COLORS=['#c94f14','#1d56d4','#15803d','#d4920a','#7c22d4','#c81e1e','#0e7eb5','#b01e6a','#e91e8c','#00796b'];

function openPoiColorPicker(poiId){
  const p=S.pois.find(x=>x.id===poiId); if(!p) return;
  const modal=qs('#cpick-modal'); if(!modal) return;
  qs('#cpick-poi-id').value=poiId;
  const current=getPoiColor(p);
  qs('#cpick-swatches').innerHTML=POI_COLORS.map(c=>'<div class="cpick-swatch'+(c===current?' cpick-on':'')+'" style="background:'+c+';" onclick="setPoiColorFromPicker('+poiId+',\''+c+'\')"></div>').join('');
  qs('#cpick-hex').value=p.colorLocked?current:'';
  modal.style.display='flex';
}

function setPoiColorFromPicker(poiId,color){
  const p=S.pois.find(x=>x.id===poiId); if(!p) return;
  p.color=color; p.colorLocked=true;
  if(p.marker) p.marker.setIcon(mkPin(color,CATS[p.cat]||'📍'));
  if(p.marker&&p.marker.getPopup()&&p.marker.getPopup().isOpen()) p.marker.setPopupContent(popH(p));
  qs('#cpick-modal').style.display='none';
  ra();
}

function closePoiColorPicker(){ const m=qs('#cpick-modal'); if(m) m.style.display='none'; }

function openDayAssignModal(poiId){
  const p=S.pois.find(x=>x.id===poiId); if(!p) return;
  const modal=qs('#dayassign-modal'); if(!modal) return;
  qs('#dayassign-poi-id').value=poiId;
  qs('#dayassign-poi-name').textContent=(CATS[p.cat]||'📍')+' '+p.name;
  qs('#dayassign-list').innerHTML=S.days.map((d,di)=>{
    const checked=(p.dayIds||[]).includes(d.id);
    const c=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const fd=fmtDate(d.date);
    return '<label class="dayassign-row">'
      +'<input type="checkbox" '+(checked?'checked':'')+' style="accent-color:'+c+';cursor:pointer;width:16px;height:16px;" onchange="quickTogglePOIDay('+poiId+','+d.id+',this.checked)">'
      +'<span class="dayassign-dot" style="background:'+c+';"></span>'
      +'<span class="dayassign-name">'+esc(d.title)+(fd?' <span style="color:var(--muted2);font-size:.6rem;">'+fd+'</span>':'')+'</span>'
      +'</label>';
  }).join('');
  modal.style.display='flex';
}

function closeDayAssignModal(){ const m=qs('#dayassign-modal'); if(m) m.style.display='none'; }
function toggleLock(id){ const p=S.pois.find(x=>x.id===id); if(!p) return; p.locked=!p.locked; p.marker.dragging[p.locked?'disable':'enable'](); p.marker.closePopup(); toast(p.locked?'🔒 Locked':'🔓 Unlocked',''); }
function editPOI(id){
  const p=S.pois.find(x=>x.id===id); if(!p) return;
  S.editing=id;
  qs('#m-name').value=p.name; qs('#m-desc').value=p.desc||''; qs('#m-cat').value=p.cat;
  qs('#m-cost').value=p.cost||'';
  if(p.colorLocked) selCol(p.color); else { S.col=p.color; selColAuto(); }
  qs('#m-hd').textContent='Edit POI'; qs('#m-ico').textContent=CATS[p.cat]||'📍';
  setCostType(p.costType||'total');
  refMDay(); renderMDayCheckboxes(p.dayIds||[]);
  updateCostTypeUI();
  const propRow=qs('#m-propagate-row');
  if(propRow){ propRow.style.display=isAccomCat(p.cat)?'flex':'none'; }
  const propCb=qs('#m-propagate');
  if(propCb) propCb.checked=p.propagateAccom!==false;
  qs('#mbk').classList.add('on'); setTimeout(()=>qs('#m-name').focus(),80);
}
function delPOI(id){
  const i=S.pois.findIndex(p=>p.id===id); if(i<0) return;
  map.removeLayer(S.pois[i].marker);
  S.pois.splice(i,1);
  S.routes=S.routes.filter(r=>{ if(r.fromId===id||r.toId===id){ if(r.poly) map.removeLayer(r.poly); clearRouteHourDots(r); return false; } return true; });
  S.days.forEach(d=>{ d.items=d.items.filter(i=>!(i.type==='poi'&&i.id===id)); });
  ra(); toast('POI deleted','ok');
}
function focusPOI(id){ const p=S.pois.find(x=>x.id===id); if(!p) return; closeDrawerMobile(); map.flyTo([p.lat,p.lng],16,{duration:.7}); setTimeout(()=>p.marker.fire('click'),750); }

function _routeDepBtn(pid){
  if(!S.routeDep){
    return '<button class="btn bg bsm" onclick="setRouteDep('+pid+')">🚀 Depart from here</button>';
  } else if(S.routeDep===pid){
    return '<button class="btn br bsm" onclick="setRouteDep(null)">✕ Cancel departure</button>';
  } else {
    const dep=S.pois.find(x=>x.id===S.routeDep);
    const depName=dep?esc(dep.name):'?';
    return '<button class="btn ba bsm" onclick="quickRoute('+S.routeDep+','+pid+')">🏁 Route from '+depName+'</button>';
  }
}
function setRouteDep(pid){
  S.routeDep=pid;
  S.pois.forEach(p=>{ if(p.marker) p.marker.closePopup(); });
  if(pid){
    const p=S.pois.find(x=>x.id===pid);
    toast('Departure: '+(p?p.name:'?')+'. Now click another POI to set arrival.','');
  }
}
async function quickRoute(fromId,toId){
  S.routeDep=null;
  S.pois.forEach(p=>{ if(p.marker) p.marker.closePopup(); });
  await calcRoute(fromId,toId,'car',null,null,0,0,false);
  const rt=S.routes[S.routes.length-1];
  if(rt){
    openDrawer();
    qsa('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab==='routes'));
    qsa('.panel').forEach(p=>p.classList.toggle('on',p.id==='panel-routes'));
    openRouteEdit(rt.id);
    toast('Route created — assign a day and details below.','ok');
  }
}

let _hideUnusedPOIs=false;
function toggleHideUnusedPOIs(){
  _hideUnusedPOIs=!_hideUnusedPOIs;
  const btn=qs('#btn-hide-unused');
  if(btn) btn.textContent=_hideUnusedPOIs?'👁 Show all POIs':'👁 Hide unassigned POIs';
  renderPOIs();
}

function renderPOIs(){
  const el=qs('#poi-list'); qs('#pcnt').textContent=S.pois.length;
  const vis=S.pois
    .filter(p=>S.fcat==='all'||p.cat===S.fcat)
    .filter(p=>!_hideUnusedPOIs||(p.dayIds&&p.dayIds.length>0))
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));

  // Apply marker visibility for ALL pois (not just filtered)
  applyAllMarkerVisibility();

  if(!vis.length){ el.innerHTML='<div style="font-size:.73rem;color:var(--muted);">No POIs'+(S.fcat!=='all'?' in this category':'')+'.</div>'; return; }

  el.innerHTML=vis.map(p=>{
    const individuallyHidden = isPOIHidden(p.id);
    const effectivelyHidden  = !poiEffectivelyVisible(p);
    // Day-forced visibility hint (show which days are hiding this POI)
    const hiddenByDays = !individuallyHidden && effectivelyHidden;
    const dayBadges=(p.dayIds||[]).map(did=>{ const d=S.days.find(x=>x.id===did); if(!d) return''; const di=S.days.indexOf(d); const c=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length]; const dimmed=isDayHidden(did); return'<span class="pday-badge" style="background:'+c+';'+(dimmed?'opacity:.4;':'')+'">'+esc(d.title)+'</span>'; }).join('');
    const eff=poiEffectiveCost(p);
    const costStr = p.costType==='perday' && (p.dayIds||[]).length>1 ? '$'+p.cost+'/day':'';
    // Eye icon: shows individual state; if dimmed by day, show a different hint
    const eyeIcon  = individuallyHidden ? '👁‍🗨' : '👁';
    const eyeTitle = individuallyHidden ? 'Show POI' : (hiddenByDays ? 'Hidden by day — click to force show' : 'Hide POI');
    const pc_=getPoiColor(p);
    return '<div class="poic" data-pid="'+p.id+'" onclick="focusPOI('+p.id+')" style="'+(effectivelyHidden?'opacity:.4;':'')+'}">'
      +'<div class="ppin" style="background:'+pc_+'22;color:'+pc_+';">'+(CATS[p.cat]||'📍')+'</div>'
      +'<div class="pbody"><div class="pname">'+esc(p.name)+(p.locked?' 🔒':'')+'</div>'
      +'<div class="pmeta">'+(p.rating?'<span>'+'★'.repeat(+p.rating)+'</span>':'')+'</div>'
      +(eff?'<div class="pcost">💰 $'+eff.toFixed(2)+(costStr?' <span style="font-size:.55rem;opacity:.7;">('+costStr+')</span>':'')+'</div>':'')
      +(dayBadges?'<div class="pday-badges">'+dayBadges+'</div>':'')
      +(p.tags&&p.tags.length?'<div class="ptags">'+p.tags.slice(0,3).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')
      +'<div class="poi-photos" data-phid="'+p.id+'"></div></div>'
      +'<div class="pacts">'
      +'<button class="btn bg bic" onclick="event.stopPropagation();setPOIVisibility('+p.id+','+(individuallyHidden?'true':'false')+')" title="'+eyeTitle+'" style="font-size:.8rem;">'+eyeIcon+'</button>'
      +'<button class="btn bg bic" onclick="event.stopPropagation();editPOI('+p.id+')">✏️</button>'
      +'<button class="btn br bic" onclick="event.stopPropagation();delPOI('+p.id+')">🗑</button></div></div>';
  }).join('');
  qsa('.poic[data-pid]',el).forEach(card=>{
    const pid=parseInt(card.dataset.pid,10); const p=S.pois.find(x=>x.id===pid); if(!p) return;
    card.addEventListener('mouseenter',()=>{ const phEl=qs('[data-phid="'+pid+'"]',card); if(!phEl||phEl.innerHTML) return; fetchPhotos(p.name,L.latLng(p.lat,p.lng)).then(imgs=>{ if(imgs.length&&phEl) phEl.innerHTML=ph(imgs.slice(0,2),'poi-photo'); }); },{once:true});
  });
  renderPoiLabels();
}

/* ===================================================
   DAYS
=================================================== */
function nextDate(){ if(!S.days.length) return ''; const last=S.days[S.days.length-1]; if(!last.date) return ''; try{ const d=new Date(last.date); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }catch(e){ return ''; } }
function nextDateFrom(afterDay){ if(!afterDay||!afterDay.date) return ''; try{ const d=new Date(afterDay.date); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }catch(e){ return ''; } }
function addDay(){ S.days.push({id:nid(),title:'Day '+(S.days.length+1),date:nextDate(),items:[]}); ra(); }
function insertDayAt(idx){
  const prev=idx>0?S.days[idx-1]:null;
  const nd={id:nid(),title:'Day '+(idx+1),date:prev?nextDateFrom(prev):'',items:[]};
  S.days.splice(idx,0,nd);
  for(let i=idx+1;i<S.days.length;i++){
    if(S.days[i].date){ try{ const d=new Date(S.days[i].date); d.setDate(d.getDate()+1); S.days[i].date=d.toISOString().slice(0,10); }catch(e){} }
    if(S.days[i].title==='Day '+i) S.days[i].title='Day '+(i+1);
  }
  ra(); toast('Day inserted at position '+(idx+1),'ok');
}
function updDay(id,k,v){
  const d=S.days.find(x=>x.id===id); if(!d) return;
  if(k==='date'){
    const idx=S.days.indexOf(d);
    if(v){
      if(d.date){
        // Shift all subsequent days by the same delta
        try{
          const delta=Math.round((new Date(v)-new Date(d.date))/86400000);
          if(delta!==0) for(let i=idx+1;i<S.days.length;i++){
            try{ const dt=new Date(S.days[i].date||v); dt.setDate(dt.getDate()+delta); S.days[i].date=dt.toISOString().slice(0,10); }catch(e){}
          }
        }catch(e){}
      } else {
        // First time setting a date: fill subsequent days consecutively
        for(let i=idx+1;i<S.days.length;i++){
          try{ const dt=new Date(v); dt.setDate(dt.getDate()+(i-idx)); S.days[i].date=dt.toISOString().slice(0,10); }catch(e){}
        }
      }
    }
    d.date=v;
    ra(); return;
  }
  d[k]=v;
}
function toggleDayCollapse(id){
  S.dayCollapsed[id]=!S.dayCollapsed[id];
  const card=qs('.dayc[data-dcid="'+id+'"]');
  if(card){
    card.classList.toggle('dayc--collapsed',!!S.dayCollapsed[id]);
    const btn=card.querySelector('.day-collapse-btn');
    if(btn) btn.textContent=S.dayCollapsed[id]?'+':'−';
  }
}
function setAllDaysCollapsed(v){
  S.days.forEach(d=>{ S.dayCollapsed[d.id]=v; });
  qsa('.dayc').forEach(card=>{
    card.classList.toggle('dayc--collapsed',v);
    const btn=card.querySelector('.day-collapse-btn');
    if(btn) btn.textContent=v?'+':'−';
  });
}
function setDayColor(id, color){
  const d=S.days.find(x=>x.id===id); if(!d) return;
  d.color=color||''; scheduleZoneRefresh();
  const bub=qs('.dayn-bubble[data-did="'+id+'"]');
  if(bub) bub.style.background=color||DAY_ZONE_COLORS[S.days.indexOf(d)%DAY_ZONE_COLORS.length];
  // Refresh auto-colored POI markers assigned to this day
  S.pois.forEach(p=>{ if(!p.colorLocked&&(p.dayIds||[]).includes(id)&&p.marker) p.marker.setIcon(mkPin(getPoiColor(p),CATS[p.cat]||'📍')); });
  // Refresh route polylines for this day
  S.routes.forEach(r=>{ if(r.dayId===id&&r.poly) r.poly.setStyle({color:getRouteColor(r)}); });
}
function delDay(id){
  const d=S.days.find(x=>x.id===id); if(!d) return;
  const idx=S.days.indexOf(d);
  d.items.filter(i=>i.type==='poi').forEach(i=>{ const p=S.pois.find(x=>x.id===i.id); if(p) p.dayIds=(p.dayIds||[]).filter(x=>x!==id); });
  delete S.eatingBudgets[id];
  S.days=S.days.filter(x=>x.id!==id);
  // Shift subsequent days back by 1 to close the date gap
  for(let i=idx;i<S.days.length;i++){
    if(S.days[i].date){ try{ const dt=new Date(S.days[i].date); dt.setDate(dt.getDate()-1); S.days[i].date=dt.toISOString().slice(0,10); }catch(e){} }
  }
  ra();
}
function rmItem(did,idx){
  const d=S.days.find(x=>x.id===did); if(!d) return;
  const it=d.items[idx];
  if(it&&it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p) p.dayIds=(p.dayIds||[]).filter(x=>x!==did); }
  d.items.splice(idx,1); ra();
}
function addNote(did){ const d=S.days.find(x=>x.id===did); if(!d) return; d.items.push({type:'note',text:''}); ra(); }
function focusDay(did){
  const d=S.days.find(x=>x.id===did); if(!d) return;
  const lls=[];
  d.items.forEach(it=>{
    if(it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p) lls.push([p.lat,p.lng]); }
    if(it.type==='route'){ const r=S.routes.find(x=>x.id===it.id); if(r&&r.coords) r.coords.forEach(c=>lls.push(c)); }
  });
  if(!lls.length){ toast('Nothing to show',''); return; }
  closeDrawerMobile(); map.fitBounds(L.latLngBounds(lls),{padding:[50,50]});
}

function renderDays(){
  const el=qs('#day-list');
  if(!S.days.length){ el.innerHTML='<div style="font-size:.73rem;color:var(--muted);padding:10px;text-align:center;">No days yet.</div>'; return; }
  const insertBtn=(idx)=>'<div class="day-insert-btn"><button onclick="insertDayAt('+idx+')">＋ Insert day here</button></div>';
  el.innerHTML=insertBtn(0)+S.days.map((d,di)=>{
    const dpois=d.items.filter(i=>i.type==='poi').map(i=>S.pois.find(p=>p.id===i.id)).filter(Boolean);
    const drts=d.items.filter(i=>i.type==='route').map(i=>S.routes.find(r=>r.id===i.id)).filter(Boolean);
    const km=drts.reduce((s,r)=>s+(r.dist||0),0), dur=drts.reduce((s,r)=>s+(r.dur||0),0), dc=dayCost(d);
    const eating=eatingForDay(d.id);
    const eatingOverridden=S.eatingBudgets[d.id]!==undefined&&S.eatingBudgets[d.id]!==null;
    const costRows=[];
    d.items.forEach(it=>{
      if(it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p&&poiCostForDay(p)>0){ const nDays=(p.dayIds||[]).length||1; const lbl=(CATS[p.cat]||'📍')+' '+p.name+(p.costType==='perday'?' (per day)':(nDays>1?' (÷'+nDays+' days)':'')); costRows.push({l:lbl,c:poiCostForDay(p),s:''}); } }
      if(it.type==='route'){ const r=S.routes.find(x=>x.id===it.id); if(r){ const tot=routeCost(r),fuel=routeFuel(r); if(tot>0){ const sub=[]; if(fuel>0) sub.push('fuel $'+fuel.toFixed(2)); if(r.fixedCost>0) sub.push('fixed $'+r.fixedCost.toFixed(2)); costRows.push({l:(MI[r.mode]||'🛣️')+' '+r.fromName+'→'+r.toName,c:tot,s:sub.join(' + ')}); } } }
    });
    if(eating>0) costRows.push({l:'🍽️ Eating'+(eatingOverridden?' (custom)':' (default)'),c:eating,s:''});
    const ghosts=getGhostItemsForDay(di);
    const hasHotel=dpois.some(p=>isAccomCat(p.cat));
    let items='';
    if(!d.items.length && !ghosts.length) items='<div class="empty-day">Empty — assign POIs via ✏️ Edit</div>';

    // Ghost items (accommodation from previous day) — rendered first, not draggable above
    ghosts.forEach(g=>{
      const p=S.pois.find(x=>x.id===g.poiId); if(!p) return;
      const gpc_=getPoiColor(p);
      items+='<div class="day-item day-item--hotel" style="opacity:.45;border-style:dashed;cursor:default;" title="Starting point (from previous day)">'
        +'<span style="font-size:.7rem;flex-shrink:0;">🔗</span>'
        +'<div class="dipin" style="background:'+gpc_+'22;color:'+gpc_+';">'+(CATS[p.cat]||'📍')+'</div>'
        +'<span class="diname" style="color:var(--muted);">'+esc(p.name)+' <span style="font-size:.58rem;">(carry-over)</span></span>'
        +'<button class="btn bg bic bsm" onclick="focusPOI('+p.id+')" style="opacity:.6;">👁</button>'
        +'</div>';
    });
    if(ghosts.length) items+='<div style="border-top:1.5px dashed var(--border2);margin:3px 0 4px;"></div>';
    d.items.forEach((it,idx)=>{
      items+='<div class="day-dropzone" data-did="'+d.id+'" data-idx="'+idx+'"></div>';
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id); if(!p) return;
        const ipc_=getPoiColor(p);
        const isHotel=isAccomCat(p.cat);
        const itemCls=isHotel?'day-item day-item--hotel':'day-item day-item--poi';
        items+='<div class="'+itemCls+'" draggable="true" data-did="'+d.id+'" data-idx="'+idx+'" data-itype="poi" data-iid="'+p.id+'">'
          +'<span class="di-grip">⋮⋮</span>'
          +'<div class="dipin" style="background:'+ipc_+'22;color:'+ipc_+';">'+(CATS[p.cat]||'📍')+'</div>'
          +'<span class="diname" ondblclick="editPOI('+p.id+')" onclick="focusPOI('+p.id+')">'+esc(p.name)+'</span>'
          +(poiCostForDay(p)?'<span class="di-cost">$'+poiCostForDay(p).toFixed(2)+'</span>':'')
          +'<button class="btn bic bsm day-item-btn" onclick="editPOI('+p.id+')" title="Edit">✏️</button>'
          +'<button class="btn bic bsm day-item-btn" onclick="focusPOI('+p.id+')">👁</button>'
          +'<button class="btn br bic bsm" onclick="rmItem('+d.id+','+idx+')">✕</button></div>';
      } else if(it.type==='route'){
        const r=S.routes.find(x=>x.id===it.id); if(!r) return;
        const tot=routeCost(r);
        const irc_=getRouteColor(r);
        items+='<div class="day-item day-item--route" draggable="true" data-did="'+d.id+'" data-idx="'+idx+'" data-itype="route" data-iid="'+r.id+'">'
          +'<span class="di-grip">⋮⋮</span><span style="flex-shrink:0;">'+(MI[r.mode]||'🛣️')+'</span>'
          +'<span class="diname day-item--route-name" onclick="(function(){var r2=S.routes.find(x=>x.id==='+r.id+');if(r2&&r2.poly){closeDrawerMobile();map.fitBounds(r2.poly.getBounds(),{padding:[50,50]});}})()">'+esc(r.fromName)+'→'+esc(r.toName)+' <span style="font-size:.61rem;">'+r.dist+'km</span></span>'
          +(tot?'<span class="di-cost">$'+tot.toFixed(2)+'</span>':'')
          +'<button class="btn bic bsm day-item-btn" onclick="openRouteEdit('+r.id+')" title="Edit">✏️</button>'
          +'<button class="btn br bic bsm" onclick="rmItem('+d.id+','+idx+')">✕</button></div>';
      } else if(it.type==='note'){
        items+='<div class="ndi"><div style="display:flex;align-items:flex-start;gap:5px;"><textarea rows="2" style="flex:1;" onchange="S.days.find(x=>x.id==='+d.id+').items['+idx+'].text=this.value">'+(it.text||'')+'</textarea><button class="btn br bic bsm" onclick="rmItem('+d.id+','+idx+')">✕</button></div></div>';
      }
    });
    items+='<div class="day-dropzone" data-did="'+d.id+'" data-idx="'+d.items.length+'"></div>';
    let costSummary='';
    if(costRows.length||dc>0){
      costSummary='<div class="day-cost-summary">';
      costRows.forEach(cr=>{ costSummary+='<div class="dcs-row"><span>'+cr.l+(cr.s?' <span style="font-size:.59rem;color:var(--muted2);">('+cr.s+')</span>':'')+'</span><span>$'+cr.c.toFixed(2)+'</span></div>'; });
      costSummary+='<div class="dcs-row total"><span>💰 Day total</span><span>$'+dc.toFixed(2)+'</span></div></div>';
    }
    const zoneColor=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const eatPlaceholder=S.eatingDefault?'$'+S.eatingDefault+' (default)':'$0';
    const hidden=isDayHidden(d.id);
    const collapsed=!!S.dayCollapsed[d.id];
    const fdate=fmtDate(d.date);
    const hotelWarn=!hasHotel?'<span class="day-hotel-warn" title="No hotel/accommodation for this day">⚠️🏨</span>':'';
    const cardStyle='--day-col:'+zoneColor+';'+(hidden?'opacity:.45;':'');
    return '<div class="dayc'+(collapsed?' dayc--collapsed':'')+'" data-dcid="'+d.id+'" style="'+cardStyle+'">'
      +'<div class="dayh">'
      +'<div class="dayn-bubble" data-did="'+d.id+'" style="background:'+zoneColor+';cursor:pointer;" title="Click to change day color" onclick="qs(\'#dclr-'+d.id+'\').click()">'+(di+1)+'</div>'
      +'<input type="color" id="dclr-'+d.id+'" value="'+zoneColor+'" style="display:none;width:0;height:0;padding:0;border:0;" oninput="setDayColor('+d.id+',this.value)">'
      +'<div class="dayh-titles">'
      +'<input class="dayti" value="'+esc(d.title)+'" onchange="updDay('+d.id+',\'title\',this.value)">'
      +'<div class="daydi-wrap">'
      +'<span class="daydi-label">'+(fdate||'📅 Set date')+'</span>'
      +'<input class="daydi" type="date"'+(d.date?' value="'+d.date+'"':'')+' onchange="updDay('+d.id+',\'date\',this.value)" title="Edit date">'
      +'</div>'
      +'</div>'
      +hotelWarn
      +'<button class="day-collapse-btn" onclick="toggleDayCollapse('+d.id+')" title="'+(collapsed?'Expand':'Collapse')+'">'+(collapsed?'+':'−')+'</button>'
      +'<button class="btn bg bic bsm" onclick="setDayVisibility('+d.id+','+(hidden?'true':'false')+')" title="'+(hidden?'Show day':'Hide day')+'" style="font-size:.85rem;">'+(hidden?'👁':'👁‍🗨')+'</button>'
      +'<button class="btn br bic bsm" onclick="delDay('+d.id+')">✕</button></div>'
      +'<div class="dayst"><div class="daystat">📍 <b>'+dpois.length+'</b></div>'+(km?'<div class="daystat">🛣️ <b>'+km.toFixed(0)+'km</b></div>':'')+(dur?'<div class="daystat">⏱ <b>'+fmtD(dur)+'</b></div>':'')+(dc?'<div class="daystat gold">💰 <b>$'+dc.toFixed(2)+'</b></div>':'')+'</div>'
      +'<div class="dayb">'+items+costSummary
      +'<div style="display:flex;align-items:center;gap:5px;padding:4px 2px 2px;">'
        +'<span style="font-size:.62rem;color:var(--green);font-weight:700;">🍽️ Eating:</span>'
        +'<input type="number" class="inp day-eating-input" min="0" step="1" data-did="'+d.id+'" placeholder="'+eatPlaceholder+'" style="width:90px;padding:2px 5px;font-size:.65rem;" '
          +(eatingOverridden?'value="'+S.eatingBudgets[d.id]+'"':'')+' '
          +'oninput="setDayEating('+d.id+',+this.value,this.value!==\'\');" '
          +'onblur="if(this.value===\'\'){setDayEating('+d.id+',0,false);}">'
        +(eatingOverridden?'<button class="btn bg bsm" onclick="setDayEating('+d.id+',0,false);ra();" title="Reset to default">↩</button>':'')
      +'</div>'
      +'<div class="dayacts"><button class="btn bg bsm" onclick="addNote('+d.id+')">📝 Note</button><button class="btn bg bsm" onclick="focusDay('+d.id+')">🗺️ View</button></div></div>'
      +'</div>'+insertBtn(di+1);
  }).join('');

  // Drag & drop
  let dragging=null;
  qsa('.day-item[draggable]',el).forEach(item=>{
    item.addEventListener('dragstart',ev=>{ dragging={el:item,did:parseInt(item.dataset.did,10),idx:parseInt(item.dataset.idx,10),itype:item.dataset.itype,iid:parseInt(item.dataset.iid,10)}; item.classList.add('dragging'); ev.dataTransfer.effectAllowed='move'; });
    item.addEventListener('dragend',()=>{ if(dragging) dragging.el.classList.remove('dragging'); dragging=null; qsa('.day-dropzone').forEach(dz=>dz.classList.remove('over')); qsa('.dayc').forEach(dc=>dc.classList.remove('dover')); });
  });
  qsa('.day-dropzone',el).forEach(dz=>{
    dz.addEventListener('dragover',ev=>{ev.preventDefault();dz.classList.add('over');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
    dz.addEventListener('drop',ev=>{ev.preventDefault();dz.classList.remove('over');if(dragging)moveItem(dragging.did,dragging.idx,dragging.itype,dragging.iid,parseInt(dz.dataset.did,10),parseInt(dz.dataset.idx,10));});
  });
  qsa('.dayc[data-dcid]',el).forEach(dc=>{
    dc.addEventListener('dragover',ev=>{ev.preventDefault();dc.classList.add('dover');});
    dc.addEventListener('dragleave',ev=>{if(!dc.contains(ev.relatedTarget))dc.classList.remove('dover');});
    dc.addEventListener('drop',ev=>{ev.preventDefault();dc.classList.remove('dover');if(!dragging)return;const tid=parseInt(dc.dataset.dcid,10);if(dragging.did===tid)return;const td=S.days.find(x=>x.id===tid);if(td)moveItem(dragging.did,dragging.idx,dragging.itype,dragging.iid,tid,td.items.length);});
  });
}

function moveItem(fDid,fIdx,itype,iid,tDid,tIdx){
  const fd=S.days.find(d=>d.id===fDid),td=S.days.find(d=>d.id===tDid); if(!fd||!td) return;
  // Block placing before ghost items in target day
  const tDayIdx=S.days.indexOf(td);
  const ghostCount=getGhostItemsForDay(tDayIdx).length;
  if(tIdx<ghostCount){ toast('Cannot place before the carry-over starting point',''); return; }
  const[item]=fd.items.splice(fIdx,1); if(!item) return;
  if(itype==='poi'){ const p=S.pois.find(x=>x.id===iid); if(p){ p.dayIds=(p.dayIds||[]).filter(x=>x!==fDid); if(!p.dayIds.includes(tDid)) p.dayIds.push(tDid); } }
  if(itype==='route'){ const r=S.routes.find(x=>x.id===iid); if(r) r.dayId=tDid; }
  let at=tIdx; if(fDid===tDid&&fIdx<tIdx) at--;
  td.items.splice(Math.max(0,at),0,item);
  ra(); if(fDid!==tDid) toast((itype==='poi'?'POI':'Route')+' → '+td.title,'ok');
}

/* ===================================================
   ROUTES
=================================================== */
async function calcRoute(fi,ti,mode,dayId,editId,fixedCost,manualDist,colorLocked){
  const from=S.pois.find(p=>p.id===fi||p.id==fi), to=S.pois.find(p=>p.id===ti||p.id==ti);
  if(!from||!to){ toast('POIs not found','err'); return; }
  if(from.id===to.id){ toast('Same start and end!','err'); return; }
  const fc=+(fixedCost||0); let dist,dur,coords,poly;
  const explicitCol=S.rtCol||RCOL[mode]||'#1d56d4';
  const effectiveCol=(colorLocked&&explicitCol)||(!colorLocked&&dayId&&getDayColor(dayId))||explicitCol;
  if(mode==='manual'){
    dist=+(manualDist||from.marker.getLatLng().distanceTo(to.marker.getLatLng())/1000).toFixed(1);
    dur=0; coords=[[from.lat,from.lng],[to.lat,to.lng]];
    poly=L.polyline(coords,{color:effectiveCol,weight:3,opacity:.8,dashArray:'10 6'}).addTo(map);
    closeDrawerMobile(); map.fitBounds(L.latLngBounds(coords),{padding:[50,50]});
  } else {
    toast('Calculating...','');
    try{
      const res=await fetch('https://router.project-osrm.org/route/v1/'+({car:'car',foot:'foot',bike:'bike'}[mode]||'car')+'/'+from.lng+','+from.lat+';'+to.lng+','+to.lat+'?overview=full&geometries=geojson');
      const data=await res.json();
      if(data.code!=='Ok'){ toast('Route not found','err'); return; }
      dist=+(data.routes[0].distance/1000).toFixed(1); dur=Math.round(data.routes[0].duration/60);
      coords=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      poly=L.polyline(coords,{color:effectiveCol,weight:4.5,opacity:.82,dashArray:mode==='foot'?'8 5':null}).addTo(map);
      closeDrawerMobile(); map.fitBounds(poly.getBounds(),{padding:[50,50]});
    }catch(e){ toast('Connection error','err'); return; }
  }
  if(editId){
    const old=S.routes.find(r=>r.id===editId);
    if(old){ if(old.poly) map.removeLayer(old.poly); clearRouteHourDots(old); S.routes=S.routes.filter(r=>r.id!==editId); S.days.forEach(d=>{ d.items=d.items.filter(i=>!(i.type==='route'&&i.id===editId)); }); }
  }
  const rid=editId||nid();
  const rt={id:rid,fromId:from.id,toId:to.id,fromName:from.name,toName:to.name,mode,dist,dur,coords,poly,dayId:dayId||null,fixedCost:fc,color:explicitCol,colorLocked:!!colorLocked,hourDotMarkers:[]};
  S.routes.push(rt); bindRouteHover(rt); placeHourDots(rt);
  if(dayId){ const d=S.days.find(x=>x.id==dayId); if(d&&!d.items.some(i=>i.type==='route'&&i.id===rid)) d.items.push({type:'route',id:rid}); }
  ra(); const tc=routeCost(rt); toast(dist+'km'+(dur?' · '+fmtD(dur):'')+(tc?' · $'+tc.toFixed(2):'')+' ✓','ok'); return rt;
}
async function refreshRt(pid){ for(const r of S.routes.filter(r=>r.fromId===pid||r.toId===pid)){ toast('Updating route…',''); if(r.colorLocked) S.rtCol=r.color; await calcRoute(r.fromId,r.toId,r.mode,r.dayId,r.id,r.fixedCost,r.mode==='manual'?r.dist:null,r.colorLocked); } }
function delRoute(id){
  const i=S.routes.findIndex(r=>r.id===id); if(i<0) return;
  if(S.routes[i].poly) map.removeLayer(S.routes[i].poly); clearRouteHourDots(S.routes[i]); S.routes.splice(i,1);
  S.days.forEach(d=>{ d.items=d.items.filter(i=>!(i.type==='route'&&i.id===id)); }); ra();
}
function openRouteEdit(id){
  S.editRid=id; const r=S.routes.find(x=>x.id===id); if(!r) return;
  fillRS('ref','ret','red'); qs('#ref').value=r.fromId; qs('#ret').value=r.toId; qs('#rem').value=r.mode;
  qs('#red').value=r.dayId||''; qs('#re-cost').value=r.fixedCost||''; qs('#re-manual-dist').value=r.mode==='manual'?r.dist:'';
  S.rtCol2=r.color||'#1d56d4';
  if(r.colorLocked) qsa('[data-rc2]').forEach(s2=>s2.classList.toggle('on',s2.dataset.rc2===S.rtCol2));
  else qsa('[data-rc2]').forEach(s2=>s2.classList.remove('on'));
  qs('#rmbk').classList.add('on');
}
function fillRS(f,t,d){
  const po='<option value="">— POI —</option>'+S.pois.map(p=>'<option value="'+p.id+'">'+(CATS[p.cat]||'📍')+' '+esc(p.name)+'</option>').join('');
  if(f) qs('#'+f).innerHTML=po; if(t) qs('#'+t).innerHTML=po;
  if(d){ const dy='<option value="">— None —</option>'+S.days.map(d2=>'<option value="'+d2.id+'">'+esc(d2.title)+'</option>').join(''); qs('#'+d).innerHTML=dy; }
}
function renderRoutes(){
  const el=qs('#rlist'); qs('#rcnt').textContent=S.routes.length;
  const fuel=totalFuelCost();
  qs('#finance-total-rt').innerHTML='⛽ Total fuel cost: <b>$'+fuel.toFixed(2)+'</b>';
  renderEatingBudgetRows();
  if(!S.routes.length){ el.innerHTML='<div style="font-size:.73rem;color:var(--muted);">No routes yet.</div>'; return; }
  el.innerHTML=S.routes.map((r,i)=>{
    const day=r.dayId?S.days.find(d=>d.id===r.dayId):null;
    const tot=routeCost(r); const fuel=routeFuel(r);
    const chips=[]; if(fuel>0) chips.push('⛽ $'+fuel.toFixed(2)); if(r.fixedCost>0) chips.push('🎫 $'+r.fixedCost.toFixed(2));
    return '<div class="rtc"><div class="rth"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+getRouteColor(r)+';margin-right:3px;"></span><span class="rnum">#'+(i+1)+'</span><span class="rname">'+esc(r.fromName)+' → '+esc(r.toName)+'</span><button class="btn bg bic bsm" onclick="openRouteEdit('+r.id+')">✏️</button><button class="btn br bic bsm" onclick="delRoute('+r.id+')">🗑</button></div>'
      +'<div class="rmeta"><span>'+(MI[r.mode]||'🚗')+'</span><span>🛣️ <b>'+r.dist+'km</b></span>'+(r.dur?'<span>⏱ <b>'+fmtD(r.dur)+'</b></span>':'')+(day?'<span>📅 <b>'+esc(day.title)+'</b></span>':'')+'</div>'
      +(tot?'<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">'+chips.map(c=>'<span class="cost-chip">'+c+'</span>').join('')+(chips.length>1?'<span class="cost-chip" style="background:rgba(184,134,11,.18);">= $'+tot.toFixed(2)+'</span>':'')+'</div>':'')
      +'<button class="btn bg bsm" style="margin-top:4px;" onclick="(function(){var r2=S.routes.find(x=>x.id==='+r.id+');if(r2&&r2.poly){closeDrawerMobile();map.fitBounds(r2.poly.getBounds(),{padding:[50,50]});}})()">🗺️ Show</button>'
      +' <button class="btn bg bsm" style="margin-top:4px;" onclick="openSplitModal('+r.id+')">✂️ Split</button></div>';
  }).join('');
}

