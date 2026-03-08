// ============================================================
// Firebase 설정 - 아래 값을 본인의 Firebase 프로젝트 값으로 교체하세요
// ============================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============================================================
// 전역 상태
// ============================================================
let currentUser = null;
let currentUserData = null;
let userWords = [];
let audioCache = {};

// ============================================================
// 인증 상태 감시
// ============================================================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      currentUserData = userDoc.data();
      if (currentUserData.approved) {
        document.getElementById('user-name').textContent = currentUserData.displayName || '사용자';
        const lang = LANG_CONFIG[currentUserData.language] || LANG_CONFIG.ko;
        document.getElementById('user-lang-badge').textContent = lang.flag;
        if (currentUserData.role === 'admin') {
          document.getElementById('admin-btn').style.display = '';
        }
        showPage('main-page');
        loadUserWords();
      } else {
        showPage('pending-page');
      }
    } else {
      // 첫 번째 유저는 자동으로 관리자 + 승인
      const usersSnapshot = await db.collection('users').get();
      const isFirstUser = usersSnapshot.empty;
      const selectedLang = window._registerLang || 'ko';
      await db.collection('users').doc(user.uid).set({
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        language: selectedLang,
        approved: isFirstUser,
        role: isFirstUser ? 'admin' : 'user',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (isFirstUser) {
        currentUserData = { approved: true, role: 'admin', language: selectedLang, displayName: user.displayName || user.email.split('@')[0] };
        document.getElementById('user-name').textContent = currentUserData.displayName;
        document.getElementById('user-lang-badge').textContent = (LANG_CONFIG[selectedLang] || LANG_CONFIG.ko).flag;
        document.getElementById('admin-btn').style.display = '';
        showPage('main-page');
        loadUserWords();
      } else {
        showPage('pending-page');
      }
    }
  } else {
    currentUser = null;
    currentUserData = null;
    userWords = [];
    showPage('auth-page');
  }
});

// ============================================================
// 페이지 전환
// ============================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById(pageId).style.display = '';

  if (pageId === 'admin-page') {
    loadAdminData();
  }
}

// ============================================================
// 인증: 로그인 / 회원가입 / 로그아웃
// ============================================================
function toggleAuthForm() {
  const login = document.getElementById('login-form');
  const register = document.getElementById('register-form');
  const msg = document.getElementById('auth-message');
  msg.textContent = '';
  msg.className = 'auth-message';
  if (login.style.display === 'none') {
    login.style.display = '';
    register.style.display = 'none';
  } else {
    login.style.display = 'none';
    register.style.display = '';
  }
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('auth-message');

  if (!email || !password) {
    msg.textContent = '이메일과 비밀번호를 입력하세요.';
    msg.className = 'auth-message error';
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    msg.textContent = getAuthErrorMessage(e.code);
    msg.className = 'auth-message error';
  }
}

async function handleRegister() {
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const msg = document.getElementById('auth-message');

  if (!name || !email || !password) {
    msg.textContent = '모든 항목을 입력하세요.';
    msg.className = 'auth-message error';
    return;
  }

  if (password.length < 6) {
    msg.textContent = '비밀번호는 6자 이상이어야 합니다.';
    msg.className = 'auth-message error';
    return;
  }

  try {
    const langRadio = document.querySelector('input[name="register-lang"]:checked');
    window._registerLang = langRadio ? langRadio.value : 'ko';
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // onAuthStateChanged에서 Firestore 문서 생성 처리
  } catch (e) {
    msg.textContent = getAuthErrorMessage(e.code);
    msg.className = 'auth-message error';
  }
}

function handleLogout() {
  auth.signOut();
}

function getAuthErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
    'auth/invalid-email': '올바른 이메일 형식이 아닙니다.',
    'auth/user-not-found': '등록되지 않은 이메일입니다.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/too-many-requests': '너무 많은 시도가 있었습니다. 잠시 후 다시 시도하세요.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.'
  };
  return messages[code] || '오류가 발생했습니다. 다시 시도하세요.';
}

// ============================================================
// 번역 API (MyMemory - 무료)
// ============================================================
const LANG_CONFIG = {
  ko: { code: 'ko', flag: '🇰🇷', label: '한국어' },
  vi: { code: 'vi', flag: '🇻🇳', label: 'Tiếng Việt' }
};

