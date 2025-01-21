import { ConfigObject } from "./ConfigObjects";

/*
***********************************************************************************************
 * FILE: src/config/ConfigProvider.ts
 * Generic interface for reading/writing configuration from any storage format
 **********************************************************************************************
 */
export interface ConfigProvider<T extends ConfigObject> {
    read(): Promise<T>;
    write(data: T): Promise<void>;
  }
  