import { http, HttpResponse } from "msw";
import { expect } from "vitest";

import { it } from "../../__tests__/silo.test-context.ts";
import { SiloAPI } from "../silo.datasource.ts";

it("returns false if the request fails", async ({ server, dataSourceMap }) => {
  server.use(
    http.get("**/validate", () => HttpResponse.json(null, { status: 401 })),
  );

  const siloApi = dataSourceMap.get(SiloAPI);
  const isValid = await siloApi.validate();

  expect(isValid).toBe(false);
});

it("returns true if the request succeeds", async ({
  server,
  dataSourceMap,
}) => {
  server.use(
    http.get("**/validate", () => HttpResponse.json({ success: true })),
  );

  const siloApi = dataSourceMap.get(SiloAPI);
  const isValid = await siloApi.validate();

  expect(isValid).toBe(true);
});
