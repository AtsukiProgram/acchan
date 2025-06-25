// グローバル変数
let deviceId = '';
let currentThreadId = '';
let deletionTimerId = null; // 削除タイマーのIDを保持

// アプリケーション初期化
function initializeApp() {
    // 端末IDの生成・取得
    deviceId = getOrCreateDeviceId();
    
    // 古いデータの削除処理
    cleanupOldData();
    
    console.log('acchan初期化完了 - 端末ID:', deviceId);
}

// 端末ID生成・取得
function getOrCreateDeviceId() {
    let id = localStorage.getItem('acchan_device_id');
    if (!id) {
        // 8桁の英数字IDを生成
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        localStorage.setItem('acchan_device_id', id);
    }
    return id;
}

// 古いデータの削除
function cleanupOldData() {
    const now = new Date().getTime();
    const threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    
    const activeThreads = threads.filter(thread => {
        const lastActivity = new Date(thread.lastActivity).getTime();
        const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24);
        
        // 3週間無活動または1000件投稿で終了
        if (daysSinceActivity > 21 || thread.postCount >= 1000) {
            thread.closed = true;
            thread.closedAt = thread.closedAt || new Date().toISOString();
        }
        
        // 終了から1週間後に完全削除
        if (thread.closed) {
            const closedTime = new Date(thread.closedAt).getTime();
            const daysSinceClosed = (now - closedTime) / (1000 * 60 * 60 * 24);
            if (daysSinceClosed > 7) {
                // 投稿データも削除
                localStorage.removeItem(`acchan_posts_${thread.id}`);
                return false;
            }
        }
        
        return true;
    });
    
    localStorage.setItem('acchan_threads', JSON.stringify(activeThreads));
}

// スレッド一覧の読み込み
function loadThreadList() {
    const threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    const threadList = document.getElementById('threadList');
    
    if (threads.length === 0) {
        threadList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">まだスレッドがありません。「+」ボタンで新しいスレッドを作成してください。</div>';
        return;
    }
    
    // 最新活動順でソート
    threads.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    
    threadList.innerHTML = threads.map(thread => {
        const createdDate = new Date(thread.createdAt);
        const lastActivityDate = new Date(thread.lastActivity);
        const status = thread.closed ? '[終了]' : '';
        
        // 自分が作成したスレッドか判定
        const isCreator = (thread.creatorId === deviceId);
        
        // 【変更】削除ボタン（ゴミ箱の絵文字）表示HTML
        const deleteButton = isCreator ? `<span class="thread-delete-btn" onclick="deleteThread('${thread.id}', event)">🗑️</span>` : '';
        
        return `
            <div class="thread-item" style="${thread.closed ? 'opacity: 0.6; cursor: default;' : ''}">
                <div class="thread-info" onclick="${thread.closed ? '' : `openThread('${thread.id}')`}">
                    <div class="thread-title">${status}${escapeHtml(thread.title)}</div>
                    <div class="thread-meta">
                        作成: ${formatDate(createdDate)} | 最終更新: ${formatDate(lastActivityDate)}
                    </div>
                </div>
                <div class="thread-stats">
                    ${thread.postCount}件
                </div>
                ${deleteButton}
            </div>
        `;
    }).join('');
}

// スレッド削除関数
function deleteThread(threadId, event) {
    event.stopPropagation(); // 親のクリックイベント（スレッドを開く）を止める
    if (!confirm('このスレッドを削除しますか？\n（この操作は元に戻せません）')) return;
    
    // スレッド一覧から削除
    let threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    threads = threads.filter(t => t.id !== threadId);
    localStorage.setItem('acchan_threads', JSON.stringify(threads));
    
    // 投稿も削除
    localStorage.removeItem(`acchan_posts_${threadId}`);
    
    // 再描画
    loadThreadList();
}


// スレッド作成モーダル表示
function showCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'block';
}

// スレッド作成モーダル非表示
function hideCreateThreadModal() {
    document.getElementById('createThreadModal').style.display = 'none';
    document.getElementById('createThreadForm').reset();
}

// スレッド作成フォームイベント
document.addEventListener('DOMContentLoaded', function() {
    const createForm = document.getElementById('createThreadForm');
    if (createForm) {
        createForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createThread();
        });
    }
});

