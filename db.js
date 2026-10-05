// ======================================================
// Firebase 읽기/쓰기 함수 모음
// firebase-config.js, game-logic.js 를 먼저 불러온 뒤 사용해요.
// ======================================================

let serverTimeOffset = 0;
db.ref('.info/serverTimeOffset').on('value', snap => { serverTimeOffset = snap.val() || 0; });
function serverNow(){ return Date.now() + serverTimeOffset; }

// 방어 확인창 마감 시각 (모둠 간 경쟁은 선생님이 대상 팀에게 물어보고 누르므로 10분)
function defenseDeadline(group){ return serverNow() + (group.teamMode ? 10 * 60 * 1000 : DEFENSE_WINDOW_MS); }

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
    if (g.meta && g.meta.status !== 'ended' && g.meta.mode !== 'team'){
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
  const isTeam = params.mode === 'team';
  const teams = {};
  const teamPlayers = {};
  if (isTeam){
    // 학급 하나가 게임 한 판, 모둠(팀)이 플레이어예요. 팀은 t1, t2, ... 라는 ID로 자리에 미리 앉혀둬요.
    const seats = {};
    for (let i = 1; i <= params.teamCount; i++){
      const id = 't' + i;
      const name = (params.teamNames && params.teamNames[i - 1]) || (i + '모둠');
      teams[id] = { name, color: TEAM_COLORS[(i - 1) % TEAM_COLORS.length], number: i };
      teamPlayers[id] = { name, number: i, groupIndex: 1, connected: true, isTeam: true };
      seats[i] = id;
    }
    groups[1] = {
      seats, phase: 'lobby', hands: {}, log: [], excludedIds: {},
      teamMode: true, challengeEnabled: !!params.challengeEnabled, turnTimerSec: params.turnTimerSec || 0
    };
  } else {
    for (let g = 1; g <= params.groupCount; g++){
      groups[g] = {
        seats: {},
        phase: 'lobby',
        hands: {},
        log: [],
        excludedIds: {}
      };
    }
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
      deckCap: params.deckCap || null,          // 비어 있으면 문제를 전부 사용
      judgeCancelSec: params.judgeCancelSec != null ? params.judgeCancelSec : 3,
      mode: isTeam ? 'team' : 'individual',
      teamCount: isTeam ? params.teamCount : null,
      challengeEnabled: isTeam ? !!params.challengeEnabled : null,
      turnTimerSec: isTeam ? (params.turnTimerSec || 0) : null,
      teams: isTeam ? teams : null,
      status: 'lobby',
      createdAt: Date.now()
    },
    groups,
    players: isTeam ? teamPlayers : {}
  });
  return ref.key;
}

