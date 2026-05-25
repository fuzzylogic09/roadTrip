/* =========================================================
   RoadTrip Planner — app.js  v8.3.0
   ========================================================= */
const APP_VERSION = '8.3.0';
const GOOGLE_CLIENT_ID = '940235006674-1mfg6a2qn7hkqu78irn2af34a507i76u.apps.googleusercontent.com';
const DRIVE_FOLDER = 'RoadTripPlanner';

const DAY_ZONE_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12',
  '#1abc9c','#e67e22','#e91e8c','#00bcd4','#8bc34a'
];

/* ===================================================
   SETTINGS / CONFIG  (persisted to localStorage)
=================================================== */
const CFG_DEFAULTS = {
  showDayZones:      false,
  showZoneTitles:    true,
  showPoiLabels:     false,
  showHourDots:      true,
  showDayOrderLines: false,
  fontScale:         125,
  darkMode:          false,
};
let CFG = Object.assign({}, CFG_DEFAULTS, JSON.parse(localStorage.getItem('rtp_cfg')||'{}'));

function saveCFG(){ localStorage.setItem('rtp_cfg', JSON.stringify(CFG)); }

function setSetting(key, val){
  CFG[key] = val;
  saveCFG();
  applySettings();
}

function applySettings(){
  // Day zones
  const dzBtn = qs('#stog-day-zones');
  if(dzBtn) dzBtn.classList.toggle('on', CFG.showDayZones);
  // Zone-titles sub-toggle enabled only when zones are on
  const ztRow = qs('#stog-zone-titles-row');
  if(ztRow){ ztRow.style.opacity = CFG.showDayZones ? '1':'0.4'; ztRow.style.pointerEvents = CFG.showDayZones ? 'auto':'none'; }
  const ztBtn = qs('#stog-zone-titles');
  if(ztBtn) ztBtn.classList.toggle('on', CFG.showZoneTitles);
  // POI labels
  const plBtn = qs('#stog-poi-labels');
  if(plBtn) plBtn.classList.toggle('on', CFG.showPoiLabels);
  renderPoiLabels();
  // Hour dots
  const hdBtn = qs('#stog-hour-dots');
  if(hdBtn) hdBtn.classList.toggle('on', CFG.showHourDots);
  if(CFG.showHourDots) refreshAllHourDots(); else clearAllHourDots();
  // Day order lines
  const dolBtn = qs('#stog-day-order-lines');
  if(dolBtn) dolBtn.classList.toggle('on', CFG.showDayOrderLines);
  renderDayOrderLines();
  // Font scale
  const slider = qs('#font-scale-slider');
  if(slider) slider.value = CFG.fontScale;
  const scaleVal = qs('#font-scale-val');
  if(scaleVal) scaleVal.textContent = CFG.fontScale + '%';
  document.documentElement.style.setProperty('--fs-scale', (CFG.fontScale/100).toFixed(2));
  // Dark mode
  const darkBtn = qs('#stog-dark');
  if(darkBtn) darkBtn.classList.toggle('on', CFG.darkMode);
  // Pin
  const pinBtn = qs('#stog-pin');
  if(pinBtn) pinBtn.classList.toggle('on', drawerPinned);
  // Satellite
  const satBtn = qs('#stog-sat');
  if(satBtn) satBtn.classList.toggle('on', S.sat);
  // Refresh zones
  scheduleZoneRefresh();
}

function setFontScale(v){
  CFG.fontScale = v;
  saveCFG();
  document.documentElement.style.setProperty('--fs-scale', (v/100).toFixed(2));
  const scaleVal = qs('#font-scale-val');
  if(scaleVal) scaleVal.textContent = v + '%';
}

/* ===================================================
   STATE
=================================================== */
let _id = Date.now();
function nid(){ return ++_id; }

const S = {
  pois:[], routes:[], days:[],
  rtCol:'#1d56d4', rtCol2:'#1d56d4',
  col:'#c94f14', editing:null, placing:false, pendLL:null,
  drawerWasOpen:false,
  gps:false, watchId:null, gposLL:null, gpsMk:null,
  sat:false, fcat:'all', editRid:null,
  drawLines:false, poiLines:[],
  gd:{token:null,user:null,folderId:null},
  // Eating budgets: dayId -> {value, manual}
  // manual=true means user explicitly set it (don't overwrite with default change)
  eatingBudgets:{},   // dayId -> number (explicitly set)
  eatingDefault: 0,
  costType: 'total',
  dayVisibility: {},  // dayId -> bool (false=hidden)
  dayOrderLines: [],  // Leaflet polyline objects for POI-order lines
  poiVisibility: {},  // poiId -> false=hidden, true=force-show, undefined=default
  allPOIsHidden: false, // global "hide all POIs" flag
};

const CATS={general:'📍',hotel:'🏨',camping:'⛺',restaurant:'🍽️',attraction:'🎯',hike:'🥾',view:'🌄',gas:'⛽',parking:'🅿️',info:'ℹ️'};
const RCOL={car:'#1d56d4',foot:'#15803d',bike:'#d4920a',manual:'#9333ea'};
const MI={car:'🚗',foot:'🚶',bike:'🚲',manual:'✏️'};
const PC={};

/* ===================================================
   DRAWER
=================================================== */
function isMobile(){ return window.innerWidth < 769; }
function isDrawerOpen(){ return document.getElementById('drawer').classList.contains('open'); }
function openDrawer(){
  document.getElementById('drawer').classList.add('open');
  if(!(drawerPinned && !isMobile())) document.getElementById('drawer-backdrop').classList.add('on');
  document.getElementById('btn-drawer').classList.add('open');
  setTimeout(()=>{ map.invalidateSize(); scheduleZoneRefresh(); }, 300);
}
function closeDrawer(force){
  if(drawerPinned && !isMobile() && force !== true) return;
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('on');
  document.getElementById('btn-drawer').classList.remove('open');
  // When a pinned drawer is force-closed (✕ button), un-pin so map can fill the space
  if(drawerPinned && !isMobile() && force === true){
    drawerPinned = false;
    localStorage.setItem('rtp_pin','0');
    document.body.classList.remove('drawer-pinned');
    const pinBtn=qs('#btn-pin'); if(pinBtn) pinBtn.classList.remove('pin-active');
    const stogPin=qs('#stog-pin'); if(stogPin) stogPin.classList.remove('on');
  }
  // Wait for CSS slide-out transition then tell Leaflet to reclaim the space
  setTimeout(()=>{ map.invalidateSize(); scheduleZoneRefresh(); }, 300);
}
function toggleDrawer(){ isDrawerOpen() ? closeDrawer(true) : openDrawer(); }
function closeDrawerMobile(){ if(isMobile() && !drawerPinned) closeDrawer(true); }
function hideForMap(){ S.drawerWasOpen = isDrawerOpen(); if(isMobile() && !drawerPinned && S.drawerWasOpen) closeDrawer(true); }
function restoreDrawer(){ if(isMobile() && !drawerPinned && S.drawerWasOpen){ openDrawer(); S.drawerWasOpen=false; } }

/* ===================================================
   MAP
=================================================== */
const map = L.map('map',{zoomControl:true}).setView([46.8,2.3],6);
const TL = {
  st:  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:19})
};
TL.st.addTo(map);

const svgEl = document.getElementById('day-zone-svg');

function mkPin(c,e,sz=27){
  return L.divIcon({className:'',
    html:'<div style="background:'+c+';width:'+sz+'px;height:'+sz+'px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid rgba(255,255,255,.95);box-shadow:0 3px 10px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;"><div style="transform:rotate(45deg);font-size:'+Math.round(sz*.43)+'px;">'+e+'</div></div>',
    iconSize:[sz,sz],iconAnchor:[sz/2,sz],popupAnchor:[0,-(sz+4)]});
}
function mkGps(){
  return L.divIcon({className:'',
    html:'<div style="position:relative;width:22px;height:22px;"><div style="position:absolute;inset:0;border-radius:50%;background:rgba(21,128,61,.18);animation:gpsr 1.5s infinite;"></div><div style="position:absolute;top:5px;left:5px;width:12px;height:12px;background:#15803d;border-radius:50%;border:2px solid #fff;box-shadow:0 0 7px #15803d;"></div></div>',
    iconSize:[22,22],iconAnchor:[11,11]});
}

map.on('click', e => {
  if(S.placing){ S.placing=false; map.getContainer().style.cursor=''; qs('#fab').classList.remove('cancel'); qs('#fab').title='Add POI'; openModal(e.latlng,''); }
});
// zone refresh listeners are set up inside the DAY ZONE OVERLAY section below

