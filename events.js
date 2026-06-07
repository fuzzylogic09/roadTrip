
/* ===================================================
   STATS / RENDER ALL
=================================================== */
function updStats(){
  const km=S.routes.reduce((s,r)=>s+(r.dist||0),0);
  const fuel=totalFuelCost(), hotels=totalHotelCost(), activities=totalActivityCost(),
        transport=totalTransportFixed(), eating=totalEatingBudget(), restoPOI=totalRestaurantPOI(),
        tc=+(fuel+hotels+activities+transport+eating+restoPOI).toFixed(2);
  [['hp',S.pois.length],['hr',S.routes.length],['hd',S.days.length],['hkm',km.toFixed(0)+'km'],['htotal',tc.toFixed(0)],['stp',S.pois.length],['str',S.routes.length],['std',S.days.length],['stkm',km.toFixed(0)]].forEach(([id,v])=>{ const e=qs('#'+id); if(e) e.textContent=v; });
  const stcost=qs('#stcost'); if(stcost) stcost.textContent='$'+tc.toFixed(2);
  const bd=qs('#cost-breakdown-body');
  if(bd){
    const rows=[
      {icon:'⛽',label:'Fuel (car routes)',val:fuel},
      {icon:'🏨',label:'Hotels / Accommodation',val:hotels},
      {icon:'🎯',label:'Activities & Attractions',val:activities},
      {icon:'🎫',label:'Transport (fixed/tolls/parking)',val:transport},
      {icon:'🍽️',label:'Eating budget',val:+(eating+restoPOI).toFixed(2)},
    ];
    bd.innerHTML=rows.map(r=>'<div class="cbrk-row"><span class="cbrk-label">'+r.icon+' '+r.label+'</span><span class="cbrk-val">$'+r.val.toFixed(2)+'</span></div>').join('')
      +'<div class="cbrk-total"><span>💰 Grand total</span><span>$'+tc.toFixed(2)+'</span></div>';
  }
  renderEatingBudgetRows();
  scheduleZoneRefresh();
}
function ra(){ renderPOIs(); renderDays(); renderRoutes(); renderNearby(); updStats(); fillRS('rf','rt','rd'); refMDay(); renderDayOrderLines(); scheduleZoneRefresh(); }

