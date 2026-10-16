import { createRoot } from 'react-dom/client';
import './legacy/legacy.css';
import './host/theme.css';
import './host/host.css';
import App from './host/App';

createRoot(document.getElementById('root')).render(<App />);
