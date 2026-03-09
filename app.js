// ============================================================
// Firebase 설정 - 아래 값을 본인의 Firebase 프로젝트 값으로 교체하세요
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCmyIOqc3Ah8Z1hPEYrxZCrU8kQlVvwyMk",
  authDomain: "wordpop-4ff1f.firebaseapp.com",
  projectId: "wordpop-4ff1f",
  storageBucket: "wordpop-4ff1f.firebasestorage.app",
  messagingSenderId: "594872839948",
  appId: "1:594872839948:web:504c5b48566bec459e2329"
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
let searchQuery = '';
let currentMemoWordId = null;
let quizMode = 'meaning';
let showReviewOnly = false;

// ============================================================
// 인증 상태 감시
// ============================================================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    try {
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
          applyUILanguage(currentUserData.language);
          showPage('main-page');
          loadUserWords();
        } else {
          showPage('pending-page');
        }
      } else {
        // 신규 사용자 - 구글 로그인이면 언어 선택 모달 표시
        const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
        if (isGoogle && !window._registerLang) {
          // 구글 신규 사용자: 언어 선택 모달 표시
          window._pendingNewUser = user;
          document.getElementById('lang-modal').style.display = 'flex';
        } else {
          await createNewUser(user, window._registerLang || 'ko');
        }
      }
    } catch (err) {
      console.error('Auth state error:', err);
      const msg = document.getElementById('auth-message');
      msg.textContent = 'Firestore 연결 오류: ' + err.message;
      msg.className = 'auth-message error';
      showPage('auth-page');
      auth.signOut();
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
  if (pageId === 'main-page') {
    renderCalendar();
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
    msg.textContent = '로그인 중...';
    msg.className = 'auth-message';
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    console.error('Login error:', e.code, e.message);
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
    msg.textContent = '회원가입 중...';
    msg.className = 'auth-message';
    const langRadio = document.querySelector('input[name="register-lang"]:checked');
    window._registerLang = langRadio ? langRadio.value : 'ko';
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // onAuthStateChanged에서 Firestore 문서 생성 처리
  } catch (e) {
    console.error('Register error:', e.code, e.message);
    msg.textContent = getAuthErrorMessage(e.code);
    msg.className = 'auth-message error';
  }
}

// 구글 신규 사용자 언어 선택 완료
async function selectGoogleUserLang(lang) {
  document.getElementById('lang-modal').style.display = 'none';
  const user = window._pendingNewUser;
  window._pendingNewUser = null;
  if (user) {
    await createNewUser(user, lang);
  }
}

// 신규 사용자 Firestore 문서 생성 공통 함수
async function createNewUser(user, selectedLang) {
  const usersSnapshot = await db.collection('users').get();
  const isFirstUser = usersSnapshot.empty;
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
    applyUILanguage(selectedLang);
    showPage('main-page');
    loadUserWords();
  } else {
    showPage('pending-page');
  }
}

