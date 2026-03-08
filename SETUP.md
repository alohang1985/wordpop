# WordPop - Firebase 설정 가이드

## 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: `wordpop`)
4. Google Analytics는 선택사항 (꺼도 됨)
5. **프로젝트 만들기** 클릭

## 2. 웹 앱 등록

1. 프로젝트 대시보드에서 **웹 아이콘 (`</>`)** 클릭
2. 앱 닉네임 입력 (예: `WordPop Web`)
3. **앱 등록** 클릭
4. 표시되는 `firebaseConfig` 값을 복사
5. `app.js` 파일 상단의 `firebaseConfig`를 복사한 값으로 교체:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "wordpop-xxxxx.firebaseapp.com",
  projectId: "wordpop-xxxxx",
  storageBucket: "wordpop-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## 3. Authentication 설정

1. 왼쪽 메뉴 **빌드** → **Authentication** 클릭
2. **시작하기** 클릭
3. **로그인 방법** 탭에서 **이메일/비밀번호** 활성화
4. **저장**

## 4. Firestore Database 설정

1. 왼쪽 메뉴 **빌드** → **Firestore Database** 클릭
2. **데이터베이스 만들기** 클릭
3. 위치: `asia-northeast3 (서울)` 선택
4. **테스트 모드에서 시작** 선택 (나중에 규칙 변경)
5. **만들기** 클릭

## 5. Firestore 보안 규칙 설정

Firestore → **규칙** 탭에서 아래 규칙으로 교체:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 로그인한 사용자만 읽기/쓰기
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /userWords/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      allow delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }

    match /globalWords/{word} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    match /dailyActivity/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

## 6. Firestore 인덱스 생성

Firestore → **인덱스** 탭에서 복합 인덱스 추가:

- **컬렉션**: `userWords`
- **필드 1**: `userId` (오름차순)
- **필드 2**: `createdAt` (내림차순)

> 인덱스가 없으면 브라우저 콘솔에 자동 생성 링크가 뜹니다. 그 링크를 클릭해도 됩니다.

## 7. 실행

로컬에서 바로 실행하려면:

```bash
# 방법 1: Python 간이 서버
cd 단어사이트
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속

# 방법 2: VS Code Live Server 확장 사용
# index.html 우클릭 → Open with Live Server
```

## 8. 첫 사용

1. 회원가입하면 **첫 번째 가입자가 자동으로 관리자**가 됩니다
2. 이후 가입자는 관리자 승인이 필요합니다
3. 관리자는 상단 **관리자** 버튼으로 대시보드 접근

## Firestore 컬렉션 구조

| 컬렉션 | 설명 |
|---|---|
| `users` | 회원 정보 (이름, 이메일, 승인여부, 역할) |
| `userWords` | 유저별 단어장 (단어, 뜻, 발음, 클릭수) |
| `globalWords` | 전체 단어 통계 (총 추가수, 총 클릭수) |
| `dailyActivity` | 일별 학습 활동 기록 |
