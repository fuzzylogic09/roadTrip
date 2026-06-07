/* ===================================================
   DAY ZONE OVERLAY  — rendered inside a Leaflet custom pane
   Pane z-index 250 = above tiles(200), below overlays(400), markers(600), popups(700)
=================================================== */

map.createPane('dayZonePane');
map.getPane('dayZonePane').style.zIndex = 250;
map.getPane('dayZonePane').style.pointerEvents = 'none';

let _zoneSvg = null;
function _resizeZoneSvg(){
  if(!_zoneSvg) return;
  const c = map.getContainer();
  _zoneSvg.setAttribute('width', c.clientWidth);
  _zoneSvg.setAttribute('height', c.clientHeight);
}
function getZoneSvg(){
  if(!_zoneSvg){
    _zoneSvg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    _zoneSvg.style.cssText='position:absolute;top:0;left:0;overflow:visible;pointer-events:none;';
    map.getPane('dayZonePane').appendChild(_zoneSvg);
    _resizeZoneSvg();
    map.on('resize', _resizeZoneSvg);
  }
  return _zoneSvg;
}

function latlngToPixel(ll){
  const lp = map.latLngToLayerPoint(L.latLng(ll[0], ll[1]));
  return [lp.x, lp.y];
}

/* --- Convex Hull (Graham scan) in 2D --- */
function _cross(O,A,B){ return (A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0]); }
function convexHull(pts){
  const n=pts.length;
  if(n<2) return pts.slice();
  const sorted=pts.slice().sort((a,b)=>a[0]!==b[0]?a[0]-b[0]:a[1]-b[1]);
  const lower=[];
  for(const p of sorted){ while(lower.length>=2&&_cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
  const upper=[];
  for(let i=sorted.length-1;i>=0;i--){ const p=sorted[i]; while(upper.length>=2&&_cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/* Expand hull outward by `pad` pixels from centroid */
function expandHull(hull, pad){
  if(!hull.length) return hull;
  const cx=hull.reduce((s,p)=>s+p[0],0)/hull.length;
  const cy=hull.reduce((s,p)=>s+p[1],0)/hull.length;
  return hull.map(([x,y])=>{
    const dx=x-cx, dy=y-cy, d=Math.sqrt(dx*dx+dy*dy)||1;
    return [x+dx/d*pad, y+dy/d*pad];
  });
}

/* Chaikin corner-cutting smoothing */
function chaikin(pts, passes=2){
  let cur=pts;
  for(let p=0;p<passes;p++){
    const next=[], n=cur.length;
    for(let i=0;i<n;i++){
      const a=cur[i], b=cur[(i+1)%n];
      next.push([0.75*a[0]+0.25*b[0], 0.75*a[1]+0.25*b[1]]);
      next.push([0.25*a[0]+0.75*b[0], 0.25*a[1]+0.75*b[1]]);
    }
    cur=next;
  }
  return cur;
}

function ptsToPath(pts){
  if(!pts.length) return '';
  return 'M'+pts[0][0]+','+pts[0][1]+pts.slice(1).map(([x,y])=>' L'+x+','+y).join('')+' Z';
}

/* Circle path around a single pixel point, with radius in pixels */
function circlePath(cx, cy, r, n=48){
  const pts=[];
  for(let i=0;i<n;i++){ const t=2*Math.PI*i/n; pts.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]); }
  return ptsToPath(pts);
}

/* Stadium/capsule shape around two pixel points */
function capsulePath(A, B, r, n=16){
  const dx=B[0]-A[0], dy=B[1]-A[1], len=Math.sqrt(dx*dx+dy*dy)||1;
  const ux=dx/len, uy=dy/len;   // unit along AB
  const nx=-uy, ny=ux;           // unit normal
  const pts=[];
  for(let i=0;i<=n;i++){          // semicircle around B
    const a=Math.PI/2 - Math.PI*i/n;
    pts.push([B[0]+r*(ux*Math.cos(a)-ny*Math.sin(a)), B[1]+r*(uy*Math.cos(a)+nx*Math.sin(a))]);
  }
  for(let i=0;i<=n;i++){          // semicircle around A
    const a=-Math.PI/2 - Math.PI*i/n;
    pts.push([A[0]+r*(ux*Math.cos(a)-ny*Math.sin(a)), A[1]+r*(uy*Math.cos(a)+nx*Math.sin(a))]);
  }
  return ptsToPath(chaikin(pts,1));
}

/* Minimum pixel padding — scales with zoom so zones are always readable */
function minPadPx(){
  // Base 30px at zoom 10, grows slightly at lower zoom
  const z=map.getZoom();
  return Math.max(28, 28+(10-z)*4);
}

/* --- Debounced rAF zone refresh --- */
let _dzRafId = null;

map.on('movestart', ()=>{ if(CFG.showDayZones){ const svg=getZoneSvg(); svg.style.display='none'; } });
map.on('move',      ()=>{ if(CFG.showDayZones){ const svg=getZoneSvg(); svg.style.display='none'; } });
map.on('zoomstart', ()=>{ if(CFG.showDayZones){ const svg=getZoneSvg(); svg.style.display='none'; } });
map.on('zoom',      ()=>{ if(CFG.showDayZones){ const svg=getZoneSvg(); svg.style.display='none'; } });
map.on('moveend',   scheduleZoneRefresh);
map.on('zoomend',   scheduleZoneRefresh);
map.on('viewreset', scheduleZoneRefresh);

function scheduleZoneRefresh(){
  if(_dzRafId) cancelAnimationFrame(_dzRafId);
  _dzRafId = requestAnimationFrame(()=>{
    _dzRafId = null;
    const svg=getZoneSvg(); svg.style.display='';
    refreshDayZones();
  });
}

function refreshDayZones(){
  const svgEl = getZoneSvg();
  svgEl.innerHTML = '';
  if(!CFG.showDayZones) return;
  const ns = 'http://www.w3.org/2000/svg';
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  const margin = 400;
  const pad = minPadPx();

  S.days.forEach((d, di) => {
    if(isDayHidden(d.id)) return;

    // Collect all geo points for this day:
    // 1. All POIs assigned to this day (via dayIds — robust even if d.items is stale)
    // 2. Route endpoints and dense coordinate samples
    const seen=new Set();
    const poiPts=[];   // POI-only points (for centroid label)
    const allPts=[];   // POI + route points (for hull)

    function addGeo(lat, lng, isPoi){
      const k=lat.toFixed(4)+','+lng.toFixed(4);
      if(seen.has(k)) return;
      seen.add(k);
      if(isPoi) poiPts.push([lat,lng]);
      allPts.push([lat,lng]);
    }
    function addRouteGeo(r){
      [r.fromId,r.toId].forEach(pid=>{ const ep=S.pois.find(x=>x.id===pid); if(ep) addGeo(ep.lat,ep.lng,false); });
      if(r.coords&&r.coords.length>1){
        const step=Math.max(1,Math.floor(r.coords.length/60));
        for(let i=0;i<r.coords.length;i+=step) addGeo(r.coords[i][0],r.coords[i][1],false);
        addGeo(r.coords[r.coords.length-1][0],r.coords[r.coords.length-1][1],false);
      }
    }

    // Primary: POIs whose dayIds include this day
    S.pois.forEach(p=>{
      if((p.dayIds||[]).includes(d.id)) addGeo(p.lat,p.lng,true);
    });

    // Ghost accommodation POIs (hotel from previous day propagated into this day)
    getGhostItemsForDay(di).forEach(g=>{
      const p=S.pois.find(x=>x.id===g.poiId);
      if(p) addGeo(p.lat,p.lng,true);
    });

    // Routes assigned to this day (r.dayId is the authoritative source)
    // Also fall back to d.items for routes that may lack dayId
    const routeIds=new Set();
    S.routes.filter(r=>r.dayId===d.id).forEach(r=>{ routeIds.add(r.id); addRouteGeo(r); });
    d.items.forEach(it=>{ if(it.type==='route'&&!routeIds.has(it.id)){ const r=S.routes.find(x=>x.id===it.id); if(r) addRouteGeo(r); } });

    if(!allPts.length) return;

    // Convert to pixel coords
    const pxAll  = allPts.map(g=>latlngToPixel(g));
    const pxPois = poiPts.map(g=>latlngToPixel(g));

    // Cull days entirely off-screen
    const anyVisible = pxAll.some(([x,y])=>x>-margin&&x<W+margin&&y>-margin&&y<H+margin);
    if(!anyVisible) return;

    // Build zone shape
    let pathD;
    if(pxAll.length===1){
      pathD = circlePath(pxAll[0][0], pxAll[0][1], pad);
    } else if(pxAll.length===2){
      pathD = capsulePath(pxAll[0], pxAll[1], pad);
    } else {
      const hull = convexHull(pxAll);
      // Ensure hull has at least 3 unique points for a valid polygon
      if(hull.length<3){
        pathD = hull.length===2
          ? capsulePath(hull[0],hull[1],pad)
          : circlePath(hull[0][0],hull[0][1],pad);
      } else {
        // Smooth first, then expand — Chaikin pulls corners inward so expand last
        // ensures the final shape always fully contains the original POI positions
        pathD = ptsToPath(expandHull(chaikin(hull, 2), pad));
      }
    }
    if(!pathD) return;

    const color=d.color||DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const [rv,gv,bv]=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];
    const rgba=a=>`rgba(${rv},${gv},${bv},${a})`;

    // Blur filter
    const fid='blur-d'+di;
    const defs=document.createElementNS(ns,'defs');
    const filter=document.createElementNS(ns,'filter');
    filter.setAttribute('id',fid); filter.setAttribute('x','-30%'); filter.setAttribute('y','-30%');
    filter.setAttribute('width','160%'); filter.setAttribute('height','160%');
    const feG=document.createElementNS(ns,'feGaussianBlur'); feG.setAttribute('stdDeviation','7');
    filter.appendChild(feG); defs.appendChild(filter); svgEl.appendChild(defs);

    // Soft fill
    const fill=document.createElementNS(ns,'path');
    fill.setAttribute('d',pathD); fill.setAttribute('fill',rgba(0.13));
    fill.setAttribute('filter',`url(#${fid})`);
    svgEl.appendChild(fill);

    // Dashed stroke
    const stroke=document.createElementNS(ns,'path');
    stroke.setAttribute('d',pathD); stroke.setAttribute('fill',rgba(0.06));
    stroke.setAttribute('stroke',rgba(0.65)); stroke.setAttribute('stroke-width','2');
    stroke.setAttribute('stroke-dasharray','8 5');
    stroke.setAttribute('stroke-linecap','round'); stroke.setAttribute('stroke-linejoin','round');
    svgEl.appendChild(stroke);

    // Zone title at centroid of POI points (or all points if no POI centroids)
    if(CFG.showZoneTitles){
      const centSrc = pxPois.length ? pxPois : pxAll;
      const centX=centSrc.reduce((s,p)=>s+p[0],0)/centSrc.length;
      const centY=centSrc.reduce((s,p)=>s+p[1],0)/centSrc.length;
      const fd=fmtDate(d.date);
      const title=(d.title||('Day '+(di+1)))+(fd?' · '+fd:'');
      const lbl=document.createElementNS(ns,'text');
      lbl.setAttribute('x',centX); lbl.setAttribute('y',centY);
      lbl.setAttribute('text-anchor','middle'); lbl.setAttribute('dominant-baseline','middle');
      lbl.setAttribute('font-size','13'); lbl.setAttribute('font-weight','800');
      lbl.setAttribute('font-family','Nunito,sans-serif');
      lbl.setAttribute('fill',rgba(0.9));
      lbl.setAttribute('paint-order','stroke');
      lbl.setAttribute('stroke','rgba(255,255,255,0.9)');
      lbl.setAttribute('stroke-width','4');
      lbl.setAttribute('stroke-linejoin','round');
      lbl.textContent=title;
      svgEl.appendChild(lbl);
    }
  });
}