function toggleSat(){
  S.sat = !S.sat;
  if(S.sat){ map.removeLayer(TL.st); TL.sat.addTo(map); }
  else{ map.removeLayer(TL.sat); TL.st.addTo(map); }
  const btn = qs('#stog-sat'); if(btn) btn.classList.toggle('on', S.sat);
  const old = qs('#t-sat'); if(old) old.classList.toggle('on', S.sat);
}

/* ===================================================
   THEME
=================================================== */
function setTheme(dark){
  CFG.darkMode = dark;
  saveCFG();
  document.documentElement.setAttribute('data-theme', dark ? 'dark':'light');
  const ico = dark ? '🌙':'☀️';
  ['t-theme','t-theme2'].forEach(id=>{ const e=qs('#'+id); if(e) e.textContent=ico; });
  const darkBtn = qs('#stog-dark'); if(darkBtn) darkBtn.classList.toggle('on', dark);
}
setTheme(CFG.darkMode);

/* ===================================================
   UTILS
=================================================== */
function qs(s,c=document){ return c.querySelector(s); }
function qsa(s,c=document){ return [...c.querySelectorAll(s)]; }
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function fmtD(m){ if(m<60) return m+'min'; const h=Math.floor(m/60); return h+'h'+(m%60?m%60+'min':''); }
function toast(msg,type=''){
  const el=qs('#toast'), t=document.createElement('div');
  t.className='tmsg '+(type||'');
  t.innerHTML=(type==='ok'?'✅ ':type==='err'?'❌ ':'ℹ️ ')+msg;
  el.appendChild(t);
  setTimeout(()=>{ t.style.transition='.26s'; t.style.opacity='0'; t.style.transform='translateY(6px)'; setTimeout(()=>t.remove(),280); },3200);
}

/* ===================================================
   FINANCE
=================================================== */
function getFP(){ return { c: parseFloat(qs('#f-consump').value)||7, p: parseFloat(qs('#f-price').value)||1.70 }; }
function routeFuel(r){ if(r.mode!=='car') return 0; const fp=getFP(); return +(r.dist*(fp.c/100)*fp.p).toFixed(2); }
function routeCost(r){ return +(routeFuel(r)+(r.fixedCost||0)).toFixed(2); }

// Effective cost of a POI — TOTAL across all days (for grand total / POI card)
function poiEffectiveCost(p){
  const base = p.cost || 0;
  if(p.costType === 'perday'){
    const days = (p.dayIds||[]).length || 1;
    return +(base * days).toFixed(2);
  }
  return base;
}
// Cost of a POI attributed to ONE specific day (for per-day cost rows)
function poiCostForDay(p){
  const base = p.cost || 0;
  // Whether total or perday, we show `base` per day (the user entered a per-day amount)
  return base;
}

function totalFuelCost(){ let t=0; S.routes.forEach(r=>t+=routeFuel(r)); return +t.toFixed(2); }
function totalHotelCost(){ let t=0; S.pois.filter(p=>p.cat==='hotel').forEach(p=>t+=poiEffectiveCost(p)); return +t.toFixed(2); }
function totalActivityCost(){ let t=0; S.pois.filter(p=>['attraction','hike','view','general','info'].includes(p.cat)).forEach(p=>t+=poiEffectiveCost(p)); return +t.toFixed(2); }
function totalTransportFixed(){ let t=0; S.pois.filter(p=>p.cat==='gas'||p.cat==='parking').forEach(p=>t+=poiEffectiveCost(p)); S.routes.forEach(r=>t+=(r.fixedCost||0)); return +t.toFixed(2); }
function totalEatingBudget(){ let t=0; S.days.forEach(d=>t+=eatingForDay(d.id)); return +t.toFixed(2); }
function totalRestaurantPOI(){ let t=0; S.pois.filter(p=>p.cat==='restaurant').forEach(p=>t+=poiEffectiveCost(p)); return +t.toFixed(2); }
function tripCost(){ return +(totalFuelCost()+totalHotelCost()+totalActivityCost()+totalTransportFixed()+totalEatingBudget()+totalRestaurantPOI()).toFixed(2); }

function eatingForDay(did){
  const entry = S.eatingBudgets[did];
  if(entry === undefined || entry === null) return S.eatingDefault;
  return +entry;
}
function dayCost(d){
  let t=0;
  d.items.forEach(it=>{
    if(it.type==='route'){ const r=S.routes.find(x=>x.id===it.id); if(r) t+=routeCost(r); }
    if(it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p) t+=poiCostForDay(p); }
  });
  t += eatingForDay(d.id);
  return +t.toFixed(2);
}

/* ===================================================
   EATING BUDGET  (default + per-day override)
=================================================== */
// Apply default to days that haven't been manually set
function applyEatingDefault(val){
  S.eatingDefault = +val || 0;
  // Re-render day eating inputs so the placeholder text (and any auto-value) updates
  // Note: we never overwrite days where eatingBudgets[id] is explicitly set
  renderEatingBudgetRows();
  updStats();
  // Also refresh the eating inputs inside the rendered days list
  qsa('.day-eating-input').forEach(inp=>{
    const did=+inp.dataset.did;
    const overridden = S.eatingBudgets[did] !== undefined && S.eatingBudgets[did] !== null;
    if(!overridden){
      inp.placeholder = S.eatingDefault ? '$'+S.eatingDefault+' (default)' : '$0';
      // Clear any stale entered value so the placeholder shows through
      if(inp.value === '') inp.placeholder = S.eatingDefault ? '$'+S.eatingDefault+' (default)' : '$0';
    }
  });
}

function setDayEating(did, val, manual){
  if(manual){
    S.eatingBudgets[did] = +val || 0;
  } else {
    delete S.eatingBudgets[did];
  }
  renderEatingBudgetRows(); // updates the total in routes tab
  updStats();               // updates grand total in save tab
}

function renderEatingBudgetRows(){
  // Only sync the default input and the total line — per-day overrides live in the Days tab
  const defEl = qs('#eating-default');
  if(defEl && !defEl.matches(':focus')) defEl.value = S.eatingDefault || '';
  const total = +(S.days.reduce((s,d)=>s+eatingForDay(d.id),0)).toFixed(2);
  const totalEl = qs('#eating-total');
  if(totalEl) totalEl.innerHTML='Total eating budget: <b>$'+total.toFixed(2)+'</b> <span style="font-size:.6rem;color:var(--muted);">('+S.days.length+' days × default + custom overrides)</span>';
}

/* ===================================================
   DAY ZONE OVERLAY
=================================================== */
function latlngToPixel(ll){
  const pt = map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
  const rect = map.getContainer().getBoundingClientRect();
  return [pt.x + rect.left, pt.y + rect.top];
}

/* --- Ellipse zone geometry --- */

// Fit the minimum bounding ellipse to a set of 2-D points using PCA.
// Works in any coordinate space (pixels or geo-degrees).
function fitEllipse(pts){
  const n = pts.length;
  const cx = pts.reduce((s,p)=>s+p[0],0)/n;
  const cy = pts.reduce((s,p)=>s+p[1],0)/n;
  let sxx=0,sxy=0,syy=0;
  for(const [x,y] of pts){
    const dx=x-cx, dy=y-cy;
    sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy;
  }
  sxx/=n; sxy/=n; syy/=n;
  const trace=sxx+syy, det=sxx*syy-sxy*sxy;
  const disc=Math.sqrt(Math.max(0,trace*trace/4-det));
  const l1=trace/2+disc;
  let angle=0;
  if(Math.abs(sxy)>1e-12 || Math.abs(sxx-syy)>1e-12) angle=Math.atan2(l1-sxx,sxy);
  const cos=Math.cos(angle), sin=Math.sin(angle);
  let a=0, b=0;
  for(const [x,y] of pts){
    const dx=x-cx, dy=y-cy;
    const u= dx*cos+dy*sin;
    const v=-dx*sin+dy*cos;
    a=Math.max(a,Math.abs(u));
    b=Math.max(b,Math.abs(v));
  }
  return {cx,cy,a,b,angle};
}

// Geo-space padding: add PAD_METRES to the semi-axes measured in geographic degrees.
// By working in degrees, the ellipse has a fixed real-world size regardless of zoom.
// We approximate 1 metre ≈ 1/111320 degrees latitude, and adjust longitude by cos(lat).
const ELLIPSE_PAD_METRES = 3500; // ~3.5 km padding around the outermost POI
const ELLIPSE_EXTRA_METRES = 1500; // extra per retry