/* ===================================================
   EVENTS
=================================================== */
qs('#btn-drawer').addEventListener('click',toggleDrawer);
qsa('#tabs .tab').forEach(tb=>{ tb.addEventListener('click',()=>{ qsa('#tabs .tab').forEach(x=>x.classList.remove('on')); qsa('.panel').forEach(x=>x.classList.remove('on')); tb.classList.add('on'); qs('#panel-'+tb.dataset.tab).classList.add('on'); qs('#fbar').style.display=tb.dataset.tab==='pois'?'flex':'none'; }); });
qsa('#fbar .fc').forEach(c=>{ c.addEventListener('click',()=>{ S.fcat=c.dataset.cat; qsa('.fc').forEach(x=>x.classList.remove('on')); qsa('[data-cat="'+c.dataset.cat+'"]').forEach(x=>x.classList.add('on')); ra(); }); });
qs('#psrch').addEventListener('input',ev=>doSearch(ev.target.value));
qs('#btn-srch').addEventListener('click',()=>doSearch(qs('#psrch').value));
document.addEventListener('click',ev=>{ if(!ev.target.closest('.sr')&&!ev.target.closest('#srdr')) qs('#srdr').style.display='none'; });
qs('#btn-place').addEventListener('click',()=>{ S.placing=!S.placing; if(S.placing){ hideForMap(); map.getContainer().style.cursor='crosshair'; qs('#fab').classList.add('cancel'); qs('#fab').title='Cancel'; toast('Click/tap the map to place a POI',''); } else{ map.getContainer().style.cursor=''; qs('#fab').classList.remove('cancel'); restoreDrawer(); } });
qs('#btn-new').addEventListener('click',()=>{ S.pendLL=map.getCenter(); openModal(S.pendLL,''); });
qs('#btn-addd').addEventListener('click',addDay);
qs('#m-cancel').addEventListener('click',closeModal);
// Only close modal when mousedown AND mouseup/click both land on backdrop (not on text drag out)
let _mbkDown=false;
qs('#mbk').addEventListener('mousedown',ev=>{ _mbkDown=ev.target===ev.currentTarget; });
qs('#mbk').addEventListener('click',ev=>{ if(_mbkDown&&ev.target===ev.currentTarget) closeModal(); _mbkDown=false; });
qs('#m-cat').addEventListener('change',ev=>{
  qs('#m-ico').textContent=CATS[ev.target.value]||'📍';
  const propRow=qs('#m-propagate-row');
  if(propRow) propRow.style.display=isAccomCat(ev.target.value)?'flex':'none';
});
qsa('.csw').forEach(s=>s.addEventListener('click',()=>selCol(s.dataset.c)));
// #btn-alink removed from form
// Cost type computed update on cost input
qs('#m-cost').addEventListener('input', updateCostTypeUI);
qs('#m-save').addEventListener('click',()=>{
  const name=qs('#m-name').value.trim(); if(!name){ qs('#m-name').focus(); toast('Please enter a name','err'); return; }
  const newDayIds=getSelectedDayIds();
  const propCb=qs('#m-propagate');
  const propagateAccom=propCb?propCb.checked:false;
  const poiColorLocked = qsa('.csw[data-c].on').length > 0;
  // Preserve existing rating/tags/links from the POI being edited (fields removed from form)
  const existingPoi = S.editing ? S.pois.find(x=>x.id===S.editing) : null;
  const data={name,desc:qs('#m-desc').value,cat:qs('#m-cat').value,
    rating:existingPoi?existingPoi.rating:'',
    tags:existingPoi?existingPoi.tags:[],
    links:existingPoi?existingPoi.links:[],
    color:S.col,dayIds:newDayIds,cost:+(qs('#m-cost').value||0),costType:S.costType,propagateAccom,colorLocked:poiColorLocked};
  if(S.editing){ const p=S.pois.find(x=>x.id===S.editing); if(p){ p.name=data.name; p.desc=data.desc; p.cat=data.cat; p.rating=data.rating; p.tags=data.tags; p.links=data.links; p.color=data.color; p.colorLocked=poiColorLocked; p.cost=data.cost; p.costType=data.costType; p.propagateAccom=data.propagateAccom; p.marker.setIcon(mkPin(getPoiColor(p),CATS[p.cat]||'📍')); setPOIDays(p,newDayIds); toast('POI updated','ok'); } }
  else{ if(!S.pendLL){ closeModal(); return; } addPOI(S.pendLL,data); map.flyTo([S.pendLL.lat,S.pendLL.lng],Math.max(map.getZoom(),14)); toast('POI added!','ok'); }
  closeModal(); qs('#psrch').value=''; ra();
});
qs('#re-cancel').addEventListener('click',()=>{ qs('#rmbk').classList.remove('on'); S.editRid=null; });
let _rmbkDown=false;
qs('#rmbk').addEventListener('mousedown',ev=>{ _rmbkDown=ev.target===ev.currentTarget; });
qs('#rmbk').addEventListener('click',ev=>{ if(_rmbkDown&&ev.target===ev.currentTarget){ qs('#rmbk').classList.remove('on'); S.editRid=null; } _rmbkDown=false; });
qs('#re-save').addEventListener('click',async()=>{ const f=qs('#ref').value,t=qs('#ret').value,m=qs('#rem').value,d=qs('#red').value; if(!f||!t){ toast('Select start and end','err'); return; } qs('#rmbk').classList.remove('on'); S.rtCol=S.rtCol2; const rtcl=qsa('.csw[data-rc2].on').length>0; await calcRoute(Number(f),Number(t),m,d?Number(d):null,S.editRid,+(qs('#re-cost').value||0),+(qs('#re-manual-dist').value||0),rtcl); S.editRid=null; });
qs('#btn-calc').addEventListener('click',()=>{ const f=qs('#rf').value,t=qs('#rt').value; if(!f||!t){ toast('Select From and To POIs','err'); return; } hideForMap(); const rtcl=qsa('.csw[data-rc].on').length>0; calcRoute(Number(f),Number(t),qs('#rm').value,qs('#rd').value?Number(qs('#rd').value):null,null,+(qs('#r-cost').value||0),+(qs('#r-manual-dist').value||0),rtcl).then(()=>restoreDrawer()); });
['f-consump','f-price'].forEach(id=>qs('#'+id).addEventListener('input',()=>renderRoutes()));
qs('#btn-gon').addEventListener('click',startGPS); qs('#btn-goff').addEventListener('click',stopGPS);
qs('#t-gpsq').addEventListener('click',()=>{ if(S.gposLL){ closeDrawerMobile(); map.flyTo(S.gposLL,15,{duration:.7}); return; } if(!('geolocation'in navigator)){ toast('No geolocation','err'); return; } navigator.geolocation.getCurrentPosition(pos=>{ const ll=L.latLng(pos.coords.latitude,pos.coords.longitude); setGPos(ll); closeDrawerMobile(); map.flyTo(ll,15,{duration:.7}); if(!S.gps) startGPS(); },()=>toast('Location denied','err'),{enableHighAccuracy:true}); });
['btn-savh','btn-savh2','btn-save'].forEach(id=>qs('#'+id)&&qs('#'+id).addEventListener('click',saveTrip));
['btn-lodh','btn-lodh2','btn-load'].forEach(id=>qs('#'+id)&&qs('#'+id).addEventListener('click',()=>qs('#finp').click()));
qs('#finp').addEventListener('change',ev=>{ const f=ev.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=e2=>loadData(e2.target.result); r.readAsText(f); ev.target.value=''; });
qs('#btn-gpx').addEventListener('click',expGPX);
qs('#btn-clr').addEventListener('click',()=>{ if(confirm('Clear all?')) clearAll(); });
qs('#btn-gsign').addEventListener('click',gdSignIn); qs('#btn-gsout').addEventListener('click',gdSignOut); qs('#btn-gdsv').addEventListener('click',gdSave); qs('#btn-gdls').addEventListener('click',gdList);
['t-theme','t-theme2'].forEach(id=>qs('#'+id)&&qs('#'+id).addEventListener('click',()=>setTheme(document.documentElement.getAttribute('data-theme')!=='dark')));
qs('#t-home').addEventListener('click',()=>{ closeDrawer(); if(S.pois.length) map.fitBounds(L.latLngBounds(S.pois.map(p=>[p.lat,p.lng])),{padding:[60,60]}); else map.setView([46.8,2.3],6); });
qs('#t-sat').addEventListener('click',toggleSat);
qs('#fab').addEventListener('click',()=>{ if(S.placing){ S.placing=false; map.getContainer().style.cursor=''; qs('#fab').classList.remove('cancel'); qs('#fab').title='Add POI'; restoreDrawer(); } else{ hideForMap(); S.placing=true; map.getContainer().style.cursor='crosshair'; qs('#fab').classList.add('cancel'); qs('#fab').title='Cancel'; toast('Tap the map to place a POI',''); } });
document.addEventListener('keydown',ev=>{ if(ev.key==='Escape'){ if(S.placing){ S.placing=false; map.getContainer().style.cursor=''; qs('#fab').classList.remove('cancel'); restoreDrawer(); } else closeDrawer(true); } });
let swX=0;
document.getElementById('map').addEventListener('touchstart',ev=>{ swX=ev.touches[0].clientX; },{passive:true});
document.getElementById('map').addEventListener('touchend',ev=>{ const dx=ev.changedTouches[0].clientX-swX; if(dx>60&&swX<40) openDrawer(); },{passive:true});