// スレッド作成
function createThread() {
    const title = document.getElementById('threadTitle').value.trim();
    if (!title) return;
    
    const thread = {
        id: generateId(),
        title: title,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        postCount: 0,
        creatorId: deviceId,
        closed: false
    };
    
    const threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    threads.push(thread);
    localStorage.setItem('acchan_threads', JSON.stringify(threads));
    
    hideCreateThreadModal();
    openThread(thread.id);
}

// スレッドを開く
function openThread(threadId) {
    window.location.href = `thread.html?id=${threadId}`;
}

// スレッド読み込み
function loadThread() {
    const params = new URLSearchParams(window.location.search);
    currentThreadId = params.get('id');
    
    if (!currentThreadId) {
        window.location.href = 'index.html';
        return;
    }
    
    const threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    const thread = threads.find(t => t.id === currentThreadId);
    
    if (!thread) {
        alert('スレッドが見つかりません');
        window.location.href = 'index.html';
        return;
    }
    
    document.getElementById('threadTitle').textContent = thread.title;
    document.title = `${thread.title} - acchan`;
    
    loadPosts(); // 初回ロード
    
    // 投稿フォームイベント
    const postForm = document.getElementById('postForm');
    if (postForm) {
        postForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitPost();
        });
    }

    // 1秒ごとに投稿一覧を自動更新するタイマー
    // 他の人の投稿をリアルタイムで見ることはできません。
    setInterval(loadPosts, 1000); 

    // 1000件到達時の警告とカウントダウン
    const warningEl = document.getElementById('deletionWarning');
    if (deletionTimerId) clearInterval(deletionTimerId); // 既存タイマーをクリア

    if (thread.closed && thread.postCount >= 1000 && thread.closedAt) {
        const deletionTime = new Date(new Date(thread.closedAt).getTime() + 7 * 24 * 60 * 60 * 1000); // 終了日時 + 7日

        function updateWarning() {
            const now = new Date();
            let diff = deletionTime - now;

            if (diff <= 0) {
                warningEl.textContent = 'このスレッドは完全に削除されました。';
                clearInterval(deletionTimerId);
                // ページをリロードしてスレッドリストに戻るなど、適切な処理を追加することも可能
                return;
            }
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            diff -= days * (1000 * 60 * 60 * 24);
            const hours = Math.floor(diff / (1000 * 60 * 60));
            diff -= hours * (1000 * 60 * 60);
            const minutes = Math.floor(diff / (1000 * 60));
            diff -= minutes * (1000 * 60);
            const seconds = Math.floor(diff / 1000);

            warningEl.textContent = `このスレッドは1000を超えました。\nこのスレッドは残り、${days}日${hours}時間${minutes}分${seconds}秒で完全に削除されます。`;
        }

        updateWarning(); // 初回表示
        deletionTimerId = setInterval(updateWarning, 1000); // 1秒ごとに更新
    } else {
        warningEl.textContent = ''; // 警告がない場合はクリア
    }
}

// 投稿読み込み
function loadPosts() {
    const posts = JSON.parse(localStorage.getItem(`acchan_posts_${currentThreadId}`) || '[]');
    const container = document.getElementById('postsContainer');
    
    // 【最適化】投稿数が変わらない場合はDOM更新をスキップ
    const currentPostElements = container.querySelectorAll('.post');
    if (posts.length === currentPostElements.length && posts.length > 0) {
        return;
    }

    if (posts.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">まだ投稿がありません。最初の投稿をしてみましょう！</div>';
        return;
    }
    
    container.innerHTML = posts.map((post, index) => {
        const postNumber = index + 1;
        const postDate = new Date(post.createdAt);
        const isCreator = post.isCreator ? colorBlue('[スレ主]') : ''; // 色分けを適用
        const name = post.name || '名前すらない淫夢';
        
        // 改行を<br>に変換
        let content = escapeHtml(post.content).replace(/\n/g, '<br>');
        content = processAnchors(content);
        
        let mediaHtml = '';
        if (post.media && post.media.length > 0) {
            mediaHtml = '<div class="post-media">' + 
                post.media.map(media => {
                    if (media.type.startsWith('image/')) {
                        return `<img src="${media.data}" alt="添付画像">`;
                    } else if (media.type.startsWith('video/')) {
                        return `<video controls><source src="${media.data}" type="${media.type}"></video>`;
                    }
                    return '';
                }).join('') + '</div>';
        }
        
        // 投稿ヘッダーの表示フォーマット
        const headerHtml = `
            ${colorGreen(postNumber + ':')}
            ${colorBlack(escapeHtml(name))} 
            ${colorBlue('◆' + post.deviceId)} 
            ${colorBlack(formatDateWithSecond(postDate))} 
            ${isCreator}
        `;

        return `
            <div class="post" id="post${postNumber}">
                <div class="post-header">
                    ${headerHtml}
                </div>
                <div class="post-content">${content}</div>
                ${mediaHtml}
            </div>
        `;
    }).join('');
}

