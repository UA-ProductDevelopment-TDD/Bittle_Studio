import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
let model, state, selected = null, selectedFrame = null, frameList = [], mapping = {}, loading = false;
let toastTimer, pendingPose = {}, poseTimer;
let codePanel, hardwarePanel, selectedActor=null;
const robotLinks = new Map(), objectMeshes = new Map(), meshCache = new Map();
function toast(message, error = false) {
  const dialog=document.querySelector('dialog[open]');
  if(dialog){let status=dialog.querySelector('.dialog-status');if(!status){status=document.createElement('p');status.className='dialog-status';status.setAttribute('role','status');dialog.append(status);}status.textContent=message;status.style.color=error?'#ffc6bc':'#c0e581';status.scrollIntoView({block:'nearest'});}
  $('toast').textContent = message; $('toast').className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').className = '', error ? 11000 : 5000);
}
async function api(url, data, method = 'POST') {
  const response = await fetch(url, data === undefined ? {} : {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
  if (!response.ok) { let message; try { message = (await response.json()).detail; } catch { message = response.statusText; } throw new Error(typeof message === 'string' ? message : JSON.stringify(message)); }
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
}
const command = (action, rest = {}) => api('/api/command', {action, ...rest});
function on(id, action, event = 'click') { $(id).addEventListener(event, async e => {try {await action(e);} catch(error) {toast(error.message, true);} }); }
function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function label(name) {return name.replace(/-joint$/, '').replaceAll('-', ' ').replaceAll('_', ' ');}
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(el => el.setAttribute('aria-selected', el.dataset.tab === name));
  ['pose', 'model', 'object', 'actor'].forEach(t => $(t + 'Panel').classList.toggle('hidden', name !== t));
}
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => tab(el.dataset.tab)));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => $(el.dataset.close).close()));

