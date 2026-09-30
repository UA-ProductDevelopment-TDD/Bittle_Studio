import {catalog} from './bittle-link/catalog.js';
import {createLink} from './bittle-link/link.js';
import {initConsole} from './bittle-link/console.js';
import {downloadJson} from './bittle-link/pack.js';

// Studio glue for the Bittle Link module: timeline playback, the function library and the developer-mode panel.
// The connection, protocol and console live in web/bittle-link and also run standalone.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function initHardware({api, toast, getModel, getMapping, refresh}) {
  const $ = id => document.getElementById(id);
  const link = createLink();
  let motions = [];

  link.addEventListener('log', ({detail}) => {
    const time = new Date().toLocaleTimeString([], {hour12: false});
    $('hardwareLog').textContent = (`${time}  ${detail.kind.padEnd(5)}  ${detail.message}\n` + $('hardwareLog').textContent).slice(0, 14000);
  });
  link.addEventListener('state', render);
  function render() {
    const {connected, busy, developerMode, message, transport} = link.status();
    $('hardwareStatus').textContent = message || (connected ? `Connected · ${transport}` : 'Not connected');
    $('hardwareConnect').disabled = connected; $('hardwareDisconnect').disabled = !connected;
    $('hardwarePlay').disabled = !connected || busy; $('hardwareStop').disabled = !connected;
    $('hardwareSend').disabled = !connected || busy; $('hardwareTransport').disabled = connected;
    $('developerMode').checked = developerMode;
    document.querySelectorAll('[data-skill-code], [data-motion-play]').forEach(button => button.disabled = !connected || busy);
    $('developerStatus').textContent = developerMode ? (connected ? 'Active · background voice, autonomous actions and gyro/balance assistance are off.' : 'Will activate when connected.') : (connected ? 'Off · balance assistance and voice actions are available.' : 'Off.');
    $('developerStatus').classList.toggle('active', developerMode && connected);
    window.dispatchEvent(new CustomEvent('bittle-hardware-state', {detail: link.status()}));
  }

  const timelineOptions = type => ({mapping: getMapping(), motion_type: type, hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value), direction: $('hardwareDirection').value});
  const skillEntry = (result, name) => ({skill: result.skill, signature: result.metadata.signature, type: result.metadata.type, name});
  async function playTimelineSkill() { const result = await api('/api/motion-skill', timelineOptions($('hardwareType').value)); await link.runSkill(skillEntry(result, 'Current timeline'), 'Current timeline'); }
  async function resolveMotion(id) { const result = await api(`/api/motions/${id}/skill`, {mapping: getMapping()}); return skillEntry(result, motions.find(item => item.id === id)?.name || 'Studio function'); }

  function functionRow(title, detail, actions) { const row = document.createElement('div'); row.className = 'function-row'; const copy = document.createElement('div'); const b = document.createElement('b'), small = document.createElement('small'); b.textContent = title; small.textContent = detail; copy.append(b, small); row.append(copy, actions); return row; }
  function renderLibrary() {
    const {connected, busy} = link.status(), q = $('functionSearch').value.trim().toLowerCase(); $('builtinFunctions').replaceChildren();
    for (const item of catalog.filter(item => !q || `${item.label} ${item.code}`.toLowerCase().includes(q))) { const button = document.createElement('button'); button.textContent = item.walking ? 'Start gait' : 'Run'; button.dataset.skillCode = item.code; button.disabled = !connected || busy; button.onclick = () => runSkill(item).catch(error => toast(error.message, true)); $('builtinFunctions').append(functionRow(item.label, `${item.code}${item.walking ? ' · gait' : ''}`, button)); }
    $('customFunctions').replaceChildren(); if (!motions.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Save the current timeline to create your first function.'; $('customFunctions').append(p); }
    for (const item of motions.filter(item => !q || item.name.toLowerCase().includes(q))) { const actions = document.createElement('div'); actions.className = 'row-actions'; for (const [label, action] of [['Load', loadSaved], ['Run', playSaved], ['×', deleteSaved]]) { const button = document.createElement('button'); button.textContent = label; if (label === 'Run') button.dataset.motionPlay = item.id; button.onclick = () => action(item).catch(error => toast(error.message, true)); actions.append(button); } $('customFunctions').append(functionRow(item.name, `${item.motion_type} · ${item.hz} Hz · ${item.frames.length} keyframes`, actions)); }
  }
  async function refreshMotions() { motions = (await api('/api/motions')).motions; renderLibrary(); consolePanel.refreshLibrary(); }
  async function runSkill(item) { await link.press(item.code); if (item.walking) link.markBusy(true, 'Gait running · press Stop'); }
  async function loadSaved(item) { await api(`/api/motions/${item.id}/load`, {}); await refresh?.(); toast(`Loaded “${item.name}” into the timeline.`); }
  async function playSaved(item) { await link.runSkill(await resolveMotion(item.id), item.name); }
  async function deleteSaved(item) { await api(`/api/motions/${item.id}`, {}, 'DELETE'); await refreshMotions(); toast(`Deleted “${item.name}”.`); }
  async function voiceAct(code, duration = 800) { if (link.developerMode) throw new Error('Voice actions are blocked by developer mode.'); const item = catalog.find(entry => entry.code === code); if (!item) throw new Error('Unknown Petoi function code.'); await link.sendCommand(item.code); if (item.walking) { await sleep(Math.max(200, Math.min(3000, duration))); await link.sendCommand('kbalance'); } return {status: link.status().testMode ? 'simulated' : 'sent', command: item.code}; }
  async function setDeveloperMode(enabled) { await link.setDeveloperMode(enabled); window.dispatchEvent(new CustomEvent('bittle-developer-mode', {detail: {enabled}})); }

  const consolePanel = initConsole($('hardwareConsole'), {
    link, toast, offlineHint: 'Not connected. Open the Connection tab to connect.',
    store: {load: async () => (await api('/api/controls')).controls, save: async controls => (await api('/api/controls', {controls}, 'PUT')).controls},
    library: {list: () => motions, resolve: resolveMotion},
    tools: [
      {label: 'Export pack', title: 'Download these buttons and your Studio functions for the standalone Bittle Link console', onClick: async () => { downloadJson(await api('/api/controls/pack', {mapping: getMapping()}), 'bittle-link-pack.json'); toast('Pack downloaded. Import it in Bittle Link.'); }},
      {label: 'Open standalone ↗', title: 'Open the Bittle Link console in its own tab (no simulator needed)', onClick: () => window.open('/web/bittle-link/index.html','_blank', 'noopener')},
    ],
  });

  document.querySelectorAll('[data-hardware-tab]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-hardware-tab]').forEach(b => b.classList.toggle('selected', b === button)); document.querySelectorAll('.hardware-tab').forEach(panel => panel.classList.toggle('hidden', panel.id !== `hardware-${button.dataset.hardwareTab}-tab`)); });
  $('openHardware').onclick = () => { const model = getModel(); $('hardwareHz').value = model.motion_hz; $('hardwareDirection').value = model.direction; $('hardwareDialog').showModal(); refreshMotions().catch(error => toast(error.message, true)); consolePanel.reload().catch(error => toast(error.message, true)); };
  $('hardwareConnect').onclick = () => link.connect($('hardwareTransport').value)
    .then(() => { if (link.developerMode) window.dispatchEvent(new CustomEvent('bittle-developer-mode', {detail: {enabled: true}})); })
    .catch(error => { $('hardwareStatus').textContent = 'Connection failed'; toast(error.message, true); });
  $('hardwareDisconnect').onclick = () => link.disconnect().catch(error => toast(error.message, true));
  $('hardwarePlay').onclick = () => playTimelineSkill().catch(error => { link.markBusy(false); toast(error.message, true); });
  $('hardwareStop').onclick = () => link.stop().catch(error => toast(error.message, true));
  $('hardwareTerminal').onsubmit = event => { event.preventDefault(); link.sendCommand($('hardwareCommand').value).catch(error => toast(error.message, true)); };
  $('developerMode').onchange = () => setDeveloperMode($('developerMode').checked).catch(error => { render(); toast(error.message, true); });
  $('functionSearch').oninput = renderLibrary;
  $('saveMotionForm').onsubmit = async event => { event.preventDefault(); try { await api('/api/motions', {name: $('motionName').value, motion_type: $('savedMotionType').value, hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value), direction: $('hardwareDirection').value}); $('motionName').value = ''; await refreshMotions(); toast('Timeline saved to My Studio functions.'); } catch (error) { toast(error.message, true); } };
  const stopIfBusy = () => { if (link.status().busy) link.stop().catch(error => toast(error.message, true)); };
  $('hardwareDialog').addEventListener('close', stopIfBusy); document.addEventListener('visibilitychange', () => { if (document.hidden) stopIfBusy(); }); window.addEventListener('pagehide', () => link.cleanup());

  const publicApi = {status: link.status, sendCommand: link.sendCommand, cancel: link.stop, voiceAct, disconnect: link.disconnect, link};
  window.bittleHardware = publicApi; render(); renderLibrary(); return publicApi;
}
