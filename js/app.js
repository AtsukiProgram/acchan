// 【重要】ここに、Firebaseで取得したあなたのfirebaseConfigオブジェクトを貼り付けます
const firebaseConfig = {
  apiKey: "AIzaSyAYvHj-SSZn23aufSmJoibhVoN4S3Nvym0",
  authDomain: "acchan-77bca.firebaseapp.com",
  databaseURL: "https://acchan-77bca-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acchan-77bca",
  storageBucket: "acchan-77bca.appspot.com",
  messagingSenderId: "958930816155",
  appId: "1:958930816155:web:daee73c617e23283caca3e"
};

// Firebaseの初期化
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// グローバル変数
let deviceId = '';
let currentThreadId = '';
let deletionTimerId = null;
let isAdmin = false; // 管理者かどうかを保持するフラグ

// アプリケーション初期化
function initializeApp() {
    deviceId = getOrCreateDeviceId();
    checkAdminStatus(); // 管理者ステータスを監視開始
    cleanupOldData();
    console.log('acchan初期化完了 - 端末ID:', deviceId);
}

// 【追加】管理者ステータスを監視する関数
function checkAdminStatus() {
    const adminRef = database.ref('admin');
    adminRef.on('value', (snapshot) => {
        const adminId = snapshot.val();
        isAdmin = (adminId === deviceId);
        console.log(`管理者ステータス: ${isAdmin ? '管理者' : '一般ユーザー'}`);
        // 管理者ステータスが変わったら表示を更新
        // スレッド一覧ページにいる場合
        if (document.getElementById('threadList')) loadThreadList();
        // スレッドページにいる場合
        if (document.getElementById('postsContainer')) loadPosts();
    });
}

// --- localStorage関連 ---
function getOrCreateDeviceId() {
    let id = localStorage.getItem('acchan_device_id');
    if (!id) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        id = '';
        for (let i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        localStorage.setItem('acchan_device_id', id);
    }
    return id;
}

function savePosterName(name) {
    if (name) localStorage.setItem('acchan_poster_name', name);
}

function loadPosterName() {
    const savedName = localStorage.getItem('acchan_poster_name');
    if (savedName) document.getElementById('posterName').value = savedName;
}

// --- データクリーンアップ ---
function cleanupOldData() {
    const threadsRef = database.ref('threads');
    threadsRef.once('value', (snapshot) => {
        const now = new Date().getTime();
        snapshot.forEach((childSnapshot) => {
            const thread = childSnapshot.val();
            const threadId = childSnapshot.key;
            
            const lastActivity = new Date(thread.lastActivity).getTime();
            const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24);

            if (daysSinceActivity > 21 || (thread.postCount && thread.postCount >= 1000)) {
                if (!thread.closed) {
                    database.ref(`threads/${threadId}`).update({
                        closed: true,
                        closedAt: new Date().toISOString()
                    });
                }
            }
            if (thread.closed) {
                const closedTime = new Date(thread.closedAt).getTime();
                const daysSinceClosed = (now - closedTime) / (1000 * 60 * 60 * 24);
                if (daysSinceClosed > 7) {
                    database.ref(`threads/${threadId}`).remove();
                    database.ref(`posts/${threadId}`).remove();
                }
            }
        });
    });
}