function geoPad(latDeg){
  const latPad = ELLIPSE_PAD_METRES / 111320;
  // longitude degrees shrink towards the poles
  const lngPad = ELLIPSE_PAD_METRES / (111320 * Math.cos(latDeg * Math.PI / 180));
  return {latPad, lngPad};
}

// Sample N evenly-spaced angles around an ellipse in GEO-SPACE, then project to pixels.
// cx/cy in geo-degrees, aLat/bLat are semi-axes in geo-degrees,
// aLng/bLng are semi-axes in geo-degrees for x (longitude) direction.
// angle is the PCA rotation angle (in pixel space — close enough for small areas).
function geoEllipseAsPixels(cx_lat, cx_lng, aLat, aLng, bLat, bLng, angle, N=60){
  const pts=[];
  const cos=Math.cos(angle), sin=Math.sin(angle);
  for(let i=0;i<N;i++){
    const t=2*Math.PI*i/N;
    // unrotated ellipse in normalised (u,v) space
    const u=aLat*Math.cos(t), v=bLat*Math.sin(t);
    // rotate — use latitude-equivalent units for both axes
    const dlat = u*cos - v*sin;
    const dlng = (u*sin + v*cos) * (aLng/aLat); // scale lng to correct for aspect
    pts.push(latlngToPixel([cx_lat+dlat, cx_lng+dlng]));
  }
  return pts;
}

// Wobble: small random pixel nudge for hand-drawn look
function wobbleEllipse(pts, seed){
  let r=seed*9301+49297;
  return pts.map(([x,y])=>{
    r=(r*9301+49297)%233280; const rx=(r/233280-.5)*6;
    r=(r*9301+49297)%233280; const ry=(r/233280-.5)*6;
    return [x+rx, y+ry];
  });
}

// Convert point array → smooth SVG path (1 Chaikin pass)
function ellipseToPath(pts){
  const n=pts.length, s=[];
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    s.push([0.75*a[0]+0.25*b[0], 0.75*a[1]+0.25*b[1]]);
    s.push([0.25*a[0]+0.75*b[0], 0.25*a[1]+0.75*b[1]]);
  }
  return 'M'+s[0][0]+','+s[0][1]+s.slice(1).map(([x,y])=>' L'+x+','+y).join('')+' Z';
}

// Ray-casting point-in-polygon
function pointInPolygon([px,py], poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i],[xj,yj]=poly[j];
    if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}

// Build day-zone path in geo-space so size is zoom-invariant.
// geoPts: [[lat,lng],...] all points (POIs + route samples)
// poiGeoPts: [[lat,lng],...] POIs only (must be inside)
// seed: per-day integer for deterministic wobble
function buildDayPath(geoPts, poiGeoPts, seed){
  if(!geoPts.length) return '';

  if(geoPts.length===1){
    // Single point: circle with fixed geo radius
    const [lat,lng]=geoPts[0];
    const pad=geoPad(lat);
    const r=ELLIPSE_PAD_METRES/111320+pad.latPad*0.5;
    const pts=[];
    for(let i=0;i<48;i++){const t=2*Math.PI*i/48; pts.push(latlngToPixel([lat+r*Math.cos(t),lng+(r/Math.cos(lat*Math.PI/180))*Math.sin(t)]));}
    return ellipseToPath(wobbleEllipse(pts,seed));
  }

  // Fit ellipse in lat/lng space
  const {cx:cxLat, cy:cxLng, a:rawALat, b:rawBLat, angle} = fitEllipse(geoPts);
  // Scale longitude semi-axis: degrees-lat and degrees-lng have different metre values
  const cosLat = Math.cos(cxLat*Math.PI/180)||1;
  const rawALng = rawALat;  // PCA angle was found in lat/lng space
  const rawBLng = rawBLat;

  for(let attempt=0; attempt<4; attempt++){
    const extraMetres = attempt*ELLIPSE_EXTRA_METRES;
    const padLat = (ELLIPSE_PAD_METRES+extraMetres)/111320;
    const padLng = (ELLIPSE_PAD_METRES+extraMetres)/(111320*cosLat);
    const aLat = Math.max(rawALat+padLat, padLat);
    const bLat = Math.max(rawBLat+padLat, padLat);
    const aLng = aLat/cosLat;  // keep aspect ratio correct
    const bLng = bLat/cosLat;

    const perim  = geoEllipseAsPixels(cxLat,cxLng,aLat,aLng,bLat,bLng,angle,60);
    const wobbled = wobbleEllipse(perim, seed);
    const pathD  = ellipseToPath(wobbled);

    // Verify all POI pixels are inside
    const poly = pathD.replace(/[MLZ]/g,' ').trim().split(/\s+/).reduce((acc,_,i,arr)=>{
      if(i%2===0){const x=parseFloat(arr[i]),y=parseFloat(arr[i+1]);if(!isNaN(x)&&!isNaN(y))acc.push([x,y]);}return acc;
    },[]);
    const allIn = poiGeoPts.map(latlngToPixel).every(pt=>pointInPolygon(pt,poly));
    if(allIn || attempt===3) return pathD;
  }
  return '';
}

/* --- Debounced rAF-based zone refresh --- */
let _dzRafId = null;

// Hide SVG during any map motion (pan or zoom) for zero-lag, redraw after
map.on('movestart', ()=>{ if(CFG.showDayZones) svgEl.style.display='none'; });
map.on('move',      ()=>{ if(CFG.showDayZones) svgEl.style.display='none'; });
map.on('zoomstart', ()=>{ if(CFG.showDayZones) svgEl.style.display='none'; });
map.on('zoom',      ()=>{ if(CFG.showDayZones) svgEl.style.display='none'; });
map.on('moveend',   scheduleZoneRefresh);
map.on('zoomend',   scheduleZoneRefresh);

function scheduleZoneRefresh(){
  if(_dzRafId) cancelAnimationFrame(_dzRafId);
  _dzRafId = requestAnimationFrame(()=>{
    _dzRafId = null;
    svgEl.style.display='';
    refreshDayZones();
  });
}

function refreshDayZones(){
  if(!CFG.showDayZones){ svgEl.innerHTML=''; return; }
  const ns = 'http://www.w3.org/2000/svg';
  const W = window.innerWidth, H = window.innerHeight;
  svgEl.setAttribute('width', W); svgEl.setAttribute('height', H);
  svgEl.setAttribute('viewBox', '0 0 '+W+' '+H);
  svgEl.innerHTML = '';

  S.days.forEach((d, di) => {
    if(isDayHidden(d.id)) return;

    // Collect geo points — keep POI geo pts separate for containment check
    const poiGeoPts = [];
    const routeGeoPts = [];
    d.items.forEach(it => {
      if(it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p) poiGeoPts.push([p.lat,p.lng]); }
      if(it.type==='route'){ const r=S.routes.find(x=>x.id===it.id); if(r&&r.coords){
        const step=Math.max(1,Math.floor(r.coords.length/20));
        for(let i=0;i<r.coords.length;i+=step) routeGeoPts.push(r.coords[i]);
      }}
    });
    const allGeoPts=[...poiGeoPts,...routeGeoPts];
    if(!allGeoPts.length) return;

    // Quick viewport cull: skip days entirely off-screen
    const margin=600;
    const anyVisible=allGeoPts.some(geo=>{
      const [x,y]=latlngToPixel(geo);
      return x>-margin&&x<W+margin&&y>-margin&&y<H+margin;
    });
    if(!anyVisible) return;

    const color=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const [r2,g2,b2]=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];
    const rgba=a=>`rgba(${r2},${g2},${b2},${a})`;

    // Build geo-invariant ellipse path
    const pathD=buildDayPath(allGeoPts, poiGeoPts, di+1);
    if(!pathD) return;

    // Blur filter
    const fid='blur-d'+di;
    const defs=document.createElementNS(ns,'defs');
    const filter=document.createElementNS(ns,'filter');
    filter.setAttribute('id',fid); filter.setAttribute('x','-40%'); filter.setAttribute('y','-40%');
    filter.setAttribute('width','180%'); filter.setAttribute('height','180%');
    const feG=document.createElementNS(ns,'feGaussianBlur'); feG.setAttribute('stdDeviation','10');
    filter.appendChild(feG); defs.appendChild(filter); svgEl.appendChild(defs);

    // Soft fill
    const fill=document.createElementNS(ns,'path');
    fill.setAttribute('d',pathD); fill.setAttribute('fill',rgba(0.14));
    fill.setAttribute('filter',`url(#${fid})`);
    svgEl.appendChild(fill);

    // Dashed stroke
    const stroke=document.createElementNS(ns,'path');
    stroke.setAttribute('d',pathD); stroke.setAttribute('fill',rgba(0.07));
    stroke.setAttribute('stroke',rgba(0.7)); stroke.setAttribute('stroke-width','2.5');
    stroke.setAttribute('stroke-dasharray','10 5');
    stroke.setAttribute('stroke-linecap','round'); stroke.setAttribute('stroke-linejoin','round');
    svgEl.appendChild(stroke);

    // Day title — at the CENTROID of all geo points, projected to pixels
    if(CFG.showZoneTitles){
      const centLat=allGeoPts.reduce((s,p)=>s+p[0],0)/allGeoPts.length;
      const centLng=allGeoPts.reduce((s,p)=>s+p[1],0)/allGeoPts.length;
      const [centX,centY]=latlngToPixel([centLat,centLng]);
      const title=(d.title||('Day '+(di+1)))+(d.date?' · '+d.date:'');
      const lbl=document.createElementNS(ns,'text');
      lbl.setAttribute('x',centX); lbl.setAttribute('y',centY);
      lbl.setAttribute('text-anchor','middle'); lbl.setAttribute('dominant-baseline','middle');
      lbl.setAttribute('font-size','13'); lbl.setAttribute('font-weight','800');
      lbl.setAttribute('font-family','Nunito,sans-serif');
      lbl.setAttribute('fill',rgba(0.92));
      lbl.setAttribute('paint-order','stroke');
      lbl.setAttribute('stroke','rgba(255,255,255,0.9)');
      lbl.setAttribute('stroke-width','4');
      lbl.setAttribute('stroke-linejoin','round');
      lbl.textContent=title;
      svgEl.appendChild(lbl);
    }
  });
}

