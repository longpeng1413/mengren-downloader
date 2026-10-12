import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {isXiaoe,xiaoeAddress,channelsShare,isPlayback,allowedMedia,xiaoeProbeExpression,channelsProbeExpression,playbackProbeExpression} from '../source/sites.mjs';
import {rewritePlaylist,publicIp} from '../source/relay.mjs';
const shop='https://appfixture123.h5.xiaoeknow.com',page=shop+'/v4/course/alive/l_fixture12345?app_id=appfixture123';
const share='https://weixin.qq.com/sph/Fixture123',media='https://finder.video.qq.com/251/20302/stodownload?encfilekey=fixture';
test('Xiaoe aliases and share formats resolve to the same shop/resource',()=>{
  for(const host of ['xet.tech','xetslk.com','xetlk.com']) for(const prefix of ['s','sl']) assert.ok(isXiaoe(`https://shop.${host}/${prefix}/Fixture`));
  const params=Buffer.from(JSON.stringify({app_id:'appfixture123',resource_id:'l_fixture12345'})).toString('base64');
  assert.equal(xiaoeAddress('https://appfixture123.mp.xiaoeknow.com/?params='+encodeURIComponent(params)),page);
  assert.equal(xiaoeAddress(shop+'/content_page/'+encodeURIComponent(params)),page);
  assert.equal(xiaoeAddress(shop+'/p/t/free/v1/basic-platform/h5_basic/login/auth?redirect_url='+encodeURIComponent(page)),page);
  assert.equal(xiaoeAddress(page.replace('app_id=appfixture123','app_id=appother123')),null);
  assert.equal(xiaoeAddress(shop+'/?params='+Buffer.from(JSON.stringify({app_id:'appfixture123',h5_url:page.replace('appfixture123','appother123')})).toString('base64')),null);
  for(const bad of ['http://shop.xet.tech/s/X','https://xet.tech.evil.org/sl/X','https://user:pass@shop.xet.tech/s/X']) assert.equal(isXiaoe(bad),false);
});
test('Channels accepts only share links and official playback/media destinations',()=>{
  assert.equal(channelsShare(share),share);
  assert.equal(channelsShare('https://channels.weixin.qq.com/finder-preview/pages/sph?id=Fixture123'),share);
  for(const bad of [share+'?token=x',share+'#x',share.replace('weixin.qq.com','weixin.qq.com.evil.org'),share.replace('https:','http:')]) assert.equal(channelsShare(bad),null);
  assert.ok(isPlayback('https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture'));
  assert.ok(allowedMedia('channels',media));
  for(const bad of [media.replace('finder.video.qq.com','evil.org'),media+'#x',media.replace('https:','http:'),media.replace('/251/20302/stodownload','/other')]) assert.equal(allowedMedia('channels',bad),false);
  assert.ok(allowedMedia('xiaoe','https://media.xet.tech/video.m3u8'));
  assert.equal(allowedMedia('xiaoe','https://127.0.0.1/video.m3u8'),false);
});
test('HLS nested manifests, AES keys and relative segments are rewritten',()=>{
  const inputs=[];
  const source='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index"\n#EXT-X-KEY:METHOD=AES-128,URI="key?fixture=1"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/index\n';
  const rewritten=rewritePlaylist(source,'https://media.xet.tech/folder/master.m3u8',(url,playlist)=>{inputs.push({url,playlist});return 'http://127.0.0.1:1234/fixture/'+inputs.length;});
  assert.equal(inputs.length,3);assert.equal(inputs[0].playlist,true);assert.equal(inputs[1].playlist,false);assert.equal(inputs[2].playlist,true);
  assert.equal(inputs[1].url,'https://media.xet.tech/folder/key?fixture=1');assert.equal(rewritten.includes('fixture=1'),false);
  for(const unsupported of ['#EXTM3U\n#EXT-X-DEFINE:NAME="x",VALUE="y"','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=key']) assert.throws(()=>rewritePlaylist(unsupported,'https://media.xet.tech/x.m3u8',()=>''));
  assert.throws(()=>rewritePlaylist('#EXTM3U\nhttps://127.0.0.1/key','https://media.xet.tech/x.m3u8',url=>{if(!allowedMedia('xiaoe',url)) throw Error('refused');return url;}));
});
test('Private, loopback and reserved media addresses are refused',()=>{
  for(const value of ['127.0.0.1','10.0.0.1','169.254.1.1','192.168.1.1','172.16.1.1','100.64.1.1','198.18.1.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1']) assert.equal(publicIp(value),false,value);
  for(const value of ['8.8.8.8','1.1.1.1','240e::1']) assert.equal(publicIp(value),true,value);
});
async function evaluate(expression,origin,respond) {
  const calls=[];
  const context={location:{origin,href:origin},document:{title:'Fixture'},URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return respond(url,options);}};
  const result=await vm.runInNewContext(expression,context);return {result,calls};
}
test('Login remains on Yuanbao, only selected share is posted and no chat is created',async()=>{
  const {result,calls}=await evaluate(channelsProbeExpression(share),'https://yuanbao.tencent.com',()=>({status:401}));
  assert.equal(result.state,'login');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/weixin/get_parse_result');assert.equal(calls[0].options.credentials,'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body),{type:'video_channel_url',url:share,scene:1});
  const foreign=await evaluate(channelsProbeExpression(share),'https://evil.org',()=>{throw Error('should not fetch');});assert.equal(foreign.calls.length,0);
});
test('Xiaoe login is used only on exact shop origin; no cookie data is read',async()=>{
  const denied=await evaluate(xiaoeProbeExpression(page),shop,()=>({ok:true,json:async()=>({code:11302})}));assert.equal(denied.result.state,'login');assert.equal(denied.calls[0].options.credentials,'include');
  const foreign=await evaluate(xiaoeProbeExpression(page),'https://evil.org',()=>{throw Error('should not fetch');});assert.equal(foreign.calls.length,0);
});
test('Official playback API does not forward Yuanbao login',async()=>{
  const calls=[];const href='https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture&eid=fixture-id';
  const answer=await vm.runInNewContext(playbackProbeExpression,{location:{href},document:{title:'Fixture'},URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {json:async()=>({errCode:0,data:{errMsg:{type:0},feedInfo:{description:'Fixture',h264VideoInfo:{videoUrl:media}}}})};}});
  assert.equal(answer.state,'ready');assert.equal(answer.mediaUrl,media);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].url,'/finder-preview/api/feed/get_feed_info');
});

