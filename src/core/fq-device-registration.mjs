import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDeviceProfile } from './fq-device-profile.mjs';

const REGISTER_URL = 'https://log5-applog.fqnovel.com/service/2/device_register/';
const DEFAULT_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;
const YEAR_MS = 31_536_000_000;

export class FqDeviceRegistrationService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || randomBytes;
    this.randomUUID = options.randomUUID || randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async register(profile) {
    const generatedAt = this.now();
    const identity = createRegistrationIdentity(profile, {
      generatedAt,
      randomBytes: this.randomBytes,
      randomUUID: this.randomUUID
    });
    const params = new URLSearchParams({
      aid: '1967',
      version_code: profile.versionCode,
      channel: 'googleplay',
      package: 'com.dragon.read.oversea.gp',
      _rticket: String(generatedAt),
      use_store_region_cookie: '1',
      okhttp_version: '4.2.137.76-fanqie'
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${REGISTER_URL}?${params}`, {
        method: 'POST',
        headers: {
          'user-agent': profile.userAgent,
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'content-type': 'application/json',
          'log-encode-type': 'gzip',
          'x-ss-req-ticket': String(generatedAt),
          'x-vc-bdturing-sdk-version': '3.7.2.cn',
          cookie: profile.cookie
        },
        body: JSON.stringify(buildRegistrationPayload(profile, identity)),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new DeviceRegistrationError(
          'DEVICE_REGISTER_HTTP_ERROR',
          `设备注册接口返回 HTTP ${response.status}`
        );
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new DeviceRegistrationError(
          'DEVICE_REGISTER_INVALID_RESPONSE',
          '设备注册接口返回了异常内容'
        );
      }

      const deviceId = extractNumericId(text, payload, 'device_id');
      const installId = extractNumericId(text, payload, 'install_id');
      if (!deviceId || !installId) {
        throw new DeviceRegistrationError(
          'DEVICE_REGISTER_REJECTED',
          payload?.message || '上游未返回有效的设备标识'
        );
      }

      return createDeviceProfile({
        ...profile,
        deviceId,
        installId,
        cookie: `store-region=cn-zj; store-region-src=did; install_id=${installId};`,
        registeredAt: generatedAt,
        registrationVersion: 1
      });
    } catch (error) {
      if (error instanceof DeviceRegistrationError) throw error;
      if (error?.name === 'AbortError') {
        throw new DeviceRegistrationError('DEVICE_REGISTER_TIMEOUT', '设备注册请求超时');
      }
      throw new DeviceRegistrationError(
        'DEVICE_REGISTER_FAILED',
        error?.message || '设备注册失败'
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DeviceRegistrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DeviceRegistrationError';
    this.code = code;
  }
}

function createRegistrationIdentity(profile, options) {
  const random = options.randomBytes(32);
  const androidId = random.subarray(0, 8).toString('hex');
  const firstHash = md5(androidId);
  const installRange = YEAR_MS - DAY_MS;
  const installOffset = DAY_MS + (random.readUInt32BE(8) % installRange);
  return {
    openudid: `${firstHash}${md5(firstHash).slice(0, 8)}`,
    sigHash: random.subarray(12, 28).toString('hex'),
    clientudid: options.randomUUID(),
    reqId: options.randomUUID(),
    ipv6Address: toIpv6(random.subarray(16, 32)),
    rom: String(1414 + (random[28] % 7)),
    releaseBuild: `${String(profile.romVersion).split('+')[0]}_20171120`,
    displayDensity: densityName(profile.dpi),
    apkFirstInstallTime: options.generatedAt - installOffset,
    generatedAt: options.generatedAt
  };
}

function buildRegistrationPayload(profile, identity) {
  return {
    magic_tag: 'ss_app_log',
    header: {
      display_name: '番茄小说',
      aid: 1967,
      channel: 'googleplay',
      package: 'com.dragon.read.oversea.gp',
      app_version: profile.versionName,
      version_code: Number(profile.versionCode),
      update_version_code: Number(profile.updateVersionCode),
      manifest_version_code: Number(profile.versionCode),
      app_version_minor: profile.versionName,
      sdk_version: '3.7.0-rc.25-fanqie-xiaoshuo-opt',
      sdk_target_version: 29,
      git_hash: '5b6a0d3',
      sdk_flavor: 'china',
      guest_mode: 0,
      is_system_app: 0,
      pre_installed_channel: '',
      not_request_sender: 0,
      os: 'Android',
      os_version: profile.osVersion,
      os_api: Number(profile.osApi),
      device_model: profile.deviceType,
      device_brand: profile.deviceBrand,
      device_manufacturer: profile.deviceBrand,
      cpu_abi: profile.hostAbi,
      release_build: identity.releaseBuild,
      density_dpi: Number(profile.dpi),
      display_density: identity.displayDensity,
      resolution: String(profile.resolution).replace('*', 'x'),
      language: 'zh',
      timezone: 8,
      access: 'wifi',
      rom: identity.rom,
      rom_version: String(profile.romVersion).replace('+', ' '),
      cdid: profile.cdid,
      sig_hash: identity.sigHash,
      openudid: identity.openudid,
      clientudid: identity.clientudid,
      ipv6_list: [{ type: 'client_anpi', value: identity.ipv6Address }],
      region: 'CN',
      tz_name: 'Asia/Shanghai',
      tz_offset: 28_800,
      sim_serial_number: [],
      oaid_may_support: false,
      req_id: identity.reqId,
      device_platform: 'android',
      custom: {
        host_bit: 64,
        account_region: 'cn',
        dragon_device_type: 'phone'
      },
      apk_first_install_time: identity.apkFirstInstallTime
    },
    _gen_time: identity.generatedAt
  };
}

function md5(value) {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

function toIpv6(bytes) {
  const parts = [];
  for (let index = 0; index < bytes.length; index += 2) {
    parts.push(bytes.readUInt16BE(index).toString(16).padStart(4, '0'));
  }
  return parts.join(':');
}

function densityName(dpi) {
  const value = Number(dpi);
  if (value >= 560) return 'xxxhdpi';
  if (value >= 400) return 'xxhdpi';
  if (value >= 280) return 'xhdpi';
  return 'hdpi';
}

function extractNumericId(text, payload, name) {
  const match = text.match(new RegExp(`"${name}"\\s*:\\s*"?([0-9]+)"?`));
  if (match?.[1]) return match[1];
  const value = payload?.[name];
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '';
}
