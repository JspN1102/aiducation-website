// One storage key per record keeps acknowledgements safe across browser tabs.
// Rejected records stay on this device with a separate hold marker.
export function createPersistentQueue({prefix, storage, identify, valid, compare, limit=5000, notify=()=>{}}) {
  const holdPrefix=prefix+'hold:', memory=new Map(), held=new Set();
  let pending=[], storageAvailable=Boolean(storage);
  const signal=state=>{try{notify(state);}catch{}};
  function hold(id,reason='invalid_record') {
    if(held.has(id))return;
    held.add(id);
    try{storage?.setItem(holdPrefix+id,reason);}catch{storageAvailable=false;signal('storage_unavailable');}
    pending=pending.filter(item=>identify(item)!==id);
    signal('records_held');
  }
  function recover() {
    const found=new Map();
    if(storage)try{
      const names=[];let readable=true;
      for(let index=0;index<storage.length;index++){const name=storage.key(index);if(name?.startsWith(prefix))names.push(name);}
      for(const name of names)if(name.startsWith(holdPrefix))held.add(name.slice(holdPrefix.length));
      for(const name of names){
        if(name.startsWith(holdPrefix))continue;
        const id=name.slice(prefix.length);
        if(held.has(id))continue;
        let text;
        try{text=storage.getItem(name);}
        catch{readable=false;storageAvailable=false;signal('storage_unavailable');const known=pending.find(item=>identify(item)===id);if(known)found.set(id,known);continue;}
        if(text===null)continue; // Another tab acknowledged it after the scan.
        try{
          const item=JSON.parse(text);
          if(!valid(item)||identify(item)!==id){hold(id);continue;}
          found.set(id,item);
        }catch{hold(id,'unreadable_record');}
      }
      if(readable)storageAvailable=true;
    }catch{storageAvailable=false;signal('storage_unavailable');for(const item of pending)found.set(identify(item),item);}
    for(const [id,item]of memory)if(!held.has(id))found.set(id,item);
    pending=[...found.values()].sort(compare);
    return pending;
  }
  function add(item) {
    if(pending.length+held.size>=limit){recover();if(pending.length+held.size>=limit){signal('queue_full');return false;}}
    const snapshot=JSON.parse(JSON.stringify(item));
    if(!valid(snapshot))return false;
    const id=identify(snapshot);if(held.has(id))return false;
    // Never overwrite another operation with an existing identity.
    const existing=pending.find(record=>identify(record)===id);
    if(existing)return JSON.stringify(existing)===JSON.stringify(snapshot);
    pending.push(snapshot);
    try{if(!storage)throw Error();storage.setItem(prefix+id,JSON.stringify(snapshot));memory.delete(id);storageAvailable=true;}
    catch{storageAvailable=false;memory.set(id,snapshot);signal('storage_unavailable');}
    return true;
  }
  function acknowledge(ids) {
    const accepted=new Set(ids);
    for(const id of accepted){memory.delete(id);try{storage?.removeItem(prefix+id);}catch{storageAvailable=false;signal('storage_unavailable');}}
    pending=pending.filter(item=>!accepted.has(identify(item)));
  }
  recover();
  return {add,recover,hold,acknowledge,
    values:()=>pending.slice(),
    status:()=>({pending:pending.length,held:held.size,volatile:memory.size,storageAvailable})};
}
