/* ===================================================
   DAY ZONE OVERLAY  — rendered inside a Leaflet custom pane
   Pane z-index 250 = above tiles(200), below overlays(400), markers(600), popups(700)
=================================================== */

// Create a dedicated Leaflet pane for day zones
map.createPane('dayZonePane');
map.getPane('dayZonePane').style.zIndex = 250;
map.getPane('dayZonePane').style.pointerEvents = 'none';

// We'll draw into a single <svg> element appended to the pane
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

// latlngToPixel: Leaflet layer-point coords, relative to the pane's top-left.
// The pane CSS-translates on pan so SVG stays aligned without a full redraw.
function latlngToPixel(ll){
  const lp = map.latLngToLayerPoint(L.latLng(ll[0], ll[1]));
  return [lp.x, lp.y];
}

/* --- Ellipse zone geometry --- */

// Fit a bounding ellipse in metre-space via PCA.
// pts       = all points (drives PCA orientation and axis extents)
// centerPts = subset used for centroid only (optional; avoids route-sample bias)
function fitEllipseGeo(pts, centerPts){
  const n=pts.length;
  const cPts=(centerPts && centerPts.length) ? centerPts : pts;
  const cLat=cPts.reduce((s,p)=>s+p[0],0)/cPts.length;
  const cLng=cPts.reduce((s,p)=>s+p[1],0)/cPts.length;
  const cosLat=Math.cos(cLat*Math.PI/180)||1;

  const mpts=pts.map(([lat,lng])=>[
    (lng-cLng)*111320*cosLat,
    (lat-cLat)*111320
  ]);
  let sxx=0,sxy=0,syy=0;
  for(const [x,y] of mpts){ sxx+=x*x; sxy+=x*y; syy+=y*y; }
  sxx/=n; sxy/=n; syy/=n;
  let angleMet=0;
  if(Math.abs(sxy)>1e-6||Math.abs(sxx-syy)>1e-6) angleMet=Math.atan2(2*sxy, sxx-syy)/2;
  const cos=Math.cos(angleMet), sin=Math.sin(angleMet);
  let aMet=0, bMet=0;
  for(const [x,y] of mpts){
    const u= x*cos+y*sin;
    const v=-x*sin+y*cos;
    aMet=Math.max(aMet,Math.abs(u));
    bMet=Math.max(bMet,Math.abs(v));
  }
  // max|u| and max|v| alone don't guarantee containment: a point at
  // (0.9·aMet, 0.9·bMet) has ellipse-radius sqrt(0.81+0.81)=1.27 > 1.
  // Scale both axes uniformly so every point satisfies (u/a)²+(v/b)² ≤ 1.
  if(aMet>0 && bMet>0){
    let maxR=0;
    for(const [x,y] of mpts){
      const u=x*cos+y*sin, v=-x*sin+y*cos;
      maxR=Math.max(maxR, Math.sqrt((u/aMet)**2+(v/bMet)**2));
    }
    aMet*=maxR; bMet*=maxR;
  }
  return {cLat,cLng,aMet,bMet,angleMet,cosLat};
}

// Sample N points around a geo ellipse (metre-space) → pixel coords.
function geoEllipseAsPixels(cLat, cLng, aMet, bMet, angleMet, cosLat, N=64){
  const cos=Math.cos(angleMet), sin=Math.sin(angleMet);
  const pts=[];
  for(let i=0;i<N;i++){
    const t=2*Math.PI*i/N;
    const u=aMet*Math.cos(t), v=bMet*Math.sin(t);
    const mx= u*cos-v*sin;
    const my= u*sin+v*cos;
    const lat=cLat+my/111320;
    const lng=cLng+mx/(111320*cosLat);
    pts.push(latlngToPixel([lat,lng]));
  }
  return pts;
}

// Pixel-space wobble for a hand-drawn feel. Zero-mean so centroid doesn't shift.
function wobbleEllipse(pts, seed){
  let r=seed*9301+49297;
  const disp=pts.map(()=>{
    r=(r*9301+49297)%233280; const dx=(r/233280-.5)*6;
    r=(r*9301+49297)%233280; const dy=(r/233280-.5)*6;
    return [dx,dy];
  });
  const mx=disp.reduce((s,d)=>s+d[0],0)/disp.length;
  const my=disp.reduce((s,d)=>s+d[1],0)/disp.length;
  return pts.map(([x,y],i)=>[x+disp[i][0]-mx, y+disp[i][1]-my]);
}