async function startGame(gameId, allQuestions){
  const snap = await db.ref(`games/${gameId}`).once('value');
  const game = snap.val();
  if (!game) return;
  const cfg = game.meta.cardConfig;
  const deckCap = game.meta.deckCap || null; // null 이면 상한 없이 문제 전부 사용

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
    updates[`groups/${g}/turnStartedAt`] = serverNow();
    updates[`groups/${g}/turnsTaken`] = null;
    updates[`groups/${g}/finalRound`] = null;
    updates[`groups/${g}/challenge`] = null;
    updates[`groups/${g}/undo`] = null;
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

// 모둠을 잘못 골랐을 때 다시 고르기 (로비에서만 사용)
function clearPlayerGroup(gameId, studentId){
  return playersRef(gameId).child(studentId).update({ groupIndex: null });
}
// 자리를 비우고 다시 고르기
function releaseSeat(gameId, g, playerId){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    Object.keys(group.seats || {}).forEach(k => { if (group.seats[k] === playerId) delete group.seats[k]; });
    return group;
  });
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
    group.lastSilence = { playerId, ts: serverNow() }; // 학생 화면에서 전체 화면 효과로 보여줘요
    group = applyEndTurn(group);
  } else {
    group.hands = group.hands || {};
    group.hands[playerId] = group.hands[playerId] || emptyHand();
    group.hands[playerId][card.type] = (group.hands[playerId][card.type] || 0) + 1;
    group.lastDraw = { playerId, type: card.type, ts: serverNow() }; // 뽑은 본인 화면에서만 사용
    pushLog(group, '{name}님이 카드를 뽑았어요', playerId);
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
    pushLog(group, '{name}님이 패스 카드를 사용했어요', playerId);
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
    pushLog(group, `{name}님이 ${CARD_LABELS[type]}를 사용했어요`, playerId);

    if (targetIds.length === 0) return group; // 대상이 없으면 효과 없이 소모만

    group.phase = 'awaiting_defense';
    group.defenseWindow = {
      effect: type, actorId: playerId, targetIds,
      deadline: defenseDeadline(group), responses: {}
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
    // 대상자 전원이 응답했으면 시간이 남아도 바로 처리해요
    const resp0 = group.defenseWindow.responses || {};
    const allResponded = (group.defenseWindow.targetIds || []).every(id => resp0[id] !== undefined);
    if (!allResponded && serverNow() < group.defenseWindow.deadline) return; // 아직 시간이 안 됨
    const dw = group.defenseWindow;
    const responses = dw.responses || {}; // Firebase 는 빈 객체를 저장하지 않아서 undefined 일 수 있어요
    const order = computeOrder(group.seats, group.excludedIds);

    if (dw.effect === 'steal'){
      const targetId = dw.targetIds[0];
      const targetHand = group.hands[targetId] || emptyHand();
      const used = responses[targetId] === true && targetHand.defense > 0;
      if (used){
        targetHand.defense -= 1;
        group.hands[targetId] = targetHand;
        pushLog(group, '{name}님이 방어 카드로 강탈을 막았어요', targetId);
        group.lastEffect = { effect: 'steal', success: false, actorId: dw.actorId, targetId, ts: serverNow() };
      } else {
        const entries = Object.entries(targetHand).filter(([, n]) => n > 0);
        const totalN = entries.reduce((s, [, n]) => s + n, 0);
        let chosen = null;
        if (totalN > 0){
          let r = Math.random() * totalN;
          chosen = entries[0][0];
          for (const [t, n] of entries){ if (r < n){ chosen = t; break; } r -= n; }
          targetHand[chosen] -= 1;
          group.hands[targetId] = targetHand;
          const actorHand = group.hands[dw.actorId] || emptyHand();
          actorHand[chosen] = (actorHand[chosen] || 0) + 1;
          group.hands[dw.actorId] = actorHand;
          recordPlayerStat(group, dw.actorId, 'steals');
          recordPlayerStat(group, targetId, 'stolen');
        }
        group.lastEffect = { effect: 'steal', success: true, cardType: chosen, actorId: dw.actorId, targetId, ts: serverNow() };
      }
      group = applyEndTurn(group);

    } else if (dw.effect === 'jump'){
      const targetId = dw.targetIds[0];
      const targetHand = group.hands[targetId] || emptyHand();
      const used = responses[targetId] === true && targetHand.defense > 0;
      if (used){
        targetHand.defense -= 1;
        group.hands[targetId] = targetHand;
        group.pendingSkip = false;
        pushLog(group, '{name}님이 방어 카드로 점프를 막았어요', targetId);
        group.lastEffect = { effect: 'jump', success: false, actorId: dw.actorId, targetId, ts: serverNow() };
      } else {
        group.pendingSkip = true;
        pushLog(group, '다음 사람의 턴이 건너뛰어질 예정이에요');
        group.lastEffect = { effect: 'jump', success: true, actorId: dw.actorId, targetId, ts: serverNow() };
      }
      group.defenseWindow = null;
      group.phase = 'pre_turn';

    } else if (dw.effect === 'turn'){
      let winner = null;
      let cursor = dw.actorId;
      for (let i = 0; i < order.length; i++){
        cursor = nextInLine(order, cursor, group.direction || 1);
        if (cursor === dw.actorId) break;
        if (responses[cursor] === true){
          const h = group.hands[cursor] || emptyHand();
          if (h.defense > 0){ winner = cursor; break; }
        }
      }
      if (winner){
        group.hands[winner].defense -= 1;
        group.pendingFlip = false;
        pushLog(group, '{name}님이 방어 카드로 전환을 막았어요', winner);
        group.lastEffect = { effect: 'turn', success: false, actorId: dw.actorId, targetId: winner, ts: serverNow() };
      } else {
        group.pendingFlip = true;
        pushLog(group, '진행 방향이 반대로 바뀔 예정이에요');
        group.lastEffect = { effect: 'turn', success: true, actorId: dw.actorId, ts: serverNow() };
      }
      group.defenseWindow = null;
      group.phase = 'pre_turn';
    }
    return group;
  });
}

// ---------- 관리자: 모둠 수동 배치 ----------

async function adminMovePlayer(gameId, playerId, fromGroup, toGroup, toSeat){
  if (fromGroup && String(fromGroup) !== String(toGroup)){
    await groupRef(gameId, fromGroup).transaction(group => {
      if (!group) return group;
      group.seats = group.seats || {};
      Object.keys(group.seats).forEach(k => { if (group.seats[k] === playerId) delete group.seats[k]; });
      return group;
    });
  }
  await setPlayerGroup(gameId, playerId, toGroup);
  await pickSeat(gameId, toGroup, toSeat, playerId);
}

