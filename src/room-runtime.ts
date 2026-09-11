import type { Engine, LockRes } from '@haelp/teto/engine';
import { spawnSnapshot, syncProgression } from './engine';
import type { ModeRules } from './modes';

const sleepFlag = 128;
export type RoomState = { delay: number; wake: boolean; nextGarbage: number; garbageId: number; refillSeed: number; refillHole: number | null; refilled: number };

export class RoomRuntime {
  state: RoomState;
  waking = false;

  constructor(private engine: Engine, private rules: ModeRules, private practice: boolean, seed: number) {
    this.state = { delay: 0, wake: false, nextGarbage: Math.round(rules.advanced.garbageStart * 60), garbageId: 0, refillSeed: seed, refillHole: null, refilled: 0 };
    if (rules.advanced.entryDelay || rules.advanced.lineClearDelay) {
      const next = engine.nextPiece;
      engine.nextPiece = (ignoreBlockout, isHold) => {
        if (isHold || this.practice) return next(ignoreBlockout, isHold);
        const { irs, ihs } = engine.handling;
        engine.handling.irs = engine.handling.ihs = 'off';
        try { next(ignoreBlockout, isHold); } finally { engine.handling.irs = irs; engine.handling.ihs = ihs; }
      };
    }
  }

  get waiting() { return this.state.delay > 0 || this.state.wake; }

  refill() {
    const a = this.rules.advanced, board = this.engine.board;
    if (this.practice || !a.garbageRefill || this.engine.toppedOut) return 0;
    const rows = board.state.filter(row => row.some(cell => cell?.mino === 'gb' || cell?.mino === 'bomb'));
    if (this.state.refillHole === null && rows.length) {
      const hole = rows[0].findIndex(cell => cell === null || cell.mino === 'bomb');
      if (hole >= 0) this.state.refillHole = hole;
    }
    const random = () => {
      this.state.refillSeed = this.state.refillSeed * 16807 % 2147483647;
      return (this.state.refillSeed - 1) / 2147483646;
    };
    const amount = Math.max(0, a.garbageRefill - rows.length);
    for (let i = 0; i < amount; i++) {
      if (this.state.refillHole === null) this.state.refillHole = Math.floor(random() * board.width);
      else if (random() < this.rules.setup.messiness) this.state.refillHole = (this.state.refillHole + 1 + Math.floor(random() * (board.width - 1))) % board.width;
      board.insertGarbage({ amount: 1, size: 1, column: this.state.refillHole, bombs: a.bombs, isBeginning: i === 0, isEnd: i === amount - 1 });
    }
    if (amount) {
      while (this.engine.toppedOut && this.engine.falling.y < board.fullHeight - 1) {
        this.engine.falling.location[1]++;
        this.engine.falling.highestY++;
      }
      this.state.refilled += amount;
    }
    return amount;
  }

  beforeTick(timerFrames: number) {
    if (this.state.wake && this.state.delay === 0) {
      this.state.wake = false;
      this.engine.misc.allowed.hardDrop = this.rules.advanced.hardDrop;
      this.waking = true;
      try { this.engine.initiatePiece(this.engine.falling.symbol); } finally { this.waking = false; }
    }
    if (this.state.delay > 0) this.state.delay--;
    syncProgression(this.engine, timerFrames);
    const a = this.rules.advanced;
    if (this.practice || a.garbageInterval <= 0 || timerFrames < this.state.nextGarbage) return 0;
    const amount = a.garbageRows;
    this.engine.receiveGarbage({ frame: this.engine.frame, amount, size: 1, cid: ++this.state.garbageId, gameid: 0, confirmed: true });
    this.engine.stats.garbage.receive += amount;
    this.state.nextGarbage += Math.max(1, Math.round(a.garbageInterval * 60));
    return amount;
  }

  locked(result: LockRes) {
    if (this.practice) return;
    const a = this.rules.advanced;
    this.state.delay = result.lines ? a.lineClearDelay : a.entryDelay;
    if (this.state.delay > 0) {
      Object.assign(this.engine.falling, spawnSnapshot(this.engine, this.engine.falling.symbol));
      this.engine.state |= sleepFlag;
      this.engine.misc.allowed.hardDrop = false;
      this.state.wake = true;
    } else if (a.entryDelay || a.lineClearDelay) {
      this.waking = true;
      try { this.engine.initiatePiece(this.engine.falling.symbol); } finally { this.waking = false; }
    }
  }

  restore(state: RoomState, timerFrames: number, savedFrame: number) {
    this.state = structuredClone(state);
    this.engine.misc.allowed.hardDrop = !this.waiting && this.rules.advanced.hardDrop;
    const offset = this.engine.frame - savedFrame;
    const garbage = this.engine.garbageQueue.snapshot();
    for (const row of garbage.queue) row.frame += offset;
    if (Number.isFinite(garbage.lastTankTime)) garbage.lastTankTime += offset;
    this.engine.garbageQueue.fromSnapshot(garbage);
    syncProgression(this.engine, timerFrames);
  }
}
