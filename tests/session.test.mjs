import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
async function session(inputs,args=[]) {
  const folder=await mkdtemp(join(tmpdir(),'mengren-session-')),exe=join(folder,'launcher.exe'),worker=join(folder,'download.ps1');
  await copyFile(resolve('猛人下载器.exe'),exe);
  await writeFile(worker,'\uFEFF'+[
    'param([switch]$Check,[switch]$Session)',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    'if ($Check) { Write-Host "CHECK_ONLY"; exit 0 }',
    'if (!$Session) { exit 9 }',
    'Write-Host "SESSION_READY"',
    '$value = [Console]::ReadLine()',
    'if ([string]::IsNullOrWhiteSpace($value)) { exit 20 }',
    'Write-Host ("JOB:" + $value)',
    'if ($value -eq "fail") { exit 1 }',
    'exit 0'
  ].join('\r\n'),'utf8');
  try {
    return await new Promise((done,reject)=>{
      const child=spawn(exe,args,{cwd:folder,stdio:['pipe','pipe','pipe'],windowsHide:true});
      let text='',ready=0;
      const timer=setTimeout(()=>{child.kill();reject(Error('Continuous session timed out'));},30000);
      const receive=buffer=>{
        text+=buffer.toString('utf8');const count=(text.match(/SESSION_READY/g)||[]).length;
        while(ready<count){const value=inputs[ready++];child.stdin.write((value??'')+'\n');}
      };
      child.stdout.on('data',receive);child.stderr.on('data',receive);
      child.stdin.on('error',()=>{});
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);done({code,text,ready});});
    });
  } finally {await unlink(exe);await unlink(worker);await rmdir(folder);}
}
test('One console continues after success and failure, then one empty Enter closes it',async()=>{
  const result=await session(['first','fail','second','']);
  assert.equal(result.code,0);assert.equal(result.ready,4);
  for(const value of ['first','fail','second'])assert.ok(result.text.includes('JOB:'+value));
  assert.equal(result.text.includes('按回车关闭窗口'),false);
});
test('Empty input exits without starting a download',async()=>{
  const result=await session(['']);assert.equal(result.code,0);assert.equal(result.ready,1);assert.equal(result.text.includes('JOB:'),false);
});
test('Check mode runs once without waiting for a new link',async()=>{
  const result=await session([],['--check']);assert.equal(result.code,0);assert.equal(result.ready,0);assert.ok(result.text.includes('CHECK_ONLY'));
});

// Exercise the real worker before initialization, in addition to the isolated launcher cases.
test('Formal application accepts empty Enter at its actual link prompt',async()=>{
  const result=await new Promise((done,reject)=>{
    const child=spawn(resolve('猛人下载器.exe'),[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let text='',sent=false;
    const timer=setTimeout(()=>{child.kill();reject(Error('Actual input prompt timed out'));},20000);
    const receive=buffer=>{text+=buffer.toString('utf8');if(!sent&&text.includes('直接回车退出')){sent=true;child.stdin.end('\n');}};
    child.stdout.on('data',receive);child.stderr.on('data',receive);child.stdin.on('error',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);done({code,text,sent});});
  });
  assert.equal(result.code,0);assert.equal(result.sent,true);assert.equal(result.text.includes('按回车关闭窗口'),false);
});
