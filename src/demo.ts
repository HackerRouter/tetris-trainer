import type { Engine, TetrominoSnapshot } from '@haelp/teto/engine';
import { createEngine } from './engine';
import { copyPiece } from './finesse';
import type { TrainerGame } from './game';
import type { Demonstration } from './practice';
import { drawBoard } from './renderer';
import { placementSteps, type GuideStep } from './guide';

type Frame = { piece: TetrominoSnapshot; label: string; duration: number; step: number };

export class DemoPanel {
  private popup = document.getElementById('demo-popup')!;
  private canvas = document.getElementById('demo-board')! as HTMLCanvasElement;
  private label = document.getElementById('demo-step')!;
  private source: Demonstration | null = null;
  private engine: Engine | null = null;
  private frames: Frame[] = [];
  private steps: HTMLElement[] = [];
  private index = 0;
  private since = 0;

  constructor() {
    document.querySelector('.finesse-control')!.after(this.popup);
    document.getElementById('demo-close')!.addEventListener('click', event => { this.popup.hidden = true; (event.currentTarget as HTMLElement).blur(); });
    document.getElementById('demo-replay')!.addEventListener('click', event => { this.index = 0; this.since = performance.now(); (event.currentTarget as HTMLElement).blur(); });
  }

  update(now: number, game: TrainerGame) {
    if (game.demonstration !== this.source) {
      this.source = game.demonstration;
      this.popup.hidden = !this.source;
      if (this.source) {
        document.getElementById('demo-title')!.textContent = `${game.practice ? 'Scene' : 'Piece'} ${this.source.sceneNumber} · Correct placement`;
        this.engine = createEngine(game.settings, 1, game.rules);
        this.canvas.width = this.engine.board.width * 18;
        this.canvas.height = (this.engine.board.height + 3) * 18;
        const steps = placementSteps(this.source.path, game.settings);
        this.steps = steps.map(step => { const item = document.createElement('li'); item.textContent = step.text; return item; });
        document.getElementById('demo-steps')!.replaceChildren(...this.steps);
        document.getElementById('demo-summary')!.textContent = `${this.source.path.cost} finesse input${this.source.path.cost === 1 ? '' : 's'} · ${steps.length} step${steps.length === 1 ? '' : 's'}. Drop inputs are not counted.`;
        document.getElementById('demo-note')!.textContent = this.source.path.drop === 'lock' ? 'Start from the shown position. Follow the steps, soft drop and wait for automatic locking.' : this.source.path.drop === 'soft' ? 'Start from the shown position. Lower the piece only where indicated, then finish with hard drop.' : 'Start from the shown position. Follow the steps in order, then finish with hard drop.';
        this.frames = this.build(this.source, this.engine, steps);
        this.index = 0; this.since = now;
      }
    }
    if (this.popup.hidden || !this.source || !this.engine) return;
    while (now - this.since >= this.frames[this.index].duration) {
      this.since += this.frames[this.index].duration; this.index = (this.index + 1) % this.frames.length;
    }
    const frame = this.frames[this.index];
    this.label.textContent = frame.label;
    this.steps.forEach((item, index) => {
      if (index === frame.step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
      item.classList.toggle('done', frame.step > index);
    });
    drawBoard(this.canvas, this.engine, this.source.snapshot.board, frame.piece, this.source.target, { grid: true, ghost: true, ghostOpacity: .25 });
  }

  private build(scene: Demonstration, engine: Engine, steps: GuideStep[]): Frame[] {
    const board = scene.snapshot.board, piece = copyPiece(engine, scene.snapshot.falling);
    const frames: Frame[] = [{ piece: piece.snapshot(), label: 'Start here', duration: 1100, step: -1 }];
    let step = 0;
    const add = (label: string, duration = 700) => frames.push({ piece: piece.snapshot(), label, duration, step });
    for (const instruction of steps) {
      const { move } = instruction;
      if (move === 'hardDrop') { add('Hard drop', 600); piece.softDrop(board); step++; add('Complete · Replaying shortly', 1800); continue; }
      if (move === 'waitLock') { add('Wait for automatic lock', Math.max(700, Math.min(2000, engine.misc.movement.lockTime * 1000 / 60))); step++; add('Complete · Replaying shortly', 1800); continue; }
      if (move === 'dasLeft' || move === 'dasRight') {
        const direction = move === 'dasLeft' ? 'moveLeft' : 'moveRight';
        while (piece[direction](board)) add(move === 'dasLeft' ? 'Hold left, then release' : 'Hold right, then release', 150);
      } else if (move === 'softDrop') {
        const dropped = copyPiece(engine, piece.snapshot()); dropped.softDrop(board);
        while (piece.y > dropped.y) { piece.y -= 1; add('Soft drop, then release', 80); }
      } else if (move === 'down') { for (let row = 0; row < instruction.count; row++) { piece.y -= 1; add('Soft drop one row', 220); } }
      else if (move === 'rotateCW' || move === 'rotateCCW' || move === 'rotate180') {
        piece.rotate(board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false);
        add(move === 'rotateCW' ? 'Rotate CW' : move === 'rotateCCW' ? 'Rotate CCW' : 'Rotate 180°');
      } else { piece[move](board); add(move === 'moveLeft' ? 'Tap left' : 'Tap right'); }
      step++;
    }
    return frames;
  }
}
