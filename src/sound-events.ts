import type { Engine, LockRes } from '@haelp/teto/engine';

export function placementSounds(engine: Engine, result: LockRes, hardDrop: boolean) {
  const sounds = hardDrop ? ['harddrop', 'floor'] : ['floor'];
  if (result.spin !== 'none') sounds.push('spinend');
  if (result.lines) {
    sounds.push(result.lines >= 4 ? result.stats.b2b > 0 ? 'clearbtb' : 'clearquad' : result.spin !== 'none' ? 'clearspin' : 'clearline');
    if (result.stats.combo > 0) sounds.push(`combo_${Math.min(16, result.stats.combo)}`);
    if (engine.board.perfectClear) sounds.push('allclear');
  }
  return sounds;
}
