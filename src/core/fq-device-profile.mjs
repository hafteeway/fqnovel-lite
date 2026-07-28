import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const DEVICE_CATALOG = Object.freeze([
  ['Xiaomi', ['24031PN0DC', '2304FPN6DC', '23078RKD5C', 'M2102K1AC', 'M2011K2C']],
  ['HUAWEI', ['ELS-AN00', 'TAS-AL00', 'ANA-AN00', 'VOG-AL00', 'WLZ-AN00']],
  ['OPPO', ['CPH2207', 'CPH2211', 'CPH2237', 'PDSM00', 'PGBM10']],
  ['vivo', ['V2197A', 'V2118A', 'V2055A', 'PD2186', 'PD2194']],
  ['OnePlus', ['LE2100', 'LE2110', 'MT2110', 'PJZ110', 'OnePlus11']],
  ['Samsung', ['SM-G9980', 'SM-G9910', 'SM-G7810', 'SM-A5260', 'SM-S9110']]
]);

const ANDROID_PROFILES = Object.freeze([
  { osVersion: '10', osApi: '29', romVersion: 'V291IR+release-keys' },
  { osVersion: '11', osApi: '30', romVersion: 'V394IR+release-keys' },
  { osVersion: '12', osApi: '32', romVersion: 'V417IR+release-keys' },
  { osVersion: '13', osApi: '33', romVersion: 'V433IR+release-keys' },
  { osVersion: '14', osApi: '34', romVersion: 'V451IR+release-keys' }
]);

const DISPLAY_PROFILES = Object.freeze([
  { resolution: '1600*900', dpi: '320' },
  { resolution: '2400*1080', dpi: '480' },
  { resolution: '2340*1080', dpi: '440' },
  { resolution: '1920*1080', dpi: '480' },
  { resolution: '2560*1440', dpi: '560' },
  { resolution: '3200*1440', dpi: '640' }
]);

export const DEFAULT_DEVICE_PROFILE = Object.freeze({
  installId: process.env.FQNOVEL_INSTALL_ID || '4223674528611611',
  deviceId: process.env.FQNOVEL_DEVICE_ID || '4223674528607515',
  aid: '1967',
  versionCode: '68132',
  versionName: '6.8.1.32',
  updateVersionCode: '68132',
  deviceType: process.env.FQNOVEL_DEVICE_TYPE || 'ANA-AN00',
  deviceBrand: process.env.FQNOVEL_DEVICE_BRAND || 'HUAWEI',
  romVersion: process.env.FQNOVEL_ROM_VERSION || 'V417IR+release-keys',
  resolution: process.env.FQNOVEL_RESOLUTION || '1920*1080',
  dpi: process.env.FQNOVEL_DPI || '480',
  hostAbi: process.env.FQNOVEL_HOST_ABI || 'arm64-v8a',
  cdid: process.env.FQNOVEL_CDID || '8d2d9eae-6ad9-4ffa-93b1-9ff11faa6b44',
  osApi: '32',
  osVersion: '13'
});

export function createDeviceProfile(overrides = {}) {
  const device = { ...DEFAULT_DEVICE_PROFILE, ...overrides };
  device.userAgent = overrides.userAgent
    || `com.dragon.read.oversea.gp/${device.versionCode} (Linux; U; Android 12; zh_CN; ${device.deviceType}; Build/${device.romVersion.replace('+release-keys', '')};tt-ok/3.12.13.4-tiktok)`;
  device.cookie = overrides.cookie
    || `store-region=cn-zj; store-region-src=did; install_id=${device.installId};`;
  return Object.freeze(device);
}

export function createRandomDeviceProfile(options = {}) {
  const randomIndex = options.randomIndex || ((length) => randomInt(length));
  const randomBytesFactory = options.randomBytes || randomBytes;
  const uuidFactory = options.randomUUID || randomUUID;
  const [deviceBrand, models] = pick(DEVICE_CATALOG, randomIndex);
  const deviceType = pick(models, randomIndex);
  const android = pick(ANDROID_PROFILES, randomIndex);
  const display = pick(DISPLAY_PROFILES, randomIndex);
  const installId = createNumericId(randomBytesFactory);
  const deviceId = createNumericId(randomBytesFactory);
  const cdid = uuidFactory();
  const buildVersion = android.romVersion.replace('+release-keys', '');

  return createDeviceProfile({
    installId,
    deviceId,
    cdid,
    deviceBrand,
    deviceType,
    ...android,
    ...display,
    hostAbi: 'arm64-v8a',
    userAgent: `com.dragon.read.oversea.gp/68132 (Linux; U; Android ${android.osVersion}; zh_CN; ${deviceType}; Build/${buildVersion};tt-ok/3.12.13.4-tiktok)`,
    cookie: `store-region=cn-zj; store-region-src=did; install_id=${installId};`
  });
}

function pick(values, randomIndex) {
  const index = Number(randomIndex(values.length));
  if (!Number.isInteger(index) || index < 0 || index >= values.length) {
    throw new RangeError(`Random index ${index} is outside 0..${values.length - 1}`);
  }
  return values[index];
}

