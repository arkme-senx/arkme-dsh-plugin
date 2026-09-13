import { resolve } from "node:path";
import config from "./vitest.recording-e2e.config.mjs";
export default {
  ...config,
  test: {
    ...config.test,
    include: [
      resolve(import.meta.dirname, "tests/e2e/recording-owner.e2e.mjs"),
    ],
    fileParallelism: false,
  },
};