// Render link transforms from Bullet, rather than maintaining a separate visual-only robot.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#293943');
scene.fog = new THREE.Fog('#293943', 2.2, 6);
const camera = new THREE.PerspectiveCamera(42, 1, .001, 30);
camera.position.set(.40, .52, .31);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25; $('viewport').append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0, .12);
controls.enableDamping = true; controls.minDistance = .05; controls.maxDistance = 7;
const hemi = new THREE.HemisphereLight(0xe4f3ff, 0x697462, 2.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffefd8, 3.4); sun.position.set(-.8, .7, 1.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left:-1.5,right:1.5,top:1.5,bottom:-1.5,near:.01,far:5}); sun.shadow.bias=-.0001; sun.shadow.normalBias=.0004; scene.add(sun);
const rim = new THREE.DirectionalLight(0x90bfff, 1.8); rim.position.set(.5,-.8,.6); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color: '#354752', roughness: .92}));
floor.receiveShadow = true; floor.position.z = -.001; scene.add(floor);
const grid = new THREE.GridHelper(8, 160, 0x80919c, 0x506571); grid.rotation.x = Math.PI / 2; grid.position.z = .0001;
grid.material.transparent = true; grid.material.opacity = .42; scene.add(grid);
const gizmo = new TransformControls(camera, renderer.domElement); gizmo.setSize(.7); scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', e => controls.enabled = !e.value);
gizmo.addEventListener('mouseUp', async () => {
  if (!selected || !gizmo.object) return;
  const obj = model.objects.find(o => o.id === selected); obj.position = gizmo.object.position.toArray();
  try {await api('/api/objects', obj); selectObject(selected); } catch (e) {toast(e.message, true);}
});
const selectionBox = new THREE.BoxHelper(undefined, 0xc0e581); selectionBox.visible = false; scene.add(selectionBox);
new ResizeObserver(() => {const w=$('viewport').clientWidth,h=$('viewport').clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe($('viewport'));
function disposeGroup(group) { scene.remove(group); group.traverse(child => { if (child.isMesh) {child.geometry?.dispose(); (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m?.dispose());} }); }
async function loadMesh(url) {
  if (!meshCache.has(url)) meshCache.set(url, (async () => {
    const ext = url.split('.').pop().toLowerCase();
    if (ext === 'obj') return new OBJLoader().loadAsync(url);
    if (ext === 'stl') return new THREE.Mesh(await new STLLoader().loadAsync(url));
    if (ext === 'dae') return (await new ColladaLoader().loadAsync(url)).scene;
    if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene;
    throw new Error('Viewport does not support mesh format: ' + ext);
  })());
  return (await meshCache.get(url)).clone(true);
}
function materialize(group, color) {
  group.traverse(child => {if(child.isMesh) {child.geometry = child.geometry.clone(); child.material = new THREE.MeshStandardMaterial({color, roughness: .42, metalness: .12});child.castShadow=true;child.receiveShadow=true;} });
}
async function buildRobot() {
  for(const group of robotLinks.values()) disposeGroup(group); robotLinks.clear();
  const visuals=[...model.visuals.map(v=>({...v,actor:'main'})),...(model.actors||[]).flatMap(a=>a.visuals.map(v=>({...v,actor:a.id})))];
  await Promise.all(visuals.map(async v => {
    const key=v.actor==='main'?v.link:v.actor+'/'+v.link;
    let group = robotLinks.get(key);
    if(!group) {group=new THREE.Group();group.userData.robot=true;group.userData.actor=v.actor;scene.add(group);robotLinks.set(key,group);}
    let mesh;
    if(v.type === 'mesh') {mesh=await loadMesh(v.url);mesh.scale.fromArray(v.scale);}
    else if(v.type === 'box') {mesh=new THREE.Mesh(new THREE.BoxGeometry(...v.size.split(' ').map(Number)));}
    else if(v.type === 'sphere') {mesh=new THREE.Mesh(new THREE.SphereGeometry(Number(v.radius),32,24));}
    else if(v.type === 'cylinder') {mesh=new THREE.Mesh(new THREE.CylinderGeometry(Number(v.radius),Number(v.radius),Number(v.length),32));mesh.geometry.rotateX(Math.PI/2);}
    else {throw new Error('Unsupported URDF visual: ' + v.type);}
    let color = /knee|cover/.test(v.link) ? '#eab94f' : /shoulder/.test(v.link) ? '#333d46' : /board|imu/.test(v.link) ? '#355c43' : '#5d6c76';
    if(v.color) color=new THREE.Color(...v.color.slice(0,3));
    materialize(mesh,color);mesh.position.fromArray(v.position);mesh.quaternion.fromArray(v.quaternion);group.add(mesh);
  }));
  $('bodyCount').textContent=model.visuals.length;
  renderActors();
}
async function buildObjects() {
  gizmo.detach(); selectionBox.visible=false;
  for(const mesh of objectMeshes.values()) disposeGroup(mesh); objectMeshes.clear();
  for(const obj of model.objects) {
    let mesh;
    if(obj.type==='mesh') {mesh=await loadMesh(obj.url);mesh.scale.fromArray(obj.size);}
    else if(obj.type==='sphere') mesh=new THREE.Mesh(new THREE.SphereGeometry(obj.size[0]/2,32,24));
    else mesh=new THREE.Mesh(new THREE.BoxGeometry(...obj.size));
    materialize(mesh,obj.color);mesh.position.fromArray(obj.position);mesh.rotation.set(...obj.rotation,'XYZ');mesh.userData.objectId=obj.id;
    mesh.traverse(c=>c.userData.objectId=obj.id);scene.add(mesh);objectMeshes.set(obj.id,mesh);
  }
  renderObjectList(); if(selected && objectMeshes.has(selected)) selectObject(selected);
}
function renderObjectList() {
  $('objectList').replaceChildren();
  for(const o of model.objects) {const b=document.createElement('button');b.className='scene-item'+(selected===o.id?' selected':'');const icon=document.createElement('span');icon.textContent=o.type==='sphere'?'○':'◇';const text=document.createElement('div');text.textContent=o.name;const small=document.createElement('small');small.textContent=(o.mass===0?'Static':o.mass+' kg')+' · '+o.type;text.append(small);b.append(icon,text);b.onclick=()=>selectObject(o.id);$('objectList').append(b);}
}
function selectObject(id) {
  selectedActor=null;
  selected=id; const obj=model.objects.find(o=>o.id===id); if(!obj)return;
  tab('object');$('selectRobot').classList.remove('selected');$('inspectorTitle').textContent='Object inspector';$('selectionLabel').textContent=obj.type.toUpperCase();
  $('objectEmpty').classList.add('hidden');$('objectForm').classList.remove('hidden');$('objName').value=obj.name;
  ['position','rotation','size'].forEach(kind=>obj[kind].forEach((v,i)=>$(kind+i).value=(kind==='rotation'?THREE.MathUtils.radToDeg(v):v).toFixed(4)));
  $('sizeTitle').textContent=obj.type==='mesh'?'Mesh scale · 0.001 for mm':obj.type==='sphere'?'Diameter · X only':'Size · metres';
  $('objMass').value=obj.mass;$('objFriction').value=obj.friction;$('objColor').value=obj.color;
  const mesh=objectMeshes.get(id);if(!state?.running)gizmo.attach(mesh);selectionBox.setFromObject(mesh);selectionBox.visible=true;renderObjectList();
}
for(const kind of ['position','rotation','size']) for(let i=0;i<3;i++) {const l=document.createElement('label');l.textContent=['X','Y','Z'][i];const input=document.createElement('input');input.id=kind+i;input.type='number';input.step=kind==='rotation'?'1':'.01';input.required=true;if(kind==='size')input.min='.000001';l.append(input);$(kind+'Fields').append(l);}
on('selectRobot',()=>{selectedActor=null;selected=null;gizmo.detach();selectionBox.visible=false;tab('pose');$('selectRobot').classList.add('selected');$('inspectorTitle').textContent='Robot inspector';$('selectionLabel').textContent='BITTLE';renderObjectList();});
const raycaster=new THREE.Raycaster();let down;
renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4||gizmo.dragging||gizmo.axis)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObjects([...objectMeshes.values()],true)[0];if(hit)selectObject(hit.object.userData.objectId);});
function focusRobot(view='perspective') {const box=new THREE.Box3();robotLinks.forEach(g=>{if(g.userData.actor===(selectedActor||'main'))box.expandByObject(g);});const center=box.isEmpty()?new THREE.Vector3(0,0,.12):box.getCenter(new THREE.Vector3());controls.target.copy(center);const distance=Math.max(.35,box.getSize(new THREE.Vector3()).length()*1.7);camera.position.copy(center).add(view==='top'?new THREE.Vector3(.0001,0,distance):view==='side'?new THREE.Vector3(distance,0,.02):new THREE.Vector3(distance*.7,distance*.95,distance*.6));controls.update();}
on('focus',()=>focusRobot());on('topView',()=>focusRobot('top'));on('sideView',()=>focusRobot('side'));on('grid',()=>{$('grid').setAttribute('aria-pressed',String(grid.visible=!grid.visible));});
function render() {requestAnimationFrame(render);controls.update();if(selected&&selectionBox.visible)selectionBox.update();renderer.render(scene,camera);} render();

