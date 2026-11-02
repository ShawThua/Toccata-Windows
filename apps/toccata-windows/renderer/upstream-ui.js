/* Windows adaptation of the upstream themed segmented controls. This module
 * owns presentation and keyboard navigation only; task state stays in app.js. */
(function(root){
  'use strict';
  const memories=new Map(),intents=new Map(),animations=new WeakMap();
  const handled=new WeakSet(),observedElements=new Set();let observer,sizeObserver,scheduled=false;
  const reduceMotion=()=>typeof root.matchMedia==='function'&&root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buttons=group=>Array.from(group.children).filter(node=>node.tagName==='BUTTON'&&!node.disabled);
  function identity(group,items){return group.dataset.segmentId||`${items[0]?.dataset.action||'segment'}:${items.map(x=>x.dataset.value||x.textContent.trim()).join('|')}`;}
  function labelFor(group,items){
    const en=document.documentElement.lang==='en',action=items[0]?.dataset.action;
    const labels={'task-period':['任务范围','Task period'],'review-range':['回顾范围','Review range'],'activity-range':['键盘活动时段','Keyboard activity period'],'timeline-range':['时间线时段','Timeline period'],'ranking-range':['应用活动时段','Application activity period'],'calendar-kind':['日历记录类型','Calendar records'],'display-mode':['任务显示方式','Task display'],'tray-activity-tab':['活动速览内容','Activity overview content'],'tray-activity-range':['活动速览日期','Activity overview date']};
    return labels[action]?.[en?1:0]||(en?'View selection':'视图选择');
  }
  function enhance(group){
    const items=buttons(group);if(!items.length)return;
    observeSize(group);for(const item of items)observeSize(item);
    const selected=items.find(x=>x.classList.contains('active'))||items[0],key=identity(group,items);
    const selectedValue=selected.dataset.value||selected.textContent.trim(),previous=memories.get(key);
    if(!group.classList.contains('upstream-segments'))group.classList.add('upstream-segments');
    group.setAttribute('role','radiogroup');
    if(!group.hasAttribute('aria-label'))group.setAttribute('aria-label',labelFor(group,items));
    for(const item of items){item.setAttribute('role','radio');item.setAttribute('aria-checked',String(item===selected));item.tabIndex=item===selected?0:-1;}
    let indicator=group.querySelector(':scope > .segment-indicator');
    if(!indicator){indicator=document.createElement('span');indicator.className='segment-indicator';indicator.setAttribute('aria-hidden','true');group.prepend(indicator);}
    const bounds=group.getBoundingClientRect(),activeBounds=selected.getBoundingClientRect();
    if(activeBounds.width<=0||bounds.width<=0)return;
    // Absolute positions relative to the padding box keep the light rail aligned
    // when text widths change with language, scaling, or a narrow window.
    const left=activeBounds.left-bounds.left-group.clientLeft,width=activeBounds.width;
    if(previous&&previous.value===selectedValue&&(Math.abs(previous.left-left)>.1||Math.abs(previous.width-width)>.1))animations.get(group)?.cancel();
    indicator.style.width=`${width}px`;indicator.style.transform=`translateX(${left}px)`;
    const intent=intents.get(key),changed=previous&&previous.value!==selectedValue;
    if(changed&&intent&&!reduceMotion()&&document.visibilityState==='visible'){
      const oldButton=items.find(x=>(x.dataset.value||x.textContent.trim())===previous.value);
      const oldBounds=oldButton?.getBoundingClientRect();
      const fromLeft=oldBounds?oldBounds.left-bounds.left-group.clientLeft:previous.left;
      const fromWidth=oldBounds?.width||previous.width;
      if(typeof indicator.animate==='function'){
        animations.get(group)?.cancel();
        animations.set(group,indicator.animate([{transform:`translateX(${fromLeft}px)`,width:`${fromWidth}px`},{transform:`translateX(${left}px)`,width:`${width}px`}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'}));
      }
    }
    memories.set(key,{value:selectedValue,left,width});
    if(intent&&changed){
      intents.delete(key);
      const active=document.activeElement;
      if(intent.keyboard&&(!active||active===document.body||active.closest?.('.segments')))selected.focus({preventScroll:true});
    }
    if(handled.has(group))return;handled.add(group);
    group.addEventListener('click',event=>{
      const item=event.target.closest('button');if(!item||item.parentElement!==group||item.disabled)return;
      const items=buttons(group),key=identity(group,items);
      // Keep intent until the owner's asynchronous selection is actually applied.
      const existing=intents.get(key);intents.set(key,{keyboard:existing?.keyboard===true&&existing.button===item,button:item});
    },true);
    group.addEventListener('keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      const items=buttons(group),current=event.target.closest('button');if(!items.includes(current))return;
      event.preventDefault();event.stopPropagation();
      const backwards=event.key==='ArrowLeft'||event.key==='ArrowUp',index=items.indexOf(current);
      const target=event.key==='Home'?items[0]:event.key==='End'?items[items.length-1]:items[(index+(backwards?-1:1)+items.length)%items.length];
      intents.set(identity(group,items),{keyboard:true,button:target});target.click();
      if(target.isConnected)target.focus({preventScroll:true});
    });
  }
  function init(scope=document){
    for(const element of observedElements)if(!element.isConnected){sizeObserver?.unobserve(element);observedElements.delete(element);}
    if(scope.matches?.('.segments'))enhance(scope);
    for(const group of scope.querySelectorAll?.('.segments')||[])enhance(group);
  }
  function observeSize(element){
    if(typeof root.ResizeObserver!=='function')return;
    if(!sizeObserver)sizeObserver=new root.ResizeObserver(schedule);
    if(!observedElements.has(element)){observedElements.add(element);sizeObserver.observe(element);}
  }
  function schedule(){if(scheduled)return;scheduled=true;const refresh=()=>{scheduled=false;init();};if(root.requestAnimationFrame)root.requestAnimationFrame(refresh);else root.setTimeout(refresh,0);}
  function transitionContent(target){
    if(!target||reduceMotion()||typeof target.animate!=='function')return null;
    const active=document.activeElement;
    if(active&&target.contains(active)&&active.matches('input,textarea,select,iframe,[contenteditable="true"]'))return null;
    animations.get(target)?.cancel();
    const animation=target.animate([{opacity:.55,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});
    animations.set(target,animation);return animation;
  }
  function start(){
    init();
    if(observer||typeof MutationObserver!=='function')return;
    observer=new MutationObserver(records=>{
      const relevant=records.some(record=>record.type==='attributes'?record.target.matches?.('.segments > button'):
        record.target.closest?.('.segments')||Array.from(record.addedNodes).some(node=>node.nodeType===1&&(node.matches?.('.segments')||node.querySelector?.('.segments')))||Array.from(record.removedNodes).some(node=>node.nodeType===1&&(node.matches?.('.segments')||node.querySelector?.('.segments'))));
      if(relevant)schedule();
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    root.addEventListener('resize',schedule);
    if(document.fonts?.ready)document.fonts.ready.then(schedule).catch(()=>{});
  }
  root.ToccataUpstreamUI=Object.freeze({init,transitionContent});
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  }
})(window);
