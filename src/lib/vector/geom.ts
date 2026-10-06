/** Geometry toolkit: simplification, smoothing, corner detection, curve fitting. - FIXED v2 */

export type Pt = { x: number; y: number };
export type Seg =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "Q"; cx: number; cy: number; x: number; y: number }
  | { t: "C"; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { t: "A"; rx: number; ry: number; rot: number; large: 0 | 1; sweep: 0 | 1; x: number; y: number }
  | { t: "Z" };
export type Loop = { segs: Seg[]; bbox: [number, number, number, number]; area: number };

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export function round(v: number, d = 2): number { const f = 10 ** d; return Math.round(v * f) / f; }
export function shoelace(points: Pt[]): number {
  let s = 0; for (let i = 0; i < points.length; i++) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  } return s / 2;
}
export function bboxOf(points: Pt[]): [number, number, number, number] {
  if (!points.length) return [0,0,0,0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  } return [minX, minY, maxX, maxY];
}
export function dedupe(points: Pt[], eps = 0.001): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) out.push(p);
  }
  // closed loop e first=last duplicate sorano
  if(out.length>2 && dist(out[0], out[out.length-1]) < eps) out.pop();
  return out;
}

/** Ramer–Douglas–Peucker */
export function simplify(points: Pt[], tol: number): Pt[] {
  const n = points.length; if (n < 3 || tol <= 0) return points.slice();
  const keep = new Uint8Array(n); keep[0]=1; keep[n-1]=1;
  const stack: [number, number][] = [[0, n - 1]]; const tol2 = tol * tol;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const a = points[first], b = points[last];
    const dx = b.x - a.x, dy = b.y - a.y; const len2 = dx*dx+dy*dy;
    let worst=-1, worstDist=tol2;
    for(let i=first+1;i<last;i++){
      const p=points[i]; let d2: number;
      if(len2===0) d2=(p.x-a.x)**2+(p.y-a.y)**2;
      else{ const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/len2; const tc=Math.max(0,Math.min(1,t));
        d2=(p.x-(a.x+tc*dx))**2+(p.y-(a.y+tc*dy))**2; }
      if(d2>worstDist){ worstDist=d2; worst=i; }
    }
    if(worst!==-1){ keep[worst]=1; stack.push([first,worst],[worst,last]); }
  }
  const out: Pt[]=[]; for(let i=0;i<n;i++) if(keep[i]) out.push(points[i]);
  return out;
}

// FIX 1: simplifyClosed - ager ta 0 theke dure point e split korto, ekhon diameter e split korbe
export function simplifyClosed(points: Pt[], tol: number): Pt[] {
  const pts = dedupe(points); const n=pts.length; if(n<4) return pts; if(tol<=0) return pts;
  const farthest = (fromIdx:number) => {
    let best=fromIdx, bestD=-1;
    for(let i=0;i<n;i++){ const d=(pts[i].x-pts[fromIdx].x)**2+(pts[i].y-pts[fromIdx].y)**2; if(d>bestD){bestD=d; best=i;}}
    return best;
  }
  const a = farthest(0); const b = farthest(a);
  const i0=Math.min(a,b), i1=Math.max(a,b);
  const head=pts.slice(i0,i1+1); const tail=pts.slice(i1).concat(pts.slice(0,i0+1));
  const sHead=simplify(head,tol); const sTail=simplify(tail,tol);
  return dedupe(sHead.slice(0,-1).concat(sTail));
}

export function smooth(points: Pt[], passes: number, closed = true): Pt[] {
  if (passes <= 0 || points.length < 4) return points;
  let cur = points.slice(); const n=cur.length;
  for(let p=0;p<passes;p++){
    const next: Pt[] = new Array(n);
    for(let i=0;i<n;i++){
      const prev=cur[(i-1+n)%n], self=cur[i], nxt=cur[(i+1)%n];
      next[i]={x:(prev.x+2*self.x+nxt.x)/4, y:(prev.y+2*self.y+nxt.y)/4};
    }
    if(!closed){ next[0]=cur[0]; next[n-1]=cur[n-1]; }
    cur=next;
  } return cur;
}

