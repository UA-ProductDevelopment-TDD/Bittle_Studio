import {createLink} from './link.js';
import {initConsole} from './console.js';
import {createLocalStore, downloadJson, pickJson} from './pack.js';

// Standalone Bittle Link: the robot console without the simulator. Buttons and imported skills live in this browser.
const $ = id => document.getElementById(id);
let toastTimer;
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = 'show' + (error ? ' error' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').className = '', 4000); }

const link = createLink();
const local = createLocalStore();

link.addEventListener('log', ({detail}) => {
  const time = new Date().toLocaleTimeString([], {hour12: false});
  $('log').textContent = (`${time}  ${detail.kind.padEnd(5)}  ${detail.message}\n` + $('log').textContent).slice(0, 14000);
});
link.addEventListener('state', ({detail}) => {
  $('connect').disabled = detail.connected; $('disconnect').disabled = !detail.connected;
  $('transport').disabled = detail.connected; $('send').disabled = !detail.connected;
  $('developerMode').checked = detail.developerMode;
});

const panel = initConsole($('console'), {
  link, toast, offlineHint: 'Not connected. Choose a connection above and press Connect Bittle.',
  store: local.store, library: local.library,
  tools: [
    {label: 'Import pack', title: 'Load buttons and Studio functions exported from Bittle Studio', onClick: async () => { const result = local.importPack(await pickJson()); await panel.reload(); toast(`Imported ${result.controls} buttons and ${result.skills} Studio functions.`); }},
    {label: 'Export pack', title: 'Download these buttons and skills as a pack file', onClick: () => downloadJson(local.exportPack(), 'bittle-link-pack.json')},
  ],
});

$('connect').onclick = () => link.connect($('transport').value).catch(error => toast(error.message, true));
$('disconnect').onclick = () => link.disconnect().catch(error => toast(error.message, true));
$('developerMode').onchange = () => link.setDeveloperMode($('developerMode').checked).catch(error => toast(error.message, true));
$('terminal').onsubmit = event => { event.preventDefault(); link.sendCommand($('command').value).catch(error => toast(error.message, true)); };
document.addEventListener('visibilitychange', () => { if (document.hidden && link.status().busy) link.stop().catch(() => {}); });
window.addEventListener('pagehide', () => link.cleanup());
