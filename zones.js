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

/* --- Convex Hull (Graham scan) in pixel space --- */
function cross(O, A, B){ return (A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0]); }

function convexHull(pts){
  if(pts.length < 3) return pts.slice();
  const sorted = pts.slice().sort((a,b)=> a[0]!==b[0] ? a[0]-b[0] : a[1]-b[1]);
  const lower=[];
  for(const p of sorted){
    while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop();
    lower.push(p);
  }
  const upper=[];
  for(let i=sorted.length-1;i>=0;i--){
    const p=sorted[i];
    while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/* Expand hull outward by `pad` pixels from centroid */
function expandHull(hull, pad){
  if(!hull.length) return hull;
  const cx=hull.reduce((s,p)=>s+p[0],0)/hull.length;
  const cy=hull.reduce((s,p)=>s+p[1],0)/hull.length;
  return hull.map(([x,y])=>{
    const dx=x-cx, dy=y-cy;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    return [x+dx/d*pad, y+dy/d*pad];
  });
}

/* Chaikin smoothing passes */
function chaikin(pts, passes=2){
  let cur=pts;
  for(let p=0;p<passes;p++){
    const next=[];
    const n=cur.length;
    for(let i=0;i<n;i++){
      const a=cur[i], b=cur[(i+1)%n];
      next.push([0.75*a[0]+0.25*b[0], 0.75*a[1]+0.25*b[1]]);
      next.push([0.25*a[0]+0.75*b[0], 0.25*a[1]+0.75*b[1]]);
    }
    cur=next;
  }
  return cur;
}

function hullToPath(pts){
  if(!pts.length) return '';
  return 'M'+pts[0][0]+','+pts[0][1]+pts.slice(1).map(([x,y])=>' L'+x+','+y).join('')+' Z';
}

/* For a single point, draw a small circle */
function singlePointPath(px, py, r=28){
  const n=32;
  const pts=[];
  for(let i=0;i<n;i++){
    const t=2*Math.PI*i/n;
    pts.push([px+r*Math.cos(t), py+r*Math.sin(t)]);
  }
  return hullToPath(pts);
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

// Pixel padding around the tight convex hull (small value = tight zone)
const ZONE_PAD_PX = 22;

function refreshDayZones(){
  const svgEl = getZoneSvg();
  svgEl.innerHTML = '';
  if(!CFG.showDayZones) return;
  const ns = 'http://www.w3.org/2000/svg';
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  const margin = 400;

  S.days.forEach((d, di) => {
    if(isDayHidden(d.id)) return;

    // Collect pixel-space points: POI positions + dense route samples
    const seen=new Set(), geoPts=[];

    d.items.forEach(it => {
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id);
        if(p){
          const k=p.lat.toFixed(5)+','+p.lng.toFixed(5);
          if(!seen.has(k)){ seen.add(k); geoPts.push([p.lat,p.lng]); }
        }
      }
      if(it.type==='route'){
        const r=S.routes.find(x=>x.id===it.id);
        if(r){
          // Route endpoints
          [r.fromId,r.toId].forEach(pid=>{
            const ep=S.pois.find(x=>x.id===pid);
            if(ep){
              const k=ep.lat.toFixed(5)+','+ep.lng.toFixed(5);
              if(!seen.has(k)){ seen.add(k); geoPts.push([ep.lat,ep.lng]); }
            }
          });
          // All route coords (dense, for tight hull along the path)
          if(r.coords && r.coords.length>1){
            const step=Math.max(1, Math.floor(r.coords.length/40));
            for(let i=0;i<r.coords.length;i+=step){
              const c=r.coords[i];
              const k=c[0].toFixed(4)+','+c[1].toFixed(4);
              if(!seen.has(k)){ seen.add(k); geoPts.push(c); }
            }
            const last=r.coords[r.coords.length-1];
            const lk=last[0].toFixed(4)+','+last[1].toFixed(4);
            if(!seen.has(lk)){ seen.add(lk); geoPts.push(last); }
          }
        }
      }
    });
    if(!geoPts.length) return;

    // Convert to pixel coords
    const pxPts = geoPts.map(g=>latlngToPixel(g));

    // Cull days entirely off-screen
    const anyVisible = pxPts.some(([x,y])=> x>-margin && x<W+margin && y>-margin && y<H+margin);
    if(!anyVisible) return;

    // Build tight convex hull in pixel space, expand by small padding, smooth
    let pathD;
    if(pxPts.length===1){
      pathD = singlePointPath(pxPts[0][0], pxPts[0][1], ZONE_PAD_PX+8);
    } else if(pxPts.length===2){
      // Degenerate: make a thin oval around the two points
      const expanded = expandHull(pxPts, ZONE_PAD_PX);
      pathD = hullToPath(chaikin(expanded, 3));
    } else {
      const hull = convexHull(pxPts);
      const expanded = expandHull(hull, ZONE_PAD_PX);
      pathD = hullToPath(chaikin(expanded, 2));
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
    const feG=document.createElementNS(ns,'feGaussianBlur'); feG.setAttribute('stdDeviation','6');
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

    // Zone title at centroid of POI stop points
    if(CFG.showZoneTitles){
      const stopPts = pxPts.filter((_,i)=>{
        const it=d.items[i]; return it && it.type==='poi';
      });
      const centSrc = stopPts.length ? stopPts : pxPts;
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
