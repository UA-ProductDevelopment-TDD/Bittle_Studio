import {catalog} from './petoi-skills.js';

// Controller layout modelled on the Petoi app: a gait pad, posture and skill grids, and user-composed buttons.
const GAITS = [['wk', 'Walk'], ['tr', 'Trot'], ['cr', 'Crawl'], ['gp', 'Gallop'], ['vt', 'Step'], ['lft', 'High step'], ['ph', 'Hop'], ['carpet', 'Carpet']];
const PAD = [['↖', 'L', 'Forward left'], ['↑', 'F', 'Forward'], ['↗', 'R', 'Forward right'], ['⟲', 'kvtL', 'Turn left on the spot'], ['■', 'kbalance', 'Stop'], ['⟳', 'kvtR', 'Turn right on the spot'], ['↙', 'kbkL', 'Back left'], ['↓', 'kbk', 'Back'], ['↘', 'kbkR', 'Back right']];
const POSTURES = [['kbalance', 'Balance'], ['kup', 'Stand up'], ['ksit', 'Sit'], ['krest', 'Rest'], ['kstr', 'Stretch'], ['kbuttUp', 'Butt up'], ['kzero', 'Zero'], ['kcalib', 'Calibrate'], ['m 0 30', 'Look left'], ['m 0 0', 'Look ahead'], ['m 0 -30', 'Look right']];
const SKILLS = [['khi', 'Hi'], ['khsk', 'Shake paw'], ['kfiv', 'High five'], ['kgdb', 'Goodbye'], ['khg', 'Hug'], ['kchr', 'Cheer'], ['knd', 'Nod'], ['kwh', 'Head wave'], ['ksnf', 'Sniff'], ['kscrh', 'Scratch'], ['kck', 'Check'], ['kdg', 'Dig'], ['kpee', 'Pee'], ['kpu', 'Push-ups'], ['kpu1', 'One-arm push-up'], ['kbx', 'Box'], ['kkc', 'Kick'], ['kjmp', 'Jump'], ['kmw', 'Moonwalk'], ['kts', 'Twist'], ['kzz', 'Zigzag'], ['krl', 'Roll'], ['kpd', 'Play dead'], ['krc', 'Recover'], ['kff', 'Front flip', true], ['kbf', 'Back flip', true]];
const COLORS = ['green', 'blue', 'amber', 'red', 'violet', 'grey'];
const WALKING = new Set(catalog.filter(item => item.walking).map(item => item.code));