function createNumericId(randomBytesFactory) {
  const bytes = randomBytesFactory(16);
  let result = String(1 + (bytes[0] % 9));
  for (let index = 1; index < 16; index += 1) result += String(bytes[index] % 10);
  return result;
}

export function buildCommonParams(device, now = Date.now()) {
  return new URLSearchParams([
    ['iid', device.installId],
    ['device_id', device.deviceId],
    ['ac', 'wifi'],
    ['channel', 'googleplay'],
    ['aid', device.aid],
    ['app_name', 'novelapp'],
    ['version_code', device.versionCode],
    ['version_name', device.versionName],
    ['device_platform', 'android'],
    ['os', 'android'],
    ['ssmix', 'a'],
    ['device_type', device.deviceType],
    ['device_brand', device.deviceBrand],
    ['language', 'zh'],
    ['os_api', device.osApi],
    ['os_version', device.osVersion],
    ['manifest_version_code', device.versionCode],
    ['resolution', device.resolution],
    ['dpi', device.dpi],
    ['update_version_code', device.updateVersionCode],
    ['_rticket', String(now)],
    ['host_abi', device.hostAbi],
    ['dragon_device_type', 'phone'],
    ['pv_player', device.versionCode],
    ['compliance_status', '0'],
    ['need_personal_recommend', '1'],
    ['player_so_load', '1'],
    ['is_android_pad_screen', '0'],
    ['rom_version', device.romVersion],
    ['cdid', device.cdid]
  ]);
}

export function buildCommonHeaders(device, now = Date.now(), random = Math.random) {
  return [
    ['accept', 'application/json; charset=utf-8,application/x-protobuf'],
    ['cookie', device.cookie],
    ['user-agent', device.userAgent],
    ['accept-encoding', 'gzip'],
    ['x-xs-from-web', '0'],
    ['x-ss-req-ticket', String(now)],
    ['x-reading-request', `${now}-${Math.floor(random() * 2_000_000_000)}`],
    ['x-vc-bdturing-sdk-version', '3.7.2.cn'],
    ['lc', '101'],
    ['sdk-version', '2'],
    ['passport-sdk-version', '50564'],
    ['x-tt-store-region', 'cn-zj'],
    ['x-tt-store-region-src', 'did']
  ];
}

export function buildSearchParams(device, request, now = Date.now()) {
  const params = buildCommonParams(device, now);
  const values = {
    bookshelf_search_plan: request.bookshelfSearchPlan ?? 4,
    offset: request.offset ?? 0,
    from_rs: request.fromRs ?? false,
    user_is_login: request.userIsLogin ?? 0,
    bookstore_tab: request.bookstoreTab ?? 2,
    query: request.query,
    count: request.count ?? 20,
    search_source: request.searchSource ?? 1,
    clicked_content: request.clickedContent ?? 'search_history',
    search_source_id: request.searchSourceId ?? 'his###',
    use_lynx: request.useLynx ?? false,
    use_correct: request.useCorrect ?? true,
    last_search_page_interval: request.lastSearchPageInterval ?? 0,
    line_words_num: request.lineWordsNum ?? 0,
    tab_name: request.tabName ?? 'store',
    last_consume_interval: request.lastConsumeInterval ?? 0,
    pad_column_cover: request.padColumnCover ?? 0,
    is_first_enter_search: request.isFirstEnterSearch ?? true,
    passback: request.passback ?? request.offset ?? 0,
    tab_type: request.tabType ?? 3,
    normal_session_id: request.normalSessionId || randomUUID(),
    cold_start_session_id: request.coldStartSessionId || randomUUID(),
    charging: request.charging ?? 1,
    screen_brightness: request.screenBrightness ?? 72,
    battery_pct: request.batteryPct ?? 78,
    down_speed: request.downSpeed ?? 89121,
    sys_dark_mode: request.sysDarkMode ?? 0,
    app_dark_mode: request.appDarkMode ?? 0,
    font_scale: request.fontScale ?? 100,
    network_type: request.networkType ?? 4,
    current_volume: request.currentVolume ?? 75
  };
  for (const [key, value] of Object.entries(values)) params.set(key, String(value));
  if (request.searchId) params.set('search_id', request.searchId);
  if (request.isFirstEnterSearch !== false) {
    params.set('client_ab_info', request.clientAbInfo || '{}');
  }
  return params;
}

export function buildDirectoryParams(device, request, now = Date.now()) {
  const params = buildCommonParams(device, now);
  params.set('book_type', String(request.bookType ?? 0));
  params.set('book_id', request.bookId);
  params.set('need_version', String(request.needVersion ?? true));
  if (request.itemDataListMd5) params.set('item_data_list_md5', request.itemDataListMd5);
  if (request.catalogDataMd5) params.set('catalog_data_md5', request.catalogDataMd5);
  if (request.bookInfoMd5) params.set('book_info_md5', request.bookInfoMd5);
  return params;
}
