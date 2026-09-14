import type { Appearance } from '../game/types';
import { GameState, surname, trialReady } from '../game/state';
import { MONSTERS, ZONES, trialQuest } from '../game/content';
import { RANKS, rankDef } from '../game/ranks';
import type { Choice, DialogueSpec } from './dialogue';

/**
 * The world as the Ashford guild remembers it.
 *
 * Eighty-three years ago the Ashen Sovereign's Long Night was ended on the
 * Ashen Field by Edric Harrow, a lantern-carrier from this village, and his
 * party: Brother Anselm, Dagna Irontide and the elf Sylwen. Edric is dead. So
 * is almost everyone who remembers him, except Sylwen, who promised to watch
 * over his village and has been sitting in its guild ever since, watching
 * one family of adventurers after another walk out of the door.
 *
 * What was left of the Sovereign soaked into the ground. The guild calls it
 * the Hollowing: it swells beasts, wakes the dead, and it is spreading. And
 * one of his four Heralds was never found.
 */

export const HERO = 'Edric Harrow';

export const SYLWEN = {
  name: 'Sylwen',
  role: 'Of the Hero’s Party',
  appearance: {
    skin: '#f3dcc8', hair: '#e8e6f0', cloth: '#4f7a5a', accent: '#c9d8a8',
    build: 0.2, hairStyle: 1, height: 1.08, ears: 'elf',
  } as Appearance,
  tint: '#4f6a5a',
};

/** The veteran who grades trials. He is human, so he does not last forever. */
export function veteran(st: GameState): { name: string; role: string; appearance: Appearance; old: boolean; successor: boolean } {
  const era = st.village.era;
  if (era >= 6) {
    return {
      name: 'Tessa Holt', role: 'Trialmaster', old: false, successor: true,
      appearance: { skin: '#e0ab7d', hair: '#8a3f2c', cloth: '#5a4a3a', accent: '#c07a45', build: 0.7, hairStyle: 2, height: 1.02, patch: false },
    };
  }
  return {
    name: 'Garran Holt', role: 'Trialmaster', old: era >= 3, successor: false,
    appearance: {
      skin: '#d8a47a', hair: era >= 3 ? '#e8e4dc' : '#9c8a74', cloth: '#4a4238', accent: '#8fd6e0',
      build: 0.9, hairStyle: 0, height: 1.04, beard: era >= 3 ? '#e8e4dc' : '#8a7a64', patch: true,
    },
  };
}

export function clerk(st: GameState): { name: string; appearance: Appearance } {
  const young = st.village.era >= 4;
  return {
    name: young ? 'Wenna' : 'Maribel',
    appearance: {
      skin: '#f0c9a4', hair: young ? '#c95b3a' : '#5b3a1e', cloth: '#6a4a7d', accent: '#e0b64f',
      build: 0.3, hairStyle: young ? 3 : 2, height: 0.98,
    },
  };
}

/** The party that drinks in the corner. They grow up, and then they retire. */
export function localParty(st: GameState): { name: string; members: { name: string; line: string }[]; rank: number } {
  if (st.village.era >= 4) {
    return {
      name: 'The Morning Bells', rank: 2,
      members: [
        { name: 'Hanne', line: 'We are the Morning Bells. We ring when there is trouble. Mostly we ring for more ale.' },
        { name: 'Otto', line: 'Grandmother was in the Crimson Oath. She says the board used to be harder. She says a lot of things.' },
        { name: 'Brin', line: 'I am the healer. Please do not make me heal you. I am not very good yet.' },
      ],
    };
  }
  return {
    name: 'The Crimson Oath', rank: 3,
    members: [
      { name: 'Rurik', line: 'Silver plate, the three of us. Took the Barrows twice. Well. Took most of it.' },
      { name: 'Liss', line: 'If you are going after something big, take a healer. Take Pell. Please take Pell.' },
      { name: 'Pell', line: 'Liss says I worry too much. Liss also has never been eaten.' },
    ],
  };
}

function plate(n: number): string {
  return rankDef(n).plate;
}

// ------------------------------------------------------------------- Sylwen

