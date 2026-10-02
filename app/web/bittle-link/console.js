import {catalog} from './catalog.js';

// Controller modelled on the Petoi app: gait pad, posture and skill grids, and user-composed buttons.
// Host-provided pieces keep this UI independent of where buttons and skills are stored:
//   store:   {load(): Promise<controls[]>, save(controls): Promise<controls[]>}
//   library: {list(): [{id, name, motion_type}], resolve(id): Promise<{skill, signature, type, name}>}  (optional)
//   tools:   [{label, title, onClick}] extra buttons beside “My buttons”, e.g. import/export.
const GAITS = [['wk', 'Walk'], ['tr', 'Trot'], ['cr', 'Crawl'], ['gp', 'Gallop'], ['vt', 'Step'], ['lft', 'High step'], ['ph', 'Hop'], ['carpet', 'Carpet']];
const PAD = [['↖', 'L', 'Forward left'], ['↑', 'F', 'Forward'], ['↗', 'R', 'Forward right'], ['⟲', 'kvtL', 'Turn left on the spot'], ['■', 'kbalance', 'Stop'], ['⟳', 'kvtR', 'Turn right on the spot'], ['↙', 'kbkL', 'Back left'], ['↓', 'kbk', 'Back'], ['↘', 'kbkR', 'Back right']];
const POSTURES = [['kbalance', 'Balance'], ['kup', 'Stand up'], ['ksit', 'Sit'], ['krest', 'Rest'], ['kstr', 'Stretch'], ['kbuttUp', 'Butt up'], ['kzero', 'Zero'], ['kcalib', 'Calibrate'], ['m 0 30', 'Look left'], ['m 0 0', 'Look ahead'], ['m 0 -30', 'Look right']];
const SKILLS = [['khi', 'Hi'], ['khsk', 'Shake paw'], ['kfiv', 'High five'], ['kgdb', 'Goodbye'], ['khg', 'Hug'], ['kchr', 'Cheer'], ['knd', 'Nod'], ['kwh', 'Head wave'], ['ksnf', 'Sniff'], ['kscrh', 'Scratch'], ['kck', 'Check'], ['kdg', 'Dig'], ['kpee', 'Pee'], ['kpu', 'Push-ups'], ['kpu1', 'One-arm push-up'], ['kbx', 'Box'], ['kkc', 'Kick'], ['kjmp', 'Jump'], ['kmw', 'Moonwalk'], ['kts', 'Twist'], ['kzz', 'Zigzag'], ['krl', 'Roll'], ['kpd', 'Play dead'], ['krc', 'Recover'], ['kff', 'Front flip', true], ['kbf', 'Back flip', true]];
// Petoi voice command module: XAc enables its reply tone and reactions, XAd silences and disables them.
const MODULES = [['XAc', 'Voice module on'], ['XAd', 'Voice module off']];
export const COLORS = ['green', 'blue', 'amber', 'red', 'violet', 'grey'];
const WALKING = new Set(catalog.filter(item => item.walking).map(item => item.code));
let datalistCount = 0;

const MARKUP = `
<div class="console-top"><p data-part="status" class="console-status">Not connected</p><button type="button" data-part="stop" class="danger" disabled>■ Stop</button></div>
<div class="console-layout"><div class="console-drive"><h4>Gait</h4><div data-part="gaits" class="gait-chips"></div><div data-part="pad" class="console-pad"></div><p class="note">Gaits keep running in firmware until you press ■ or another command.</p></div>
<div class="console-actions"><h4>Postures</h4><div data-part="postures" class="console-grid"></div><h4>Skills</h4><div data-part="skills" class="console-grid"></div><h4>Voice module</h4><div data-part="modules" class="console-grid"></div></div></div>
<div class="console-custom-head"><div><h4>My buttons</h4><p data-part="hint" class="note"></p></div><div class="console-tools"><span data-part="tools"></span><label class="check"><input data-part="editMode" type="checkbox"> Edit buttons</label></div></div><div data-part="custom" class="console-grid custom-grid"></div>
<form data-part="editor" class="console-editor hidden"><div class="editor-head"><h4 data-part="editorTitle">New button</h4><span data-part="summary" class="note"></span></div>
<div class="editor-fields"><label>Name<input data-part="name" maxlength="40" placeholder="For example: Greet and sit"></label><div class="editor-colors"><span>Colour</span><div data-part="colors"></div></div><label class="check"><input data-part="repeat" type="checkbox"> Repeat until stopped</label></div>
<div data-part="steps" class="step-list"></div><div class="editor-step-actions"><button type="button" data-part="addStep">+ Command step</button><button type="button" data-part="addMotion">+ Studio function step</button><label class="check"><input data-part="record" type="checkbox"> Record presses from the pad and grids</label></div>
<div class="console-editor-actions"><button class="primary">Save button</button><button type="button" data-part="test">▶ Test</button><button type="button" data-part="cancel">Cancel</button><button type="button" data-part="delete" class="danger hidden">Delete</button></div></form>
<p class="note">Last command: <code data-part="last">none</code>. The wait after each step is how long the console waits before sending the next one. Walking steps keep going during that wait, so end a walk with <code>kbalance</code>.</p><datalist data-part="codes"></datalist>`;