export function detectCorners(points: Pt[], thresholdDeg: number, window: number, closed: boolean): boolean[] {
  const n=points.length; const flags=new Array<boolean>(n).fill(false);
  if(n<5) return flags;
  const w=Math.max(1,Math.min(window,Math.floor(n/3)));
  const th=Math.cos((thresholdDeg*Math.PI)/180);
  for(let i=0;i<n;i++){
    if(!closed && (i-w<0 || i+w>n-1)) continue;
    const a=points[(i-w+n)%n], b=points[i], c=points[(i+w)%n];
    const v1x=b.x-a.x, v1y=b.y-a.y, v2x=c.x-b.x, v2y=c.y-b.y;
    const l1=Math.hypot(v1x,v1y), l2=Math.hypot(v2x,v2y);
    if(l1<0.4 || l2<0.4) continue;
    const cos=(v1x*v2x+v1y*v2y)/(l1*l2);
    if(cos < th) flags[i]=true;
  } return flags;
}

// FIX 2: single corner bug fix
export function splitAtCorners(points: Pt[], flags: boolean[]): Pt[][] {
  const idx: number[]=[]; for(let i=0;i<points.length;i++) if(flags[i]) idx.push(i);
  if(idx.length===0) return [];
  if(idx.length===1) return [points.slice()]; // FIX: age 1 point hole faka dito
  const runs: Pt[][]=[];
  for(let k=0;k<idx.length;k++){
    const start=idx[k], end=idx[(k+1)%idx.length];
    const run: Pt[]=[]; let i=start;
    while(true){ run.push(points[i]); if(i===end) break; i=(i+1)%points.length; if(run.length>points.length) break; }
    if(run.length>=2) runs.push(run);
  } return runs;
}

