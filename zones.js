/* ===================================================
   DAY ZONE OVERLAY
=================================================== */
function latlngToPixel(ll){
  // SVG is position:absolute inside #map, so container point = SVG point directly
  const pt = map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
  return [pt.x, pt.y];
}

/* --- Ellipse zone geometry --- */

// Convert [lat,lng] to approximate metres from origin (for PCA normalization)
// Uses equirectangular projection centered on the centroid
function latlngToMetres(pts){
  const cLat=pts.reduce((s,p)=>s+p[0],0)/pts.length;
  const cLng=pts.reduce((s,p)=>s+p[1],0)/pts.length;
  const cosLat=Math.cos(cLat*Math.PI/180)||1;
  return pts.map(([lat,lng])=>[
    (lng-cLng)*111320*cosLat,  // x in metres
    (lat-cLat)*111320          // y in metres
  ]);
}

// Fit minimum bounding ellipse using PCA in metre-space.
// Returns {cx_lat, cx_lng, aMet, bMet, angleMet}
// where aMet/bMet are semi-axes in metres, angleMet is the rotation angle in metre-space.
function fitEllipseGeo(pts){
  const n=pts.length;
  const cLat=pts.reduce((s,p)=>s+p[0],0)/n;
  const cLng=pts.reduce((s,p)=>s+p[1],0)/n;
  const cosLat=Math.cos(cLat*Math.PI/180)||1;

  // Convert to metres centred at centroid
  const mpts=pts.map(([lat,lng])=>[
    (lng-cLng)*111320*cosLat,
    (lat-cLat)*111320
  ]);
  let sxx=0,sxy=0,syy=0;
  for(const [x,y] of mpts){ sxx+=x*x; sxy+=x*y; syy+=y*y; }
  sxx/=n; sxy/=n; syy/=n;
  const trace=sxx+syy, disc=Math.sqrt(Math.max(0,(sxx-syy)**2/4+sxy**2));
  const l1=trace/2+disc;
  // Angle of major axis in metre-space
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
  return {cLat,cLng,aMet,bMet,angleMet,cosLat};
}

// Sample N points around a geo ellipse described in metre-space, projected to pixels.
// angleMet is measured in the (x=lng*cosLat*111320, y=lat*111320) plane.
function geoEllipseAsPixels(cLat, cLng, aMet, bMet, angleMet, cosLat, N=64){
  const cos=Math.cos(angleMet), sin=Math.sin(angleMet);
  const pts=[];
  for(let i=0;i<N;i++){
    const t=2*Math.PI*i/N;
    // Point on unrotated ellipse in metres
    const u=aMet*Math.cos(t), v=bMet*Math.sin(t);
    // Rotate in metre-space
    const mx= u*cos-v*sin;   // metres east
    const my= u*sin+v*cos;   // metres north
    // Back to lat/lng
    const lat=cLat+my/111320;
    const lng=cLng+mx/(111320*cosLat);
    pts.push(latlngToPixel([lat,lng]));
  }
  return pts;
}

// Wobble in pixels after projection (small, hand-drawn feel)
function wobbleEllipse(pts, seed){
  let r=seed*9301+49297;
  return pts.map(([x,y])=>{
    r=(r*9301+49297)%233280; const rx=(r/233280-.5)*6;
    r=(r*9301+49297)%233280; const ry=(r/233280-.5)*6;
    return [x+rx, y+ry];
  });
}

// Convert point array → smooth SVG path (1 Chaikin pass, very gentle)
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

const ELLIPSE_PAD_METRES = 3500;   // base padding around outermost point
const ELLIPSE_EXTRA_METRES = 1500; // extra per retry if POI falls outside

/**
 * Build day-zone path.
 * Key design:
 *  - Ellipse is FITTED and ORIENTED using ONLY poiGeoPts (the POIs).
 *    This ensures the major axis aligns with the POI distribution, not route wiggles.
 *  - allGeoPts (POIs + route samples) are used ONLY in the containment check,
 *    so the ellipse also covers the route path if needed (may expand on retry).
 *  - Everything is done in metre-space for correct orientation.
 */
