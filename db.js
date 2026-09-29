// ======================================================
// Firebase 읽기/쓰기 함수 모음
// firebase-config.js, game-logic.js 를 먼저 불러온 뒤 사용해요.
// ======================================================

let serverTimeOffset = 0;
db.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
function serverNow(){ return Date.now() + serverTimeOffset; }

function groupRef(gameId, g){ return db.ref(`games/${gameId}/groups/${g}`); }
function metaRef(gameId){ return db.ref(`games/${gameId}/meta`); }
function playersRef(gameId){ return db.ref(`games/${gameId}/players`); }

// ---------- 학급 / 문제 세트 조회 (학생 화면용) ----------

async function findClassByCode(code){
  const snap = await db.ref('classes').once('value');
  const all = snap.val() || {};
  for (const [id, c] of Object.entries(all)){
    if (String(c.code) === String(code)) return { id, ...c };
  }
  return null;
}

async function findActiveGameForClass(classId){
  const snap = await db.ref('games').orderByChild('meta/classId').equalTo(classId).once('value');
  const all = snap.val() || {};
  let best = null;
  Object.entries(all).forEach(([id, g]) => {
    if (g.meta && g.meta.status !== 'ended'){
      if (!best || (g.meta.createdAt || 0) > (best.meta.createdAt || 0)) best = { id, ...g };
    }
  });
  return best;
}

// ---------- 게임 생성 / 진행 제어 (관리자용) ----------

async function createGame(params){
  // params: {classId, className, questionSetId, questionSetName, durationMinutes, groupCount, maxPerGroup, deckMode, cardConfig}
  const ref = db.ref('games').push();
  const groups = {};
  for (let g = 1; g <= params.groupCount; g++){
    groups[g] = {
      seats: {},
      phase: 'lobby',
      hands: {},
      log: [],
      excludedIds: {}
    };
  }
  await ref.set({
    meta: {
      classId: params.classId,
      className: params.className,
      questionSetId: params.questionSetId,
      questionSetName: params.questionSetName,
      durationMinutes: params.durationMinutes,
      groupCount: params.groupCount,
      maxPerGroup: params.maxPerGroup,
      deckMode: params.deckMode,
      cardConfig: params.cardConfig,
      status: 'lobby',
      createdAt: Date.now()
    },
    groups,
    players: {}
  });
  return ref.key;
}

async function startGame(gameId, allQuestions){
  const snap = await db.ref(`games/${gameId}`).once('value');
  const game = snap.val();
  if (!game) return;
  const cfg = game.meta.cardConfig;
  const deckCap = game.meta.deckCap || Math.max(15, game.meta.durationMinutes * 3);

  let sharedPool = null;
  if (game.meta.deckMode === 'common'){
    sharedPool = selectQuestionPool(allQuestions, cfg, deckCap);
  }

  const updates = {};
  Object.keys(game.groups || {}).forEach(g => {
    const seats = (game.groups[g] && game.groups[g].seats) || {};
    const activeCount = Object.keys(seats).length;
    const groupCfg = JSON.parse(JSON.stringify(cfg));
    if (activeCount <= 2 && groupCfg.turn) groupCfg.turn.enabled = false;

    const pool = sharedPool || selectQuestionPool(allQuestions, cfg, deckCap);
    const deck = buildDeck(pool, groupCfg);
    const order = computeOrder(seats, {});
    const first = order[0] || null;
    const judge = first ? (judgeFor(order, first, 1) || first) : null;

    updates[`groups/${g}/deck`] = deck;
    updates[`groups/${g}/direction`] = 1;
    updates[`groups/${g}/currentPlayerId`] = first;
    updates[`groups/${g}/judgeId`] = judge;
    updates[`groups/${g}/phase`] = order.length > 0 ? 'pre_turn' : 'ended';
    updates[`groups/${g}/turnNumber`] = 1;
    updates[`groups/${g}/turnFlags`] = { specialUsed: false, passUsed: false };
    updates[`groups/${g}/currentCard`] = null;
    updates[`groups/${g}/pendingJudge`] = null;
    updates[`groups/${g}/defenseWindow`] = null;
    const hands = {};
    order.forEach(pid => { hands[pid] = emptyHand(); });
    updates[`groups/${g}/hands`] = hands;
    updates[`groups/${g}/turnStartedAt`] = Date.now();
    updates[`groups/${g}/log`] = [{ ts: Date.now(), text: '게임이 시작됐어요' }];
  });

  await db.ref(`games/${gameId}`).update(updates);
  const startAt = firebase.database.ServerValue.TIMESTAMP;
  await metaRef(gameId).update({ status: 'playing', startAt });
  const s2 = await metaRef(gameId).child('startAt').once('value');
  const actualStart = s2.val();
  await metaRef(gameId).child('endAt').set(actualStart + game.meta.durationMinutes * 60 * 1000);
}