export function sylwenTalk(st: GameState, go: {
  hero: () => void; hollowing: () => void; ledger: () => void; leave: () => void;
}): DialogueSpec {
  const lines: string[] = [];
  const dead = st.epitaphs[0];
  const firstTime = !st.story['met_sylwen'];
  if (firstTime && st.generation <= 1) {
    lines.push('Another copper plate. Sit, if you like. I am not the one who hands out the work.');
    lines.push('I am Sylwen. I walked with ' + HERO + ', eighty-three years ago, all the way to the Ashen Field and back.');
    lines.push('He was born in this village. He asked me to keep an eye on it when he was gone. I said I would. Humans always think that means a few years.');
  } else if (!st.story['life:met_sylwen'] && dead) {
    lines.push('You have ' + dead.name + '’s way of standing in a doorway.');
    lines.push(dead.name + ' sat right there. ' + (dead.rank !== undefined ? 'Wore the ' + plate(dead.rank) + '. ' : '')
      + 'Died to ' + dead.cause.toLowerCase() + ', with ' + dead.kills + ' kills to the name.');
    lines.push('I remember all of the ' + surname(st.hero.name) + 's. It is not a gift. It is what happens when you live long enough.');
  } else {
    lines.push(st.rank >= 6
      ? 'Adamant. That was his plate. I did not think I would see it on anyone again.'
      : st.rank >= 5 ? 'Mithril. You are closer to the Field than most of the living ever get. Be careful what you find there.'
        : st.rank >= 3 ? 'Silver suits you. Edric wore silver a long time before anyone took him seriously.'
          : st.rank >= 1 ? 'Iron already. Good. Keep your feet under you and your pack light.'
            : 'Still copper. Everyone is copper once. Even him.');
  }
  st.story['met_sylwen'] = 1;
  st.story['life:met_sylwen'] = 1;
  const choices: Choice[] = [
    { label: 'Tell me about the Hero', run: go.hero },
    { label: 'What is the Hollowing?', run: go.hollowing },
  ];
  if (st.epitaphs.length) choices.push({ label: 'Do you remember my family?', hint: st.epitaphs.length + ' before you', run: go.ledger });
  choices.push({ label: 'Leave her to it', run: go.leave });
  return { name: SYLWEN.name, role: SYLWEN.role, appearance: SYLWEN.appearance, lines, choices, tint: SYLWEN.tint };
}

export function sylwenHero(back: () => void): DialogueSpec {
  return {
    name: SYLWEN.name, role: SYLWEN.role, appearance: SYLWEN.appearance, tint: SYLWEN.tint,
    lines: [
      'Edric was not the strongest of us. Dagna could lift a cart. Brother Anselm could close a wound with a word. Edric was the one who kept walking.',
      'He carried a lantern that never went out. There is a stone one on his statue in the square. The real one was buried with him.',
      'We reached the Ashen Sovereign on the eleventh winter. What happened there is in the songs, and the songs are mostly wrong.',
      'He came home, married a baker, and died an old man in a chair by that window. I think it was the thing he was proudest of.',
    ],
    choices: [{ label: 'Thank you', run: back }],
  };
}

export function sylwenHollowing(back: () => void): DialogueSpec {
  return {
    name: SYLWEN.name, role: SYLWEN.role, appearance: SYLWEN.appearance, tint: SYLWEN.tint,
    lines: [
      'When the Sovereign died, his power did not die with him. It soaked into the ground where he fell, and it has been creeping south ever since.',
      'It is what grows a boar to the size of a cart, and lifts a squire out of his grave with a crown on his head. The guild calls it the Hollowing.',
      'It moves slowly. It is patient. So am I.',
    ],
    choices: [{ label: 'I will keep that in mind', run: back }],
  };
}

export function sylwenLedger(st: GameState, back: () => void): DialogueSpec {
  const lines = st.epitaphs.slice(0, 4).map((e) =>
    e.name + (e.rank !== undefined ? ', ' + plate(e.rank) : '') + '. Generation ' + e.gen + '. Killed by ' + e.cause.toLowerCase() + '.');
  lines.push(st.epitaphs.length > 4
    ? 'There are more. I keep them all. Come back when you want the rest.'
    : 'That is all of them, so far. Do try to make it a short list.');
  return {
    name: SYLWEN.name, role: 'She keeps a ledger', appearance: SYLWEN.appearance, tint: SYLWEN.tint,
    lines, choices: [{ label: 'I will try', run: back }],
  };
}

// ------------------------------------------------------------------ veteran

