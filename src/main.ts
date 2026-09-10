import './style.css';
import { Game } from './game';

const game = new Game();
// Debug/testing hook (read-only inspection for smoke tests).
(window as unknown as { __jw: Game }).__jw = game;
game.boot();