/* Bezier fitting ... (generateBezier, maxErrorPoint ager motoi thakbe) */
type Cubic = { p0: Pt; c1: Pt; c2: Pt; p3: Pt };
function chordLengthParameterize(pts: Pt[]): number[] {
  const u:number[]=[0]; for(let i=1;i<pts.length;i++) u.push(u[i-1]+dist(pts[i],pts[i-1]));
  const total=u[u.length-1]||1; return u.map(v=>v/total);
}
function bezierPoint(b:Cubic,t:number):Pt{
  const mt=1-t; const a=mt*mt*mt, c=3*mt*mt*t, d=3*mt*t*t, e=t*t*t;
  return {x:a*b.p0.x+c*b.c1.x+d*b.c2.x+e*b.p3.x, y:a*b.p0.y+c*b.c1.y+d*b.c2.y+e*b.p3.y};
}
function bezierDeriv(b:Cubic,t:number):Pt{
  const mt=1-t; const a=3*mt*mt, c=6*mt*t, d=3*t*t;
  return {x:a*(b.c1.x-b.p0.x)+c*(b.c2.x-b.c1.x)+d*(b.p3.x-b.c2.x), y:a*(b.c1.y-b.p0.y)+c*(b.c2.y-b.c1.y)+d*(b.p3.y-b.c2.y)};
}
function generateBezier(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const p0=pts[0], p3=pts[pts.length-1];
  let c00=0,c01=0,c11=0,x0=0,x1=0;
  for(let i=0;i<pts.length;i++){
    const t=u[i], mt=1-t, b0=mt*mt*mt, b1=3*mt*mt*t, b2=3*mt*t*t, b3=t*t*t;
    const a0x=t1.x*b1, a0y=t1.y*b1, a1x=t2.x*b2, a1y=t2.y*b2;
    c00+=a0x*a0x+a0y*a0y; c01+=a0x*a1x+a0y*a1y; c11+=a1x*a1x+a1y*a1y;
    const tmpx=pts[i].x-(p0.x*b0+p0.x*b1+p3.x*b2+p3.x*b3);
    const tmpy=pts[i].y-(p0.y*b0+p0.y*b1+p3.y*b2+p3.y*b3);
    x0+=a0x*tmpx+a0y*tmpy; x1+=a1x*tmpx+a1y*tmpy;
  }
  const det=c00*c11-c01*c01; const det0=x0*c11-c01*x1; const det1=c00*x1-x0*c01;
  let alphaL=det===0?0:det0/det; let alphaR=det===0?0:det1/det;
  const segLen=dist(p0,p3); const eps=1e-6*segLen; const maxAlpha=Math.max(segLen*6,24);
  if(!isFinite(alphaL)||!isFinite(alphaR)||alphaL<eps||alphaR<eps||alphaL>maxAlpha||alphaR>maxAlpha){ const d=segLen/3||0.1; alphaL=d; alphaR=d; }
  return {p0,c1:{x:p0.x+t1.x*alphaL,y:p0.y+t1.y*alphaL},c2:{x:p3.x+t2.x*alphaR,y:p3.y+t2.y*alphaR},p3};
}
function maxErrorPoint(pts: Pt[], b: Cubic, u: number[]){
  let maxD=0, split=Math.floor(pts.length/2);
  for(let i=1;i<pts.length-1;i++){ const p=bezierPoint(b,u[i]); const d=(p.x-pts[i].x)**2+(p.y-pts[i].y)**2; if(d>=maxD){maxD=d; split=i;}}
  return {maxD,split};
}
function reparameterize(pts: Pt[], u: number[], b: Cubic): number[]{
  return u.map((t,i)=>{ const d=bezierDeriv(b,t), p=bezierPoint(b,t), q=pts[i];
    const num=(p.x-q.x)*d.x+(p.y-q.y)*d.y, den=d.x*d.x+d.y*d.y; if(den===0) return t;
    return Math.max(0,Math.min(1,t-num/den)); });
}
const norm=(dx:number,dy:number):Pt=>{const l=Math.hypot(dx,dy); return l===0?{x:0,y:0}:{x:dx/l,y:dy/l};}
export function fitCubics(pts: Pt[], tol: number): Cubic[] {
  const out:Cubic[]=[]; const done:Cubic[][]=[];
  const tHat1=norm(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
  const last=pts[pts.length-1], prev=pts[pts.length-2];
  const tHat2=norm(prev.x-last.x,prev.y-last.y);
  fitCubicRec(pts,tHat1,tHat2,tol*tol,done,0);
  for(const g of done) out.push(...g); return out;
}
function fitCubicRec(pts: Pt[], tHat1:Pt, tHat2:Pt, error:number, out:Cubic[][], depth:number):void{
  if(depth>16){ if(pts.length>1) out.push([lineAsCubic(pts)]); return;}
  if(pts.length===2){ out.push([lineAsCubic(pts)]); return;}
  const clean=dedupe(pts); if(clean.length<2) return; if(clean.length===2){ out.push([lineAsCubic(clean)]); return;}
  let u=chordLengthParameterize(clean); let bez=generateBezier(clean,u,tHat1,tHat2);
  let {maxD,split}=maxErrorPoint(clean,bez,u);
  if(maxD<error){ out.push([bez]); return;}
  let bestD=maxD, bestBez=bez, bestU=u, bestSplit=split;
  for(let i=0;i<4 && bestD>=error;i++){ u=reparameterize(clean,u,bez); bez=generateBezier(clean,u,tHat1,tHat2);
    const r=maxErrorPoint(clean,bez,u); if(r.maxD<bestD){bestD=r.maxD; bestBez=bez; bestU=u; bestSplit=r.split;}}
  if(bestD<error){ out.push([bestBez]); return;}
  if(bestSplit<=0||bestSplit>=clean.length-1){ out.push([bestBez]); return;}
  const center=norm(clean[bestSplit-1].x-clean[bestSplit+1].x, clean[bestSplit-1].y-clean[bestSplit+1].y);
  void bestU; const left:Cubic[][]=[], right:Cubic[][]=[];
  fitCubicRec(clean.slice(0,bestSplit+1),tHat1,center,error,left,depth+1);
  fitCubicRec(clean.slice(bestSplit),{x:-center.x,y:-center.y},tHat2,error,right,depth+1);
  out.push(...left,...right);
}
function lineAsCubic(pts: Pt[]): Cubic {
  const p0=pts[0], p3=pts[pts.length-1];
  return {p0,c1:{x:p0.x+(p3.x-p0.x)/3,y:p0.y+(p3.y-p0.y)/3},c2:{x:p0.x+2*(p3.x-p0.x)/3,y:p0.y+2*(p3.y-p0.y)/3},p3};
}

// FIX 3: Quadratic fitting - age vul curve diye error mapto
export function fitQuadratics(pts: Pt[], tol=0.6): Seg[] {
  const clean=dedupe(pts); const segs:Seg[]=[]; if(clean.length<2) return segs;
  const fitOne=(part:Pt[])=>{
    if(part.length===2){ segs.push({t:"L",x:part[1].x,y:part[1].y}); return;}
    const p0=part[0], p2=part[part.length-1], u=chordLengthParameterize(part);
    let wsum=0,cx=0,cy=0;
    for(let i=1;i<part.length-1;i++){
      const t=u[i], mt=1-t, w=2*mt*t, w2=w*w+1e-9;
      const tx=(part[i].x-(mt*mt*p0.x+t*t*p2.x))/w, ty=(part[i].y-(mt*mt*p0.y+t*t*p2.y))/w;
      cx+=tx*w2; cy+=ty*w2; wsum+=w2;
    }
    const c=wsum===0?{x:(p0.x+p2.x)/2,y:(p0.y+p2.y)/2}:{x:cx/wsum,y:cy/wsum};
    segs.push({t:"Q",cx:c.x,cy:c.y,x:p2.x,y:p2.y});
  };
  const quadAt=(p0:Pt,c:Pt,p2:Pt,t:number)=>{ const mt=1-t; return {x:mt*mt*p0.x+2*mt*t*c.x+t*t*p2.x, y:mt*mt*p0.y+2*mt*t*c.y+t*t*p2.y} };
  const rec=(part:Pt[], depth:number)=>{
    if(part.length<=2||depth>8){ fitOne(part); return;}
    // asol fitted control diye error check
    const p0=part[0], p2=part[part.length-1], u=chordLengthParameterize(part);
    let wsum=0,cx=0,cy=0;
    for(let i=1;i<part.length-1;i++){ const t=u[i], mt=1-t, w=2*mt*t, w2=w*w+1e-9;
      const tx=(part[i].x-(mt*mt*p0.x+t*t*p2.x))/w, ty=(part[i].y-(mt*mt*p0.y+t*t*p2.y))/w;
      cx+=tx*w2; cy+=ty*w2; wsum+=w2; }
    const c=wsum===0?{x:(p0.x+p2.x)/2,y:(p0.y+p2.y)/2}:{x:cx/wsum,y:cy/wsum};
    let maxD=0, split=Math.floor(part.length/2);
    for(let i=1;i<part.length-1;i++){ const q=quadAt(p0,c,p2,u[i]); const d=(q.x-part[i].x)**2+(q.y-part[i].y)**2; if(d>maxD){maxD=d; split=i;}}
    if(maxD < tol*tol){ fitOne(part); return;}
    rec(part.slice(0,split+1),depth+1); rec(part.slice(split),depth+1);
  };
  rec(clean,0); return segs;
}

// ... solveLinear, fitClosedCircle, fitArc, fitEllipse ager motoi thakbe (thik ache) ...

export function fitPolyline(points: Pt[], opts: {closed:boolean, cornerThreshold:number, cornerWindow:number, tol:number, curveTypes:{lines:boolean, quadratic:boolean, cubic:boolean, circularArcs:boolean, ellipticalArcs:boolean}}): Seg[] {
  const pts=dedupe(points); if(pts.length<2) return []; if(pts.length===2) return lineSegs(pts, opts.closed);

  // FIX 4: Circle age kokhono call hoto na - ekhon sobar age check
  if(opts.closed && pts.length>=10 && opts.curveTypes.circularArcs){
    const circ = fitClosedCircle(pts, Math.max(opts.tol,0.7));
    if(circ){
      const {cx,cy,r,sweep}=circ;
      // pura circle ke 2ta half arc e vag
      const p0={x:cx+r,y:cy}, p1={x:cx-r,y:cy};
      return [
        {t:"M",x:p0.x,y:p0.y},
        {t:"A",rx:r,ry:r,rot:0,large:0,sweep, x:p1.x,y:p1.y},
        {t:"A",rx:r,ry:r,rot:0,large:0,sweep, x:p0.x,y:p0.y},
        {t:"Z"}
      ];
    }
  }
  if(pts.length <= 6) return lineSegs(pts, opts.closed); // 8->6 korlam, choto circle faceted hobe na

  const flags=detectCorners(pts, opts.cornerThreshold, opts.cornerWindow, opts.closed);
  const runs=splitAtCorners(pts, flags);
  const parts: Pt[][] = runs.length ? runs : [pts.slice().concat(opts.closed ? [pts[0]] : [])];
  const segs: Seg[]=[]; for(const run of parts) appendRun(segs, run, opts);
  if(segs.length===0) return lineSegs(pts, opts.closed);
  if(opts.closed) segs.push({t:"Z"});
  // sliver guard ager motoi
  if(opts.closed){
    const flat=flatten(segs,0.7);
    if(flat.length>4){
      let area=0, perim=0;
      for(let i=0,j=flat.length-1;i<flat.length;j=i++){ area+=flat[j].x*flat[i].y-flat[i].x*flat[j].y; }
      area=Math.abs(area/2);
      for(let i=0;i<flat.length;i++){ const a=flat[i], b=flat[(i+1)%flat.length]; perim+=Math.hypot(b.x-a.x,b.y-a.y); }
      const thinness= area>0 ? (perim*perim)/area : Infinity;
      if(area<4 || thinness>300){ return lineSegs(pts,true); }
    }
  }
  return segs;
}
