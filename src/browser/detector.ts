import { InteractiveElement } from './models';

export interface Detector {
  detect(imageB64: string, scaleFactor: number, detectSheets: boolean): Promise<InteractiveElement[]>;
}
