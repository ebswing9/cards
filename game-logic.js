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

// 카드 종류별 배경 그라데이션 (카드 시각 효과용)
const CARD_COLORS = {
  general: 'linear-gradient(155deg,#3E8EFF,#1E5FCC)',
  steal:   'linear-gradient(155deg,#FF5D73,#D63955)',
  silence: 'linear-gradient(155deg,#8F87B0,#5C5480)',
  pass:    'linear-gradient(155deg,#17C3B2,#0E8F82)',
  jump:    'linear-gradient(155deg,#FFB627,#C97F00)',
  turn:    'linear-gradient(155deg,#A78BFA,#6D28D9)',
  defense: 'linear-gradient(155deg,#3E8EFF,#2455B8)'
};

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

const DEFENSE_WINDOW_MS = 8000;
const JUDGE_CANCEL_MS = 5000;

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
function pushLog(group, text, playerId){
  group.log = group.log || [];
  group.log.push({ ts: Date.now(), text, playerId: playerId || null });
  if (group.log.length > 20) group.log = group.log.slice(-20);
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

  let direction = group.direction || 1;
  if (group.pendingFlip) direction = -direction;

  let newCurrent = group.judgeId;
  if (!newCurrent || order.indexOf(newCurrent) === -1) newCurrent = order[0];
  if (group.pendingSkip){
    newCurrent = nextInLine(order, newCurrent, direction) || newCurrent;
  }
  const newJudge = judgeFor(order, newCurrent, direction) || newCurrent;

  group.direction = direction;
  group.currentPlayerId = newCurrent;
  group.judgeId = newJudge;
  group.currentCard = null;
  group.pendingJudge = null;
  group.defenseWindow = null;
  group.stealTarget = null;
  group.pendingSkip = false;
  group.pendingFlip = false;
  group.turnFlags = { specialUsed: false, passUsed: false };
  group.turnNumber = (group.turnNumber || 0) + 1;
  group.turnStartedAt = Date.now();
  group.phase = (group.deck && group.deck.length > 0) ? 'pre_turn' : 'ended';
  return group;
}

function formatClock(ms){
  if (ms == null || isNaN(ms)) return '--:--';
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}