// Point array → smooth SVG path (1 Chaikin pass).
function ellipseToPath(pts){
  const n=pts.length, s=[];
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    s.push([0.75*a[0]+0.25*b[0], 0.75*a[1]+0.25*b[1]]);
    s.push([0.25*a[0]+0.75*b[0], 0.25*a[1]+0.75*b[1]]);
  }
  return 'M'+s[0][0]+','+s[0][1]+s.slice(1).map(([x,y])=>' L'+x+','+y).join('')+' Z';
}

const ELLIPSE_PAD_METRES = 800;

// Build a day-zone ellipse path that contains all pts.
// pts    = POIs + route endpoints (indices 0..nStop-1) + route path samples (nStop..)
// nStop  = count of POI/endpoint points (used for centroid; avoids route-sample bias)
function buildDayPath(pts, nStop, seed){
  if(!pts.length) return '';

  // Single point → circle
  if(pts.length===1){
    const [lat,lng]=pts[0];
    const cosLat=Math.cos(lat*Math.PI/180)||1;
    const rLat=ELLIPSE_PAD_METRES/111320;
    const rLng=ELLIPSE_PAD_METRES/(111320*cosLat);
    const circle=[];
    for(let i=0;i<48;i++){
      const t=2*Math.PI*i/48;
      circle.push(latlngToPixel([lat+rLat*Math.cos(t),lng+rLng*Math.sin(t)]));
    }
    return ellipseToPath(wobbleEllipse(circle,seed));
  }

  // Use stop points for centroid, all pts for PCA shape/extents
  const stopPts=nStop>0 ? pts.slice(0,nStop) : pts;
  const {cLat,cLng,aMet,bMet,angleMet,cosLat}=fitEllipseGeo(pts, stopPts);
  const pad=ELLIPSE_PAD_METRES;
  // Ensure minor axis has a minimum floor so route-only days aren't flat
  const finalA=Math.max(aMet+pad, pad);
  const finalB=Math.max(bMet+pad*0.5, pad*0.4);
  const perim=geoEllipseAsPixels(cLat,cLng,finalA,finalB,angleMet,cosLat,64);
  return ellipseToPath(wobbleEllipse(perim,seed));
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

  S.days.forEach((d, di) => {
    if(isDayHidden(d.id)) return;

    // Single pts array: POI/endpoint points first (indices 0..nStop-1),
    // then route path samples. nStop is used for centroid calculation only.
    const seen=new Set(), pts=[];
    let nStop=0;

    d.items.forEach(it => {
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id);
        if(p){
          const k=p.lat.toFixed(5)+','+p.lng.toFixed(5);
          if(!seen.has(k)){ seen.add(k); pts.push([p.lat,p.lng]); nStop++; }
        }
      }
      if(it.type==='route'){
        const r=S.routes.find(x=>x.id===it.id);
        if(r){
          [r.fromId,r.toId].forEach(pid=>{
            const ep=S.pois.find(x=>x.id===pid);
            if(ep){
              const k=ep.lat.toFixed(5)+','+ep.lng.toFixed(5);
              if(!seen.has(k)){ seen.add(k); pts.push([ep.lat,ep.lng]); nStop++; }
            }
          });
          if(r.coords && r.coords.length>1){
            const n=Math.min(10,r.coords.length);
            for(let i=0;i<n;i++){
              const idx=Math.round(i*(r.coords.length-1)/(n-1));
              const c=r.coords[idx];
              const k=c[0].toFixed(5)+','+c[1].toFixed(5);
              if(!seen.has(k)){ seen.add(k); pts.push(c); }
            }
          }
        }
      }
    });
    if(!pts.length) return;

    // Cull days entirely off-screen (generous margin so ellipses at edge still show)
    const margin=1200;
    const anyVisible=pts.some(geo=>{
      const [x,y]=latlngToPixel(geo);
      return x>-margin && x<W+margin && y>-margin && y<H+margin;
    });
    if(!anyVisible) return;

    const color=DAY_ZONE_COLORS[di%DAY_ZONE_COLORS.length];
    const [rv,gv,bv]=[parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)];
    const rgba=a=>`rgba(${rv},${gv},${bv},${a})`;

    const pathD=buildDayPath(pts, nStop, di+1);
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

    // Zone title at centroid of stop points only (not route samples)
    if(CFG.showZoneTitles){
      const centSrc=nStop>0 ? pts.slice(0,nStop) : pts;
      const centLat=centSrc.reduce((s,p)=>s+p[0],0)/centSrc.length;
      const centLng=centSrc.reduce((s,p)=>s+p[1],0)/centSrc.length;
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