// --- スレッド一覧関連 ---
function loadThreadList() {
    const threadsRef = database.ref('threads');
    const threadList = document.getElementById('threadList');

    threadsRef.orderByChild('lastActivity').on('value', (snapshot) => {
        let threads = [];
        snapshot.forEach((childSnapshot) => {
            threads.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        threads.reverse();

        if (threads.length === 0) {
            threadList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">まだスレッドがありません。「+」ボタンで新しいスレッドを作成してください。</div>';
            return;
        }

        threadList.innerHTML = threads.map(thread => {
            const createdDate = new Date(thread.createdAt);
            const lastActivityDate = new Date(thread.lastActivity);
            const status = thread.closed ? '[終了]' : '';
            // 管理者であればスレッド削除アイコンを表示
            const deleteButton = isAdmin ? `<span class="thread-delete-btn" onclick="deleteThread('${thread.id}', event)">🗑️</span>` : '';
            
            return `
                <div class="thread-item" style="${thread.closed ? 'opacity: 0.6; cursor: default;' : ''}">
                    <div class="thread-info" onclick="${thread.closed ? '' : `openThread('${thread.id}')`}">
                        <div class="thread-title">${status}${escapeHtml(thread.title)}</div>
                        <div class="thread-meta">
                            作成: ${formatDate(createdDate)} | 最終更新: ${formatDate(lastActivityDate)}
                        </div>
                    </div>
                    <div class="thread-stats">${thread.postCount || 0}件</div>
                    ${deleteButton}
                </div>
            `;
        }).join('');
    });
}

function deleteThread(threadId, event) {
    event.stopPropagation();
    if (!isAdmin) { // 二重チェック
        alert('管理者権限がありません。');
        return;
    }
    if (!confirm('このスレッドを削除しますか？\n（この操作は元に戻せません）')) return;
    database.ref(`threads/${threadId}`).remove();
    database.ref(`posts/${threadId}`).remove();
}

function createThread() {
    const title = document.getElementById('threadTitle').value.trim();
    if (!title) return;
    const threadsRef = database.ref('threads');
    const newThreadRef = threadsRef.push();
    newThreadRef.set({
        title: title,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        postCount: 0,
        creatorId: deviceId,
        closed: false
    }).then(() => {
        hideCreateThreadModal();
        openThread(newThreadRef.key);
    });
}

// --- スレッドページ関連 ---
function loadThread() {
    const params = new URLSearchParams(window.location.search);
    currentThreadId = params.get('id');
    if (!currentThreadId) {
        window.location.href = 'index.html';
        return;
    }
    const threadRef = database.ref(`threads/${currentThreadId}`);
    threadRef.on('value', (snapshot) => {
        const thread = snapshot.val();
        if (!thread) {
            alert('スレッドが見つからないか、削除されました。');
            window.location.href = 'index.html';
            return;
        }
        document.getElementById('threadTitle').textContent = thread.title;
        document.title = `${thread.title} - acchan`;
        handleDeletionWarning(thread);
    });
    loadPosts();
    loadPosterName();
    const postForm = document.getElementById('postForm');
    if (postForm) {
        postForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitPost();
        });
    }
}

