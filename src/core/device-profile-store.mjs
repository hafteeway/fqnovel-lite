import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createDeviceProfile,
  createRandomDeviceProfile
} from './fq-device-profile.mjs';

export class DeviceProfileStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), 'data'));
    this.profilePath = path.join(this.dataDir, 'device-profile.json');
    this.generator = options.generator || createRandomDeviceProfile;
    this.initialProfile = createDeviceProfile(options.initialProfile);
    this.now = options.now || Date.now;
    this.recoveredLegacyProfile = false;
    this.profile = this.#read();
    if (this.recoveredLegacyProfile) this.#flush(this.profile);
  }

  get() {
    return createDeviceProfile(this.profile);
  }

  generate() {
    return this.generator();
  }

  commit(profile) {
    const next = createDeviceProfile({
      ...profile,
      generation: Number(this.profile.generation || 1) + 1,
      updatedAt: this.now(),
      profileSchema: 2
    });
    this.#flush(next);
    this.profile = next;
    return this.get();
  }

  rotate() {
    return this.commit(this.generate());
  }

  status() {
    return {
      generation: Number(this.profile.generation || 1),
      deviceBrand: this.profile.deviceBrand,
      deviceType: this.profile.deviceType,
      osVersion: this.profile.osVersion,
      osApi: this.profile.osApi,
      resolution: this.profile.resolution,
      dpi: this.profile.dpi,
      updatedAt: this.profile.updatedAt || null
    };
  }

  #read() {
    try {
      const saved = JSON.parse(readFileSync(this.profilePath, 'utf8'));
      if (Number(saved.generation || 1) > 1 && !saved.registeredAt && !saved.profileSchema) {
        this.recoveredLegacyProfile = true;
        return createDeviceProfile({
          ...this.initialProfile,
          generation: Number(saved.generation || 1) + 1,
          updatedAt: this.now(),
          recoveryReason: 'unregistered-device-profile'
        });
      }
      return createDeviceProfile({
        ...saved,
        generation: Number(saved.generation || 1)
      });
    } catch {
      return createDeviceProfile({
        ...this.initialProfile,
        generation: 1,
        updatedAt: null
      });
    }
  }

  #flush(profile) {
    mkdirSync(path.dirname(this.profilePath), { recursive: true });
    const temporary = `${this.profilePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.profilePath);
  }
}
