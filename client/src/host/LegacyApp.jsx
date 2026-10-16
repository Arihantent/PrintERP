import { useEffect } from 'react';
// The original app: markup, expenses module and main screens — kept as they were.
import markup from '../legacy/markup.html?raw';
import expensesSrc from '../legacy/expenses.js?raw';
import appSrc from '../legacy/app.js?raw';

let started = false;

function runClassicScript(src, name) {
  const s = document.createElement('script');
  // Classic (non-module) script so the original global functions and inline handlers work as before.
  s.textContent = src + '\n//# sourceURL=' + name;
  document.body.appendChild(s);
}

// Mounts the original screens straight into <body> (their styles and print layout expect that)
// and starts them once. They read and write data through window.claude (see dataClient.js).
export default function LegacyApp() {
  useEffect(() => {
    if (started) return;
    started = true;
    const tpl = document.createElement('template');
    tpl.innerHTML = markup;
    const root = document.getElementById('root');
    document.body.insertBefore(tpl.content, root);
    runClassicScript(expensesSrc, 'legacy/expenses.js');
    runClassicScript(appSrc, 'legacy/app.js');
  }, []);
  return null;
}
