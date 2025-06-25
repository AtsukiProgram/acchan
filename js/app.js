// 【重要】ここに、Firebaseで取得したあなたのfirebaseConfigオブジェクトを貼り付けます
const firebaseConfig = {
  apiKey: "AIzaSyAYvHj-SSZn23aufSmJoibhVoN4S3Nvym0",
  authDomain: "acchan-77bca.firebaseapp.com",
  databaseURL: "https://acchan-77bca-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "acchan-77bca",
  storageBucket: "acchan-77bca.firebasestorage.app",
  messagingSenderId: "958930816155",
  appId: "1:958930816155:web:daee73c617e23283caca3e"
};

// Firebaseの初期化
// HTMLで読み込んだfirebaseオブジェクトを直接使います[1]
firebase.initializeApp(firebaseConfig);
const database = firebase.database(); // Realtime Databaseへの参照を取得[1]

// グローバル変数
let deviceId = '';
let currentThreadId = '';
let deletionTimerId = null;

// アプリケーション初期化
function initializeApp() {
    deviceId = getOrCreateDeviceId();
    cleanupOldData(); // Firebaseデータベース上の古いデータもクリーンアップ
    console.log('acchan初期化完了 - 端末ID:', deviceId);
}

// --- localStorage関連の関数（デバイスIDと名前の保存のみに使用） ---
// デバイスIDはブラウザごとに一意に生成し、localStorageに保存
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

// 投稿者名をlocalStorageに保存
function savePosterName(name) {
    if (name) {
        localStorage.setItem('acchan_poster_name', name);
    }
}

// 保存された投稿者名を読み込み、フォームに設定
function loadPosterName() {
    const savedName = localStorage.getItem('acchan_poster_name');
    if (savedName) {
        document.getElementById('posterName').value = savedName;
    }
}


// 古いデータの削除（Firebase版）
// Firebaseデータベースから、終了条件を満たしたスレッドを削除
function cleanupOldData() {
    const threadsRef = database.ref('threads');
    threadsRef.once('value', (snapshot) => { // データ取得は一度きり
        const now = new Date().getTime();
        snapshot.forEach((childSnapshot) => {
            const thread = childSnapshot.val();
            const threadId = childSnapshot.key;
            
            const lastActivity = new Date(thread.lastActivity).getTime();
            const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24);

            // 3週間無活動、または投稿数1000件でスレッドをクローズ状態にする
            if (daysSinceActivity > 21 || (thread.postCount && thread.postCount >= 1000)) {
                if (!thread.closed) { // まだクローズされていなければ
                    database.ref(`threads/${threadId}`).update({
                        closed: true,
                        closedAt: new Date().toISOString()
                    });
                }
            }

            // クローズから1週間後に完全に削除
            if (thread.closed) {
                const closedTime = new Date(thread.closedAt).getTime();
                const daysSinceClosed = (now - closedTime) / (1000 * 60 * 60 * 24);
                if (daysSinceClosed > 7) {
                    database.ref(`threads/${threadId}`).remove(); // スレッド本体を削除[2]
                    database.ref(`posts/${threadId}`).remove(); // スレッド内の投稿も削除[2]
                }
            }
        });
    });
}