async function handleGoogleLogin() {
  const msg = document.getElementById('auth-message');
  try {
    msg.textContent = '구글 로그인 중...';
    msg.className = 'auth-message';
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  } catch (e) {
    console.error('Google login error:', e.code, e.message);
    if (e.code === 'auth/popup-closed-by-user') {
      msg.textContent = '';
    } else {
      msg.textContent = '구글 로그인에 실패했습니다. 다시 시도해주세요.';
      msg.className = 'auth-message error';
    }
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

const UI_TEXT = {
  ko: {
    wordbookTitle: '나의 단어장',
    labelWordCount: '등록 단어',
    labelTotalClicks: '총 클릭',
    labelToday: '오늘 학습',
    placeholder: '영어 단어를 입력하세요...',
    addBtn: '추가',
    sortRecent: '최근 추가순',
    sortClicks: '많이 본 순',
    sortAlpha: '알파벳순',
    cardHint: '클릭하여 뜻 보기',
    emptyState: '단어를 추가해서 공부를 시작하세요!',
    searching: '단어 검색 중...',
    translating: '번역 중...',
    addSuccess: (w) => `"${w}" 추가 완료!`,
    duplicate: '이미 추가된 단어예요!',
    englishOnly: '영어 단어만 입력할 수 있어요!',
    notFound: '단어를 찾을 수 없어요. 철자를 확인해주세요!'
  },
  vi: {
    wordbookTitle: 'Từ điển của tôi',
    labelWordCount: 'Từ vựng',
    labelTotalClicks: 'Tổng lần nhấp',
    labelToday: 'Học hôm nay',
    placeholder: 'Nhập từ tiếng Anh...',
    addBtn: 'Thêm',
    sortRecent: 'Thêm gần đây',
    sortClicks: 'Xem nhiều nhất',
    sortAlpha: 'Theo bảng chữ cái',
    cardHint: 'Nhấp để xem nghĩa',
    emptyState: 'Hãy thêm từ để bắt đầu học!',
    searching: 'Đang tìm từ...',
    translating: 'Đang dịch...',
    addSuccess: (w) => `Đã thêm "${w}"!`,
    duplicate: 'Từ này đã được thêm rồi!',
    englishOnly: 'Chỉ nhập từ tiếng Anh thôi nhé!',
    notFound: 'Không tìm thấy từ. Hãy kiểm tra lại chính tả!'
  }
};

function applyUILanguage(lang) {
  const t = UI_TEXT[lang] || UI_TEXT.ko;
  const el = id => document.getElementById(id);
  el('wordbook-title').textContent = t.wordbookTitle;
  el('label-word-count').textContent = t.labelWordCount;
  el('label-total-clicks').textContent = t.labelTotalClicks;
  el('label-today').textContent = t.labelToday;
  el('word-input').placeholder = t.placeholder;
  el('add-btn-text').textContent = t.addBtn;
  el('sort-recent').textContent = t.sortRecent;
  el('sort-clicks').textContent = t.sortClicks;
  el('sort-alpha').textContent = t.sortAlpha;
}

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
    const def = m.definitions[0] || '';
    const t = def ? await translateText(def, targetLang) : '';
    translated.push({
      partOfSpeech: m.partOfSpeech,
      definitions: [t || def]
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
        // //로 시작하는 상대 URL을 https://로 정규화
        audioUrl = p.audio.startsWith('//') ? 'https:' + p.audio : p.audio;
        break;
      }
    }
  }

  // 뜻 정리 (품사 최대 2개, 뜻 1개씩)
  const meanings = entry.meanings.slice(0, 2).map(m => ({
    partOfSpeech: m.partOfSpeech,
    definitions: [m.definitions[0]?.definition].filter(Boolean),
  }));

  // 동의어 / 반의어
  const synonyms = [...new Set(
    entry.meanings.flatMap(m => [
      ...(m.synonyms || []),
      ...m.definitions.flatMap(d => d.synonyms || [])
    ])
  )].slice(0, 5);

  const antonyms = [...new Set(
    entry.meanings.flatMap(m => [
      ...(m.antonyms || []),
      ...m.definitions.flatMap(d => d.antonyms || [])
    ])
  )].slice(0, 5);

  return {
    word: entry.word,
    phonetic: entry.phonetic || (entry.phonetics?.[0]?.text) || '',
    audioUrl,
    meanings,
    synonyms,
    antonyms
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

  const t = UI_TEXT[getUserLang()] || UI_TEXT.ko;

  // 영어 단어 확인
  if (!/^[a-zA-Z\s-]+$/.test(word)) {
    msg.textContent = t.englishOnly;
    msg.className = 'input-message error';
    return;
  }

  // 중복 확인
  if (userWords.find(w => w.word === word)) {
    msg.textContent = t.duplicate;
    msg.className = 'input-message error';
    return;
  }

  msg.textContent = t.searching;
  msg.className = 'input-message';

  try {
    const wordData = await fetchWordData(word);

    // 사용자 언어로 번역
    const userLang = getUserLang();
    msg.textContent = t.translating;
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
      synonyms: wordData.synonyms || [],
      antonyms: wordData.antonyms || [],
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
    msg.textContent = t.addSuccess(wordData.word);
    msg.className = 'input-message success';
    setTimeout(() => { msg.textContent = ''; }, 2000);

    renderCards();
    updateMyStats();
  } catch (e) {
    msg.textContent = e.message || t.notFound;
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
  const search = searchQuery.trim().toLowerCase();
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

  // 복습 필요 단어 수 계산
  const reviewCount = userWords.filter(w => {
    const t = w.createdAt?.toDate?.()?.getTime() || new Date(w.createdAt || 0).getTime();
    return w.clickCount < 3 && (now - t) > threeDaysMs;
  }).length;

  const reviewNotice = document.getElementById('review-notice');
  const reviewCountEl = document.getElementById('review-count');
  if (reviewNotice) {
    reviewNotice.style.display = reviewCount > 0 ? '' : 'none';
    if (reviewCountEl) reviewCountEl.textContent = reviewCount;
  }

  let sorted = [...userWords];

  // 검색 필터
  if (search) {
    sorted = sorted.filter(w =>
      w.word.toLowerCase().includes(search) ||
      (w.translatedMeanings || []).some(m =>
        m.definitions.some(d => d.toLowerCase().includes(search))
      )
    );
  }

  // 복습 필터
  if (showReviewOnly) {
    sorted = sorted.filter(w => {
      const t = w.createdAt?.toDate?.()?.getTime() || new Date(w.createdAt || 0).getTime();
      return w.clickCount < 3 && (now - t) > threeDaysMs;
    });
  }

  // 정렬
  if (sort === 'clicks') sorted.sort((a, b) => b.clickCount - a.clickCount);
  else if (sort === 'alpha') sorted.sort((a, b) => a.word.localeCompare(b.word));

  if (sorted.length === 0) {
    const t = UI_TEXT[getUserLang()] || UI_TEXT.ko;
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>${search || showReviewOnly ? '검색 결과가 없어요!' : t.emptyState}</p>
      </div>`;
    return;
  }

  const lang = getUserLang();

  grid.innerHTML = sorted.map((w, i) => {
    const colorClass = CARD_COLORS[i % CARD_COLORS.length];
    const hasTrans = w.translatedMeanings && w.translatedMeanings.length > 0;

    const createdTime = w.createdAt?.toDate?.()?.getTime() || new Date(w.createdAt || 0).getTime();
    const needsReview = w.clickCount < 3 && (now - createdTime) > threeDaysMs;

    const meaningsHtml = w.meanings.map((m, mi) => {
      const transDefs = hasTrans && w.translatedMeanings[mi]
        ? w.translatedMeanings[mi].definitions : [];
      return `<div class="card-meaning-item">
        <span class="card-pos">${m.partOfSpeech}</span>
        ${m.definitions.map((d, di) => {
          const transText = transDefs[di] || '';
          return `<span class="card-def-en">${d}</span>
            ${transText ? `<div class="card-translated">${transText}</div>` : ''}`;
        }).join('')}
      </div>`;
    }).join('');

    const synsHtml = (w.synonyms?.length)
      ? `<div class="card-syns"><span class="card-syn-label">≈</span>${w.synonyms.map(s => `<span class="card-syn-chip">${s}</span>`).join('')}</div>` : '';
    const antsHtml = (w.antonyms?.length)
      ? `<div class="card-syns"><span class="card-syn-label ant-label">↔</span>${w.antonyms.map(s => `<span class="card-ant-chip">${s}</span>`).join('')}</div>` : '';

    const masteryLevel = w.clickCount >= 20 ? 3 : w.clickCount >= 10 ? 2 : w.clickCount >= 3 ? 1 : 0;
    const masteryStars = ['', '⭐', '⭐⭐', '⭐⭐⭐'][masteryLevel];

    const reviewBadge = needsReview ? `<span class="card-review-badge">🔴 복습</span>` : '';
    const memoBack = w.memo ? `<div class="card-memo">📝 ${w.memo}</div>` : '';
    const safeId = w.id.replace(/'/g, "\\'");

    return `
      <div class="flip-card ${colorClass}" id="card-${w.id}" onclick="flipCard('${safeId}')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <span class="card-click-badge">👀 ${w.clickCount}</span>
            ${masteryStars ? `<span class="card-mastery">${masteryStars}</span>` : ''}
            ${reviewBadge}
            <div class="card-word">${w.word}</div>
            <div class="card-phonetic">${w.phonetic}</div>
            <span class="card-hint">${(UI_TEXT[lang] || UI_TEXT.ko).cardHint}</span>
            <button class="card-memo-btn" onclick="event.stopPropagation(); openMemoModal('${safeId}')" title="메모">${w.memo ? '📝' : '🖊️'}</button>
          </div>
          <div class="flip-card-back">
            <div class="card-back-word">
              ${w.word}
              ${w.audioUrl ? `<button class="btn-audio" onclick="event.stopPropagation(); playAudio('${w.audioUrl}')" title="발음 듣기">🔊</button>` : ''}
            </div>
            <div class="card-back-phonetic">${w.phonetic}</div>
            <div class="card-meanings">${meaningsHtml}</div>
            ${synsHtml}${antsHtml}
            ${memoBack}
            <button class="card-delete-btn" onclick="event.stopPropagation(); deleteWord('${safeId}')" title="삭제">✕</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// 🔍 단어 검색
// ============================================================
function filterCards() {
  searchQuery = document.getElementById('search-input')?.value || '';
  renderCards();
}

// ============================================================
// 🔴 복습 필터
// ============================================================
function filterReview() {
  showReviewOnly = !showReviewOnly;
  const btn = document.querySelector('.btn-review-filter');
  if (btn) {
    btn.textContent = showReviewOnly
      ? (getUserLang() === 'vi' ? 'Xem tất cả' : '전체 보기')
      : (getUserLang() === 'vi' ? 'Chỉ từ cần ôn' : '복습만 보기');
    btn.classList.toggle('active', showReviewOnly);
  }
  renderCards();
}

// ============================================================
// 📅 학습 달력
// ============================================================
async function renderCalendar() {
  const calendarEl = document.getElementById('study-calendar');
  if (!calendarEl || !currentUser) return;

  const today = new Date();
  const days = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const activityMap = {};
  try {
    const snapshot = await db.collection('dailyActivity')
      .where('userId', '==', currentUser.uid)
      .get();
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.date && days.includes(data.date)) {
        activityMap[data.date] = data.clicks || 0;
      }
    });
  } catch (e) {
    console.error('Calendar load error:', e);
  }

  const todayStr = today.toISOString().split('T')[0];
  calendarEl.innerHTML = days.map(day => {
    const clicks = activityMap[day] || 0;
    const level = clicks >= 20 ? 4 : clicks >= 10 ? 3 : clicks >= 5 ? 2 : clicks >= 1 ? 1 : 0;
    const isToday = day === todayStr ? ' cal-today' : '';
    const shortDate = day.slice(5);
    return `<div class="cal-cell level-${level}${isToday}" title="${shortDate}: ${clicks}번 학습"></div>`;
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
    updateStreak();
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
  const lang = getUserLang();
  const msg = lang === 'vi'
    ? '이 단어를 졸업 처리할까요? 학습 기록은 정원에 계속 반영돼요!'
    : '이 단어를 졸업 처리할까요?\n학습 기록은 정원에 계속 반영돼요! 🎓';
  if (!confirm(msg)) return;

  try {
    const wordIndex = userWords.findIndex(w => w.id === wordId);
    const wordData = userWords[wordIndex];
    const clicks = wordData?.clickCount || 0;

    await db.collection('userWords').doc(wordId).delete();

    // 졸업 클릭 수 + 졸업 단어 수를 유저 문서에 누적
    await db.collection('users').doc(currentUser.uid).update({
      deletedWordsClicks: firebase.firestore.FieldValue.increment(clicks),
      graduatedCount: firebase.firestore.FieldValue.increment(1)
    }).catch(() => {});
    currentUserData.deletedWordsClicks = (currentUserData.deletedWordsClicks || 0) + clicks;
    currentUserData.graduatedCount = (currentUserData.graduatedCount || 0) + 1;

    if (wordData?.word) {
      await db.collection('globalWords').doc(wordData.word).update({
        totalAdded: firebase.firestore.FieldValue.increment(-1)
      }).catch(() => {});
    }

    userWords = userWords.filter(w => w.id !== wordId);
    renderCards();
    updateMyStats();
    showToast(lang === 'vi' ? '🎓 졸업!' : '🎓 졸업 처리됐어요!');
  } catch (e) {
    showToast('처리 중 오류가 발생했어요.');
  }
}

// ============================================================
// 📝 메모
// ============================================================
function openMemoModal(wordId) {
  currentMemoWordId = wordId;
  const word = userWords.find(w => w.id === wordId);
  if (!word) return;
  const lang = getUserLang();
  document.getElementById('memo-word-title').textContent = word.word;
  document.getElementById('memo-textarea').value = word.memo || '';
  document.getElementById('memo-textarea').placeholder =
    lang === 'vi' ? 'Viết ghi chú về từ này...' : '이 단어에 대한 메모를 남겨보세요...';
  document.getElementById('memo-modal').style.display = 'flex';
}

function closeMemoModal() {
  document.getElementById('memo-modal').style.display = 'none';
  currentMemoWordId = null;
}

async function saveMemo() {
  if (!currentMemoWordId) return;
  const memo = document.getElementById('memo-textarea').value.trim();
  const lang = getUserLang();
  try {
    await db.collection('userWords').doc(currentMemoWordId).update({ memo });
    const wordIndex = userWords.findIndex(w => w.id === currentMemoWordId);
    if (wordIndex !== -1) userWords[wordIndex].memo = memo;
    closeMemoModal();
    renderCards();
    showToast(memo
      ? (lang === 'vi' ? '메모가 저장됐어요! 📝' : '메모가 저장됐어요! 📝')
      : (lang === 'vi' ? '메모가 삭제됐어요!' : '메모가 삭제됐어요!'));
  } catch (e) {
    showToast(lang === 'vi' ? '메모 저장 중 오류!' : '메모 저장 중 오류가 발생했어요.');
  }
}

// ============================================================
// 유저 단어 로드
// ============================================================
async function loadUserWords() {
  try {
    const snapshot = await db.collection('userWords')
      .where('userId', '==', currentUser.uid)
      .get();

    userWords = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })).sort((a, b) => {
      // createdAt 기준 최신순 정렬 (Firestore Timestamp 또는 Date 모두 처리)
      const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
      const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
      return bTime - aTime;
    });

    renderCards();
    updateMyStats();
    renderCalendar();
  } catch (e) {
    console.error('단어 로드 실패:', e);
    showToast('단어를 불러오는 중 오류가 발생했어요. 새로고침해 주세요.');
  }
}

