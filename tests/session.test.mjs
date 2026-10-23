import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,unlink,rmdir,readFile,rm} from 'node:fs/promises';
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

test('Declining capture returns to link input without activating system settings',async()=>{
  const result=await new Promise((done,reject)=>{
    const child=spawn(resolve('猛人下载器.exe'),[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let text='',sent=0,declined=false;
    const timer=setTimeout(()=>{child.kill();reject(Error('Capture consent entry timed out'));},30000);
    const receive=buffer=>{text+=buffer.toString('utf8');const count=(text.match(/直接回车退出/g)||[]).length;while(sent<count)child.stdin.write((sent++===0?'抓取':'')+'\n');if(!declined&&text.includes('其他输入返回')){declined=true;child.stdin.write('返回\n');}};
    child.stdout.on('data',receive);child.stderr.on('data',receive);child.stdin.on('error',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);done({code,text,sent,declined});});
  });
  assert.equal(result.code,0);assert.equal(result.sent,2);assert.equal(result.declined,true);assert.equal(result.text.includes('抓取已开启'),false);
});

test('A mistyped quality asks again instead of discarding the pasted link',async()=>{
  const result=await new Promise((done,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('download.ps1'),'-Url','https://www.youtube.com/watch?v=jNQXAC9IVRw','-OutputDirectory',tmpdir()],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let text='',sent=0;
    const timer=setTimeout(()=>{child.kill();reject(Error('Quality prompt timed out'));},30000);
    // Two typos, then end of input: no download may start, and the prompt repeats.
    const receive=buffer=>{text+=buffer.toString('utf8');const prompts=(text.match(/请选择 1-4/g)||[]).length;while(sent<prompts){if(sent<2)child.stdin.write(['9','abc'][sent]+'\n');else child.stdin.end();sent++;}};
    child.stdout.on('data',receive);child.stderr.on('data',receive);child.stdin.on('error',()=>{});
    child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);done({code,text});});
  });
  assert.equal((result.text.match(/请选择 1-4/g)||[]).length,3);
  assert.equal((result.text.match(/请输入 1、2、3 或 4/g)||[]).length,2);
  assert.ok(result.text.includes('没有读取到画质选择'));assert.equal(result.text.includes('正在解析和下载'),false);assert.equal(result.code,1);
});

