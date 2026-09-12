import type { VillageNPC } from '../game/types';
import { GameState, derived, skillLevel, surname } from '../game/state';
import type { Choice, DialogueSpec } from './dialogue';

function npc(st: GameState, role: VillageNPC['role']): VillageNPC {
  return st.village.npcs.find((n) => n.role === role)!;
}

/** A line acknowledging that this is not the first of your name they have served. */
function lineage(st: GameState): string | null {
  if (st.generation <= 1) return null;
  const s = surname(st.hero.name);
  const dead = st.epitaphs[0];
  if (dead) {
    return 'Another ' + s + '. I knew ' + dead.name + '. ' +
      'The ' + dead.cause.toLowerCase() + ' business was a bad end.';
  }
  return 'Another ' + s + '. Your people keep coming back to that door.';
}

const TINT = { shopkeeper: '#6a5a44', guildmaster: '#5a4a5c', smith: '#6a4a3a' };

export function guildTalk(st: GameState, go: {
  board: () => void; turnIn: () => void; leave: () => void;
}): DialogueSpec {
  const n = npc(st, 'guildmaster');
  const q = st.active;
  const lines: string[] = [];
  const lin = lineage(st);
  if (lin) lines.push(lin);

  if (q && q.have >= q.need) {
    lines.push('You are back, and in one piece. Let me see it.');
    lines.push('"' + q.title + '." Signed, sealed, and the purse is already counted out.');
  } else if (q) {
    lines.push('Still working. ' + q.have + ' of ' + q.need + ', by my ledger.');
    lines.push('The board does not move until that one is closed. Those are the rules, not my opinion.');
  } else {
    lines.push(n.line);
    lines.push(st.village.preset === 'thriving'
      ? 'Take your pick. Nobody is desperate enough this year to send you somewhere stupid.'
      : 'Read carefully. Some of these are posted by people with nothing left to lose.');
  }

  const choices: Choice[] = [];
  if (q && q.have >= q.need) {
    choices.push({ label: 'Turn in the contract', hint: '+' + q.rewardGold + 'g', run: go.turnIn });
  }
  choices.push({
    label: q ? 'Look at the board anyway' : 'Show me the board',
    hint: q ? 'your contract is still open' : st.board.length + ' postings',
    run: go.board,
  });
  choices.push({ label: 'Nothing today', run: go.leave });
  return { name: n.name, role: 'Guildmaster', appearance: n.appearance, lines, choices, tint: TINT.guildmaster };
}

export function shopTalk(st: GameState, go: {
  buy: () => void; sell: () => void; village: () => void; leave: () => void;
}): DialogueSpec {
  const n = npc(st, 'shopkeeper');
  const d = derived(st);
  const lines: string[] = [];
  const lin = lineage(st);
  if (lin) lines.push(lin);
  lines.push(n.line);
  if (skillLevel(st, 'haggling') >= 5) {
    lines.push('You drive a hard bargain these days. I have noticed. I do not enjoy it.');
  } else if (st.gold < 10) {
    lines.push('Though from the sound of your purse, you are here to sell, not to buy.');
  }
  return {
    name: n.name, role: 'General Store', appearance: n.appearance, lines,
    tint: TINT.shopkeeper,
    choices: [
      { label: 'Show me your wares', hint: st.shopStock.length + ' in stock', run: go.buy },
      { label: 'I have things to sell', hint: Math.round(d.sellMult * 100) + '% of value', run: go.sell },
      { label: 'How is the village doing?', run: go.village },
      { label: 'Just passing through', run: go.leave },
    ],
  };
}

export function smithTalk(st: GameState, go: {
  forge: () => void; leave: () => void;
}): DialogueSpec {
  const n = npc(st, 'smith');
  const dust = st.homestead.resources.gemdust ?? 0;
  const lines: string[] = [];
  const lin = lineage(st);
  if (lin) lines.push(lin);
  lines.push(n.line);
  lines.push(dust > 0
    ? 'You have dust on you. Good. Dust is the whole trick — I just hold the hammer.'
    : 'Bring me gem dust and I will make what you own worth carrying. Without it I am decoration.');
  return {
    name: n.name, role: 'Smithy', appearance: n.appearance, lines,
    tint: TINT.smith,
    choices: [
      { label: 'Work on my gear', hint: Math.floor(dust) + ' dust', run: go.forge },
      { label: 'Another time', run: go.leave },
    ],
  };
}