function buildJoints() {
  $('jointControls').replaceChildren();
  for(const j of model.joints) {
    const row=document.createElement('div');row.className='joint';const head=document.createElement('div');head.className='joint-head';const l=document.createElement('label');l.textContent=label(j.name);l.htmlFor='joint-'+j.id;
    const number=document.createElement('input');number.type='number';number.min=j.lower.toFixed(2);number.max=j.upper.toFixed(2);number.step='.1';number.id='angle-'+j.id;number.setAttribute('aria-label',label(j.name)+' degrees');
    const slider=document.createElement('input');slider.type='range';slider.min=j.lower;slider.max=j.upper;slider.step='.1';slider.id='joint-'+j.id;slider.value=number.value=model.targets[j.name]??0;
    const change=el=>{const value=Number(el.value);if(!Number.isFinite(value))return;const clamped=Math.max(j.lower,Math.min(j.upper,value));number.value=clamped.toFixed(1);slider.value=clamped;pendingPose[j.name]=clamped;clearTimeout(poseTimer);poseTimer=setTimeout(flushPose,40);};
    slider.oninput=()=>change(slider);number.onchange=()=>change(number);head.append(l,number);
    const limits=document.createElement('div');limits.className='joint-limits';limits.innerHTML=`<span>${Math.round(j.lower)}°</span><span>${Math.round(j.upper)}°</span>`;row.append(head,slider,limits);$('jointControls').append(row);
  }
}
async function flushPose(){if(!Object.keys(pendingPose).length)return;const pose=pendingPose;pendingPose={};try{await command('pose',{pose});}catch(e){toast(e.message,true);}}
function updatePoseInputs(pose) {for(const j of model.joints) {if(pendingPose[j.name]!==undefined)continue;const slider=$('joint-'+j.id),num=$('angle-'+j.id);if(document.activeElement!==slider&&document.activeElement!==num){slider.value=pose[j.name];num.value=Number(pose[j.name]).toFixed(1);}}}
function crouchPose(){return Object.fromEntries(model.joints.map(j=>[j.name,/knee/.test(j.name)?45:-35]));}
on('zeroPose',()=>command('pose',{pose:Object.fromEntries(model.joints.map(j=>[j.name,0]))}));on('crouchPose',()=>command('pose',{pose:crouchPose()}));
on('run',async()=>{await flushPose();await command('run',{value:!state.running});});on('reset',async()=>{await command('reset');$('frameTime').value=0;});
on('applyPhysics',async()=>{await command('settings',{gravity:Number($('gravity').value),friction:Number($('friction').value),fixed:$('fixed').checked,physics_hz:Number($('physicsHz').value),motion_hz:Number($('motionHz').value),direction:$('motionDirection').value});await refresh();toast('Physics settings applied.');});
on('applyUrdf',async()=>{await api('/api/urdf',{xml:$('urdf').value});await refresh();toast('URDF loaded. Timeline reset for the new model.');});on('downloadUrdf',()=>download('bittle.urdf',$('urdf').value,'application/xml'));