/* ===================================================
   POI LABELS ON MAP
=================================================== */
const poiLabelLayer = L.layerGroup().addTo(map);

function renderPoiLabels(){
  poiLabelLayer.clearLayers();
  if(!CFG.showPoiLabels) return;
  S.pois.forEach(p => {
    if(!poiEffectivelyVisible(p)) return; // skip hidden POIs
    const lbl = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="background:rgba(255,255,255,.88);border:1px solid '+p.color+';border-radius:4px;padding:1px 5px;font-size:.6rem;font-weight:700;color:'+p.color+';white-space:nowrap;pointer-events:none;margin-top:2px;">'+esc(p.name)+'</div>',
        iconSize: [null,null], iconAnchor: [-14, 27]
      }),
      interactive: false, zIndexOffset: -500
    });
    poiLabelLayer.addLayer(lbl);
  });
}

/* ===================================================
   DAY ORDER LINES  (straight lines joining POIs in day order)
=================================================== */
function renderDayOrderLines(){
  // Clear existing
  S.dayOrderLines.forEach(l=>map.removeLayer(l));
  S.dayOrderLines=[];
  if(!CFG.showDayOrderLines) return;
  S.days.forEach((d,di)=>{
    if(isDayHidden(d.id)) return;
    const color=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const pts=[];
    d.items.forEach(it=>{
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id);
        if(p && poiEffectivelyVisible(p)) pts.push([p.lat,p.lng]);
      }
    });
    if(pts.length<2) return;
    const line=L.polyline(pts,{color,weight:2,opacity:0.75,dashArray:'6 4'}).addTo(map);
    // Number each segment with a small order label
    pts.forEach((pt,i)=>{
      if(i===0) return;
      const lbl=L.marker([(pts[i-1][0]+pt[0])/2,(pts[i-1][1]+pt[1])/2],{
        icon:L.divIcon({className:'',html:'<div style="background:'+color+';color:#fff;font-size:.55rem;font-weight:800;border-radius:8px;padding:1px 4px;white-space:nowrap;pointer-events:none;">'+i+'</div>',iconSize:[null,null],iconAnchor:[0,0]}),
        interactive:false,zIndexOffset:-600
      }).addTo(map);
      S.dayOrderLines.push(lbl);
    });
    S.dayOrderLines.push(line);
  });
}

/* ===================================================
   UNIFIED VISIBILITY   (day + individual POI)
=================================================== */
function isDayHidden(did){ return S.dayVisibility[did]===false; }

/**
 * Effective visibility of a POI:
 *
 *  poiVisibility[id]:
 *    false     = explicitly hidden (individual button)
 *    true      = force-shown (overrides global hide)
 *    undefined = default
 *
 *  S.allPOIsHidden: global "hide all" flag
 *
 *  Priority:
 *    1. Individual false  → hidden
 *    2. Individual true   → shown (even if global hide is on)
 *    3. Has day assignments:
 *         At least one day visible → shown (overrides global hide)
 *         All days hidden          → hidden
 *    4. Free POI (no days): follows S.allPOIsHidden
 */
function poiEffectivelyVisible(p){
  if(S.poiVisibility[p.id]===false) return false;
  if(S.poiVisibility[p.id]===true)  return true;
  const days=p.dayIds||[];
  if(days.length) return days.some(did=>!isDayHidden(did));
  return !S.allPOIsHidden;
}

function applyAllMarkerVisibility(){
  S.pois.forEach(p=>{
    const show=(S.fcat==='all'||p.cat===S.fcat) && poiEffectivelyVisible(p);
    try{ show?map.addLayer(p.marker):map.removeLayer(p.marker); }catch(e){}
  });
  S.routes.forEach(r=>{
    if(!r.poly) return;
    const hidden=r.dayId && isDayHidden(r.dayId);
    try{ hidden?map.removeLayer(r.poly):map.addLayer(r.poly); }catch(e){}
  });
}

/* --- Day visibility --- */
function setDayVisibility(did, visible){
  if(visible) delete S.dayVisibility[did];
  else S.dayVisibility[did]=false;
  applyAllMarkerVisibility();
  renderPOIs(); renderDays(); renderDayOrderLines(); scheduleZoneRefresh();
}
function setAllDaysVisibility(visible){
  S.days.forEach(d=>{ if(visible) delete S.dayVisibility[d.id]; else S.dayVisibility[d.id]=false; });
  applyAllMarkerVisibility();
  renderPOIs(); renderDays(); renderDayOrderLines(); scheduleZoneRefresh();
}

/* --- Individual POI visibility --- */
function isPOIHidden(pid){ return S.poiVisibility[pid]===false; }
function setPOIVisibility(pid, visible){
  if(visible) delete S.poiVisibility[pid]; // back to default
  else        S.poiVisibility[pid]=false;
  applyAllMarkerVisibility();
  renderPOIs(); renderDayOrderLines(); scheduleZoneRefresh();
}

