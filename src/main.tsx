import { createRoot } from 'react-dom/client';
import App from './App';
import './services/runtimeMemoryMonitor';

const style = document.createElement('style');
style.textContent = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { height: 100%; width: 100%; }
`;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(<App />);