function loadPosts() {
    const postsRef = database.ref(`posts/${currentThreadId}`);
    const container = document.getElementById('postsContainer');
    postsRef.orderByChild('createdAt').on('value', (snapshot) => {
        let posts = [];
        snapshot.forEach((childSnapshot) => {
            posts.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        if (posts.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">まだ投稿がありません。最初の投稿をしてみましょう！</div>';
            return;
        }
        container.innerHTML = posts.map((post, index) => {
            const postNumber = index + 1;
            const postDate = new Date(post.createdAt);
            const isCreator = post.isCreator ? colorBlue('[スレ主]') : '';
            const name = post.name || '名前すらない淫夢';
            let content = escapeHtml(post.content).replace(/\n/g, '<br>');
            content = processAnchors(content);
            const headerHtml = `${colorGreen(postNumber + ':')} ${colorBlack(escapeHtml(name))} ${colorBlue('◆' + post.deviceId)} ${colorBlack(formatDateWithSecond(postDate))} ${isCreator}`;
            
            // 管理者であれば投稿削除アイコンを表示
            const deleteIcon = isAdmin ? `<span class="post-delete-icon" onclick="deletePost('${post.id}', ${postNumber})">🗑️</span>` : '';

            return `
                <div class="post" id="post${postNumber}">
                    <div class="post-body">
                        <div class="post-header">${headerHtml}</div>
                        <div class="post-content">${content}</div>
                    </div>
                    ${deleteIcon}
                </div>
            `;
        }).join('');
    });
}

// 【変更】投稿を削除する関数 (postCountの更新と番号の自動振り直し)
async function deletePost(postId, postNumber) {
    if (!isAdmin) { // 二重チェック
        alert('管理者権限がありません。');
        return;
    }
    if (!confirm(`投稿 ${postNumber} を削除しますか？`)) return;
    
    const postRef = database.ref(`posts/${currentThreadId}/${postId}`);
    await postRef.remove(); // 投稿を削除

    // スレッドの投稿数を更新
    const threadRef = database.ref(`threads/${currentThreadId}`);
    const snapshot = await threadRef.once('value');
    const thread = snapshot.val();
    if (thread) {
        threadRef.update({ postCount: (thread.postCount || 1) - 1 });
    }
    // Realtime Databaseのon('value')リスナーが自動で再読み込みするため、
    // 明示的なloadPosts()呼び出しは不要。番号の振り直しも自動で行われる。
}

function handleDeletionWarning(thread) {
    const warningEl = document.getElementById('deletionWarning');
    if (deletionTimerId) clearInterval(deletionTimerId);
    if (thread.closed && thread.postCount >= 1000 && thread.closedAt) {
        const deletionTime = new Date(new Date(thread.closedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
        const updateWarning = () => {
            const now = new Date();
            let diff = deletionTime - now;
            if (diff <= 0) {
                warningEl.textContent = 'このスレッドは完全に削除されました。';
                clearInterval(deletionTimerId);
                return;
            }
            const d = Math.floor(diff / 86400000);
            diff -= d * 86400000;
            const h = Math.floor(diff / 3600000);
            diff -= h * 3600000;
            const m = Math.floor(diff / 60000);
            diff -= m * 60000;
            const s = Math.floor(diff / 1000);
            warningEl.textContent = `このスレッドは1000を超えました。\nこのスレッドは残り、${d}日${h}時間${m}分${s}秒で完全に削除されます。`;
        };
        updateWarning();
        deletionTimerId = setInterval(updateWarning, 1000);
    } else {
        warningEl.textContent = '';
    }
}

// --- 投稿処理 (シンプル化) ---
async function submitPost() {
    const name = document.getElementById('posterName').value.trim();
    savePosterName(name);

    const content = document.getElementById('postContent').value.trim();
    if (!content) {
        alert('内容を入力してください');
        return;
    }

    const threadRef = database.ref(`threads/${currentThreadId}`);
    const snapshot = await threadRef.once('value');
    const thread = snapshot.val();
    if (!thread) { alert('エラー: スレッドが見つかりません。'); return; }
    if (thread.closed) { alert('このスレッドは終了しています'); return; }

    const postsRef = database.ref(`posts/${currentThreadId}`);
    postsRef.push({
        name: name,
        content: content,
        deviceId: deviceId,
        createdAt: new Date().toISOString(),
        isCreator: thread.creatorId === deviceId,
    });

    const newPostCount = (thread.postCount || 0) + 1;
    const updates = { lastActivity: new Date().toISOString(), postCount: newPostCount };
    if (newPostCount >= 1000) {
        updates.closed = true;
        updates.closedAt = new Date().toISOString();
    }
    threadRef.update(updates);
    document.getElementById('postForm').reset();
    loadPosterName();
}

// --- UI/ユーティリティ関連 ---
function showCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'block';
}

function hideCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'none';
    document.getElementById('createThreadForm').reset();
}

document.addEventListener('DOMContentLoaded', function() {
    const createForm = document.getElementById('createThreadForm');
    if (createForm) {
        createForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createThread();
        });
    }
});

function openThread(threadId) {
    window.location.href = `thread.html?id=${threadId}`;
}

function processAnchors(content) {
    return content.replace(/>>(\d+)/g, `<span class="anchor" onclick="scrollToPost($1)">>>$1</span>`);
}

function scrollToPost(postNumber) {
    const post = document.getElementById(`post${postNumber}`);
    if (post) {
        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
        post.style.backgroundColor = '#ffffcc';
        setTimeout(() => { post.style.backgroundColor = ''; }, 2000);
    }
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(date) {
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateWithSecond(date) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const day = days[date.getDay()];
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}(${day}) ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

function colorGreen(text) { return `<span class="color-green">${text}</span>`; }
function colorBlack(text) { return `<span class="color-black">${text}</span>`; }
function colorBlue(text) { return `<span class="color-blue">${text}</span>`; }

window.addEventListener('click', function(event) {
    const modal = document.getElementById('createThreadModal');
    if (event.target === modal) {
        hideCreateThreadModal();
    }
});