async function pauseGame(gameId){
  const snap = await metaRef(gameId).child('endAt').once('value');
  const endAt = snap.val();
  const remaining = Math.max(0, endAt - serverNow());
  await metaRef(gameId).update({ status: 'paused', remainingMsAtPause: remaining });
}

async function resumeGame(gameId){
  const snap = await metaRef(gameId).child('remainingMsAtPause').once('value');
  const remaining = snap.val() || 0;
  await metaRef(gameId).update({ status: 'playing', resumedAt: firebase.database.ServerValue.TIMESTAMP });
  const s2 = await metaRef(gameId).child('resumedAt').once('value');
  await metaRef(gameId).child('endAt').set(s2.val() + remaining);
}

function endGame(gameId){
  return metaRef(gameId).update({ status: 'ended', endedAt: Date.now() });
}

// ---------- 학생 입장 / 자리 선택 ----------

function joinPlayer(gameId, studentId, info){
  // info: {name, number}
  return playersRef(gameId).child(studentId).update({
    name: info.name, number: info.number, connected: true, joinedAt: Date.now()
  });
}

function setPlayerGroup(gameId, studentId, groupIndex){
  return playersRef(gameId).child(studentId).update({ groupIndex });
}

function setPlayerConnected(gameId, studentId, connected){
  return playersRef(gameId).child(studentId).update({ connected });
}

function pickSeat(gameId, g, seatNum, playerId){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    group.seats = group.seats || {};
    if (group.seats[seatNum] && group.seats[seatNum] !== playerId) return; // 이미 다른 사람이 선점
    Object.keys(group.seats).forEach(k => {
      if (group.seats[k] === playerId && Number(k) !== seatNum) delete group.seats[k];
    });
    group.seats[seatNum] = playerId;
    return group;
  });
}

// ---------- 턴 진행 ----------

function performDraw(group, playerId){
  if (!group.deck || group.deck.length === 0){ group.phase = 'ended'; return group; }
  const card = group.deck.pop();
  if (card.type === 'general' || card.type === 'steal'){
    group.currentCard = card;
    group.phase = 'awaiting_answer';
  } else if (card.type === 'silence'){
    pushLog(group, '침묵 카드가 나와 이번 턴을 쉬어요');
    group = applyEndTurn(group);
  } else {
    group.hands = group.hands || {};
    group.hands[playerId] = group.hands[playerId] || emptyHand();
    group.hands[playerId][card.type] = (group.hands[playerId][card.type] || 0) + 1;
    pushLog(group, `${CARD_LABELS[card.type]}를 획득했어요`);
    group = applyEndTurn(group);
  }
  return group;
}

function drawCard(gameId, g, playerId){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'pre_turn') return;
    if (group.currentPlayerId !== playerId) return;
    return performDraw(group, playerId);
  });
}

function usePassCard(gameId, g, playerId){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'awaiting_answer') return;
    if (group.currentPlayerId !== playerId) return;
    if (group.turnFlags && group.turnFlags.passUsed) return;
    const hand = (group.hands && group.hands[playerId]) || emptyHand();
    if (!hand.pass || hand.pass <= 0) return;
    hand.pass -= 1;
    group.hands[playerId] = hand;
    group.turnFlags = group.turnFlags || {};
    group.turnFlags.passUsed = true;
    group.deck = group.deck || [];
    group.deck.unshift(group.currentCard);
    group.currentCard = null;
    pushLog(group, '패스 카드를 사용했어요');
    return performDraw(group, playerId);
  });
}

function useSpecialCard(gameId, g, playerId, type){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'pre_turn') return;
    if (group.currentPlayerId !== playerId) return;
    if (group.turnFlags && group.turnFlags.specialUsed) return;
    const hand = group.hands && group.hands[playerId];
    if (!hand || !hand[type]) return;

    const order = computeOrder(group.seats, group.excludedIds);
    let targetIds = [];
    if (type === 'jump'){
      const t = nextInLine(order, playerId, group.direction || 1);
      if (t) targetIds = [t];
    } else if (type === 'turn'){
      if (order.length > 2) targetIds = order.filter(id => id !== playerId);
    } else {
      return;
    }

    hand[type] -= 1;
    group.hands[playerId] = hand;
    group.turnFlags = group.turnFlags || {};
    group.turnFlags.specialUsed = true;
    pushLog(group, `${CARD_LABELS[type]}를 사용했어요`);

    if (targetIds.length === 0) return group; // 대상이 없으면 효과 없이 소모만

    group.phase = 'awaiting_defense';
    group.defenseWindow = {
      effect: type, actorId: playerId, targetIds,
      deadline: serverNow() + DEFENSE_WINDOW_MS, responses: {}
    };
    return group;
  });
}

