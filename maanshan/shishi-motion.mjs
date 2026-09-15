import {motionWeights,vertexCount} from './shishi-motion-weights.mjs?v=20260915b';
const TAU = Math.PI * 2;

// Small, blended pose changes keep the supplied sculpt and its painted face intact.
// Build the targets once; Three.js interpolates positions and normals on the GPU.
function prepareExpressions(THREE, root) {
  const meshes = [], p = new THREE.Vector3(), n = new THREE.Vector3();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0), axisZ = new THREE.Vector3(0, 0, 1);
  root.updateWorldMatrix(true,true);
  const rigSpace = root.parent ? root.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.geometry.morphAttributes.position?.length) return;
    const geometry = mesh.geometry, positions = geometry.attributes.position, normals = geometry.attributes.normal;
    if (!positions || !normals || positions.count!==vertexCount) return;
    const toRig = rigSpace.clone().multiply(mesh.matrixWorld), fromRig = toRig.clone().invert();
    const normalToRig = new THREE.Matrix3().getNormalMatrix(toRig), normalFromRig = new THREE.Matrix3().getNormalMatrix(fromRig);
    const leftWingPivot=new THREE.Vector3(-.127,.60,-.086),rightWingPivot=new THREE.Vector3(.130,.58,-.131);
    const definitions = [
      {name:'nod', pivot:new THREE.Vector3(-.02, .68, -.02), axis:axisX, angle:.08,
        weight:i=>motionWeights.head[i]/255},
      {name:'wave', pivot:new THREE.Vector3(-.155,.675,.16), axis:axisZ, angle:.18,
        weight:i=>motionWeights.hand[i]/255},
      {name:'wings', pivot:null, axis:axisY, angle:.18,
        weight:i=>Math.max(motionWeights.leftWing[i],motionWeights.rightWing[i])/255},
      {name:'look', pivot:new THREE.Vector3(-.02,.68,-.02), axis:axisY, angle:.07,
        weight:i=>motionWeights.head[i]/255}
    ];
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [];geometry.morphAttributes.normal = [];
    for (const target of definitions) {
      const points = new Float32Array(positions.count * 3), directions = new Float32Array(normals.count * 3);
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(toRig);
        const left=motionWeights.leftWing[i]>motionWeights.rightWing[i];
        const origin=target.name==='wings'?(left?leftWingPivot:rightWingPivot):target.pivot;
        const weight = target.weight(i), angle = target.angle * weight * (target.name==='wings'?(left?-1:1):1);
        p.sub(origin).applyAxisAngle(target.axis, angle).add(origin).applyMatrix4(fromRig);
        points[i*3] = p.x-positions.getX(i);points[i*3+1] = p.y-positions.getY(i);points[i*3+2] = p.z-positions.getZ(i);
        n.fromBufferAttribute(normals,i).applyMatrix3(normalToRig).normalize().applyAxisAngle(target.axis,angle).applyMatrix3(normalFromRig).normalize();
        directions[i*3] = n.x-normals.getX(i);directions[i*3+1] = n.y-normals.getY(i);directions[i*3+2] = n.z-normals.getZ(i);
      }
      const position = new THREE.Float32BufferAttribute(points,3), normal = new THREE.Float32BufferAttribute(directions,3);
      position.name = normal.name = target.name;geometry.morphAttributes.position.push(position);geometry.morphAttributes.normal.push(normal);
    }
    mesh.updateMorphTargets();mesh.frustumCulled = false;meshes.push(mesh);
  });
  return meshes;
}

export function createShishiMotion({THREE,root,pivot,canvas,render,reducedMotion}) {
  const meshes = prepareExpressions(THREE,root);
  canvas.dataset.motionTargets = meshes.length?'nod,wave,wings,look':'body';
  let dead = false, active = false, timer = 0, frame = 0, elapsed = 0, last = 0, greeting = -1, calm = false;
  let interval = 1000/24, slowFrames = 0, energy = 1;
  const cancel = () => {clearTimeout(timer);cancelAnimationFrame(frame);timer=frame=0;last=0;};
  const pose = (time, response = 0) => {
    const breath = Math.sin(time*TAU/4.6), bob = Math.sin(time*TAU/4.6-.6);
    const greetingAge = greeting < 0 ? -1 : time-greeting;
    const wave = greetingAge>=0 && greetingAge<1.8 ? Math.sin(greetingAge*Math.PI/1.8)*Math.sin(greetingAge*TAU*2.1) : 0;
    // Brief glances have a long quiet interval between them.
    const glanceAge = time%15, glance = glanceAge>10 ? Math.sin((glanceAge-10)*Math.PI/5) : 0;
    const nod = response*Math.sin(Math.max(0,greetingAge)*TAU/1.8)*.8;
    const wings = Math.sin(time*TAU/2.0)*.52*energy + response*.3;
    const turn = Math.sin(time*TAU/9)*.035*energy + response*.10;
    pivot.position.y = bob*.045*energy + response*.045;
    pivot.rotation.set(breath*.007*energy,turn,Math.sin(time*TAU/7)*.014*energy + wave*.025);
    pivot.scale.set(1-breath*.002*energy,1+breath*.003*energy,1+breath*.004*energy);
    for (const mesh of meshes) {mesh.morphTargetInfluences[0]=nod;mesh.morphTargetInfluences[1]=wave;mesh.morphTargetInfluences[2]=wings;mesh.morphTargetInfluences[3]=glance*.65*energy;}
    canvas.dataset.pose=JSON.stringify({bob:+pivot.position.y.toFixed(4),turn:+turn.toFixed(4),nod:+nod.toFixed(3),wave:+wave.toFixed(3),wings:+wings.toFixed(3)});
    canvas.dataset.motionState=response>0?'greeting':'idle';
  };
  const tick = now => {
    frame=timer=0;if(dead||!active||reducedMotion.matches||document.hidden)return;
    const dt=last?Math.min(.15,(now-last)/1000):0;
    elapsed += dt;last=now;energy += ((calm ? .35 : 1)-energy)*(1-Math.exp(-dt*6));
    const age=greeting<0?-1:elapsed-greeting, response=age>=0&&age<1.8?Math.sin(Math.PI*age/1.8):0;
    pose(elapsed,response);const started=performance.now();render();
    // A small phone widget needs no high frame rate; back off on slow devices.
    if(performance.now()-started>14 && ++slowFrames>=5)interval=1000/15;
    timer=setTimeout(()=>{timer=0;frame=requestAnimationFrame(tick);},interval);
  };
  function update({running=true,hidden=false,quiet=false}={}) {
    calm=quiet;const next=running&&!hidden&&!document.hidden&&!reducedMotion.matches;
    const reason=hidden||document.hidden?'hidden':reducedMotion.matches?'reduced':'paused';
    if(next){if(!active){active=true;last=0;canvas.dataset.motionState='idle';frame=requestAnimationFrame(tick);}}
    else {active=false;cancel();greeting=-1;canvas.dataset.motionState=reason;}
  }
  return {
    update,
    greet(){if(dead||!active||reducedMotion.matches)return;greeting=elapsed;},
    settle(){/* Let a short greeting finish gently when the hint closes. */},
    destroy(){dead=true;active=false;cancel();}
  };
}
