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

// 카드 종류별 배경 그라데이션 - 전부 한 톤(파란 계열) 안에서 명도로만 구분해요
const CARD_COLORS = {
  general: 'linear-gradient(155deg,#F7FBFC,#B9D7EA)',
  steal:   'linear-gradient(155deg,#B9D7EA,#769FCD)',
  silence: 'linear-gradient(155deg,#E8EEF2,#C7D3DC)',
  pass:    'linear-gradient(155deg,#D6E6F2,#A9C9DC)',
  jump:    'linear-gradient(155deg,#D6E6F2,#9DBEDC)',
  turn:    'linear-gradient(155deg,#C9D4EC,#9AA9D4)',
  defense: 'linear-gradient(155deg,#B9D7EA,#769FCD)'
};

// 카드 종류별 진한 포인트 색 (아이콘 등에 사용) - 같은 계열에서 채도/명도만 다르게
const CARD_ACCENTS = {
  general: '#4A72A8',
  steal:   '#3C5A85',
  silence: '#8295A6',
  pass:    '#4A8FA8',
  jump:    '#5A7FB0',
  turn:    '#6A6FA8',
  defense: '#4A72A8'
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