function respondDefense(gameId, g, playerId, use){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.defenseWindow) return group;
    if (!group.defenseWindow.targetIds.includes(playerId)) return;
    group.defenseWindow.responses = group.defenseWindow.responses || {};
    if (group.defenseWindow.responses[playerId] !== undefined) return; // 이미 응답함
    group.defenseWindow.responses[playerId] = use;
    return group;
  });
}

function resolveDefenseWindow(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.defenseWindow) return group;
    if (serverNow() < group.defenseWindow.deadline) return; // 아직 시간이 안 됨
    const dw = group.defenseWindow;
    const order = computeOrder(group.seats, group.excludedIds);

    if (dw.effect === 'steal'){
      const targetId = dw.targetIds[0];
      const targetHand = group.hands[targetId] || emptyHand();
      const used = dw.responses[targetId] === true && targetHand.defense > 0;
      if (used){
        targetHand.defense -= 1;
        group.hands[targetId] = targetHand;
        pushLog(group, '방어 카드로 강탈을 막았어요');
      } else {
        const entries = Object.entries(targetHand).filter(([, n]) => n > 0);
        const totalN = entries.reduce((s, [, n]) => s + n, 0);
        if (totalN > 0){
          let r = Math.random() * totalN;
          let chosen = entries[0][0];
          for (const [t, n] of entries){ if (r < n){ chosen = t; break; } r -= n; }
          targetHand[chosen] -= 1;
          group.hands[targetId] = targetHand;
          const actorHand = group.hands[dw.actorId] || emptyHand();
          actorHand[chosen] = (actorHand[chosen] || 0) + 1;
          group.hands[dw.actorId] = actorHand;
          pushLog(group, '카드 한 장을 강탈했어요');
        }
      }
      group = applyEndTurn(group);

    } else if (dw.effect === 'jump'){
      const targetId = dw.targetIds[0];
      const targetHand = group.hands[targetId] || emptyHand();
      const used = dw.responses[targetId] === true && targetHand.defense > 0;
      if (used){
        targetHand.defense -= 1;
        group.hands[targetId] = targetHand;
        group.pendingSkip = false;
        pushLog(group, '방어 카드로 점프를 막았어요');
      } else {
        group.pendingSkip = true;
        pushLog(group, '다음 사람의 턴이 건너뛰어질 예정이에요');
      }
      group.defenseWindow = null;
      group.phase = 'pre_turn';

    } else if (dw.effect === 'turn'){
      let winner = null;
      let cursor = dw.actorId;
      for (let i = 0; i < order.length; i++){
        cursor = nextInLine(order, cursor, group.direction || 1);
        if (cursor === dw.actorId) break;
        if (dw.responses[cursor] === true){
          const h = group.hands[cursor] || emptyHand();
          if (h.defense > 0){ winner = cursor; break; }
        }
      }
      if (winner){
        group.hands[winner].defense -= 1;
        group.pendingFlip = false;
        pushLog(group, '방어 카드로 전환을 막았어요');
      } else {
        group.pendingFlip = true;
        pushLog(group, '진행 방향이 반대로 바뀔 예정이에요');
      }
      group.defenseWindow = null;
      group.phase = 'pre_turn';
    }
    return group;
  });
}

// 판정 제안 (5초 취소 대기) -> 이후 resolveJudge 가 실제로 반영
function proposeJudge(gameId, g, judgeId, result){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'awaiting_answer') return;
    if (group.judgeId !== judgeId) return;
    if (!group.currentCard) return;
    group.pendingJudge = { result, judgeId, deadline: serverNow() + JUDGE_CANCEL_MS };
    group.phase = 'judge_pending';
    return group;
  });
}

function cancelJudge(gameId, g, judgeId){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.pendingJudge) return group;
    if (group.pendingJudge.judgeId !== judgeId) return;
    group.pendingJudge = null;
    group.phase = 'awaiting_answer';
    return group;
  });
}