/* ===== ROUTE HOVER ===== */
var routeTooltip=null, routeTooltipTimer=null;
function closeRouteTooltip(rt){ if(routeTooltipTimer) clearTimeout(routeTooltipTimer); routeTooltipTimer=setTimeout(function(){ if(routeTooltip){ map.closePopup(routeTooltip); routeTooltip=null; } if(rt&&rt.poly) rt.poly.setStyle({weight:rt.mode==='manual'?3:4.5,opacity:.82}); },350); }
function bindRouteHover(rt){
  if(!rt.poly) return;
  rt.poly.on('mouseover',function(e){ if(routeTooltipTimer){ clearTimeout(routeTooltipTimer); routeTooltipTimer=null; } var day=rt.dayId?S.days.find(function(d){return d.id===rt.dayId;}):null; var fp=getFP(); var fuel=routeFuel(rt); var tot=routeCost(rt); var MI2={car:'🚗 Car',foot:'🚶 Walk',bike:'🚲 Bike',manual:'✏️ Manual'}; var lines=['<b style="font-size:.82rem;font-family:var(--head)">'+esc(rt.fromName)+' → '+esc(rt.toName)+'</b>']; lines.push(MI2[rt.mode]||rt.mode); lines.push('🛣️ <b>'+rt.dist+' km</b>'+(rt.dur?' · ⏱ <b>'+fmtD(rt.dur)+'</b>':'')); if(day) lines.push('📅 <b>'+esc(day.title)+(day.date?' ('+fmtDate(day.date)+')':'')+'</b>'); if(fuel>0) lines.push('⛽ Fuel: <b>$'+fuel.toFixed(2)+'</b>'); if(rt.fixedCost>0) lines.push('🎫 Fixed: <b>$'+rt.fixedCost.toFixed(2)+'</b>'); if(tot>0) lines.push('💰 Total: <b style="color:var(--gold)">$'+tot.toFixed(2)+'</b>'); lines.push('<div style="display:flex;gap:5px;margin-top:6px;"><button class="btn bg bsm" onclick="focusRouteInPanel('+rt.id+')">📋 Details</button><button class="btn bg bsm" onclick="openSplitModal('+rt.id+')">✂️ Split</button></div>'); var popup=L.popup({closeButton:false,offset:[0,-2],className:'route-hover-popup',autoPan:false}).setLatLng(e.latlng).setContent('<div style="font-size:.72rem;line-height:1.75;min-width:180px;">'+lines.join('<br>')+'</div>'); popup.on('add',function(){ setTimeout(function(){ var el=popup.getElement(); if(!el) return; el.addEventListener('mouseenter',function(){ if(routeTooltipTimer){ clearTimeout(routeTooltipTimer); routeTooltipTimer=null; } }); el.addEventListener('mouseleave',function(){ closeRouteTooltip(rt); }); },50); }); if(routeTooltip) map.closePopup(routeTooltip); routeTooltip=popup; popup.openOn(map); rt.poly.setStyle({weight:6,opacity:1}); });
  rt.poly.on('mouseout',function(){ closeRouteTooltip(rt); });
  rt.poly.on('click',function(){ focusRouteInPanel(rt.id); });
}
function focusRouteInPanel(rid){ qsa('.tab').forEach(function(t){ t.classList.toggle('on',t.dataset.tab==='routes'); }); qsa('.panel').forEach(function(p){ p.classList.toggle('on',p.id==='panel-routes'); }); openDrawer(); setTimeout(function(){ var el=qs('#rlist'); if(!el) return; var cards=el.querySelectorAll('.rtc'); var idx=S.routes.findIndex(function(r){ return r.id===rid; }); if(idx>=0&&cards[idx]){ cards[idx].scrollIntoView({behavior:'smooth',block:'nearest'}); cards[idx].style.transition='box-shadow .2s,border-color .2s'; cards[idx].style.borderColor='var(--acc)'; cards[idx].style.boxShadow='0 0 0 2px var(--acc)'; setTimeout(function(){ cards[idx].style.borderColor=''; cards[idx].style.boxShadow=''; },1800); } },80); }