export function veteranTalk(st: GameState, go: {
  accept: () => void; turnIn: () => void; story: () => void; leave: () => void;
}): DialogueSpec {
  const v = veteran(st);
  const R = rankDef(st.rank);
  const q = st.active;
  const lines: string[] = [];
  const choices: Choice[] = [];
  const first = !st.story['life:met_veteran'];
  st.story['life:met_veteran'] = 1;

  if (first) {
    lines.push(v.successor
      ? 'Tessa Holt. My great-uncle Garran ran trials in this hall for sixty years. I run them now, and I am not softer than he was.'
      : 'Garran Holt. I wore mithril once, and I had two arms once. Guess which one I miss.');
    lines.push('You run contracts, merit goes on your ledger. When the ledger is heavy enough, you come to me and I give you a trial.');
    lines.push('Pass it and you wear the next plate. Fail it and your name goes up on the wall with the others.');
  }

  if (q && q.trial) {
    if (q.have >= q.need) {
      lines.push('You are back, and ' + MONSTERS[q.target].name + ' is not. Hand me the old plate.');
      choices.push({ label: 'Hand over your ' + R.plate, hint: 'promotion', run: go.turnIn });
    } else {
      lines.push('The trial stands. ' + MONSTERS[q.target].name + ' is waiting in ' + ZONES[q.zoneId].name + '. Do not keep it waiting, it gets hungry.');
    }
  } else if (st.rank >= RANKS.length - 1) {
    lines.push('Adamant. There is nothing left for me to test you with. Go and be a story.');
  } else if (trialReady(st)) {
    const tq = trialQuest(st.rank);
    lines.push('Your ledger is heavy enough. I have something for you.');
    if (tq) lines.push(tq.flavor);
    if (q) lines.push('Finish or abandon the contract you are carrying first. One job at a time.');
    else choices.push({ label: 'Accept the trial', hint: 'for the ' + rankDef(st.rank + 1).plate, run: go.accept });
  } else if (!first) {
    lines.push('Merit ' + st.merit + ' of ' + R.merit + '. Come back when your plate has a few more scratches on it.');
  }
  choices.push({ label: v.successor ? 'Tell me about Garran' : 'What happened to your arm?', run: go.story });
  choices.push({ label: 'Later', run: go.leave });
  return { name: v.name, role: v.role, appearance: v.appearance, lines, choices, tint: '#5a4a3c' };
}

export function veteranStory(st: GameState, back: () => void): DialogueSpec {
  const v = veteran(st);
  const lines = v.successor
    ? [
      'He lost the arm to the Hollow King, back when it was only a rumour in the Barrows. He made the trial for silver out of it afterwards.',
      'He said the worst part was not the arm. It was coming home and telling three families why he had come home and their children had not.',
      'He is buried by the chapel. He asked for his plate to go with him. I kept it. He would understand.',
    ]
    : [
      'The Lantern Road. Five of us, named for the Hero, because we were young and stupid. We took the Barrows contract thirty years ago.',
      'Something in there wore a crown. I came back. My arm did not. Neither did three of my friends.',
      'So I stayed, and I test people. If a trial frightens you, good. It is supposed to. Better frightened here than dead there.',
    ];
  return { name: v.name, role: v.role, appearance: v.appearance, lines, choices: [{ label: 'I understand', run: back }], tint: '#5a4a3c' };
}

/** What the world gives up after each promotion, a piece of the story at a time. */
export function promotionScene(st: GameState, newRank: number, done: () => void): DialogueSpec {
  const v = veteran(st);
  const R = rankDef(newRank);
  const beats: Record<number, string[]> = {
    1: ['A boar that size is not natural. Sylwen will tell you it is the Hollowing. She is usually right, which is annoying.'],
    2: ['Sylwen says the Grovewarden was a bear she used to leave honey out for. The Hollowing got into it. She says it is moving faster than it used to.'],
    3: ['The bandits in the fen were carrying ash sigils. Someone is paying them to watch the roads. Someone who ought to be long dead.'],
    4: [
      'The Hollow King had a name once. Tobin. He carried the Hero’s lantern for two years.',
      'Somebody woke him on purpose. Sylwen says only a Herald of the Sovereign could do that.',
    ],
    5: [
      'From the top of the Greyspine you can see the Ashen Field. There is a fire burning on it again.',
      'Vessarine. The last Herald. She was never found, and now we know why. Nobody goes after her but a mithril plate.',
    ],
    6: [
      'It is over. Properly, this time.',
      'Sylwen asked me to tell you something. The Hero once asked her what she would do when it was all finished. She said she would find out.',
      'She says she thinks she will stay a while longer. Your family’s name goes on the wall beside his.',
    ],
  };
  return {
    name: v.name, role: 'Promotion', appearance: v.appearance, tint: '#6a5a2a',
    lines: [
      R.plate + '. ' + R.letter + '-rank. They will call you ' + R.title.toLowerCase() + ' in the taverns now. Wear it like you earned it, because you did.',
      ...(beats[newRank] ?? []),
    ],
    choices: [{ label: 'Take the ' + R.plate, run: done }],
  };
}

// -------------------------------------------------------------------- clerk

