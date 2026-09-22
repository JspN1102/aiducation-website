'use strict';
// Operator-only, non-destructive cohort switch. Run on Guangzhou as postgres
// while maanshan.service is stopped, after deploying the epoch-aware runtime.
// No HTTP endpoint can invoke this operation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Pool}=require('pg');
const {KEY}=require('../api/_lib/student-learning-reset.cjs');
const TABLES=['student_data','research_events','school_recordings','teacher_analysis_records','research_sync_state','research_outbox_receipts'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function snapshots(client){
 const result={};
 for(const table of TABLES){
  const rows=(await client.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum FROM ${table} t`)).rows;
  result[table]=rows[0];
 }
 return result;
}
async function main(){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('Use explicit --name value arguments');options[args[i].slice(2)]=args[i+1];}
 if(Object.keys(options).some(k=>!['apply','request-id','expect-students','expect-epoch','backup','backup-sha256'].includes(k))||options.apply!=='yes'||
    !/^[a-f0-9-]{36}$/.test(options['request-id']||'')||!/^\d+$/.test(options['expect-students']||'')||
    !/^(initial|[a-f0-9]{32})$/.test(options['expect-epoch']||'')||!/^[a-f0-9]{64}$/.test(options['backup-sha256']||''))throw Error('Missing verified reset parameters');
 const backup=fs.realpathSync(options.backup||'');
 if(path.dirname(backup)!=='/var/backups/maanshan'||!/^maanshan-\d{8}T\d{6}Z\.dump$/.test(path.basename(backup)))throw Error('Backup must be an existing dedicated full database dump');
 const stat=fs.statSync(backup);
 if(stat.size<10000||Date.now()-stat.mtimeMs>6*3600000||sha(fs.readFileSync(backup))!==options['backup-sha256'])throw Error('Backup is stale or checksum does not match');
 if(spawnSync('pg_restore',['--list',backup],{stdio:'ignore'}).status!==0)throw Error('Backup validation failed');
 const service=spawnSync('systemctl',['is-active','maanshan'],{encoding:'utf8'}).stdout.trim();
 if(service!=='inactive')throw Error('Stop maanshan.service to drain old in-flight writes before switching cohorts');
 const pool=new Pool({host:'/var/run/postgresql',database:'maanshan_db',user:'postgres',max:1,application_name:'student-learning-reset',statement_timeout:15000});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock(8426210922)');
  await client.query(`CREATE TABLE IF NOT EXISTS student_learning_resets(request_id uuid PRIMARY KEY,epoch char(32) UNIQUE NOT NULL,reset_at timestamptz NOT NULL,manifest jsonb NOT NULL)`);
  await client.query('LOCK TABLE school_auth_objects,student_learning_resets,'+TABLES.join(',')+' IN SHARE ROW EXCLUSIVE MODE');
  const duplicate=(await client.query('SELECT manifest FROM student_learning_resets WHERE request_id=$1',[options['request-id']])).rows[0];
  if(duplicate){await client.query('ROLLBACK');console.log(JSON.stringify({alreadyApplied:true,...duplicate.manifest.summary}));return;}
  const previous=(await client.query('SELECT document,revision FROM school_auth_objects WHERE object_key=$1 FOR UPDATE',[KEY])).rows[0]||null;
  if((previous?.document?.epoch||'initial')!==options['expect-epoch'])throw Error('Current cohort changed; refusing an unreviewed second reset');
  const directory=(await client.query("SELECT document FROM school_auth_objects WHERE object_key='directory/current'")).rows[0]?.document;
  const students=directory?.accounts?.filter(p=>p.role==='student');
  const teachers=directory?.accounts?.filter(p=>p.role==='teacher');
  if(!students||students.length!==Number(options['expect-students'])||!teachers?.length)throw Error('Roster changed; verify student count before retry');
  const before=await snapshots(client),epoch=crypto.randomBytes(16).toString('hex');
  const resetAt=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
  const control={version:1,role:'student',epoch,previousEpoch:previous?.document?.epoch||null,resetAt,requestId:options['request-id'],reason:'prelaunch-test-data-retained',studentCount:students.length,backup:{path:backup,sha256:options['backup-sha256']}};
  await client.query(`INSERT INTO school_auth_objects(object_key,document) VALUES($1,$2::jsonb) ON CONFLICT(object_key) DO UPDATE SET document=EXCLUDED.document,revision=school_auth_objects.revision+1,updated_at=clock_timestamp()`,[KEY,JSON.stringify(control)]);
  const after=await snapshots(client);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical tables changed during cohort switch; transaction rolled back');
  const ids=students.map(p=>'v_'+sha(p.id+':'+epoch).slice(0,28));
  const progress=(await client.query('SELECT count(*)::int AS n FROM student_data WHERE student_id=ANY($1::text[])',[ids])).rows[0].n;
  const recordings=(await client.query('SELECT count(*)::int AS n FROM school_recordings WHERE learning_epoch=$1',[epoch])).rows[0].n;
  const events=(await client.query('SELECT count(*)::int AS n FROM research_events WHERE received_at >= $1::timestamptz',[resetAt])).rows[0].n;
  if(progress||recordings||events)throw Error('Fresh learning scope is not empty; transaction rolled back');
  const summary={requestId:options['request-id'],epoch,resetAt,studentAccounts:students.length,teacherAccountsUnchanged:teachers.length,historicalTables:after,newProgress:progress,newRecordings:recordings,newResearchEvents:events,backup,backupSha256:options['backup-sha256']};
  const manifest={version:1,summary,previousControl:previous,students:students.map(p=>({actorId:p.id,researchId:p.researchId})),directoryChecksum:directory.sha256};
  await client.query('INSERT INTO student_learning_resets(request_id,epoch,reset_at,manifest) VALUES($1,$2,$3,$4::jsonb)',[options['request-id'],epoch,resetAt,JSON.stringify(manifest)]);
  await client.query('COMMIT');
  console.log(JSON.stringify(summary));
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error('Student cohort reset failed: '+error.message);process.exitCode=1;});
module.exports={TABLES,snapshots};