async function addObject(obj){const added=await api('/api/objects',obj);model.objects.push(added);await buildObjects();selectObject(added.id);return added;}
on('addBox',()=>addObject({type:'box',name:'Test block',position:[.22,0,.025],size:[.12,.12,.05],color:'#849bab'}));
on('addSphere',()=>addObject({type:'sphere',name:'Ball',position:[.22,0,.12],size:[.07,.07,.07],mass:.1,color:'#d89f66'}));
on('addRamp',()=>addObject({type:'box',name:'Ramp · 15°',position:[.28,0,.045],rotation:[0,-Math.PI/12,0],size:[.32,.22,.018],color:'#799b9a'}));
on('addSteps',async()=>{for(let i=0;i<3;i++)await addObject({type:'box',name:'Step '+(i+1),position:[.23+i*.11,0,(i+1)*.0125],size:[.11,.25,(i+1)*.025],color:['#667d8d','#7a929f','#95aab4'][i]});toast('Three 2.5 cm steps added.');});
on('objectForm',async e=>{e.preventDefault();const old=model.objects.find(o=>o.id===selected);const obj={...old,name:$('objName').value,mass:Number($('objMass').value),friction:Number($('objFriction').value),color:$('objColor').value};for(const kind of ['position','rotation','size'])obj[kind]=[0,1,2].map(i=>Number($(kind+i).value)*(kind==='rotation'?Math.PI/180:1));const updated=await api('/api/objects',obj);model.objects[model.objects.indexOf(old)]=updated;await buildObjects();toast('Object updated.');},'submit');
on('duplicateObject',async()=>{const o=structuredClone(model.objects.find(o=>o.id===selected));delete o.id;o.name+=' copy';o.position[0]+=.12;await addObject(o);});
on('deleteObject',async()=>{await api('/api/objects/'+selected,{},'DELETE');model.objects=model.objects.filter(o=>o.id!==selected);selected=null;await buildObjects();$('objectForm').classList.add('hidden');$('objectEmpty').classList.remove('hidden');});
on('import',()=>$('assetFile').click());
on('assetFile',async()=>{const file=$('assetFile').files[0];if(!file)return;const form=new FormData();form.append('file',file);$('import').disabled=true;try{const response=await fetch('/api/import?mode='+$('robotImportMode').value,{method:'POST',body:form});const result=await response.json();if(!response.ok)throw new Error(result.detail);if(result.kind==='robot'||result.kind==='actor'){await refresh();if(result.kind==='actor')selectActor(result.id);focusRobot();toast('Robot imported.');}else{await addObject({type:'mesh',name:result.name,url:result.url,size:[1,1,1],position:[.25,0,0],color:'#8fa6b2'});toast(result.note);}}finally{$('assetFile').value='';$('import').disabled=false;}},'change');

