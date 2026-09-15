import type { Engine } from '@haelp/teto/engine';
import type { Playback, PlaybackFrame } from './playback';
import { QpBoardView } from './qp-board-view';
import { createEngine } from './engine';
import { modeDefinitions, type ModeRules } from './modes';
import { drawScene } from './renderer';
import { drawNativePreview } from './ui-assets';
import { floorNames } from './qp-rules';
import { copyQpSettings } from './qp-runtime';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
export class QpReplayView {
  private boards: QpBoardView[];
  private replay: Playback | null = null;
  private partner: { engine: Engine; rules: ModeRules } | null = null;
  constructor() {
    const player = el('player-tetrion'), stage = document.createElement('div'); stage.id = 'player-qp-stage'; player.replaceWith(stage); stage.append(player);
    const partner = document.createElement('div'); partner.id = 'player-qp-partner'; partner.hidden = true;
    partner.innerHTML = `<div class="board-column"><canvas id="player-qp-bot-board" aria-label="Recorded teammate board"></canvas></div><div class="qp-partner-next"><section class="preview-panel next-panel"><canvas id="player-qp-bot-next-frame" class="preview-frame" aria-hidden="true"></canvas><h2>NEXT</h2><canvas id="player-qp-bot-next" aria-label="Recorded teammate Next"></canvas></section></div>`; stage.append(partner);
    const hold = document.createElement('section'); hold.id = 'player-qp-bot-hold-panel'; hold.className = 'preview-panel hold-panel'; hold.hidden = true;
    hold.innerHTML = '<canvas id="player-qp-bot-hold-frame" class="preview-frame" aria-hidden="true"></canvas><h2>HOLD</h2><canvas id="player-qp-bot-hold" aria-label="Recorded teammate Hold"></canvas>'; player.querySelector('.right-column')!.append(hold);
    const height = document.createElement('div'); height.id = 'player-qp-height'; height.hidden = true; stage.after(height);
    this.boards = [new QpBoardView(player.querySelector('.board-column')!, 0), new QpBoardView(partner.querySelector('.board-column')!, 1)];
  }
  update(replay: Playback, frame: PlaybackFrame) {
    const qp = frame.qp, root = document.querySelector<HTMLElement>('.replay-board-area')!;
    root.classList.toggle('qp-active', !!qp); root.classList.toggle('qp-duo', !!qp?.partner);
    el('player-qp-partner').hidden = !qp?.partner; el('player-qp-height').hidden = !qp;
    el('player-qp-bot-hold-panel').hidden = true;
    this.boards.forEach(board => board.update(qp?.view ?? null));
    if (!qp) { el('player-qp-stage').style.cssText = ''; return; }
    const width = replay.rules.board.width, height = replay.rules.board.height, columns = width + 9 + (qp.partner ? width + 4 : 0), gap = qp.partner ? 18 : 0;
    const cell = Math.max(8, Math.min(64, (root.clientWidth - gap) / columns, (innerHeight - Math.max(0, root.getBoundingClientRect().top) - 165) / (height + 3)));
    root.style.setProperty('--qp-cell', `${cell}px`);
    const tetrion = el('player-tetrion').firstElementChild as HTMLElement; tetrion.style.setProperty('--tetrion-columns', String(width + 9)); tetrion.style.gridTemplateColumns = `5fr ${width}fr 4fr`;
    const stage = el('player-qp-stage'); stage.style.width = `${columns * cell + gap}px`; stage.style.gridTemplateColumns = qp.partner ? `${(width + 9) * cell}px ${(width + 4) * cell}px` : '1fr';
    el('player-qp-height').textContent = `${qp.altitude.toFixed(1)} m · CLIMB SPEED ${qp.rank.toFixed(2)} · ${floorNames[qp.floor - 1]}`;
    if (this.replay !== replay) {
      this.replay = replay; this.partner = null;
      if (qp.partner) { const settings = copyQpSettings(replay.settings); settings.quickplay.profile = { mods: replay.settings.quickplay.profile.allyMods, allyMods: replay.settings.quickplay.profile.mods }; const rules = modeDefinitions.zenith.rules(settings); this.partner = { engine: createEngine(settings, 1, rules), rules }; }
    }
    if (qp.partner && this.partner) {
      const { engine, rules } = this.partner; el('player-qp-bot-hold-panel').hidden = !rules.hold;
      drawScene(el<HTMLCanvasElement>('player-qp-bot-board'), el<HTMLCanvasElement>('player-qp-bot-hold'), el<HTMLCanvasElement>('player-qp-bot-next'), engine, rules, replay.settings.display, { ...qp.partner, target: null, effect: null }, 0);
      drawNativePreview(el<HTMLCanvasElement>('player-qp-bot-hold-frame'), 'hold'); drawNativePreview(el<HTMLCanvasElement>('player-qp-bot-next-frame'), 'next');
    }
  }
}
