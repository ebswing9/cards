// ======================================================
// 카드 게임 규칙 로직 (순수 함수 모음)
// admin.html, student.html, db.js 에서 공통으로 사용해요.
// ======================================================

const CARD_LABELS = {
  general: '일반 카드',
  steal: '강탈 카드',
  silence: '침묵 카드',
  pass: '패스 카드',
  jump: '점프 카드',
  turn: '전환 카드',
  defense: '방어 카드'
};

const CARD_ICONS = {
  general: '📘',
  steal: '🎭',
  silence: '🤐',
  pass: '🎫',
  jump: '⏭️',
  turn: '🔀',
  defense: '🛡️'
};

// 손패에 남는(보유형) 카드 종류. 순서대로 화면에 표시해요.
const HAND_TYPES = ['pass', 'jump', 'turn', 'defense'];
const SCORE_TYPES = ['general', 'steal'];
const ALL_CARD_TYPES = ['general', 'steal', 'pass', 'jump', 'turn', 'defense'];

// 카드 종류별 배경 그라데이션 (styles.css 의 .t-종류 클래스와 같은 색이에요)
const CARD_COLORS = {
  general: 'linear-gradient(155deg,#F4FAFF,#B5D6F2)',
  steal: 'linear-gradient(155deg,#FFE3EA,#F7A8BB)',
  silence: 'linear-gradient(155deg,#F0F2F5,#CBD3DC)',
  pass: 'linear-gradient(155deg,#DDF6EC,#9ADBC0)',
  jump: 'linear-gradient(155deg,#E3EBFF,#A9BDF5)',
  turn: 'linear-gradient(155deg,#EDE6FF,#C2AEF2)',
  defense: 'linear-gradient(155deg,#D9ECFF,#8DB9EE)'
};

// 카드 종류별 진한 포인트 색 (아이콘 등에 사용)
const CARD_ACCENTS = {
  general: '#3F7BC0',
  steal: '#C2456A',
  silence: '#7A8794',
  pass: '#2E9C78',
  jump: '#4A68C9',
  turn: '#7B5BD0',
  defense: '#2F63A8'
};

