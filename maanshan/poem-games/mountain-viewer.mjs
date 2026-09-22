import {modelPixelRatio} from '../model-quality.mjs?v=20260921-ar1';
import {fetchModel} from '../model-source.mjs?v=20260922-school21';
const modelURL = new URL('../media/exploration/ti-xi-lin-bi/model.glb?v=20260914-restored', import.meta.url);

function disposeModel(model) {
 const textures=new Set(),materials=new Set(),geometries=new Set();
 model?.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of [].concat(node.material||[])){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 textures.forEach(value=>{value.dispose();value.source?.data?.close?.();});materials.forEach(value=>value.dispose());geometries.forEach(value=>value.dispose());
}

// One fixed mountain and one camera moving around it. Draw only after an input
// or resize, so a still scene does not consume a mobile animation loop.
export async function createMountainViewer(holder,{signal,angle=0,onContextLost}={}){
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 // The deployed copy and the public COS copy race; see model-source.mjs.
 const [{THREE,GLTFLoader},buffer]=await Promise.all([
  import('../vendor/poetry-three.mjs?v=20260913a'),fetchModel(modelURL,{signal})
 ]);
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const gltf=await new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  new GLTFLoader().parse(buffer,'',value=>{
   signal?.removeEventListener('abort',abort);
   if(signal?.aborted){disposeModel(value.scene);reject(new DOMException('Aborted','AbortError'));}else resolve(value);
  },error=>{signal?.removeEventListener('abort',abort);reject(error);});
 });
 if(signal?.aborted){disposeModel(gltf.scene);throw new DOMException('Aborted','AbortError');}
 let renderer;
 try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch(error){disposeModel(gltf.scene);throw error;}
 const canvas=renderer.domElement;
 canvas.setAttribute('role','img');canvas.setAttribute('aria-label','同一座廬山的立體山景，可左右拖動或使用下方滑桿轉換角度');
 renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.02,100),model=gltf.scene,wrapper=new THREE.Group();
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),longest=Math.max(size.x,size.y,size.z);
 if(!Number.isFinite(longest)||longest<=0){disposeModel(model);renderer.dispose();renderer.forceContextLoss();throw new Error('empty-model');}
 model.position.sub(bounds.getCenter(new THREE.Vector3()));wrapper.add(model);wrapper.scale.setScalar(2.6/longest);scene.add(wrapper);
 model.traverse(node=>{for(const material of [].concat(node.material||[]))for(const value of Object.values(material))if(value?.isTexture)value.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});
 scene.add(new THREE.HemisphereLight(0xfffaf1,0x809b8c,2.1));
 const sun=new THREE.DirectionalLight(0xfff3df,2.7);sun.position.set(-3,8,5);scene.add(sun);
 const fill=new THREE.DirectionalLight(0xe3edf5,1.25);fill.position.set(4,3,-3);scene.add(fill);
 const sphere=new THREE.Box3().setFromObject(wrapper).getBoundingSphere(new THREE.Sphere());
 let current=Number(angle)||0,distance=6,dead=false,frame=0,visible=true;
 function position(value){const theta=Math.max(0,Math.min(100,value))/100*Math.PI/2;const direction=new THREE.Vector3(Math.cos(theta),.32,Math.sin(theta)).normalize();camera.position.copy(sphere.center).addScaledVector(direction,distance);camera.lookAt(sphere.center);camera.updateMatrixWorld();}
 function draw(){if(dead||!visible||document.hidden)return;position(current);renderer.render(scene,camera);}
 function schedule(){if(dead||frame||!visible||document.hidden)return;frame=requestAnimationFrame(()=>{frame=0;draw();});}
 function resize(){if(dead)return;const width=holder.clientWidth,height=holder.clientHeight;if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();const half=THREE.MathUtils.degToRad(camera.fov/2),limiting=Math.min(half,Math.atan(Math.tan(half)*camera.aspect));distance=sphere.radius/Math.sin(limiting)*.77;renderer.setPixelRatio(modelPixelRatio(width,height));renderer.setSize(width,height,false);schedule();}
 const observer=new ResizeObserver(resize);observer.observe(holder);
 const visibility=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)schedule();});visibility.observe(holder);
 const resume=()=>{if(!document.hidden)schedule();};document.addEventListener('visibilitychange',resume);
 const lost=e=>{e.preventDefault();if(!dead)onContextLost?.();};canvas.addEventListener('webglcontextlost',lost);
 holder.replaceChildren(canvas);resize();draw();
 return {
  setAngle(value){current=Math.max(0,Math.min(100,Number(value)||0));schedule();},
  capture(value=current){
   if(dead)return '';
   position(value);renderer.render(scene,camera);
   try{
    // The live orbit deliberately leaves room around the mountain. A collected
    // photograph crops that transparent room, keeping every visible rock.
    const source=document.createElement('canvas');source.width=canvas.width;source.height=canvas.height;
    const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,0,0);
    const pixels=context.getImageData(0,0,source.width,source.height).data;
    let left=source.width,top=source.height,right=-1,bottom=-1;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
     if(pixels[(y*source.width+x)*4+3]===0)continue;
     left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    if(right<left)return source.toDataURL('image/webp',.94);
    const width=right-left+1,height=bottom-top+1,photo=document.createElement('canvas');
    photo.width=960;photo.height=640;
    const output=photo.getContext('2d'),scale=Math.min(photo.width*.9/width,photo.height*.9/height);
    const drawnWidth=width*scale,drawnHeight=height*scale;
    output.imageSmoothingEnabled=true;output.imageSmoothingQuality='high';
    output.drawImage(source,left,top,width,height,(photo.width-drawnWidth)/2,(photo.height-drawnHeight)/2,drawnWidth,drawnHeight);
    return photo.toDataURL('image/webp',.94);
   }finally{position(current);renderer.render(scene,camera);}
  },
  destroy(){if(dead)return;dead=true;cancelAnimationFrame(frame);observer.disconnect();visibility.disconnect();document.removeEventListener('visibilitychange',resume);canvas.removeEventListener('webglcontextlost',lost);disposeModel(scene);renderer.renderLists?.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();scene.clear();}
 };
}
