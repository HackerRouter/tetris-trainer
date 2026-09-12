import type { Engine, LockRes } from '@haelp/teto/engine';

export function placementSounds(engine: Engine, result: LockRes, hardDrop: boolean) {
  const sounds = hardDrop ? ['harddrop', 'floor'] : ['floor'];
  if (result.lines) {
    sounds.push(result.spin !== 'none' ? 'clearspin' : result.lines >= 4 ? 'clearquad' : 'clearline');
    if (engine.stats.combo > 0) sounds.push(`combo_${Math.min(16, engine.stats.combo)}`);
    if (engine.stats.b2b > 0 && (result.spin !== 'none' || result.lines >= 4)) sounds.push('clearbtb');
    if (engine.board.perfectClear) sounds.push('allclear');
  }
  return sounds;
}