// ============================================================
// 내 통계 업데이트
// ============================================================
function updateMyStats() {
  document.getElementById('my-word-count').textContent = userWords.length;
  const totalClicks = userWords.reduce((sum, w) => sum + (w.clickCount || 0), 0);
  document.getElementById('my-click-count').textContent = totalClicks;

  const today = new Date().toISOString().split('T')[0];
  db.collection('dailyActivity').doc(`${currentUser.uid}_${today}`).get()
    .then(doc => {
      const clicks = doc.exists ? doc.data().clicks : 0;
      document.getElementById('my-today-count').textContent = clicks;
      updateDailyGoal(clicks);
    })
    .catch(() => {
      document.getElementById('my-today-count').textContent = 0;
      updateDailyGoal(0);
    });

  updateGarden();
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
// 🌱 화분 성장
// ============================================================
const PLANT_STAGES = [
  { min: 0,   emoji: '🪨',          ko: '텅빈 화분',  vi: 'Chậu trống'  },
  { min: 1,   emoji: '🌱',          ko: '씨앗',       vi: 'Hạt giống'   },
  { min: 20,  emoji: '🌿',          ko: '새싹',       vi: 'Chồi non'    },
  { min: 50,  emoji: '🌸',          ko: '꽃',         vi: 'Hoa nở'      },
  { min: 100, emoji: '🌳',          ko: '나무',       vi: 'Cây xanh'    },
  { min: 200, emoji: '🌲🌳🌲',     ko: '작은 숲',    vi: 'Rừng nhỏ'    },
  { min: 500, emoji: '🌲🌳🌲🌳🌲', ko: '울창한 숲',  vi: 'Rừng rậm'    }
];

function updateGarden() {
  const currentClicks = userWords.reduce((sum, w) => sum + (w.clickCount || 0), 0);
  const deletedClicks = currentUserData?.deletedWordsClicks || 0;
  const totalClicks = currentClicks + deletedClicks;
  const graduatedCount = currentUserData?.graduatedCount || 0;
  const lang = getUserLang();

  let stageIdx = 0;
  for (let i = PLANT_STAGES.length - 1; i >= 0; i--) {
    if (totalClicks >= PLANT_STAGES[i].min) { stageIdx = i; break; }
  }
  const stage = PLANT_STAGES[stageIdx];
  const next  = PLANT_STAGES[stageIdx + 1] || null;

  const plantEl = document.getElementById('garden-plant');
  const labelEl = document.getElementById('garden-label');
  const hintEl  = document.getElementById('garden-hint');
  const fillEl  = document.getElementById('garden-progress');
  const totalEl = document.getElementById('garden-total-clicks');
  if (!plantEl) return;

  plantEl.textContent = stage.emoji;
  labelEl.textContent = lang === 'vi' ? stage.vi : stage.ko;
  totalEl.textContent = lang === 'vi' ? `${totalClicks} lần` : `총 ${totalClicks}번`;

  if (next) {
    const pct = ((totalClicks - stage.min) / (next.min - stage.min)) * 100;
    fillEl.style.width = Math.min(pct, 100) + '%';
    const rem = next.min - totalClicks;
    const nextName = lang === 'vi' ? next.vi : next.ko;
    hintEl.textContent = lang === 'vi'
      ? `Học thêm ${rem} lần để thành "${nextName}"!`
      : `앞으로 ${rem}번 더 하면 "${nextName}"이 돼요!`;
  } else {
    fillEl.style.width = '100%';
    hintEl.textContent = lang === 'vi' ? 'Cấp độ tối đa! 🎉' : '최고 레벨 달성! 🎉';
  }

  // 졸업 단어 수 표시
  const graduatedEl = document.getElementById('garden-graduated');
  if (graduatedEl) {
    graduatedEl.textContent = graduatedCount > 0
      ? (lang === 'vi' ? `🎓 ${graduatedCount}개 단어 졸업` : `🎓 졸업 단어 ${graduatedCount}개`)
      : '';
  }
}

// ============================================================
// 🔥 스트릭 (연속 학습일)
// ============================================================
function updateStreak() {
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const lastDate  = currentUserData?.lastStudyDate;
  if (lastDate === today) return;

  let streak = currentUserData?.streakCount || 0;
  streak = (lastDate === yesterday) ? streak + 1 : 1;

  currentUserData.streakCount    = streak;
  currentUserData.lastStudyDate  = today;

  const el = document.getElementById('streak-count');
  if (el) el.textContent = streak;

  db.collection('users').doc(currentUser.uid)
    .update({ streakCount: streak, lastStudyDate: today })
    .catch(e => console.error('Streak update failed:', e));
}

// ============================================================
// 🎯 오늘의 목표
// ============================================================
function updateDailyGoal(todayClicks) {
  const goal = currentUserData?.dailyGoal || 10;
  const clicks = todayClicks || 0;
  const pct = Math.min((clicks / goal) * 100, 100);
  const fillEl = document.getElementById('goal-progress');
  const textEl = document.getElementById('goal-text');
  const wrapEl = document.getElementById('goal-bar-wrap');
  if (!fillEl) return;

  fillEl.style.width = pct + '%';
  textEl.textContent = `${Math.min(clicks, goal)} / ${goal}`;
  if (clicks >= goal && !wrapEl.classList.contains('goal-done')) {
    wrapEl.classList.add('goal-done');
    showToast(getUserLang() === 'vi' ? '🎉 Đạt mục tiêu hôm nay!' : '🎉 오늘 목표 달성!');
  }
}

// ============================================================
// 🧩 퀴즈 모드
// ============================================================
let quizWords = [], quizIdx = 0, quizScore = 0;

function startQuiz() {
  const lang = getUserLang();
  if (userWords.length < 4) {
    showToast(lang === 'vi' ? 'Cần ít nhất 4 từ để làm quiz!' : '단어가 4개 이상 있어야 퀴즈를 할 수 있어요!');
    return;
  }
  quizMode = 'meaning';
  quizWords = [...userWords].sort(() => Math.random() - 0.5).slice(0, Math.min(10, userWords.length));
  quizIdx = 0;
  quizScore = 0;
  showPage('quiz-page');
  renderQuizQuestion();
}

// ============================================================
// ✏️ 스펠링 퀴즈
// ============================================================
function startSpellingQuiz() {
  const lang = getUserLang();
  if (userWords.length < 1) {
    showToast(lang === 'vi' ? 'Cần ít nhất 1 từ!' : '단어가 1개 이상 있어야 스펠링 퀴즈를 할 수 있어요!');
    return;
  }
  quizMode = 'spelling';
  quizWords = [...userWords].sort(() => Math.random() - 0.5).slice(0, Math.min(10, userWords.length));
  quizIdx = 0;
  quizScore = 0;
  showPage('quiz-page');
  renderQuizQuestion();
}

function generateWrongSpellings(word) {
  const w = word.toLowerCase();
  const wrongs = new Set();

  // 방법 1: 인접한 두 글자 교환
  for (let i = 0; i < w.length - 1 && wrongs.size < 5; i++) {
    const arr = w.split('');
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    const wrong = arr.join('');
    if (wrong !== w) wrongs.add(wrong);
  }

  // 방법 2: 글자 중복
  for (let i = 0; i < w.length && wrongs.size < 5; i++) {
    const wrong = w.slice(0, i + 1) + w[i] + w.slice(i + 1);
    if (wrong !== w) wrongs.add(wrong);
  }

  // 방법 3: 글자 삭제
  for (let i = 0; i < w.length && wrongs.size < 5; i++) {
    const wrong = w.slice(0, i) + w.slice(i + 1);
    if (wrong !== w && wrong.length >= 2) wrongs.add(wrong);
  }

  return [...wrongs].slice(0, 3);
}

function renderQuizQuestion() {
  const w    = quizWords[quizIdx];
  const lang = getUserLang();
  document.getElementById('quiz-progress').textContent = `${quizIdx + 1} / ${quizWords.length}`;
  document.getElementById('quiz-score').textContent    = lang === 'vi' ? `Điểm: ${quizScore}` : `점수: ${quizScore}`;

  const labelEl = document.querySelector('.quiz-question-label');

  if (quizMode === 'spelling') {
    // 스펠링 퀴즈: 뜻 보고 올바른 스펠링 고르기
    if (labelEl) labelEl.textContent = lang === 'vi' ? '올바른 스펠링을 골라보세요!' : '올바른 스펠링을 골라보세요!';

    const meanings = w.translatedMeanings || w.meanings;
    const def = meanings?.[0]?.definitions?.[0] || w.meanings?.[0]?.definitions?.[0] || '';
    document.getElementById('quiz-question').textContent = def;

    const wrongSpellings = generateWrongSpellings(w.word);
    // 틀린 스펠링이 3개 미만이면 다른 단어의 스펠링으로 채우기
    const otherWords = userWords.filter(u => u.id !== w.id).map(u => u.word);
    while (wrongSpellings.length < 3 && otherWords.length > 0) {
      wrongSpellings.push(otherWords.splice(Math.floor(Math.random() * otherWords.length), 1)[0]);
    }
    const options = [w.word, ...wrongSpellings.slice(0, 3)].sort(() => Math.random() - 0.5);
    document.getElementById('quiz-options').innerHTML = options.map(spelling =>
      `<button class="quiz-btn" data-spelling="${spelling}" onclick="answerSpellingQuiz(this,'${w.word}')">${spelling}</button>`
    ).join('');
  } else {
    // 일반 퀴즈: 뜻 보고 단어 고르기
    if (labelEl) labelEl.textContent = lang === 'vi' ? 'Nhìn nghĩa, chọn từ đúng!' : '뜻을 보고 단어를 골라보세요!';

    const meanings = w.translatedMeanings || w.meanings;
    const def = meanings?.[0]?.definitions?.[0] || w.meanings?.[0]?.definitions?.[0] || '';
    document.getElementById('quiz-question').textContent = def;

    const others  = userWords.filter(u => u.id !== w.id).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [w, ...others].sort(() => Math.random() - 0.5);
    document.getElementById('quiz-options').innerHTML = options.map(o =>
      `<button class="quiz-btn" data-id="${o.id}" onclick="answerQuiz(this,'${w.id}')">${o.word}</button>`
    ).join('');
  }
}

function answerSpellingQuiz(btn, correctSpelling) {
  const isCorrect = btn.dataset.spelling === correctSpelling;
  if (isCorrect) quizScore++;

  document.querySelectorAll('.quiz-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.spelling === correctSpelling) b.classList.add('quiz-correct');
    else if (b === btn && !isCorrect) b.classList.add('quiz-wrong');
  });

  setTimeout(() => {
    quizIdx++;
    if (quizIdx < quizWords.length) renderQuizQuestion();
    else showQuizResult();
  }, 900);
}