function buildDayPath(allGeoPts, poiGeoPts, seed){
  if(!allGeoPts.length) return '';

  // Use POIs for fitting; fall back to all points if no POIs
  const fitPts = poiGeoPts.length ? poiGeoPts : allGeoPts;

  // Single point: circle
  if(fitPts.length===1){
    const [lat,lng]=fitPts[0];
    const cosLat=Math.cos(lat*Math.PI/180)||1;
    const rLat=ELLIPSE_PAD_METRES/111320;
    const rLng=ELLIPSE_PAD_METRES/(111320*cosLat);
    const pts=[];
    for(let i=0;i<48;i++){const t=2*Math.PI*i/48; pts.push(latlngToPixel([lat+rLat*Math.cos(t),lng+rLng*Math.sin(t)]));}
    return ellipseToPath(wobbleEllipse(pts,seed));
  }

  // Two points: special case — thin ellipse aligned exactly between the two points
  if(fitPts.length===2){
    const [p0,p1]=fitPts;
    const cosLat=Math.cos((p0[0]+p1[0])/2*Math.PI/180)||1;
    // midpoint
    const cLat=(p0[0]+p1[0])/2, cLng=(p0[1]+p1[1])/2;
    // distance in metres
    const dx=(p1[1]-p0[1])*111320*cosLat, dy=(p1[0]-p0[0])*111320;
    const halfDist=Math.sqrt(dx*dx+dy*dy)/2;
    const angleMet=Math.atan2(dy,dx);
    // Force major axis = distance/2 + pad, minor axis = pad only
    const aMet=halfDist+ELLIPSE_PAD_METRES;
    const bMet=ELLIPSE_PAD_METRES*0.6; // flatter to indicate direction
    const perim=geoEllipseAsPixels(cLat,cLng,aMet,bMet,angleMet,cosLat,60);
    return ellipseToPath(wobbleEllipse(perim,seed));
  }

  // General case: fit to POIs, then expand to contain allGeoPts
  const {cLat,cLng,aMet:rawA,bMet:rawB,angleMet,cosLat}=fitEllipseGeo(fitPts);

  // All points that MUST be inside (POIs + route endpoints)
  // Route midpoints we don't require containment for — only endpoints
  const mustContainPx=[...allGeoPts.map(latlngToPixel)];

  for(let attempt=0;attempt<4;attempt++){
    const extra=attempt*ELLIPSE_EXTRA_METRES;
    const pad=ELLIPSE_PAD_METRES+extra;
    const aMet=Math.max(rawA+pad, pad);
    const bMet=Math.max(rawB+pad*0.6, pad*0.6); // minor axis gets slightly less pad for elongated shape

    const perim=geoEllipseAsPixels(cLat,cLng,aMet,bMet,angleMet,cosLat,64);
    const wobbled=wobbleEllipse(perim,seed);
    const pathD=ellipseToPath(wobbled);

    // Parse path to polygon for containment check
    const poly=pathD.replace(/[MLZ]/g,' ').trim().split(/\s+/).reduce((acc,_,i,arr)=>{
      if(i%2===0){const x=parseFloat(arr[i]),y=parseFloat(arr[i+1]);if(!isNaN(x)&&!isNaN(y))acc.push([x,y]);}return acc;
    },[]);

    // Check only POI pixels must be inside (not every route point)
    const poiPx=poiGeoPts.map(latlngToPixel);
    const allIn=poiPx.every(pt=>pointInPolygon(pt,poly));
    if(allIn||attempt===3) return pathD;
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
  const container = map.getContainer();
  const W = container.clientWidth, H = container.clientHeight;
  svgEl.setAttribute('width', W); svgEl.setAttribute('height', H);
  svgEl.setAttribute('viewBox', '0 0 '+W+' '+H);
  svgEl.innerHTML = '';

  S.days.forEach((d, di) => {
    if(isDayHidden(d.id)) return;

    // Collect geo points.
    // poiGeoPts = ALL POIs that belong to this day (direct items + route endpoints)
    //             These drive the ellipse fit and MUST be inside.
    // routeGeoPts = sampled route coordinates (used to expand ellipse if needed, not for fitting)
    const poiIdsSeen = new Set();
    const poiGeoPts = [];  // drives ellipse fit AND must-be-inside check
    d.items.forEach(it => {
      if(it.type==='poi'){
        const p=S.pois.find(x=>x.id===it.id);
        if(p && !poiIdsSeen.has(p.id)){ poiIdsSeen.add(p.id); poiGeoPts.push([p.lat,p.lng]); }
      }
      if(it.type==='route'){
        const r=S.routes.find(x=>x.id===it.id);
        if(r){
          // Route endpoints
          [r.fromId,r.toId].forEach(pid=>{
            if(!poiIdsSeen.has(pid)){
              const ep=S.pois.find(x=>x.id===pid);
              if(ep){ poiIdsSeen.add(pid); poiGeoPts.push([ep.lat,ep.lng]); }
            }
          });
          // 10 evenly-spaced samples along the route path — these act as "fake POIs"
          // so the ellipse orientation and size follows the actual road, not just endpoints
          if(r.coords && r.coords.length>2){
            const n=Math.min(10, r.coords.length);
            for(let i=0;i<n;i++){
              const idx=Math.round(i*(r.coords.length-1)/(n-1));
              poiGeoPts.push(r.coords[idx]);
            }
          }
        }
      }
    });
    const allGeoPts=poiGeoPts; // all points are now used for fitting
    if(!allGeoPts.length) return;

    const margin=600;
    const anyVisible=allGeoPts.some(geo=>{
      const [x,y]=latlngToPixel(geo);
      return x>-margin && x<W+margin && y>-margin && y<H+margin;
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
