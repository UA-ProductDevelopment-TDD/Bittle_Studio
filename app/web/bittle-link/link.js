// Bittle Link: transport and OpenCat protocol for a Petoi Bittle, with no DOM or Studio dependencies.
// Transports: 'ble' (Nordic UART over Web Bluetooth), 'serial' (Web Serial, 115200 baud) and 'test' (logs only).
// Events: 'log' {kind, message}, 'state' {connected, transport, testMode, busy, developerMode, message}.

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_PACKET = 20;
const STOPPED = 'Motion stopped.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Pack [servo, angle] pairs into as few "i servo angle ..." text commands as fit in one BLE packet each.
export function packJointCommands(entries, limit = BLE_PACKET - 1) {
  const commands = []; let current = 'i';
  for (const [servo, angle] of entries) {
    const pair = ` ${servo} ${Math.round(angle)}`;
    if (current !== 'i' && (current + pair).length > limit) { commands.push(current); current = 'i'; }
    current += pair;
  }
  if (current !== 'i') commands.push(current);
  return commands;
}

export function createLink() {
  const events = new EventTarget();
  let connected = false, mode = '', device, characteristic, notifications;
  let port, writer, reader, readTask, closing = false, busy = false, epoch = 0, message = '';
  let writeQueue = Promise.resolve(), uploadedSignature = '', developerMode = true;

  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, {detail}));
  const log = (kind, text) => emit('log', {kind, message: text});
  const status = () => ({connected, transport: mode, testMode: mode === 'test', busy, developerMode, message});
  const setState = (text = '') => { message = text; emit('state', status()); };
  const guard = () => { if (!connected) throw new Error('Connect Bittle first.'); };

  function received(event) { const value = new TextDecoder().decode(event.target.value); if (value) log('RX', value.replace(/[\r\n]+/g, ' ').trim()); }
  function lost() { epoch++; connected = busy = false; log('INFO', 'Bluetooth connection lost'); setState('Connection lost'); }
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

  // Connection. The browser device/port picker needs a user gesture, so call connect() from a click handler.
  async function connect(transport = 'ble') {
    await cleanup(); uploadedSignature = ''; mode = transport;
    if (mode === 'test') { connected = true; log('TEST', 'Connection simulation started'); }
    else if (mode === 'serial') {
      if (!navigator.serial) throw new Error('Web Serial is unavailable. Use Chrome or Edge on http://127.0.0.1 or https.');
      port = await navigator.serial.requestPort(); await port.open({baudRate: 115200}); writer = port.writable.getWriter(); reader = port.readable.getReader(); connected = true; readTask = readSerial(); log('INFO', 'Serial connection opened');
    } else if (mode === 'ble') {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on http://127.0.0.1 or https.');
      device = await navigator.bluetooth.requestDevice({filters: [{services: [SERVICE]}, {namePrefix: 'Bittle'}, {namePrefix: 'Petoi'}], optionalServices: [SERVICE]});
      device.addEventListener('gattserverdisconnected', lost); const server = await device.gatt.connect(); const service = await server.getPrimaryService(SERVICE);
      characteristic = await service.getCharacteristic(RX); notifications = await service.getCharacteristic(TX); notifications.addEventListener('characteristicvaluechanged', received); await notifications.startNotifications(); connected = true; log('INFO', `BLE connected: ${device.name || 'Bittle'}`);
    } else throw new Error(`Unknown transport “${transport}”.`);
    setState(mode === 'test' ? 'Test mode · nothing is sent to hardware' : `Connected · ${mode}`);
    if (developerMode) await sendCommand('gb');
  }
  async function disconnect() { epoch++; busy = false; uploadedSignature = ''; closing = true; try { await cleanup(); } finally { closing = false; connected = false; log('INFO', 'Disconnected'); setState('Not connected'); } }

  // Raw writes are queued so commands, poses and skill uploads never interleave.
  function writeBytes(bytes, description) {
    const task = writeQueue.then(async () => {
      guard();
      if (mode === 'test') { log('TEST', description); return; }
      if (characteristic) {
        for (let offset = 0; offset < bytes.length; offset += BLE_PACKET) {
          const chunk = bytes.slice(offset, offset + BLE_PACKET);
          if (characteristic.properties.write) await characteristic.writeValueWithResponse(chunk); else await characteristic.writeValueWithoutResponse(chunk);
          if (bytes.length > BLE_PACKET) await sleep(3);
        }
      } else await writer.write(bytes);
      log('TX', description);
    });
    writeQueue = task.catch(() => {}); return task;
  }
  function sendCommand(command) {
    const value = String(command).trim();
    if (!value || value.length > 64 || /[^\x20-\x7e]/.test(value)) throw new Error('Enter a printable Petoi command up to 64 characters.');
    const bytes = new TextEncoder().encode(value + '\n');
    if (characteristic && bytes.length > BLE_PACKET) throw new Error('BLE text commands may contain at most 19 characters.');
    return writeBytes(bytes, value);
  }
  function sendPose(values) {
    if (!Array.isArray(values) || !values.length || values.length % 2) throw new Error('Invalid servo pose.');
    const packet = new Uint8Array(values.length + 2); packet[0] = 'I'.charCodeAt(0);
    values.forEach((value, index) => { if (!Number.isInteger(value) || value < -128 || value > 127) throw new Error('Servo values must fit signed bytes.'); packet[index + 1] = value & 255; });
    packet[packet.length - 1] = '~'.charCodeAt(0);
    if (characteristic && packet.length > BLE_PACKET) throw new Error('A BLE pose packet may contain at most 9 joints.');
    return writeBytes(packet, `I · ${values.length / 2} joints`);
  }
  function uploadSkill(values, description) {
    const packet = new Uint8Array(values.length + 2); packet[0] = 'K'.charCodeAt(0);
    values.forEach((value, index) => packet[index + 1] = value & 255); packet[packet.length - 1] = '~'.charCodeAt(0);
    return writeBytes(packet, `${description} · K upload · ${packet.length} bytes`);
  }

  // Firmware skills: {skill: int[], signature, type}. The last uploaded skill lives in the firmware's T slot,
  // so an unchanged skill is recalled with a single 'T' instead of a full upload.
  async function sendSkill({skill, signature}, name = 'Custom skill') {
    guard();
    if (signature && uploadedSignature === signature) { await sendCommand('T'); log('INFO', `${name} recalled instantly with T`); }
    else { await uploadSkill(skill, name); uploadedSignature = signature || ''; log('INFO', `${name} stored as the firmware's T skill`); }
  }
  async function runSkill(entry, name) {
    busy = true; setState(`Starting ${name}…`);
    try { await sendSkill(entry, name); busy = entry.type === 'gait'; setState(busy ? `${name} running in firmware · press Stop` : `${name} started in firmware`); }
    catch (error) { busy = false; setState(); throw error; }
  }

  // Cancellation: every new action bumps the epoch; long-running loops abort when their token is stale.
  function wait(ms, token) { return new Promise((resolve, reject) => { const started = performance.now(); const tick = () => { if (!connected || token !== epoch) return reject(new Error(STOPPED)); if (performance.now() - started >= ms) return resolve(); setTimeout(tick, Math.min(20, ms)); }; tick(); }); }
  async function press(command) {
    guard(); epoch++; busy = false; await sendCommand(command);
    // gb/gB are developer mode's own commands, so keep its state truthful when they are sent directly.
    if (command === 'gb' || command === 'gB') { developerMode = command === 'gb'; log('INFO', developerMode ? 'Gyro off · developer mode on' : 'Gyro on · developer mode off'); }
    setState();
  }
  async function stop() { epoch++; const active = busy; busy = false; setState('Stopping…'); if (connected) await sendCommand('kbalance'); setState(connected ? 'Connected · motion stopped' : 'Not connected'); if (active) log('INFO', 'Motion stopped; balance pose requested'); }
  async function setDeveloperMode(enabled) { if (busy) await stop(); developerMode = !!enabled; if (connected) await sendCommand(enabled ? 'gb' : 'gB'); log('INFO', enabled ? 'Developer mode enabled' : 'Developer mode disabled'); setState(); }

  // Streams timestamped servo poses [[seconds, values], ...] with I packets; gaits loop until stopped.
  async function playSamples(samples, motionType, hz) {
    if (!samples.length) throw new Error('This motion has no samples.');
    const token = ++epoch; busy = true; setState(`Sending ${motionType}${hz ? ` · ${hz} Hz` : ''}`);
    try {
      await sendPose(samples[0][1]); if (motionType === 'pose') return;
      let firstRound = true, round = 0;
      do {
        round++; const start = performance.now();
        for (const [timestamp, values] of firstRound ? samples.slice(1) : samples) { const delay = start + timestamp * 1000 - performance.now(); if (delay > 0) await wait(delay, token); if (token !== epoch) throw new Error(STOPPED); await sendPose(values); }
        log('INFO', `Round ${round} complete`); firstRound = false;
      } while (motionType === 'gait' && token === epoch && connected);
    } catch (error) { if (error.message !== STOPPED) throw error; }
    finally { if (token === epoch) busy = false; setState(connected ? 'Connected · ready' : 'Not connected'); }
  }

  // Composed buttons: {name, repeat, steps: [{kind: 'command', command, wait_ms} | {kind: 'motion', motion_id, wait_ms}]}.
  // resolveMotion(motion_id) must return a firmware skill entry {skill, signature, type, name}.
  async function runSequence(item, {resolveMotion, onStep} = {}) {
    guard();
    const token = ++epoch; busy = false; setState(`Running ${item.name}`); log('INFO', `Composed skill “${item.name}” started`);
    try {
      do {
        for (const [index, step] of item.steps.entries()) {
          if (token !== epoch || !connected) throw new Error(STOPPED);
          onStep?.(index);
          if (step.kind === 'command') await sendCommand(step.command);
          else {
            if (!resolveMotion) throw new Error('This console cannot run Studio functions.');
            const entry = await resolveMotion(step.motion_id);
            if (token !== epoch) throw new Error(STOPPED);
            await sendSkill(entry, entry.name || 'Studio function');
          }
          if (step.wait_ms) await wait(step.wait_ms, token);
        }
      } while (item.repeat && token === epoch && connected);
      log('INFO', `Composed skill “${item.name}” finished`);
    } catch (error) { if (error.message !== STOPPED) throw error; log('INFO', `Composed skill “${item.name}” interrupted`); }
    finally { onStep?.(-1); if (token === epoch) setState(connected ? 'Connected · ready' : 'Not connected'); }
  }

  Object.assign(events, {
    status, connect, disconnect, cleanup, sendCommand, sendPose, uploadSkill, sendSkill, runSkill,
    press, stop, setDeveloperMode, playSamples, runSequence,
    markBusy(value, text) { busy = !!value; setState(text); },
  });
  // Live getters (Object.assign would copy their current values instead).
  return Object.defineProperties(events, {connected: {get: () => connected}, developerMode: {get: () => developerMode}});
}
