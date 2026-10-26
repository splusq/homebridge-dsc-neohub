import type { API } from 'homebridge';
import { NeoHubPlatform } from './platform.ts';
import { PLATFORM_NAME } from './settings.ts';

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, NeoHubPlatform);
};