function timeline(){const end=Math.max(5,frameList.at(-1)?.time??0);$('scrubber').max=end;$('frameCount').textContent=frameList.length+' keyframes';$('ruler').replaceChildren();for(let i=0;i<=5;i++){const s=document.createElement('span');s.textContent=(i*end/5).toFixed(1)+' s';$('ruler').append(s);}$('keyframes').replaceChildren();if(!frameList.length){const p=document.createElement('p');p.textContent='Pose the joints, choose a time, then add a keyframe.';$('keyframes').append(p);}frameList.forEach(f=>{const b=document.createElement('button');b.className='frame'+(selectedFrame===f.time?' selected':'');b.textContent=f.time.toFixed(2)+' s';b.onclick=async()=>{selectedFrame=f.time;$('frameTime').value=f.time;$('easing').value=f.easing;await command('seek',{time:f.time});timeline();};$('keyframes').append(b);});}
async function saveFrames(){const result=await api('/api/frames',{frames:frameList});frameList=result.frames;timeline();}
on('keyframe',async()=>{await flushPose();const s=await api('/api/state');const t=Number($('frameTime').value);const next=frameList.filter(f=>f.time!==t);next.push({time:t,pose:structuredClone(s.targets),easing:$('easing').value});const result=await api('/api/frames',{frames:next});frameList=result.frames;selectedFrame=t;timeline();toast('Keyframe saved at '+t+' s.');});
on('removeFrame',async()=>{if(selectedFrame===null)throw new Error('Select a keyframe first');frameList=frameList.filter(f=>f.time!==selectedFrame);selectedFrame=null;await saveFrames();});
on('demoMotion',async()=>{const zero=Object.fromEntries(model.joints.map(j=>[j.name,0]));frameList=[{time:0,pose:zero,easing:'smooth'},{time:1.5,pose:crouchPose(),easing:'smooth'},{time:3,pose:zero,easing:'smooth'}];await saveFrames();await command('seek',{time:0});toast('Crouch example loaded. This is a pose study, not a validated gait.');});
on('play',async()=>{if(frameList.length<2)throw new Error('Add at least two keyframes to play motion');await flushPose();await command('play',{value:!state.playing,loop:$('loop').checked,speed:Number($('speed').value),hz:Number($('motionHz').value),direction:$('motionDirection').value});});
on('speed',()=>command('play',{value:state.playing,loop:$('loop').checked,speed:Number($('speed').value),hz:Number($('motionHz').value),direction:$('motionDirection').value}),'change');
on('loop',()=>command('play',{value:state.playing,loop:$('loop').checked,speed:Number($('speed').value),hz:Number($('motionHz').value),direction:$('motionDirection').value}),'change');
let seekTimer;on('scrubber',()=>{const t=Number($('scrubber').value);$('frameTime').value=t.toFixed(2);clearTimeout(seekTimer);seekTimer=setTimeout(()=>command('seek',{time:t}).catch(e=>toast(e.message,true)),25);},'input');
on('frameTime',()=>command('seek',{time:Number($('frameTime').value)}),'change');
on('saveProject',async()=>{await codePanel?.save();await flushPose();download('bittle-experiment.json',await api('/api/project'));toast('Project saved. Keep this installation’s data folder with imported assets.');});
on('openProject',()=>$('projectFile').click());on('projectFile',async()=>{const f=$('projectFile').files[0];if(!f)return;await api('/api/project',JSON.parse(await f.text()));await refresh();codePanel?.reload();focusRobot();$('projectFile').value='';toast('Project restored.');},'change');
on('help',()=>$('helpDialog').showModal());
on('export',()=>{$('exportHz').value=$('motionHz').value;$('exportDirection').value=$('motionDirection').value;mapping=structuredClone(model.mapping);$('mapping').replaceChildren();for(const j of model.joints){const m=mapping[j.name];const row=document.createElement('div');row.className='mapping-row';const name=document.createElement('span');name.textContent=label(j.name);const servo=document.createElement('input');servo.type='number';servo.min=0;servo.max=15;servo.value=m.servo;servo.setAttribute('aria-label',label(j.name)+' servo index');const sign=document.createElement('select');sign.innerHTML='<option value="1">+1</option><option value="-1">−1</option>';sign.value=m.sign;sign.setAttribute('aria-label',label(j.name)+' direction');const offset=document.createElement('input');offset.type='number';offset.value=m.offset;offset.setAttribute('aria-label',label(j.name)+' offset');const verified=document.createElement('input');verified.type='checkbox';verified.checked=m.verified;verified.setAttribute('aria-label',label(j.name)+' mapping verified');servo.onchange=()=>{m.servo=Number(servo.value);m.verified=verified.checked=false;};sign.onchange=()=>{m.sign=Number(sign.value);m.verified=verified.checked=false;};offset.onchange=()=>{m.offset=Number(offset.value);m.verified=verified.checked=false;};verified.onchange=()=>m.verified=verified.checked;row.append(name,servo,sign,offset,verified);$('mapping').append(row);}$('exportDialog').showModal();});
const exportBody=()=>({mapping,motion_type:$('exportType').value,speed:Number($('exportSpeed').value),hz:Number($('exportHz').value),direction:$('exportDirection').value});
on('exportType',()=>{$('exportLoop').checked=$('exportType').value==='gait';},'change');
on('downloadCode',async()=>{const code=await api('/api/export',exportBody());model.mapping=structuredClone(mapping);download('bittle_motion.py',code,'text/x-python');toast($('exportType').value==='gait'?'Python gait exported. It repeats until Ctrl+C.':'Python motion exported. Run without flags for a dry run.');});
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]'))return;if(e.key.toLowerCase()==='f')focusRobot();if(e.code==='Space'){e.preventDefault();$('play').click();}});

