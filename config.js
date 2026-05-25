/* =========================================================
   RoadTrip Planner — app.js  v8.6.0
   ========================================================= */
const APP_VERSION = '8.6.0';
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
  showDayZones:      true,
  showZoneTitles:    true,
  showPoiLabels:     false,
  showHourDots:      true,
  showDayOrderLines: false,
  fontScale:         125,
  darkMode:          false,
};
const _storedCfg = JSON.parse(localStorage.getItem('rtp_cfg') || '{}');
// Migration v8.5.0: showDayZones default changed false→true; clear cached false so new default applies
if (_storedCfg.showDayZones === false && !_storedCfg._v850) {
  delete _storedCfg.showDayZones;
  _storedCfg._v850 = 1;
  localStorage.setItem('rtp_cfg', JSON.stringify(_storedCfg));
}
let CFG = Object.assign({}, CFG_DEFAULTS, _storedCfg);

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
