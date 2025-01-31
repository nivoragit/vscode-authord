import AbstractConfigManager from '../managers/AbstractConfigManager';
import { InstanceConfig } from '../utils/types';

export default class CacheService {
  public instances: InstanceConfig[] = [];

  constructor(private configManager: AbstractConfigManager) {
    this.refresh();
  }

  public refresh(): void {
    this.instances = this.configManager.getDocuments();
  }
}