function getUserLang() {
  return currentUserData?.language || 'ko';
}

async function translateText(text, targetLang) {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`
    );
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const translated = data.responseData.translatedText;
      // MyMemory가 번역 실패시 원문 그대로 반환하는 경우 체크
      if (translated.toUpperCase() === text.toUpperCase()) return null;
      return translated;
    }
    return null;
  } catch {
    return null;
  }
}

async function translateMeanings(meanings, targetLang) {
  const translated = [];
  for (const m of meanings) {
    const defs = [];
    for (const def of m.definitions) {
      const t = await translateText(def, targetLang);
      defs.push(t || def);
    }
    translated.push({
      partOfSpeech: m.partOfSpeech,
      definitions: defs
    });
  }
  return translated;
}

// ============================================================
// Dictionary API
// ============================================================
async function fetchWordData(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) throw new Error('단어를 찾을 수 없습니다.');
  const data = await res.json();
  const entry = data[0];

  // 발음 오디오 URL 찾기
  let audioUrl = '';
  if (entry.phonetics) {
    for (const p of entry.phonetics) {
      if (p.audio) {
        audioUrl = p.audio;
        break;
      }
    }
  }

  // 뜻 정리
  const meanings = entry.meanings.map(m => ({
    partOfSpeech: m.partOfSpeech,
    definitions: m.definitions.slice(0, 2).map(d => d.definition)
  }));

  return {
    word: entry.word,
    phonetic: entry.phonetic || (entry.phonetics?.[0]?.text) || '',
    audioUrl,
    meanings
  };
}

// ============================================================
// 단어 추가
// ============================================================
async function addWord() {
  const input = document.getElementById('word-input');
  const msg = document.getElementById('input-message');
  const word = input.value.trim().toLowerCase();

  if (!word) return;

  // 영어 단어 확인
  if (!/^[a-zA-Z\s-]+$/.test(word)) {
    msg.textContent = '영어 단어만 입력할 수 있어요!';
    msg.className = 'input-message error';
    return;
  }

  // 중복 확인
  if (userWords.find(w => w.word === word)) {
    msg.textContent = '이미 추가된 단어예요!';
    msg.className = 'input-message error';
    return;
  }

  msg.textContent = '단어 검색 중...';
  msg.className = 'input-message';

  try {
    const wordData = await fetchWordData(word);

    // 사용자 언어로 번역
    const userLang = getUserLang();
    msg.textContent = '번역 중...';
    const translatedMeanings = await translateMeanings(wordData.meanings, userLang);
    wordData.translatedMeanings = translatedMeanings;

    // Firestore에 저장
    const docRef = await db.collection('userWords').add({
      userId: currentUser.uid,
      word: wordData.word,
      phonetic: wordData.phonetic,
      audioUrl: wordData.audioUrl,
      meanings: wordData.meanings,
      translatedMeanings: translatedMeanings,
      language: userLang,
      clickCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 전체 단어 통계에도 기록
    const globalWordRef = db.collection('globalWords').doc(wordData.word);
    const globalDoc = await globalWordRef.get();
    if (globalDoc.exists) {
      await globalWordRef.update({
        totalAdded: firebase.firestore.FieldValue.increment(1)
      });
    } else {
      await globalWordRef.set({
        word: wordData.word,
        totalAdded: 1,
        totalClicks: 0
      });
    }

    wordData.id = docRef.id;
    wordData.clickCount = 0;
    wordData.createdAt = new Date();
    userWords.unshift(wordData);

    input.value = '';
    msg.textContent = `"${wordData.word}" 추가 완료!`;
    msg.className = 'input-message success';
    setTimeout(() => { msg.textContent = ''; }, 2000);

    renderCards();
    updateMyStats();
  } catch (e) {
    msg.textContent = e.message || '단어를 찾을 수 없어요. 철자를 확인해주세요!';
    msg.className = 'input-message error';
  }
}

// Enter 키로 단어 추가
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('word-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addWord();
  });
});

// ============================================================
// 단어 카드 렌더링
// ============================================================
const CARD_COLORS = ['card-color-1', 'card-color-2', 'card-color-3', 'card-color-4', 'card-color-5', 'card-color-6'];

function renderCards() {
  const grid = document.getElementById('cards-grid');
  const sort = document.getElementById('sort-select').value;

  let sorted = [...userWords];
  if (sort === 'clicks') sorted.sort((a, b) => b.clickCount - a.clickCount);
  else if (sort === 'alpha') sorted.sort((a, b) => a.word.localeCompare(b.word));
  // 'recent'은 이미 최신순

  if (sorted.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>단어를 추가해서 공부를 시작하세요!</p>
      </div>`;
    return;
  }

  grid.innerHTML = sorted.map((w, i) => {
    const colorClass = CARD_COLORS[i % CARD_COLORS.length];
    const hasTrans = w.translatedMeanings && w.translatedMeanings.length > 0;

    const meaningsHtml = w.meanings.map((m, mi) => {
      const transDefs = hasTrans && w.translatedMeanings[mi]
        ? w.translatedMeanings[mi].definitions : [];
      return `<div class="card-meaning-item">
        <span class="card-pos">${m.partOfSpeech}</span>
        ${m.definitions.map((d, di) => {
          const transText = transDefs[di] || '';
          return `<span>${d}</span>${transText ? `<div class="card-translated">${transText}</div>` : ''}`;
        }).join('')}
      </div>`;
    }).join('');

    return `
      <div class="flip-card ${colorClass}" id="card-${w.id}" onclick="flipCard('${w.id}')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <span class="card-click-badge">👀 ${w.clickCount}</span>
            <div class="card-word">${w.word}</div>
            <div class="card-phonetic">${w.phonetic}</div>
            <span class="card-hint">클릭하여 뜻 보기</span>
          </div>
          <div class="flip-card-back">
            <div class="card-back-word">
              ${w.word}
              ${w.audioUrl ? `<button class="btn-audio" onclick="event.stopPropagation(); playAudio('${w.audioUrl}')" title="발음 듣기">🔊</button>` : ''}
            </div>
            <div class="card-back-phonetic">${w.phonetic}</div>
            <div class="card-meanings">${meaningsHtml}</div>
            <button class="card-delete-btn" onclick="event.stopPropagation(); deleteWord('${w.id}')" title="삭제">✕</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// 카드 플립 & 클릭 카운트
// ============================================================
async function flipCard(wordId) {
  const card = document.getElementById(`card-${wordId}`);
  const wasFlipped = card.classList.contains('flipped');
  card.classList.toggle('flipped');

  // 앞면→뒷면으로 넘길 때만 카운트
  if (!wasFlipped) {
    const wordIndex = userWords.findIndex(w => w.id === wordId);
    if (wordIndex === -1) return;

    userWords[wordIndex].clickCount++;
    const newCount = userWords[wordIndex].clickCount;

    // 배지 업데이트
    const badge = card.querySelector('.card-click-badge');
    if (badge) badge.textContent = `👀 ${newCount}`;

    // Firestore 업데이트
    try {
      await db.collection('userWords').doc(wordId).update({
        clickCount: firebase.firestore.FieldValue.increment(1)
      });

      // 전체 통계 업데이트
      const word = userWords[wordIndex].word;
      await db.collection('globalWords').doc(word).update({
        totalClicks: firebase.firestore.FieldValue.increment(1)
      });

      // 오늘 학습 기록
      const today = new Date().toISOString().split('T')[0];
      const dailyRef = db.collection('dailyActivity').doc(`${currentUser.uid}_${today}`);
      const dailyDoc = await dailyRef.get();
      if (dailyDoc.exists) {
        await dailyRef.update({ clicks: firebase.firestore.FieldValue.increment(1) });
      } else {
        await dailyRef.set({
          userId: currentUser.uid,
          date: today,
          clicks: 1
        });
      }
    } catch (e) {
      console.error('클릭 카운트 업데이트 실패:', e);
    }

    updateMyStats();
  }
}

// ============================================================
// 발음 재생
// ============================================================
function playAudio(url) {
  if (!audioCache[url]) {
    audioCache[url] = new Audio(url);
  }
  audioCache[url].currentTime = 0;
  audioCache[url].play().catch(() => {
    showToast('발음을 재생할 수 없어요 😢');
  });
}

// ============================================================
// 단어 삭제
// ============================================================
async function deleteWord(wordId) {
  if (!confirm('이 단어를 삭제할까요?')) return;

  try {
    const wordIndex = userWords.findIndex(w => w.id === wordId);
    const word = userWords[wordIndex]?.word;

    await db.collection('userWords').doc(wordId).delete();

    if (word) {
      await db.collection('globalWords').doc(word).update({
        totalAdded: firebase.firestore.FieldValue.increment(-1)
      }).catch(() => {});
    }

    userWords = userWords.filter(w => w.id !== wordId);
    renderCards();
    updateMyStats();
    showToast('단어가 삭제되었어요!');
  } catch (e) {
    showToast('삭제 중 오류가 발생했어요.');
  }
}

// ============================================================
// 유저 단어 로드
// ============================================================
async function loadUserWords() {
  try {
    const snapshot = await db.collection('userWords')
      .where('userId', '==', currentUser.uid)
      .orderBy('createdAt', 'desc')
      .get();

    userWords = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderCards();
    updateMyStats();
  } catch (e) {
    console.error('단어 로드 실패:', e);
  }
}

// ============================================================
// 내 통계 업데이트
// ============================================================
function updateMyStats() {
  document.getElementById('my-word-count').textContent = userWords.length;
  const totalClicks = userWords.reduce((sum, w) => sum + (w.clickCount || 0), 0);
  document.getElementById('my-click-count').textContent = totalClicks;

  // 오늘 학습량 (오늘 클릭한 카드 수 - 간단히 dailyActivity에서 가져오기)
  const today = new Date().toISOString().split('T')[0];
  db.collection('dailyActivity').doc(`${currentUser.uid}_${today}`).get()
    .then(doc => {
      document.getElementById('my-today-count').textContent = doc.exists ? doc.data().clicks : 0;
    })
    .catch(() => {
      document.getElementById('my-today-count').textContent = 0;
    });
}

// ============================================================
// 관리자 기능
// ============================================================
function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`admin-${tab}`).style.display = '';
  btn.classList.add('active');

  if (tab === 'stats') loadAdminStats();
}

async function loadAdminData() {
  await loadPendingUsers();
  await loadAllUsers();
}

async function loadPendingUsers() {
  const container = document.getElementById('pending-users-list');
  try {
    const snapshot = await db.collection('users').where('approved', '==', false).get();
    if (snapshot.empty) {
      container.innerHTML = '<p class="empty-text">대기 중인 회원이 없습니다.</p>';
      return;
    }

    container.innerHTML = snapshot.docs.map(doc => {
      const u = doc.data();
      const date = u.createdAt?.toDate?.()?.toLocaleDateString('ko-KR') || '';
      const langFlag = (LANG_CONFIG[u.language] || LANG_CONFIG.ko).flag;
      return `
        <div class="user-item">
          <div class="user-info">
            <span class="user-info-name">${langFlag} ${u.displayName || '이름없음'}</span>
            <span class="user-info-email">${u.email}</span>
            <span class="user-info-date">가입: ${date}</span>
          </div>
          <div class="user-actions">
            <button class="btn btn-small btn-success" onclick="approveUser('${doc.id}')">승인</button>
            <button class="btn btn-small btn-danger" onclick="rejectUser('${doc.id}')">거절</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="empty-text">데이터를 불러올 수 없습니다.</p>';
  }
}

