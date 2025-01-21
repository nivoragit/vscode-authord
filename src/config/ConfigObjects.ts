import { InstanceConfig } from "../utils/types";

// export interface ConfigObject {
//     // Common base for any config object (can be empty or hold shared fields).
// }
export type ConfigObject = object

export interface JsonConfigObject extends ConfigObject {
    schema?: string;
    title?: string;
    type?: string;
    topics: { dir: string };
    images: { dir: string; version?: string; 'web-path'?: string };
    instances: InstanceConfig[];
}

export interface XmlConfigObject extends ConfigObject {
    ihp: any; // shape of your .ihp data in the XML
    schema?: string;
    title?: string;
    type?: string;
    // Additional top-level fields if needed.
}