import ReactDOM from 'react-dom/client';
import '@fontsource-variable/archivo/standard.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './global.css';
import App from './App';
import { boot } from './store';
import { initEngine } from './engine';

boot().then(initEngine);
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
