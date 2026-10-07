import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code=readFileSync(new URL('./src/auto-scale-region.js',import.meta.url),'utf8');
const {detectScaleReference}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const glyphs={
  '5':['11111','11000','11000','11110','00011','00011','11110'],
  '0':['01110','11011','11011','11011','11011','11011','01110'],
  'u':['00000','11011','11011','11011','11011','11111','11000'],
  'm':['00000','11111','10101','10101','10101','10101','10101']
};
const frame=(width=640,height=480,value=27)=>({width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:value)});
const pixel=(image,x,y,value)=>{const p=(y*image.width+x)*4;for(let c=0;c<3;c++)image.data[p+c]=Array.isArray(value)?value[c]:value;};
function drawReference(image,{length=100,thickness=3,side='left',fontScale=2,value=205,text=true,line=true,margin=12,gap=5,position}={}) {
  const x=position??(side==='left'?margin:image.width-margin-length),y=image.height-margin-thickness;
  const textWidth=4*6*fontScale-fontScale,tx=Math.round(x+(length-textWidth)/2),ty=y-7*fontScale-gap;
  const left=Math.max(0,Math.min(x,tx)-3),right=Math.min(image.width,Math.max(x+length,tx+textWidth)+3);
  for(let yy=ty-3;yy<y+thickness+3;yy++)for(let xx=left;xx<right;xx++)pixel(image,xx,yy,5);
  if(text)for(const [i,character]of Array.from('50um').entries())for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(glyphs[character][gy][gx]==='1')for(let dy=0;dy<fontScale;dy++)for(let dx=0;dx<fontScale;dx++)pixel(image,tx+i*6*fontScale+gx*fontScale+dx,ty+gy*fontScale+dy,value);
  if(line)for(let yy=y;yy<y+thickness;yy++)for(let xx=x;xx<x+length;xx++)pixel(image,xx,yy,value);
  return {x,y,length,thickness,textX:tx,textY:ty};
}
for(const setup of [
  {},{side:'right'},{length:101},{length:50,thickness:1,fontScale:1},
  {width:320,height:240,length:40,thickness:2,fontScale:1,margin:8,gap:3},
  {width:1200,height:900,length:180,thickness:5,fontScale:3,margin:16,gap:7},
  {value:70,noise:7},{side:'right',length:120,value:90,noise:9}
]) {
  const image=frame(setup.width,setup.height),expected=drawReference(image,setup);
  if(setup.noise)for(let i=0;i<image.data.length;i++)if(i%4!==3)image.data[i]+=((i*17)%(setup.noise*2+1))-setup.noise;
  const result=detectScaleReference(image);
  assert(result,`Missing reference ${JSON.stringify(setup)}`);
  assert.equal(result.pixelLength,expected.length,'Include both line edge pixels, without off-by-one shortening');
  assert(result.x<=expected.x&&result.y<=expected.textY&&result.x+result.w>=expected.x+expected.length&&result.y+result.h>=expected.y+expected.thickness,'Region encloses line and its text');
  assert(result.w<image.width*.4&&result.h<image.height*.15,'Never return a large scientific scene patch');
  const mapped=detectScaleReference(image,{width:image.width*3,height:image.height*3});
  for(const key of ['x','y','w','h','pixelLength'])assert.equal(mapped[key],result[key]*3,'Measurement maps back to original source pixels');
}
const downsample=frame(480,360);drawReference(downsample,{length:75,thickness:2,fontScale:1,margin:9,gap:4});
assert.equal(detectScaleReference(downsample,{width:1280,height:960}).pixelLength,200,'A 75-pixel sampled line represents 200 original pixels');
for(const options of [{line:false},{text:false},{position:260},{margin:0}]) {
  const image=frame();drawReference(image,options);assert.equal(detectScaleReference(image),null,`Reject ${JSON.stringify(options)}`);
}
const double=frame();drawReference(double);drawReference(double,{side:'right'});
assert.equal(detectScaleReference(double),null,'Two plausible references are ambiguous, not a reason to choose one');
const border=frame();
for(let y=475;y<480;y++)for(let x=0;x<640;x++)pixel(border,x,y,240);
assert.equal(detectScaleReference(border),null,'A frame border is not a scale line');
const cells=frame();drawReference(cells,{text:false});
for(let cell=0;cell<4;cell++)for(let yy=-7;yy<=7;yy++)for(let xx=-7;xx<=7;xx++)if(Math.hypot(xx,yy)>5&&Math.hypot(xx,yy)<7)pixel(cells,30+cell*20+xx,440+yy,180);
assert.equal(detectScaleReference(cells),null,'Round scene objects above a line are not text glyphs');
const colored=frame();const line=drawReference(colored,{text:false});
for(let y=line.y;y<line.y+line.thickness;y++)for(let x=line.x;x<line.x+line.length;x++)pixel(colored,x,y,[80,240,60]);
assert.equal(detectScaleReference(colored),null,'A colored scientific feature is not a neutral scale reference');
assert.equal(detectScaleReference(frame()),null);
for(const invalid of [null,{}, {width:640,height:480,data:[]}, {width:-1,height:480,data:[]}])assert.equal(detectScaleReference(invalid),null);
console.log('Automatic scale reference: inclusive widths, source mapping, faint/noisy bars, both corners and conservative ambiguity/scene rejection passed.');
