import { createRoot } from 'react-dom/client';
import { App } from './workspace.js';
import './style.css';
import { applyAppearance, loadAppearance } from './theme.js';
applyAppearance(loadAppearance(), document.documentElement);
createRoot(document.getElementById('root')!).render(<App />);
