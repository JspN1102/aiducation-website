// A real WebXR hit-test session. The existing Three.js renderer is reused;
// no camera, model download or immersive session starts without a child tapping.
export function startSurfaceAR({THREE, renderer, scene, camera, model, ground, controls, bounds, session, overlay, onEnd}) {
  let ended = false, hitSource = null, placed = false;
  const saved = {position:model.position.clone(),scale:model.scale.clone(),visible:model.visible,
    cameraPosition:camera.position.clone(),cameraQuaternion:camera.quaternion.clone(),cameraScale:camera.scale.clone(),
    cameraFov:camera.fov,cameraZoom:camera.zoom,ground:ground.visible};
  const anchor = new THREE.Group();
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  const marker = new THREE.Mesh(new THREE.RingGeometry(.065,.085,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x78b892,side:THREE.DoubleSide}));
  marker.matrixAutoUpdate = false;
  marker.visible = false;
  scene.add(anchor, marker);
  anchor.add(model);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const factor = .45 / Math.max(dimensions.x,dimensions.y,dimensions.z);
  model.scale.multiplyScalar(factor);
  model.position.set(0,-bounds.min.y*factor,0);
  ground.visible = false;
  controls.enabled = false;
  const status = overlay.querySelector('[data-ar-status]');
  let message = '';
  function say(value) {if(message!==value){message=value;status.textContent=value;}}
  say('慢慢移動手機，找一張桌面或一塊平地。');
  const stopSelection = event => event.preventDefault();
  overlay.addEventListener('beforexrselect',stopSelection);
  function place() {
    if (ended || !marker.visible) return;
    anchor.matrix.copy(marker.matrix);
    anchor.visible = true; placed = true;
    say('放好啦！慢慢移動手機，從不同方向看一看。');
  }
  session.addEventListener('select',place);
  function cleanup() {
    if (ended) return;
    ended = true;
    renderer.setAnimationLoop(null);
    hitSource?.cancel(); hitSource = null;
    session.removeEventListener('select',place);
    session.removeEventListener('end',cleanup);
    overlay.removeEventListener('beforexrselect',stopSelection);
    scene.add(model);
    model.position.copy(saved.position);model.scale.copy(saved.scale);model.visible=saved.visible;
    camera.position.copy(saved.cameraPosition);camera.quaternion.copy(saved.cameraQuaternion);
    // WebXR updates the supplied camera's projection and decomposes its pose.
    // Restore these before the ordinary 3D viewer calculates its framing again.
    camera.scale.copy(saved.cameraScale);camera.fov=saved.cameraFov;camera.zoom=saved.cameraZoom;
    camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    ground.visible=saved.ground;controls.enabled=true;
    scene.remove(anchor,marker);marker.geometry.dispose();marker.material.dispose();
    overlay.hidden=true;renderer.xr.enabled=false;
    onEnd?.();
  }
  session.addEventListener('end',cleanup,{once:true});
  const ready=(async()=>{
    try {
      renderer.xr.enabled=true;
      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(session);
      if(ended)return;
      const viewerSpace=await session.requestReferenceSpace('viewer');
      if(ended)return;
      const source=await session.requestHitTestSource({space:viewerSpace});
      if(ended){source.cancel();return;}
      hitSource=source;
      renderer.setAnimationLoop((_time,frame)=>{
        if(ended||!frame)return;
        const space=renderer.xr.getReferenceSpace();
        const hits=frame.getHitTestResults(hitSource);
        const pose=hits[0]?.getPose(space);
        marker.visible=!!pose&&!placed;
        if(pose){marker.matrix.fromArray(pose.transform.matrix);if(!placed)say('看到綠色圓圈了，輕點畫面放下模型。');}
        else if(!placed)say('慢慢移動手機，找一張桌面或一塊平地。');
        renderer.render(scene,camera);
      });
    }catch(error){cleanup();await session.end().catch(()=>{});throw error;}
  })();
  return {ready,destroy(){cleanup();session.end().catch(()=>{});}};
}