// スレッド一覧の読み込み（Firebase版）
// Firebaseからスレッドデータをリアルタイムに取得し表示
function loadThreadList() {
    const threadsRef = database.ref('threads');
    const threadList = document.getElementById('threadList');

    // 'value'イベントリスナーでデータの変更をリアルタイムに監視[2]
    threadsRef.orderByChild('lastActivity').on('value', (snapshot) => {
        let threads = [];
        snapshot.forEach((childSnapshot) => {
            threads.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });
        threads.reverse(); // lastActivityで並べ替え後、最新のものが上に来るように逆順にする

        if (threads.length === 0) {
            threadList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">まだスレッドがありません。「+」ボタンで新しいスレッドを作成してください。</div>';
            return;
        }

        threadList.innerHTML = threads.map(thread => {
            const createdDate = new Date(thread.createdAt);
            const lastActivityDate = new Date(thread.lastActivity);
            const status = thread.closed ? '[終了]' : '';
            const isCreator = (thread.creatorId === deviceId);
            // 削除ボタン（ゴミ箱の絵文字）
            const deleteButton = isCreator ? `<span class="thread-delete-btn" onclick="deleteThread('${thread.id}', event)">🗑️</span>` : '';
            
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


// スレッド削除（Firebase版）
// 指定されたスレッドとその投稿をFirebaseから削除[2]
function deleteThread(threadId, event) {
    event.stopPropagation();
    if (!confirm('このスレッドを削除しますか？\n（この操作は元に戻せません）')) return;

    database.ref(`threads/${threadId}`).remove(); // スレッド本体を削除
    database.ref(`posts/${threadId}`).remove();   // そのスレッドの投稿も削除
}

// スレッド作成（Firebase版）
// 新しいスレッドをFirebaseに保存[2]
function createThread() {
    const title = document.getElementById('threadTitle').value.trim();
    if (!title) return;

    const threadsRef = database.ref('threads');
    const newThreadRef = threadsRef.push(); // ユニークなキーを自動生成[2]
    
    newThreadRef.set({ // データをセット[2]
        title: title,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        postCount: 0,
        creatorId: deviceId,
        closed: false
    }).then(() => { // データ保存成功時の処理
        hideCreateThreadModal();
        openThread(newThreadRef.key); // 新しく生成されたスレッドIDでスレッドページへ遷移
    });
}

// スレッド読み込み（Firebase版）
// スレッドページ表示時に、該当スレッドの情報をFirebaseから取得し表示
function loadThread() {
    const params = new URLSearchParams(window.location.search);
    currentThreadId = params.get('id');

    if (!currentThreadId) {
        window.location.href = 'index.html';
        return;
    }

    const threadRef = database.ref(`threads/${currentThreadId}`);
    threadRef.on('value', (snapshot) => { // スレッド情報をリアルタイム監視
        const thread = snapshot.val();
        if (!thread) {
            alert('スレッドが見つからないか、削除されました。');
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('threadTitle').textContent = thread.title;
        document.title = `${thread.title} - acchan`;

        handleDeletionWarning(thread); // 1000件警告の処理を更新
    });

    loadPosts(); // 投稿を読み込む
    loadPosterName(); // 保存された名前を読み込む

    const postForm = document.getElementById('postForm');
    if (postForm) {
        postForm.addEventListener('submit', (e) => {
            e.preventDefault();
            submitPost();
        });
    }
}

// 投稿読み込み（Firebase版）
// スレッド内の投稿をFirebaseからリアルタイムに取得し表示
function loadPosts() {
    const postsRef = database.ref(`posts/${currentThreadId}`);
    const container = document.getElementById('postsContainer');

    postsRef.orderByChild('createdAt').on('value', (snapshot) => { // 投稿をリアルタイム監視
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
            let content = escapeHtml(post.content).replace(/\n/g, '<br>'); // 改行を<br>に変換
            content = processAnchors(content);

            const headerHtml = `${colorGreen(postNumber + ':')} ${colorBlack(escapeHtml(name))} ${colorBlue('◆' + post.deviceId)} ${colorBlack(formatDateWithSecond(postDate))} ${isCreator}`;
            
            // 画像・動画の表示は今回省略
            
            return `
                <div class="post" id="post${postNumber}">
                    <div class="post-header">${headerHtml}</div>
                    <div class="post-content">${content}</div>
                </div>
            `;
        }).join('');

        // 投稿が追加されたら、自動で最新の投稿までスクロール
        setTimeout(() => {
            const lastPost = container.querySelector('.post:last-child');
            if (lastPost) {
                lastPost.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        }, 100);
    });
}

// 投稿送信（Firebase版）
// 新しい投稿をFirebaseに保存し、スレッド情報も更新[2]
function submitPost() {
    const name = document.getElementById('posterName').value.trim();
    savePosterName(name); // 名前をlocalStorageに保存

    const content = document.getElementById('postContent').value.trim();
    if (!content) {
        alert('内容を入力してください');
        return;
    }
    
    const threadRef = database.ref(`threads/${currentThreadId}`);
    threadRef.once('value').then((snapshot) => { // スレッド情報を一度取得
        const thread = snapshot.val();
        if (!thread) {
            alert('エラー: スレッドが見つかりません。');
            return;
        }
        if (thread.closed) {
            alert('このスレッドは終了しています');
            return;
        }

        const postsRef = database.ref(`posts/${currentThreadId}`);
        postsRef.push({ // 新しい投稿をプッシュ[2]
            name: name,
            content: content,
            deviceId: deviceId,
            createdAt: new Date().toISOString(),
            isCreator: thread.creatorId === deviceId,
        });

        // スレッドの投稿数と最終更新日時を更新
        const newPostCount = (thread.postCount || 0) + 1;
        const updates = {
            lastActivity: new Date().toISOString(),
            postCount: newPostCount
        };

        // 投稿数が1000件に達したらスレッドをクローズ
        if (newPostCount >= 1000) {
            updates.closed = true;
            updates.closedAt = new Date().toISOString();
        }
        
        threadRef.update(updates); // スレッド情報を更新[2]

        // フォームをリセットし、保存された名前を再設定
        document.getElementById('postForm').reset();
        document.getElementById('postContent').value = ''; // 内容だけクリア
        loadPosterName(); // 名前は保存されたものを再表示
    });
}

// 1000件警告処理
// スレッドが1000件に達した際の警告メッセージと削除までのカウントダウンを管理
function handleDeletionWarning(thread) {
    const warningEl = document.getElementById('deletionWarning');
    if (deletionTimerId) clearInterval(deletionTimerId); // 既存のタイマーがあればクリア

    if (thread.closed && thread.postCount >= 1000 && thread.closedAt) {
        const deletionTime = new Date(new Date(thread.closedAt).getTime() + 7 * 24 * 60 * 60 * 1000); // クローズから7日後
        function updateWarning() {
            const now = new Date();
            let diff = deletionTime - now; // 残り時間（ミリ秒）
            if (diff <= 0) { // 削除日時を過ぎたら
                warningEl.textContent = 'このスレッドは完全に削除されました。';
                clearInterval(deletionTimerId);
                // 必要であれば、スレッドリストに戻るなどの処理を追加
                return;
            }
            // 残り時間を日、時間、分、秒に変換
            const d = Math.floor(diff / (86400000));
            diff -= d * 86400000;
            const h = Math.floor(diff / (3600000));
            diff -= h * 3600000;
            const m = Math.floor(diff / (60000));
            diff -= m * 60000;
            const s = Math.floor(diff / 1000);
            warningEl.textContent = `このスレッドは1000を超えました。\nこのスレッドは残り、${d}日${h}時間${m}分${s}秒で完全に削除されます。`;
        }
        updateWarning(); // 初回表示をすぐに実行
        deletionTimerId = setInterval(updateWarning, 1000); // 1秒ごとに更新
    } else {
        warningEl.textContent = ''; // 警告条件を満たさない場合はメッセージを非表示
    }
}


// --- 以下の関数はUI/ユーティリティ関連で、Firebaseとは直接関係ありません ---

// スレッド作成モーダル表示
function showCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'block';
}

// スレッド作成モーダル非表示
function hideCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'none';
    document.getElementById('createThreadForm').reset();
}

// スレッド作成フォームイベントリスナーの設定
document.addEventListener('DOMContentLoaded', function() {
    const createForm = document.getElementById('createThreadForm');
    if (createForm) {
        createForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createThread();
        });
    }
});

// スレッドページへの遷移
function openThread(threadId) {
    window.location.href = `thread.html?id=${threadId}`;
}

// 投稿内容内のアンカー（>>数字）をリンクに変換
function processAnchors(content) {
    return content.replace(/>>(\d+)/g, '<span class="anchor" onclick="scrollToPost($1)">>>$1</span>');
}

// アンカークリック時に該当投稿へスクロール
function scrollToPost(postNumber) {
    const post = document.getElementById(`post${postNumber}`);
    if (post) {
        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
        post.style.backgroundColor = '#ffffcc'; // 一時的にハイライト
        setTimeout(() => { post.style.backgroundColor = ''; }, 2000); // 2秒後にハイライト解除
    }
}

// HTMLエスケープ処理
function escapeHtml(text) {
    if (typeof text !== 'string') return ''; // 入力が文字列でない場合は空文字列を返す
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 日付フォーマット（時:分まで）
function formatDate(date) {
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// 日付フォーマット（秒まで、曜日付き）
function formatDateWithSecond(date) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const day = days[date.getDay()];
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}(${day}) ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

// 色分けユーティリティ関数
function colorGreen(text) { return `<span class="color-green">${text}</span>`; }
function colorBlack(text) { return `<span class="color-black">${text}</span>`; }
function colorBlue(text) { return `<span class="color-blue">${text}</span>`; }

// モーダル外クリックで閉じる
window.addEventListener('click', function(event) {
    const modal = document.getElementById('createThreadModal');
    if (event.target === modal) {
        hideCreateThreadModal();
    }
});