export function initConsole({api, toast, hardware}) {
  const $ = id => document.getElementById(id);
  let controls = [], gait = 'wk', editing = null, activeId = null, activeStep = -1, connected = false;
  const button = (label, title, onclick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; if (className) b.className = className; b.onclick = onclick; return b; };
  const fail = error => toast(error.message, true);

  // A press either sends immediately or, while recording, also appends a step to the button being edited.
  function press(command, label) {
    if (editing && $('consoleRecord').checked) { editing.steps.push({kind: 'command', command, wait_ms: WALKING.has(command.split(' ')[0]) ? 2000 : 1500}); renderEditor(); }
    if (connected) hardware.consoleCommand(command).catch(fail);
    else if (!editing || !$('consoleRecord').checked) toast('Connect Bittle first (Connection tab).', true);
    $('consoleLast').textContent = `${label} · ${command}`;
  }
  function renderStatic() {
    $('consoleGaits').replaceChildren(...GAITS.map(([code, label]) => { const b = button(label, `k${code}F / L / R`, () => { gait = code; renderStatic(); }); b.classList.toggle('selected', code === gait); return b; }));
    $('consolePad').replaceChildren(...PAD.map(([glyph, code, title]) => {
      const command = code.length === 1 ? `k${gait}${code}` : code;
      return button(glyph, `${title} · ${command}`, () => press(command, title), code === 'kbalance' ? 'pad-stop' : '');
    }));
    $('consolePostures').replaceChildren(...POSTURES.map(([code, label]) => button(label, code, () => press(code, label))));
    $('consoleSkills').replaceChildren(...SKILLS.map(([code, label, risky]) => button(risky ? `⚠ ${label}` : label, risky ? `${code} · needs free space and a soft floor` : code, () => press(code, label), risky ? 'risky' : '')));
  }
  function renderControls() {
    const list = $('consoleCustom'); list.replaceChildren();
    for (const item of controls) {
      const b = button(item.name, `${item.steps.length} step${item.steps.length === 1 ? '' : 's'}${item.repeat ? ' · repeats' : ''}`, () => editMode() ? openEditor(item) : run(item), `custom-button color-${item.color}`);
      if (item.id === activeId) b.classList.add('running');
      if (item.repeat) b.append(Object.assign(document.createElement('small'), {textContent: '↻'}));
      list.append(b);
    }
    list.append(button('+ New button', 'Compose a new button', () => openEditor(null), 'custom-add'));
    $('consoleCustomHint').textContent = controls.length ? (editMode() ? 'Click a button to edit it.' : 'Click to run. Any other press or Stop interrupts it.') : 'Compose buttons from Petoi commands and your saved Studio functions.';
  }
  const editMode = () => $('consoleEditMode').checked;
  async function run(item) {
    if (!connected) return toast('Connect Bittle first (Connection tab).', true);
    activeId = item.id; renderControls();
    try { await hardware.runSequence({...item, steps: item.steps.map(step => ({...step, label: motionName(step.motion_id)}))}, index => { activeStep = index; }); }
    catch (error) { fail(error); }
    finally { if (activeId === item.id) { activeId = null; renderControls(); } }
  }
  async function save(next) { controls = (await api('/api/controls', {controls: next}, 'PUT')).controls; renderControls(); }
  async function load() { controls = (await api('/api/controls')).controls; renderControls(); }

  // Editor
  const motionName = id => hardware.motions().find(item => item.id === id)?.name;
  function openEditor(item) {
    editing = item ? structuredClone(item) : {id: '', name: '', color: 'green', repeat: false, steps: []};
    $('consoleEditor').classList.remove('hidden'); $('consoleEditorTitle').textContent = item ? `Edit “${item.name}”` : 'New button';
    $('consoleButtonName').value = editing.name; $('consoleButtonRepeat').checked = editing.repeat; $('consoleDelete').classList.toggle('hidden', !item);
    renderEditor(); $('consoleButtonName').focus();
  }
  function closeEditor() { editing = null; $('consoleRecord').checked = false; $('consoleEditor').classList.add('hidden'); }
  function renderEditor() {
    if (!editing) return;
    $('consoleColors').replaceChildren(...COLORS.map(color => { const b = button('', color, () => { editing.color = color; renderEditor(); }, `swatch color-${color}`); b.setAttribute('aria-pressed', color === editing.color); b.setAttribute('aria-label', color); return b; }));
    const motions = hardware.motions(), rows = $('consoleSteps'); rows.replaceChildren();
    if (!editing.steps.length) rows.append(Object.assign(document.createElement('p'), {className: 'note', textContent: 'No steps yet. Add one below, or tick “Record presses” and use the pad and skill buttons.'}));
    editing.steps.forEach((step, index) => {
      const row = document.createElement('div'); row.className = 'step-row';
      const number = Object.assign(document.createElement('span'), {className: 'step-number', textContent: index + 1});
      const kind = document.createElement('select'); kind.innerHTML = '<option value="command">Command</option><option value="motion">Studio function</option>'; kind.value = step.kind;
      kind.onchange = () => { editing.steps[index] = kind.value === 'command' ? {kind: 'command', command: 'kbalance', wait_ms: step.wait_ms} : {kind: 'motion', motion_id: motions[0]?.id || '', wait_ms: step.wait_ms}; renderEditor(); };
      let target;
      if (step.kind === 'command') { target = document.createElement('input'); target.value = step.command; target.maxLength = 64; target.setAttribute('list', 'petoiCodes'); target.placeholder = 'ksit, kwkF, m 0 30…'; target.oninput = () => { step.command = target.value; }; }
      else {
        target = document.createElement('select');
        if (!motions.length) target.append(new Option('No saved Studio functions', ''));
        if (step.motion_id && !motionName(step.motion_id)) target.append(new Option('(deleted function)', step.motion_id));
        motions.forEach(item => target.append(new Option(`${item.name} · ${item.motion_type}`, item.id)));
        target.value = step.motion_id; target.onchange = () => { step.motion_id = target.value; };
      }
      const wait = document.createElement('input'); wait.type = 'number'; wait.min = 0; wait.max = 60000; wait.step = 100; wait.value = step.wait_ms; wait.title = 'Wait after this step (ms)'; wait.oninput = () => { step.wait_ms = Math.max(0, Math.min(60000, Math.round(Number(wait.value) || 0))); };
      const move = (delta) => () => { const to = index + delta; if (to < 0 || to >= editing.steps.length) return; [editing.steps[index], editing.steps[to]] = [editing.steps[to], editing.steps[index]]; renderEditor(); };
      const actions = document.createElement('div'); actions.className = 'row-actions';
      actions.append(button('↑', 'Move up', move(-1)), button('↓', 'Move down', move(1)), button('×', 'Remove step', () => { editing.steps.splice(index, 1); renderEditor(); }));
      const waitLabel = document.createElement('label'); waitLabel.className = 'step-wait'; waitLabel.append(wait, Object.assign(document.createElement('span'), {textContent: 'ms'}));
      row.append(number, kind, target, waitLabel, actions); rows.append(row);
    });
    $('consoleEditorSummary').textContent = editing.steps.length ? `${editing.steps.length} step${editing.steps.length === 1 ? '' : 's'} · about ${(editing.steps.reduce((sum, step) => sum + step.wait_ms, 0) / 1000).toFixed(1)} s${editing.repeat ? ' per round' : ''}` : '';
  }
  function collect() {
    editing.name = $('consoleButtonName').value.trim(); editing.repeat = $('consoleButtonRepeat').checked;
    if (!editing.name) throw new Error('Give the button a name.');
    if (!editing.steps.length) throw new Error('Add at least one step.');
    return editing;
  }

  $('consoleEditMode').onchange = renderControls;
  $('consoleAddStep').onclick = () => { if (!editing) return; editing.steps.push({kind: 'command', command: 'kbalance', wait_ms: 1500}); renderEditor(); };
  $('consoleAddMotion').onclick = () => { if (!editing) return; const first = hardware.motions()[0]; if (!first) return toast('Save a timeline as a Studio function first (Functions tab).', true); editing.steps.push({kind: 'motion', motion_id: first.id, wait_ms: 2000}); renderEditor(); };
  $('consoleButtonRepeat').onchange = () => { if (editing) { editing.repeat = $('consoleButtonRepeat').checked; renderEditor(); } };
  $('consoleCancel').onclick = closeEditor;
  $('consoleTest').onclick = () => { try { const item = collect(); run({...item, id: 'test', name: `${item.name} (test)`}); } catch (error) { fail(error); } };
  $('consoleEditor').onsubmit = async event => {
    event.preventDefault();
    try { const item = collect(); const next = item.id ? controls.map(entry => entry.id === item.id ? item : entry) : [...controls, item]; await save(next); toast(`Saved “${item.name}”.`); closeEditor(); }
    catch (error) { fail(error); }
  };
  $('consoleDelete').onclick = async () => { if (!editing?.id || !confirm(`Delete the button “${editing.name}”?`)) return; try { await save(controls.filter(entry => entry.id !== editing.id)); closeEditor(); } catch (error) { fail(error); } };
  $('consoleStop').onclick = () => hardware.cancel().catch(fail);

  const codes = $('petoiCodes'); catalog.forEach(item => codes.append(new Option(item.label, item.code)));
  window.addEventListener('bittle-hardware-state', event => {
    connected = event.detail.connected;
    $('consoleStatus').textContent = connected ? `Connected · ${event.detail.transport}${event.detail.testMode ? ' (test mode, nothing is sent)' : ''}` : 'Not connected. Open the Connection tab to connect.';
    $('hardware-console-tab').classList.toggle('offline', !connected); $('consoleStop').disabled = !connected;
  });
  window.addEventListener('bittle-motions', renderEditor);
  $('openHardware').addEventListener('click', () => load().catch(fail));
  renderStatic(); load().catch(fail);
}