// 두 학생의 자리를 서로 맞바꿔요. pickSeat을 두 번 쓰면 "서로 상대 자리가 빌 때까지
// 기다리다 둘 다 실패"하는 교착 상태가 생기므로, 한 번의 다중 경로 update로 한 번에 바꿔요.
async function swapPlayers(gameId, aId, aGroup, aSeat, bId, bGroup, bSeat){
  const updates = {};
  updates[`groups/${aGroup}/seats/${aSeat}`] = bId;
  updates[`groups/${bGroup}/seats/${bSeat}`] = aId;
  updates[`players/${aId}/groupIndex`] = bGroup;
  updates[`players/${bId}/groupIndex`] = aGroup;
  await db.ref(`games/${gameId}`).update(updates);
}

// ---------- 학생 PIN ----------

function getStudentPin(classId, studentId){
  return db.ref(`rosters/${classId}/${studentId}/pin`).once('value').then(s => s.val());
}
function setStudentPin(classId, studentId, pin){
  return db.ref(`rosters/${classId}/${studentId}/pin`).set(pin);
}
function resetStudentPin(classId, studentId){
  return db.ref(`rosters/${classId}/${studentId}/pin`).remove();
}

// ---------- 관리자 PIN ----------

function getAdminPin(){
  return db.ref('settings/adminPin').once('value').then(s => s.val());
}
function setAdminPin(pin){
  return db.ref('settings/adminPin').set(pin);
}

// 판정 제안 (5초 취소 대기) -> 이후 resolveJudge 가 실제로 반영
function proposeJudge(gameId, g, judgeId, result, cancelMs){
  return groupRef(gameId, g).transaction(group => {
    if (!group) return group;
    if (group.phase !== 'awaiting_answer' && group.phase !== 'challenge_answer') return;
    if (group.judgeId !== judgeId) return;
    if (!group.currentCard) return;
    group.pendingJudge = { result, judgeId, prevPhase: group.phase, deadline: serverNow() + (cancelMs != null ? cancelMs : JUDGE_CANCEL_MS) };
    group.phase = 'judge_pending';
    return group;
  });
}

function cancelJudge(gameId, g, judgeId){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.pendingJudge) return group;
    if (group.pendingJudge.judgeId !== judgeId) return;
    group.phase = group.pendingJudge.prevPhase || 'awaiting_answer';
    group.pendingJudge = null;
    return group;
  });
}

function resolveJudge(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.pendingJudge) return group;
    if (serverNow() < group.pendingJudge.deadline) return;
    const { result } = group.pendingJudge;
    const card = group.currentCard;
    // 도전 중이면 점수를 받는 사람은 도전한 팀이에요
    const ch = (group.challenge && group.challenge.challengerId) ? group.challenge : null;
    const playerId = ch ? ch.challengerId : group.currentPlayerId;
    if (!card){ group.pendingJudge = null; group.phase = 'pre_turn'; return group; }

    if (result === 'correct'){
      group.hands = group.hands || {};
      group.hands[playerId] = group.hands[playerId] || emptyHand();
      // 강탈 카드도 획득하면 '점수 카드'(일반)로 합쳐요. 강탈 횟수는 통계로 따로 남겨요.
      group.hands[playerId][card.type === 'steal' ? 'general' : card.type] += 1;
      if (card.type === 'steal') recordPlayerStat(group, playerId, 'stealSolved');
      pushLog(group, ch ? '{name}님이 도전해서 정답을 맞혔어요' : '{name}님이 정답을 맞혀 카드를 획득했어요', playerId);
      pushSolved(group, playerId, card.text, card.type);
      recordQuestionStat(group, card, 'correct');
      if (card.type === 'steal' && !ch){ // 도전으로 맞힌 강탈 카드는 점수만 얻고 강탈 효과는 없어요
        const order = computeOrder(group.seats, group.excludedIds);
        const targets = order.filter(id => id !== playerId && handTotal(group.hands[id]) > 0);
        group.currentCard = null;
        group.pendingJudge = null;
        if (targets.length === 0){
          // 아무도 카드가 없어서 강탈할 수 없는 경우: 전원에게 알려줘요
          group.lastEffect = { effect: 'steal', success: true, cardType: null, actorId: playerId, targetId: null, ts: serverNow() };
          group = applyEndTurn(group);
        } else {
          group.lastStealReveal = { playerId, ts: serverNow() }; // 전원에게 '사실은 강탈 카드였어요' 효과
          group.phase = 'steal_pick';
        }
      } else {
        group.currentCard = null;
        group.pendingJudge = null;
        group = applyEndTurn(group);
      }
    } else if (result === 'incorrect'){
      recordQuestionStat(group, card, 'incorrect');
      group.pendingJudge = null;
      // 모둠 간 경쟁 + 도전 규칙: 아직 도전하지 않은 팀이 있으면 도전할 팀을 고르게 해요
      let remaining = [];
      if (group.teamMode && group.challengeEnabled){
        const tried = ch ? (group.challenge.tried || []) : [group.currentPlayerId];
        const order = computeOrder(group.seats, group.excludedIds);
        remaining = order.filter(id => tried.indexOf(id) === -1);
        if (remaining.length > 0){
          group.challenge = { tried, challengerId: null };
          group.phase = 'challenge_pick';
          pushLog(group, '{name}님이 오답! 도전할 모둠을 골라요', playerId);
          return group;
        }
      }
      group.deck = group.deck || [];
      group.deck.unshift(card);
      group.currentCard = null;
      group.challenge = null;
      pushLog(group, ch ? '도전도 오답, 카드는 덱 맨 아래로 돌아갔어요' : '{name}님이 오답, 카드는 덱 맨 아래로 돌아갔어요', ch ? null : playerId);
      group = applyEndTurn(group);
    } else {
      group.currentCard = null;
      group.pendingJudge = null;
      group.challenge = null;
      recordQuestionStat(group, card, 'unknown');
      pushLog(group, '{name}님의 문제, 모두 몰라서 카드가 제외됐어요', playerId);
      group = applyEndTurn(group);
    }
    return group;
  });
}

