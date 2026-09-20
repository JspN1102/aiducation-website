// Only mounted for an authenticated teacher. No student ID can be supplied.
export function mountTeacherLearningReset({accountDialog,fetch:request,actorId,learningEpoch,onReset,onEpochChanged,onOpen=()=>{}}){
  const button=document.createElement('button');button.type='button';button.id='account-reset-progress';button.className='button teacher-reset-open';button.textContent='重設我的學習進度';
  accountDialog.append(button);
  const dialog=document.createElement('dialog');dialog.className='teacher-reset-dialog';dialog.id='teacher-reset-dialog';
  dialog.setAttribute('aria-labelledby','teacher-reset-title');dialog.setAttribute('aria-describedby','teacher-reset-description');
  dialog.innerHTML='<h2 id="teacher-reset-title">重新體驗六首古詩？</h2><p id="teacher-reset-description">將清空你本人的試用進度，從頭開始。學生、班級及研究資料不受影響。</p><div class="teacher-reset-actions"><button type="button" class="button" data-reset-cancel>先不重設</button><button type="button" class="button primary" data-reset-confirm>確認重設</button></div><p role="alert" hidden></p>';
  document.body.append(dialog);
  const confirm=dialog.querySelector('[data-reset-confirm]'),cancel=dialog.querySelector('[data-reset-cancel]'),error=dialog.querySelector('[role=alert]');
  const events=new AbortController();let busy=false,dead=false,requestId='';
  button.addEventListener('click',()=>{if(dead||busy)return;onOpen();accountDialog.close();error.hidden=true;dialog.showModal();cancel.focus();},{signal:events.signal});
  cancel.addEventListener('click',()=>{if(!busy)dialog.close();},{signal:events.signal});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();},{signal:events.signal});
  confirm.addEventListener('click',async()=>{
    if(busy||dead)return;busy=true;confirm.disabled=true;cancel.disabled=true;error.hidden=true;confirm.textContent='正在重設…';
    requestId ||= crypto.randomUUID();
    try{
      const response=await request('/api/school-auth/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset_my_progress',confirm:true,learningEpoch,requestId}),signal:AbortSignal.timeout(20000)});
      const data=await response.json();if(dead)return;
      if(response.status===409&&data.code==='LEARNING_RESET'){onEpochChanged();return;}
      if(!response.ok||!data.ok||data.userId!==actorId||typeof data.learningEpoch!=='string'||!/^[a-f0-9]{32}$/.test(data.learningEpoch))throw new Error('reset');
      dialog.close();onReset(data.learningEpoch);
    }catch{if(!dead){error.textContent='暫時未收到完成確認，請再試一次。';error.hidden=false;}}
    finally{busy=false;if(!dead){confirm.disabled=false;cancel.disabled=false;confirm.textContent='確認重設';}}
  },{signal:events.signal});
  return{destroy(){if(dead)return;dead=true;events.abort();dialog.close();dialog.remove();button.remove();}};
}
