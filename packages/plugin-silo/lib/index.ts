import packageJson from "../package.json" with { type: "json" };
import { SiloAPI } from "./datasource/silo.datasource.ts";
import { SiloSettingsResolver } from "./schema/silo-settings.resolver.ts";
import { SiloResolver } from "./schema/silo.resolver.ts";
import { pluginConfig } from "./silo-plugin.config.ts";
import { SiloSettings } from "./silo-settings.schema.ts";

import type { RivenPlugin } from "@repo/util-plugin-sdk";

export const plugin: RivenPlugin = {
  name: pluginConfig.name,
  version: packageJson.version,
  dataSources: [SiloAPI],
  resolvers: [SiloResolver, SiloSettingsResolver],
  hooks: {
    "riven.core.started": async () => {
      /* empty */
    },
    // Add more hooks as needed
  },
  settingsSchema: SiloSettings,
  async validator() {
    return Promise.resolve(true);
  },
};
