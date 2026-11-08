/* Windows presentation for upstream v0.1.2 preferences and tray overview.
 * Rendering only: settings, notification permission and persistence stay in the host. */
(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
  const intervals=[4096,8192,16384,32768];
  const paths={
    palette:'M12 3a9 9 0 1 0 0 18h1.4a2.6 2.6 0 0 0 2-4.2c-.5-.7 0-1.8.9-1.8h1.1A3.6 3.6 0 0 0 21 11.4 8.7 8.7 0 0 0 12 3ZM7.2 11h.1M9 7h.1M14 6.4h.1M17.4 9h.1',
    tray:'M4 5.5h16v13H4zM4 14h5l1.5 2h3l1.5-2h5M8 9h8',
    power:'M12 3v8M7 5.7a8 8 0 1 0 10 0',
    water:'M12 2.8S5.5 10 5.5 14.4a6.5 6.5 0 0 0 13 0C18.5 10 12 2.8 12 2.8ZM9 15a3 3 0 0 0 3 3',
    info:'M12 10.5v6M12 7.1v.2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    chevron:'m9 6 6 6-6 6',
    tasks:'M8 6h12M8 12h12M8 18h12M3 5l1 1 2-2M3 11l1 1 2-2M3 17l1 1 2-2',
    calendar:'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h2M14 13h2M8 17h2',
    activity:'M3 12h4l3-7 4 14 3-7h4',
    keyboard:'M3 6h18v12H3zM6 9h.1M9 9h.1M12 9h.1M15 9h.1M18 9h.1M6 12h.1M9 12h.1M12 12h.1M15 12h.1M18 12h.1M8 15h8',
    apps:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  };
  function icon(name){return `<svg class="wf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.info}"></path></svg>`;}
  function copy(language){const en=language==='en';return {en,t:(zh,english)=>en?english:zh,format:value=>number(value).toLocaleString(en?'en-US':'zh-CN')};}
  function duration(value,language){const seconds=Math.floor(number(value)/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return language==='en'?`${h?h+'h ':''}${m?m+'m ':''}${!h&&!m?s+'s':''}`.trim():`${h?h+'小时 ':''}${m?m+'分 ':''}${!h&&!m?s+'秒':''}`.trim();}
  function options(values,current){return values.map(([value,title])=>`<option value="${escape(value)}" ${value===current?'selected':''}>${escape(title)}</option>`).join('');}
  function select(id,label,values,current){return `<select id="${id}" class="wf-select" aria-label="${escape(label)}">${options(values,current)}</select>`;}
  function toggle(id,label,checked){return `<label class="wf-switch"><input id="${id}" type="checkbox" ${checked?'checked':''} aria-label="${escape(label)}"><span aria-hidden="true"></span></label>`;}
  function row(title,description,control,classes=''){return `<div class="wf-setting-row ${classes}"><div class="wf-row-copy"><span class="wf-row-title">${escape(title)}</span>${description?`<p>${escape(description)}</p>`:''}</div><div class="wf-row-control">${control}</div></div>`;}
  function card(name,title,kicker,content){return `<section class="wf-setting-card"><header><span class="wf-card-symbol wf-symbol-${name}">${icon(name)}</span><div><h2>${escape(title)}</h2><p>${escape(kicker)}</p></div></header><div class="wf-card-rows">${content}</div></section>`;}
  function renderSettings({settings={},language='zh',hydration={},version,upstreamVersion}={}){
    settings=settings&&typeof settings==='object'?settings:{};hydration=hydration&&typeof hydration==='object'?hydration:{};
    const {t,format}=copy(language),enabled=!!settings.hydrationEnabled,interval=intervals.includes(settings.hydrationInterval)?settings.hydrationInterval:8192;
    const notificationStatus=hydration.error?t('暂时无法发送通知，请检查系统通知设置。','Notifications are unavailable. Check Windows notification settings.'):hydration.supported===false?t('此环境暂不支持系统通知。','System notifications are unavailable in this environment.'):enabled?t('已开启；Windows 通知设置和专注模式会影响提醒显示。','Enabled. Windows notification settings and Focus may affect delivery.'):t('开启后，按照今天的累计按键次数提醒你喝水。','Turn on reminders based on today’s accumulated key presses.');
    const remaining=number(hydration.nextAt)-number(hydration.count);
    const progress=enabled&&Number.isFinite(hydration.count)&&Number.isFinite(hydration.nextAt)?`<div class="wf-reminder-progress"><span>${t('今日累计','Today')} <strong>${format(hydration.count)}</strong> ${t('次按键','presses')}</span><span>${t('距下次提醒','Next reminder in')} <strong>${format(Math.max(0,remaining))}</strong> ${t('次','presses')}</span></div>`:'';
    return `<div class="content wf-settings"><div class="wf-settings-inner"><header class="wf-settings-heading"><div><span class="wf-eyebrow">TOCCATA · WINDOWS</span><h1>${t('通用配置','General settings')}</h1><p>${t('让工作台更贴合你的节奏。','Make the workspace fit your rhythm.')}</p></div><span class="wf-version-pill">${escape(version||settings.version||'Windows Preview')}</span></header><div class="wf-settings-grid">`+
      card('palette',t('外观与语言','Appearance & language'),t('熟悉的界面，舒服的阅读。','A familiar interface, comfortable to read.'),
        row(t('外观','Appearance'),'',select('feature-theme',t('外观','Appearance'),[['system',t('跟随系统','Follow system')],['light',t('浅色','Light')],['dark',t('深色','Dark')]],settings.theme||'system'))+
        row(t('界面语言','Interface language'),'',select('feature-language',t('界面语言','Interface language'),[['zh','简体中文'],['en','English']],language)))+
      card('tray',t('系统托盘','System tray'),t('从屏幕右下角，快速回到正在做的事。','A quick way back from the Windows system tray.'),
        row(t('默认打开页面','Default page'),t('每次点击托盘图标时使用。','Used each time you open the tray panel.'),select('feature-tray-default',t('默认打开页面','Default page'),[['tasks',t('任务管理','Tasks')],['calendar',t('任务日历','Task calendar')],['activity',t('活动速览','Activity overview')]],settings.trayDefaultPage||'tasks')))+
      card('power',t('启动与后台运行','Startup & background'),t('选择启动方式，保留顺手的入口。','Choose how Toccata starts and stays within reach.'),
        row(t('登录时启动','Launch at login'),t('登录 Windows 后自动启动。','Start Toccata when you sign in to Windows.'),toggle('feature-login',t('登录时启动','Launch at login'),!!settings.launchAtLogin))+
        row(t('登录时打开','At sign-in, open'),t('仅影响开机自启；手动双击始终打开主窗口。','Only affects startup at sign-in. A manual launch always opens the main window.'),select('feature-launch-mode',t('登录时打开','At sign-in, open'),[['panel',t('小面板','Tray panel')],['silent',t('静默（仅托盘）','Silent (tray only)')],['window',t('主窗口','Main window')]],['panel','silent','window'].includes(settings.launchMode)?settings.launchMode:'panel'))+
        row(t('隐藏任务栏图标','Hide taskbar icon'),t('隐藏后仍可从系统托盘打开工作台。','You can still open the workspace from the system tray.'),toggle('feature-hide-taskbar',t('隐藏任务栏图标','Hide taskbar icon'),!!settings.hideTaskbar))+
        `<p class="wf-setting-note">${t('关闭窗口后继续在后台运行；从托盘选择“退出 Toccata”可结束运行。','Closing the workspace keeps Toccata running. Choose Exit Toccata from the tray to stop it.')}</p>`)+
      card('water',t('喝水提醒','Water reminders'),t('投入一阵，也给自己一个小休息。','A small break after a stretch of focused work.'),
        row(t('开启喝水提醒','Enable water reminders'),notificationStatus,toggle('feature-hydration-enabled',t('开启喝水提醒','Enable water reminders'),enabled))+
        row(t('提醒间隔','Reminder interval'),t('开启或更改间隔后，从下一个提醒点开始。','Enabling or changing the interval starts at the next milestone.'),select('feature-hydration-interval',t('提醒间隔','Reminder interval'),intervals.map(n=>[String(n),t(`每 ${format(n)} 次按键`,`Every ${format(n)} presses`)]),String(interval)))+
        progress+`<div class="wf-setting-actions"><button class="wf-action-button" data-action="test-notification" ${!enabled||hydration.supported===false?'disabled':''}>${icon('water')}${t('发送测试通知','Send test notification')}</button><button class="wf-text-button" data-action="notification-settings">${t('Windows 通知设置','Windows notification settings')}${icon('chevron')}</button></div>${hydration.error?`<p class="wf-setting-error" role="status">${escape(hydration.error)}</p>`:''}`)+
      `<section class="wf-setting-card wf-about-card"><button class="wf-about-link" data-action="about"><span class="wf-card-symbol wf-symbol-info">${icon('info')}</span><span class="wf-row-copy"><span class="wf-row-title">${t('关于 Toccata','About Toccata')}</span><small>${t('版本信息与检查更新','Version information & updates')}${upstreamVersion||settings.upstreamVersion?` · ${t('上游','Upstream')} ${escape(upstreamVersion||settings.upstreamVersion)}`:''}</small></span>${icon('chevron')}</button></section>`+
      `</div><p class="wf-settings-footnote">${t('更改会自动保存到这台电脑。','Changes are saved automatically on this device.')}</p></div></div>`;
  }
  function renderTrayNav(page='tasks',language='zh'){
    const {t}=copy(language);
    return `<nav class="wf-tray-nav" aria-label="${t('托盘页面','Tray pages')}">${[['tasks','tasks',t('任务','Tasks')],['calendar','calendar',t('日历','Calendar')],['activity','activity',t('活动','Activity')]].map(([value,symbol,title])=>`<button type="button" data-action="tray-page" data-value="${value}" class="${page===value?'active':''}" aria-pressed="${page===value}">${icon(symbol)}<span>${title}</span></button>`).join('')}</nav>`;
  }
  function usage(count,total,language){if(typeof root.ToccataShareCard?.keyUsagePercent==='function')return root.ToccataShareCard.keyUsagePercent(count,total,language);const n=total>0?Math.max(0,Math.min(100,number(count)/number(total)*100)):0;return `${Number(n.toFixed(1)).toLocaleString(language==='en'?'en-US':'zh-CN')}%`;}
  function geometry(layout){
    try{if(root.ToccataShareCard?.keyboardGeometry)return root.ToccataShareCard.keyboardGeometry(layout);if(layout&&Array.isArray(layout.keys)&&layout.keys.length){const keys=layout.keys.filter(k=>[k.x,k.y,k.w,k.h].every(Number.isFinite)&&k.w>0&&k.h>0&&k.x>=0&&k.y>=0);return {keys,width:Math.max(...keys.map(k=>k.x+k.w)),height:Math.max(...keys.map(k=>k.y+k.h))};}}catch{}
    return null;
  }
  function safeIcon(value){return typeof value==='string'&&value.length<=2097152&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)?value:null;}
  function appIcon(app){const source=safeIcon(app.icon_data_url);return `<span class="app-icon wf-app-icon"><span class="app-icon-fallback">${icon('apps')}</span>${source?`<img class="app-image" src="${escape(source)}" alt="">`:''}</span>`;}
  function keyCaption(label){const short={'Backspace':'⌫','Caps Lock':'Caps','CapsLock':'Caps','Enter':'↵','Shift':'⇧','Space':'','Win':'⊞','Menu':'≡','Print Screen':'Prt','PrtSc':'Prt','Scroll Lock':'Scr','Scroll':'Scr','Delete':'Del','Insert':'Ins'};return short[label]??label;}
  function trayKeyboard(stats,layout,language){
    const {t,format}=copy(language),g=geometry(layout),counts=stats.keys||{},max=Math.max(0,...Object.values(counts).map(number));
    if(!g||!Number.isFinite(g.width)||!Number.isFinite(g.height)||g.width<=0||g.height<=0)return `<div class="wf-tray-empty">${icon('keyboard')}<p>${t('键盘布局暂不可用','Keyboard layout is unavailable')}</p></div>`;
    return `<div class="wf-mini-keyboard" style="aspect-ratio:${g.width}/${g.height}" role="group" aria-label="${t('键盘热力图','Keyboard heatmap')}">${g.keys.map(key=>{
      const count=number(counts[String(key.code)]),percent=usage(count,stats.key_count,language),label=String(key.label||''),unavailable=key.unavailable||key.code==null;
      const heat=count&&max?(root.ToccataShareCard?.keyHeat?.(count,max)||{fill:`hsl(204 64% ${88-40*count/max}%)`,ink:'#143c5c'}):null;
      const title=unavailable?t(`${label} · 暂不支持采集`,`${label} · Capture unavailable`):t(`${label||'Space'} · ${format(count)} 次 · ${percent}`,`${label||'Space'} · ${format(count)} presses · ${percent}`);
      const style=`left:${key.x/g.width*100}%;top:${key.y/g.height*100}%;width:${key.w/g.width*100}%;height:${key.h/g.height*100}%;${heat?`--wf-key-fill:${heat.fill};--wf-key-ink:${heat.ink};`:''}`;
      return `<span class="wf-mini-key ${heat?'hot':''} ${unavailable?'unavailable':''}" style="${style}" title="${escape(title)}" aria-label="${escape(title)}" data-tray-key="${escape(key.code??'unavailable')}"><span>${escape(keyCaption(label))}</span></span>`;
    }).join('')}</div>`;
  }
  function timeline(stats,language){
    const {t}=copy(language),day=stats.days?.[0],buckets=Array.isArray(day?.buckets)?day.buckets:[];
    const total=buckets.length||96;
    const start=day?.date&&/^\d{4}-\d{2}-\d{2}$/.test(day.date)?new Date(day.date+'T00:00:00').getTime():null;
    const bars=Array.from({length:total},(_,index)=>{
      const value=number(buckets[index]);let label=`${String(Math.floor(index/4)).padStart(2,'0')}:${String(index%4*15).padStart(2,'0')}`;
      if(start!==null){const date=new Date(start+index*900000);label=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}
      const title=`${label} · ${duration(value,language)}`;
      return `<span class="wf-tray-bucket ${value?'active':''}" style="--wf-bucket-opacity:${Math.min(1,.2+.8*value/900000)}" title="${escape(title)}" aria-label="${escape(title)}"></span>`;
    }).join('');
    return `<section class="wf-tray-timeline"><div class="wf-mini-heading"><strong>${t('活跃时段','Activity timeline')}</strong><span>${t('每格 15 分钟','15 min per cell')}</span></div><div class="wf-tray-buckets" role="img" aria-label="${t('每日活跃时段','Daily activity timeline')}">${bars}</div><div class="wf-tray-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></section>`;
  }
  function renderTrayActivity({stats={},layout,language='zh',range='today',tab='keyboard'}={}){
    stats=stats&&typeof stats==='object'?stats:{};
    const {t,format}=copy(language),apps=Array.isArray(stats.apps)?stats.apps:[],counts=stats.keys||{};
    const labels=new Map((geometry(layout)?.keys||[]).map(key=>[String(key.code),key.label||'Space'])),top=Object.entries(counts).filter(([code,count])=>labels.has(code)&&number(count)>0).sort((a,b)=>number(b[1])-number(a[1])).slice(0,5);
    const topHtml=top.map(([code,count])=>`<span title="${escape(t(`${labels.get(code)||code} · ${format(count)} 次按键`,`${labels.get(code)||code} · ${format(count)} presses`))}"><b>${escape(labels.get(code)||code)}</b><small>${escape(usage(count,stats.key_count,language))}</small></span>`).join('');
    return `<section class="wf-tray-activity" aria-label="${t('活动速览','Activity overview')}"><header class="wf-tray-activity-header"><div><span class="wf-eyebrow">${t('轻松看见投入','YOUR DAY AT A GLANCE')}</span><h2>${t('活动速览','Activity overview')}</h2></div><div class="wf-tray-range" aria-label="${t('日期范围','Date range')}">${[['today',t('今日','Today')],['yesterday',t('昨日','Yesterday')]].map(([value,label])=>`<button data-action="tray-activity-range" data-value="${value}" class="${range===value?'active':''}" aria-pressed="${range===value}">${label}</button>`).join('')}</div></header><div class="wf-tray-metrics"><div><span>${icon('clock')}${t('键盘活跃','Active time')}</span><strong>${escape(duration(stats.active_ms,language))}</strong></div><div><span>${icon('keyboard')}${t('按键次数','Key presses')}</span><strong>${format(stats.key_count)}</strong></div></div><div class="wf-tray-tabs" aria-label="${t('活动类型','Activity type')}">${[['keyboard',t('键盘','Keyboard')],['apps',t('应用','Apps')]].map(([value,label])=>`<button data-action="tray-activity-tab" data-value="${value}" class="${tab===value?'active':''}" aria-pressed="${tab===value}">${icon(value)}${label}</button>`).join('')}</div>`+
      (tab==='apps'?`<div class="wf-tray-apps" role="list" aria-label="${t('应用活跃度','App activity')}">${apps.length?apps.map((app,index)=>`<div class="wf-tray-app" role="listitem"><span class="wf-app-rank">${index+1}</span>${appIcon(app)}<div class="wf-app-copy"><strong title="${escape(app.name||app.id||t('未知应用','Unknown app'))}">${escape(app.name||app.id||t('未知应用','Unknown app'))}</strong><small>${format(app.key_count)} ${t('次按键','presses')}</small></div><span class="wf-app-time">${escape(duration(app.active_ms,language))}</span></div>`).join(''):`<div class="wf-tray-empty">${icon('apps')}<p>${t('这一天还没有应用活动','No app activity for this day')}</p></div>`}</div>`:
      `<div class="wf-tray-keyboard-panel"><section class="wf-tray-keyboard-card"><div class="wf-mini-heading"><strong>${t('键盘足迹','Keyboard footprint')}</strong><span>${t('悬停查看次数与占比','Hover for count & share')}</span></div>${trayKeyboard(stats,layout,language)}<div class="wf-heat-legend"><span>${t('较少','Less')}</span><i></i><span>${t('较多','More')}</span></div></section>${timeline(stats,language)}<section class="wf-tray-topkeys"><div class="wf-mini-heading"><strong>${t('常用按键','Most-used keys')}</strong><span>${t('使用占比','Usage share')}</span></div><div>${topHtml||`<p class="wf-mini-empty">${t('开始使用键盘后，这里会留下足迹。','Your key activity will appear here.')}</p>`}</div></section></div>`)+
      `<p class="wf-tray-local">${t('本机记录 · 活跃时长为估算','Stored on this device · activity time is an estimate')}</p></section>`;
  }
  root.ToccataWindowsFeatures=Object.freeze({renderSettings,renderTrayActivity,renderTrayNav});
})(typeof window==='undefined'?globalThis:window);
