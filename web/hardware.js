import {catalog} from './petoi-skills.js';
import {initConsole} from './console.js';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function initHardware({api, toast, getModel, getMapping, refresh}) {
  const $ = id => document.getElementById(id);
  let connected = false, mode = '', device, characteristic, notifications;
  let port, writer, reader, readTask, closing = false, playing = false, epoch = 0;
  let writeQueue = Promise.resolve(), motions = [], uploadedSkillSignature = '';

  function log(kind, message) {
    const time = new Date().toLocaleTimeString([], {hour12: false});
    $('hardwareLog').textContent = (`${time}  ${kind.padEnd(5)}  ${message}\n` + $('hardwareLog').textContent).slice(0, 14000);
  }
  function developerMode() { return $('developerMode').checked; }
  function status() { return {connected, transport: mode, testMode: mode === 'test', busy: playing, developerMode: developerMode()}; }
  function render(message) {
    $('hardwareStatus').textContent = message || (connected ? `Connected · ${mode}` : 'Not connected');
    $('hardwareConnect').disabled = connected; $('hardwareDisconnect').disabled = !connected;
    $('hardwarePlay').disabled = !connected || playing; $('hardwareStop').disabled = !connected;
    $('hardwareSend').disabled = !connected || playing; $('hardwareTransport').disabled = connected;
    document.querySelectorAll('[data-skill-code], [data-motion-play]').forEach(button => button.disabled = !connected || playing);
    $('developerStatus').textContent = developerMode() ? (connected ? 'Active · background voice, autonomous actions and gyro/balance assistance are off.' : 'Will activate when connected.') : (connected ? 'Off · balance assistance and voice actions are available.' : 'Off.');
    $('developerStatus').classList.toggle('active', developerMode() && connected);
    window.dispatchEvent(new CustomEvent('bittle-hardware-state', {detail: status()}));
  }
  function received(event) { const value = new TextDecoder().decode(event.target.value); if (value) log('RX', value.replace(/[\r\n]+/g, ' ').trim()); }
  function lost() { epoch++; connected = playing = false; render('Connection lost'); log('INFO', 'Bluetooth connection lost'); }

  async function readSerial() {
    const decoder = new TextDecoder();
    try { while (reader) { const {value, done} = await reader.read(); if (done) break; const text = decoder.decode(value, {stream: true}); if (text) log('RX', text.replace(/[\r\n]+/g, ' ').trim()); } }
    catch (error) { if (!closing) log('ERROR', error.message); }
  }
  async function cleanup() {
    if (device) { device.removeEventListener('gattserverdisconnected', lost); notifications?.removeEventListener('characteristicvaluechanged', received); if (device.gatt.connected) device.gatt.disconnect(); device = characteristic = notifications = null; }
    if (reader) { try { await reader.cancel(); } catch {} try { reader.releaseLock(); } catch {} reader = null; }
    if (readTask) { try { await readTask; } catch {} readTask = null; }
    if (writer) { try { writer.releaseLock(); } catch {} writer = null; }
    if (port) { try { await port.close(); } catch {} port = null; }
  }
  async function connect() {
    await cleanup(); uploadedSkillSignature = ''; mode = $('hardwareTransport').value;
    if (mode === 'test') { connected = true; log('TEST', 'Connection simulation started'); }
    else if (mode === 'serial') {
      if (!navigator.serial) throw new Error('Web Serial is unavailable. Use Chrome or Edge on http://127.0.0.1.');
      port = await navigator.serial.requestPort(); await port.open({baudRate: 115200}); writer = port.writable.getWriter(); reader = port.readable.getReader(); connected = true; readTask = readSerial(); log('INFO', 'Serial connection opened');
    } else {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on http://127.0.0.1.');
      device = await navigator.bluetooth.requestDevice({filters: [{services: [SERVICE]}, {namePrefix: 'Bittle'}, {namePrefix: 'Petoi'}], optionalServices: [SERVICE]});
      device.addEventListener('gattserverdisconnected', lost); const server = await device.gatt.connect(); const service = await server.getPrimaryService(SERVICE);
      characteristic = await service.getCharacteristic(RX); notifications = await service.getCharacteristic(TX); notifications.addEventListener('characteristicvaluechanged', received); await notifications.startNotifications(); connected = true; log('INFO', `BLE connected: ${device.name || 'Bittle'}`);
    }
    render(mode === 'test' ? 'Test mode · nothing is sent to hardware' : `Connected · ${mode}`);
    if (developerMode()) await applyDeveloperMode(true);
  }
  async function disconnect() { epoch++; playing = false; uploadedSkillSignature = ''; closing = true; try { await cleanup(); } finally { closing = false; connected = false; render('Not connected'); log('INFO', 'Disconnected'); } }
  function writeBytes(bytes, description) {
    const task = writeQueue.then(async () => {
      if (!connected) throw new Error('Connect Bittle first.');
      if (mode === 'test') { log('TEST', description); return; }
      if (characteristic) { if (bytes.length > 20) throw new Error('A BLE packet may contain at most 20 bytes.'); if (characteristic.properties.write) await characteristic.writeValueWithResponse(bytes); else await characteristic.writeValueWithoutResponse(bytes); }
      else await writer.write(bytes);
      log('TX', description);
    }); writeQueue = task.catch(() => {}); return task;
  }
  function sendPose(values) {
    if (!Array.isArray(values) || !values.length || values.length % 2) throw new Error('Invalid servo pose.');
    const packet = new Uint8Array(values.length + 2); packet[0] = 73;
    values.forEach((value, index) => { if (!Number.isInteger(value) || value < -128 || value > 127) throw new Error('Servo values must fit signed bytes.'); packet[index + 1] = value & 255; }); packet[packet.length - 1] = 126;
    return writeBytes(packet, `I · ${values.length / 2} joints`);
  }
  function sendCommand(command) {
    const value = command.trim(); if (!value || value.length > 64 || /[^\x20-\x7e]/.test(value)) throw new Error('Enter a printable Petoi command up to 64 characters.');
    const bytes = new TextEncoder().encode(value + '\n'); if (characteristic && bytes.length > 20) throw new Error('BLE text commands may contain at most 19 characters.'); return writeBytes(bytes, value);
  }
  function uploadSkill(values, description) {
    const packet = new Uint8Array(values.length + 2); packet[0] = 'K'.charCodeAt(0); values.forEach((value, index) => packet[index + 1] = value & 255); packet[packet.length - 1] = '~'.charCodeAt(0);
    const task = writeQueue.then(async () => {
      if (!connected) throw new Error('Connect Bittle first.');
      if (mode === 'test') { log('TEST', `${description} · K upload · ${packet.length} bytes`); return; }
      if (characteristic) {
        for (let offset = 0; offset < packet.length; offset += 20) { const chunk = packet.slice(offset, offset + 20); if (characteristic.properties.write) await characteristic.writeValueWithResponse(chunk); else await characteristic.writeValueWithoutResponse(chunk); await sleep(3); }
      } else await writer.write(packet);
      log('TX', `${description} · K upload · ${packet.length} bytes`);
    });
    writeQueue = task.catch(() => {}); return task;
  }
  function wait(ms, token) { return new Promise((resolve, reject) => { const started = performance.now(); const tick = () => { if (!connected || token !== epoch) return reject(new Error('Motion stopped.')); if (performance.now() - started >= ms) return resolve(); setTimeout(tick, Math.min(20, ms)); }; tick(); }); }

  async function playSamples(result, motionType) {
    const samples = result.samples; if (!samples.length) throw new Error('This motion has no samples.'); const token = ++epoch; playing = true; render(`Sending ${motionType} · ${result.metadata.hz} Hz`);
    try { await sendPose(samples[0][1]); if (motionType === 'pose') return; let firstRound = true, round = 0;
      do { round++; const start = performance.now(); const sequence = firstRound ? samples.slice(1) : samples;
        for (const [timestamp, values] of sequence) { const delay = start + timestamp * 1000 - performance.now(); if (delay > 0) await wait(delay, token); if (token !== epoch) throw new Error('Motion stopped.'); await sendPose(values); }
        log('INFO', `Round ${round} complete`); firstRound = false;
      } while (motionType === 'gait' && token === epoch && connected);
    } catch (error) { if (error.message !== 'Motion stopped.') throw error; }
    finally { if (token === epoch) playing = false; render(connected ? 'Connected · ready' : 'Not connected'); }
  }
  async function playTimeline() { const type = $('hardwareType').value; const result = await api('/api/motion-samples', {mapping: getMapping(), motion_type: type, hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value), direction: $('hardwareDirection').value}); await playSamples(result, type); }
  async function sendFirmwareSkill(result, name) {
    if (uploadedSkillSignature === result.metadata.signature) { await sendCommand('T'); log('INFO', `${name} recalled instantly with T`); }
    else { await uploadSkill(result.skill, name); uploadedSkillSignature = result.metadata.signature; log('INFO', `${name} stored as the firmware's T skill`); }
  }
  async function runFirmwareSkill(result, name) {
    const type = result.metadata.type; playing = true; render(`Starting ${name}…`);
    try {
      await sendFirmwareSkill(result, name);
      playing = type === 'gait';
      render(type === 'gait' ? `${name} running in firmware · press Stop` : `${name} started in firmware`);
    } catch (error) { playing = false; render(); throw error; }
  }
  async function playTimelineSkill() { const type = $('hardwareType').value; const result = await api('/api/motion-skill', {mapping: getMapping(), motion_type: type, hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value), direction: $('hardwareDirection').value}); await runFirmwareSkill(result, 'Current timeline'); }
  // Console actions: any new press cancels a running composed sequence, like the Petoi app's controller.
  async function consoleCommand(command) { if (!connected) throw new Error('Connect Bittle first.'); epoch++; playing = false; await sendCommand(command); render(); }
  async function runSequence(item, onStep) {
    if (!connected) throw new Error('Connect Bittle first.');
    const token = ++epoch; playing = false; render(`Running ${item.name}`); log('INFO', `Composed skill “${item.name}” started`);
    try {
      do {
        for (const [index, step] of item.steps.entries()) {
          if (token !== epoch || !connected) throw new Error('Motion stopped.');
          onStep?.(index);
          if (step.kind === 'command') await sendCommand(step.command);
          else { const result = await api(`/api/motions/${step.motion_id}/skill`, {mapping: getMapping()}); if (token !== epoch) throw new Error('Motion stopped.'); await sendFirmwareSkill(result, step.label || 'Studio function'); }
          if (step.wait_ms) await wait(step.wait_ms, token);
        }
      } while (item.repeat && token === epoch && connected);
      log('INFO', `Composed skill “${item.name}” finished`);
    } catch (error) { if (error.message !== 'Motion stopped.') throw error; log('INFO', `Composed skill “${item.name}” interrupted`); }
    finally { onStep?.(-1); if (token === epoch) render(connected ? 'Connected · ready' : 'Not connected'); }
  }
  async function stop() { epoch++; const active = playing; playing = false; render('Stopping…'); if (connected) await sendCommand('kbalance'); render('Connected · motion stopped'); if (active) log('INFO', 'Motion stopped; balance pose requested'); }
  async function applyDeveloperMode(enabled) { if (playing) await stop(); if (connected) await sendCommand(enabled ? 'gb' : 'gB'); log('INFO', enabled ? 'Developer mode enabled' : 'Developer mode disabled'); window.dispatchEvent(new CustomEvent('bittle-developer-mode', {detail: {enabled}})); render(); }

  function functionRow(title, detail, actions) { const row = document.createElement('div'); row.className = 'function-row'; const copy = document.createElement('div'); const b = document.createElement('b'), small = document.createElement('small'); b.textContent = title; small.textContent = detail; copy.append(b, small); row.append(copy, actions); return row; }
  function renderLibrary() {
    const q = $('functionSearch').value.trim().toLowerCase(); $('builtinFunctions').replaceChildren();
    for (const item of catalog.filter(item => !q || `${item.label} ${item.code}`.toLowerCase().includes(q))) { const button = document.createElement('button'); button.textContent = item.walking ? 'Start gait' : 'Run'; button.dataset.skillCode = item.code; button.disabled = !connected || playing; button.onclick = () => runSkill(item).catch(error => toast(error.message, true)); $('builtinFunctions').append(functionRow(item.label, `${item.code}${item.walking ? ' · gait' : ''}`, button)); }
    $('customFunctions').replaceChildren(); if (!motions.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = 'Save the current timeline to create your first function.'; $('customFunctions').append(p); }
    for (const item of motions.filter(item => !q || item.name.toLowerCase().includes(q))) { const actions = document.createElement('div'); actions.className = 'row-actions'; for (const [label, action] of [['Load', loadSaved], ['Run', playSaved], ['×', deleteSaved]]) { const button = document.createElement('button'); button.textContent = label; if (label === 'Run') button.dataset.motionPlay = item.id; button.onclick = () => action(item).catch(error => toast(error.message, true)); actions.append(button); } $('customFunctions').append(functionRow(item.name, `${item.motion_type} · ${item.hz} Hz · ${item.frames.length} keyframes`, actions)); }
  }
  async function refreshMotions() { motions = (await api('/api/motions')).motions; renderLibrary(); window.dispatchEvent(new CustomEvent('bittle-motions', {detail: motions})); }
  async function runSkill(item) { if (!connected) throw new Error('Connect Bittle first.'); await sendCommand(item.code); if (item.walking) { playing = true; render('Gait running · press Stop'); } }
  async function loadSaved(item) { await api(`/api/motions/${item.id}/load`, {}); await refresh?.(); toast(`Loaded “${item.name}” into the timeline.`); }
  async function playSaved(item) { const result = await api(`/api/motions/${item.id}/skill`, {mapping: getMapping()}); await runFirmwareSkill(result, item.name); }
  async function deleteSaved(item) { await api(`/api/motions/${item.id}`, {}, 'DELETE'); await refreshMotions(); toast(`Deleted “${item.name}”.`); }
  async function voiceAct(code, duration = 800) { if (developerMode()) throw new Error('Voice actions are blocked by developer mode.'); const item = catalog.find(entry => entry.code === code); if (!item) throw new Error('Unknown Petoi function code.'); await sendCommand(item.code); if (item.walking) { await sleep(Math.max(200, Math.min(3000, duration))); await sendCommand('kbalance'); } return {status: mode === 'test' ? 'simulated' : 'sent', command: item.code}; }

  document.querySelectorAll('[data-hardware-tab]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-hardware-tab]').forEach(b => b.classList.toggle('selected', b === button)); document.querySelectorAll('.hardware-tab').forEach(panel => panel.classList.toggle('hidden', panel.id !== `hardware-${button.dataset.hardwareTab}-tab`)); });
  $('openHardware').onclick = () => { const model = getModel(); $('hardwareHz').value = model.motion_hz; $('hardwareDirection').value = model.direction; $('hardwareDialog').showModal(); refreshMotions().catch(error => toast(error.message, true)); };
  $('hardwareConnect').onclick = () => connect().catch(error => { render('Connection failed'); toast(error.message, true); }); $('hardwareDisconnect').onclick = () => disconnect().catch(error => toast(error.message, true));
  $('hardwarePlay').onclick = () => playTimelineSkill().catch(error => { playing = false; render(); toast(error.message, true); }); $('hardwareStop').onclick = () => stop().catch(error => toast(error.message, true));
  $('hardwareTerminal').onsubmit = event => { event.preventDefault(); sendCommand($('hardwareCommand').value).catch(error => toast(error.message, true)); };
  $('developerMode').onchange = () => applyDeveloperMode(developerMode()).catch(error => { $('developerMode').checked = !$('developerMode').checked; render(); toast(error.message, true); }); $('functionSearch').oninput = renderLibrary;
  $('saveMotionForm').onsubmit = async event => { event.preventDefault(); try { await api('/api/motions', {name: $('motionName').value, motion_type: $('savedMotionType').value, hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value), direction: $('hardwareDirection').value}); $('motionName').value = ''; await refreshMotions(); toast('Timeline saved to My Studio functions.'); } catch (error) { toast(error.message, true); } };
  $('hardwareDialog').addEventListener('close', () => { if (playing) stop().catch(error => log('ERROR', error.message)); }); document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stop().catch(error => log('ERROR', error.message)); }); window.addEventListener('pagehide', () => { epoch++; cleanup(); });
  const publicApi = {status, sendCommand, consoleCommand, runSequence, cancel: stop, voiceAct, disconnect, motions: () => motions, refreshMotions}; window.bittleHardware = publicApi; initConsole({api, toast, hardware: publicApi}); render(); renderLibrary(); return publicApi;
}
