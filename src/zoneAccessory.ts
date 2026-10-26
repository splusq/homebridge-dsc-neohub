import type { PlatformAccessory, Service, WithUUID } from 'homebridge';
import type { NeoHubPlatform } from './platform.ts';
import type { ZoneType } from './mapping.ts';

export interface ZoneContext {
  kind: 'zone';
  sessionId: string;
  zone: number;
  type: ZoneType;
}

type SensorType = Exclude<ZoneType, 'hidden'>;

/** One DSC zone exposed as a HomeKit sensor of the configured type. */
export class ZoneAccessory {
  readonly accessory: PlatformAccessory<ZoneContext>;
  private readonly platform: NeoHubPlatform;
  private service!: Service;
  private open = false;
  private bypassed = false;
  private available = false;

  constructor(platform: NeoHubPlatform, accessory: PlatformAccessory<ZoneContext>) {
    this.platform = platform;
    this.accessory = accessory;
    const { Service, Characteristic } = platform.api.hap;

    accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'DSC')
      .setCharacteristic(Characteristic.Model, 'PowerSeries Neo Zone')
      .setCharacteristic(Characteristic.SerialNumber, `${accessory.context.sessionId}-Z${accessory.context.zone}`);

    this.setType(accessory.context.type as SensorType);
  }

  get sessionId(): string {
    return this.accessory.context.sessionId;
  }

  /** Switches the sensor service, removing the old one if the configured type changed. */
  setType(type: SensorType): void {
    const serviceType = this.serviceTypes()[type];
    for (const [other, otherType] of Object.entries(this.serviceTypes())) {
      const existing = this.accessory.getService(otherType);
      if (existing && other !== type) {
        this.accessory.removeService(existing);
      }
    }
    this.accessory.context.type = type;
    this.service =
      this.accessory.getService(serviceType) ?? this.accessory.addService(serviceType as typeof Service.ContactSensor);

    const { Characteristic } = this.platform.api.hap;
    this.service.getCharacteristic(this.stateCharacteristic()).onGet(() => this.read(this.stateValue()));
    this.service.getCharacteristic(Characteristic.StatusActive).onGet(() => this.read(!this.bypassed));
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  update(open: boolean, bypassed: boolean): void {
    if (open !== this.open) {
      this.platform.log.debug(`${this.accessory.displayName}: ${open ? 'open' : 'closed'}`);
    }
    this.open = open;
    this.bypassed = bypassed;
    const { Characteristic } = this.platform.api.hap;
    this.service.updateCharacteristic(this.stateCharacteristic(), this.stateValue());
    this.service.updateCharacteristic(Characteristic.StatusActive, !bypassed);
  }

  private read<T>(value: T): T {
    if (!this.available) {
      throw this.platform.communicationFailure();
    }
    return value;
  }

  private serviceTypes(): Record<SensorType, WithUUID<typeof Service>> {
    const { Service } = this.platform.api.hap;
    return {
      contact: Service.ContactSensor,
      motion: Service.MotionSensor,
      smoke: Service.SmokeSensor,
      leak: Service.LeakSensor,
      co: Service.CarbonMonoxideSensor,
    };
  }

  private stateCharacteristic() {
    const { Characteristic } = this.platform.api.hap;
    switch (this.accessory.context.type) {
      case 'motion':
        return Characteristic.MotionDetected;
      case 'smoke':
        return Characteristic.SmokeDetected;
      case 'leak':
        return Characteristic.LeakDetected;
      case 'co':
        return Characteristic.CarbonMonoxideDetected;
      default:
        return Characteristic.ContactSensorState;
    }
  }

  private stateValue(): boolean | number {
    if (this.accessory.context.type === 'motion') {
      return this.open;
    }
    // Contact: 1 = not detected (open). Smoke/leak/CO: 1 = detected. Either way open/tripped is 1.
    return this.open ? 1 : 0;
  }
}
