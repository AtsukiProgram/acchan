// js/app.js
// Firebase 初期化
const firebaseConfig = {
  apiKey: "AIzaSyAYvHj-SSZn23aufSmJoibhVoN4S3Nvym0",
  authDomain: "acchan-77bca.firebaseapp.com",
  databaseURL: "https://acchan-77bca-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acchan-77bca",
  storageBucket: "acchan-77bca.appspot.com",
  messagingSenderId: "958930816155",
  appId: "1:958930816155:web:daee73c617e23283caca3e"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

let deviceId = '';
let currentThreadId = '';
let deletionTimerId = null;
let isAdmin = false;
let currentUser = null;

// 初期化
function initializeApp(){
  deviceId = getOrCreateDeviceId();
  setupAuthListener();
  cleanupOldData();
  console.log('Initialized, deviceId:', deviceId);
}

// デバイスID生成/取得
function getOrCreateDeviceId(){
  let id = localStorage.getItem('acchan_device_id');
  if(!id){
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    id = '';
    for(let i=0;i<8;i++) id+=chars.charAt(Math.random()*chars.length|0);
    localStorage.setItem('acchan_device_id',id);
  }
  return id;
}

// 認証状態監視
function setupAuthListener(){
  auth.onAuthStateChanged(user=>{
    currentUser = user;
    if(user){
      document.getElementById('loginBtn').style.display='none';
      document.getElementById('accountBtn').style.display='inline-block';
      ensureUserStats(user.uid).then(()=>{
        checkAdminStatus();
        loadThreadList();
        if(currentThreadId) loadPosts();
      });
    } else {
      document.getElementById('loginBtn').style.display='inline-block';
      document.getElementById('accountBtn').style.display='none';
      isAdmin=false;
    }
  });
}

// ユーザ統計初期化
async function ensureUserStats(uid){
  const snap=await db.ref(`users/${uid}/stats`).once('value');
  if(!snap.exists()) await db.ref(`users/${uid}/stats`).set({posts:0,threads:0});
}

// 管理者判定 (batから書き込まれる admin ノード or 運営メール)
function checkAdminStatus(){
  db.ref('admin').once('value',snap=>{
    const aid=snap.val();
    isAdmin = (aid===deviceId) || (currentUser&&currentUser.email==='atsuki.game.y@gmail.com');
    loadThreadList();
    if(currentThreadId) loadPosts();
  });
}

// ログインUI
function openLoginModal(){document.getElementById('loginModal').style.display='block';}
function closeLoginModal(){document.getElementById('loginModal').style.display='none';}
async function loginWithEmail(){
  const e=document.getElementById('loginEmail').value;
  const p=document.getElementById('loginPass').value;
  try{await auth.signInWithEmailAndPassword(e,p); closeLoginModal();}
  catch(err){alert('ログイン失敗:'+err.message);}
}

// アカウントUI
function openAccountModal(){
  document.getElementById('accountModal').style.display='block';
  const uid=currentUser.uid;
  db.ref(`users/${uid}/stats`).once('value',snap=>{
    const s=snap.val();
    document.getElementById('statsArea').textContent = `投稿数: ${s.posts} 件\nスレッド作成: ${s.threads} 回`;
  });
}
function closeAccountModal(){document.getElementById('accountModal').style.display='none';}

// スレッド一覧読み込み
function loadThreadList(){
  const list = document.getElementById('threadList');
  db.ref('threads').orderByChild('lastActivity').on('value',snap=>{
    const arr=[];
    snap.forEach(ch=>arr.push({id:ch.key,...ch.val()}));
    arr.reverse();
    if(arr.length===0){
      list.innerHTML='<div class="empty">まだスレッドがありません。</div>'; return;
    }
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
  if(!confirm('削除しますか？'))return;
  db.ref(`threads/${id}`).remove();
  db.ref(`posts/${id}`).remove();
}

function showCreateThreadModal(){document.getElementById('createThreadModal').style.display='block';}
function hideCreateThreadModal(){document.getElementById('createThreadModal').style.display='none';}
document.querySelector('#createThreadForm').addEventListener('submit',e=>{
  e.preventDefault(); createThread();
});
async function createThread(){
  const t=document.getElementById('threadTitle').value.trim();
  if(!t)return;
  const ref=db.ref('threads').push();
  await ref.set({title:t,createdAt:new Date().toISOString(),lastActivity:new Date().toISOString(),postCount:0,creatorId:deviceId,closed:false});
  if(currentUser) db.ref(`users/${currentUser.uid}/stats/threads`).transaction(v=>(v||0)+1);
  hideCreateThreadModal(); openThread(ref.key);
}

function openThread(id){ location.href=`thread.html?id=${id}`; }

// スレ読み込み
function loadThread(){
  currentThreadId=new URLSearchParams(location.search).get('id');
  if(!currentThreadId){location.href='index.html';return;}
  db.ref(`threads/${currentThreadId}`).on('value',snap=>{
    const th=snap.val(); if(!th){alert('削除済');location.href='index.html';return;}
    document.getElementById('threadTitle').textContent=th.title;
    handleDeletionWarning(th);
  });
  loadPosts();
  loadPosterName();
  document.getElementById('postForm').addEventListener('submit',e=>{
    e.preventDefault(); submitPost();
  });
}

// 投稿読み込み
function loadPosts(){
  const c=document.getElementById('postsContainer');
  db.ref(`posts/${currentThreadId}`).orderByChild('createdAt').on('value',snap=>{
    const arr=[]; snap.forEach(ch=>arr.push({id:ch.key,...ch.val()}));
    if(arr.length===0){c.innerHTML='<div class="empty">まだ投稿がありません。</div>';return;}
    c.innerHTML=arr.map((p,i)=>{
      const num=i+1, date=new Date(p.createdAt);
      const badge = p.email==='atsuki.game.y@gmail.com'?
        '<span class="badge-admin">§赤[運営]</span>' :
        (p.userStats&&p.userStats.posts>=100&&p.userStats.threads>=10?
          '<span class="badge-vip">§金[VIP]</span>':'');
      const header = `${badge}${colorGreen(num+':')} ${escape(p.name||'名前すらない淫夢')} ${colorBlue('◆'+p.deviceId)} ${colorBlack(formatDateWithSecond(date))}${p.isCreator?' '+colorBlue('[スレ主]'):''}`;
      const delIcon = isAdmin?`<span class="post-delete-icon" onclick="deletePost('${p.id}',${num})">🗑️</span>`:'';
      const content = processAnchors(escape(p.content).replace(/\n/g,'<br>'));
      return `<div class="post" id="post${num}">
        <div class="post-body">
          <div class="post-header">${header}</div>
          <div class="post-content">${content}</div>
        </div>
        ${delIcon}
      </div>`;
    }).join('');
  });
}

async function deletePost(postId, num){
  if(!isAdmin){alert('権限なし');return;}
  if(!confirm(`投稿${num}を削除？`))return;
  await db.ref(`posts/${currentThreadId}/${postId}`).remove();
  const thsnap=await db.ref(`threads/${currentThreadId}`).once('value');
  const th=thsnap.val();
  if(th) db.ref(`threads/${currentThreadId}/postCount`).set((th.postCount||1)-1);
}

function handleDeletionWarning(th){
  const el=document.getElementById('deletionWarning');
  if(deletionTimerId)clearInterval(deletionTimerId);
  if(th.closed&&th.postCount>=1000&&th.closedAt){
    const delTime=new Date(new Date(th.closedAt).getTime()+7*86400000);
    const update=()=>{
      let diff=delTime-new Date();
      if(diff<=0){el.textContent='このスレッドは完全に削除されました。';clearInterval(deletionTimerId);return;}
      const d=Math.floor(diff/86400000); diff-=d*86400000;
      const h=Math.floor(diff/3600000); diff-=h*3600000;
      const m=Math.floor(diff/60000); diff-=m*60000;
      const s=Math.floor(diff/1000);
      el.textContent=`このスレッドは1000を超えました。\n残り${d}日${h}時間${m}分${s}秒で削除されます。`;
    };
    update(); deletionTimerId=setInterval(update,1000);
  } else el.textContent='';
}

// 投稿処理
async function submitPost(){
  const name=document.getElementById('posterName').value.trim();
  savePosterName(name);
  const content=document.getElementById('postContent').value.trim();
  if(!content){alert('内容を入力してください');return;}
  const thsnap=await db.ref(`threads/${currentThreadId}`).once('value'), th=thsnap.val();
  if(!th||th.closed){alert('投稿不可');return;}
  const pr=db.ref(`posts/${currentThreadId}`).push();
  await pr.set({name,content,deviceId,email:currentUser?currentUser.email:'',createdAt:new Date().toISOString(),isCreator:th.creatorId===deviceId});
  if(currentUser) db.ref(`users/${currentUser.uid}/stats/posts`).transaction(v=>(v||0)+1);
  const newCount=(th.postCount||0)+1, upd={lastActivity:new Date().toISOString(),postCount:newCount};
  if(newCount>=1000){upd.closed=true;upd.closedAt=new Date().toISOString();}
  await db.ref(`threads/${currentThreadId}`).update(upd);
  document.getElementById('postForm').reset(); loadPosterName();
}

// プレースホルダー修正不要, コマンド関連削除

// アカウント統計用
function openAccountModal(){document.getElementById('accountModal').style.display='block';}
function closeAccountModal(){document.getElementById('accountModal').style.display='none';}

// 再掲: 名前記憶
function savePosterName(n){ if(n) localStorage.setItem('acchan_poster_name',n); }
function loadPosterName(){ const v=localStorage.getItem('acchan_poster_name'); if(v)document.getElementById('posterName').value=v; }

// 汎用
function escape(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function colorGreen(t){return`<span class="color-green">${t}</span>`;}
function colorBlack(t){return`<span class="color-black">${t}</span>`;}
function colorBlue(t){return`<span class="color-blue">${t}</span>`;}
function formatDate(d){return`${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;}
function formatDateWithSecond(d){const ws=['日','月','火','水','木','金','土'][d.getDay()];return`${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}(${ws}) ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;}
function processAnchors(h){return h.replace(/>>(\d+)/g,(m,n)=>`<span class="anchor" onclick="scrollToPost(${n})">□>>${n}</span>`);}
function scrollToPost(n){const e=document.getElementById('post'+n);if(e){e.scrollIntoView({behavior:'smooth'});e.style.background='#ffffcc';setTimeout(()=>e.style.background='',2000);}}

// モーダル外クリックで閉じる
window.addEventListener('click',e=>{if(e.target.classList.contains('modal'))e.target.style.display='none';});
