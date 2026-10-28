import z from "zod";

export const SiloSettings = z.object({});

export type SiloSettings = z.infer<typeof SiloSettings>;
