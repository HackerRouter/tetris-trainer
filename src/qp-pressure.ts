import { garbagePhase, receiveAmount, splitWindup, type QpMod, type ReceiveContext } from './qp-rules';

export type PressurePacket = { frame: number; amount: number; stage: 'before-receiver' | 'after-receiver'; source: number; sourceAltitude: number; hole?: number; size?: number };
export type PressureTape = { version: 1; name: string; ruleRevision: string; frames: number; mods: string[]; packets: PressurePacket[]; unknown: string[] };
export type PressureSettings = { mode: 'none' | 'generated' | 'replay'; strength: number; burstiness: number; tape: PressureTape | null };
export type PressureState = { rng: number; next: number; cursor: number; burstLeft: number; source: number; sourceAltitude: number; lastHole: number; generated: number };
export function randomStep(state: { rng: number }) { state.rng = Math.imul(state.rng, 1664525) + 1013904223 >>> 0; return state.rng / 4294967296; }
export function ruleRandom(state: { rng: number }) { state.rng = state.rng * 16807 % 2147483647; return (state.rng - 1) / 2147483646; }
export function initialPressure(seed: number): PressureState { return { rng: seed >>> 0, next: 600, cursor: 0, burstLeft: 0, source: 1, sourceAltitude: 0, lastHole: 4, generated: 0 }; }
export function pressurePackets(state: PressureState, settings: PressureSettings, frame: number, altitude: number, mods: QpMod[]): PressurePacket[] {
  if (settings.mode === 'none' || settings.strength <= 0) return [];
  if (settings.mode === 'replay') {
    const events = settings.tape?.packets ?? [], result: PressurePacket[] = [];
    while (state.cursor < events.length && events[state.cursor].frame <= frame) {
      const packet = events[state.cursor++];
      result.push({ ...packet, frame, amount: Math.max(0, Math.round(packet.amount * settings.strength)) });
    }
    return result;
  }
  if (frame < state.next) return [];
  const random = () => randomStep(state), expert = mods.includes('expert') || mods[0] === 'expert_reversed';
  if (!state.burstLeft) {
    state.source = 1 + Math.floor(random() * 8);
    state.sourceAltitude = Math.max(0, altitude + (random() - .65) * (120 + altitude * .3));
    state.burstLeft = random() < settings.burstiness ? 2 + Math.floor(random() * 4) : 1;
  }
  const amount = [1, 1, 2, 2, 3, 4, 4, 4][Math.floor(random() * 8)];
  const pressure = (1 + Math.min(3, frame / 36000) + Math.sqrt(altitude / 350)) * (expert ? 1.2 : 1) * settings.strength;
  state.burstLeft--;
  state.next = frame + (state.burstLeft ? 8 + Math.floor(random() * 42) : Math.round((100 + random() * 430) / pressure + (random() < .18 ? 200 + random() * 600 : 0)));
  state.generated++;
  return [{ frame, amount, stage: 'before-receiver', source: state.source, sourceAltitude: state.sourceAltitude }];
}
export type PendingPacket = PressurePacket & { id: number; release: number; hit: number; ready: number; delay: number; windup: boolean };
export type GarbageState = { rng: number; id: number; windupUntil: number; pending: PendingPacket[]; entering: { hole: number; size: number; packet: number }[]; enterAt: number; grace: number; lastHit: number; lastHole: number | null; changedHole: boolean; received: number; cancelled: number; inserted: number; discarded: number; cancelStreak: number; lastTank: number; stalePieces: number };
export function initialGarbage(seed: number): GarbageState { const remainder = seed % 2147483647; return { rng: remainder <= 0 ? remainder + 2147483646 || 1 : remainder, id: 0, windupUntil: 0, pending: [], entering: [], enterAt: 0, grace: 0, lastHit: 0, lastHole: null, changedHole: false, received: 0, cancelled: 0, inserted: 0, discarded: 0, cancelStreak: 0, lastTank: 0, stalePieces: 0 }; }
export function acceptPressure(state: GarbageState, packets: PressurePacket[], context: Omit<ReceiveContext, 'sourceAltitude' | 'cancelStreak' | 'windupUntil' | 'grace'> & { incapacitated?: boolean }) {
  const starts: { frame: number; portions: number }[] = [];
  const groups = new Map<string, { packet: PressurePacket; amount: number; delay: number }>();
  for (const packet of packets) {
    const amount = packet.stage === 'after-receiver' ? packet.amount : receiveAmount(packet.amount, { ...context, sourceAltitude: packet.sourceAltitude, cancelStreak: state.cancelStreak, windupUntil: state.windupUntil, grace: state.grace }, () => ruleRandom(state));
    if (!amount) continue;
    if (context.incapacitated) { state.lastHit = context.frame; state.stalePieces = 0; state.grace = Math.min(18, state.grace + amount); continue; }
    const delay = Math.floor(garbagePhase(context.floor, context.mods) / (state.cancelStreak >= 25 && !context.mods.some(mod => mod === 'volatile' || mod === 'volatile_reversed') ? 2 : 1));
    const key = packet.source ? String(packet.source) : `anonymous-${groups.size}`;
    const group = groups.get(key);
    if (group) group.amount += amount; else groups.set(key, { packet, amount, delay });
  }
  for (const { packet, amount, delay } of groups.values()) {
    const windup = splitWindup(amount, context.altitude, context.mods.some(mod => mod === 'volatile' || mod === 'volatile_reversed'), context.frame, state.windupUntil);
    state.windupUntil = windup.until; state.discarded += windup.discarded;
    if (windup.windup) starts.push({ frame: windup.portions[0].release - 60, portions: windup.portions.length });
    for (const portion of windup.portions) state.pending.push({ ...packet, stage: 'after-receiver', amount: portion.amount, id: ++state.id, release: portion.release, hit: portion.release + 20, ready: portion.release + 20 + 2 * delay, delay, windup: windup.windup });
  }
  return starts;
}
export function updateGarbage(state: GarbageState, frame: number, floor: number, mods: QpMod[]) {
  for (const packet of state.pending) if (packet.release === frame) {
    state.received += packet.amount;
    state.grace = Math.min(18, state.grace + (mods[0] === 'volatile_reversed' ? Math.floor(packet.amount / 3) : packet.amount));
    state.lastHit = frame; state.stalePieces = 0;
  }
  const grace = mods[0] === 'expert_reversed' ? [0, 1, .9, .8, .7, .6, .5, .4, .3, .2, .1] : [0, 3.8, 3, 2.3, 1.7, 1.2, .8, .5, .5, .5, .2];
  if (state.grace > 0 && frame >= state.lastHit + 60 * grace[floor]) { state.grace--; state.lastHit = frame; }
  if (frame > state.lastTank && (frame - state.lastTank) % 1800 === 0) state.cancelStreak += 5;
}
export function cancelGarbage(state: GarbageState, amount: number, multiplier: number, frame: number, opener: boolean, drained?: () => void) {
  let sent = amount, extra = Math.floor(amount * (multiplier - 1)) + (opener ? amount : 0), cancelled = 0;
  while (sent + extra > 0 && state.entering.length) { state.entering.shift(); if (sent) sent--; else extra--; cancelled++; }
  for (const packet of state.pending) {
    if (packet.release > frame) continue;
    while (packet.amount && sent + extra > 0) { packet.amount--; if (sent) sent--; else extra--; cancelled++; if (!packet.amount) drained?.(); }
  }
  state.pending = state.pending.filter(packet => packet.amount > 0);
  state.cancelled += cancelled; state.cancelStreak += cancelled;
  return { sent, cancelled };
}
export function extractQpPressure(value: unknown, name = 'Recorded Zenith pressure'): PressureTape {
  const root = value as { gamemode?: string; replay?: { frames?: number; options?: Record<string, unknown>; events?: { frame: number; type: string; data: { type?: string; data?: Record<string, unknown> } }[] } };
  const replay = root?.replay, options = replay?.options;
  if (!replay || !options?.zenith || options.version !== 19 || !Array.isArray(replay.events) || !Number.isFinite(replay.frames)) throw new Error('Pressure import requires a native Zenith v19 replay.');
  const packets: PressurePacket[] = [];
  for (const event of replay.events) {
    const interaction = event.data, data = interaction?.data;
    if (event.type !== 'ige' || interaction?.type !== 'interaction' || data?.type !== 'garbage') continue;
    const amount = Number(data.amt), altitude = Number(data.zthalt), frame = event.frame;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000 || !Number.isInteger(frame) || frame < 0 || !Number.isFinite(altitude)) throw new Error('A garbage interaction has invalid or unknown amount, timing or sender altitude.');
    packets.push({ frame, amount, source: Number(data.gameid) || 0, sourceAltitude: altitude, stage: 'before-receiver', size: Number(data.size) || 1 });
  }
  packets.sort((a, b) => a.frame - b.frame);
  return { version: 1, name, ruleRevision: 'tetrio-v19-20260714', frames: replay.frames!, mods: Array.isArray(options.zenith_mods) ? options.zenith_mods as string[] : [], packets, unknown: ['Receiver garbage holes are generated by the local rules.', 'The source lobby and counterfactual targeting are not reconstructed.'] };
}
