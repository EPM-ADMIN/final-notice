/* FINAL NOTICE — original prototype. No network, accounts, or purchases. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const board = $('board'), ctx = board.getContext('2d');
  let engine = new FinalNoticeEngine(), mode = 'normal', muted = false, audio = null;
  let started = false, lastFrame = 0, previousPhase = '', previousCard = -1, previousUpgrade = -1;
  let awarded = [], scratchLayers = [], scratchProgress = [], dragging = false, pointer = null, pointerCell = -1, keyboardCell = 0;
  let useKeyboard = false, lastFeedback = 0, lastScratchSound = 0, lastBeat = 0, feedbackUntil = 0, floaters = [], pulses = [0,0], winSaved = false;
  let saved = { bestEarned: 0, wins: 0 };
  try { saved = { ...saved, ...JSON.parse(localStorage.getItem('final-notice-v1') || '{}') }; } catch (_) {}
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const cellRect = i => ({ x: 17 + (i % 5) * 117, y: 11 + Math.floor(i / 5) * 91, w: 108, h: 79 });
  const center = i => { const r = cellRect(i); return {x:r.x+r.w/2,y:r.y+r.h/2}; };
  const cellAt = p => { for(let i=0;i<20;i++){const r=cellRect(i);if(p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h)return i;}return -1; };
  const coords = e => {const r=board.getBoundingClientRect();return {x:(e.clientX-r.left)*610/r.width,y:(e.clientY-r.top)*400/r.height};};
  const accessible = i => !engine.state.cells[i].revealed && (!engine.state.path.length || engine.legalMoves().includes(i));

  function initAudio(){
    try {
      if(!audio){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC)return;
        audio=new AC();
        const osc=audio.createOscillator(),osc2=audio.createOscillator(),gain=audio.createGain();
        osc.type='sine';osc.frequency.value=54;osc2.type='sine';osc2.frequency.value=55.1;gain.gain.value=.014;
        osc.connect(gain);osc2.connect(gain);gain.connect(audio.destination);osc.start();osc2.start();audio.ambient=gain;
      }
      audio.resume().catch(()=>{});
    }catch(_){}
  }
  function tone(freq=440,duration=.1,type='sine',vol=.05,slide=0){
    if(!audio||muted||audio.state!=='running')return;
    const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type=type;o.frequency.setValueAtTime(freq,t);
    if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(15,freq+slide),t+duration);
    g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(vol,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+duration);
    o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+duration+.02);
  }
  function hiss(duration=.06,volume=.026){
    if(!audio||muted||audio.state!=='running')return;
    const n=Math.floor(audio.sampleRate*duration),b=audio.createBuffer(1,n,audio.sampleRate),data=b.getChannelData(0);
    for(let i=0;i<n;i++)data[i]=(Math.random()*2-1)*(1-i/n);
    const source=audio.createBufferSource(),g=audio.createGain(),filter=audio.createBiquadFilter();source.buffer=b;filter.type='highpass';filter.frequency.value=1300;g.gain.value=volume;source.connect(filter);filter.connect(g);g.connect(audio.destination);source.start();
  }
  function feedback(message,important=false){$('feedback').textContent=message;feedbackUntil=performance.now()+(important?3600:2100);$('feedback').classList.toggle('danger-text',important);}
  function freshCoating(){
    scratchProgress=Array(20).fill(0);scratchLayers=[];awarded=[];
    for(let i=0;i<20;i++){
      const c=document.createElement('canvas');c.width=108;c.height=79;const g=c.getContext('2d');
      const grad=g.createLinearGradient(0,0,95,79);grad.addColorStop(0,'#7b8069');grad.addColorStop(.4,'#a5a58a');grad.addColorStop(.5,'#949982');grad.addColorStop(1,'#737967');g.fillStyle=grad;g.fillRect(0,0,108,79);
      for(let j=0;j<90;j++){const x=(j*71+i*17)%108,y=(j*31+i*11)%79;g.fillStyle=j%2?'#d9dabc20':'#292d2723';g.fillRect(x,y,6+(j%12),1);}
      g.strokeStyle='#c4c5a655';g.strokeRect(4.5,4.5,99,70);g.strokeStyle='#515b4d99';g.beginPath();g.moveTo(48,27);g.lineTo(60,27);g.lineTo(60,49);g.lineTo(48,49);g.closePath();g.stroke();g.fillStyle='#59624e';g.font='bold 18px Courier New';g.textAlign='center';g.fillText('?',54,44);
      g.font='8px Courier New';g.fillStyle='#3d493bd0';g.fillText(String(i+1).padStart(2,'0'),54,65);
      scratchLayers.push(c);
    }
    keyboardCell=0;pointerCell=-1;pointer=null;dragging=false;
  }
  function scratch(i,p,amount){
    if(engine.state.phase!=='playing'||engine.state.paused||engine.state.quiet||i<0)return;
    if(!accessible(i)){
      if(!engine.state.cells[i].revealed && performance.now()-lastFeedback>1800){feedback('Follow the glowing edge: only adjoining seals connect.');lastFeedback=performance.now();}
      return;
    }
    const r=cellRect(i),g=scratchLayers[i].getContext('2d');g.globalCompositeOperation='destination-out';g.beginPath();g.arc(p.x-r.x,p.y-r.y,17,0,Math.PI*2);g.fill();scratchProgress[i]+=amount;
    if(performance.now()-lastScratchSound>65){hiss();lastScratchSound=performance.now();}
    if(scratchProgress[i]>=44){
      engine.reveal(i);processEvents();
    }
  }
  function act(method,...args){initAudio();const r=engine[method](...args);if(r&&!r.ok)feedback(r.message);processEvents();renderUI();return r;}
  function startGame(){
    initAudio();engine=new FinalNoticeEngine({mode,seed:Date.now()});window.finalNotice=engine;winSaved=false;previousPhase='';previousCard=-1;previousUpgrade=-1;floaters=[];started=true;engine.start();processEvents();renderUI();board.focus({preventScroll:true});
  }
  function showPanel(id){$('overlay').classList.remove('hidden');['introPanel','pausePanel','upgradePanel','endPanel'].forEach(x=>$(x).classList.toggle('hidden',x!==id));}
  function setPause(value,help=false){
    if(engine.state.phase==='menu'){if(help){showPanel('pausePanel');$('resumeBtn').textContent='BACK';}return;}
    if(engine.state.phase!=='playing')return;
    dragging=false;pointer=null;engine.pause(value);if(value){$('pauseTitle').innerHTML=help?'KNOW THE<br>RULES.':'TAKE A<br>BREATH.';showPanel('pausePanel');$('resumeBtn').textContent='BACK TO WORK ↗';$('resumeBtn').focus();}else{$('overlay').classList.add('hidden');board.focus({preventScroll:true});}renderUI();
  }
  function processEvents(){
    for(const e of engine.drainEvents()){
      if(e.message)feedback(e.message,e.type==='lost'||(e.type==='reveal'&&e.symbolType==='eye'));
      if(e.type==='reveal'){
        awarded[e.index]=e.value;
        const p=center(e.index);floaters.push({x:p.x,y:p.y-12,text:'+'+money(e.value+(e.bonus||0)),life:1.1,color:e.symbolType==='eye'?'#8d331e':'#31512c'});
        if(e.symbolType==='spark'){tone(660,.16,'sine',.06,220);setTimeout(()=>tone(990,.18,'sine',.04),80);}
        else if(e.symbolType==='eye'){tone(90,.25,'sawtooth',.035,-45);pulses[engine.state.selectedLane]=.5;}
        else if(e.symbolType==='ward')tone(520,.25,'sine',.045,-80);
        else tone(270+(e.combo||1)*23,.06,'triangle',.032,50);
        if(e.bonus){tone(880,.25,'triangle',.05,440);$('claim').classList.remove('shake');void $('claim').offsetWidth;$('claim').classList.add('shake');}
      }else if(e.type==='cashout'){tone(1200,.5,'sine',.05,-180);setTimeout(()=>tone(1800,.24,'triangle',.025),90);}
      else if(e.type==='decoy'){pulses[e.lane]=1.5;tone(390,.8,'sawtooth',.022,-340);hiss(.5,.065);}
      else if(e.type==='lost'){tone(60,1.4,'sawtooth',.07,-30);hiss(.3,.08);}
      else if(e.type==='shiftEnd'||e.type==='won'){[392,494,587].forEach((n,i)=>setTimeout(()=>tone(n,.6,'sine',.05),i*150));}
    }
  }
  function saveBest(){
    if(winSaved)return;winSaved=true;saved.bestEarned=Math.max(saved.bestEarned,engine.state.stats.earned);if(engine.state.phase==='won')saved.wins++;
    try{localStorage.setItem('final-notice-v1',JSON.stringify(saved));}catch(_){}
  }
  function renderUI(){
    const s=engine.state;
    if(previousCard!==s.cardId){previousCard=s.cardId;freshCoating();}
    $('shiftLabel').textContent=`SHIFT ${String(s.shift).padStart(2,'0')} / 03`;
    const elapsed=s.duration?s.duration-s.timeLeft:0,mins=Math.min(359,Math.floor(elapsed/Math.max(1,s.duration)*360));
    const hour=Math.floor(mins/60);$('clock').innerHTML=`${hour===0?'12':String(hour).padStart(2,'0')}:${String(mins%60).padStart(2,'0')} <small>AM</small>`;
    $('remaining').textContent=`${Math.ceil(s.phase==='menu'?90:s.timeLeft)}s until collection`;
    $('remaining').classList.toggle('danger-text',s.timeLeft<15&&s.phase==='playing');
    $('bill').textContent=money(s.bill);$('bank').textContent=money(s.bank);$('pot').innerHTML=`${money(s.pot)}<span>.00</span>`;
    $('combo').textContent='×'+s.multiplier.toFixed(2);$('routeLength').textContent=String(s.path.length).padStart(2,'0')+' SEALS LINKED';
    $('serial').textContent=`FORM ${String(s.cardId).padStart(3,'0')} — ${s.path.length?'IN PROGRESS':'UNSEALED'}`;
    $('invoiceNumber').textContent='№ '+String(s.shift).padStart(3,'0');
    const covered=s.bank>=s.bill;$('billProgress').style.width=Math.min(100,s.bank/s.bill*100)+'%';$('billStatus').textContent=covered?'Bill covered. Stay alive.':money(s.bill-s.bank)+' still to earn';document.querySelector('.invoice').classList.toggle('covered',covered);
    $('potHint').textContent=s.path.length===20?'BLACKOUT JACKPOT':s.path.length>=12?'Greed sounds good.':s.pot>=12?'Cash. Or a way out.':'Make a little noise.';
    $('routeBonus').textContent=s.path.length>=20?'BLACKOUT +$100':s.path.length>=16?'20 LINKS = +$100':s.path.length>=12?'16 LINKS = +$40':s.path.length>=8?'12 LINKS = +$30':'8 LINKS = +$20';
    $('boardNote').style.opacity=s.path.length?0:1;
    const active=s.phase==='playing'&&!s.paused;$('cashBtn').disabled=!active||!s.pot;$('decoy0').disabled=$('decoy1').disabled=!active||s.pot<12;$('quietBtn').disabled=!active;
    $('quietBtn').classList.toggle('active',s.quiet);document.body.classList.toggle('quieting',s.quiet);
    s.lanes.forEach((l,i)=>{const threat=Math.min(100,l.threat);$('threat'+i).style.width=threat+'%';$('threat'+i).style.background=threat>75?'#f27b61':threat>50?'#e2bd74':'#a5ba7c';$('threatText'+i).textContent=Math.floor(threat)+'%';$('status'+i).textContent=threat>86?'AT YOUR DOOR':threat>67?'APPROACHING':threat>40?'FOOTSTEPS':'DISTANT';$('lane'+i).classList.toggle('selected',s.selectedLane===i);$('lane'+i).classList.toggle('danger',threat>75);});
    $('noiseLabel').textContent=s.quiet?'HUSHED':s.noise>60?'LOUD':s.noise>25?'AUDIBLE':'QUIET';$('echoReady').textContent=s.pot>=12?'LOADED':'EMPTY';document.querySelector('.spool').classList.toggle('ready',s.pot>=12);
    $('echoInfo').textContent=s.pot>=12?`Burn your ${money(s.pot)} claim to send a false trail. Choose a hallway below.`:'A $12 claim buys one distraction. Burn it into either hallway.';
    $('best').textContent=saved.bestEarned?'BEST SHIFT RUN '+money(saved.bestEarned)+' / '+saved.wins+' CLEARED':'YOUR DEBT IS OUR BUSINESS.';
    const maxThreat=Math.max(...s.lanes.map(l=>l.threat));$('dangerFlash').style.opacity=active&&maxThreat>78?Math.min(.7,(maxThreat-78)/32):0;
    if(audio)audio.ambient.gain.setTargetAtTime(muted||!active?.0:.010+maxThreat*.00009,audio.currentTime,.3);
    if(s.phase!==previousPhase){
      previousPhase=s.phase;
      if(s.phase==='playing'){$('overlay').classList.add('hidden');board.focus({preventScroll:true});}
      if(s.phase==='upgrade'){
        showPanel('upgradePanel');$('upgradeSummary').textContent=`Bill settled. ${money(s.bank)} carries into shift ${s.shift+1}. Choose one benefit.`;
        $('upgradeChoices').replaceChildren();
        s.availableUpgrades.forEach((item,i)=>{const up=typeof item==='string'?FinalNoticeEngine.UPGRADES?.[item]:item;if(!up)return;const b=document.createElement('button');b.className='upgrade-card';b.dataset.upgrade=up.id;b.innerHTML=`<span class="perk-icon">${['✥','◈','⌁'][i%3]}</span><strong>${up.name}</strong><p>${up.description}</p><small>ACCEPT BENEFIT ↗</small>`;b.onclick=()=>{act('chooseUpgrade',up.id);previousUpgrade=-1;};$('upgradeChoices').append(b);});
        $('upgradeChoices').firstElementChild?.focus();
      }
      if(s.phase==='won'||s.phase==='lost'){
        showPanel('endPanel');saveBest();const won=s.phase==='won',unpaid=!won&&s.reason.includes('bill was short');$('endEyebrow').textContent=won?'06:00 AM / DEBT CLEARED':unpaid?'PAYMENT FAILED / ACCOUNT OVERDUE':'EMPLOYEE ACCOUNT TERMINATED';$('endTitle').innerHTML=won?'YOU OWE<br><em>NOTHING.</em>':unpaid?'YOUR TIME<br><em>IS UP.</em>':'THEY FOUND<br><em>YOU.</em>';$('endReason').textContent=won?'The last receipt prints. The locks release. For the first time tonight, the footsteps are yours.':s.reason;$('endEarned').textContent=money(s.stats.earned);$('endDecoys').textContent=s.stats.decoys;$('endCombo').textContent=s.stats.bestCombo+' / 20';$('restartBtn').textContent=won?'CLOCK IN AGAIN ↗':'TRY AGAIN ↗';$('restartBtn').focus();
      }
    }
    if(s.upgrades.length!==previousUpgrade){previousUpgrade=s.upgrades.length;$('perkList').replaceChildren();if(!s.upgrades.length){const li=document.createElement('li');li.textContent='No benefits. Naturally.';$('perkList').append(li);}else{s.upgrades.forEach(id=>{const li=document.createElement('li');li.textContent=({'silent':'Velvet glove · quieter ink','yield':'Loaded ink · +25% payout','lure':'False address · stronger echoes','capacitor':'Lucky filament · bigger sparks','overtime':'Borrowed minute · +20 seconds','insurance':'Door chain · safer start'})[id]||id;$('perkList').append(li);});}}
  }
  function roundedRect(g,x,y,w,h,r=4){g.beginPath();g.roundRect(x,y,w,h,r);}
  function drawBoard(t,dt){
    const s=engine.state;ctx.clearRect(0,0,610,400);const legal=engine.legalMoves();
    if(s.path.length>1){ctx.beginPath();s.path.forEach((i,n)=>{const p=center(i);n?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.lineWidth=8;ctx.strokeStyle='#78602c88';ctx.stroke();}
    s.cells.forEach((c,i)=>{
      const r=cellRect(i),isLast=s.path.at(-1)===i;
      roundedRect(ctx,r.x,r.y,r.w,r.h,3);ctx.fillStyle=c.revealed?'#303c2b':'#bbb18f';ctx.fill();
      if(c.revealed){
        ctx.strokeStyle=isLast?'#8d6120':'#738457';ctx.lineWidth=isLast?3:1;ctx.stroke();
        const symbol=({money:'$',spark:'✦',eye:'◉',ward:'⌁'})[c.type];ctx.textAlign='center';ctx.fillStyle=c.type==='eye'?'#e99676':c.type==='spark'?'#f3cd74':'#d4d9ab';ctx.font=c.type==='money'?'24px Courier New':'29px Arial';ctx.fillText(symbol,r.x+r.w/2,r.y+33);
        ctx.fillStyle='#dddcac';ctx.font=c.type==='spark'?'bold 12px Courier New':'bold 15px Courier New';ctx.fillText(c.type==='spark'?'MULTIPLIER':c.type==='eye'?'MARKED':c.type==='ward'?'WARD':'$'+(awarded[i]??c.value),r.x+r.w/2,r.y+56);
        ctx.font='8px Courier New';ctx.fillStyle='#aabb87';ctx.fillText(String(s.path.indexOf(i)+1).padStart(2,'0'),r.x+12,r.y+14);
      }else{
        // The reward is physically underneath the removable foil.
        ctx.fillStyle='#374332';ctx.font='bold 22px Courier New';ctx.textAlign='center';ctx.fillText(c.type==='money'?'$'+c.value:({spark:'✦',eye:'◉',ward:'⌁'})[c.type],r.x+54,r.y+46);
        if(scratchLayers[i])ctx.drawImage(scratchLayers[i],r.x,r.y);
        if(legal.includes(i)&&s.path.length){ctx.strokeStyle='#eceac4';ctx.lineWidth=2;roundedRect(ctx,r.x+1,r.y+1,r.w-2,r.h-2,3);ctx.stroke();ctx.fillStyle='#ede6bc';ctx.fillRect(r.x+r.w/2-6,r.y+r.h-5,12,3);}
        if(s.path.length&&!legal.includes(i)){ctx.fillStyle='#1b211b27';ctx.fillRect(r.x,r.y,r.w,r.h);}
      }
      if(useKeyboard&&keyboardCell===i){ctx.strokeStyle='#ebad41';ctx.lineWidth=3;ctx.strokeRect(r.x-3,r.y-3,r.w+6,r.h+6);}
    });
    floaters=floaters.filter(f=>f.life>0);floaters.forEach(f=>{f.life-=dt;f.y-=dt*26;ctx.globalAlpha=Math.min(1,f.life*2);ctx.font='bold 23px Courier New';ctx.textAlign='center';ctx.strokeStyle='#e9dfb8';ctx.lineWidth=4;ctx.strokeText(f.text,f.x,f.y);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);ctx.globalAlpha=1;});
    if(s.quiet){ctx.fillStyle='#101b13bb';ctx.fillRect(0,0,610,400);ctx.fillStyle='#cfdbb6';ctx.textAlign='center';ctx.font='20px Courier New';ctx.fillText('HOLDING YOUR BREATH',305,187);ctx.font='12px Courier New';ctx.fillText('Release to keep scratching.',305,216);}
  }
  function drawCamera(canvas,i,t){
    const g=canvas.getContext('2d'),w=420,h=250,threat=engine.state.lanes[i].threat;
    g.fillStyle='#0b140d';g.fillRect(0,0,w,h);
    const vanX=i?222:196,vanY=97;
    const grad=g.createRadialGradient(vanX,vanY,4,vanX,vanY,230);grad.addColorStop(0,'#61714a');grad.addColorStop(.32,'#273522');grad.addColorStop(1,'#0a120c');g.fillStyle=grad;g.fillRect(0,0,w,h);
    g.lineWidth=1;g.strokeStyle='#7c8c594f';
    [[0,0],[w,0],[0,h],[w,h]].forEach(p=>{g.beginPath();g.moveTo(...p);g.lineTo(vanX,vanY);g.stroke();});
    for(let j=1;j<=5;j++){const k=j/6;g.strokeStyle='#82975a'+(j%2?'3a':'27');g.strokeRect(vanX*k,vanY*k,w*(1-k),h*(1-k));}
    g.fillStyle='#0a100a';g.fillRect(vanX-23,vanY-32,46,67);g.fillStyle='#a7b373';g.fillRect(vanX-20,vanY-39,40,3);
    const doors=[40,110,277,345];doors.forEach((x,n)=>{g.fillStyle='#0a130bf0';g.beginPath();g.moveTo(x,35+n%2*25);g.lineTo(x+25,46+n%2*21);g.lineTo(x+25,175-n%2*22);g.lineTo(x,188-n%2*22);g.closePath();g.fill();});
    if(threat>27){
      const near=(threat-27)/73,scale=.22+near*.88,x=vanX+Math.sin(i*3+threat*.03)*20,y=105+near*85;
      g.save();g.translate(x,y);g.scale(scale,scale);g.fillStyle='#030704';g.beginPath();g.moveTo(-19,-20);g.lineTo(-42,90);g.lineTo(-25,100);g.lineTo(-12,43);g.lineTo(-10,126);g.lineTo(-1,129);g.lineTo(2,58);g.lineTo(13,127);g.lineTo(24,126);g.lineTo(15,40);g.lineTo(29,91);g.lineTo(39,86);g.lineTo(18,-19);g.closePath();g.fill();g.beginPath();g.ellipse(0,-40,18,28,0,0,Math.PI*2);g.fill();
      if(threat>50){g.shadowColor='#d9dda8';g.shadowBlur=12;g.fillStyle=threat>82?'#ecd1b7':'#b3be8b';g.fillRect(-10,-44,6,2);g.fillRect(5,-44,6,2);g.shadowBlur=0;}g.restore();
    }
    if(pulses[i]>0){g.fillStyle='#c9d99c';g.globalAlpha=Math.min(.5,pulses[i]*.3);g.fillRect(0,0,w,h);g.globalAlpha=1;g.font='bold 15px Courier New';g.textAlign='center';g.fillStyle='#e0e8c5';g.fillText('ECHO TRANSMITTING',w/2,h-20);}
    g.fillStyle='#07100735';for(let y=0;y<h;y+=4)g.fillRect(0,y,w,1);
    const offset=Math.floor(t*9);for(let j=0;j<95;j++){const x=(j*73+offset*11)%w,y=(j*43+offset*3)%h;g.fillStyle=j%2?'#c0d98a10':'#00000028';g.fillRect(x,y,3+j%9,1);}
    g.fillStyle='#b3c68c9c';g.font='11px Courier New';g.textAlign='left';g.fillText('REC '+(i+1)+'  '+Math.floor(t/60).toString().padStart(2,'0')+':'+Math.floor(t%60).toString().padStart(2,'0'),12,18);
  }
  function drawSignal(t){const g=$('signal').getContext('2d');g.clearRect(0,0,440,80);g.strokeStyle=engine.state.noise>60?'#d6a06c':'#9ab47b';g.lineWidth=1;g.beginPath();const a=engine.state.noise*.28+2;for(let x=0;x<440;x+=2){const y=40+Math.sin(x*.18+t*13)*Math.sin(x*.043+t*3)*a;x?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();}

  board.addEventListener('pointerdown',e=>{if(e.button!==0||engine.state.phase!=='playing'||engine.state.paused)return;e.preventDefault();useKeyboard=false;board.focus({preventScroll:true});board.setPointerCapture(e.pointerId);dragging=true;pointer=coords(e);pointerCell=cellAt(pointer);scratch(pointerCell,pointer,15);});
  board.addEventListener('pointermove',e=>{if(!dragging)return;const p=coords(e),i=cellAt(p),dist=pointer?Math.hypot(p.x-pointer.x,p.y-pointer.y):0;pointer=p;pointerCell=i;scratch(i,p,Math.min(24,dist*.7));});
  function stopScratch(){dragging=false;pointer=null;pointerCell=-1;}
  board.addEventListener('pointerup',stopScratch);board.addEventListener('pointercancel',stopScratch);board.addEventListener('lostpointercapture',stopScratch);
  $('cashBtn').onclick=()=>act('cashOut');$('decoy0').onclick=()=>act('decoy',0);$('decoy1').onclick=()=>act('decoy',1);$('lane0').onclick=()=>act('selectLane',0);$('lane1').onclick=()=>act('selectLane',1);
  $('startBtn').onclick=startGame;$('restartBtn').onclick=startGame;$('pauseBtn').onclick=()=>setPause(!engine.state.paused);$('helpBtn').onclick=()=>setPause(true,true);$('resumeBtn').onclick=()=>{if(engine.state.phase==='menu'){showPanel('introPanel');return;}setPause(false);};
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));});
  $('soundBtn').onclick=()=>{initAudio();muted=!muted;$('soundBtn').textContent=muted?'SOUND OFF':'SOUND ON';$('soundBtn').setAttribute('aria-pressed',String(!muted));};
  $('quietBtn').addEventListener('pointerdown',e=>{e.preventDefault();$('quietBtn').setPointerCapture(e.pointerId);act('setQuiet',true);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])$('quietBtn').addEventListener(name,()=>{if(engine.state.quiet)act('setQuiet',false);});
  $('quietBtn').addEventListener('click',e=>{if(e.detail===0)act('setQuiet',!engine.state.quiet);});
  window.addEventListener('keydown',e=>{
    if(e.code==='Escape'){if(engine.state.phase==='playing'){e.preventDefault();setPause(!engine.state.paused);}return;}
    if(engine.state.phase!=='playing'||engine.state.paused)return;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    if(e.repeat&&e.code!=='Space')return;
    if(e.code==='Space'){if(!engine.state.quiet)act('setQuiet',true);}
    else if(e.code==='KeyF')act('cashOut');else if(e.code==='KeyQ')act('decoy',0);else if(e.code==='KeyE')act('decoy',1);else if(e.code==='KeyA')act('selectLane',0);else if(e.code==='KeyD')act('selectLane',1);
    else if(e.code.startsWith('Arrow')){useKeyboard=true;board.focus({preventScroll:true});let dx=e.code==='ArrowLeft'?-1:e.code==='ArrowRight'?1:0,dy=e.code==='ArrowUp'?-1:e.code==='ArrowDown'?1:0;let x=Math.max(0,Math.min(4,keyboardCell%5+dx)),y=Math.max(0,Math.min(3,Math.floor(keyboardCell/5)+dy));keyboardCell=y*5+x;}
    else if(e.code==='Enter'&&document.activeElement===board){e.preventDefault();useKeyboard=true;act('reveal',keyboardCell);}
  });
  window.addEventListener('keyup',e=>{if(e.code==='Space'&&engine.state.quiet)act('setQuiet',false);});
  window.addEventListener('blur',()=>{if(engine.state.phase==='playing'&&!engine.state.paused)setPause(true);stopScratch();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&engine.state.phase==='playing'&&!engine.state.paused)setPause(true);});
  function frame(now){
    const dt=lastFrame?Math.min(.08,(now-lastFrame)/1000):0;lastFrame=now;const t=now/1000;
    engine.tick(dt);
    if(dragging&&pointer&&pointerCell>=0)scratch(pointerCell,pointer,dt*80);
    processEvents();renderUI();drawBoard(t,dt);drawCamera($('cam0'),0,t);drawCamera($('cam1'),1,t);drawSignal(t);pulses=pulses.map(p=>Math.max(0,p-dt));
    if(engine.state.phase==='playing'&&!engine.state.paused){
      const max=Math.max(...engine.state.lanes.map(x=>x.threat));if(max>68&&t-lastBeat>1.4-(max-68)*.025){lastBeat=t;tone(49,.12,'sine',.07);setTimeout(()=>tone(43,.12,'sine',.035),130);}
      if(now>feedbackUntil){if(max>82)feedback('It is at the door. Burn a $12+ claim into that hall.',true);else if(engine.state.bank>=engine.state.bill)feedback('Bill covered. Keep earning for tomorrow—or stay quiet.');else if(engine.state.path.length&&!engine.legalMoves().length)feedback('End of the route. Bank it with F or turn it into an echo.');}
    }
    requestAnimationFrame(frame);
  }
  window.finalNotice=engine;
  // A readable snapshot supports QA without coupling game logic to the renderer.
  window.finalNoticeSnapshot=()=>JSON.parse(JSON.stringify(engine.state));
  renderUI();requestAnimationFrame(frame);
})();
