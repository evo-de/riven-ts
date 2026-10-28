import { BaseDataSource } from "@repo/util-plugin-sdk";

import type { SiloSettings } from "../silo-settings.schema.ts";

class SiloAPIError extends Error {
  public override name = "SiloAPIError";
}

export class SiloAPI extends BaseDataSource<SiloSettings> {
  public override baseURL = "https://silo.com/api/";
  public override serviceName = "Silo";

  public override async validate() {
    try {
      // Implement your own validation logic here
      await this.get("validate");

      return true;
    } catch {
      return false;
    }
  }

  public async fetchData() {
    try {
      const response = await this.get<unknown>("data");

      console.log(response); // oxlint-disable-line no-console
    } catch {
      throw new SiloAPIError("Failed to fetch data");
    }
  }
}