/* ===== DRAWER PIN ===== */
var drawerPinned = localStorage.getItem('rtp_pin')==='1';
function applyPin(){
  var btn=qs('#btn-pin');
  if(drawerPinned){
    document.body.classList.add('drawer-pinned');
    if(btn) btn.classList.add('pin-active');
    document.getElementById('drawer-backdrop').classList.remove('on');
  } else {
    document.body.classList.remove('drawer-pinned');
    if(btn) btn.classList.remove('pin-active');
  }
  // Always invalidate so map reclaims correct space
  setTimeout(()=>{ map.invalidateSize(); scheduleZoneRefresh(); }, 300);
}
function togglePin(){
  if(window.innerWidth<769) return;
  drawerPinned=!drawerPinned;
  localStorage.setItem('rtp_pin',drawerPinned?'1':'0');
  applyPin();
  if(drawerPinned) openDrawer();
  applySettings();
}

/* ===== SPLIT ROUTE ===== */
var splitRouteId=null, splitMapLL=null, splitPickingMap=false;
function openSplitModal(rid){ splitRouteId=rid; splitMapLL=null; splitPickingMap=false; var r=S.routes.find(function(x){return x.id===rid;}); if(!r) return; qs('#split-desc').textContent='Split "'+r.fromName+' to '+r.toName+'" via a mid-point POI.'; qs('#split-poi').innerHTML='<option value="">Select a POI</option>'+S.pois.filter(function(p){return p.id!==r.fromId&&p.id!==r.toId;}).map(function(p){return'<option value="'+p.id+'">'+(CATS[p.cat]||'X')+' '+esc(p.name)+'</option>';}).join(''); qs('#split-poi-name').value='Waypoint'; qs('#split-map-pt').style.display='none'; qs('#smbk').style.display='flex'; }
function closeSplitModal(){ qs('#smbk').style.display='none'; splitRouteId=null; splitMapLL=null; splitPickingMap=false; map.getContainer().style.cursor=''; }
map.on('click',function(e){ if(!splitPickingMap) return; splitPickingMap=false; splitMapLL=e.latlng; map.getContainer().style.cursor=''; qs('#split-map-pt').textContent='Lat '+e.latlng.lat.toFixed(5)+' Lng '+e.latlng.lng.toFixed(5); qs('#split-map-pt').style.display='block'; qs('#smbk').style.display='flex'; });
qs('#btn-split-map').addEventListener('click',function(){ qs('#smbk').style.display='none'; splitPickingMap=true; map.getContainer().style.cursor='crosshair'; toast('Click the map to set the split point',''); });
qs('#split-do').addEventListener('click',async function(){ var r=S.routes.find(function(x){return x.id===splitRouteId;}); if(!r){ closeSplitModal(); return; } var poiVal=qs('#split-poi').value; var midName=qs('#split-poi-name').value.trim()||'Waypoint'; var midPOI=null; if(poiVal){ midPOI=S.pois.find(function(p){return p.id===Number(poiVal);}); } else if(splitMapLL){ midPOI=addPOI(splitMapLL,{name:midName,cat:'general',color:r.color||'#c94f14',locked:true,dayIds:r.dayId?[r.dayId]:[]}); ra(); } else{ toast('Select a POI or pick a map point','err'); return; } if(!midPOI){ toast('Could not create mid-point','err'); return; } var dayId=r.dayId,col=r.color,fId=r.fromId,tId=r.toId,mode=r.mode,dist=r.dist; delRoute(splitRouteId); S.rtCol=col||'#1d56d4'; await calcRoute(fId,midPOI.id,mode,dayId,null,0,mode==='manual'?+(dist/2).toFixed(1):null); S.rtCol=col||'#1d56d4'; await calcRoute(midPOI.id,tId,mode,dayId,null,0,mode==='manual'?+(dist/2).toFixed(1):null); closeSplitModal(); toast('Route split into two','ok'); });
qs('#split-cancel').addEventListener('click',closeSplitModal);
var _smbkDown=false;
qs('#smbk').addEventListener('mousedown',function(ev){ _smbkDown=ev.target===ev.currentTarget; });
qs('#smbk').addEventListener('click',function(ev){ if(_smbkDown&&ev.target===ev.currentTarget) closeSplitModal(); _smbkDown=false; });

