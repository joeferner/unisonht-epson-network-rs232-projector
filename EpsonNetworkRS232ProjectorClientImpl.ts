import * as net from "net";
import * as Logger from "bunyan";
import {createLogger} from "../unisonht/lib/Log";
import {EpsonNetworkRS232ProjectorClient} from "./EpsonNetworkRS232ProjectorClient";
import {Device} from "unisonht";
import {EpsonNetworkRS232Projector} from "./index";

export class EpsonNetworkRS232ProjectorClientImpl implements EpsonNetworkRS232ProjectorClient {
  private address: string;
  private port: number;
  private client: net.Socket;
  private log: Logger;

  constructor(address: string, port: number) {
    this.address = address;
    this.port = port;
    this.log = createLogger('EpsonNetworkRS232ProjectorClient');
  }

  start(): Promise<void> {
    this.client = new net.Socket();
    return new Promise<void>((resolve, reject) => {
      this.client.on('close', () => {
        this.log.info('connection closed');
        reject(new Error('connnection closed'));
      });
      this.client.connect(this.port, this.address, () => {
        resolve();
      });
    });
  }

  public getPowerState(): Promise<Device.PowerState> {
    return this.writeCommand('PWR?')
      .then((result) => {
        const m = result.toUpperCase().match(/PWR=(\d\d)/);
        if (!m) {
          return null;
        }
        switch (m[1]) {
          case '01':
          case '02':
            return Device.PowerState.ON;
          case '00':
            return Device.PowerState.OFF;
          default:
            return null;
        }
      })
      .catch((err) => {
        this.log.warn('Could not get power state', err);
        return null;
      });
  }

  public on(): Promise<void> {
    return this.getPowerState()
      .then((powerState): Promise<void> => {
        if (powerState == Device.PowerState.ON) {
          return;
        }
        return this.writeCommand('PWR ON', 10 * 1000)
          .then(() => {
          })
          .catch((err) => {
            this.log.warn('could not power on first try. Trying again', err);
            return this.writeCommand('PWR ON', 10 * 1000);
          });
      });
  }

  public off(): Promise<void> {
    return this.writeCommand('PWR OFF', 10 * 1000).then(() => {
    });
  }

  public changeInput(input: string): Promise<void> {
    const sourceCode = EpsonNetworkRS232ProjectorClientImpl.toSourceCode(input);
    if (!sourceCode) {
      return Promise.reject(new Error(`Invalid source: ${input}`));
    }
    const sourceCodeHex = sourceCode.toString(16);

    return this.getInput()
      .then((currentInput) => {
        this.log.debug(`currentInput ${JSON.stringify(currentInput)}`);
        if (sourceCodeHex.toLowerCase() == currentInput.rawCode.toLowerCase()) {
          this.log.debug(`Skipping set source. source already set to: ${sourceCodeHex}`);
          return;
        }
        return this.writeCommand(`SOURCE ${sourceCodeHex}`);
      })
      .then(() => {
      })
      .catch((err) => {
        this.log.warn('could not get current input', err);
        return this.writeCommand(`SOURCE ${sourceCodeHex}`);
      });
  }

  public buttonPress(buttonName: string): Promise<void> {
    const keyCode = EpsonNetworkRS232ProjectorClientImpl.toKeyCode(buttonName);
    if (!keyCode) {
      return Promise.reject(new Error(`Could not convert to key code: ${buttonName}`));
    }
    return this.writeCommand(`KEY ${keyCode.toString(16)}`).then(() => {
    });
  }

  public getInput(): Promise<EpsonNetworkRS232Projector.Input> {
    return this.writeCommand('SOURCE?')
      .then((result) => {
        const m = result.match(/SOURCE=(\d\d)/);
        if (m) {
          return this.fromSourceCode(m[1]);
        } else {
          return {
            rawCode: result
          };
        }
      });
  }

  private writeCommand(command: string, timeout?: number): Promise<string> {
    return this.writeData(`${command}\r\n`, timeout);
  }

  private writeData(data: string, timeout?: number): Promise<string> {
    timeout = timeout || 1000;

    const handleData = (resolve, data) => {
      this.log.debug(`receive: ${data}`);
      console.log(data.toString());
      resolve(data.toString());
    };
    const handleError = (reject, err) => {
      this.log.error('error', err);
      reject(err);
    };
    const removeListeners = () => {
      this.client.removeAllListeners('data');
      this.client.removeListener('error', handleError);
    };

    return new Promise((resolve, reject) => {
      this.client.once('data', handleData.bind(this, resolve));
      this.client.once('error', handleData.bind(this, reject));

      this.log.debug(`writing data: ${data.trim()}`);
      this.client.write(data, (err) => {
        if (err) {
          return reject(err);
        }
        setTimeout(() => {
          return reject(new Error('timeout waiting for data'));
        }, timeout);
      });
    })
      .then((data) => {
        removeListeners();
        return data;
      })
      .catch((err) => {
        removeListeners();
        throw err;
      });
  }

  private static toSourceCode(input: string): number {
    switch (input.toLowerCase()) {
      case "hdmi1":
        return 0x30;
      case "hdmi2":
        return 0xA0;
      default:
        return null;
    }
  }

  private static toKeyCode(button: string): number {
    switch (button.toLowerCase()) {
      case "power":
        return 0x01;
      case "menu":
        return 0x03;
      case "esc":
        return 0x05;
      case "enter":
        return 0x16;
      case "up":
        return 0x35;
      case "down":
        return 0x36;
      case "left":
        return 0x37;
      case "right":
        return 0x38;
      case "source":
        return 0x48;
      default:
        return null;
    }
  }

  private fromSourceCode(sourceCode: string): EpsonNetworkRS232Projector.Input {
    let input;
    switch (sourceCode.toLowerCase()) {
      case "30":
        input = "hdmi1";
        break;
      case "a0":
        input = "hdmi2";
        break;
      default:
        return {
          rawCode: sourceCode,
          deviceInput: sourceCode,
          mappedInput: null
        };
    }

    return {
      rawCode: sourceCode,
      deviceInput: input
    };
  }
}