on('openCode',()=>codePanel?.show());
on('objectCode',()=>codePanel.forTarget(selected));
on('actorCode',()=>codePanel.forTarget(selectedActor));
on('testExport',async()=>{const result=await api('/api/motion-code',exportBody());model.mapping=structuredClone(mapping);$('exportDialog').close();await codePanel.addSource(result.source,'motion.py','main');toast(result.metadata.loop?'Gait Python is running-ready; use Stop all to end its loop.':'Exported Python is ready to run in simulation.');});
on('playFromStart',async()=>{if(frameList.length<2)throw Error('Add at least two keyframes');await command('play',{value:true,from_start:true,loop:$('loop').checked,speed:Number($('speed').value),hz:Number($('motionHz').value),direction:$('motionDirection').value});});
for(const id of ['motionHz','motionDirection'])on(id,async()=>{await command('settings',{motion_hz:Number($('motionHz').value),direction:$('motionDirection').value});model.motion_hz=Number($('motionHz').value);model.direction=$('motionDirection').value;},'change');

function renderActors(){
  $('actorList').replaceChildren();
  for(const actor of model.actors||[]){const button=document.createElement('button');button.className='scene-item'+(selectedActor===actor.id?' selected':'');const icon=document.createElement('span');icon.textContent='▧';const name=document.createElement('div');name.textContent=actor.name;const detail=document.createElement('small');detail.textContent='URDF · '+actor.joints.length+' joints';name.append(detail);button.append(icon,name);button.onclick=()=>selectActor(actor.id);$('actorList').append(button);}
}
function selectActor(id){
  const actor=model.actors.find(a=>a.id===id);if(!actor)return;selectedActor=id;selected=null;gizmo.detach();selectionBox.visible=false;$('selectRobot').classList.remove('selected');$('inspectorTitle').textContent='Robot inspector';$('selectionLabel').textContent='URDF';tab('actor');$('actorEmpty').classList.add('hidden');$('actorForm').classList.remove('hidden');$('actorName').value=actor.name;$('actorUrdf').value=actor.xml;$('actorFixed').checked=actor.fixed;['Position','Rotation'].forEach(kind=>actor[kind.toLowerCase()].forEach((v,i)=>$('actor'+kind+i).value=(kind==='Rotation'?THREE.MathUtils.radToDeg(v):v).toFixed(4)));renderActors();renderObjectList();
}
for(const kind of ['Position','Rotation'])for(let i=0;i<3;i++){const label=document.createElement('label');label.textContent=['X','Y','Z'][i];const input=document.createElement('input');input.type='number';input.step='any';input.id='actor'+kind+i;input.required=true;label.append(input);$('actor'+kind).append(label);}
on('duplicateRobot',async()=>{await codePanel?.save();const actor=await api('/api/actors',{duplicate_main:true});await refresh();selectActor(actor.id);focusRobot();});
on('actorForm',async e=>{e.preventDefault();await codePanel?.save();const body={name:$('actorName').value,xml:$('actorUrdf').value,fixed:$('actorFixed').checked,position:[0,1,2].map(i=>Number($('actorPosition'+i).value)),rotation:[0,1,2].map(i=>THREE.MathUtils.degToRad(Number($('actorRotation'+i).value)))};await api('/api/actors/'+selectedActor,body);await refresh();selectActor(selectedActor);toast('Robot updated.');},'submit');
on('deleteActor',async()=>{await api('/api/actors/'+selectedActor,{},'DELETE');selectedActor=null;await refresh();$('actorForm').classList.add('hidden');$('actorEmpty').classList.remove('hidden');});

