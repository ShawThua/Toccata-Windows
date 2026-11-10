/* Update presentation only. The main process owns release and install state. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function available(update){return update?.checkStatus==='update-available'&&update.canDownload===true;}
 function checkMessage(update,language){
  const en=language==='en', u=update||{};
  switch(u.checkStatus){
   case 'checking':return en?'Checking for Windows updates…':'正在检查 Windows 更新…';
   case 'up-to-date':return en?'This version is at least as recent as published Windows builds.':'当前版本不低于已发布的 Windows 版本。';
   case 'update-available':return (en?'New Windows version: ':'发现 Windows 新版本：')+(u.availableVersion||'')+(u.canDownload?'':(en?' (no verified package available)':'（暂无可校验的安装包）'));
   case 'no-windows-asset':return en?'This release has no compatible Windows package.':'此发布尚无兼容的 Windows 安装包。';
   case 'error':return (en?'Check failed: ':'检查失败：')+(u.checkReason||'');
   default:return '';
  }
 }
 function renderStatus(update,language){
  const u=update||{},en=language==='en';
  const phase={idle:en?'Updates use the Windows channel.':'更新使用 Windows 发布渠道。',downloading:en?'Downloading…':'正在下载…',verifying:en?'Verifying SHA256 and Windows package…':'正在校验 SHA256 和 Windows 安装包…',ready:en?'Verified and ready to install.':'校验完成，可以安装。',cancelled:en?'Download cancelled.':'已取消下载。',installing:en?'Saving and restarting…':'正在保存并重启…',error:(en?'Update failed: ':'更新失败：')+(u.error||'')};
  const message=checkMessage(u,language), progress=['downloading','verifying'].includes(u.phase);
  const percent=Math.max(0,Math.min(100,Number(u.percent)||0));
  return `<div class="update-status" role="status"><p>${escape(phase[u.phase]||'')}</p>${message?'<p>'+escape(message)+'</p>':''}${progress?'<progress max="100" value="'+percent+'"></progress><small>'+percent+'%</small>':''}<div class="update-buttons">${u.canDownload&&['idle','error','cancelled'].includes(u.phase)?'<button class="blue-btn" data-action="download-update">'+(en?'Download & verify':'下载并校验')+'</button>':''}${progress?'<button class="small-button" data-action="cancel-update">'+(en?'Cancel':'取消下载')+'</button>':''}${u.phase==='ready'?'<button class="blue-btn" data-action="install-update" '+(u.packaged?'':'disabled')+'>'+(en?'Install & restart':'安装并重启')+'</button>':''}${u.release_url?'<a href="'+escape(u.release_url)+'">'+(en?'Release notes ↗':'发布说明 ↗')+'</a>':''}</div></div>`;
 }
 function syncBeacon(doc,update,language){
  const button=doc?.querySelector?.('#about');if(!button)return;
  let beacon=button.querySelector('.update-beacon');
  if(available(update)){
   if(!beacon){beacon=doc.createElement('span');beacon.className='update-beacon';beacon.setAttribute('aria-hidden','true');button.appendChild(beacon);}
   const label=(language==='en'?'New Windows version available: ':'发现 Windows 新版本：')+(update.availableVersion||'');
   button.setAttribute('title',label);button.setAttribute('aria-label',label);
  }else{beacon?.remove();button.removeAttribute('title');button.removeAttribute('aria-label');}
 }
 const api={available,checkMessage,renderStatus,syncBeacon};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ToccataUpdateUI=api;
})(typeof window==='undefined'?globalThis:window);