// 카드 종류별 귀여운 SVG 아이콘 (currentColor로 색을 입혀요)
const CARD_SVG = {
  general: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" fill="currentColor" opacity=".85"/><path d="M20 5.5C20 4.67 19.33 4 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" fill="currentColor"/><path d="M12 4v16" stroke="#fff" stroke-width="1.2"/></svg>',
  steal: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="currentColor" opacity=".18"/><path d="M8 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.5 9.2 8 7M14.5 9.2 16 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="14.3" r="1.15" fill="currentColor"/><circle cx="15" cy="14.3" r="1.15" fill="currentColor"/></svg>',
  silence: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 10.5c0-3.3 2.7-6 6-6s6 2.7 6 6v3.2c0 3.3-2.7 6-6 6s-6-2.7-6-6v-3.2Z" fill="currentColor" opacity=".2"/><path d="M8.5 12h1.2M14.3 12h1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 16c1 .8 2 .8 3 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pass: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="7" width="17" height="10" rx="3" fill="currentColor" opacity=".22"/><path d="M9 7v10" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.2 2.2"/><circle cx="15.2" cy="12" r="1.6" fill="currentColor"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 6v12l8-6-8-6Z" fill="currentColor"/><path d="M14 6v12l7-6-7-6Z" fill="currentColor" opacity=".55"/></svg>',
  turn: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9h9a3 3 0 0 1 3 3v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 6.5 5.5 9 8 11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 15H9a3 3 0 0 1-3-3v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 12.5 18.5 15 16 17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  defense: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 6v5.2c0 4.4-3 7.6-7 9.3-4-1.7-7-4.9-7-9.3V6l7-2.5Z" fill="currentColor" opacity=".25"/><path d="M12 3.5 19 6v5.2c0 4.4-3 7.6-7 9.3-4-1.7-7-4.9-7-9.3V6l7-2.5Z" stroke="currentColor" stroke-width="1.6"/><path d="M9.3 12.2l1.9 1.9 3.6-3.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function cardIcon(type, size){
  size = size || 22;
  const svg = CARD_SVG[type] || CARD_SVG.general;
  const color = CARD_ACCENTS[type] || '#8F87B0';
  return `<span class="card-icon" style="width:${size}px;height:${size}px;color:${color};">${svg}</span>`;
}

// 관리자가 게임을 만들 때 기본으로 켜지는 특수카드 비율
// (문제 수 대비 비율, 최소 1장은 항상 보장)
const DEFAULT_CARD_CONFIG = {
  steal:   { enabled: true, ratio: 0.12 },
  pass:    { enabled: true, ratio: 0.06 },
  silence: { enabled: true, ratio: 0.03 },
  jump:    { enabled: true, ratio: 0.05 },
  turn:    { enabled: true, ratio: 0.03 },
  defense: { enabled: true, ratio: 0.06 }
};

// 모둠 간 경쟁 모드에서 팀을 구분하는 색
// (카드 색과 구분되도록 주황·청록·노랑·갈색·연두·먹색을 써요)
const TEAM_COLORS = ['#F26B21','#0E94B3','#F2B705','#8B5E3C','#7CB518','#3D4A5C'];

const DEFENSE_WINDOW_MS = 8000;
const JUDGE_CANCEL_MS = 3000; // 기본값 (게임 만들 때 관리자가 바꿀 수 있어요)

function emptyHand(){
  return { general: 0, steal: 0, pass: 0, jump: 0, turn: 0, defense: 0 };
}

function handTotal(hand){
  if (!hand) return 0;
  return Object.values(hand).reduce((a, b) => a + b, 0);
}

function handScore(hand){
  if (!hand) return 0;
  return (hand.general || 0) + (hand.steal || 0);
}

function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// 문제 수와 카드 설정을 바탕으로 필요한 문제 개수를 역산해서 무작위로 뽑아요.
function selectQuestionPool(allQuestions, config, deckCap){
  let qCount = allQuestions.length;
  if (deckCap){
    let ratioSum = 0;
    Object.values(config).forEach(c => { if (c.enabled) ratioSum += c.ratio; });
    const maxQ = Math.floor(deckCap / (1 + ratioSum));
    qCount = Math.min(qCount, Math.max(1, maxQ));
  }
  return shuffle(allQuestions).slice(0, qCount);
}

function computeSpecialCounts(questionCount, config){
  const counts = {};
  Object.entries(config).forEach(([type, c]) => {
    if (!c.enabled) return;
    counts[type] = Math.max(1, Math.round(questionCount * c.ratio));
  });
  return counts;
}

// 문제 목록 + 카드 설정 -> 실제 덱(카드 배열)을 만들어요.
function buildDeck(questionPool, config){
  const counts = computeSpecialCounts(questionPool.length, config);
  const stealCount = counts.steal || 0;
  const shuffledQ = shuffle(questionPool);
  const cards = shuffledQ.map((q, i) => ({
    type: i < stealCount ? 'steal' : 'general',
    questionId: q.id,
    text: q.text
  }));
  Object.entries(counts).forEach(([type, n]) => {
    if (type === 'steal') return;
    for (let i = 0; i < n; i++) cards.push({ type });
  });
  return shuffle(cards);
}

// 좌석표 -> 현재 참여 중인(제외되지 않은) 학생 순서 배열
function computeOrder(seats, excludedIds){
  excludedIds = excludedIds || {};
  return Object.keys(seats || {})
    .map(Number)
    .sort((a, b) => a - b)
    .map(seatNum => seats[seatNum])
    .filter(pid => pid && !excludedIds[pid]);
}

function nextInLine(order, currentId, direction){
  if (!order || order.length === 0) return null;
  const idx = order.indexOf(currentId);
  if (idx === -1) return order[0];
  const nextIdx = (idx + direction + order.length) % order.length;
  return order[nextIdx];
}

function judgeFor(order, currentId, direction){
  return nextInLine(order, currentId, direction);
}

// text는 "{name}님이 ..." 형태로, playerId가 있으면 화면에서 이름으로 치환해요.
// 카드 종류가 드러나면 안 되는 상황에서는 text에 종류를 넣지 않아야 해요.
// 로그는 최근 20개만 보관해요. 그래서 '개수'가 아니라 번호(id)로 새 알림을 구분해요.
function pushLog(group, text, playerId){
  group.log = group.log || [];
  group.logSeq = (group.logSeq || 0) + 1;
  const now = (typeof serverNow === 'function') ? serverNow() : Date.now(); // 기기 시계 차이 방지
  group.log.push({ id: group.logSeq, ts: now, text, playerId: playerId || null });
  if (group.log.length > 20) group.log = group.log.slice(-20);
}

// 문제별 판정 기록 (게임 종료 후 관리자 화면에서 '모두 모름 / 오답 많은 문제' 모아보기에 써요)
// kind: 'correct' | 'incorrect' | 'unknown'
function recordQuestionStat(group, card, kind){
  if (!card || !card.questionId) return;
  group.qstats = group.qstats || {};
  const s = group.qstats[card.questionId] || { text: card.text || '', correct: 0, incorrect: 0, unknown: 0 };
  s.text = card.text || s.text || '';
  s[kind] = (s[kind] || 0) + 1;
  group.qstats[card.questionId] = s;
}

// 플레이어별 통계 (강탈 성공 / 강탈당함 / 강탈 카드 정답)
// 손패에는 일반·강탈 구분 없이 '점수 카드'로만 쌓고, 강탈 횟수는 여기에 따로 기록해요.
function recordPlayerStat(group, playerId, key){
  if (!playerId) return;
  group.stats = group.stats || {};
  const s = group.stats[playerId] = group.stats[playerId] || {};
  s[key] = (s[key] || 0) + 1;
}

function pushSolved(group, playerId, questionText, cardType){
  group.solved = group.solved || {};
  group.solved[playerId] = group.solved[playerId] || [];
  group.solved[playerId].push({ text: questionText, type: cardType, ts: Date.now() });
  if (group.solved[playerId].length > 200) group.solved[playerId] = group.solved[playerId].slice(-200);
}

// 한 턴이 끝날 때 공통으로 호출: 대기 중인 건너뛰기/방향전환 효과를 적용하고
// 다음 플레이어·판정자를 정해요.
function applyEndTurn(group){
  const order = computeOrder(group.seats, group.excludedIds);
  if (order.length === 0){ group.phase = 'ended'; return group; }
  const now = (typeof serverNow === 'function') ? serverNow() : Date.now();

  // 모둠 간 경쟁: 팀마다 몇 번 턴을 했는지 기록해요 (시간이 끝난 뒤 '마지막 한 바퀴'에 써요)
  if (group.teamMode && group.currentPlayerId){
    group.turnsTaken = group.turnsTaken || {};
    group.turnsTaken[group.currentPlayerId] = (group.turnsTaken[group.currentPlayerId] || 0) + 1;
  }

  // 모둠 간 경쟁: 카드가 다 떨어졌는데 아직 턴을 덜 한 팀이 있으면, 예비 카드로 그 팀들만 마저 진행해요
  if (group.teamMode && (!group.deck || group.deck.length === 0) && !(group.finalRound && group.finalRound.active)){
    const taken = group.turnsTaken || {};
    const max = Math.max(0, ...order.map(id => taken[id] || 0));
    const n = order.length;
    const dirNext = (group.direction || 1) * (group.pendingFlip ? -1 : 1);
    const start = Math.max(0, order.indexOf(group.judgeId));
    const seq = [];
    for (let i = 0; i < n; i++) seq.push(order[(((start + i * dirNext) % n) + n) % n]);
    const need = seq.filter(id => (taken[id] || 0) < max);
    if (need.length > 0 && group.reserve && group.reserve.length > 0){
      group.deck = group.reserve;
      group.reserve = null;
      group.finalRound = { active: true, queue: need };
      group.finalReason = 'deck';
      pushLog(group, '카드가 다 떨어졌어요! 예비 카드로 마지막 한 바퀴를 진행해요');
    }
  }

  let direction = group.direction || 1;
  let newCurrent, newJudge;

  if (group.teamMode && group.finalRound && group.finalRound.active){
    // 시간이 끝난 뒤: 턴이 부족한 팀만 차례로 진행하고 끝내요
    const q = (group.finalRound.queue || []).filter(id => order.indexOf(id) !== -1);
    if (q.length === 0){
      group.currentCard = null; group.pendingJudge = null; group.defenseWindow = null; group.stealTarget = null;
      group.challenge = null; group.pendingSkip = false; group.pendingFlip = false;
      group.finalRound = { active: true, queue: [] };
      group.phase = 'ended';
      group.endReason = group.finalReason || 'time';
      pushLog(group, '마지막 한 바퀴가 끝났어요!');
      return group;
    }
    newCurrent = q.shift();
    group.finalRound = { active: true, queue: q };
    group.pendingSkip = false; group.pendingFlip = false;
    newJudge = judgeFor(order, newCurrent, direction) || newCurrent;
  } else {
    if (group.pendingFlip) direction = -direction;
    newCurrent = group.judgeId;
    if (!newCurrent || order.indexOf(newCurrent) === -1) newCurrent = order[0];
    if (group.pendingSkip){
      newCurrent = nextInLine(order, newCurrent, direction) || newCurrent;
    }
    newJudge = judgeFor(order, newCurrent, direction) || newCurrent;
  }

  group.direction = direction;
  group.currentPlayerId = newCurrent;
  group.judgeId = newJudge;
  group.currentCard = null;
  group.pendingJudge = null;
  group.defenseWindow = null;
  group.stealTarget = null;
  group.challenge = null;
  group.pendingSkip = false;
  group.pendingFlip = false;
  group.turnFlags = { specialUsed: false, passUsed: false };
  group.turnNumber = (group.turnNumber || 0) + 1;
  group.turnStartedAt = now;
  group.phase = (group.deck && group.deck.length > 0) ? 'pre_turn' : 'ended';
  if (group.phase === 'ended'){
    group.endReason = 'deck'; // 카드가 모두 소진되어 끝남
    pushLog(group, '카드가 모두 소진되어 게임이 끝났어요');
  }
  return group;
}

function formatClock(ms){
  if (ms == null || isNaN(ms)) return '--:--';
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}