test('Ctrl+C stops only the running task; the window stays for the next link',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'mengren-ctrlc-')),exe=join(folder,'launcher.exe'),worker=join(folder,'download.ps1'),output=join(folder,'result.json');
  await copyFile(resolve('猛人下载器.exe'),exe);
  await writeFile(worker,'﻿'+[
    'param([switch]$Check,[switch]$Session)',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    'Write-Host "SESSION_READY"',
    '$value = [Console]::ReadLine()',
    'if ([string]::IsNullOrWhiteSpace($value)) { exit 20 }',
    'Write-Host "LONG_START"',
    `& '${resolve('node.exe').replace(/'/g,"''")}' -e "setTimeout(()=>{},20000)"`,
    'Write-Host "AFTER_NATIVE"',
    'exit 1'
  ].join('\r\n'),'utf8');
  try {
    // The harness needs its own console to deliver a real Ctrl+C, hence Start-Process.
    const harness=resolve('tests/ctrlc-harness.ps1').replace(/'/g,"''");
    const command=`Start-Process powershell.exe -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${harness}"','-Launcher','"${exe}"','-Result','"${output}"')`;
    const code=await new Promise((done,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-Command',command],{stdio:'ignore',windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(Error('Ctrl+C harness timed out'));},90000);child.on('error',reject);child.on('close',value=>{clearTimeout(timer);done(value);});});
    assert.equal(code,0);
    const result=JSON.parse((await readFile(output,'utf8')).replace(/^﻿/,''));
    assert.equal(result.sentCtrlC,true);assert.equal(result.code,0);assert.equal(result.ready,2);
    assert.ok(result.text.includes('已中止本次任务'));assert.equal(result.text.includes('AFTER_NATIVE'),false);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('Every video of a multi-video post is published, names never overwrite, and X/YouTube errors become Chinese advice',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'mengren-helpers-')),script=join(folder,'check.ps1');
  try {
    await writeFile(script,'﻿'+[
      '$ErrorActionPreference = "Stop"',
      '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
      `. '${resolve('source/download-helpers.ps1').replace(/'/g,"''")}'`,
      '$out = Join-Path $PSScriptRoot "out"; $job = Join-Path $out ".mengren-Ab12Cd"',
      'New-Item -ItemType Directory -Path $job -Force | Out-Null',
      'Set-Content -LiteralPath (Join-Path $out "Post #1.mp4") -Value "old"',
      'foreach ($n in "Post #1.mp4","Post #2.mp4",".owner","Post #3.mp4.part") { Set-Content -LiteralPath (Join-Path $job $n) -Value $n }',
      '$saved = @(Publish-MengrenDownloads $job $out | ForEach-Object { Split-Path $_ -Leaf })',
      '$emptyJob = Join-Path $out ".mengren-Empty1"; New-Item -ItemType Directory -Path $emptyJob | Out-Null',
      '$emptyError = ""; try { Publish-MengrenDownloads $emptyJob $out | Out-Null } catch { $emptyError = $_.Exception.Message }',
      '$hint = { param($h,$t) $r = Get-MengrenFailureHint $h $t; if ($r) { $r -join "|" } else { "" } }',
      '[pscustomobject]@{',
      '  saved = $saved; left = @(Get-ChildItem -LiteralPath $job -Force | ForEach-Object { [string]$_.Name }); old = [IO.File]::ReadAllText((Join-Path $out "Post #1.mp4")).Trim(); emptyError = $emptyError',
      '  hosts = @("x.com","mobile.twitter.com","twitter.com","x.com.evil.org","notx.com","youtube.com" | ForEach-Object { [bool](Test-MengrenXHost $_) })',
      '  nsfw = & $hint "x.com" "ERROR: [twitter] 1: NSFW tweet requires authentication. Use --cookies"',
      '  protected = & $hint "twitter.com" "ERROR: You are not authorized to view this protected tweet"',
      '  novideo = & $hint "x.com" "ERROR: [twitter] 1: No video could be found in this tweet"',
      '  gone = & $hint "x.com" "ERROR: [twitter] 1: This Tweet is unavailable"',
      '  limited = & $hint "x.com" "ERROR: HTTP Error 429: Too Many Requests"',
      '  bot = & $hint "www.youtube.com" "ERROR: Sign in to confirm you’re not a bot"',
      '  unknown = & $hint "x.com" "ERROR: something new"',
      '  otherSite = & $hint "www.bilibili.com" "NSFW tweet requires authentication"',
      '} | ConvertTo-Json -Compress'
    ].join('\r\n'));
    const text=await new Promise((done,fail)=>{let out='';const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true});child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.on('error',fail);child.on('close',()=>done(out));});
    const r=JSON.parse(text.trim().split(/\r?\n/).pop());
    assert.deepEqual(r.saved,['Post #1 (2).mp4','Post #2.mp4']);
    assert.equal(r.old,'old');
    assert.deepEqual([...r.left].sort(),['.owner','Post #3.mp4.part']);
    assert.match(r.emptyError,/下载结果不完整/);
    assert.deepEqual(r.hosts,[true,true,true,false,false,false]);
    assert.match(r.nsfw,/需要登录/);assert.match(r.protected,/需要登录/);
    assert.match(r.novideo,/没有视频/);assert.match(r.gone,/已删除/);assert.match(r.limited,/限制了访问次数/);
    assert.match(r.bot,/机器人/);
    assert.equal(r.unknown,'');assert.equal(r.otherSite,'');
  } finally {await rm(folder,{recursive:true,force:true});}
});