// ---------- 모둠 간 경쟁: 도전 / 되돌리기 ----------

// 오답 뒤에 도전할 팀을 정해요 (오프라인에서 가위바위보로 정한 팀)
function startChallenge(gameId, g, teamId){
  return groupRef(gameId, g).transaction(group => {
    if (!group || group.phase !== 'challenge_pick' || !group.challenge) return;
    const order = computeOrder(group.seats, group.excludedIds);
    const tried = group.challenge.tried || [];
    if (order.indexOf(teamId) === -1 || tried.indexOf(teamId) !== -1) return;
    tried.push(teamId);
    group.challenge = { tried, challengerId: teamId };
    group.phase = 'challenge_answer';
    pushLog(group, '{name}님이 도전해요!', teamId);
    return group;
  });
}

// 도전 없이 넘어가기: 카드는 덱 맨 아래로
function skipChallenge(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group || group.phase !== 'challenge_pick') return;
    if (group.currentCard){
      group.deck = group.deck || [];
      group.deck.unshift(group.currentCard);
    }
    group.currentCard = null;
    group.challenge = null;
    pushLog(group, '도전 없이 넘어가요, 카드는 덱 맨 아래로 돌아갔어요');
    return applyEndTurn(group);
  });
}

// 직전 동작 되돌리기 (선생님이 누르기 직전의 상태를 한 번 저장해 둬요)
function saveUndoSnapshot(gameId, g, groupObj){
  const copy = JSON.parse(JSON.stringify(groupObj || {}));
  delete copy.undo;
  return groupRef(gameId, g).child('undo').set(copy);
}
function undoLast(gameId, g){
  return groupRef(gameId, g).transaction(group => {
    if (!group || !group.undo) return;
    const snap = group.undo;
    snap.undo = null;
    return snap;
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
      deadline: defenseDeadline(group), responses: {}
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
    if (group.teamMode){
      if (group.finalRound && group.finalRound.active) return; // 마지막 한 바퀴 진행 중
      const order = computeOrder(group.seats, group.excludedIds);
      const taken = group.turnsTaken || {};
      const max = Math.max(0, ...order.map(id => taken[id] || 0));
      const n = order.length;
      const dir = group.direction || 1;
      const start = Math.max(0, order.indexOf(group.currentPlayerId));
      const seq = [];
      for (let i = 0; i < n; i++) seq.push(order[(((start + i * dir) % n) + n) % n]);
      const need = seq.filter(id => (taken[id] || 0) < max); // 턴이 부족한 팀만
      if (need.length === 0){
        group.phase = 'ended';
        pushLog(group, '시간이 끝나 게임을 종료해요');
        return group;
      }
      if (need[0] !== group.currentPlayerId){
        group.currentPlayerId = need[0];
        group.judgeId = judgeFor(order, need[0], dir) || need[0];
        group.turnFlags = { specialUsed: false, passUsed: false };
        group.turnStartedAt = serverNow();
      }
      group.pendingSkip = false; group.pendingFlip = false;
      group.finalRound = { active: true, queue: need.slice(1) };
      pushLog(group, '시간이 끝났어요! 마지막 한 바퀴를 진행해요');
      return group;
    }
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
    group.challenge = null;
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
      excludedIds: {}, hands, lastSilence: null, lastDraw: null, lastEffect: null, lastStealReveal: null,
      log: [{ ts: Date.now(), text: '모둠이 다시 시작됐어요' }]
    });
  })();
}