async function loadAllUsers() {
  const container = document.getElementById('all-users-list');
  try {
    const snapshot = await db.collection('users').get();
    if (snapshot.empty) {
      container.innerHTML = '<p class="empty-text">회원이 없습니다.</p>';
      return;
    }

    container.innerHTML = snapshot.docs.map(doc => {
      const u = doc.data();
      const date = u.createdAt?.toDate?.()?.toLocaleDateString('ko-KR') || '';
      const langFlag = (LANG_CONFIG[u.language] || LANG_CONFIG.ko).flag;
      const roleBadge = u.role === 'admin'
        ? '<span class="user-role-badge role-admin">관리자</span>'
        : u.approved
          ? '<span class="user-role-badge role-user">회원</span>'
          : '<span class="user-role-badge role-pending">대기</span>';
      return `
        <div class="user-item">
          <div class="user-info">
            <span class="user-info-name">${langFlag} ${u.displayName || '이름없음'} ${roleBadge}</span>
            <span class="user-info-email">${u.email}</span>
            <span class="user-info-date">가입: ${date}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="empty-text">데이터를 불러올 수 없습니다.</p>';
  }
}

async function approveUser(userId) {
  try {
    await db.collection('users').doc(userId).update({ approved: true });
    showToast('회원이 승인되었습니다!');
    loadAdminData();
  } catch (e) {
    showToast('승인 중 오류가 발생했습니다.');
  }
}

async function rejectUser(userId) {
  if (!confirm('이 회원을 거절하시겠습니까? 계정이 삭제됩니다.')) return;
  try {
    await db.collection('users').doc(userId).delete();
    showToast('회원이 거절되었습니다.');
    loadAdminData();
  } catch (e) {
    showToast('거절 중 오류가 발생했습니다.');
  }
}

// ============================================================
// 관리자 통계
// ============================================================
async function loadAdminStats() {
  await loadPopularWords();
  await loadUserActivityStats();
}

async function loadPopularWords() {
  const container = document.getElementById('popular-words');
  try {
    const snapshot = await db.collection('globalWords')
      .orderBy('totalClicks', 'desc')
      .limit(20)
      .get();

    if (snapshot.empty) {
      container.innerHTML = '<p class="empty-text">아직 데이터가 없습니다.</p>';
      return;
    }

    const maxClicks = snapshot.docs[0]?.data()?.totalClicks || 1;

    container.innerHTML = snapshot.docs.map((doc, i) => {
      const d = doc.data();
      const rankClass = i < 3 ? `rank-${i + 1}` : 'rank-other';
      const barWidth = Math.max(5, (d.totalClicks / maxClicks) * 100);
      return `
        <div class="stat-row">
          <span class="stat-rank ${rankClass}">${i + 1}</span>
          <span class="stat-word">${d.word}</span>
          <div class="stat-bar-container">
            <div class="stat-bar" style="width: ${barWidth}%"></div>
          </div>
          <span class="stat-count">${d.totalClicks}회</span>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="empty-text">통계를 불러올 수 없습니다.</p>';
  }
}

async function loadUserActivityStats() {
  const container = document.getElementById('user-stats');
  try {
    // 유저별 총 클릭수 계산
    const usersSnapshot = await db.collection('users').where('approved', '==', true).get();
    const userStats = [];

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const wordsSnapshot = await db.collection('userWords')
        .where('userId', '==', userDoc.id)
        .get();

      let totalClicks = 0;
      let wordCount = 0;
      wordsSnapshot.forEach(doc => {
        totalClicks += doc.data().clickCount || 0;
        wordCount++;
      });

      userStats.push({
        name: userData.displayName || '이름없음',
        email: userData.email,
        wordCount,
        totalClicks
      });
    }

    userStats.sort((a, b) => b.totalClicks - a.totalClicks);
    const maxClicks = userStats[0]?.totalClicks || 1;

    if (userStats.length === 0) {
      container.innerHTML = '<p class="empty-text">아직 데이터가 없습니다.</p>';
      return;
    }

    container.innerHTML = userStats.map((u, i) => {
      const rankClass = i < 3 ? `rank-${i + 1}` : 'rank-other';
      const barWidth = Math.max(5, (u.totalClicks / maxClicks) * 100);
      return `
        <div class="stat-row">
          <span class="stat-rank ${rankClass}">${i + 1}</span>
          <span class="stat-word">${u.name} <small style="color:#9ca3af">(단어 ${u.wordCount}개)</small></span>
          <div class="stat-bar-container">
            <div class="stat-bar" style="width: ${barWidth}%"></div>
          </div>
          <span class="stat-count">${u.totalClicks}회</span>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="empty-text">통계를 불러올 수 없습니다.</p>';
  }
}

// ============================================================
// 토스트 알림
// ============================================================
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