test('A real silent MP4 is valid, while a non-video file is rejected',async()=>{
  const {mkdtemp,writeFile,unlink,rmdir}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {spawn}=await import('node:child_process');
  const {validate}=await import('../source/site-download.mjs');
  const folder=await mkdtemp(join(tmpdir(),'mengren-video-test-')),video=join(folder,'silent.mp4'),bad=join(folder,'invalid.txt');
  try {
    const code=await new Promise(done=>{const child=spawn(resolve('ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=1','-t','1','-an',video],{stdio:'ignore',windowsHide:true});child.on('close',done);child.on('error',()=>done(-1));});
    assert.equal(code,0);await validate(video);await assert.rejects(validate(video,{requireAudio:true}));
    await writeFile(bad,'Not a media file');await assert.rejects(validate(bad));
  } finally {await unlink(video).catch(()=>{});await unlink(bad).catch(()=>{});await rmdir(folder);}
});

test('Douyin and Bilibili normalise page/short links and reject cross-item tracks',async()=>{
  const {douyinAddress,biliAddress,browserMediaAllowed}=await import('../source/sites.mjs');
  assert.equal(douyinAddress('https://www.douyin.com/?modal_id=123456'),'https://www.douyin.com/video/123456');
  assert.equal(douyinAddress('https://v.douyin.com/Fixture/'),'https://v.douyin.com/Fixture/');
  assert.equal(biliAddress('https://m.bilibili.com/video/BV1vL411G7N7/?p=2&share_source=copy'),'https://www.bilibili.com/video/BV1vL411G7N7?p=2');
  assert.equal(biliAddress('https://b23.tv/Fixture'),'https://b23.tv/Fixture');
  assert.equal(biliAddress('https://www.bilibili.com/video/BV1vL411G7N7?p=-1'),null);
  for(const bad of ['https://douyin.com.evil.org/video/123','https://user:pass@www.douyin.com/video/123'])assert.equal(douyinAddress(bad),null);
  assert.ok(browserMediaAllowed('douyin','https://www.douyin.com/video/123','https://v1.douyinvod.com/video.mp4?__vid=123'));
  assert.equal(browserMediaAllowed('douyin','https://www.douyin.com/video/123','https://v1.douyinvod.com/video.mp4?__vid=456'),false);
  assert.ok(browserMediaAllowed('bili','https://www.bilibili.com/video/BV1vL411G7N7','https://upos.bilivideo.com/video.m4s'));
  assert.equal(browserMediaAllowed('bili','https://www.bilibili.com/video/BV1vL411G7N7','https://evil.org/video.m4s'),false);
});
test('Bilibili browser fallback honours current part, quality cap and separate audio',async()=>{
  const {biliProbeExpression}=await import('../source/sites.mjs');
  const href='https://www.bilibili.com/video/BV1vL411G7N7';
  const context={location:{href},URL,AbortSignal,document:{title:'Fixture'},window:{__INITIAL_STATE__:{videoData:{bvid:'BV1vL411G7N7',title:'Fixture',pages:[{cid:1}]}},__playinfo__:{data:{timelength:20000,dash:{video:[{height:1080,bandwidth:500,baseUrl:'https://upos.bilivideo.com/1080.m4s'},{height:720,bandwidth:300,baseUrl:'https://upos.bilivideo.com/720.m4s'}],audio:[{bandwidth:128,baseUrl:'https://upos.bilivideo.com/audio.m4s'}]}}}}};
  const info=await vm.runInNewContext(biliProbeExpression(href,'720'),context);
  assert.equal(info.state,'ready');assert.equal(info.height,720);assert.equal(info.mediaUrl,'https://upos.bilivideo.com/720.m4s');assert.equal(info.audioUrl,'https://upos.bilivideo.com/audio.m4s');
  const capped=await vm.runInNewContext(biliProbeExpression(href,'480'),context);assert.equal(capped.state,'quality-unavailable');
  context.window.__playinfo__.data.durl=[{url:'https://upos.bilivideo.com/1080.mp4'}];context.window.__playinfo__.data.quality=80;
  const noUpsize=await vm.runInNewContext(biliProbeExpression(href,'480'),context);assert.equal(noUpsize.state,'quality-unavailable');
  context.location.href=href+'?p=2';const wrong=await vm.runInNewContext(biliProbeExpression(href,'720'),context);assert.equal(wrong.state,'loading');
});
