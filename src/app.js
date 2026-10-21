(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const {analyzePCM, makeBeats, lowerBound, random} = HeartfallCore;
  const canvas = $('scene'), ctx = canvas.getContext('2d', {alpha:true});
  const settings = {mode:'auto', density:'normal', offset:0, travel:2.2, bpm:120, color:'#ff8fae', size:1, burst:1, background:'velvet'};
  const S = {buffer:null, duration:20, analysis:null, beats:[], audio:null, gain:null, source:null, running:false, startedAt:0, offset:0, exporting:false, loading:false, recorder:null, exportEnd:0, downloadURL:null, name:'Neon Heart', mimeTypes:[]};
  let toastTimer, frameTime=0, waveformDirty=true, lastBackground='velvet';
  function selectedFormat() { return S.mimeTypes[Number($('format').value)]; }
  function syncFormat() {
    const transparent=Boolean(selectedFormat()?.alpha);
    if(transparent) {
      if($('background').value!=='transparent')lastBackground=$('background').value;
      $('background').value='transparent';
    } else if($('background').value==='transparent') $('background').value=lastBackground;
    settings.background=$('background').value;
    canvas.classList.toggle('transparent',transparent);
    $('format-hint').hidden=!transparent;
  }
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent=message; $('toast').hidden=false;
    toastTimer=setTimeout(()=>$('toast').hidden=true,6500);
  }
  function timeLabel(value) { const n=Math.max(0,Math.floor(value)); return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'); }
  function audioContext() {
    if(!S.audio) {
      S.audio=new (window.AudioContext||window.webkitAudioContext)();
      S.gain=S.audio.createGain(); S.gain.gain.value=Number($('volume').value); S.gain.connect(S.audio.destination);
    }
    return S.audio;
  }
  function currentTime() {
    return S.running ? Math.min(S.exporting?S.exportEnd:S.duration,S.offset+Math.max(0,S.audio.currentTime-S.startedAt)) : S.offset;
  }
  function updateControls() {
    for(const id of ['header-import','demo','audio-file','play','restart','export','reset']) $(id).disabled=S.loading||S.exporting||(!S.buffer&&['play','restart','export'].includes(id));
    $('seek').disabled=S.loading||S.exporting;
    $('play').textContent=S.running?'Ⅱ':'▶'; $('play').setAttribute('aria-label',S.running?'暂停':'播放');
    $('playback-state').textContent=S.exporting?'RECORDING':S.running?'PLAYING':'READY';
    document.body.classList.toggle('exporting',S.exporting);
    for(const el of document.querySelectorAll('.studio select,.studio input:not(#volume),.swatch')) {
      el.disabled=S.loading||S.exporting;
    }
  }
  function stopPlayback() {
    S.offset=currentTime(); S.running=false;
    if(S.source) { S.source.onended=null; try {S.source.stop();}catch{} S.source.disconnect(); S.source=null; }
    updateControls(); waveformDirty=true;
  }
  async function playFrom(offset, end=S.duration, recording=false) {
    const audio=audioContext(); await audio.resume();
    if(S.source) stopPlayback();
    const source=audio.createBufferSource(); source.buffer=S.buffer; source.connect(S.gain);
    if(recording) source.connect(S.recordDestination);
    S.source=source; S.offset=Math.max(0,Math.min(offset,S.duration));
    S.startedAt=audio.currentTime+0.05; S.running=true;
    source.onended=()=> {
      if(S.source!==source) return;
      S.running=false; S.offset=end; S.source=null; source.disconnect(); updateControls();
      if(recording) setTimeout(()=>finishExport(false),100);
    };
    source.start(S.startedAt,S.offset,Math.max(0.001,end-S.offset));
    updateControls();
  }
  async function togglePlay() {
    if(!S.buffer||S.loading||S.exporting) return;
    if(S.running) stopPlayback();
    else { try {await playFrom(S.offset>=S.duration-0.02?0:S.offset);} catch(e) {toast('无法播放：'+e.message);} }
  }
  async function runAnalysis(buffer) {
    // Retain the decoded stereo buffer for export. Only transfer the analysis copy.
    const mono=new Float32Array(buffer.length);
    for(let ch=0;ch<buffer.numberOfChannels;ch++) {
      const data=buffer.getChannelData(ch);
      for(let i=0;i<mono.length;i++) mono[i]+=data[i]/buffer.numberOfChannels;
    }
    const script='self.onmessage=e=>{try{const analyzePCM='+analyzePCM.toString()+';self.postMessage({result:analyzePCM(e.data.samples,e.data.rate)});}catch(error){self.postMessage({error:error.message});}}';
    const url=URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
    try {
      return await new Promise((resolve,reject)=> {
        let worker;
        try {worker=new Worker(url);} catch(e) {reject(e);return;}
        const timer=setTimeout(()=>{worker.terminate();reject(new Error('节奏分析超时，请试一段更短的音乐'));},120000);
        const done=()=>{clearTimeout(timer);worker.terminate();};
        worker.onmessage=e=>{done();e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);};
        worker.onerror=()=>{done();reject(new Error('当前浏览器阻止了本地分析线程，请用 Edge 或 Chrome 打开'));};
        worker.postMessage({samples:mono,rate:buffer.sampleRate},[mono.buffer]);
      });
    } finally {URL.revokeObjectURL(url);}
  }
  function rebuildBeats() {
    if(!S.analysis) return;
    S.beats=makeBeats(S.analysis,S.duration,settings);
    $('beat-count').textContent=S.beats.length+' 个节奏点';
    if(!S.beats.length) $('analysis-state').textContent='没有检测到明显重音，可切换固定 BPM。';
    else $('analysis-state').textContent='✓ 分析完成 · 节奏已对齐';
    waveformDirty=true;
  }
  async function setTrack(buffer,name) {
    if(buffer.duration>1800) throw new Error('请使用 30 分钟以内的音乐，或先截取要制作的片段。');
    $('analysis-state').textContent='正在分析整段音乐的节奏…';
    const analysis=await runAnalysis(buffer);
    S.buffer=buffer; S.duration=buffer.duration; S.analysis=analysis; S.name=name; S.offset=0;
    settings.bpm=analysis.bpm||120; $('bpm').value=settings.bpm;
    $('track-name').textContent=name; $('track-name').title=name;
    $('track-duration').textContent=timeLabel(S.duration); $('total-time').textContent=timeLabel(S.duration);
    $('tempo').textContent=analysis.bpm?'≈ '+analysis.bpm+' BPM':'BPM 未识别';
    $('seek').max=S.duration; $('seek').value=0;
    $('export-start').value=0; $('export-end').value=S.duration.toFixed(2);
    $('export-start').max=S.duration; $('export-end').max=S.duration;
    $('download').hidden=true; if(S.downloadURL) {URL.revokeObjectURL(S.downloadURL);S.downloadURL=null;}
    rebuildBeats();
  }
  async function loadFile(file) {
    if(!file||S.exporting||S.loading) return;
    stopPlayback(); S.loading=true; updateControls();
    $('analysis-state').textContent='正在读取并解码音乐…';
    try {
      const buffer=await audioContext().decodeAudioData(await file.arrayBuffer());
      await setTrack(buffer,file.name.replace(/\.[^.]+$/,'')); toast('音乐已就绪，点击播放预览。');
    } catch(e) {
      $('analysis-state').textContent=S.buffer?'载入失败，保留上一首音乐。':'载入失败';
      toast('无法读取这首音乐。请尝试 MP3 或 WAV。'+(e.message||''));
    } finally {S.loading=false; $('audio-file').value=''; updateControls();}
  }
  function createDemo() {
    const rate=32000, duration=20, buffer=audioContext().createBuffer(2,rate*duration,rate);
    const data=buffer.getChannelData(0), right=buffer.getChannelData(1);
    const notes=[220,261.6256,329.6276,293.6648,220,261.6256,391.9954,329.6276];
    for(let i=0;i<data.length;i++) {
      const t=i/rate, beat=Math.floor(t*2), p=t%0.5, sub=t%0.25;
      const kick=p<0.22?Math.sin(2*Math.PI*(48*p+95*0.025*(1-Math.exp(-p/0.025))))*Math.exp(-p*23)*0.65:0;
      const noise=random(i+17)*2-1;
      const snare=beat%2===1&&p<0.13?noise*Math.exp(-p*35)*0.19:0;
      const hat=sub<0.045?noise*Math.exp(-sub*130)*0.08:0;
      const f=notes[Math.floor(t*2)%notes.length];
      const melody=Math.sin(2*Math.PI*f*t)*Math.exp(-p*7)*0.12;
      const pad=(Math.sin(2*Math.PI*110*t)+Math.sin(2*Math.PI*164.8138*t))*0.025;
      const fade=Math.min(1,t*35,(duration-t)*8);
      data[i]=(kick+snare+hat+melody+pad)*fade; right[i]=data[i]*0.96;
    }
    return buffer;
  }
  async function loadDemo() {
    if(S.exporting||S.loading) return;
    stopPlayback(); S.loading=true; updateControls();
    try {await setTrack(createDemo(),'Neon Heart · 内置演示');}
    catch(e) {toast(e.message);$('analysis-state').textContent='演示载入失败，可直接导入音乐。';}
    finally {S.loading=false;updateControls();}
  }
  function setSize() {
    const p=Number($('quality').value), aspect=$('aspect').value;
    canvas.width=aspect==='landscape'?Math.round(p*16/9):p;
    canvas.height=aspect==='portrait'?Math.round(p*16/9):p;
    canvas.classList.toggle('landscape',aspect==='landscape');
    $('canvas-size').textContent=canvas.width+' × '+canvas.height+' / 目标 30 FPS';
    canvas.setAttribute('aria-label',aspect==='landscape'?'音乐可视化预览：爱心沿横向光轨从左向右移动，在右侧红圈处踩点爆炸':'音乐可视化预览：爱心沿紫色光轨下落，在底部红圈处踩点爆炸');
  }
  function heartPath(c,x,y,s) {
    c.beginPath(); c.moveTo(x,y+s*0.87);
    c.bezierCurveTo(x-s*0.22,y+s*0.65,x-s,y+s*0.12,x-s,y-s*0.35);
    c.bezierCurveTo(x-s,y-s*0.95,x-s*0.28,y-s*1.08,x,y-s*0.55);
    c.bezierCurveTo(x+s*0.28,y-s*1.08,x+s,y-s*0.95,x+s,y-s*0.35);
    c.bezierCurveTo(x+s,y+s*0.12,x+s*0.22,y+s*0.65,x,y+s*0.87); c.closePath();
  }
  function drawHeart(x,y,s,color,alpha=1) {
    ctx.save();ctx.globalAlpha=alpha; ctx.shadowColor=color; ctx.shadowBlur=s*0.75;
    const g=ctx.createLinearGradient(x-s,y-s,x+s,y+s);g.addColorStop(0,'#ffe4ef');g.addColorStop(0.3,color);g.addColorStop(1,'#a33c72');
    heartPath(ctx,x,y,s);ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#fff1f8';ctx.lineWidth=Math.max(1.5,s*0.065);ctx.stroke();
    ctx.shadowBlur=0;heartPath(ctx,x,y,s*0.87);ctx.strokeStyle='#ffffff55';ctx.lineWidth=Math.max(1,s*0.025);ctx.stroke();ctx.restore();
  }
  function drawScene(t) {
    const w=canvas.width,h=canvas.height,unit=Math.min(w,h)/720,horizontal=$('aspect').value==='landscape';
    const x=horizontal?w*0.86:w/2,y=horizontal?h/2:h*0.86,top=-(horizontal?w:h)*0.08;
    const transparent=settings.background==='transparent';
    const color=settings.color, travel=Number(settings.travel), strength=Number(settings.burst);
    let pulse=0;
    const first=lowerBound(S.beats,t-1.2), last=lowerBound(S.beats,t+travel+0.01);
    for(let i=first;i<last;i++){const age=t-S.beats[i].time;if(age>=0&&age<0.35)pulse=Math.max(pulse,Math.exp(-age*12)*(0.5+S.beats[i].strength*0.5));}
    const energy=S.analysis?.energy[Math.floor(t/(S.analysis.step||0.01))]||0;
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;
    ctx.clearRect(0,0,w,h);
    if(!transparent) {ctx.fillStyle=settings.background==='black'?'#030204':settings.background==='dusk'?'#130b24':'#0b090e';ctx.fillRect(0,0,w,h);}
    if(!transparent&&settings.background!=='black') {
      const fog=ctx.createRadialGradient(x,h*0.48,0,x,h*0.5,h*0.72);
      fog.addColorStop(0,settings.background==='dusk'?'#3d204455':'#64534b44');fog.addColorStop(0.6,'#23182322');fog.addColorStop(1,'#00000000');ctx.fillStyle=fog;ctx.fillRect(0,0,w,h);
      for(let i=0;i<9;i++) {
        const xx=w*(i/8)+Math.sin(t*0.15+i)*w*0.025;
        const beam=ctx.createLinearGradient(xx-38*unit,0,xx+38*unit,0);beam.addColorStop(0,'#ffffff00');beam.addColorStop(0.5,'#d6c3bb05');beam.addColorStop(1,'#ffffff00');ctx.fillStyle=beam;ctx.fillRect(xx-38*unit,0,76*unit,h);
      }
    }
    // Static seeded dust remains identical when seeking or rendering again.
    for(let i=0;i<(transparent?0:44);i++) {
      const xx=random(i+20)*w, yy=(random(i+95)*h-t*(6+random(i+7)*8)*unit)%(h+20);
      ctx.globalAlpha=(0.1+random(i+201)*0.26)*(0.7+0.3*Math.sin(t+i));ctx.fillStyle='#d4aec7';ctx.beginPath();ctx.arc(xx,yy<0?yy+h:yy,(0.4+random(i+66))*unit,0,Math.PI*2);ctx.fill();
    }ctx.globalAlpha=1;
    const line=ctx.createLinearGradient(0,0,horizontal?w:0,horizontal?0:h);line.addColorStop(0,'#cb54ff00');line.addColorStop(0.12,'#d65dffbb');line.addColorStop(0.72,'#f378faff');line.addColorStop(1,'#d76dff00');
    ctx.save();ctx.strokeStyle=line;ctx.shadowColor='#df55ff';ctx.shadowBlur=(22+energy*12+pulse*18)*unit;
    ctx.lineWidth=(3+energy*1.5)*unit;ctx.beginPath();ctx.moveTo(horizontal?0:x,horizontal?y:0);ctx.lineTo(horizontal?w:x,horizontal?y:h);ctx.stroke();
    ctx.shadowBlur=0;ctx.lineWidth=unit;ctx.strokeStyle='#ffe3ffbb';ctx.beginPath();ctx.moveTo(horizontal?w*0.08:x,horizontal?y:h*0.08);ctx.lineTo(horizontal?w*0.96:x,horizontal?y:h*0.96);ctx.stroke();ctx.restore();
    // Ground halo and red judgement ring.
    const glow=ctx.createRadialGradient(x,y,0,x,y,(62+pulse*45)*unit);glow.addColorStop(0,'#f85b982c');glow.addColorStop(0.4,'#fd407c10');glow.addColorStop(1,'#f85b9800');ctx.fillStyle=glow;ctx.fillRect(x-120*unit,y-120*unit,240*unit,240*unit);
    ctx.save();ctx.strokeStyle='#fa4b6c';ctx.lineWidth=(2.8+pulse*2)*unit;ctx.shadowColor='#ff466a';ctx.shadowBlur=(8+pulse*22)*unit;ctx.beginPath();ctx.arc(x,y,(39+pulse*4)*unit,0,Math.PI*2);ctx.stroke();ctx.restore();
    for(let i=first;i<last;i++) {
      const beat=S.beats[i],age=t-beat.time;
      if(age<0) {
        const p=1+age/travel;if(p<0||p>1)continue;
        const xx=horizontal?top+(x-top)*p:x,yy=horizontal?y:top+(y-top)*p,s=(25+beat.strength*5)*unit*Number(settings.size);
        ctx.save();ctx.globalAlpha=Math.min(1,p*7);ctx.shadowColor=color;ctx.shadowBlur=15*unit;
        const trail=ctx.createLinearGradient(horizontal?xx-s*5:xx,horizontal?yy:yy-s*5,xx,yy);trail.addColorStop(0,color+'00');trail.addColorStop(1,color+'44');ctx.fillStyle=trail;
        if(horizontal)ctx.fillRect(xx-s*5,yy-s*0.25,s*5,s*0.5);else ctx.fillRect(xx-s*0.25,yy-s*5,s*0.5,s*5);ctx.restore();
        drawHeart(xx,yy,s,color,Math.min(1,p*7));
      } else if(age<1.05&&strength>0) {
        const fade=Math.max(0,1-age/0.9),s=(23+beat.strength*6)*unit;
        ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=fade*0.65;
        ctx.strokeStyle=color;ctx.lineWidth=(2.8*(1-age)+0.5)*unit;ctx.shadowColor=color;ctx.shadowBlur=10*unit;
        ctx.beginPath();ctx.arc(x,y,(20+age*180*strength)*unit,0,Math.PI*2);ctx.stroke();
        if(age<0.18) {ctx.globalAlpha=(1-age/0.18)*0.8;ctx.fillStyle='#fff5fd';ctx.beginPath();ctx.arc(x,y,(9+age*80)*unit,0,Math.PI*2);ctx.fill();}
        ctx.restore();
        const n=Math.round(30*strength);
        for(let k=0;k<n;k++) {
          const seed=i*113+k*7, angle=random(seed+1)*Math.PI*2,v=(60+random(seed+2)*240)*unit*(0.5+strength*0.5);
          const px=x+Math.cos(angle)*v*age,py=y+Math.sin(angle)*v*age+age*age*90*unit;
          const opacity=Math.max(0,1-age/(0.45+random(seed+5)*0.6));if(opacity<=0)continue;
          if(k%8===0) drawHeart(px,py,(3+random(seed+6)*5)*unit,color,opacity);
          else {ctx.save();ctx.globalAlpha=opacity;ctx.fillStyle=k%3===0?'#fff4fb':color;ctx.shadowColor=color;ctx.shadowBlur=8*unit;ctx.beginPath();ctx.arc(px,py,(1+random(seed+3)*2.5)*unit,0,Math.PI*2);ctx.fill();ctx.restore();}
        }
        if(age<0.14)drawHeart(x,y,s*(1+age*2),color,(1-age/0.14)*0.7);
      }
    }
  }
  function drawWaveform(t) {
    const c=$('waveform'), rect=c.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    if(c.width!==Math.round(rect.width*dpr)||c.height!==Math.round(rect.height*dpr)) {c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.height*dpr);}
    const g=c.getContext('2d'),w=c.width,h=c.height;g.clearRect(0,0,w,h);
    const wave=S.analysis?.waveform,played=t/S.duration*w;
    for(let i=0;i<Math.floor(w/(4*dpr));i++) {
      const x=i*4*dpr, amplitude=wave?wave[Math.min(319,Math.floor(x/w*320))]:0.18;
      const size=Math.max(2*dpr,Math.pow(amplitude,0.65)*h*0.84);
      g.fillStyle=x<played?'#ddb0c9':'#4c3a55';g.fillRect(x,(h-size)/2,2*dpr,size);
    }
    g.fillStyle='#d3a3c5';g.fillRect(Math.min(w-1,played),0,dpr,h);
  }
  function frame(now) {
    const t=currentTime();
    if(now-frameTime>=1000/60-1) {drawScene(t);frameTime=now;}
    $('seek').value=t;$('current-time').textContent=timeLabel(t);
    if(S.running||waveformDirty) {drawWaveform(t);waveformDirty=false;}
    if(S.exporting) {
      const progress=Math.min(100,Math.max(0,(t-S.exportStart)/(S.exportEnd-S.exportStart)*100));
      $('export-bar').value=progress;
      $('export-status').textContent='正在导出 '+progress.toFixed(0)+'% · 剩余约 '+Math.max(0,Math.ceil(S.exportEnd-t))+' 秒';
    }
    requestAnimationFrame(frame);
  }
  function findFormats() {
    if(typeof MediaRecorder==='undefined'||!canvas.captureStream) return;
    const candidates=[
      {label:'MP4 · 通用视频',type:'video/mp4;codecs=avc1.42001E,mp4a.40.2',ext:'mp4'},
      {label:'MP4 · 通用视频',type:'video/mp4',ext:'mp4'},
      {label:'WebM · 浏览器视频',type:'video/webm;codecs=vp9,opus',ext:'webm'},
      {label:'WebM · 浏览器视频',type:'video/webm;codecs=vp8,opus',ext:'webm'},
      {label:'WebM · 浏览器视频',type:'video/webm',ext:'webm'},
      {label:'WebM · 透明通道',type:'video/webm;codecs=vp9,opus',ext:'webm',alpha:true},
      {label:'WebM · 透明通道',type:'video/webm;codecs=vp8,opus',ext:'webm',alpha:true}
    ];
    for(const item of candidates)if(!S.mimeTypes.some(x=>x.ext===item.ext&&Boolean(x.alpha)===Boolean(item.alpha))&&MediaRecorder.isTypeSupported(item.type))S.mimeTypes.push(item);
    $('format').replaceChildren(...S.mimeTypes.map((f,i)=>{const o=document.createElement('option');o.value=i;o.textContent=f.label;return o;}));
    if(!S.mimeTypes.length){const o=document.createElement('option');o.textContent='当前浏览器不支持视频导出';$('format').append(o);}
    const transparentOption=$('background').querySelector('option[value="transparent"]');
    transparentOption.disabled=!S.mimeTypes.some(x=>x.alpha);
  }
  function downloadBlob(blob,name) {
    if(S.downloadURL)URL.revokeObjectURL(S.downloadURL);
    S.downloadURL=URL.createObjectURL(blob);const a=$('download');a.href=S.downloadURL;a.download=name;a.hidden=false;
    a.textContent='↓ 下载视频 · '+(blob.size/1048576).toFixed(1)+' MB';a.click();
  }
  function cleanupExport() {
    if(S.recordStream)S.recordStream.getTracks().forEach(t=>t.stop());
    if(S.recordDestination)S.recordDestination.disconnect();
    S.recordStream=null;S.recordDestination=null;S.recorder=null;S.exporting=false;
    $('export-progress').hidden=true;updateControls();
  }
  function finishExport(cancelled) {
    if(!S.exporting||!S.recorder||S.recorder.state==='inactive')return;
    S.exportCancelled=cancelled;stopPlayback();S.recorder.stop();
    $('export-status').textContent=cancelled?'正在取消…':'正在封装视频…';
  }
  async function startExport() {
    if(!S.buffer||S.loading||S.exporting)return;
    const format=selectedFormat();
    if(!format){toast('当前浏览器不支持视频录制，请使用最新版 Edge 或 Chrome。');return;}
    const start=Number($('export-start').value),end=Number($('export-end').value);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>S.duration+0.02||end-start<0.3) {toast('请设置有效的开始和结束时间，片段至少 0.3 秒，且不能超出音乐时长。');return;}
    stopPlayback();S.restoreOffset=S.offset; S.exportStart=start;S.exportEnd=Math.min(end,S.duration);S.exportCancelled=false;
    try {
      const audio=audioContext();await audio.resume();
      S.recordDestination=audio.createMediaStreamDestination();
      drawScene(start);const video=canvas.captureStream(30);
      S.recordStream=new MediaStream([...video.getVideoTracks(),...S.recordDestination.stream.getAudioTracks()]);
      S.recorder=new MediaRecorder(S.recordStream,{mimeType:format.type,videoBitsPerSecond:Number($('quality').value)===1080?10000000:5500000,audioBitsPerSecond:192000});
      const chunks=[];
      S.recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      S.recorder.onerror=e=>{S.exportCancelled=true;toast('导出遇到编码错误：'+(e.error?.message||'请改用 WebM 或降低分辨率。'));finishExport(true);};
      S.recorder.onstop=()=> {
        const cancelled=S.exportCancelled,mime=S.recorder?.mimeType||format.type;
        cleanupExport();S.offset=S.restoreOffset;waveformDirty=true;
        if(cancelled)return;
        if(!chunks.length){toast('没有生成视频数据，请改用 WebM 格式重试。');return;}
        const blob=new Blob(chunks,{type:mime});
        downloadBlob(blob,S.name.replace(/[<>:"/\\|?*]/g,'_')+'-心动节拍'+(format.alpha?'-透明':'')+'.'+format.ext);
        toast(format.alpha?'透明视频已生成，包含音乐，可在支持 WebM Alpha 的软件中叠加。':'视频已生成，包含原音乐。也可以点击下方链接再次下载。');
      };
      S.exporting=true;updateControls();$('download').hidden=true;$('export-progress').hidden=false;$('export-bar').value=0;
      S.recorder.start(1000);await playFrom(start,S.exportEnd,true);
    } catch(e) {
      if(S.source)stopPlayback();
      if(S.recorder&&S.recorder.state!=='inactive'){S.exportCancelled=true;S.recorder.stop();}
      else cleanupExport();
      toast('无法导出：'+e.message+'。可以尝试 WebM 格式。');
    }
  }
  $('play').onclick=togglePlay;
  $('restart').onclick=()=>{if(S.exporting||S.loading)return;const playing=S.running;stopPlayback();S.offset=0;if(playing)playFrom(0).catch(e=>toast(e.message));};
  $('seek').oninput=()=>{if(S.exporting||S.loading)return;const playing=S.running;const t=Number($('seek').value);stopPlayback();S.offset=t;waveformDirty=true;if(playing&&t<S.duration)playFrom(t).catch(e=>toast(e.message));};
  $('audio-file').onchange=e=>loadFile(e.target.files[0]);
  $('header-import').onclick=()=>$('audio-file').click();$('demo').onclick=loadDemo;
  const drop=$('dropzone');
  for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag');});
  for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('drag');});
  drop.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
  window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
  function updateSettings() {
    settings.mode=$('mode').value;settings.density=$('density').value;settings.offset=Number($('offset').value);
    settings.bpm=Number($('bpm').value);settings.travel=Number($('travel').value);
    settings.size=Number($('heart-size').value);settings.burst=Number($('burst').value);settings.background=$('background').value;settings.color=$('color').value;
    $('offset-value').textContent=(settings.offset>0?'+':'')+settings.offset+' ms';$('travel-value').textContent=settings.travel.toFixed(1)+' 秒';
    $('heart-size-value').textContent=Math.round(settings.size*100)+'%';$('burst-value').textContent=Math.round(settings.burst*100)+'%';
    $('density-field').hidden=settings.mode==='grid';$('bpm-field').hidden=settings.mode!=='grid';
    document.querySelectorAll('.swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===settings.color)));
    rebuildBeats();
  }
  for(const id of ['mode','density','offset','travel','bpm','heart-size','burst','color'])$(id).addEventListener('input',()=>{if(!S.exporting&&!S.loading)updateSettings();});
  $('format').onchange=()=>{if(!S.exporting&&!S.loading)syncFormat();};
  $('background').onchange=()=>{
    if(S.exporting||S.loading)return;
    if($('background').value==='transparent') {
      const index=S.mimeTypes.findIndex(x=>x.alpha);
      if(index<0){$('background').value=lastBackground;toast('当前浏览器不支持透明视频，请使用最新版 Edge 或 Chrome。');return;}
      $('format').value=index;
    } else {
      lastBackground=$('background').value;
      if(selectedFormat()?.alpha)$('format').value=Math.max(0,S.mimeTypes.findIndex(x=>!x.alpha));
    }
    syncFormat();updateSettings();
  };
  document.querySelectorAll('.swatch').forEach(b=>b.onclick=()=>{if(S.exporting||S.loading)return;$('color').value=b.dataset.color;updateSettings();});
  $('volume').oninput=()=>{const v=Number($('volume').value);$('volume-value').textContent=Math.round(v*100)+'%';if(S.gain)S.gain.gain.setTargetAtTime(v,S.audio.currentTime,0.025);};
  for(const id of ['aspect','quality'])$(id).onchange=()=>{if(!S.exporting)setSize();};
  $('reset').onclick=()=>{if(S.exporting||S.loading)return;Object.entries({mode:'auto',density:'normal',offset:'0',travel:'2.2','heart-size':'1',burst:'1',background:'velvet',color:'#ff8fae'}).forEach(([id,v])=>$(id).value=v);lastBackground='velvet';syncFormat();updateSettings();toast('画面与节奏设置已恢复默认。');};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('preview-panel').requestFullscreen();}catch{toast('当前窗口不支持全屏，请在 Edge 或 Chrome 中打开。');}};
  $('export').onclick=startExport;$('cancel-export').onclick=()=>finishExport(true);
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON','TEXTAREA','A'].includes(document.activeElement.tagName)){e.preventDefault();togglePlay();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.exporting){finishExport(true);toast('导出已取消：页面进入后台会影响录制，请保持页面在前台后重试。');}});
  window.addEventListener('beforeunload',e=>{if(S.exporting){e.preventDefault();e.returnValue='';}});
  window.addEventListener('resize',()=>waveformDirty=true);
  findFormats();syncFormat();setSize();requestAnimationFrame(frame);loadDemo();
})();
