// js/app.js
// Firebase 初期化
const firebaseConfig = {
  apiKey: "AIzaSyAYvHj-SSZn23aufSmJoibhVoN4S3Nvym0",
  authDomain: "acchan-77bca.firebaseapp.com",
  databaseURL: "https://acchan-77bca-default-rtdb.asia-southeast1.firebaseapp.com",
  projectId: "acchan-77bca",
  storageBucket: "acchan-77bca.appspot.com",
  messagingSenderId: "958930816155",
  appId: "1:958930816155:web:daee73c617e23283caca3e"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.database();

let deviceId = '', currentUser = null, isAdmin = false;
let currentThreadId = '', deletionTimerId = null;

// 短縮: getElementById
function q(id){ return document.getElementById(id); }

// 初期化
function initializeApp(){
  // デバイスID生成/取得
  let id = localStorage.getItem('acchan_device_id');
  if(!id){
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    id=''; for(let i=0;i<8;i++) id+=chars.charAt(Math.floor(Math.random()*chars.length));
    localStorage.setItem('acchan_device_id',id);
  }
  deviceId = id;

  // 認証リスナ登録
  auth.onAuthStateChanged(user=>{
    currentUser = user;
    renderAuthUI();
    loadThreadList();
    if(currentThreadId) loadPosts();
  });

  // イベントリスナ登録
  document.addEventListener('DOMContentLoaded',()=>{
    const cf = q('createThreadForm');
    if(cf) cf.addEventListener('submit',e=>{ e.preventDefault(); createThread(); });

    const pf = q('postForm');
    if(pf) pf.addEventListener('submit',e=>{ e.preventDefault(); submitPost(); });
  });
}

// 認証UI更新
function renderAuthUI(){
  const lb = q('loginBtn'), rb=q('registerBtn'), ab=q('accountBtn');
  if(currentUser){
    lb.style.display='none'; rb.style.display='none'; ab.style.display='inline-block';
    ensureUserStats(currentUser.uid).then(checkAdmin);
  } else {
    lb.style.display='inline-block'; rb.style.display='inline-block'; ab.style.display='none';
    isAdmin=false;
  }
}

// ユーザ統計初期化
async function ensureUserStats(uid){
  const snap = await db.ref(`users/${uid}/stats`).once('value');
  if(!snap.exists()) await db.ref(`users/${uid}/stats`).set({posts:0,threads:0});
}

// 管理者判定
async function checkAdmin(){
  const snap = await db.ref('admin').once('value');
  isAdmin = (snap.val() === deviceId) || (currentUser && currentUser.email==='atsuki.game.y@gmail.com');
}

// モーダル操作
function openLoginModal(){ const m=q('loginModal'); if(m) m.style.display='block'; }
function closeLoginModal(){ const m=q('loginModal'); if(m) m.style.display='none'; }
function openRegisterModal(){ const m=q('registerModal'); if(m) m.style.display='block'; }
function closeRegisterModal(){ const m=q('registerModal'); if(m) m.style.display='none'; }
function openAccountModal(){ const m=q('accountModal'); if(!m) return; m.style.display='block';
  if(currentUser){
    db.ref(`users/${currentUser.uid}/stats`).once('value').then(s=>{
      const v=s.val();
      q('statsArea').textContent=`投稿数: ${v.posts} 回\nスレ作成: ${v.threads} 回`;
    });
  } else q('statsArea').textContent='未ログイン';
}
function closeAccountModal(){ const m=q('accountModal'); if(m) m.style.display='none'; }

// ログイン／登録処理
async function loginWithEmail(){
  try{ await auth.signInWithEmailAndPassword(q('loginEmail').value,q('loginPass').value); closeLoginModal(); }
  catch(e){ alert('ログイン失敗:'+e.message); }
}
async function registerWithEmail(){
  try{
    const cred = await auth.createUserWithEmailAndPassword(q('regEmail').value,q('regPass').value);
    await db.ref(`users/${cred.user.uid}/stats`).set({posts:0,threads:0});
    alert('登録完了＆ログイン'); closeRegisterModal();
  }catch(e){ alert('登録失敗:'+e.message); }
}

// スレッド一覧
function loadThreadList(){
  const list=q('threadList');
  db.ref('threads').orderByChild('lastActivity').on('value',snap=>{
    const arr=[]; snap.forEach(ch=>arr.push({id:ch.key,...ch.val()})); arr.reverse();
    if(arr.length===0){ list.innerHTML='<div class="empty">まだスレッドがありません。</div>'; return; }
    list.innerHTML = arr.map(th=>{
      const del = isAdmin?`<span class="thread-delete-btn" onclick="deleteThread('${th.id}',event)">🗑️</span>`:'';
      return `<div class="thread-item"${th.closed?' style="opacity:.6;cursor:default"':''}>
        <div class="thread-info" onclick="${th.closed?'':'openThread("'+th.id+'")'}">
          <span class="thread-title">${escape(th.title)}</span>
          <span class="thread-meta">作成:${formatDate(new Date(th.createdAt))} / 更新:${formatDate(new Date(th.lastActivity))}</span>
        </div>
        <span class="thread-stats">${th.postCount||0}件</span>
        ${del}
      </div>`;
    }).join('');
  });
}
function deleteThread(id,e){
  e.stopPropagation();
  if(!confirm('このスレッドを削除しますか？')) return;
  db.ref(`threads/${id}`).remove(); db.ref(`posts/${id}`).remove();
}

// スレッド作成
function showCreateThreadModal(){ const m=q('createThreadModal'); if(m)m.style.display='block'; }
function hideCreateThreadModal(){ const m=q('createThreadModal'); if(m)m.style.display='none'; }
async function createThread(){
  const t=q('threadTitle').value.trim(); if(!t) return;
  const ref=db.ref('threads').push();
  await ref.set({title:t,createdAt:new Date().toISOString(),lastActivity:new Date().toISOString(),postCount:0,creatorId:deviceId,closed:false});
  if(currentUser) await db.ref(`users/${currentUser.uid}/stats/threads`).transaction(v=>(v||0)+1);
  hideCreateThreadModal(); openThread(ref.key);
}
function openThread(id){ location.href=`thread.html?id=${id}`; }

// スレッドページ
function loadThread(){
  currentThreadId=new URLSearchParams(location.search).get('id');
  if(!currentThreadId){ location.href='index.html'; return; }
  db.ref(`threads/${currentThreadId}`).on('value',snap=>{
    const th=snap.val(); if(!th){ alert('削除済'); location.href='index.html'; return; }
    q('threadTitle').textContent=th.title;
    handleDeletionWarning(th);
  });
  loadPosts(); loadPosterName();
}
async function cleanupOldData(){ /* 削除ロジックあれば */ }

// 投稿表示
function loadPosts(){
  const cont=q('postsContainer');
  db.ref(`posts/${currentThreadId}`).orderByChild('createdAt').on('value',snap=>{
    const arr=[]; snap.forEach(ch=>arr.push({id:ch.key,...ch.val()}));
    if(arr.length===0){ cont.innerHTML='<div class="empty">まだ投稿がありません。</div>'; return; }
    cont.innerHTML=arr.map((p,i)=>{
      const num=i+1, d=new Date(p.createdAt);
      const badge = p.email==='atsuki.game.y@gmail.com'?'<span class="badge-admin">§赤[運営]</span>':
        (p.userStats&&p.userStats.posts>=100&&p.userStats.threads>=10?'<span class="badge-vip">§金[VIP]</span>':'');
      const header=`${badge}${colorGreen(num+':')} ${escape(p.name||'名無し')} ${colorBlue('◆'+p.deviceId)} ${colorBlack(formatDateWithSecond(d))}${p.isCreator?' '+colorBlue('[スレ主]'):''}`;
      const delIcon = isAdmin?`<span class="post-delete-icon" onclick="deletePost('${p.id}',${num})">🗑️</span>`:'';
      const content=processAnchors(escape(p.content).replace(/\n/g,'<br>'));
      return `<div class="post" id="post${num}">
        <div class="post-body"><div class="post-header">${header}</div><div class="post-content">${content}</div></div>
        ${delIcon}
      </div>`;
    }).join('');
  });
}

// 投稿削除
async function deletePost(pid,num){
  if(!isAdmin){ alert('権限なし'); return; }
  if(!confirm(`投稿${num}を削除しますか？`)) return;
  await db.ref(`posts/${currentThreadId}/${pid}`).remove();
  const tsnap=await db.ref(`threads/${currentThreadId}`).once('value');
  const th=tsnap.val(); if(th) db.ref(`threads/${currentThreadId}/postCount`).set((th.postCount||1)-1);
}

// 投稿送信
async function submitPost(){
  const name=q('posterName').value.trim(); savePosterName(name);
  const c=q('postContent').value.trim(); if(!c){ alert('内容を入力してください'); return; }
  const tsnap=await db.ref(`threads/${currentThreadId}`).once('value'); const th=tsnap.val();
  if(!th||th.closed){ alert('投稿不可'); return; }
  const pr=db.ref(`posts/${currentThreadId}`).push();
  await pr.set({name,content:c,deviceId,email:currentUser?currentUser.email:'',createdAt:new Date().toISOString(),isCreator:th.creatorId===deviceId});
  if(currentUser) await db.ref(`users/${currentUser.uid}/stats/posts`).transaction(v=>(v||0)+1);
  const nc=(th.postCount||0)+1, upd={lastActivity:new Date().toISOString(),postCount:nc};
  if(nc>=1000){upd.closed=true;upd.closedAt=new Date().toISOString();}
  await db.ref(`threads/${currentThreadId}`).update(upd);
  document.getElementById('postForm').reset(); loadPosterName();
}

// 名前保持
function savePosterName(n){ if(n) localStorage.setItem('acchan_poster_name',n); }
function loadPosterName(){ const v=localStorage.getItem('acchan_poster_name'); if(v) q('posterName').value=v; }

// ヘルパー
function escape(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function colorGreen(t){return`<span class="color-green">${t}</span>`;}
function colorBlack(t){return`<span class="color-black">${t}</span>`;}
function colorBlue(t){return`<span class="color-blue">${t}</span>`;}
function formatDate(d){return`${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;}
function formatDateWithSecond(d){const w=['日','月','火','水','木','金','土'][d.getDay()];return`${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}(${w}) ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;}
function processAnchors(h){return h.replace(/>>(\d+)/g,(m,n)=>`<span class="anchor" onclick="scrollToPost(${n})">□>>${n}</span>`);}
function scrollToPost(n){const e=q('post'+n);if(e){e.scrollIntoView({behavior:'smooth'});e.style.background='#ffffcc';setTimeout(()=>e.style.background='',2000);}}

// モーダル外クリックで閉じる
window.addEventListener('click',e=>{ if(e.target.classList.contains('modal')) e.target.style.display='none'; });