function resolveJudge(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.pendingJudge) return group;
    if (serverNow() < group.pendingJudge.deadline) return;
    const { result } = group.pendingJudge;
    const card = group.currentCard;
    const playerId = group.currentPlayerId;
    if (!card){ group.pendingJudge = null; group.phase = 'pre_turn'; return group; }

    if (result === 'correct'){
      group.hands = group.hands || {};
      group.hands[playerId] = group.hands[playerId] || emptyHand();
      group.hands[playerId][card.type] += 1;
      pushLog(group, '정답! 카드를 획득했어요');
      if (card.type === 'steal'){
        const order = computeOrder(group.seats, group.excludedIds);
        const targets = order.filter(id => id !== playerId && handTotal(group.hands[id]) > 0);
        group.currentCard = null;
        group.pendingJudge = null;
        if (targets.length === 0){
          group = applyEndTurn(group);
        } else {
          group.phase = 'steal_pick';
        }
      } else {
        group.currentCard = null;
        group.pendingJudge = null;
        group = applyEndTurn(group);
      }
    } else if (result === 'incorrect'){
      group.deck = group.deck || [];
      group.deck.unshift(card);
      group.currentCard = null;
      group.pendingJudge = null;
      pushLog(group, '오답, 카드는 덱 맨 아래로 돌아갔어요');
      group = applyEndTurn(group);
    } else {
      group.currentCard = null;
      group.pendingJudge = null;
      pushLog(group, '모두 몰라서 카드가 제외됐어요');
      group = applyEndTurn(group);
    }
    return group;
  });
}

function chooseStealTarget(gameId, g, playerId, targetId){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'steal_pick') return;
    if (group.currentPlayerId !== playerId) return;
    const targetHand = group.hands && group.hands[targetId];
    if (!targetHand || handTotal(targetHand) === 0) return;
    group.phase = 'awaiting_defense';
    group.defenseWindow = {
      effect: 'steal', actorId: playerId, targetIds: [targetId],
      deadline: serverNow() + DEFENSE_WINDOW_MS, responses: {}
    };
    return group;
  });
}

// 시간이 다 됐을 때 자동으로 모둠을 종료 (턴 대기 상태일 때만 - 진행 중인 판정은 마치고 종료)
function endGroupIfTimeUp(gameId, g, endAt){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'pre_turn') return;
    if (endAt == null || serverNow() < endAt) return;
    group.phase = 'ended';
    pushLog(group, '시간이 끝나 게임을 종료해요');
    return group;
  });
}

// ---------- 관리자 비상 조작 ----------

function forceNextTurn(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    group.currentCard = null;
    group.pendingJudge = null;
    group.defenseWindow = null;
    group.phase = 'pre_turn';
    return applyEndTurn(group);
  });
}

function adjustHandCard(gameId, g, playerId, type, delta){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    group.hands = group.hands || {};
    group.hands[playerId] = group.hands[playerId] || emptyHand();
    group.hands[playerId][type] = Math.max(0, (group.hands[playerId][type] || 0) + delta);
    return group;
  });
}

function excludePlayer(gameId, g, playerId, excluded){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    group.excludedIds = group.excludedIds || {};
    if (excluded) group.excludedIds[playerId] = true; else delete group.excludedIds[playerId];
    const order = computeOrder(group.seats, group.excludedIds);
    if (order.length === 0){ group.phase = 'ended'; return group; }
    if (excluded && (group.currentPlayerId === playerId || group.judgeId === playerId)){
      group.currentCard = null;
      group.pendingJudge = null;
      group.defenseWindow = null;
      group.phase = 'pre_turn';
      return applyEndTurn(group);
    }
    return group;
  });
}

function restartGroup(gameId, g, allQuestions, cardConfig, deckMode, deckCap){
  return (async () => {
    const seatsSnap = await groupRef(gameId, g).child('seats').once('value');
    const seats = seatsSnap.val() || {};
    const activeCount = Object.keys(seats).length;
    const groupCfg = JSON.parse(JSON.stringify(cardConfig));
    if (activeCount <= 2 && groupCfg.turn) groupCfg.turn.enabled = false;
    const pool = selectQuestionPool(allQuestions, cardConfig, deckCap);
    const deck = buildDeck(pool, groupCfg);
    const order = computeOrder(seats, {});
    const first = order[0] || null;
    const judge = first ? (judgeFor(order, first, 1) || first) : null;
    const hands = {};
    order.forEach(pid => { hands[pid] = emptyHand(); });
    await groupRef(gameId, g).update({
      deck, direction: 1, currentPlayerId: first, judgeId: judge,
      phase: order.length > 0 ? 'pre_turn' : 'ended', turnNumber: 1,
      turnFlags: { specialUsed: false, passUsed: false },
      currentCard: null, pendingJudge: null, defenseWindow: null,
      excludedIds: {}, hands,
      log: [{ ts: Date.now(), text: '모둠이 다시 시작됐어요' }]
    });
  })();
}
