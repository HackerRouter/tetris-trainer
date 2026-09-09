import type { Engine, TetrominoSnapshot } from '@haelp/teto/engine';
import { createEngine } from './engine';
import { copyPiece } from './finesse';
import type { TrainerGame } from './game';
import type { Demonstration } from './practice';
import { drawBoard } from './renderer';

type Frame = { piece: TetrominoSnapshot; label: string; duration: number };

export class DemoPanel {
  private popup = document.getElementById('demo-popup')!;
  private canvas = document.getElementById('demo-board')! as HTMLCanvasElement;
  private label = document.getElementById('demo-step')!;
  private source: Demonstration | null = null;
  private engine: Engine | null = null;
  private frames: Frame[] = [];
  private index = 0;
  private since = 0;

  constructor() {
    document.getElementById('demo-close')!.addEventListener('click', event => { this.popup.hidden = true; (event.currentTarget as HTMLElement).blur(); });
    document.getElementById('demo-replay')!.addEventListener('click', event => { this.index = 0; this.since = performance.now(); (event.currentTarget as HTMLElement).blur(); });
  }

  update(now: number, game: TrainerGame) {
    if (game.demonstration !== this.source) {
      this.source = game.demonstration;
      this.popup.hidden = !this.source;
      if (this.source) {
        document.getElementById('demo-title')!.textContent = `Scene ${this.source.sceneNumber} · Correct placement`;
        this.engine = createEngine(game.settings, 1);
        this.frames = this.build(this.source, this.engine);
        this.index = 0; this.since = now;
      }
    }
    if (this.popup.hidden || !this.source || !this.engine) return;
    while (this.index < this.frames.length - 1 && now - this.since >= this.frames[this.index].duration) {
      this.since += this.frames[this.index].duration; this.index++;
    }
    const frame = this.frames[this.index];
    this.label.textContent = frame.label;
    drawBoard(this.canvas, this.engine, this.source.snapshot.board, frame.piece, this.source.target, { grid: true, ghost: true, ghostOpacity: .25 });
  }

  private build(scene: Demonstration, engine: Engine): Frame[] {
    const board = scene.snapshot.board, piece = copyPiece(engine, scene.snapshot.falling);
    const frames: Frame[] = [{ piece: piece.snapshot(), label: 'Start here', duration: 600 }];
    const add = (label: string, duration = 400) => frames.push({ piece: piece.snapshot(), label, duration });
    for (const move of scene.path.moves) {
      if (move === 'dasLeft' || move === 'dasRight') {
        const direction = move === 'dasLeft' ? 'moveLeft' : 'moveRight';
        while (piece[direction](board)) add(move === 'dasLeft' ? 'Hold left, then release' : 'Hold right, then release', 90);
      } else if (move === 'softDrop') {
        const dropped = copyPiece(engine, piece.snapshot()); dropped.softDrop(board);
        while (piece.y > dropped.y) { piece.y -= 1; add('Soft drop, then release', 45); }
      } else if (move === 'down') { piece.y -= 1; add('Soft drop one row', 120); }
      else if (move === 'rotateCW' || move === 'rotateCCW' || move === 'rotate180') {
        piece.rotate(board, engine.kickTableName, move === 'rotateCW' ? 1 : move === 'rotateCCW' ? 3 : 2, false);
        add(move === 'rotateCW' ? 'Rotate CW' : move === 'rotateCCW' ? 'Rotate CCW' : 'Rotate 180°');
      } else { piece[move](board); add(move === 'moveLeft' ? 'Tap left' : 'Tap right'); }
    }
    add('Hard drop', 350);
    piece.softDrop(board); add('Complete · Click to replay', Infinity);
    return frames;
  }
}