export function clerkTalk(st: GameState, go: {
  board: () => void; turnIn: () => void; ranks: () => void; leave: () => void;
}): DialogueSpec {
  const c = clerk(st);
  const R = rankDef(st.rank);
  const q = st.active;
  const lines: string[] = [];
  if (!st.story['life:met_clerk']) {
    lines.push('Welcome to the Ashford chapter of the Adventurers Guild. You are ' + st.hero.name + '? Then this is yours.');
    lines.push('A ' + R.plate + '. Contracts are graded by plate. You may take work one plate above your own, if you are brave, or poor.');
    lines.push('Finished work earns merit. When you have enough, see ' + veteran(st).name + ' by the fire about a trial.');
    st.story['life:met_clerk'] = 1;
  } else if (q && !q.trial && q.have >= q.need) {
    lines.push('That is everything? Let me stamp it.');
  } else if (q && !q.trial) {
    lines.push('Still out on "' + q.title + '". ' + q.have + ' of ' + q.need + ', by the ledger.');
  } else {
    lines.push(st.village.preset === 'thriving'
      ? 'Good morning, ' + R.letter + '-rank. The board is full today. Half of it is even honest.'
      : 'Morning, ' + R.letter + '-rank. The board is thin. Nobody posts work they cannot pay for.');
  }
  const choices: Choice[] = [];
  if (q && !q.trial && q.have >= q.need) {
    choices.push({ label: 'Turn in the contract', hint: '+' + q.rewardGold + 'g, +' + q.merit + ' merit', run: go.turnIn });
  }
  choices.push({ label: 'Show me the board', hint: st.board.length + ' postings', run: go.board });
  choices.push({ label: 'How do ranks work?', hint: R.letter + ' · merit ' + st.merit + '/' + (Number.isFinite(R.merit) ? R.merit : '—'), run: go.ranks });
  choices.push({ label: 'That is all', run: go.leave });
  return { name: c.name, role: 'Guild Clerk', appearance: c.appearance, lines, choices, tint: '#5a4a5c' };
}

export function ranksExplained(st: GameState, back: () => void): DialogueSpec {
  const c = clerk(st);
  const next = st.rank < RANKS.length - 1 ? rankDef(st.rank + 1) : null;
  return {
    name: c.name, role: 'Guild Clerk', appearance: c.appearance, tint: '#5a4a5c',
    lines: [
      'Copper, iron, bronze, silver, gold, mithril, adamant. F to S. Every plate opens the gate to rougher country and better pay.',
      'The Hero wore adamant. Nobody in this chapter has since.',
      next
        ? 'You need ' + rankDef(st.rank).merit + ' merit before the trial for ' + next.plate + '. You have ' + st.merit + '.'
        : 'You already wear the last plate there is.',
    ],
    choices: [{ label: 'Thanks', run: back }],
  };
}

// --------------------------------------------------------------- the others

export function adventurerTalk(st: GameState, who: string, leave: () => void): DialogueSpec {
  const party = localParty(st);
  const member = party.members.find((m) => m.name === who) ?? party.members[0];
  const lines = [member.line];
  if (st.rank > party.rank) lines.push('A ' + plate(st.rank) + ', talking to us. Wait until I tell my mother.');
  else if (st.rank === party.rank) lines.push('Same plate as us. Race you to the next one.');
  else lines.push('You will get there. We all started on copper. Rurik started on copper twice.');
  return {
    name: member.name, role: party.name, appearance: {
      skin: '#e0ab7d', hair: '#5b3a1e', cloth: '#8a3f47', accent: '#d8b45a', build: 0.5, hairStyle: 1, height: 1,
    }, lines, choices: [{ label: 'Good luck out there', run: leave }], tint: '#6a3a3a',
  };
}

/** The first time an heir walks into the hall. */
export function hallIntro(st: GameState, done: () => void): DialogueSpec | null {
  if (st.story['life:hall_intro']) return null;
  st.story['life:hall_intro'] = 1;
  const v = veteran(st);
  const lines = st.generation <= 1
    ? [
      'The Adventurers Guild of Ashford. Founded by the Hero’s party after the war, so that no village would ever have to wait for a hero again.',
      'The clerk at the counter hands out plates and work. ' + v.name + ', by the fire, decides when you are ready for more.',
      'And the elf by the window has been sitting there for eighty years. Everybody here is a little afraid to ask her why.',
    ]
    : [
      'The hall has not changed. The names on the wall have.',
      'There is a notch in the doorframe for every ' + surname(st.hero.name) + ' who has walked through it. You are notch number ' + st.generation + '.',
    ];
  return {
    name: 'Adventurers Guild', role: 'Ashford Chapter', appearance: SYLWEN.appearance, tint: '#4a3a2a',
    lines, choices: [{ label: 'Walk in', run: done }],
  };
}