function answerQuiz(btn, correctId) {
  const isCorrect = btn.dataset.id === correctId;
  if (isCorrect) quizScore++;

  document.querySelectorAll('.quiz-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.id === correctId) b.classList.add('quiz-correct');
    else if (b === btn && !isCorrect) b.classList.add('quiz-wrong');
  });

  setTimeout(() => {
    quizIdx++;
    if (quizIdx < quizWords.length) renderQuizQuestion();
    else showQuizResult();
  }, 900);
}

function showQuizResult() {
  const total = quizWords.length;
  const lang  = getUserLang();
  const pct   = Math.round((quizScore / total) * 100);
  const emoji = pct === 100 ? '🏆' : pct >= 70 ? '😊' : '😅';
  const msg   = pct === 100
    ? (lang === 'vi' ? 'Hoàn hảo!' : '완벽해요!')
    : pct >= 70
      ? (lang === 'vi' ? 'Làm tốt lắm!' : '잘했어요!')
      : (lang === 'vi' ? 'Cố gắng thêm nhé!' : '더 연습해봐요!');

  document.getElementById('quiz-question').innerHTML = `
    <div class="quiz-result-emoji">${emoji}</div>
    <div class="quiz-result-score">${quizScore} / ${total}</div>
    <div class="quiz-result-msg">${msg}</div>`;
  document.getElementById('quiz-options').innerHTML = `
    <button class="btn btn-primary" onclick="startQuiz()">${lang === 'vi' ? 'Làm lại' : '다시 하기'}</button>
    <button class="btn btn-secondary" onclick="showPage('main-page')">${lang === 'vi' ? 'Về từ điển' : '단어장으로'}</button>`;
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