/* --- Global POI show/hide (separate flag, never pollutes per-POI state) --- */
function setAllPOIsVisibility(visible){
  S.allPOIsHidden = !visible;
  applyAllMarkerVisibility();
  renderPOIs(); renderDayOrderLines(); scheduleZoneRefresh();
}
function interpolateCoords(coords, fraction){
  const totalLen = coords.reduce((acc,_,i)=>{ if(!i) return acc; return acc+L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i])); },0);
  const target = fraction * totalLen; let walked=0;
  for(let i=1;i<coords.length;i++){
    const seg = L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i]));
    if(walked+seg>=target){ const t=(target-walked)/seg; return [coords[i-1][0]+t*(coords[i][0]-coords[i-1][0]), coords[i-1][1]+t*(coords[i][1]-coords[i-1][1])]; }
    walked+=seg;
  }
  return coords[coords.length-1];
}
function placeHourDots(rt){
  if(rt.hourDotMarkers) rt.hourDotMarkers.forEach(m=>map.removeLayer(m));
  rt.hourDotMarkers = [];
  if(!CFG.showHourDots||!rt.coords||rt.coords.length<2||!rt.dur||rt.dur<=0) return;
  const hours=rt.dur/60, numDots=Math.floor(hours), color=rt.color||RCOL[rt.mode]||'#1d56d4';
  for(let h=1;h<=numDots;h++){
    const frac=h/hours; if(frac>=1) break;
    const ll=interpolateCoords(rt.coords,frac);
    const m=L.marker(ll,{icon:L.divIcon({className:'',html:'<div class="route-hour-dot" style="background:'+color+';"></div>',iconSize:[9,9],iconAnchor:[4.5,4.5]}),zIndexOffset:-100,interactive:true}).addTo(map);
    m.bindTooltip('+'+fmtD(h*60)+' · '+rt.fromName+'→'+rt.toName,{direction:'top',offset:[0,-6]});
    rt.hourDotMarkers.push(m);
  }
}
function clearAllHourDots(){ S.routes.forEach(rt=>{ if(rt.hourDotMarkers){ rt.hourDotMarkers.forEach(m=>map.removeLayer(m)); rt.hourDotMarkers=[]; } }); }
function refreshAllHourDots(){ S.routes.forEach(rt=>placeHourDots(rt)); }
function clearRouteHourDots(r){ if(r.hourDotMarkers){ r.hourDotMarkers.forEach(m=>map.removeLayer(m)); r.hourDotMarkers=[]; } }

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
    marker:null
  };
  const mk = L.marker([p.lat,p.lng],{icon:mkPin(p.color,CATS[p.cat]||'📍'),draggable:false}).addTo(map);
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
}
function popH(p){
  const stars=p.rating?'★'.repeat(+p.rating)+'☆'.repeat(5-+p.rating):'';
  const links=(p.links||[]).filter(l=>l.url).map(l=>'<a class="lchip" href="'+l.url+'" target="_blank">🔗 '+(l.label||l.url.slice(0,20))+'</a>').join(' ');
  const tags=(p.tags||[]).map(t=>'<span class="tag">'+t+'</span>').join('');
  const dayNames=(p.dayIds||[]).map(did=>{ const d=S.days.find(x=>x.id===did); return d?esc(d.title):null; }).filter(Boolean);
  const eff=poiEffectiveCost(p);
  const costStr = p.costType==='perday' && (p.dayIds||[]).length>1
    ? '$'+p.cost.toFixed(2)+'/day × '+(p.dayIds||[]).length+' = $'+eff.toFixed(2)
    : '$'+eff.toFixed(2);
  return '<div class="pt">'+(CATS[p.cat]||'📍')+' '+esc(p.name)+'</div>'
    +(stars?'<div class="pr">'+stars+'</div>':'')
    +(eff?'<div class="pr">💰 <b style="color:var(--gold);">'+costStr+'</b></div>':'')
    +(p.desc?'<div class="pd">'+esc(p.desc)+'</div>':'')
    +(dayNames.length?'<div class="pr">📅 <b>'+dayNames.join(', ')+'</b></div>':'')
    +(links?'<div class="pr">'+links+'</div>':'')
    +(tags?'<div class="pr">'+tags+'</div>':'')
    +'<div class="pop-photos"></div>'
    +'<div class="pr" style="font-size:.61rem;color:var(--muted);margin-top:2px;">'+p.lat.toFixed(5)+', '+p.lng.toFixed(5)+' · '+(p.locked?'🔒':'🔓')+'</div>'
    +'<div class="pa"><button class="btn bg bsm" onclick="editPOI('+p.id+')">✏️ Edit</button>'
    +'<button class="btn bg bsm" onclick="toggleLock('+p.id+')">'+(p.locked?'🔓 Unlock':'🔒 Lock')+'</button>'
    +'<button class="btn br bsm" onclick="delPOI('+p.id+')">🗑</button></div>';
}
function toggleLock(id){ const p=S.pois.find(x=>x.id===id); if(!p) return; p.locked=!p.locked; p.marker.dragging[p.locked?'disable':'enable'](); p.marker.closePopup(); toast(p.locked?'🔒 Locked':'🔓 Unlocked',''); }
function editPOI(id){
  const p=S.pois.find(x=>x.id===id); if(!p) return;
  S.editing=id;
  qs('#m-name').value=p.name; qs('#m-desc').value=p.desc||''; qs('#m-cat').value=p.cat; qs('#m-rat').value=p.rating||'';
  qs('#m-tags').value=(p.tags||[]).join(', '); qs('#m-cost').value=p.cost||'';
  selCol(p.color); renderLinks(p.links||[]);
  qs('#m-hd').textContent='Edit POI'; qs('#m-ico').textContent=CATS[p.cat]||'📍';
  // cost type
  setCostType(p.costType||'total');
  refMDay(); renderMDayCheckboxes(p.dayIds||[]);
  updateCostTypeUI();
  // Propagate checkbox — only relevant for accommodation categories
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

function renderPOIs(){
  const el=qs('#poi-list'); qs('#pcnt').textContent=S.pois.length;
  const vis=S.pois
    .filter(p=>S.fcat==='all'||p.cat===S.fcat)
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
    const dayBadges=(p.dayIds||[]).map(did=>{ const d=S.days.find(x=>x.id===did); if(!d) return''; const di=S.days.indexOf(d); const c=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length]; const dimmed=isDayHidden(did); return'<span class="pday-badge" style="background:'+c+';'+(dimmed?'opacity:.4;':'')+'">'+esc(d.title)+'</span>'; }).join('');
    const eff=poiEffectiveCost(p);
    const costStr = p.costType==='perday' && (p.dayIds||[]).length>1 ? '$'+p.cost+'/day':'';
    // Eye icon: shows individual state; if dimmed by day, show a different hint
    const eyeIcon  = individuallyHidden ? '👁‍🗨' : '👁';
    const eyeTitle = individuallyHidden ? 'Show POI' : (hiddenByDays ? 'Hidden by day — click to force show' : 'Hide POI');
    return '<div class="poic" data-pid="'+p.id+'" onclick="focusPOI('+p.id+')" style="'+(effectivelyHidden?'opacity:.4;':'')+'}">'
      +'<div class="ppin" style="background:'+p.color+'22;color:'+p.color+';">'+(CATS[p.cat]||'📍')+'</div>'
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
function updDay(id,k,v){ const d=S.days.find(x=>x.id===id); if(d) d[k]=v; }
function delDay(id){
  const d=S.days.find(x=>x.id===id); if(!d) return;
  d.items.filter(i=>i.type==='poi').forEach(i=>{ const p=S.pois.find(x=>x.id===i.id); if(p) p.dayIds=(p.dayIds||[]).filter(x=>x!==id); });
  delete S.eatingBudgets[id];
  S.days=S.days.filter(x=>x.id!==id); ra();
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
      if(it.type==='poi'){ const p=S.pois.find(x=>x.id===it.id); if(p&&poiCostForDay(p)>0) costRows.push({l:(CATS[p.cat]||'📍')+' '+p.name+(p.costType==='perday'?' (per day)':''),c:poiCostForDay(p),s:''}); }
      if(it.type==='route'){ const r=S.routes.find(x=>x.id===it.id); if(r){ const tot=routeCost(r),fuel=routeFuel(r); if(tot>0){ const sub=[]; if(fuel>0) sub.push('fuel $'+fuel.toFixed(2)); if(r.fixedCost>0) sub.push('fixed $'+r.fixedCost.toFixed(2)); costRows.push({l:(MI[r.mode]||'🛣️')+' '+r.fromName+'→'+r.toName,c:tot,s:sub.join(' + ')}); } } }
    });
    if(eating>0) costRows.push({l:'🍽️ Eating'+(eatingOverridden?' (custom)':' (default)'),c:eating,s:''});
    const ghosts=getGhostItemsForDay(di);
    let items='';
    if(!d.items.length && !ghosts.length) items='<div class="empty-day">Empty — assign POIs via ✏️ Edit</div>';

    // Ghost items (accommodation from previous day) — rendered first, not draggable above
    ghosts.forEach(g=>{
      const p=S.pois.find(x=>x.id===g.poiId); if(!p) return;
      items+='<div class="day-item" style="opacity:.45;background:rgba(0,0,0,.04);border-style:dashed;cursor:default;" title="Starting point (from previous day)">'
        +'<span style="font-size:.7rem;flex-shrink:0;">🔗</span>'
        +'<div class="dipin" style="background:'+p.color+'22;color:'+p.color+';">'+(CATS[p.cat]||'📍')+'</div>'
        +'<span class="diname" style="color:var(--muted);">'+esc(p.name)+' <span style="font-size:.58rem;">(carry-over)</span></span>'
        +'<button class="btn bg bic bsm" onclick="focusPOI('+p.id+')" style="opacity:.6;">👁</button>'
        +'</div>';
    });
    if(ghosts.length) items+='<div style="border-top:1.5px dashed var(--border2);margin:3px 0 4px;"></div>';
    d.items.forEach((it,idx)=>{
      items+='<div class="day-dropzone" data-did="'+d.id+'" data-idx="'+idx+'"></div>';
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id); if(!p) return;
        items+='<div class="day-item" draggable="true" data-did="'+d.id+'" data-idx="'+idx+'" data-itype="poi" data-iid="'+p.id+'">'
          +'<span class="di-grip">⋮⋮</span>'
          +'<div class="dipin" style="background:'+p.color+'22;color:'+p.color+';">'+(CATS[p.cat]||'📍')+'</div>'
          +'<span class="diname" ondblclick="editPOI('+p.id+')" onclick="focusPOI('+p.id+')">'+esc(p.name)+'</span>'
          +(poiCostForDay(p)?'<span class="di-cost">$'+poiCostForDay(p).toFixed(2)+'</span>':'')
          +'<button class="btn bg bic bsm" onclick="editPOI('+p.id+')" title="Edit">✏️</button>'
          +'<button class="btn bg bic bsm" onclick="focusPOI('+p.id+')">👁</button>'
          +'<button class="btn br bic bsm" onclick="rmItem('+d.id+','+idx+')">✕</button></div>';
      } else if(it.type==='route'){
        const r=S.routes.find(x=>x.id===it.id); if(!r) return;
        const tot=routeCost(r);
        items+='<div class="day-item" draggable="true" data-did="'+d.id+'" data-idx="'+idx+'" data-itype="route" data-iid="'+r.id+'" style="background:rgba(29,86,212,.05);border-color:rgba(29,86,212,.2);">'
          +'<span class="di-grip">⋮⋮</span><span style="flex-shrink:0;">'+(MI[r.mode]||'🛣️')+'</span>'
          +'<span class="diname" style="color:var(--blue);" onclick="(function(){var r2=S.routes.find(x=>x.id==='+r.id+');if(r2&&r2.poly){closeDrawerMobile();map.fitBounds(r2.poly.getBounds(),{padding:[50,50]});}})()">'+esc(r.fromName)+'→'+esc(r.toName)+' <span style="font-size:.61rem;">'+r.dist+'km</span></span>'
          +(tot?'<span class="di-cost">$'+tot.toFixed(2)+'</span>':'')
          +'<button class="btn bg bic bsm" onclick="openRouteEdit('+r.id+')" title="Edit">✏️</button>'
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
    const zoneColor=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const eatPlaceholder=S.eatingDefault?'$'+S.eatingDefault+' (default)':'$0';
    const hidden=isDayHidden(d.id);
    return '<div class="dayc" data-dcid="'+d.id+'"'+(hidden?' style="opacity:.45;"':'')+'>'
      +'<div class="dayh"><div class="dayn-bubble" style="background:'+zoneColor+';">'+(di+1)+'</div>'
      +'<input class="dayti" value="'+esc(d.title)+'" onchange="updDay('+d.id+',\'title\',this.value)">'
      +'<input class="daydi" type="date"'+(d.date?' value="'+d.date+'"':'')+' onchange="updDay('+d.id+',\'date\',this.value)">'
      +'<button class="btn bg bic bsm" onclick="setDayVisibility('+d.id+','+(hidden?'true':'false')+')" title="'+(hidden?'Show day':'Hide day')+'" style="font-size:.85rem;">'+(hidden?'👁‍🗨':'👁')+'</button>'
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
async function calcRoute(fi,ti,mode,dayId,editId,fixedCost,manualDist){
  const from=S.pois.find(p=>p.id===fi||p.id==fi), to=S.pois.find(p=>p.id===ti||p.id==ti);
  if(!from||!to){ toast('POIs not found','err'); return; }
  if(from.id===to.id){ toast('Same start and end!','err'); return; }
  const fc=+(fixedCost||0); let dist,dur,coords,poly;
  if(mode==='manual'){
    dist=+(manualDist||from.marker.getLatLng().distanceTo(to.marker.getLatLng())/1000).toFixed(1);
    dur=0; coords=[[from.lat,from.lng],[to.lat,to.lng]];
    poly=L.polyline(coords,{color:S.rtCol||RCOL.manual,weight:3,opacity:.8,dashArray:'10 6'}).addTo(map);
    closeDrawerMobile(); map.fitBounds(L.latLngBounds(coords),{padding:[50,50]});
  } else {
    toast('Calculating...','');
    try{
      const res=await fetch('https://router.project-osrm.org/route/v1/'+({car:'car',foot:'foot',bike:'bike'}[mode]||'car')+'/'+from.lng+','+from.lat+';'+to.lng+','+to.lat+'?overview=full&geometries=geojson');
      const data=await res.json();
      if(data.code!=='Ok'){ toast('Route not found','err'); return; }
      dist=+(data.routes[0].distance/1000).toFixed(1); dur=Math.round(data.routes[0].duration/60);
      coords=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      poly=L.polyline(coords,{color:S.rtCol||RCOL[mode]||'#1d56d4',weight:4.5,opacity:.82,dashArray:mode==='foot'?'8 5':null}).addTo(map);
      closeDrawerMobile(); map.fitBounds(poly.getBounds(),{padding:[50,50]});
    }catch(e){ toast('Connection error','err'); return; }
  }
  if(editId){
    const old=S.routes.find(r=>r.id===editId);
    if(old){ if(old.poly) map.removeLayer(old.poly); clearRouteHourDots(old); S.routes=S.routes.filter(r=>r.id!==editId); S.days.forEach(d=>{ d.items=d.items.filter(i=>!(i.type==='route'&&i.id===editId)); }); }
  }
  const rid=editId||nid();
  const rt={id:rid,fromId:from.id,toId:to.id,fromName:from.name,toName:to.name,mode,dist,dur,coords,poly,dayId:dayId||null,fixedCost:fc,color:S.rtCol||RCOL[mode]||'#1d56d4',hourDotMarkers:[]};
  S.routes.push(rt); bindRouteHover(rt); placeHourDots(rt);
  if(dayId){ const d=S.days.find(x=>x.id==dayId); if(d&&!d.items.some(i=>i.type==='route'&&i.id===rid)) d.items.push({type:'route',id:rid}); }
  ra(); const tc=routeCost(rt); toast(dist+'km'+(dur?' · '+fmtD(dur):'')+(tc?' · $'+tc.toFixed(2):'')+' ✓','ok'); return rt;
}
async function refreshRt(pid){ for(const r of S.routes.filter(r=>r.fromId===pid||r.toId===pid)){ toast('Updating route…',''); await calcRoute(r.fromId,r.toId,r.mode,r.dayId,r.id,r.fixedCost,r.mode==='manual'?r.dist:null); } }
function delRoute(id){
  const i=S.routes.findIndex(r=>r.id===id); if(i<0) return;
  if(S.routes[i].poly) map.removeLayer(S.routes[i].poly); clearRouteHourDots(S.routes[i]); S.routes.splice(i,1);
  S.days.forEach(d=>{ d.items=d.items.filter(i=>!(i.type==='route'&&i.id===id)); }); ra();
}
function openRouteEdit(id){
  S.editRid=id; const r=S.routes.find(x=>x.id===id); if(!r) return;
  fillRS('ref','ret','red'); qs('#ref').value=r.fromId; qs('#ret').value=r.toId; qs('#rem').value=r.mode;
  qs('#red').value=r.dayId||''; qs('#re-cost').value=r.fixedCost||''; qs('#re-manual-dist').value=r.mode==='manual'?r.dist:'';
  S.rtCol2=r.color||'#1d56d4'; qsa('[data-rc2]').forEach(s2=>s2.classList.toggle('on',s2.dataset.rc2===S.rtCol2)); qs('#rmbk').classList.add('on');
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
    return '<div class="rtc"><div class="rth"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+(r.color||'#1d56d4')+';margin-right:3px;"></span><span class="rnum">#'+(i+1)+'</span><span class="rname">'+esc(r.fromName)+' → '+esc(r.toName)+'</span><button class="btn bg bic bsm" onclick="openRouteEdit('+r.id+')">✏️</button><button class="btn br bic bsm" onclick="delRoute('+r.id+')">🗑</button></div>'
      +'<div class="rmeta"><span>'+(MI[r.mode]||'🚗')+'</span><span>🛣️ <b>'+r.dist+'km</b></span>'+(r.dur?'<span>⏱ <b>'+fmtD(r.dur)+'</b></span>':'')+(day?'<span>📅 <b>'+esc(day.title)+'</b></span>':'')+'</div>'
      +(tot?'<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">'+chips.map(c=>'<span class="cost-chip">'+c+'</span>').join('')+(chips.length>1?'<span class="cost-chip" style="background:rgba(184,134,11,.18);">= $'+tot.toFixed(2)+'</span>':'')+'</div>':'')
      +'<button class="btn bg bsm" style="margin-top:4px;" onclick="(function(){var r2=S.routes.find(x=>x.id==='+r.id+');if(r2&&r2.poly){closeDrawerMobile();map.fitBounds(r2.poly.getBounds(),{padding:[50,50]});}})()">🗺️ Show</button>'
      +' <button class="btn bg bsm" style="margin-top:4px;" onclick="openSplitModal('+r.id+')">✂️ Split</button></div>';
  }).join('');
}

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
  if(!S.days.length){ el.innerHTML='<div style="font-size:.65rem;color:var(--muted);">No days yet.</div>'; return; }
  el.innerHTML=S.days.map((d,di)=>{
    const checked=selectedIds.includes(d.id)?'checked':'';
    const c=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    return'<label class="mday-row"><input type="checkbox" value="'+d.id+'" '+checked+' onchange="updateCostTypeUI()"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+c+';flex-shrink:0;"></span>'+esc(d.title)+(d.date?' <span style="color:var(--muted2);font-size:.6rem;">'+d.date+'</span>':'')+'</label>';
  }).join('');
  updateCostTypeUI();
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
    qs('#m-name').value=name||''; qs('#m-desc').value=''; qs('#m-cat').value='general'; qs('#m-rat').value='';
    qs('#m-tags').value=''; qs('#m-cost').value='';
    selCol('#c94f14'); renderLinks([]); qs('#m-hd').textContent='New POI'; qs('#m-ico').textContent='📍';
    setCostType('total'); renderMDayCheckboxes([]);
    const propRow=qs('#m-propagate-row'); if(propRow) propRow.style.display='none';
    const propCb=qs('#m-propagate'); if(propCb) propCb.checked=true;
  }
  refMDay();
  qs('#mbk').classList.add('on'); setTimeout(()=>qs('#m-name').focus(),80);
}
function closeModal(){ qs('#mbk').classList.remove('on'); S.editing=null; restoreDrawer(); }
function selCol(c){ S.col=c; qsa('.csw').forEach(s=>s.classList.toggle('on',s.dataset.c===c)); }
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
    pois:S.pois.map(p=>({id:p.id,name:p.name,desc:p.desc,cat:p.cat,color:p.color,rating:p.rating,links:p.links,tags:p.tags,lat:p.lat,lng:p.lng,locked:p.locked,dayIds:p.dayIds||[],cost:p.cost||0,costType:p.costType||'total',propagateAccom:p.propagateAccom!==false})),
    routes:S.routes.map(r=>({id:r.id,fromId:r.fromId,toId:r.toId,fromName:r.fromName,toName:r.toName,mode:r.mode,dist:r.dist,dur:r.dur,dayId:r.dayId,fixedCost:r.fixedCost||0,color:r.color||'#1d56d4'})),
    days:S.days.map(d=>({id:d.id,title:d.title,date:d.date||'',items:d.items.map(i=>Object.assign({},i))}))};
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
    (d.days||[]).forEach(day=>S.days.push({id:Number(day.id),title:day.title,date:day.date||'',items:(day.items||[]).map(i=>Object.assign({},i))}));
    (d.pois||[]).forEach(p=>{ const dayIds=p.dayIds||(p.dayId?[Number(p.dayId)]:[]); addPOI({lat:p.lat,lng:p.lng},{id:Number(p.id),name:p.name,desc:p.desc,cat:p.cat,color:p.color,rating:p.rating,links:p.links,tags:p.tags,locked:p.locked,dayIds:dayIds.map(Number),cost:+(p.cost||0),costType:p.costType||'total',propagateAccom:p.propagateAccom!==false}); });
    fillRS('rf','rt','rd');
    const routes=d.routes||[];
    if(routes.length){ toast('Recalculating '+routes.length+' route(s)…','');
      for(const r of routes){ const savedCol=r.color||'#1d56d4'; S.rtCol=savedCol;
        if(r.mode==='manual'){ const from=S.pois.find(p=>p.id===Number(r.fromId)),to=S.pois.find(p=>p.id===Number(r.toId)); if(from&&to){ const coords=[[from.lat,from.lng],[to.lat,to.lng]]; const poly=L.polyline(coords,{color:savedCol,weight:3,opacity:.8,dashArray:'10 6'}).addTo(map); const rt=Object.assign({},r,{id:Number(r.id),fromId:Number(r.fromId),toId:Number(r.toId),dayId:r.dayId?Number(r.dayId):null,fixedCost:+(r.fixedCost||0),color:savedCol,coords,poly,hourDotMarkers:[]}); S.routes.push(rt); bindRouteHover(rt); placeHourDots(rt); } }
        else{ await calcRoute(Number(r.fromId),Number(r.toId),r.mode,r.dayId?Number(r.dayId):null,Number(r.id),+(r.fixedCost||0),null); const rt=S.routes.find(x=>x.id===Number(r.id)); if(rt){ rt.color=savedCol; if(rt.poly) rt.poly.setStyle({color:savedCol}); placeHourDots(rt); } } }
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
  svgEl.innerHTML=''; ra(); if(!s) toast('Cleared','ok');
}
function expGPX(){ const w=S.pois.map(p=>'  <wpt lat="'+p.lat+'" lon="'+p.lng+'"><name>'+esc(p.name)+'</name></wpt>').join('\n'); const t=S.routes.map(r=>'  <trk><name>'+esc(r.fromName)+'→'+esc(r.toName)+'</name><trkseg>'+r.coords.map(c=>'<trkpt lat="'+c[0]+'" lon="'+c[1]+'"></trkpt>').join('')+'</trkseg></trk>').join('\n'); const b=new Blob(['<?xml version="1.0"?>\n<gpx version="1.1">\n'+w+'\n'+t+'\n</gpx>'],{type:'application/gpx+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='roadtrip.gpx'; a.click(); toast('GPX exported','ok'); }

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
function ra(){ renderPOIs(); renderDays(); renderRoutes(); renderNearby(); updStats(); fillRS('rf','rt','rd'); refMDay(); renderDayOrderLines(); }

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
qs('#mbk').addEventListener('click',ev=>{ if(ev.target===ev.currentTarget) closeModal(); });
qs('#m-cat').addEventListener('change',ev=>{
  qs('#m-ico').textContent=CATS[ev.target.value]||'📍';
  const propRow=qs('#m-propagate-row');
  if(propRow) propRow.style.display=isAccomCat(ev.target.value)?'flex':'none';
});
qsa('.csw').forEach(s=>s.addEventListener('click',()=>selCol(s.dataset.c)));
qs('#btn-alink').addEventListener('click',()=>{ const el=qs('#m-links'); const row=document.createElement('div'); row.className='lrow'; row.innerHTML='<input class="inp" style="width:76px;flex-shrink:0;" placeholder="Label"><input class="inp" style="flex:1;" placeholder="https://..."><button class="btn br bic bsm" onclick="this.parentNode.remove()">✕</button>'; el.appendChild(row); });
// Cost type computed update on cost input
qs('#m-cost').addEventListener('input', updateCostTypeUI);
qs('#m-save').addEventListener('click',()=>{
  const name=qs('#m-name').value.trim(); if(!name){ qs('#m-name').focus(); toast('Please enter a name','err'); return; }
  const newDayIds=getSelectedDayIds();
  const propCb=qs('#m-propagate');
  const propagateAccom=propCb?propCb.checked:false;
  const data={name,desc:qs('#m-desc').value,cat:qs('#m-cat').value,rating:qs('#m-rat').value,tags:qs('#m-tags').value.split(',').map(t=>t.trim()).filter(Boolean),links:getLinks(),color:S.col,dayIds:newDayIds,cost:+(qs('#m-cost').value||0),costType:S.costType,propagateAccom};
  if(S.editing){ const p=S.pois.find(x=>x.id===S.editing); if(p){ p.name=data.name; p.desc=data.desc; p.cat=data.cat; p.rating=data.rating; p.tags=data.tags; p.links=data.links; p.color=data.color; p.cost=data.cost; p.costType=data.costType; p.propagateAccom=data.propagateAccom; p.marker.setIcon(mkPin(p.color,CATS[p.cat]||'📍')); setPOIDays(p,newDayIds); toast('POI updated','ok'); } }
  else{ if(!S.pendLL){ closeModal(); return; } addPOI(S.pendLL,data); map.flyTo([S.pendLL.lat,S.pendLL.lng],Math.max(map.getZoom(),14)); toast('POI added!','ok'); }
  closeModal(); qs('#psrch').value=''; ra();
});
qs('#re-cancel').addEventListener('click',()=>{ qs('#rmbk').classList.remove('on'); S.editRid=null; });
qs('#rmbk').addEventListener('click',ev=>{ if(ev.target===ev.currentTarget){ qs('#rmbk').classList.remove('on'); S.editRid=null; } });
qs('#re-save').addEventListener('click',async()=>{ const f=qs('#ref').value,t=qs('#ret').value,m=qs('#rem').value,d=qs('#red').value; if(!f||!t){ toast('Select start and end','err'); return; } qs('#rmbk').classList.remove('on'); S.rtCol=S.rtCol2; await calcRoute(Number(f),Number(t),m,d?Number(d):null,S.editRid,+(qs('#re-cost').value||0),+(qs('#re-manual-dist').value||0)); S.editRid=null; });
qs('#btn-calc').addEventListener('click',()=>{ const f=qs('#rf').value,t=qs('#rt').value; if(!f||!t){ toast('Select From and To POIs','err'); return; } hideForMap(); calcRoute(Number(f),Number(t),qs('#rm').value,qs('#rd').value?Number(qs('#rd').value):null,null,+(qs('#r-cost').value||0),+(qs('#r-manual-dist').value||0)).then(()=>restoreDrawer()); });
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
  rt.poly.on('mouseover',function(e){ if(routeTooltipTimer){ clearTimeout(routeTooltipTimer); routeTooltipTimer=null; } var day=rt.dayId?S.days.find(function(d){return d.id===rt.dayId;}):null; var fp=getFP(); var fuel=routeFuel(rt); var tot=routeCost(rt); var MI2={car:'🚗 Car',foot:'🚶 Walk',bike:'🚲 Bike',manual:'✏️ Manual'}; var lines=['<b style="font-size:.82rem;font-family:var(--head)">'+esc(rt.fromName)+' → '+esc(rt.toName)+'</b>']; lines.push(MI2[rt.mode]||rt.mode); lines.push('🛣️ <b>'+rt.dist+' km</b>'+(rt.dur?' · ⏱ <b>'+fmtD(rt.dur)+'</b>':'')); if(day) lines.push('📅 <b>'+esc(day.title)+(day.date?' ('+day.date+')':'')+'</b>'); if(fuel>0) lines.push('⛽ Fuel: <b>$'+fuel.toFixed(2)+'</b>'); if(rt.fixedCost>0) lines.push('🎫 Fixed: <b>$'+rt.fixedCost.toFixed(2)+'</b>'); if(tot>0) lines.push('💰 Total: <b style="color:var(--gold)">$'+tot.toFixed(2)+'</b>'); lines.push('<div style="display:flex;gap:5px;margin-top:6px;"><button class="btn bg bsm" onclick="focusRouteInPanel('+rt.id+')">📋 Details</button><button class="btn bg bsm" onclick="openSplitModal('+rt.id+')">✂️ Split</button></div>'); var popup=L.popup({closeButton:false,offset:[0,-2],className:'route-hover-popup',autoPan:false}).setLatLng(e.latlng).setContent('<div style="font-size:.72rem;line-height:1.75;min-width:180px;">'+lines.join('<br>')+'</div>'); popup.on('add',function(){ setTimeout(function(){ var el=popup.getElement(); if(!el) return; el.addEventListener('mouseenter',function(){ if(routeTooltipTimer){ clearTimeout(routeTooltipTimer); routeTooltipTimer=null; } }); el.addEventListener('mouseleave',function(){ closeRouteTooltip(rt); }); },50); }); if(routeTooltip) map.closePopup(routeTooltip); routeTooltip=popup; popup.openOn(map); rt.poly.setStyle({weight:6,opacity:1}); });
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

/* ===== SHIFT DATES ===== */
function openShiftModal(){ var first=S.days.find(function(d){return d.date;}); if(first) qs('#shift-start').value=first.date; qs('#shift-delta').value=''; var el=qs('#shift-preview'); el.style.display='none'; el._delta=0; qs('#shiftmbk').style.display='flex'; }
function calcShiftDelta(){ var startVal=qs('#shift-start').value; var deltaVal=parseInt(qs('#shift-delta').value)||0; if(startVal&&!deltaVal){ var first=S.days.find(function(d){return d.date;}); if(first) return Math.round((new Date(startVal)-new Date(first.date))/86400000); } return deltaVal; }
function previewShift(){ var delta=calcShiftDelta(); var el=qs('#shift-preview'); if(!delta){ el.style.display='none'; return; } el._delta=delta; el.innerHTML=S.days.map(function(d,i){ if(!d.date) return(i+1)+'. '+esc(d.title)+': <span style="color:var(--muted)">no date</span>'; var dt=new Date(d.date); dt.setDate(dt.getDate()+delta); return(i+1)+'. '+esc(d.title)+': <span style="color:var(--muted)">'+d.date+'</span> &rarr; <b style="color:var(--acc)">'+dt.toISOString().slice(0,10)+'</b>'; }).join('<br>'); el.style.display='block'; }
function applyShift(){ var el=qs('#shift-preview'); var delta=el._delta||calcShiftDelta(); if(!delta){ toast('Enter a delta or new start date','err'); return; } S.days.forEach(function(d){ if(!d.date) return; var dt=new Date(d.date); dt.setDate(dt.getDate()+delta); d.date=dt.toISOString().slice(0,10); }); qs('#shiftmbk').style.display='none'; ra(); toast('Dates shifted '+(delta>0?'+':'')+delta+' days','ok'); }
qs('#shift-cancel').addEventListener('click',function(){ qs('#shiftmbk').style.display='none'; });
qs('#shiftmbk').addEventListener('click',function(ev){ if(ev.target===ev.currentTarget) qs('#shiftmbk').style.display='none'; });
qs('#shift-preview-btn').addEventListener('click',previewShift); qs('#shift-apply').addEventListener('click',applyShift);
qs('#shift-start').addEventListener('change',previewShift); qs('#shift-delta').addEventListener('input',previewShift);
qs('#btn-shift-dates').addEventListener('click',openShiftModal);

/* ===== SPLIT ROUTE ===== */
var splitRouteId=null, splitMapLL=null, splitPickingMap=false;
function openSplitModal(rid){ splitRouteId=rid; splitMapLL=null; splitPickingMap=false; var r=S.routes.find(function(x){return x.id===rid;}); if(!r) return; qs('#split-desc').textContent='Split "'+r.fromName+' to '+r.toName+'" via a mid-point POI.'; qs('#split-poi').innerHTML='<option value="">Select a POI</option>'+S.pois.filter(function(p){return p.id!==r.fromId&&p.id!==r.toId;}).map(function(p){return'<option value="'+p.id+'">'+(CATS[p.cat]||'X')+' '+esc(p.name)+'</option>';}).join(''); qs('#split-poi-name').value='Waypoint'; qs('#split-map-pt').style.display='none'; qs('#smbk').style.display='flex'; }
function closeSplitModal(){ qs('#smbk').style.display='none'; splitRouteId=null; splitMapLL=null; splitPickingMap=false; map.getContainer().style.cursor=''; }
map.on('click',function(e){ if(!splitPickingMap) return; splitPickingMap=false; splitMapLL=e.latlng; map.getContainer().style.cursor=''; qs('#split-map-pt').textContent='Lat '+e.latlng.lat.toFixed(5)+' Lng '+e.latlng.lng.toFixed(5); qs('#split-map-pt').style.display='block'; qs('#smbk').style.display='flex'; });
qs('#btn-split-map').addEventListener('click',function(){ qs('#smbk').style.display='none'; splitPickingMap=true; map.getContainer().style.cursor='crosshair'; toast('Click the map to set the split point',''); });
qs('#split-do').addEventListener('click',async function(){ var r=S.routes.find(function(x){return x.id===splitRouteId;}); if(!r){ closeSplitModal(); return; } var poiVal=qs('#split-poi').value; var midName=qs('#split-poi-name').value.trim()||'Waypoint'; var midPOI=null; if(poiVal){ midPOI=S.pois.find(function(p){return p.id===Number(poiVal);}); } else if(splitMapLL){ midPOI=addPOI(splitMapLL,{name:midName,cat:'general',color:r.color||'#c94f14',locked:true,dayIds:r.dayId?[r.dayId]:[]}); ra(); } else{ toast('Select a POI or pick a map point','err'); return; } if(!midPOI){ toast('Could not create mid-point','err'); return; } var dayId=r.dayId,col=r.color,fId=r.fromId,tId=r.toId,mode=r.mode,dist=r.dist; delRoute(splitRouteId); S.rtCol=col||'#1d56d4'; await calcRoute(fId,midPOI.id,mode,dayId,null,0,mode==='manual'?+(dist/2).toFixed(1):null); S.rtCol=col||'#1d56d4'; await calcRoute(midPOI.id,tId,mode,dayId,null,0,mode==='manual'?+(dist/2).toFixed(1):null); closeSplitModal(); toast('Route split into two','ok'); });
qs('#split-cancel').addEventListener('click',closeSplitModal); qs('#smbk').addEventListener('click',function(ev){ if(ev.target===ev.currentTarget) closeSplitModal(); });

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
