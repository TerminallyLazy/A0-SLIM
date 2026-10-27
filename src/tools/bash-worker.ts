/** Self-contained Node supervisor, also sent as code to the existing sandbox adapters.
 * No shell interpolation in the launcher; all user input travels on stdin. */
export const bashWorkerCode = String.raw`
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const cfg=JSON.parse(fs.readFileSync(0,'utf8'));
const chunks={stdout:[],stderr:[]};
let bytes=0, truncated=false, timedOut=false, cancelled=false, error='', finished=false, killed=false;
const child=spawn('/bin/bash',['--noprofile','--norc','-o','pipefail','-c',cfg.command,'a0-slim'],{
  cwd:cfg.cwd, detached:true, env:{PATH:cfg.path,HOME:cfg.cwd,TMPDIR:cfg.tempDir??'/tmp',LANG:'C.UTF-8'},
  stdio:['pipe','pipe','pipe']
});
function kill(){if(child.pid&&!killed){killed=true;try{process.kill(-child.pid,'SIGKILL')}catch{}}}
function finish(code,signal){
  if(finished)return; finished=true; clearTimeout(timer); clearTimeout(drain); kill();
  child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();
  process.stdout.write(JSON.stringify({version:1,stdout:Buffer.concat(chunks.stdout).toString('base64'),stderr:Buffer.concat(chunks.stderr).toString('base64'),exitCode:code,signal,timedOut,truncated,cancelled,error,cwd:cfg.cwd}));
  if(process.connected)process.disconnect();
}
let drain;
const timer=setTimeout(()=>{timedOut=true;kill();drain=setTimeout(()=>finish(null,'SIGKILL'),250)},cfg.timeoutMs);
for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
  const room=Math.max(0,32768-bytes), part=chunk.subarray(0,room); bytes+=part.length;
  if(part.length){chunks[name].push(part);if(process.connected)process.send({stream:name,chunk:part.toString('base64')});}
  if(chunk.length>room){truncated=true;kill();}
});
child.once('error',e=>{error=e.code==='ENOENT'?'Bash or the working directory is unavailable. No fallback shell was used.':'Bash could not start.';finish(null,null)});
child.once('exit',(code,signal)=>{kill();drain=setTimeout(()=>finish(code,signal),250)});
child.once('close',(code,signal)=>finish(code,signal));
process.on('message',message=>{if(message==='cancel'){cancelled=true;kill()}});
process.on('disconnect',()=>{if(!finished){cancelled=true;kill()}});
process.on('SIGTERM',()=>{cancelled=true;kill()});
process.on('SIGINT',()=>{cancelled=true;kill()});
process.on('exit',kill);
child.stdin.on('error',()=>{});child.stdin.end(cfg.input);
if(process.connected)process.send({pid:child.pid});
`;

export type BashResult = {
  version: 1;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  cancelled: boolean;
  error: string;
  cwd: string;
};
