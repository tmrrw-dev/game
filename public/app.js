const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#101114'); tg.setBackgroundColor('#101114'); } catch (_) {}
}
let state = null, busy = false;
const headers = () => ({'Content-Type':'application/json','X-Telegram-Init-Data':tg?.initData||''});
async function api(path, method='GET', body) {
  let response;
  try { response = await fetch(path,{method,headers:headers(),body:body?JSON.stringify(body):undefined}); }
  catch (_) { throw new Error('Нет соединения с сервером. Запусти игру через start.bat, не открывай index.html напрямую.'); }
  if (!(response.headers.get('content-type')||'').includes('application/json'))
    throw new Error('Игра открыта без сервера. Запусти start.bat и открой http://localhost:3000.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error||'Ошибка запроса');
  return data;
}
function fmt(n){return Math.floor(n||0).toLocaleString('en-US')}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)}
function render(){if(!state)return;
 $('sat').textContent=fmt(state.sat);$('gram').textContent=Number(state.gram||0).toFixed(2);
 $('rate').textContent=fmt(state.rate);$('perClick').textContent=fmt(state.clickPower);$('clicks').textContent=fmt(state.totalClicks);
 $('ownedCount').textContent=(state.gpu+state.asic)+' устройств';$('gpuCost').textContent=fmt(state.costs.gpu);
 $('asicCost').textContent=fmt(state.costs.asic);$('boostCost').textContent=fmt(state.costs.boost);
 $('buyGpu').disabled=state.sat<state.costs.gpu;$('buyAsic').disabled=state.sat<state.costs.asic;$('buyBoost').disabled=state.sat<state.costs.boost;
}
async function refresh(showOffline=false){try{state=await api('/api/session');render();if(showOffline&&state.offlineEarned>0)toast('ПОКА ВАС НЕ БЫЛО: +'+fmt(state.offlineEarned)+' SAT')}catch(e){toast(e.message)}}
async function mine(event){if(busy)return;busy=true;const button=$('mineButton');button.classList.add('is-pressed');
 try{const data=await api('/api/mine','POST',{});state=data;render();const el=document.createElement('div');el.className='float';el.textContent='+'+data.gain+' SAT';const rect=button.getBoundingClientRect();el.style.left=((event?.clientX)||(rect.left+rect.width/2))+'px';el.style.top=((event?.clientY)||(rect.top+rect.height/2))+'px';document.body.appendChild(el);setTimeout(()=>el.remove(),800)}
 catch(err){toast(err.message)}finally{busy=false;button.classList.remove('is-pressed')}}
async function buy(type){try{state=await api('/api/buy','POST',{type});render();toast('ОБОРУДОВАНИЕ КУПЛЕНО')}catch(e){toast(e.message);await refresh()}}
$('mineButton').addEventListener('click',mine);
$('buyGpu').addEventListener('click',()=>buy('gpu'));$('buyAsic').addEventListener('click',()=>buy('asic'));$('buyBoost').addEventListener('click',()=>buy('boost'));
$('navShop').addEventListener('click',()=>$('buyGpu').scrollIntoView({behavior:'smooth'}));$('navPool').addEventListener('click',()=>toast('МАЙНИНГ-ПУЛ — СЛЕДУЮЩИЙ ЭТАП'));
$('navRank').addEventListener('click',async()=>{try{const rows=await api('/api/leaderboard');toast(rows.length+' МАЙНЕРОВ В РЕЙТИНГЕ')}catch(e){toast(e.message)}});
refresh(true);setInterval(()=>refresh(false),5000);
