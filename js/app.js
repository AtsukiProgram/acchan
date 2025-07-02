/* ----- Firebase 初期化 ----- */
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
const db   = firebase.database();

/* ----- 共通変数 ----- */
let deviceId = '', currentUser = null, isAdmin = false;
let currentThreadId = '', deletionTimerId = null;

/* ----- 便利関数 ----- */
const q = id => document.getElementById(id);
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ----- 初期化 ----- */
function initializeApp(){
  deviceId = localStorage.getItem('acchan_device_id') ||
             (() => {const c='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                      let v=''; for(let i=0;i<8;i++) v+=c[Math.random()*c.length|0];
                      localStorage.setItem('acchan_device_id',v); return v;})();

  auth.onAuthStateChanged(async user => {
    currentUser = user || null;
    await renderAuthUI();
    loadThreadList();
    if (currentThreadId) loadPosts();
  });
}

/* cleanupOldData が無いと怒られるため空実装 */
function cleanupOldData(){}

/* 認証 UI 切替 & 管理者判定 */
async function renderAuthUI(){
  const lb=q('loginBtn'), rb=q('registerBtn'), ab=q('accountBtn');
  if(lb&&rb&&ab){
    if(currentUser){
      lb.style.display='none'; rb.style.display='none'; ab.style.display='inline-block';
      await ensureUserStats(currentUser.uid);
    }else{
      lb.style.display='inline-block'; rb.style.display='inline-block'; ab.style.display='none';
    }
  }
  const snap = await db.ref('admin').once('value');
  isAdmin = (snap.val() === deviceId) ||
            (currentUser && currentUser.email === 'atsuki.game.y@gmail.com');
}

/* stats ノード作成 */
async function ensureUserStats(uid){
  const s = await db.ref(`users/${uid}/stats`).once('value');
  if(!s.exists()) await db.ref(`users/${uid}/stats`).set({posts:0,threads:0});
}

/* ----- index.html 専用イベント ----- */
function attachIndexEvents(){
  const f=q('createThreadForm');
  if(f) f.addEventListener('submit',e=>{e.preventDefault(); createThread();});
}

/* ----- thread.html 専用イベント ----- */
function attachThreadEvents(){
  const f=q('postForm');
  if(f) f.addEventListener('submit',e=>{e.preventDefault(); submitPost();});
}

/* ----- モーダルを安全に開閉（null ガード付き） ----- */
['Login','Register','Account'].forEach(type=>{
  window['open'+type+'Modal']  = ()=>{const m=q(type.toLowerCase()+'Modal'); if(m) m.style.display='block';};
  window['close'+type+'Modal'] = ()=>{const m=q(type.toLowerCase()+'Modal'); if(m) m.style.display='none';};
});

/* ----- 認証処理 ----- */
async function loginWithEmail(){
  try{ await auth.signInWithEmailAndPassword(q('loginEmail').value,q('loginPass').value);
       closeLoginModal(); }
  catch(e){ alert('ログイン失敗:'+e.message); }
}
async function registerWithEmail(){
  try{
    const cred = await auth.createUserWithEmailAndPassword(q('regEmail').value,q('regPass').value);
    await db.ref(`users/${cred.user.uid}/stats`).set({posts:0,threads:0});
    alert('登録完了'); closeRegisterModal();
  }catch(e){ alert('登録失敗:'+e.message); }
}

/* ----- スレッド一覧 ----- */
function loadThreadList(){
  const list=q('threadList'); if(!list) return;
  db.ref('threads').orderByChild('lastActivity').on('value',snap=>{
    const a=[]; snap.forEach(c=>a.push({id:c.key,...c.val()})); a.reverse();
    list.innerHTML = a.length===0 ? '<div class="empty">まだスレッドがありません。</div>' :
      a.map(th=>{
        const del=isAdmin?`<span class="thread-delete-btn" onclick="deleteThread('${th.id}',event)">🗑️</span>`:'';
        return `<div class="thread-item"${th.closed?' style="opacity:.6;"':''}>
          <div class="thread-info" onclick="${th.closed?'':'openThread(\\''+th.id+'\\')'}">
            <span class="thread-title">${esc(th.title)}</span>
            <span class="thread-meta">作成:${formatDate(th.createdAt)} / 更新:${formatDate(th.lastActivity)}</span>
          </div>
          <span class="thread-stats">${th.postCount||0}件</span>${del}
        </div>`;
      }).join('');
  });
}
function deleteThread(id,e){ e.stopPropagation();
  if(confirm('このスレッドを削除しますか？')){
    db.ref(`threads/${id}`).remove(); db.ref(`posts/${id}`).remove();
  }
}

/* ----- スレッド作成 ----- */
function showCreateThreadModal(){const m=q('createThreadModal'); if(m) m.style.display='block';}
function hideCreateThreadModal(){const m=q('createThreadModal'); if(m) m.style.display='none';}
async function createThread(){
  const title=q('threadTitle').value.trim(); if(!title)return;
  const ref=db.ref('threads').push();
  await ref.set({title,createdAt:new Date().toISOString(),lastActivity:new Date().toISOString(),
                 postCount:0,creatorId:deviceId,closed:false});
  if(currentUser) db.ref(`users/${currentUser.uid}/stats/threads`).transaction(v=>(v||0)+1);
  hideCreateThreadModal(); openThread(ref.key);
}
function openThread(id){ location.href=`thread.html?id=${id}`; }

