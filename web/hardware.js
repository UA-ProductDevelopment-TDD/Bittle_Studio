const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export function initHardware({api, toast, getModel, getMapping}) {
  const $ = id => document.getElementById(id);
  let connected = false, mode = '', device, characteristic, notifications;
  let port, writer, reader, readTask, closing = false, playing = false, epoch = 0;
  let writeQueue = Promise.resolve();

  function log(kind, message) {
    const time = new Date().toLocaleTimeString([], {hour12: false});
    $('hardwareLog').textContent = (`${time}  ${kind.padEnd(5)}  ${message}\n` + $('hardwareLog').textContent).slice(0, 14000);
  }

  function render(message) {
    $('hardwareStatus').textContent = message || (connected ? `Connected · ${mode}` : 'Not connected');
    $('hardwareConnect').disabled = connected;
    $('hardwareDisconnect').disabled = !connected;
    $('hardwarePlay').disabled = !connected || playing;
    $('hardwareStop').disabled = !connected || !playing;
    $('hardwareSend').disabled = !connected || playing;
    $('hardwareTransport').disabled = connected;
  }

  function received(event) {
    const text = new TextDecoder().decode(event.target.value);
    if (text) log('RX', text.replace(/[\r\n]+/g, ' ').trim());
  }

  function lost() {
    epoch++;
    connected = playing = false;
    render('Connection lost');
    log('INFO', 'Bluetooth connection lost');
  }

  async function readSerial() {
    const decoder = new TextDecoder();
    try {
      while (reader) {
        const {value, done} = await reader.read();
        if (done) break;
        const text = decoder.decode(value, {stream: true});
        if (text) log('RX', text.replace(/[\r\n]+/g, ' ').trim());
      }
    } catch (error) {
      if (!closing) log('ERROR', error.message);
    }
  }

  async function cleanup() {
    if (device) {
      device.removeEventListener('gattserverdisconnected', lost);
      notifications?.removeEventListener('characteristicvaluechanged', received);
      if (device.gatt.connected) device.gatt.disconnect();
      device = characteristic = notifications = null;
    }
    if (reader) {
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
      reader = null;
    }
    if (readTask) { try { await readTask; } catch {} readTask = null; }
    if (writer) { try { writer.releaseLock(); } catch {} writer = null; }
    if (port) { try { await port.close(); } catch {} port = null; }
  }

  async function connect() {
    await cleanup();
    mode = $('hardwareTransport').value;
    if (mode === 'test') {
      connected = true;
      render('Test mode · nothing is sent to hardware');
      log('TEST', 'Connection simulation started');
      return;
    }
    if (mode === 'serial') {
      if (!navigator.serial) throw new Error('Web Serial is unavailable. Use Chrome or Edge on http://127.0.0.1.');
      port = await navigator.serial.requestPort();
      await port.open({baudRate: 115200});
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
      connected = true;
      readTask = readSerial();
      render('Connected · serial at 115200 baud');
      log('INFO', 'Serial connection opened');
      return;
    }
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on http://127.0.0.1.');
    device = await navigator.bluetooth.requestDevice({
      filters: [{services: [SERVICE]}, {namePrefix: 'Bittle'}, {namePrefix: 'Petoi'}],
      optionalServices: [SERVICE]
    });
    device.addEventListener('gattserverdisconnected', lost);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    characteristic = await service.getCharacteristic(RX);
    notifications = await service.getCharacteristic(TX);
    notifications.addEventListener('characteristicvaluechanged', received);
    await notifications.startNotifications();
    connected = true;
    render(`Connected · ${device.name || 'Bittle BLE'}`);
    log('INFO', `BLE connected: ${device.name || 'Bittle'}`);
  }

  async function disconnect() {
    epoch++;
    playing = false;
    closing = true;
    try { await cleanup(); } finally {
      closing = false;
      connected = false;
      render('Not connected');
      log('INFO', 'Disconnected');
    }
  }

  function writeBytes(bytes, description) {
    const task = writeQueue.then(async () => {
      if (!connected) throw new Error('Connect Bittle first.');
      if (mode === 'test') { log('TEST', description); return; }
      if (characteristic) {
        if (bytes.length > 20) throw new Error('A BLE packet may contain at most 20 bytes.');
        if (characteristic.properties.write) await characteristic.writeValueWithResponse(bytes);
        else await characteristic.writeValueWithoutResponse(bytes);
      } else {
        await writer.write(bytes);
      }
      log('TX', description);
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  function sendPose(values) {
    if (!Array.isArray(values) || !values.length || values.length % 2) throw new Error('Invalid servo pose.');
    const packet = new Uint8Array(values.length + 2);
    packet[0] = 'I'.charCodeAt(0);
    values.forEach((value, index) => {
      if (!Number.isInteger(value) || value < -128 || value > 127) throw new Error('Servo values must fit signed bytes.');
      packet[index + 1] = value & 255;
    });
    packet[packet.length - 1] = '~'.charCodeAt(0);
    return writeBytes(packet, `I · ${values.length / 2} joints`);
  }

  function sendCommand(command) {
    const value = command.trim();
    if (!value || value.length > 64 || /[^\x20-\x7e]/.test(value)) throw new Error('Enter a printable Petoi command up to 64 characters.');
    const bytes = new TextEncoder().encode(value + '\n');
    if (characteristic && bytes.length > 20) throw new Error('BLE text commands may contain at most 19 characters.');
    return writeBytes(bytes, value);
  }

  function wait(ms, token) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => {
        if (!connected || token !== epoch) return reject(new Error('Motion stopped.'));
        if (performance.now() - started >= ms) return resolve();
        setTimeout(tick, Math.min(20, ms));
      };
      tick();
    });
  }

  async function play() {
    const motionType = $('hardwareType').value;
    const body = {
      mapping: getMapping(), motion_type: motionType,
      hz: Number($('hardwareHz').value), speed: Number($('hardwareSpeed').value),
      direction: $('hardwareDirection').value
    };
    const result = await api('/api/motion-samples', body);
    const samples = result.samples;
    const token = ++epoch;
    playing = true;
    render(`Sending ${motionType} · ${result.metadata.hz} Hz`);
    try {
      await sendPose(samples[0][1]);
      if (motionType === 'pose') {
        log('INFO', 'Pose sent once');
        return;
      }
      let firstRound = true, round = 0;
      do {
        round++;
        const start = performance.now();
        const sequence = firstRound ? samples.slice(1) : samples;
        for (const [timestamp, values] of sequence) {
          const delay = start + timestamp * 1000 - performance.now();
          if (delay > 0) await wait(delay, token);
          if (token !== epoch) throw new Error('Motion stopped.');
          await sendPose(values);
        }
        log('INFO', `Round ${round} complete`);
        firstRound = false;
      } while (motionType === 'gait' && token === epoch && connected);
    } catch (error) {
      if (error.message !== 'Motion stopped.') throw error;
    } finally {
      if (token === epoch) playing = false;
      render(connected ? 'Connected · ready' : 'Not connected');
    }
  }

  async function stop() {
    epoch++;
    const wasPlaying = playing;
    playing = false;
    render('Stopping…');
    if (connected) await sendCommand('kbalance');
    render('Connected · motion stopped');
    if (wasPlaying) log('INFO', 'Motion stopped; balance pose requested');
  }

  $('openHardware').addEventListener('click', () => {
    const model = getModel();
    $('hardwareHz').value = model.motion_hz;
    $('hardwareDirection').value = model.direction;
    $('hardwareDialog').showModal();
  });
  $('hardwareConnect').addEventListener('click', () => connect().catch(error => {render('Connection failed'); toast(error.message, true);}));
  $('hardwareDisconnect').addEventListener('click', () => disconnect().catch(error => toast(error.message, true)));
  $('hardwarePlay').addEventListener('click', () => play().catch(error => {playing = false; render('Connected · ready'); toast(error.message, true);}));
  $('hardwareStop').addEventListener('click', () => stop().catch(error => toast(error.message, true)));
  $('hardwareTerminal').addEventListener('submit', event => {event.preventDefault(); sendCommand($('hardwareCommand').value).catch(error => toast(error.message, true));});
  $('hardwareDialog').addEventListener('close', () => {
    if (playing) stop().catch(error => log('ERROR', error.message));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) stop().catch(error => log('ERROR', error.message));
  });
  window.addEventListener('pagehide', () => { epoch++; cleanup(); });
  render();
  return {disconnect};
}
