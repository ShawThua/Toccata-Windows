/* A local-only, Canvas rendering of the upstream Toccata activity share card.
 * Inputs must come from one frozen committed snapshot of the selected range.
 * No network access or DOM insertion is performed by this module. */
(function (root) {
  'use strict';
  const WIDTH = 720;
  const palette = { background:'#f6f8fb', white:'#ffffff', ink:'#29303f', muted:'#6d7887', blue:'#295ed4', pale:'#eef2fc', border:'#e4e8ee' };
  const words = {
    zh: {title:'我的键盘足迹', active:'键盘活跃时间', keys:'按键次数', rate:'平均击键频率', rateNote:'击键频率按活跃分钟计算 · 含修饰键，过滤长按重复', unavailable:'不可用', heat:'键盘热力图', heatHint:'越深，按得越多', noKeys:'当前布局内暂无按键记录', timeline:'活跃时间线', timelineHint:'每格 15 分钟', noTimeline:'暂无活动记录', apps:'常用应用', appsHint:'活跃时长前 6 名', noApps:'暂无应用记录', count:'次按键', local:'本机已保存记录 · 活跃时长为估算', tagline:'看见投入'},
    en: {title:'My keyboard footprint', active:'Keyboard active time', keys:'Key presses', rate:'Keystroke rate', rateNote:'Rate uses active minutes; includes modifiers, excludes auto-repeat.', unavailable:'Unavailable', heat:'Keyboard heatmap', heatHint:'Darker means more presses', noKeys:'No recorded keys in this layout', timeline:'Activity timeline', timelineHint:'Each cell is 15 minutes', noTimeline:'No activity records', apps:'Most-used apps', appsHint:'Top 6 by active time', noApps:'No app records', count:'key presses', local:'Saved on this device · activity time is an estimate', tagline:'See your effort'},
  };
  function num(v) { return Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0; }
  // Reuse the range totals: averaging individual days would weight quiet days
  // incorrectly. Active time includes the configured activity window and holds.
  function keystrokeRate(stats) {
    const count=stats?.key_count, activeMs=stats?.active_ms;
    if (!Number.isFinite(count) || count<0 || !Number.isFinite(activeMs) || activeMs<=0) return null;
    const rate=count/activeMs*60000;
    return Number.isFinite(rate) ? rate : null;
  }
  function formatKeystrokeRate(stats, language='zh', compact=false) {
    const rate=keystrokeRate(stats);
    if (rate===null) return '—';
    const english=language==='en', value=Math.round(rate).toLocaleString(english?'en-US':'zh-CN');
    return english ? `${value}/${compact?'min':'active min'}` : `${value} 次/${compact?'分':'活跃分钟'}`;
  }
  // Use all presses in the selected period, including keys outside the chosen
  // physical layout. Match upstream's bounded, at-most-one-decimal percentage.
  function keyUsagePercent(count, total, language='zh') {
    if (!Number.isFinite(count) || count < 0 || !Number.isFinite(total) || total <= 0) return '0%';
    const percentage=Math.min(1,count/total)*100;
    return `${(Math.round(percentage*10)/10).toLocaleString(language==='en'?'en-US':'zh-CN',{maximumFractionDigits:1})}%`;
  }
  function duration(ms, lang) {
    if (ms === null || ms === undefined) return words[lang].unavailable;
    const seconds = Math.floor(num(ms) / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    if (lang === 'en') return `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`;
    return `${h ? h + '小时 ' : ''}${m ? m + '分 ' : ''}${s}秒`;
  }
  function keyboardGeometry(layout) {
    if (!layout) throw new TypeError('Keyboard layout is unavailable');
    if (Array.isArray(layout.keys)) {
      if (!layout.keys.length) throw new TypeError('Keyboard layout is unavailable');
      const keys=layout.keys.map(key=>{const {x,y,w,h}=key;if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<=0||h<=0)throw new TypeError('Invalid keyboard geometry');return {...key}});
      return {keys,width:Math.max(...keys.map(k=>k.x+k.w)),height:Math.max(...keys.map(k=>k.y+k.h)),gap:Math.max(0,num(layout.keyGap))/(num(layout.unit)||54)};
    }
    if (!Array.isArray(layout.rows) || !layout.rows.length) throw new TypeError('Keyboard layout is unavailable');
    let rowY = 0, maxX = 0, maxY = 0; const keys = [];
    const step = layout.rowStep;
    if (step !== undefined && (!Number.isFinite(step) || step <= 0)) throw new TypeError('Invalid keyboard row step');
    for (const row of layout.rows) {
      if (!Array.isArray(row)) throw new TypeError('Invalid keyboard row');
      let x = 0, rowHeight = 1;
      for (const key of row) {
        const w = key.w ?? 1, h = key.h ?? 1, dx = key.x ?? 0, dy = key.y ?? 0;
        if (![w,h,dx,dy].every(Number.isFinite) || w <= 0 || h <= 0) throw new TypeError('Invalid keyboard geometry');
        x += dx; keys.push({ ...key, x, y:rowY + dy, w, h }); x += w;
        maxY = Math.max(maxY, rowY + dy + h);
        maxX = Math.max(maxX, x); rowHeight = Math.max(rowHeight, dy+h);
      }
      rowY += step === undefined ? rowHeight : step;
    }
    if (maxX <= 0 || maxY <= 0) throw new TypeError('Invalid keyboard size');
    return { keys, width:maxX, height:Math.max(rowY,maxY), gap:Math.max(0, num(layout.keyGap)) / (num(layout.unit) || 54) };
  }
  // The same opaque teal-blue scale is used by the live keyboard and share card.
  function keyHeat(count, max) {
    count=num(count);max=num(max);if(count<=0||max<=0)return null;
    const ratio=Math.log1p(count)/Math.log1p(max),strength=.12+.88*ratio;
    const base=[235,246,246],blue=[22,100,131],rgb=base.map((x,i)=>Math.round(x+(blue[i]-x)*strength));
    const luminance=values=>values.map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);
    const light=luminance(rgb),white=1.05/(light+.05),ink=(light+.05)/(luminance([25,43,64])+.05);
    return {fill:`rgb(${rgb.join(',')})`,ink:white>=ink?'#ffffff':'#192b40',ratio};
  }
  function rounded(ctx,x,y,w,h,r,fill) {
    if (w <= 0 || h <= 0) return;
    const radius = Math.min(r,w/2,h/2);
    ctx.beginPath();ctx.moveTo(x+radius,y);ctx.lineTo(x+w-radius,y);ctx.quadraticCurveTo(x+w,y,x+w,y+radius);ctx.lineTo(x+w,y+h-radius);ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);ctx.lineTo(x+radius,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-radius);ctx.lineTo(x,y+radius);ctx.quadraticCurveTo(x,y,x+radius,y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  }
  function text(ctx, value,x,y,size,color,weight='400',align='left',maxWidth) {
    ctx.font = `${weight} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';
    if (maxWidth) ctx.fillText(String(value),x,y,maxWidth); else ctx.fillText(String(value),x,y);
  }
  function heading(ctx,title,detail,y) { text(ctx,title,34,y,23,palette.ink);text(ctx,detail,686,y,17,palette.muted,'400','right'); }
  function cellCountLabel(count, lang) { return lang === 'en' ? `${count.toLocaleString('en-US')} key presses` : `${count.toLocaleString('zh-CN')} 次按键`; }
  function keyboardLabel(key) { return key.label === '' ? 'Space' : String(key.label ?? ''); }
  function rankedKeyLabel(key, lang, windows) {
    const modifier = (windows ? {55:['Win','left'],54:['Win','right'],56:['Shift','left'],60:['Shift','right'],
      58:['Alt','left'],61:['Alt','right'],59:['Ctrl','left'],62:['Ctrl','right']} :
      {55:['⌘','left'],54:['⌘','right'],56:['⇧','left'],60:['⇧','right'],
      58:['⌥','left'],61:['⌥','right'],59:['⌃','left'],62:['⌃','right']})[key.code];
    if (!modifier) return key.code === 63 ? 'Fn' : keyboardLabel(key);
    return `${lang === 'en' ? (modifier[1] === 'left' ? 'Left' : 'Right') : (modifier[1] === 'left' ? '左' : '右')} ${modifier[0]}`;
  }
  function fitGeometry(layout, width) {
    const geo=keyboardGeometry(layout), unit=width/geo.width;
    return { ...geo, unit, renderedHeight:geo.height*unit };
  }

  function render({ stats, timelineStats, rangeLabel, layout, language, appIcons = {} } = {}) {
    if (!stats || typeof stats !== 'object') throw new TypeError('Activity statistics are required');
    const lang=language === 'en' ? 'en' : 'zh', w=words[lang];
    const timeline = timelineStats || stats;
    const days = Array.isArray(timeline.days) ? timeline.days : [];
    const apps = Array.isArray(stats.apps) ? stats.apps.slice(0,6) : [];
    const counts = stats.keys && typeof stats.keys === 'object' ? stats.keys : {};
    const geo=fitGeometry(layout,656);
    const heatHeight=84+geo.renderedHeight+((Object.values(counts).some(v=>num(v)>0))?84:48);
    const timelineHeight=78+(days.length ? days.length*(days.length===1?68:55) : 30);
    const appHeight=64+(apps.length ? Math.ceil(apps.length/2)*76 : 30);
    const heatTop=244, timelineTop=heatTop+heatHeight+12, appsTop=timelineTop+timelineHeight+12;
    const height=appsTop+appHeight+84;
    const scale=Math.min(2,16000/height,Math.sqrt(32000000/(WIDTH*height)));
    if (scale < .5) throw new RangeError(lang==='en'?'The selected range is too long to export':'所选时段过长，请缩短范围后再生成图片');
    const canvas=document.createElement('canvas'); canvas.width=Math.ceil(WIDTH*scale);canvas.height=Math.ceil(height*scale);
    const ctx=canvas.getContext('2d'); if(!ctx)throw new Error('Canvas 2D is unavailable');ctx.scale(scale,scale);
    ctx.fillStyle=palette.background;ctx.fillRect(0,0,WIDTH,height);
    text(ctx,w.title,20,45,32,palette.ink);text(ctx,'◇ Toccata',700,43,21,palette.blue,'500','right');text(ctx,rangeLabel||'',20,75,19,palette.muted);
    rounded(ctx,18,91,684,71,13,palette.pale);text(ctx,w.active,36,134,21,palette.muted);text(ctx,duration(stats.active_ms ?? 0,lang),684,138,35,palette.blue,'400','right',390);
    rounded(ctx,18,170,338,62,13,palette.white);rounded(ctx,364,170,338,62,13,palette.white);
    text(ctx,w.keys,32,193,18,palette.muted);text(ctx,num(stats.key_count).toLocaleString(lang==='en'?'en-US':'zh-CN'),32,220,27,palette.ink);
    text(ctx,w.rate,378,193,18,palette.muted);text(ctx,formatKeystrokeRate(stats,lang),378,220,27,palette.ink,'400','left',310);
    const visibleCodes=new Set(geo.keys.map(k=>String(k.code))),outside=Object.entries(counts).reduce((sum,[code,value])=>sum+(visibleCodes.has(code)?0:num(value)),0);
    rounded(ctx,18,heatTop,684,heatHeight,16,palette.white);heading(ctx,w.heat,lang==='en'?`Known keys outside: ${outside.toLocaleString()}`:`已知按键布局外 ${outside.toLocaleString()} 次`,heatTop+36);
    const max=Math.max(0,...Object.values(counts).map(num)), keyY=heatTop+55, gap=Math.max(2.5,geo.gap*geo.unit);
    rounded(ctx,27,keyY-5,666,geo.renderedHeight+12,10,'#283944');
    for(const key of geo.keys) {
      const count=key.code==null?0:num(counts[String(key.code)]), heat=keyHeat(count,max);
      const x=32+key.x*geo.unit+gap/2,y=keyY+key.y*geo.unit+gap/2,kw=key.w*geo.unit-gap,kh=key.h*geo.unit-gap;
      // Match the live keycaps: a narrow rim, a lower sidewall, and light from above.
      const modifier=[54,55,56,57,58,59,60,61,62,1349,123,124,125,126,1311,1327,1329,1335,1337,1338,1339,1070,1581,122,120,99,118,96,97,98,100,101,109,103,111].includes(key.code);
      const accent=[53,36,1284].includes(key.code);
      const face=key.unavailable?'#52616b':heat?.fill||(accent?'#a5d4d8':modifier?'#d2dfe3':'#eef3ef');
      rounded(ctx,x,y+1,kw,kh,4,'#1e2e3855');
      rounded(ctx,x,y,kw,kh,4,face);
      rounded(ctx,x,y,kw,kh,4,'#18334238');
      rounded(ctx,x+.6,y+.4,Math.max(1,kw-1.2),Math.max(1,kh-2.2),3.4,face);
      rounded(ctx,x+1.5,y+.4,Math.max(1,kw-3),.7,.35,'#ffffff55');
      text(ctx,keyboardLabel(key),x+kw/2,y+kh/2+3,Math.min(13,kh*.40),key.unavailable?'#e5eef4':heat?.ink||palette.ink,'500','center',Math.max(1,kw-4));
    }
    const ranked=geo.keys.filter(k=>k.code!=null&&num(counts[String(k.code)])>0).map(k=>({key:k,count:num(counts[String(k.code)])})).sort((a,b)=>b.count-a.count||a.key.code-b.key.code).slice(0,5);
    const rankY=keyY+geo.renderedHeight+20;
    if(!ranked.length) text(ctx,w.noKeys,34,rankY+7,19,palette.muted);
    else {
      ctx.fillStyle=palette.border;ctx.fillRect(32,rankY-4,656,1);
      const width=656/ranked.length;
      ranked.forEach((item,i)=>{const cx=32+width*(i+.5);rounded(ctx,cx-36,rankY+7,72,28,5,'#f1f3f8');text(ctx,rankedKeyLabel(item.key,lang,String(layout.id||'').startsWith('windows')),cx,rankY+27,17,palette.ink,'400','center',68);text(ctx,cellCountLabel(item.count,lang),cx,rankY+59,16,palette.muted,'400','center',width-5);text(ctx,`${lang==='en'?'Share':'占'} ${keyUsagePercent(item.count,stats.key_count,lang)}`,cx,rankY+80,17,palette.blue,'500','center',width-5)});
    }
    rounded(ctx,18,timelineTop,684,timelineHeight,16,palette.white);heading(ctx,w.timeline,w.timelineHint,timelineTop+36);
    ['00:00','06:00','12:00','18:00','24:00'].forEach((label,i)=>text(ctx,label,32+656*i/4,timelineTop+60,15,palette.muted,'400',i===0?'left':i===4?'right':'center'));
    if (!days.length) text(ctx,w.noTimeline,34,timelineTop+99,19,palette.muted);
    else days.forEach((day,index)=>{
      const dy=timelineTop+80+index*(days.length===1?68:55);
      const label=String(day.date||'').slice(5).replace('-','/');
      text(ctx,label,32,dy+13,17,palette.ink); const count=cellCountLabel(num(day.key_count),lang);
      text(ctx,`${duration(day.active_ms??0,lang)} · ${count} · ${formatKeystrokeRate(day,lang)}`,688,dy+13,15,palette.muted,'400','right',560);
      const buckets=Array.isArray(day.buckets)?day.buckets:[];
      if (buckets.length) { const pitch=656/buckets.length, bh=days.length===1?29:18;
        buckets.forEach((value,idx)=>{const active=typeof value==='object'?num(value.active_ms):num(value);const ratio=Math.max(0,Math.min(1,active/900000));rounded(ctx,32+idx*pitch,dy+20,Math.max(.5,pitch-1.5),bh,2,ratio?`rgba(41,94,212,${(.2+.8*ratio).toFixed(3)})`:'rgba(41,94,212,.055)')}); }
    });
    rounded(ctx,18,appsTop,684,appHeight,16,palette.white);heading(ctx,w.apps,w.appsHint,appsTop+36);
    if (!apps.length) text(ctx,w.noApps,34,appsTop+66,19,palette.muted);
    else apps.forEach((app,index)=>{
      const col=index%2,row=Math.floor(index/2),x=32+col*328,y=appsTop+55+row*76;
      rounded(ctx,x,y,38,38,7,'#f0f2f7');const icon=appIcons[app.id];if(icon)ctx.drawImage(icon,x+3,y+3,32,32);else text(ctx,'▣',x+19,y+26,20,palette.muted,'400','center');
      text(ctx,app.name||app.id||w.unavailable,x+48,y+16,19,palette.ink,'400','left',260);
      text(ctx,duration(app.active_ms??0,lang),x+48,y+39,18,palette.ink,'400','left',260);
      text(ctx,cellCountLabel(num(app.key_count),lang),x+48,y+60,16,palette.muted,'400','left',260);
    });
    text(ctx,w.rateNote,20,height-64,15,palette.muted,'400','left',680);
    text(ctx,w.local,20,height-42,15,palette.muted);text(ctx,w.tagline,700,height-42,16,palette.muted,'400','right');
    text(ctx,'github.com/KMnO4-zx/Toccata',20,height-14,17,palette.blue);
    return canvas;
  }
  root.ToccataShareCard=Object.freeze({render,keyboardGeometry,keyHeat,keystrokeRate,formatKeystrokeRate,keyUsagePercent});
})(window);
