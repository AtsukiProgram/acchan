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
const database = firebase.database(); // Realtime Databaseへの参照
const storage = firebase.storage();   // Firebase Storageへの参照

// グローバル変数
let deviceId = '';
let currentThreadId = '';
let deletionTimerId = null;
let currentSelectedFiles = []; // 選択されたファイルを一時的に保持

// アプリケーション初期化
function initializeApp() {
    deviceId = getOrCreateDeviceId();
    cleanupOldData();
    console.log('acchan初期化完了 - 端末ID:', deviceId);
}

// --- localStorage関連の関数（デバイスIDと名前の保存のみに使用） ---
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
    if (name) {
        localStorage.setItem('acchan_poster_name', name);
    }
}

function loadPosterName() {
    const savedName = localStorage.getItem('acchan_poster_name');
    if (savedName) {
        document.getElementById('posterName').value = savedName;
    }
}

// 古いデータの削除（Firebase版）
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
                    // スレッドに関連するStorageデータも削除
                    const threadStorageRef = storage.ref(`media/${threadId}`);
                    threadStorageRef.listAll().then(res => {
                        res.items.forEach(itemRef => {
                            itemRef.delete();
                        });
                    }).catch(error => {
                        console.error("Error listing files in storage:", error);
                    });
                }
            }
        });
    });
}

// スレッド一覧の読み込み（Firebase版）
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
            const isCreator = (thread.creatorId === deviceId);
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
function deleteThread(threadId, event) {
    event.stopPropagation();
    if (!confirm('このスレッドを削除しますか？\n（この操作は元に戻せません）')) return;

    database.ref(`threads/${threadId}`).remove();
    database.ref(`posts/${threadId}`).remove();
    
    // スレッドに関連するStorageデータも削除
    const threadStorageRef = storage.ref(`media/${threadId}`);
    threadStorageRef.listAll().then(res => {
        res.items.forEach(itemRef => {
            itemRef.delete();
        });
    }).catch(error => {
        console.error("Error listing files in storage for deletion:", error);
    });
}

// スレッド作成（Firebase版）
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

// スレッド読み込み（Firebase版）
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

// 投稿読み込み（Firebase版）
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

            // メディア表示部分を再実装
            let mediaHtml = '';
            if (post.media && Array.isArray(post.media) && post.media.length > 0) {
                mediaHtml = '<div class="post-media">';
                post.media.forEach(media => {
                    if (media.type.startsWith('image/')) {
                        mediaHtml += `<img src="${media.url}" alt="添付画像" style="max-width:200px; max-height:200px; margin-right:5px; margin-bottom:5px;">`;
                    } else if (media.type.startsWith('video/')) {
                        mediaHtml += `<video controls src="${media.url}" style="max-width:200px; max-height:200px; margin-right:5px; margin-bottom:5px;"></video>`;
                    }
                });
                mediaHtml += '</div>';
            }

            const headerHtml = `${colorGreen(postNumber + ':')} ${colorBlack(escapeHtml(name))} ${colorBlue('◆' + post.deviceId)} ${colorBlack(formatDateWithSecond(postDate))} ${isCreator}`;
            
            return `
                <div class="post" id="post${postNumber}">
                    <div class="post-header">${headerHtml}</div>
                    <div class="post-content">${content}</div>
                    ${mediaHtml}
                </div>
            `;
        }).join('');

        setTimeout(() => {
            const lastPost = container.querySelector('.post:last-child');
            if (lastPost) {
                lastPost.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
        }, 100);
    });
}

// 投稿送信（Firebase版）
async function submitPost() { // asyncキーワードを追加
    const name = document.getElementById('posterName').value.trim();
    savePosterName(name);

    const content = document.getElementById('postContent').value.trim();
    const files = currentSelectedFiles; // ここからファイルを取得

    if (!content && files.length === 0) { // 投稿内容かファイルがないと送信できない
        alert('内容を入力するか、画像/動画を選択してください');
        return;
    }
    
    const threadRef = database.ref(`threads/${currentThreadId}`);
    const threadSnapshot = await threadRef.once('value'); // awaitでPromiseの解決を待つ
    const thread = threadSnapshot.val();

    if (!thread) {
        alert('エラー: スレッドが見つかりません。');
        return;
    }
    if (thread.closed) {
        alert('このスレッドは終了しています');
        return;
    }

    // ファイルをStorageにアップロード
    const uploadedMedia = [];
    for (const file of files) {
        try {
            const mediaRef = storage.ref(`media/${currentThreadId}/${Date.now()}-${file.name}`);
            const snapshot = await mediaRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();
            uploadedMedia.push({
                url: downloadURL,
                type: file.type,
                name: file.name
            });
        } catch (error) {
            console.error("ファイルアップロードエラー:", error);
            alert("ファイルのアップロードに失敗しました。");
            return; // 失敗したら投稿を中止
        }
    }

    const postsRef = database.ref(`posts/${currentThreadId}`);
    postsRef.push({
        name: name,
        content: content,
        deviceId: deviceId,
        createdAt: new Date().toISOString(),
        isCreator: thread.creatorId === deviceId,
        media: uploadedMedia // アップロードされたメディアの情報を追加
    });

    const newPostCount = (thread.postCount || 0) + 1;
    const updates = {
        lastActivity: new Date().toISOString(),
        postCount: newPostCount
    };

    if (newPostCount >= 1000) {
        updates.closed = true;
        updates.closedAt = new Date().toISOString();
    }
    
    threadRef.update(updates);

    // フォームと選択ファイルのクリア
    document.getElementById('postForm').reset();
    document.getElementById('postContent').value = '';
    currentSelectedFiles = []; // 選択ファイルをクリア
    updateSelectedFilesDisplay(); // 表示を更新
    loadPosterName(); // 名前は保存されたものを再表示
}

