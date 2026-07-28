import { JavaWorkerClient } from '../src/core/java-worker-client.mjs';

const url = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/reader/batch_full/v'
  + '?manifest_version_code=68132'
  + '&_rticket=1754299683771'
  + '&iid=4223674528611611'
  + '&channel=googleplay'
  + '&device_type=ANA-AN00'
  + '&language=zh'
  + '&host_abi=arm64-v8a'
  + '&dragon_device_type=phone'
  + '&resolution=1920*1080'
  + '&update_version_code=68132'
  + '&cdid=8d2d9eae-6ad9-4ffa-93b1-9ff11faa6b44'
  + '&key_register_ts=0'
  + '&pv_player=68132'
  + '&os_api=32'
  + '&req_type=0'
  + '&dpi=480'
  + '&compliance_status=0'
  + '&ac=wifi'
  + '&device_id=4223674528607515'
  + '&os=android'
  + '&os_version=13'
  + '&version_code=68132'
  + '&book_id=7207066781708454916'
  + '&app_name=novelapp'
  + '&version_name=6.8.1.32'
  + '&device_brand=HUAWEI'
  + '&need_personal_recommend=1'
  + '&ssmix=a'
  + '&player_so_load=1'
  + '&item_ids=7207067126170026557'
  + '&device_platform=android'
  + '&is_android_pad_screen=0'
  + '&aid=1967'
  + '&rom_version=V417IR+release-keys';

const headers = [
  ['accept', 'application/json; charset=utf-8,application/x-protobuf'],
  ['cookie', 'store-region=cn-zj; store-region-src=did; install_id=4223674528611611;'],
  ['user-agent', 'com.dragon.read.oversea.gp/68132 (Linux; U; Android 12; zh_CN; ANA-AN00; Build/V417IR;tt-ok/3.12.13.4-tiktok)'],
  ['accept-encoding', 'gzip'],
  ['x-xs-from-web', '0'],
  ['x-vc-bdturing-sdk-version', '3.7.2.cn'],
  ['x-reading-request', '1754299683771-1106737160'],
  ['sdk-version', '2'],
  ['x-tt-store-region-src', 'did'],
  ['x-tt-store-region', 'cn-zj'],
  ['lc', '101'],
  ['x-ss-req-ticket', '1754299683771'],
  ['passport-sdk-version', '50564'],
  ['host', 'api5-normal-sinfonlineb.fqnovel.com'],
  ['connection', 'keep-alive']
];

const worker = new JavaWorkerClient({ cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
worker.on('log', (line) => process.stderr.write(`${line}\n`));

try {
  const ready = await worker.start();
  const signed = await worker.sign(url, headers);
  const refreshed = await worker.refresh();
  console.log(JSON.stringify({
    ready: ready.type,
    signatureHeaders: signed.headers.map(([name]) => name),
    refreshedGeneration: refreshed.generation
  }, null, 2));
} finally {
  await worker.stop();
}