export function initConsole(root, {link, toast = message => console.warn(message), store, library = null, tools = [], offlineHint = 'Not connected.'}) {
  root.classList.add('bittle-console', 'offline'); root.innerHTML = MARKUP;
  const part = name => root.querySelector(`[data-part="${name}"]`);
  const listId = `petoiCodes${++datalistCount}`; part('codes').id = listId;
  let controls = [], gait = 'wk', editing = null, activeId = null;
  const button = (label, title, onclick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; if (className) b.className = className; b.onclick = onclick; return b; };
  const fail = error => toast(error.message, true);
  const recording = () => editing && part('record').checked;
  const editMode = () => part('editMode').checked;
  const functions = () => library?.list() || [];
  const functionName = id => functions().find(item => item.id === id)?.name;

  // A press sends immediately and, while recording, also appends a step to the button being edited.
  function press(command, label) {
    if (recording()) { editing.steps.push({kind: 'command', command, wait_ms: WALKING.has(command.split(' ')[0]) ? 2000 : 1500}); renderEditor(); }
    if (link.connected) link.press(command).catch(fail);
    else if (!recording()) toast(offlineHint, true);
    part('last').textContent = `${label} · ${command}`;
  }
  function renderStatic() {
    part('gaits').replaceChildren(...GAITS.map(([code, label]) => { const b = button(label, `k${code}F / L / R`, () => { gait = code; renderStatic(); }); b.classList.toggle('selected', code === gait); return b; }));
    part('pad').replaceChildren(...PAD.map(([glyph, code, title]) => { const command = code.length === 1 ? `k${gait}${code}` : code; return button(glyph, `${title} · ${command}`, () => press(command, title), code === 'kbalance' ? 'pad-stop' : ''); }));
    part('postures').replaceChildren(...POSTURES.map(([code, label]) => button(label, code, () => press(code, label))));
    part('skills').replaceChildren(...SKILLS.map(([code, label, risky]) => button(risky ? `⚠ ${label}` : label, risky ? `${code} · needs free space and a soft floor` : code, () => press(code, label), risky ? 'risky' : '')));
    part('modules').replaceChildren(...MODULES.map(([code, label]) => button(label, `${code} · Petoi voice command module`, () => press(code, label))));
    part('tools').replaceChildren(...tools.map(tool => button(tool.label, tool.title, () => Promise.resolve(tool.onClick()).catch(fail))));
  }
  function renderControls() {
    const list = part('custom'); list.replaceChildren();
    for (const item of controls) {
      const b = button(item.name, `${item.steps.length} step${item.steps.length === 1 ? '' : 's'}${item.repeat ? ' · repeats' : ''}`, () => editMode() ? openEditor(item) : run(item), `custom-button color-${item.color}`);
      if (item.id === activeId) b.classList.add('running');
      if (item.repeat) b.append(Object.assign(document.createElement('small'), {textContent: '↻'}));
      list.append(b);
    }
    list.append(button('+ New button', 'Compose a new button', () => openEditor(null), 'custom-add'));
    part('hint').textContent = controls.length ? (editMode() ? 'Click a button to edit it.' : 'Click to run. Any other press or Stop interrupts it.') : 'Compose buttons from Petoi commands and saved Studio functions.';
  }
  async function run(item) {
    if (!link.connected) return toast(offlineHint, true);
    activeId = item.id; renderControls();
    try { await link.runSequence(item, {resolveMotion: library && (id => library.resolve(id))}); }
    catch (error) { fail(error); }
    finally { if (activeId === item.id) { activeId = null; renderControls(); } }
  }
  async function save(next) { controls = await store.save(next); renderControls(); }
  async function reload() { controls = await store.load(); renderControls(); renderEditor(); }

  function openEditor(item) {
    editing = item ? structuredClone(item) : {id: '', name: '', color: 'green', repeat: false, steps: []};
    part('editor').classList.remove('hidden'); part('editorTitle').textContent = item ? `Edit “${item.name}”` : 'New button';
    part('name').value = editing.name; part('repeat').checked = editing.repeat; part('delete').classList.toggle('hidden', !item);
    renderEditor(); part('name').focus();
  }
  function closeEditor() { editing = null; part('record').checked = false; part('editor').classList.add('hidden'); }
  function renderEditor() {
    if (!editing) return;
    part('addMotion').classList.toggle('hidden', !library);
    part('colors').replaceChildren(...COLORS.map(color => { const b = button('', color, () => { editing.color = color; renderEditor(); }, `swatch color-${color}`); b.setAttribute('aria-pressed', color === editing.color); b.setAttribute('aria-label', color); return b; }));
    const available = functions(), rows = part('steps'); rows.replaceChildren();
    if (!editing.steps.length) rows.append(Object.assign(document.createElement('p'), {className: 'note', textContent: 'No steps yet. Add one below, or tick “Record presses” and use the pad and skill buttons.'}));
    editing.steps.forEach((step, index) => {
      const row = document.createElement('div'); row.className = 'step-row';
      const number = Object.assign(document.createElement('span'), {className: 'step-number', textContent: index + 1});
      const kind = document.createElement('select'); kind.append(new Option('Command', 'command')); if (library || step.kind === 'motion') kind.append(new Option('Studio function', 'motion')); kind.value = step.kind;
      kind.onchange = () => { editing.steps[index] = kind.value === 'command' ? {kind: 'command', command: 'kbalance', wait_ms: step.wait_ms} : {kind: 'motion', motion_id: available[0]?.id || '', wait_ms: step.wait_ms}; renderEditor(); };
      let target;
      if (step.kind === 'command') { target = document.createElement('input'); target.value = step.command; target.maxLength = 64; target.setAttribute('list', listId); target.placeholder = 'ksit, kwkF, m 0 30…'; target.oninput = () => { step.command = target.value; }; }
      else {
        target = document.createElement('select');
        if (!available.length) target.append(new Option('No saved Studio functions', ''));
        if (step.motion_id && !functionName(step.motion_id)) target.append(new Option('(missing function)', step.motion_id));
        available.forEach(item => target.append(new Option(`${item.name} · ${item.motion_type}`, item.id)));
        target.value = step.motion_id; target.onchange = () => { step.motion_id = target.value; };
      }
      const wait = document.createElement('input'); wait.type = 'number'; wait.min = 0; wait.max = 60000; wait.step = 100; wait.value = step.wait_ms; wait.title = 'Wait after this step (ms)'; wait.oninput = () => { step.wait_ms = Math.max(0, Math.min(60000, Math.round(Number(wait.value) || 0))); };
      const move = delta => () => { const to = index + delta; if (to < 0 || to >= editing.steps.length) return; [editing.steps[index], editing.steps[to]] = [editing.steps[to], editing.steps[index]]; renderEditor(); };
      const actions = document.createElement('div'); actions.className = 'row-actions';
      actions.append(button('↑', 'Move up', move(-1)), button('↓', 'Move down', move(1)), button('×', 'Remove step', () => { editing.steps.splice(index, 1); renderEditor(); }));
      const waitLabel = document.createElement('label'); waitLabel.className = 'step-wait'; waitLabel.append(wait, Object.assign(document.createElement('span'), {textContent: 'ms'}));
      row.append(number, kind, target, waitLabel, actions); rows.append(row);
    });
    part('summary').textContent = editing.steps.length ? `${editing.steps.length} step${editing.steps.length === 1 ? '' : 's'} · about ${(editing.steps.reduce((sum, step) => sum + step.wait_ms, 0) / 1000).toFixed(1)} s${editing.repeat ? ' per round' : ''}` : '';
  }
  function collect() {
    editing.name = part('name').value.trim(); editing.repeat = part('repeat').checked;
    if (!editing.name) throw new Error('Give the button a name.');
    if (!editing.steps.length) throw new Error('Add at least one step.');
    return editing;
  }

  part('editMode').onchange = renderControls;
  part('addStep').onclick = () => { editing.steps.push({kind: 'command', command: 'kbalance', wait_ms: 1500}); renderEditor(); };
  part('addMotion').onclick = () => { const first = functions()[0]; if (!first) return toast('There are no saved Studio functions yet.', true); editing.steps.push({kind: 'motion', motion_id: first.id, wait_ms: 2000}); renderEditor(); };
  part('repeat').onchange = () => { editing.repeat = part('repeat').checked; renderEditor(); };
  part('cancel').onclick = closeEditor;
  part('test').onclick = () => { try { const item = collect(); run({...item, id: 'test', name: `${item.name} (test)`}); } catch (error) { fail(error); } };
  part('editor').onsubmit = async event => {
    event.preventDefault();
    try { const item = collect(); await save(item.id ? controls.map(entry => entry.id === item.id ? item : entry) : [...controls, item]); toast(`Saved “${item.name}”.`); closeEditor(); }
    catch (error) { fail(error); }
  };
  part('delete').onclick = async () => { if (!editing?.id || !confirm(`Delete the button “${editing.name}”?`)) return; try { await save(controls.filter(entry => entry.id !== editing.id)); closeEditor(); } catch (error) { fail(error); } };
  part('stop').onclick = () => link.stop().catch(fail);
  catalog.forEach(item => part('codes').append(new Option(item.label, item.code)));

  function onState({detail}) {
    root.classList.toggle('offline', !detail.connected); part('stop').disabled = !detail.connected;
    part('status').textContent = detail.connected ? `Connected · ${detail.transport}${detail.testMode ? ' (test mode, nothing is sent)' : ''}` : offlineHint;
  }
  link.addEventListener('state', onState); onState({detail: link.status()});
  renderStatic(); reload().catch(fail);
  return {reload, refreshLibrary: renderEditor, get controls() { return controls; }};
}
