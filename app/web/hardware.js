import {catalog} from './bittle-link/catalog.js';
import {createLink, packJointCommands} from './bittle-link/link.js';
import {initConsole} from './bittle-link/console.js';
import {saveFolderPack} from './bittle-link/pack.js';

// Studio glue for the Bittle Link module: timeline playback, the function library and the developer-mode panel.
// The connection, protocol and console live in web/bittle-link and also run standalone. In Studio every console
// action moves the simulator; when a robot is connected it is sent over Bluetooth as well.
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
    const {connected, busy} = link.status(), q = $('functionSearch').value.trim().toLowerCase();
    $('customFunctions').replaceChildren(); if (!motions.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'No functions yet. Make a motion, then press ★ Save as function.'; $('customFunctions').append(p); }
    for (const item of motions.filter(item => !q || item.name.toLowerCase().includes(q))) { const actions = document.createElement('div'); actions.className = 'row-actions'; for (const [label, action] of [['Load', loadSaved], ['Run', playSaved], ['×', deleteSaved]]) { const button = document.createElement('button'); button.textContent = label; button.title = {Load: 'Put this function back on the timeline', Run: 'Play in the simulator, and on the robot when connected', '×': 'Delete this function'}[label]; if (label === 'Run') button.dataset.motionPlay = item.id; button.onclick = () => action(item).catch(error => toast(error.message, true)); actions.append(button); } $('customFunctions').append(functionRow(item.name, `${item.motion_type} · ${item.hz} Hz · ${item.frames.length} keyframes`, actions)); }
  }
  async function refreshMotions() { motions = (await api('/api/motions')).motions; renderLibrary(); consolePanel.refreshLibrary(); }
  async function loadSaved(item) { await api(`/api/motions/${item.id}/load`, {}); await refresh?.(); toast(`Loaded “${item.name}” into the timeline.`); }
  async function playSaved(item) { control.cancelSequence(); await Promise.all([simulate({motion_id: item.id}), link.connected ? resolveMotion(item.id).then(entry => link.runSkill(entry, item.name)) : null]); }
  async function deleteSaved(item) { await api(`/api/motions/${item.id}`, {}, 'DELETE'); await refreshMotions(); toast(`Deleted “${item.name}”.`); }
  async function voiceAct(code, duration = 800) { if (link.developerMode) throw new Error('Voice actions are blocked by developer mode.'); const item = catalog.find(entry => entry.code === code); if (!item) throw new Error('Unknown Petoi function code.'); await link.sendCommand(item.code); if (item.walking) { await sleep(Math.max(200, Math.min(3000, duration))); await link.sendCommand('kbalance'); } return {status: link.status().testMode ? 'simulated' : 'sent', command: item.code}; }
  async function setDeveloperMode(enabled) { await link.setDeveloperMode(enabled); window.dispatchEvent(new CustomEvent('bittle-developer-mode', {detail: {enabled}})); }

  // Unified control: the console, library and sliders drive the simulator, and the robot too when connected.
  let sequenceEpoch = 0;
  const simulate = body => api('/api/skill', body).catch(error => { toast(error.message, true); return {simulated: false}; });
  const controlStatus = () => ({...link.status(), connected: true, robot: link.connected});
  const both = command => Promise.all([simulate({command}), link.connected ? link.press(command) : null]);
  const control = Object.assign(new EventTarget(), {
    status: controlStatus,
    cancelSequence() { sequenceEpoch++; },
    async press(command) { sequenceEpoch++; await both(command); },
    async stop() { sequenceEpoch++; await Promise.all([simulate({command: 'kbalance'}), link.connected ? link.stop() : null]); },
    async runSequence(item, {onStep} = {}) {
      const token = ++sequenceEpoch, live = () => token === sequenceEpoch;
      const wait = ms => new Promise(resolve => { const end = performance.now() + ms; const tick = () => !live() || performance.now() >= end ? resolve() : setTimeout(tick, Math.min(20, ms)); tick(); });
      try {
        do {
          for (const [index, step] of item.steps.entries()) {
            if (!live()) return;
            onStep?.(index);
            if (step.kind === 'command') await both(step.command);
            else await Promise.all([simulate({motion_id: step.motion_id}), link.connected ? resolveMotion(step.motion_id).then(entry => live() && link.sendSkill(entry, entry.name)) : null]);
            if (step.wait_ms) await wait(step.wait_ms);
          }
        } while (item.repeat && live());
      } finally { onStep?.(-1); }
    },
  });
  Object.defineProperties(control, {connected: {get: () => true}, developerMode: {get: () => link.developerMode}});
  link.addEventListener('state', () => control.dispatchEvent(new CustomEvent('state', {detail: controlStatus()})));

  // Joint sliders in the inspector mirror to the robot's servos when connected (rate-limited, packed per BLE packet).
  const pendingServos = new Map(); let servoTimer = null;
  function mirrorServos(entries) {
    if (!link.connected) return;
    entries.forEach(([servo, angle]) => pendingServos.set(servo, angle));
    if (servoTimer) return;
    servoTimer = setTimeout(async () => {
      servoTimer = null;
      const batch = [...pendingServos]; pendingServos.clear();
      for (const command of packJointCommands(batch)) await link.sendCommand(command).catch(error => toast(error.message, true));
    }, 80);
  }

  const consolePanel = initConsole($('hardwareConsole'), {
    link: control, toast, joints: false, tabs: true, extraTabs: [{label: 'Joints', element: $('jointsSection')}],
    statusText: detail => detail.robot ? `Simulator + robot · ${detail.testMode ? 'test mode, nothing is sent' : detail.transport === 'ble' ? 'Bluetooth BLE' : 'serial'}` : 'Simulator only · connect in Bluetooth to drive the robot too',
    store: {load: async () => (await api('/api/controls')).controls, save: async controls => (await api('/api/controls', {controls}, 'PUT')).controls},
    library: {list: () => motions, resolve: resolveMotion},
    tools: [
      {label: 'Save pack', title: 'Save these buttons and your Studio functions to the saved-motions folder for Bittle Link', onClick: async () => {
        const name = prompt('Name for this pack (saved in the saved-motions folder; the same name replaces the older file):', 'my-bittle-moves');
        if (!name) return;
        const saved = await saveFolderPack(name, await api('/api/controls/pack', {mapping: getMapping()}));
        toast(`Saved saved-motions/${saved.file} · ${saved.controls} buttons, ${saved.skills} Studio functions.`);
      }},
      {label: 'Open standalone ↗', title: 'Open the Bittle Link console in its own tab (no simulator needed)', onClick: () => window.open('/web/bittle-link/index.html','_blank', 'noopener')},
    ],
  });

  document.querySelectorAll('[data-hardware-tab]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-hardware-tab]').forEach(b => b.classList.toggle('selected', b === button)); document.querySelectorAll('.hardware-tab').forEach(panel => panel.classList.toggle('hidden', panel.id !== `hardware-${button.dataset.hardwareTab}-tab`)); });
  $('openHardware').onclick = () => { const model = getModel(); $('hardwareHz').value = model.motion_hz; $('hardwareDirection').value = model.direction; $('hardwareDialog').open ? $('hardwareDialog').close() : $('hardwareDialog').show(); };
  $('hardwareConnect').onclick = () => link.connect($('hardwareTransport').value)
    .then(() => { if (link.developerMode) window.dispatchEvent(new CustomEvent('bittle-developer-mode', {detail: {enabled: true}})); })
    .catch(error => { $('hardwareStatus').textContent = 'Connection failed'; toast(error.message, true); });
  $('hardwareDisconnect').onclick = () => link.disconnect().catch(error => toast(error.message, true));
  $('hardwarePlay').onclick = () => playTimelineSkill().catch(error => { link.markBusy(false); toast(error.message, true); });
  $('hardwareStop').onclick = () => link.stop().catch(error => toast(error.message, true));
  $('hardwareTerminal').onsubmit = event => { event.preventDefault(); link.sendCommand($('hardwareCommand').value).catch(error => toast(error.message, true)); };
  $('developerMode').onchange = () => setDeveloperMode($('developerMode').checked).catch(error => { render(); toast(error.message, true); });
  $('functionSearch').oninput = renderLibrary;
  const stopIfBusy = () => { if (link.status().busy) link.stop().catch(error => toast(error.message, true)); };
  $('hardwareDialog').addEventListener('close', stopIfBusy); document.addEventListener('visibilitychange', () => { if (document.hidden) stopIfBusy(); }); window.addEventListener('pagehide', () => link.cleanup());

  const publicApi = {status: link.status, sendCommand: link.sendCommand, cancel: control.stop, voiceAct, disconnect: link.disconnect, refreshMotions, mirrorServos, link};
  window.bittleHardware = publicApi; render(); renderLibrary(); refreshMotions().catch(error => toast(error.message, true)); return publicApi;
}
