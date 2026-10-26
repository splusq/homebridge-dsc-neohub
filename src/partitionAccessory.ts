import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { NeoHubPlatform } from './platform.ts';
import type { PartitionStatus } from './protocol.ts';
import {
  INITIAL_STATE,
  applyRequest,
  applyStatus,
  commandFor,
  revertRequest,
  type SecurityState,
  type TargetState,
} from './mapping.ts';

export interface PartitionContext {
  kind: 'partition';
  sessionId: string;
  partition: number;
}

/** One DSC partition exposed as a HomeKit Security System. */
export class PartitionAccessory {
  readonly accessory: PlatformAccessory<PartitionContext>;
  private readonly platform: NeoHubPlatform;
  private readonly service: Service;
  private state: SecurityState = INITIAL_STATE;
  private available = false;
  private timeout?: NodeJS.Timeout;

  constructor(platform: NeoHubPlatform, accessory: PlatformAccessory<PartitionContext>) {
    this.platform = platform;
    this.accessory = accessory;
    const { Service, Characteristic } = platform.api.hap;
    const { partition } = accessory.context;

    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'DSC')
      .setCharacteristic(Characteristic.Model, 'PowerSeries Neo Partition')
      .setCharacteristic(Characteristic.SerialNumber, `${accessory.context.sessionId}-P${partition}`);

    this.service =
      accessory.getService(Service.SecuritySystem) ?? accessory.addService(Service.SecuritySystem);

    this.service
      .getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .onGet(() => this.read(this.state.current));

    this.service
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .onGet(() => this.read(this.state.target))
      .onSet((value) => this.setTarget(value));
  }

  get sessionId(): string {
    return this.accessory.context.sessionId;
  }

  get hasPendingRequest(): boolean {
    return this.state.requested !== undefined && this.timeout !== undefined;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  updateStatus(status: PartitionStatus): void {
    this.platform.log.info(`${this.accessory.displayName}: ${status}`);
    // Any response from the panel means the request was accepted or superseded.
    if (status !== 'unknown') {
      this.clearTimeout();
    }
    this.state = applyStatus(this.state, status);
    this.push();
  }

  /** Called when NeoHub reports an error after this partition's command. */
  rejectRequest(reason: string): void {
    this.platform.log.warn(`${this.accessory.displayName}: command rejected: ${reason}`);
    this.clearTimeout();
    this.state = revertRequest(this.state);
    this.push();
  }

  private read(value: number): number {
    if (!this.available) {
      throw this.platform.communicationFailure();
    }
    return value;
  }

  private setTarget(value: CharacteristicValue): void {
    if (!this.available) {
      throw this.platform.communicationFailure();
    }
    const target = value as TargetState;
    const command = commandFor(target);
    const { sessionId, partition } = this.accessory.context;

    const sent = this.platform.client.sendCommand(command, sessionId, partition, this.platform.config.userCode);
    if (!sent) {
      throw this.platform.communicationFailure();
    }
    this.platform.log.info(`${this.accessory.displayName}: sent ${command}`);
    this.platform.trackCommand(this);

    this.state = applyRequest(this.state, target);
    this.clearTimeout();
    this.timeout = setTimeout(
      () => this.rejectRequest('no response from panel'),
      this.platform.config.commandTimeoutSeconds * 1000,
    );
  }

  private clearTimeout(): void {
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private push(): void {
    const { Characteristic } = this.platform.api.hap;
    this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, this.state.current);
    this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, this.state.target);
  }
}