// 投稿送信
function submitPost() {
    const name = document.getElementById('posterName').value.trim();
    const content = document.getElementById('postContent').value.trim();
    const files = document.getElementById('mediaFiles').files;
    
    if (!content) {
        alert('内容を入力してください');
        return;
    }
    
    // スレッド情報取得
    const threads = JSON.parse(localStorage.getItem('acchan_threads') || '[]');
    const thread = threads.find(t => t.id === currentThreadId);
    
    if (!thread) {
        alert('スレッドが見つかりません');
        return;
    }
    
    if (thread.closed) {
        alert('このスレッドは終了しています');
        return;
    }
    
    // ファイル処理
    const mediaPromises = [];
    for (let i = 0; i < Math.min(files.length, 5); i++) {
        mediaPromises.push(processFile(files[i]));
    }
    
    Promise.all(mediaPromises).then(mediaData => {
        const post = {
            id: generateId(),
            name: name,
            content: content,
            deviceId: deviceId,
            createdAt: new Date().toISOString(),
            isCreator: thread.creatorId === deviceId,
            media: mediaData.filter(m => m !== null)
        };
        
        // 投稿保存
        const posts = JSON.parse(localStorage.getItem(`acchan_posts_${currentThreadId}`) || '[]');
        posts.push(post);
        localStorage.setItem(`acchan_posts_${currentThreadId}`, JSON.stringify(posts));
        
        // スレッド情報更新
        thread.postCount = posts.length;
        thread.lastActivity = new Date().toISOString();
        
        // 1000件到達で終了
        if (posts.length >= 1000) {
            thread.closed = true;
            thread.closedAt = new Date().toISOString();
        }
        
        localStorage.setItem('acchan_threads', JSON.stringify(threads));
        
        // フォームリセット
        document.getElementById('postForm').reset();
        document.getElementById('selectedFiles').innerHTML = '';
        
        // 投稿リロード
        loadPosts();
        
        // 最新投稿にスクロール
        setTimeout(() => {
            const lastPost = document.querySelector('.post:last-child');
            if (lastPost) {
                lastPost.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);
    });
}

// ファイル処理
function processFile(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            resolve(null);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            resolve({
                type: file.type,
                data: e.target.result,
                name: file.name
            });
        };
        reader.onerror = function() {
            resolve(null);
        };
        reader.readAsDataURL(file);
    });
}

// ファイル選択
function selectFiles(type) {
    const input = document.getElementById('mediaFiles');
    
    if (type === 'camera') {
        input.capture = 'camera';
        input.accept = 'image/*';
    } else if (type === 'gallery') {
        input.removeAttribute('capture');
        input.accept = 'image/*';
    } else {
        input.removeAttribute('capture');
        input.accept = 'image/*,video/*';
    }
    
    input.click();
    
    input.addEventListener('change', function() {
        updateSelectedFiles();
    });
}

// 選択ファイル表示更新
function updateSelectedFiles() {
    const files = document.getElementById('mediaFiles').files;
    const container = document.getElementById('selectedFiles');
    
    if (files.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    const fileList = Array.from(files).slice(0, 5).map(file => file.name).join(', ');
    container.innerHTML = `選択中: ${fileList}${files.length > 5 ? ' (最初の5つのみ)' : ''}`;
}

// アンカー処理
function processAnchors(content) {
    return content.replace(/>>(\d+)/g, '<span class="anchor" onclick="scrollToPost($1)">>>$1</span>');
}

// 投稿へスクロール
function scrollToPost(postNumber) {
    const post = document.getElementById(`post${postNumber}`);
    if (post) {
        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
        post.style.backgroundColor = '#ffffcc';
        setTimeout(() => {
            post.style.backgroundColor = '';
        }, 2000);
    }
}

// ユーティリティ関数
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(date) {
    return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// 秒数まで表示するフォーマット関数
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