async function refresh(){loading=true;try{model=await api('/api/model');frameList=model.frames;selectedFrame=null;buildJoints();timeline();$('urdf').value=model.xml;$('gravity').value=model.gravity;$('friction').value=model.friction;$('fixed').checked=model.fixed;$('physicsHz').value=model.physics_hz;$('motionHz').value=model.motion_hz;$('motionDirection').value=model.direction;$('diagnostics').replaceChildren();for(const w of model.warnings){const p=document.createElement('p');p.textContent=w;$('diagnostics').append(p);}await buildRobot();await buildObjects();codePanel?.targets();}finally{loading=false;}}
function applyState(s){state=s;if(!model)return;for(const [id,a] of Object.entries(s.actors||{})){for(const [name,[pos,quat]] of Object.entries(a.transforms)){const group=robotLinks.get(id+'/'+name);if(group){group.position.fromArray(pos);group.quaternion.fromArray(quat);}}}for(const [name,[pos,quat]] of Object.entries(s.transforms)){const group=robotLinks.get(name);if(group){group.position.fromArray(pos);group.quaternion.fromArray(quat);}}for(const [id,[pos,quat]] of Object.entries(s.objects)){const mesh=objectMeshes.get(id);if(mesh&&!(gizmo.dragging&&id===selected)){mesh.position.fromArray(pos);mesh.quaternion.fromArray(quat);}}$('run').textContent=s.running?'Ⅱ Pause physics':'▶ Run physics';$('play').textContent=s.playing?'Ⅱ Pause motion':'▶ Play motion';$('mode').textContent=s.running?'PHYSICS LIVE':'POSE MODE';$('simTime').textContent=s.time.toFixed(2)+' s';$('height').textContent=s.height.toFixed(3)+' m';$('contacts').textContent=s.contacts;$('roll').textContent=THREE.MathUtils.radToDeg(s.rpy[0]).toFixed(1)+'°';if(document.activeElement!==$('scrubber'))$('scrubber').value=s.playhead;if(s.playing)$('frameTime').value=s.playhead.toFixed(2);updatePoseInputs(s.targets);if(s.running)gizmo.detach();else if(selected&&!gizmo.object&&objectMeshes.has(selected))gizmo.attach(objectMeshes.get(selected));}
async function poll(){try{if(!loading){applyState(await api('/api/state'));$('connection').textContent='Bullet · '+state.physics_hz+' Hz';}}catch(e){$('connection').textContent='Disconnected · retrying';}setTimeout(poll,16);}
try {await refresh();applyState(await api('/api/state'));focusRobot();$('loading').remove();codePanel=(await import('./code-panel.js')).initCodePanel({api,toast,getModel:()=>model,refresh});hardwarePanel=(await import('./hardware.js')).initHardware({api,toast,getModel:()=>model,getMapping:()=>Object.keys(mapping).length?mapping:model.mapping});poll();}catch(e){$('loading').textContent='Could not load Bittle: '+e.message;toast(e.message,true);}