/* ----- スレッドページ処理 ----- */
function loadThread(){
  currentThreadId = new URLSearchParams(location.search).get('id');
  if(!currentThreadId){ location.href='index.html'; return; }

  db.ref(`threads/${currentThreadId}`).on('value',snap=>{
    const th=snap.val();
    if(!th){ alert('削除済み'); location.href='index.html'; return; }
    if(q('threadTitle')) q('threadTitle').textContent = th.title;
  });
  loadPosts(); loadPosterName();
}

/* ----- 投稿表示 ----- */
function loadPosts(){
  const cont=q('postsContainer'); if(!cont) return;
  db.ref(`posts/${currentThreadId}`).orderByChild('createdAt').on('value',snap=>{
    const a=[]; snap.forEach(c=>a.push({id:c.key,...c.val()}));
    cont.innerHTML = a.length===0 ? '<div class="empty">まだ投稿がありません。</div>' :
      a.map((p,i)=>{
        const num=i+1, badge =
          p.email==='atsuki.game.y@gmail.com' ? '<span class="badge-admin">§赤[運営]</span>' :
          (p.userStats&&p.userStats.posts>=100&&p.userStats.threads>=10 ?
            '<span class="badge-vip">§金[VIP]</span>' : '');
        const del=isAdmin?`<span class="post-delete-icon" onclick="deletePost('${p.id}',${num})">🗑️</span>`:'';
        const content = esc(p.content).replace(/\n/g,'<br>').replace(/>>(\d+)/g,
          (_,n)=>`<span class="anchor" onclick="scrollToPost(${n})">□>>${n}</span>`);
        return `<div class="post" id="post${num}">
          <div class="post-body">
            <div class="post-header">${badge}${colorGreen(num+':')} ${esc(p.name||'名無し')}
              ${colorBlue('◆'+p.deviceId)} ${colorBlack(formatDateWithSecond(p.createdAt))}
            </div>
            <div class="post-content">${content}</div>
          </div>${del}
        </div>`;
      }).join('');
  });
}
async function deletePost(pid,num){
  if(!isAdmin){alert('権限なし');return;}
  if(confirm(`投稿${num}を削除しますか？`)){
    await db.ref(`posts/${currentThreadId}/${pid}`).remove();
    await db.ref(`threads/${currentThreadId}/postCount`).transaction(v=>(v||1)-1);
  }
}

/* ----- 投稿送信 ----- */
function savePosterName(n){ if(n) localStorage.setItem('acchan_poster_name',n); }
function loadPosterName(){ const v=localStorage.getItem('acchan_poster_name'); if(v) q('posterName').value=v; }
async function submitPost(){
  const name=q('posterName').value.trim(); savePosterName(name);
  const content=q('postContent').value.trim(); if(!content){alert('内容を入力');return;}
  const thSnap=await db.ref(`threads/${currentThreadId}`).once('value'); const th=thSnap.val();
  if(!th||th.closed){alert('投稿できません');return;}
  const postRef=db.ref(`posts/${currentThreadId}`).push();
  await postRef.set({name,content,deviceId,email:currentUser?currentUser.email:'',createdAt:new Date().toISOString(),isCreator:th.creatorId===deviceId});
  if(currentUser) db.ref(`users/${currentUser.uid}/stats/posts`).transaction(v=>(v||0)+1);
  await db.ref(`threads/${currentThreadId}`).update({postCount:(th.postCount||0)+1,lastActivity:new Date().toISOString()});
  q('postForm').reset(); loadPosterName();
}

/* ----- 便利な表示フォーマッタ ----- */
function colorGreen(t){return`<span class="color-green">${t}</span>`;}
function colorBlue(t){return`<span class="color-blue">${t}</span>`;}
function colorBlack(t){return`<span class="color-black">${t}</span>`;}
function formatDate(iso){const d=new Date(iso);return`${d.getFullYear()}/${(d.getMonth()+1+'').padStart(2,'0')}/${(d.getDate()+'').padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;}
function formatDateWithSecond(iso){const d=new Date(iso),w=['日','月','火','水','木','金','土'][d.getDay()];return`${d.getFullYear()}/${(d.getMonth()+1+'').padStart(2,'0')}/${(d.getDate()+'').padStart(2,'0')}(${w}) ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;}
function scrollToPost(n){const e=q('post'+n);if(e){e.scrollIntoView({behavior:'smooth'});e.style.background='#ffffcc';setTimeout(()=>e.style.background='',2000);}}

/* ----- 背景クリックでモーダル閉じる ----- */
window.addEventListener('click',e=>{
  if(e.target.classList.contains('modal')) e.target.style.display='none';
});
