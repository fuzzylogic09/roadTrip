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
  // Build a map of poiId -> set of dayIds that "own" it (direct assignment OR route endpoint)
  // A POI is considered owned by a day if:
  //   a) it's in p.dayIds, OR
  //   b) it's the fromId or toId of a route whose dayId is that day
  const poiDayOwnership = new Map(); // poiId -> Set<dayId>
  S.pois.forEach(p=>{
    const s=new Set(p.dayIds||[]);
    poiDayOwnership.set(p.id, s);
  });
  S.routes.forEach(r=>{
    if(!r.dayId) return;
    [r.fromId, r.toId].forEach(pid=>{
      if(!poiDayOwnership.has(pid)) poiDayOwnership.set(pid, new Set());
      poiDayOwnership.get(pid).add(r.dayId);
    });
  });

  S.pois.forEach(p=>{
    // Effective visibility using union of direct dayIds + route-endpoint dayIds
    const allOwnerDays=[...poiDayOwnership.get(p.id)||[]];
    const effectivelyVisible=()=>{
      if(S.poiVisibility[p.id]===false) return false;
      if(S.poiVisibility[p.id]===true)  return true;
      if(allOwnerDays.length) return allOwnerDays.some(did=>!isDayHidden(did));
      return !S.allPOIsHidden;
    };
    const show=(S.fcat==='all'||p.cat===S.fcat) && effectivelyVisible();
    try{ show?map.addLayer(p.marker):map.removeLayer(p.marker); }catch(e){}
  });

  S.routes.forEach(r=>{
    if(!r.poly) return;
    const hidden=r.dayId && isDayHidden(r.dayId);
    try{ hidden?map.removeLayer(r.poly):map.addLayer(r.poly); }catch(e){}
    if(r.hourDotMarkers) r.hourDotMarkers.forEach(m=>{
      try{ hidden?map.removeLayer(m):map.addLayer(m); }catch(e){}
    });
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