/* ===== COLOR PICKERS ===== */
qsa('[data-rc]').forEach(function(s){ s.addEventListener('click',function(){ S.rtCol=s.dataset.rc; qsa('[data-rc]').forEach(function(x){ x.classList.toggle('on',x.dataset.rc===S.rtCol); }); }); });
qsa('[data-rc2]').forEach(function(s){ s.addEventListener('click',function(){ S.rtCol2=s.dataset.rc2; qsa('[data-rc2]').forEach(function(x){ x.classList.toggle('on',x.dataset.rc2===S.rtCol2); }); }); });

/* ===== BOOT ===== */
qsa('[id$="-ver"]').forEach(el=>el.textContent='v'+APP_VERSION);
// Apply saved font scale immediately
document.documentElement.style.setProperty('--fs-scale',(CFG.fontScale/100).toFixed(2));
ra();
qs('#fbar').style.display='flex';
if(window.innerWidth>=769) openDrawer();
applyPin();
applySettings();
toast('RoadTrip Planner v'+APP_VERSION,'ok');
window.addEventListener('load',()=>{ try{ gdInit(); }catch(e){} });
window.addEventListener('resize',()=>{ if(window.innerWidth>=769&&!isDrawerOpen()&&!drawerPinned) openDrawer(); scheduleZoneRefresh(); });
