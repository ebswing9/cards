// ======================================================
// Firebase 프로젝트 설정
// ======================================================
// Firebase 콘솔(https://console.firebase.google.com)에서
// 새 프로젝트를 만든 뒤 "프로젝트 설정 > 일반" 탭에서
// 아래 값들을 확인해서 채워 넣으세요.
//
// ⚠️ 기존에 쓰시던 학급 대시보드 등 다른 앱과는
//    별도의 새 Firebase 프로젝트를 만드는 걸 추천해요.
//    (보안 규칙이 서로 섞이지 않도록)
//
// ⚠️ Realtime Database를 사용합니다. Firestore가 아니에요.
//    Firebase 콘솔 왼쪽 메뉴에서 "Realtime Database"를 만들고
//    나온 URL을 databaseURL에 넣으세요.
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyBUzkGC1_7HJ-rNftMwbWN118XAbaAzDMc",
  authDomain: "cards-6bf85.firebaseapp.com",
  databaseURL: "https://cards-6bf85-default-rtdb.firebaseio.com",
  projectId: "cards-6bf85",
  storageBucket: "cards-6bf85.firebasestorage.app",
  messagingSenderId: "727475924946",
  appId: "1:727475924946:web:02a4ee3338ae7407cae20b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