// 1000件警告処理
function handleDeletionWarning(thread) {
    const warningEl = document.getElementById('deletionWarning');
    if (deletionTimerId) clearInterval(deletionTimerId);

    if (thread.closed && thread.postCount >= 1000 && thread.closedAt) {
        const deletionTime = new Date(new Date(thread.closedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
        function updateWarning() {
            const now = new Date();
            let diff = deletionTime - now;
            if (diff <= 0) {
                warningEl.textContent = 'このスレッドは完全に削除されました。';
                clearInterval(deletionTimerId);
                return;
            }
            const d = Math.floor(diff / (86400000));
            diff -= d * 86400000;
            const h = Math.floor(diff / (3600000));
            diff -= h * 3600000;
            const m = Math.floor(diff / (60000));
            diff -= m * 60000;
            const s = Math.floor(diff / 1000);
            warningEl.textContent = `このスレッドは1000を超えました。\nこのスレッドは残り、${d}日${h}時間${m}分${s}秒で完全に削除されます。`;
        }
        updateWarning();
        deletionTimerId = setInterval(updateWarning, 1000);
    } else {
        warningEl.textContent = '';
    }
}


// --- ファイル選択・デバイス判定関連 ---

// デバイスがモバイルかどうかを判定する関数[1]
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// ファイル選択ボタンをデバイスに応じて更新する関数[1]
function updateFileSelectionButtons() {
    const fileButtonsContainer = document.querySelector('.file-buttons');
    if (!fileButtonsContainer) return;

    fileButtonsContainer.innerHTML = ''; // 既存のボタンをクリア

    if (isMobile()) {
        // スマホ: 写真を撮る, 写真を選択, ファイルを選択
        fileButtonsContainer.innerHTML = `
            <button type="button" onclick="selectFiles('camera')">写真を撮る</button>
            <button type="button" onclick="selectFiles('gallery')">写真を選択</button>
            <button type="button" onclick="selectFiles('file')">ファイルを選択</button>
        `;
    } else {
        // PC: 写真を撮る, ファイルを選択
        fileButtonsContainer.innerHTML = `
            <button type="button" onclick="selectFiles('camera')">写真を撮る</button>
            <button type="button" onclick="selectFiles('file')">ファイルを選択</button>
        `;
    }
}

// ファイル選択処理
function selectFiles(type) {
    const input = document.getElementById('mediaFiles');
    
    // input要素の属性をリセット
    input.removeAttribute('capture');
    input.removeAttribute('accept');

    if (type === 'camera') {
        input.setAttribute('capture', 'camera');
        input.setAttribute('accept', 'image/*,video/*'); // 写真も動画も撮れるように
    } else if (type === 'gallery') {
        input.setAttribute('accept', 'image/*'); // 写真のみ
    } else { // type === 'file'
        input.setAttribute('accept', 'image/*,video/*'); // 画像も動画も選択可
    }
    
    input.click(); // 隠されたファイル入力フィールドをクリック

    input.onchange = function(event) {
        currentSelectedFiles = []; // 選択ファイルをリセット
        const files = event.target.files;
        for (let i = 0; i < Math.min(files.length, 5); i++) { // 最大5つまで
            currentSelectedFiles.push(files[i]);
        }
        updateSelectedFilesDisplay(); // 選択されたファイルの名前を表示
    };
}

// 選択ファイル表示更新
function updateSelectedFilesDisplay() {
    const container = document.getElementById('selectedFiles');
    if (currentSelectedFiles.length === 0) {
        container.innerHTML = '';
        return;
    }
    const fileList = currentSelectedFiles.map(file => file.name).join(', ');
    container.innerHTML = `選択中: ${fileList}`;
}


// --- UI/ユーティリティ関連 ---

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
