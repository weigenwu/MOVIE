// Find a drawn reference line plus its label; never infer physical calibration
// from image resolution. The caller supplies the known physical line length.
export function detectScaleReference(image, meta = image) {
  const W = image?.width, H = image?.height, data = image?.data, outW = meta?.width, outH = meta?.height;
  if (![W,H,outW,outH].every(n => Number.isInteger(n) && n > 0) || !data || data.length < W*H*4) return null;
  const top = Math.floor(H*.7), rows = H-top, light = new Uint8Array(W*rows), luminance = new Uint8Array(W*rows);
  for (let y=top;y<H;y++) for (let x=0;x<W;x++) {
    const p=(y*W+x)*4, i=(y-top)*W+x, value=(77*data[p]+150*data[p+1]+29*data[p+2])>>8;
    luminance[i]=value;
    if (value>=50 && Math.max(data[p],data[p+1],data[p+2])-Math.min(data[p],data[p+1],data[p+2])<=Math.max(22,value*.2)) light[i]=1;
  }
  const minLength=Math.max(12,Math.ceil(W*.012)), groups=[];
  for (let y=Math.floor(H*.8);y<H-1;y++) {
    let start=-1,last=-1,count=0;
    const accept=()=>{
      const width=last-start+1;
      if (width<minLength || width>W*.35 || count/width<.94 || !((start<W*.12 && last<W*.42)||(last>W*.88 && start>W*.58))) return;
      const previous=groups.find(g=>g.bottom===y-1 && Math.abs(g.line.x-start)<=2 && Math.abs(g.line.right-last)<=2);
      const line={x:start,right:last,w:width};
      if (previous) { previous.bottom=y; if (width>previous.line.w) previous.line=line; }
      else groups.push({y,bottom:y,line});
    };
    for (let x=0;x<=W;x++) {
      if (x<W && light[(y-top)*W+x]) { if(start<0)start=x;last=x;count++; }
      else if(start>=0 && (x-last>1 || x===W)) { accept();start=-1;count=0; }
    }
  }
  if (groups.length>80) return null;
  const results=[];
  for (const bar of groups) {
    const {x,right,w}=bar.line,h=bar.bottom-bar.y+1;
    if (h>Math.max(2,Math.min(H*.012,w*.12)) || bar.y<=top+4 || bar.bottom>=H-2) continue;
    // The immediate rows outside a true reference bar should be dark, not a
    // bright cell interior or the edge of a large light object.
    let surround=0,dark=0;
    for(const y of [bar.y-1,bar.bottom+1,bar.bottom+2]) for(let bx=x;bx<=right;bx++) {
      surround++; if(luminance[(y-top)*W+bx]<48)dark++;
    }
    if(dark/surround<.82)continue;
    const x0=Math.max(0,Math.floor(x-w*.3)),x1=Math.min(W,Math.ceil(right+w*.3+1));
    const y0=Math.max(top,bar.y-Math.ceil(Math.min(H*.08,w*.65))),y1=bar.y-1,rw=x1-x0,rh=y1-y0;
    if(rh<5)continue;
    const visited=new Uint8Array(rw*rh),queue=new Int32Array(rw*rh),marks=[];
    for(let yy=0;yy<rh;yy++) for(let xx=0;xx<rw;xx++) {
      const first=yy*rw+xx;
      if(visited[first]||!light[(y0+yy-top)*W+x0+xx])continue;
      let head=0,tail=1,l=rw,r=0,t=rh,b=0;queue[0]=first;visited[first]=1;
      while(head<tail) {
        const current=queue[head++],cx=current%rw,cy=Math.floor(current/rw);
        l=Math.min(l,cx);r=Math.max(r,cx);t=Math.min(t,cy);b=Math.max(b,cy);
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          const nx=cx+dx,ny=cy+dy,index=ny*rw+nx;
          if(nx>=0&&nx<rw&&ny>=0&&ny<rh&&!visited[index]&&light[(y0+ny-top)*W+x0+nx]){visited[index]=1;queue[tail++]=index;}
        }
      }
      const mw=r-l+1,mh=b-t+1;
      if(mh>=4&&mh<=Math.min(H*.06,w*.4)&&mw>=2&&mw<=mh*2&&tail>=mh&&tail<mw*mh*.95)marks.push({x:x0+l,right:x0+r,y:y0+t,bottom:y0+b,w:mw,h:mh,cy:y0+(t+b)/2});
    }
    const labels=[];
    for(const anchor of marks) {
      const row=marks.filter(m=>m.h>=anchor.h*.65&&m.h<=anchor.h*1.5&&Math.abs(m.cy-anchor.cy)<=anchor.h*.4).sort((a,b)=>a.x-b.x);
      if(row.length<3||row.length>12||row.filter(m=>m.w<=m.h*.85).length<2)continue;
      const left=row[0].x,last=Math.max(...row.map(m=>m.right)),upper=Math.min(...row.map(m=>m.y)),lower=Math.max(...row.map(m=>m.bottom));
      const height=lower-upper+1,gap=bar.y-lower-1;
      if(h>height*.45||w<height*2.5||gap<1||gap>Math.max(8,height*.9)||last-left+1>w*1.5||last-left+1<w*.15||Math.abs((left+last-x-right)/2)>w*.3)continue;
      if(row.some((m,i)=>i>0&&m.x-row[i-1].right>height*1.2))continue;
      labels.push({x:left,right:last,y:upper});
    }
    if(!labels.length)continue;
    const label=labels.sort((a,b)=>b.y-a.y)[0],padding=2;
    const bx=Math.max(0,Math.min(x,label.x)-padding),by=Math.max(top,label.y-padding);
    const br=Math.min(W,Math.max(right,label.right)+padding+1),bb=Math.min(H,bar.bottom+padding+1);
    // Label and bar must share a mostly dark local background. No large scene
    // rectangle is returned when only a bright horizontal feature is present.
    let background=0,backgroundDark=0;
    for(let yy=by;yy<bb;yy++)for(let xx=bx;xx<br;xx++)if(!light[(yy-top)*W+xx]){background++;if(luminance[(yy-top)*W+xx]<48)backgroundDark++;}
    if(!background||backgroundDark/background<.9)continue;
    results.push({x:bx*outW/W,y:by*outH/H,w:(br-bx)*outW/W,h:(bb-by)*outH/H,pixelLength:w*outW/W});
  }
  return results.length===1?results[0]:null;
}
